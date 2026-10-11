import type { Episode } from "./types";

// Resolve real chapter IDs across all pages before changing any saved progress.
export async function watchedThrough(
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
  return [
    ...new Set([
      ...watched,
      ...chapters
        .filter((e) => e.type === 0 && e.sort <= target.sort)
        .map((e) => e.id),
    ]),
  ];
}
