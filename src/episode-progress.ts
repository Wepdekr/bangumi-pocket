import type { Episode } from "./types";

export type WatchThrough = { episodeId: number; episodeIds: number[] };

// Resolve real chapter IDs across all pages before changing any saved progress.
export async function planWatchedThrough(
  target: Episode,
  watched: number[],
  loaded: Episode[],
  total: number,
  load: (offset: number) => Promise<{ data: Episode[]; total: number }>,
) {
  const chapters = [...loaded];
  if (!Number.isInteger(total) || total <= 0 || chapters.length > total)
    throw new Error("章节资料异常，请重新加载后重试。");
  while (chapters.length < total) {
    const page = await load(chapters.length);
    if (
      !page.data.length ||
      page.total !== total ||
      chapters.length + page.data.length > total
    )
      throw new Error("章节资料未完整加载，请重试。原有进度未修改。");
    chapters.push(...page.data);
  }
  if (
    new Set(chapters.map((e) => e.id)).size !== total ||
    !chapters.some((e) => e.id === target.id)
  )
    throw new Error("章节资料异常，请重新加载后重试。");
  if (target.type !== 0) throw new Error("只能批量标记正篇章节。");
  const episodeIds = chapters
    .filter((e) => e.type === 0 && e.sort <= target.sort)
    .map((e) => e.id);
  return {
    watched: [...new Set([...watched, ...episodeIds])],
    through: { episodeId: target.id, episodeIds },
  };
}

export async function watchedThrough(
  ...args: Parameters<typeof planWatchedThrough>
) {
  return (await planWatchedThrough(...args)).watched;
}
