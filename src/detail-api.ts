import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { Character, RelatedSubject, Subject } from "./types";

async function publicDetail(path: string): Promise<unknown> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url: `https://next.bgm.tv/p1${path}`,
      headers: {
        "User-Agent":
          "BangumiPocket/0.11.0 (Android; personal unofficial client)",
      },
      connectTimeout: 12000,
      readTimeout: 18000,
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error("详情资料暂时无法读取");
    return response.data;
  }
  const response = await fetch(`/community-api${path}`, {
    credentials: "omit",
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error("详情资料暂时无法读取");
  return response.json();
}
type CharacterRow = {
  character: { id: number; name: string; images?: { medium: string } };
  type: number;
  order: number;
  casts?: { person: { id: number; name: string } }[];
};
async function publicList<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  const pages = new Set<string>();
  let total: number | undefined;
  do {
    const result = (await publicDetail(
      `${path}?limit=100&offset=${rows.length}`,
    )) as { data?: T[]; total?: number } | T[];
    if (Array.isArray(result)) return result;
    if (
      !result ||
      !Array.isArray(result.data) ||
      !Number.isInteger(result.total) ||
      result.total! < 0
    )
      throw new Error("详情资料不完整");
    if (total !== undefined && total !== result.total)
      throw new Error("详情资料已更新，请重试");
    total = result.total!;
    if (!total && !result.data.length) return [];
    const fingerprint = JSON.stringify(result.data);
    if (!result.data.length || pages.has(fingerprint))
      throw new Error("详情资料分页不完整");
    pages.add(fingerprint);
    rows.push(...result.data);
    if (rows.length > total) throw new Error("详情资料数量不一致");
  } while (rows.length < total);
  return rows;
}
const roles: Record<number, string> = {
  1: "主角",
  2: "配角",
  3: "客串",
  4: "闲角",
};
export function orderedCharacters(rows: CharacterRow[]): Character[] {
  return [...rows]
    .sort((a, b) => a.type - b.type || a.order - b.order)
    .map((row) => ({
      id: row.character.id,
      name: row.character.name,
      images: row.character.images,
      relation: roles[row.type] || "其他",
      order: row.order,
      actors: row.casts?.map((cast) => ({
        id: cast.person.id,
        name: cast.person.name,
      })),
    }));
}
export async function subjectCharacters(
  id: number,
  fallback: () => Promise<Character[]>,
): Promise<Character[]> {
  try {
    const rows = await publicList<CharacterRow>(`/subjects/${id}/characters`);
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          !row.character?.id ||
          typeof row.character.name !== "string" ||
          !Number.isFinite(row.type) ||
          !Number.isFinite(row.order),
      )
    )
      throw new Error("角色资料不完整");
    return orderedCharacters(rows);
  } catch {
    const rank: Record<string, number> = { 主角: 1, 配角: 2, 客串: 3, 闲角: 4 };
    return [...(await fallback())].sort(
      (a, b) =>
        (rank[a.relation || a.role || ""] || 5) -
          (rank[b.relation || b.role || ""] || 5) ||
        (a.order ?? 0) - (b.order ?? 0),
    );
  }
}
export async function subjectRelations(
  id: number,
  fallback: () => Promise<RelatedSubject[]>,
): Promise<RelatedSubject[]> {
  try {
    const rows = await publicList<{
      subject: Subject & { nameCN?: string };
      relation: { cn: string };
      order?: number;
    }>(`/subjects/${id}/relations`);
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          !row.subject?.id ||
          typeof row.subject.name !== "string" ||
          typeof row.relation?.cn !== "string",
      )
    )
      throw new Error("关联资料不完整");
    return rows.map((row) => ({
      ...row.subject,
      name_cn: row.subject.nameCN,
      relation: row.relation.cn,
      order: row.order,
    }));
  } catch {
    const rows = await fallback();
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row?.id || typeof row.name !== "string")
    )
      throw new Error("关联资料不完整");
    return rows;
  }
}
