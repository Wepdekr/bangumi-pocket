import { displayText } from "./text";
import type { RelatedSubject } from "./types";

// Story continuity comes first, followed by adaptations and supporting media.
const priority = [
  "前传",
  "续集",
  "总集篇",
  "全集",
  "番外篇",
  "角色出演",
  "衍生",
  "联动",
  "改编",
  "不同演绎",
  "相同世界观",
  "书籍",
  "动画",
  "三次元",
  "游戏",
  "音乐",
  "原声集",
  "角色歌",
  "片头曲",
  "片尾曲",
  "插入歌",
];
export function relationGroups(rows: RelatedSubject[]) {
  const groups = new Map<string, RelatedSubject[]>();
  for (const row of rows) {
    const label = displayText(row.relation).trim() || "其他";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(row);
  }
  const rank = (label: string) => {
    const index = priority.indexOf(label);
    return index >= 0
      ? index
      : label === "其他"
        ? priority.length + 1
        : priority.length;
  };
  return [...groups].sort(([a], [b]) => rank(a) - rank(b));
}
