import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const browse = JSON.parse(
  await fs.readFile("tests/fixtures/browse.json", "utf8"),
);
const subject = browse.data[0];
let fail = false;
let empty = false;
const errors = [];
const calls = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("https://api.bgm.tv/**", (route) => {
  const url = new URL(route.request().url());
  return route.fulfill({
    json:
      url.pathname === "/calendar"
        ? []
        : url.pathname === "/v0/subjects"
          ? browse
          : url.pathname.endsWith("/characters")
            ? []
            : url.pathname === "/v0/episodes"
              ? { total: 0, data: [] }
              : subject,
  });
});
await page.route("**/community-api/**", (route) => {
  const url = new URL(route.request().url());
  assert.equal(route.request().headers().authorization, undefined);
  assert.equal(route.request().headers().cookie, undefined);
  if (
    url.pathname.endsWith("/characters") ||
    url.pathname.endsWith("/relations")
  )
    return route.fulfill({ json: { data: [], total: 0 } });
  calls.push(url.pathname);
  if (fail) return route.fulfill({ status: 503, json: {} });
  if (empty) return route.fulfill({ json: { total: 0, data: [] } });
  const user = { id: 1, username: "reader", nickname: "读者" };
  const offset = Number(url.searchParams.get("offset"));
  return route.fulfill({
    json: url.pathname.endsWith("/reviews")
      ? {
          total: 1,
          data: [
            {
              id: 88,
              user,
              entry: {
                id: 999,
                title: "一篇长评",
                summary: "长评摘要",
                replies: 3,
                createdAt: 1700000000,
              },
            },
          ],
        }
      : {
          total: 2,
          data: offset
            ? [
                {
                  id: 2,
                  user,
                  type: 2,
                  rate: 0,
                  comment: "第二页短评",
                  updatedAt: 1700000000,
                },
              ]
            : [
                {
                  id: 1,
                  user,
                  type: 2,
                  rate: 8,
                  comment: "第一条短评\n<script>unsafe</script>",
                  updatedAt: 1700000000,
                },
              ],
        },
  });
});
try {
  await page.goto("http://localhost:5173");
  await page.locator(".hero h2").waitFor();
  await page.locator(".hero").click();
  assert.equal(
    calls.length,
    0,
    "Comments must load only when the tab is opened",
  );
  await page.getByRole("button", { name: "评论", exact: true }).click();
  await page.getByText("第一条短评", { exact: false }).waitFor();
  assert.equal(await page.locator(".community-content script").count(), 0);
  await page.getByRole("button", { name: "加载更多短评", exact: true }).click();
  await page.getByText("第二页短评", { exact: true }).waitFor();
  assert.equal(await page.locator(".community-card").count(), 2);
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".community-tab")
    .evaluate((element) => element.scrollIntoView());
  await page.screenshot({ path: "artifacts/mobile-comments.png" });
  await page.getByRole("button", { name: "长评", exact: true }).click();
  await page.getByText("一篇长评", { exact: true }).waitFor();
  await page.context().route("https://bgm.tv/blog/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Test review</title>",
    }),
  );
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: /阅读全文/ }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://bgm.tv/blog/999");
  assert.equal(new URL(popup.url()).pathname, "/blog/999");
  await popup.close();
  fail = true;
  await page.getByRole("button", { name: "刷新评论", exact: true }).click();
  await page.getByRole("alert").waitFor();
  fail = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("一篇长评", { exact: true }).waitFor();
  empty = true;
  await page.getByRole("button", { name: "刷新评论", exact: true }).click();
  await page.getByText("暂时还没有长评。", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: lazy loading, short comments, pagination, safe text rendering, long reviews, narrow layout and retry.",
  );
} finally {
  await browser.close();
}
