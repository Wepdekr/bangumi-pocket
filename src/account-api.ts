import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type {
  User,
  RemoteCollection,
  RemoteEpisodes,
  Saved,
  Review,
} from "./types";
export class AccountError extends Error {
  constructor(
    public status: number,
    operation = "同步",
  ) {
    super(
      status === 401
        ? "授权已失效，请更新访问令牌。"
        : status === 403
          ? "令牌没有收藏写入权限，请检查官方授权设置。"
          : status === 429
            ? "请求过于频繁，请稍后同步。"
            : status === 0
              ? "网络连接失败，修改已保留，联网后可以重试。"
              : status === 404
                ? `${operation}失败（404）：账号、条目或收藏记录不存在，请重试同步。`
                : `Bangumi ${operation}失败（${status}）。`,
    );
  }
}
export const statusToRemote: Record<Saved["status"], number> = {
  wish: 1,
  done: 2,
  doing: 3,
  hold: 4,
  dropped: 5,
};
export const remoteToStatus: Record<number, Saved["status"]> = {
  1: "wish",
  2: "done",
  3: "doing",
  4: "hold",
  5: "dropped",
};
class AccountResponseError extends Error {}

export async function accountRequest<T>(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
  service: "public" | "web" | "legacy" = "public",
): Promise<T> {
  // Account requests never enter the public cache or put tokens into URLs.
  const url =
    service === "web"
      ? Capacitor.isNativePlatform()
        ? "https://next.bgm.tv/p1" + path
        : "/account-api" + path
      : service === "legacy" && !Capacitor.isNativePlatform()
        ? "/legacy-account-api" + path
        : "https://api.bgm.tv" + path;
  const operation =
    path === "/v0/me"
      ? "验证账号"
      : /\/episodes\?/.test(path)
        ? "读取章节进度"
        : path.endsWith("/episodes") ||
            path.startsWith("/collections/episodes/") ||
            /^\/ep\/\d+\/status\//.test(path)
          ? "更新章节进度"
          : method !== "GET"
            ? "更新收藏"
            : "读取账号收藏";
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined)
    headers["Content-Type"] =
      service === "legacy"
        ? "application/x-www-form-urlencoded"
        : "application/json";
  const payload =
    service === "legacy"
      ? new URLSearchParams(body as Record<string, string>).toString()
      : body;
  const checked = (data: unknown): T => {
    // Legacy endpoints report authorization/write failures inside HTTP 200 JSON.
    if (service === "legacy") {
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          throw new AccountResponseError(
            "章节提交返回格式异常，结果尚未确认。请先核对原站进度。",
          );
        }
      }
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new AccountResponseError(
          "章节提交返回格式异常，结果尚未确认。请先核对原站进度。",
        );
      const result = data as {
        code?: number;
        error?: unknown;
        status?: string;
      };
      // The field named `error` is a status description, including on success.
      // Official legacy StatusCode: 200 OK, 202 Accepted, 304 Not Modified.
      if ([200, 202, 304].includes(result.code ?? -1)) return data as T;
      if (typeof result.code === "number" && result.code >= 400) {
        const code =
          result.code === 40001
            ? 404
            : [40101, 40102].includes(result.code)
              ? 401
              : result.code;
        throw new AccountError(code, operation);
      }
      throw new AccountResponseError(
        "章节提交未返回可确认的业务状态，请先核对原站进度后重试。",
      );
    }
    return data as T;
  };
  try {
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.request({
        url,
        method,
        headers: {
          ...headers,
          "User-Agent":
            "BangumiPocket/0.12.2 (Android; personal unofficial client)",
        },
        data: payload,
        connectTimeout: 12000,
        readTimeout: 18000,
        disableRedirects: true,
      });
      if (response.status < 200 || response.status >= 300)
        throw new AccountError(response.status, operation);
      return checked(response.status === 204 ? undefined : response.data);
    }
    const response = await fetch(url, {
      method,
      headers,
      body:
        payload !== undefined
          ? service === "legacy"
            ? String(payload)
            : JSON.stringify(payload)
          : undefined,
      signal: AbortSignal.timeout(18000),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) throw new AccountError(response.status, operation);
    return checked(
      response.status === 204
        ? undefined
        : service === "legacy"
          ? await response.text()
          : await response.json(),
    );
  } catch (error) {
    if (error instanceof AccountError || error instanceof AccountResponseError)
      throw error;
    throw new AccountError(0);
  }
}
export const accountApi = {
  // The original site's WatchedTill submits exact visible chapter IDs. The next
  // site's batch=true instead queries by sort and can include hidden chapters.
  setEpisodeProgress: (
    token: string,
    episodeId: number,
    progress: { batch: true; episodeIds: number[] } | { type: 0 | 2 },
  ) => {
    if ("batch" in progress) {
      const ids = [...new Set(progress.episodeIds)];
      if (
        !ids.length ||
        !ids.includes(episodeId) ||
        ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
      )
        throw new Error("批量章节资料异常，请重新加载后重试。");
      return accountRequest<void>(
        token,
        `/ep/${episodeId}/status/watched?${new URLSearchParams({ ep_id: ids.join(",") })}`,
        "POST",
        { ep_id: ids.join(",") },
        "legacy",
      );
    }
    return accountRequest<void>(
      token,
      `/collections/episodes/${episodeId}`,
      "PATCH",
      progress,
      "web",
    );
  },
  me: (token: string) => accountRequest<User>(token, "/v0/me"),
  collections: (token: string, username: string, offset = 0) =>
    accountRequest<{ data: RemoteCollection[]; total: number }>(
      token,
      `/v0/users/${encodeURIComponent(username)}/collections?limit=50&offset=${offset}`,
    ),
  episodes: (token: string, id: number, offset = 0) =>
    accountRequest<RemoteEpisodes>(
      token,
      `/v0/users/-/collections/${id}/episodes?episode_type=0&limit=100&offset=${offset}`,
    ),
  async setCollection(
    token: string,
    id: number,
    status: Saved["status"],
    review?: Review,
  ) {
    const path = `/v0/users/-/collections/${id}`;
    // The server builds timeline content from this request, not the saved collection.
    const payload = { type: statusToRemote[status], ...review };
    try {
      await accountRequest<void>(token, path, "PATCH", payload);
    } catch (error) {
      if (!(error instanceof AccountError) || error.status !== 404) throw error;
      await accountRequest<void>(token, path, "POST", payload);
    }
  },
  setEpisodes: (
    token: string,
    id: number,
    episodeIds: number[],
    watched: boolean,
  ) =>
    accountRequest<void>(
      token,
      `/v0/users/-/collections/${id}/episodes`,
      "PATCH",
      { episode_id: episodeIds, type: watched ? 2 : 0 },
    ),
};
