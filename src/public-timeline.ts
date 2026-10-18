import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { FriendEvent, TimelineSubject } from "./friends-api";
import type { User } from "./types";
import { invalidProgressCount } from "./timeline-text";

const text = (element: Element | null) =>
  element?.textContent?.replace(/\s+/g, " ").trim() || "";

function subjectId(href: string | null) {
  if (!href) return undefined;
  const url = safeUrl(href);
  if (!url) return;
  if (!["bgm.tv", "bangumi.tv", "chii.in"].includes(url.hostname)) return;
  const match = /^\/subject\/(\d+)$/.exec(url.pathname);
  return match ? Number(match[1]) : undefined;
}

function safeUrl(href: string) {
  try {
    return new URL(href, "https://bgm.tv");
  } catch {
    return undefined;
  }
}

// Read the public original-site page when the new-site index omits recent rows.
// Template contents are inert; no scripts, handlers or remote documents execute.
export function parsePublicTimeline(html: string, user: User): FriendEvent[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const doc = template.content;
  const timeline = doc.querySelector("#timeline");
  const owner = doc.querySelector("h1 a[href^='/user/']")?.getAttribute("href");
  if (!timeline || owner !== `/user/${user.username}`)
    throw new Error("原站时间线暂时无法确认，请稍后刷新。");
  const events: FriendEvent[] = [];
  for (const row of timeline.querySelectorAll("li[id^='tml_']")) {
    const id = Number(/^tml_(\d+)$/.exec(row.id)?.[1]);
    const stamp = row.querySelector(".date [title]")?.getAttribute("title");
    // Original-site dates are displayed in UTC+8, independently of device zone.
    const createdAt =
      stamp && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(stamp)
        ? Date.parse(stamp.replace(" ", "T") + ":00+08:00") / 1000
        : NaN;
    const info = row.querySelector(".info_full, .info");
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !Number.isFinite(createdAt) ||
      !info
    )
      continue;
    const summary = info.cloneNode(true) as Element;
    summary
      .querySelectorAll(
        ".card, .collectInfo, .post_actions, .likes_grid, .likes_info, script, style, iframe, form, object, embed",
      )
      .forEach((node) => node.remove());
    const description = text(summary);
    if (!description) continue;
    const progress = /\s(\d+) of (\d+) 话$/.exec(description);
    const invalidProgress = Boolean(
      /^完成了\s/.test(description) &&
      progress &&
      [...summary.querySelectorAll("a[href]")].some((link) =>
        subjectId(link.getAttribute("href")),
      ) &&
      invalidProgressCount(Number(progress[1]), progress[2]),
    );
    const subjects = new Map<
      number,
      NonNullable<FriendEvent["memo"]["subject"]>[number]
    >();
    for (const card of info.querySelectorAll(".card")) {
      const link = card.querySelector(".title a");
      const subjectID = subjectId(link?.getAttribute("href") || null);
      if (!subjectID || !link) continue;
      const name = link.cloneNode(true) as Element;
      name.querySelectorAll("small").forEach((node) => node.remove());
      const cover = card.querySelector("img")?.getAttribute("src");
      const coverUrl = cover ? safeUrl(cover) : undefined;
      const subject: TimelineSubject = {
        id: subjectID,
        name: text(name),
        images:
          coverUrl?.protocol === "https:" && coverUrl.hostname === "lain.bgm.tv"
            ? { medium: coverUrl.href }
            : undefined,
      };
      subjects.set(subjectID, { subject });
    }
    if (subjects.size === 1) {
      const item = [...subjects.values()][0];
      const comment = info.querySelector(".collectInfo .comment");
      if (comment) {
        item.comment = text(comment);
        const stars = comment.querySelector(".starlight")?.className || "";
        const rate = Number(/\bstars(10|[1-9])\b/.exec(stars)?.[1]);
        if (rate >= 1 && rate <= 10) item.rate = rate;
      }
    }
    events.push({
      id,
      uid: user.id,
      user,
      cat: 0,
      type: 0,
      createdAt,
      replies: 0,
      webSummary: description,
      invalidProgress,
      memo: { subject: [...subjects.values()] },
    });
  }
  if (timeline.querySelector("li[id^='tml_']") && !events.length)
    throw new Error("原站时间线格式发生变化，请稍后刷新。");
  return events;
}

export function mergePublicTimeline(
  events: FriendEvent[],
  original: FriendEvent[],
  userId: number,
  boundary: number,
): FriendEvent[] {
  // Source names are metadata; never use them to decide which rows to display.
  const originals = new Map(
    original.filter((row) => row.uid === userId).map((row) => [row.id, row]),
  );
  const merged = new Map(
    events.map((event) => {
      const current = originals.get(event.id);
      if (
        event.uid !== userId ||
        !current?.memo.subject?.length ||
        ![3, 4].includes(event.cat)
      )
        return [event.id, event] as const;
      // The server can merge repeated actions into an existing ID. Read its current
      // public text too, keeping API interaction IDs and reactions on the same row.
      const subjects = current.memo.subject.map((item) => ({
        ...item,
        collectID: event.memo.subject?.find(
          (old) => old.subject.id === item.subject.id,
        )?.collectID,
      }));
      return [
        event.id,
        {
          ...event,
          webSummary: current.webSummary,
          invalidProgress: current.invalidProgress,
          batch: event.batch || subjects.length > 1,
          memo: { subject: subjects },
        },
      ] as const;
    }),
  );
  for (const event of originals.values()) {
    if (!merged.has(event.id) && event.id >= boundary)
      merged.set(event.id, event);
  }
  return [...merged.values()].sort((a, b) => b.id - a.id);
}

export async function readPublicTimeline(user: User): Promise<FriendEvent[]> {
  const path = `/user/${encodeURIComponent(user.username)}/timeline`;
  let html: string;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: "https://bgm.tv" + path,
      method: "GET",
      headers: {
        "User-Agent":
          "BangumiPocket/0.12.1 (Android; personal unofficial client)",
        Cookie: "",
      },
      responseType: "text",
      disableRedirects: true,
      connectTimeout: 12000,
      readTimeout: 18000,
    });
    if (response.status !== 200 || typeof response.data !== "string")
      throw new Error("原站时间线暂时无法读取。");
    html = response.data;
  } else {
    const response = await fetch("/public-timeline" + path, {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) throw new Error("原站时间线暂时无法读取。");
    html = await response.text();
  }
  return parsePublicTimeline(html, user);
}
