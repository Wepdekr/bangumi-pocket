import { chromium } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
await build({
  entryPoints: ["src/text.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "artifacts/text-test-module.mjs",
});
const { displayText } = await import("../artifacts/text-test-module.mjs");
assert.equal(
  displayText("A &amp; B &quot;C&quot; &apos;D&apos; &copy; &#38; &#x1F600;"),
  "A & B \"C\" 'D' © & 😀",
);
assert.equal(
  displayText("&amp;amp; &unknown; &notebook &amp"),
  "&amp; &unknown; &notebook &amp",
);
assert.equal(displayText("中文＆普通&文字"), "中文＆普通&文字");
assert.equal(displayText(undefined), "");
const attack = '&lt;img src=x onerror="window.textAttack=1"&gt;';
assert.equal(displayText(attack), '<img src=x onerror="window.textAttack=1">');
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
});
const raw = {
  id: 701782,
  type: 2,
  name: "Welsh &amp; Shedar",
  name_cn: "苍蓝传承 威尔什&amp;榭达",
  summary: "简介 &quot;故事&quot; " + attack,
  tags: [{ name: "奇幻 &amp; 冒险", count: 1 }],
  infobox: [
    { key: "别名 &amp; 原名", value: "A &copy; B" },
    { key: "作者", value: [{ v: "甲 &#x26; 乙" }] },
  ],
  rating: { score: 5.4, total: 10 },
  eps: 3,
};
const cacheCalendar = [
  { weekday: { id: 1, cn: "星期一", en: "Monday" }, items: [raw] },
];
await page.addInitScript(
  ({ raw, cacheCalendar }) => {
    localStorage.setItem(
      "CapacitorStorage.library-v1",
      JSON.stringify({
        [raw.id]: { subject: raw, status: "wish", watched: [], updated: 1 },
      }),
    );
    localStorage.setItem(
      "CapacitorStorage.cache:guest:/calendar:null",
      JSON.stringify({ time: Date.now(), data: cacheCalendar }),
    );
  },
  { raw, cacheCalendar },
);
await page.route("https://api.bgm.tv/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/calendar") return route.abort(); // Exercise OLD raw cache fallback.
  const json =
    path === "/v0/subjects" || path === "/v0/search/subjects"
      ? { data: [raw], total: 1 }
      : path === "/v0/episodes"
        ? {
            data: [
              {
                id: 1,
                sort: 1,
                type: 0,
                name: "第一话 &quot;约定&quot;",
                name_cn: "",
              },
            ],
            total: 1,
          }
        : path.endsWith("/characters")
          ? [
              {
                id: 1,
                name: "角色 &amp; 同伴",
                role: "配角 &#39;朋友&#39;",
                actors: [{ id: 2, name: "演员 &copy;" }],
              },
            ]
          : raw;
  return route.fulfill({ json });
});
await page.route("**/community-api/**", (route) =>
  route.fulfill({
    json: {
      total: 1,
      data: new URL(route.request().url()).pathname.endsWith("/reviews")
        ? [
            {
              id: 2,
              user: { id: 2, username: "u", nickname: "作者 &amp; 读者" },
              entry: {
                id: 3,
                title: "标题 &quot;感想&quot;",
                summary: attack,
                replies: 0,
                createdAt: 1,
              },
            },
          ]
        : [
            {
              id: 1,
              user: { id: 2, username: "u", nickname: "作者 &amp; 读者" },
              rate: 7,
              type: 2,
              comment: "短评 &amp; " + attack,
              updatedAt: 1,
            },
          ],
    },
  }),
);
try {
  await page.route("**/community-api/subjects/*/characters", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.goto("http://localhost:5173");
  await page
    .getByRole("heading", { name: "苍蓝传承 威尔什&榭达", exact: true })
    .first()
    .waitFor();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "放送", exact: true })
    .click();
  await page.locator(".week-tabs button").first().click();
  await page.locator(".subject-row h3").waitFor();
  assert.equal(
    await page.locator(".subject-row h3").innerText(),
    "苍蓝传承 威尔什&榭达",
  );
  assert.equal(
    await page.locator(".original-name").innerText(),
    "Welsh & Shedar",
  );
  await page.locator(".subject-row").click();
  await page.locator(".detail h1").waitFor();
  assert.equal(
    await page.locator(".detail h1").innerText(),
    "苍蓝传承 威尔什&榭达",
  );
  await page.getByText("奇幻 & 冒险", { exact: true }).waitFor();
  await page.getByText("A © B", { exact: true }).waitFor();
  await page.getByText("甲 & 乙", { exact: true }).waitFor();
  assert.match(await page.locator(".synopsis").innerText(), /简介 "故事" <img/);
  assert.equal(await page.locator(".synopsis img").count(), 0);
  await page.getByRole("button", { name: "章节", exact: true }).click();
  await page.getByText('第一话 "约定"', { exact: true }).waitFor();
  await page.getByRole("button", { name: "角色", exact: true }).click();
  await page.getByText("角色 & 同伴", { exact: true }).waitFor();
  await page.getByText("演员 ©", { exact: true }).waitFor();
  await page.getByRole("button", { name: "评论", exact: true }).click();
  await page.getByText("作者 & 读者", { exact: true }).waitFor();
  assert.match(
    await page.locator(".community-content").innerText(),
    /^短评 & <img/,
  );
  assert.equal(await page.locator(".community-content img").count(), 0);
  await page.getByRole("button", { name: "长评", exact: true }).click();
  await page.getByText('标题 "感想"', { exact: true }).waitFor();
  assert.equal(await page.locator(".community-content img").count(), 0);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  await page
    .locator("main .chips")
    .getByRole("button", { name: "全部", exact: true })
    .click();
  assert.equal(
    await page.locator(".subject-row h3").innerText(),
    "苍蓝传承 威尔什&榭达",
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("CapacitorStorage.library-v1")),
  );
  assert.equal(
    stored[raw.id].subject.name,
    raw.name,
    "Rendering must not rewrite raw cached data",
  );
  assert.equal(await page.evaluate(() => window.textAttack), undefined);
  console.log(
    "PASS: full entities, single-pass decoding, malformed literals, old calendar/library caches, titles, summaries, infobox, chapters, characters, comments/reviews and safe text rendering.",
  );
} finally {
  await browser.close();
}
