import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type {
  Subject,
  Page,
  Episode,
  CalendarDay,
  Character,
  Saved,
  Session,
} from "./types";
const BASE = "https://api.bgm.tv";
const CACHE_TTL = 15 * 60 * 1000;
let publicAccess: { token: string; id: number } | null = null;
export function setPublicAccount(session: Session | null) {
  publicAccess = session ? { token: session.token, id: session.user.id } : null;
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const access = publicAccess;
  const key = `cache:${access?.id ?? "guest"}:${path}:${JSON.stringify(body ?? null)}`;
  try {
    let data: T;
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.request({
        url: BASE + path,
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "BangumiPocket/0.9.0 (Android; personal unofficial client)",
          ...(access ? { Authorization: `Bearer ${access.token}` } : {}),
        },
        data: body,
        connectTimeout: 12000,
        readTimeout: 18000,
      });
      if (res.status < 200 || res.status >= 300)
        throw new Error(`服务暂时不可用（${res.status}）`);
      data = res.data;
    } else {
      const res = await fetch(BASE + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(access ? { Authorization: `Bearer ${access.token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(18000),
      });
      if (!res.ok) throw new Error(`服务暂时不可用（${res.status}）`);
      data = await res.json();
    }
    try {
      await Preferences.set({
        key,
        value: JSON.stringify({ time: Date.now(), data }),
      });
    } catch {
      /* Storage may be full; network data is still usable. */
    }
    return data;
  } catch (error) {
    const cached = await Preferences.get({ key });
    if (cached.value) {
      const value = JSON.parse(cached.value);
      if (Date.now() - value.time < CACHE_TTL) return value.data;
    }
    throw error;
  }
}
export const api = {
  browse: (type: number, sort = "rank", offset = 0) =>
    request<Page>(
      `/v0/subjects?type=${type}&sort=${sort}&limit=24&offset=${offset}`,
    ),
  search: (keyword: string, type: number, offset = 0) =>
    request<Page>(`/v0/search/subjects?limit=24&offset=${offset}`, {
      keyword,
      sort: "match",
      filter: { ...(type ? { type: [type] } : {}), nsfw: false },
    }),
  calendar: () => request<CalendarDay[]>("/calendar"),
  subject: (id: number) => request<Subject>(`/v0/subjects/${id}`),
  episodes: (id: number, offset = 0) =>
    request<{ data: Episode[]; total: number }>(
      `/v0/episodes?subject_id=${id}&type=0&limit=100&offset=${offset}`,
    ),
  characters: (id: number) =>
    request<Character[]>(`/v0/subjects/${id}/characters`),
};
export async function readLibrary(): Promise<Record<number, Saved>> {
  const { value } = await Preferences.get({ key: "library-v1" });
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
export const writeLibrary = (library: Record<number, Saved>) =>
  Preferences.set({ key: "library-v1", value: JSON.stringify(library) });
