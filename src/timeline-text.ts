import type { FriendEvent } from "./friends-api";

// Timeline type codes differ from the v0 collection-status codes.
// https://github.com/bangumi/dev-docs/blob/master/Timeline.md
export function collectionAction(type: number): string {
  const actions: Record<number, string> = {
    1: "想读",
    2: "想看",
    3: "想听",
    4: "想玩",
    5: "读过",
    6: "看过",
    7: "听过",
    8: "玩过",
    9: "在读",
    10: "在看",
    11: "在听",
    12: "在玩",
    13: "搁置",
    14: "抛弃",
  };
  return actions[type] ? `标记为${actions[type]}` : "更新了收藏状态";
}

function total(value?: string): string | undefined {
  return value && /^\d+$/.test(String(value)) && Number(value) > 0
    ? String(value)
    : undefined;
}

export function progressAction(event: FriendEvent): string {
  const progress = event.memo.progress;
  if (progress?.batch)
    return progress.batch.subject.type === 1 ? "读过" : "完成了";
  if (progress?.single)
    return (
      ({ 1: "想看", 2: "看过", 3: "抛弃" } as Record<number, string>)[
        event.type
      ] || "更新了章节进度"
    );
  return "更新了章节进度";
}

export function batchProgressText(
  batch: NonNullable<FriendEvent["memo"]["progress"]>["batch"],
): string {
  if (!batch) return "更新了作品进度";
  if (batch.subject.type !== 1 && batch.epsUpdate !== undefined) {
    const count = total(batch.epsTotal);
    return count
      ? `${batch.epsUpdate} of ${count} 话`
      : `${batch.epsUpdate} 话`;
  }
  const parts: string[] = [];
  if (batch.epsUpdate !== undefined) {
    const count = total(batch.epsTotal);
    parts.push(`章节进度：${batch.epsUpdate}${count ? ` / ${count}` : ""}`);
  }
  // Volumes apply to books only. Non-book events also contain legacy
  // default values such as volsUpdate=0 and volsTotal="??".
  if (batch.subject.type === 1 && batch.volsUpdate !== undefined) {
    const count = total(batch.volsTotal);
    if (batch.volsUpdate > 0 || count) {
      parts.push(`卷数：${batch.volsUpdate}${count ? ` / ${count}` : ""}`);
    }
  }
  return parts.join(" · ") || "更新了作品进度";
}
