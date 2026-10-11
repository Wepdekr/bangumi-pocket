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
export async function accountRequest<T>(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  // Account requests never enter the public cache or put tokens into URLs.
  const url = "https://api.bgm.tv" + path;
  const operation =
    path === "/v0/me"
      ? "验证账号"
      : /\/episodes\?/.test(path)
        ? "读取章节进度"
        : path.endsWith("/episodes")
          ? "更新章节进度"
          : method !== "GET"
            ? "更新收藏"
            : "读取账号收藏";
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.request({
        url,
        method,
        headers: {
          ...headers,
          "User-Agent":
            "BangumiPocket/0.8.1 (Android; personal unofficial client)",
        },
        data: body,
        connectTimeout: 12000,
        readTimeout: 18000,
      });
      if (response.status < 200 || response.status >= 300)
        throw new AccountError(response.status, operation);
      return response.status === 204 ? (undefined as T) : response.data;
    }
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(18000),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) throw new AccountError(response.status, operation);
    return response.status === 204 ? (undefined as T) : await response.json();
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(0);
  }
}
export const accountApi = {
  setReview: (token: string, id: number, review: Review) =>
    accountRequest<void>(
      token,
      `/v0/users/-/collections/${id}`,
      "PATCH",
      review,
    ),
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
  async setStatus(token: string, id: number, status: Saved["status"]) {
    const path = `/v0/users/-/collections/${id}`;
    try {
      await accountRequest<void>(token, path, "PATCH", {
        type: statusToRemote[status],
      });
    } catch (error) {
      if (!(error instanceof AccountError) || error.status !== 404) throw error;
      await accountRequest<void>(token, path, "POST", {
        type: statusToRemote[status],
      });
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
