import type { Episode } from "./types";

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}
export function airStatus(episode: Episode, today = localDate()) {
  if (!validDate(episode.airdate)) return "日期待定";
  if (episode.airdate === today) return "今天放送";
  return episode.airdate < today ? "已放送" : "未放送";
}
export function episodeToggleStyle(
  episode: Episode,
  watched: boolean,
  type?: number,
  today = localDate(),
) {
  if (watched) return "checked";
  const status = airStatus(episode, today);
  return type === 2 && (status === "已放送" || status === "今天放送")
    ? "available"
    : "upcoming";
}
export function airProgress(episodes: Episode[], today = localDate()) {
  const dated = episodes.filter((e) => validDate(e.airdate));
  const aired = dated.filter((e) => e.airdate <= today);
  const latest = aired.slice().sort((a, b) => b.sort - a.sort)[0];
  const next = dated
    .filter((e) => e.airdate > today)
    .sort((a, b) => a.airdate.localeCompare(b.airdate) || a.sort - b.sort)[0];
  return {
    aired: aired.length,
    unknown: episodes.length - dated.length,
    latest,
    next,
  };
}
export function isAiringAnimation(
  episodes: Episode[],
  type?: number,
  today = localDate(),
) {
  const progress = airProgress(episodes, today);
  return type === 2 && progress.aired > 0 && Boolean(progress.next);
}
export async function completeAirEpisodes(
  initial: { data: Episode[]; total: number },
  load: (offset: number) => Promise<{ data: Episode[]; total: number }>,
) {
  const episodes = [...initial.data];
  const ids = new Set(episodes.map((e) => e.id));
  if (ids.size !== episodes.length) throw new Error("章节数据重复，请重试。");
  while (episodes.length < initial.total) {
    const page = await load(episodes.length);
    if (
      page.total !== initial.total ||
      !page.data.length ||
      page.data.some((e) => ids.has(e.id)) ||
      new Set(page.data.map((e) => e.id)).size !== page.data.length
    ) {
      throw new Error("章节资料尚未完整，请重试。");
    }
    page.data.forEach((e) => ids.add(e.id));
    episodes.push(...page.data);
  }
  if (episodes.length !== initial.total)
    throw new Error("章节数量发生变化，请重试。");
  return episodes;
}
