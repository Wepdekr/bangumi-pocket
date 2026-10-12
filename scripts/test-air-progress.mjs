import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
await build({
  entryPoints: ["src/air-progress.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "artifacts/test-air-progress.mjs",
});
const {
  airProgress,
  airStatus,
  completeAirEpisodes,
  isAiringAnimation,
  episodeToggleStyle,
} = await import("../artifacts/test-air-progress.mjs");
const episode = (id, sort, airdate) => ({
  id,
  sort,
  airdate,
  name: `第${sort}话`,
  name_cn: "",
  type: 0,
});
const episodes = [
  episode(1, 25, "2026-10-03"),
  episode(2, 26, "2026-10-10"),
  episode(3, 27, "2026-10-17"),
  episode(4, 28, ""),
  episode(5, 29, "2026-02-30"),
];
const summary = airProgress(episodes, "2026-10-12");
assert.equal(summary.aired, 2);
assert.equal(summary.latest.sort, 26);
assert.equal(summary.next.sort, 27);
assert.equal(summary.unknown, 2);
assert.equal(airStatus(episodes[1], "2026-10-10"), "今天放送");
assert.equal(airStatus(episodes[2], "2026-10-12"), "未放送");
assert.equal(airStatus(episodes[4], "2026-10-12"), "日期待定");
assert.equal(airProgress(episodes, "2026-09-01").aired, 0);
assert.equal(airProgress(episodes, "2027-01-01").next, undefined);
assert.equal(isAiringAnimation(episodes, 2, "2026-10-12"), true);
assert.equal(isAiringAnimation(episodes, 2, "2027-01-01"), false);
assert.equal(isAiringAnimation(episodes, 2, "2026-09-01"), false);
assert.equal(isAiringAnimation(episodes, 1, "2026-10-12"), false);
assert.equal(isAiringAnimation([episodes[3]], 2, "2026-10-12"), false);
assert.equal(
  episodeToggleStyle(episodes[0], false, 2, "2026-10-12"),
  "available",
);
assert.equal(
  episodeToggleStyle(episodes[0], false, 2, "2027-01-01"),
  "available",
);
assert.equal(
  episodeToggleStyle(episodes[2], false, 2, "2026-10-12"),
  "upcoming",
);
assert.equal(episodeToggleStyle(episodes[2], true, 2, "2026-10-12"), "checked");
assert.equal(
  episodeToggleStyle(episodes[3], false, 2, "2026-10-12"),
  "upcoming",
);
const offsets = [];
for (const type of [1, 2, 3, 4, 6]) {
  assert.equal(
    episodeToggleStyle(episodes[0], false, type, "2026-10-12"),
    "available",
  );
  assert.equal(
    episodeToggleStyle(episodes[2], false, type, "2026-10-12"),
    "upcoming",
  );
  assert.equal(
    episodeToggleStyle(episodes[3], false, type, "2026-10-12"),
    "upcoming",
  );
  assert.equal(
    episodeToggleStyle(episodes[2], true, type, "2026-10-12"),
    "checked",
  );
}
assert.equal(
  (
    await completeAirEpisodes(
      { data: episodes.slice(0, 2), total: 5 },
      async (offset) => {
        offsets.push(offset);
        return { data: episodes.slice(offset, offset + 2), total: 5 };
      },
    )
  ).length,
  5,
);
assert.deepEqual(offsets, [2, 4]);
await assert.rejects(
  completeAirEpisodes({ data: [episodes[0]], total: 5 }, async () => ({
    data: [],
    total: 5,
  })),
);
await assert.rejects(
  completeAirEpisodes({ data: [episodes[0]], total: 5 }, async () => ({
    data: [episodes[0]],
    total: 5,
  })),
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.clock.install({ time: new Date("2026-10-12T12:00:00+08:00") });
  const browse = JSON.parse(
    await fs.readFile("tests/fixtures/browse.json", "utf8"),
  );
  const subject = browse.data[0];
  const image = "https://lain.bgm.tv/test.png";
  const characters = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    name: i === 4 ? "声の出演" : `角色${i + 1}`,
    role: "",
    images: { medium: image },
    actors: Array.from({ length: i === 4 ? 12 : 1 }, (_, a) => ({
      id: a + 1,
      name: `声优${a + 1}`,
    })),
  }));
  await page.route("https://lain.bgm.tv/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#df6b88"/></svg>',
    }),
  );
  let chapterData = episodes;
  let subjectType = 2;
  await page.route("https://api.bgm.tv/**", (route) => {
    const url = new URL(route.request().url());
    let data = browse;
    if (url.pathname === "/calendar") data = [];
    else if (url.pathname.endsWith("/characters")) data = characters;
    else if (url.pathname === "/v0/episodes") {
      const offset = Number(url.searchParams.get("offset") || 0);
      data = { data: chapterData.slice(offset, offset + 2), total: 5 };
    } else if (url.pathname === `/v0/subjects/${subject.id}`)
      data = { ...subject, type: subjectType };
    return route.fulfill({ json: data });
  });
  await page.goto("http://localhost:5173");
  await page.locator(".hero").click();
  await page
    .locator(".detail-tabs")
    .getByRole("button", { name: "章节", exact: true })
    .click();
  await page.locator(".episode-toggle.available").first().waitFor();
  assert.equal(await page.locator(".air-progress").count(), 0);
  assert.equal(await page.locator(".episode-toggle.available").count(), 2);
  subjectType = 6;
  await page.reload();
  await page.locator(".detail").waitFor();
  await page
    .locator(".detail-tabs")
    .getByRole("button", { name: "章节", exact: true })
    .click();
  await page.locator(".episode-toggle.available").first().waitFor();
  assert.equal(await page.locator(".episode-toggle.available").count(), 2);
  await page.getByRole("button", { name: "加载更多章节", exact: true }).click();
  await page.locator(".episode-toggle.upcoming").first().waitFor();
  assert.equal(await page.locator(".episode-toggle.upcoming").count(), 2);
  chapterData = episodes.map((e) => ({ ...e, airdate: "2025-01-01" }));
  await page.reload();
  await page.locator(".detail").waitFor();
  await page
    .locator(".detail-tabs")
    .getByRole("button", { name: "章节", exact: true })
    .click();
  await page.locator(".episode-toggle.available").first().waitFor();
  assert.equal(await page.locator(".episode-toggle.upcoming").count(), 0);
  assert.equal(await page.locator(".episode-toggle.available").count(), 2);
  await page
    .getByRole("button", { name: "标记看过第25话", exact: true })
    .click();
  await page.locator(".episode-toggle.checked").waitFor();
  await page
    .locator(".detail-tabs")
    .getByRole("button", { name: "角色", exact: true })
    .click();
  await page.locator(".characters button").nth(4).waitFor();
  const cards = page.locator(".characters button");
  for (const index of [3, 4, 5]) {
    const top = await cards.nth(index).locator("img").boundingBox();
    const base = await cards.nth(3).locator("img").boundingBox();
    assert.ok(
      Math.abs(top.y - base.y) < 1,
      "Long actor list must not shift neighboring images",
    );
  }
  assert.match(await cards.nth(4).innerText(), /声优12/);
  await page.locator(".characters").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/mobile-character-alignment.png" });
  console.log(
    "PASS: dated airing status, continuous episode numbering, unknown/invalid dates, complete pagination and long cast alignment.",
  );
} finally {
  await browser.close();
}
