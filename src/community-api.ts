import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { User } from "./types";

export type SubjectComment = {
  id: number;
  user: User;
  type: number;
  rate: number;
  comment: string;
  updatedAt: number;
};
export type SubjectReview = {
  id: number;
  user: User;
  entry: {
    id: number;
    title: string;
    summary: string;
    replies: number;
    createdAt: number;
  };
};
export type CommunityKind = "comments" | "reviews";
export type CommunityItem = SubjectComment | SubjectReview;
export async function communityPage(
  id: number,
  kind: CommunityKind,
  offset = 0,
): Promise<{ data: CommunityItem[]; total: number }> {
  const path = `/subjects/${id}/${kind}?limit=20&offset=${offset}`;
  // Public reading on the new-site API is separate from the account API.
  // Never send the user's api.bgm.tv token to this host.
  let data;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: `https://next.bgm.tv/p1${path}`,
      method: "GET",
      headers: {
        "User-Agent":
          "BangumiPocket/0.12.0 (Android; personal unofficial client)",
      },
      connectTimeout: 12000,
      readTimeout: 18000,
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        `评论暂时无法读取（${response.status}），请重试或前往原站。`,
      );
    data = response.data;
  } else {
    const response = await fetch(`/community-api${path}`, {
      credentials: "omit",
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok)
      throw new Error(
        `评论暂时无法读取（${response.status}），请重试或前往原站。`,
      );
    data = await response.json();
  }
  if (
    !data ||
    !Array.isArray(data.data) ||
    !Number.isInteger(data.total) ||
    data.total < 0 ||
    data.data.some(
      (row: CommunityItem) =>
        !row ||
        !Number.isInteger(row.id) ||
        !row.user ||
        (kind === "comments"
          ? typeof (row as SubjectComment).comment !== "string"
          : !Number.isInteger((row as SubjectReview).entry?.id)),
    )
  )
    throw new Error("评论资料格式发生变化，请前往 Bangumi 原站阅读。");
  if (!data.data.length && offset < data.total)
    throw new Error("评论列表未完整返回，请重试或前往原站。");
  return data;
}
