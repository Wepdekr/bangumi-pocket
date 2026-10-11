import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { Subject, User } from "./types";
export type TimelineSubject = Pick<
  Subject,
  "id" | "name" | "type" | "images"
> & { nameCN?: string };
export type FriendEvent = {
  id: number;
  uid: number;
  cat: number;
  type: number;
  createdAt: number;
  replies: number;
  batch?: boolean;
  reactions?: TimelineReaction[];
  user?: User;
  memo: {
    subject?: {
      subject: TimelineSubject;
      collectID?: number;
      rate?: number;
      comment?: string;
    }[];
    progress?: {
      single?: {
        subject: TimelineSubject;
        episode: { sort: number; name?: string; nameCN?: string };
      };
      batch?: {
        subject: TimelineSubject;
        epsUpdate?: number;
        epsTotal?: string;
        volsUpdate?: number;
        volsTotal?: string;
      };
    };
    status?: {
      tsukkomi?: string;
      sign?: string;
      nickname?: { before: string; after: string };
    };
    blog?: { id: number; title: string; summary?: string };
    index?: { title?: string };
  };
};
export type TimelineReaction = {
  value: number;
  users: Pick<User, "id" | "username" | "nickname">[];
};
// Official frontend packages/utils/reactions.ts (legacy LikeCore mapping).
export const reactionImages: Record<number, string> = {
  0: "44",
  79: "40",
  54: "15",
  140: "101",
  62: "23",
  122: "83",
  104: "65",
  80: "41",
  141: "102",
  88: "49",
  85: "46",
  90: "51",
};
export function reactionTarget(event: FriendEvent) {
  if (event.cat === 5)
    return {
      path: `/timeline/${event.id}/like`,
      values: Object.keys(reactionImages).map(Number),
    };
  const item = event.memo.subject?.[0];
  if (
    event.cat === 3 &&
    !event.batch &&
    event.memo.subject?.length === 1 &&
    item?.comment &&
    item.collectID
  )
    return {
      path: `/subjects/-/collects/${item.collectID}/like`,
      values: [0, 104, 54, 140, 122, 90, 88, 80],
    };
  return undefined;
}
export async function setTimelineReaction(
  token: string,
  event: FriendEvent,
  value: number | null,
) {
  const target = reactionTarget(event);
  if (!target || (value !== null && !target.values.includes(value)))
    throw new Error("这条动态暂不支持该表情互动。");
  await friendsRequest(
    token,
    target.path,
    value === null ? "DELETE" : "PUT",
    value === null ? undefined : { value },
  );
}
async function friendsRequest<T>(
  token: string,
  path: string,
  method = "GET",
  body?: { value: number },
): Promise<T> {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
  let data;
  let status;
  try {
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.request({
        url: `https://next.bgm.tv/p1${path}`,
        method,
        data: body,
        headers: {
          ...headers,
          "User-Agent":
            "BangumiPocket/0.7.2 (Android; personal unofficial client)",
        },
        disableRedirects: true,
        connectTimeout: 12000,
        readTimeout: 18000,
      });
      status = response.status;
      data = response.data;
    } else {
      const response = await fetch(`/friends-api${path}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(18000),
      });
      status = response.status;
      if (response.ok) {
        const raw = await response.text();
        data = raw ? JSON.parse(raw) : undefined;
      }
    }
  } catch {
    throw new Error(
      method === "GET"
        ? "动态读取失败，请检查网络后重试。"
        : "表情提交未获确认，请刷新动态确认结果后重试。",
    );
  }
  if (status === 401 || status === 403)
    throw new Error(
      "当前授权无法读取好友动态，请在收藏页更新官方个人令牌后重试。",
    );
  if (status === 429) throw new Error("操作过于频繁，请稍后再试。");
  if (status < 200 || status >= 300)
    throw new Error(
      `动态${method === "GET" ? "读取" : "互动"}失败（${status}），请重试或前往原站。`,
    );
  return data as T;
}
export async function readFriendsTimeline(
  token: string,
  user: User,
  until?: number,
) {
  // The anonymous timeline can silently fall back to the global feed.
  // Verify authentication on friendlist and filter by its authoritative IDs.
  const friends = await friendsRequest<{ friendlist: number[] }>(
    token,
    "/friendlist",
  );
  if (
    !Array.isArray(friends?.friendlist) ||
    friends.friendlist.some((id) => !Number.isInteger(id))
  )
    throw new Error("好友列表格式发生变化，请前往 Bangumi 原站查看。");
  const data = await friendsRequest<FriendEvent[]>(
    token,
    // Official inbox falls back to GLOBAL when there are no friends.
    `${friends.friendlist.length ? "/timeline?mode=friends&" : `/users/${encodeURIComponent(user.username)}/timeline?`}limit=20${until ? `&until=${until}` : ""}`,
  );
  if (
    !Array.isArray(data) ||
    data.some(
      (row) =>
        !row ||
        !Number.isInteger(row.id) ||
        !Number.isInteger(row.uid) ||
        typeof row.createdAt !== "number" ||
        !row.memo ||
        typeof row.memo !== "object",
    )
  )
    throw new Error("动态资料格式发生变化，请前往 Bangumi 原站查看。");
  const rows = until ? data.filter((row) => row.id < until) : data;
  const friendIDs = new Set(friends.friendlist);
  friendIDs.add(user.id);
  const events = rows.filter((row) => friendIDs.has(row.uid));
  if (rows.length && !events.length)
    throw new Error("接口未返回好友范围的动态，请刷新或前往原站查看。");
  return {
    events,
    cursor: rows.length ? Math.min(...rows.map((row) => row.id)) : undefined,
    hasMore: rows.length > 0,
  };
}
