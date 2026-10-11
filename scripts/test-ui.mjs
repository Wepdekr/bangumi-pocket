import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.TEST_BROWSER_CHANNEL || "chrome",
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const browse = JSON.parse(
  await fs.readFile("tests/fixtures/browse.json", "utf8"),
);
const calendar = JSON.parse(
  await fs.readFile("tests/fixtures/calendar.json", "utf8"),
);
const featured = browse.data[0];
await page.route("https://api.bgm.tv/**", async (route) => {
  const url = new URL(route.request().url());
  let data;
  if (url.pathname === "/calendar") data = calendar;
  else if (url.pathname === "/v0/subjects") data = browse;
  else if (url.pathname === "/v0/search/subjects")
    data = { ...browse, total: 1, data: [featured] };
  else if (url.pathname === `/v0/subjects/${featured.id}`) data = featured;
  else if (url.pathname.endsWith("/characters")) data = [];
  else if (url.pathname === "/v0/episodes")
    data = {
      total: 2,
      data: [
        {
          id: 1001,
          sort: 1,
          name_cn: "第一话",
          name: "",
          airdate: "2008-10-02",
          type: 0,
        },
        {
          id: 1002,
          sort: 2,
          name_cn: "第二话",
          name: "",
          airdate: "2008-10-09",
          type: 0,
        },
      ],
    };
  else return route.abort();
  await route.fulfill({
    json: data,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
});
await page.route("http://lain.bgm.tv/**", (route) => route.abort());
await page.route("https://lain.bgm.tv/**", (route) =>
  route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#df6b88"/></svg>',
  }),
);
await fs.mkdir("artifacts", { recursive: true });
try {
  await page.goto("http://localhost:5173");
  await page.locator(".hero h2").waitFor();
  await page.screenshot({ path: "artifacts/mobile-home.png" });
  const initialCategory = await page.locator(".category-bar").boundingBox();
  assert.ok(
    initialCategory.y > 100,
    "Category bar must retain its original home position",
  );
  for (const position of [initialCategory.y + 50, initialCategory.y + 400]) {
    await page.evaluate((position) => window.scrollTo(0, position), position);
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector(".category-bar").getBoundingClientRect().top,
        ) <= 1,
    );
  }
  await page.screenshot({ path: "artifacts/mobile-sticky-categories.png" });
  await page
    .locator(".category-tabs")
    .getByRole("button", { name: "书籍", exact: true })
    .click();
  await page
    .locator(".category-tabs .active")
    .filter({ hasText: "书籍" })
    .waitFor();
  assert.ok(
    Math.abs((await page.locator(".category-bar").boundingBox()).y) <= 1,
  );
  await page
    .locator(".category-tabs")
    .getByRole("button", { name: "动画", exact: true })
    .click();
  await page.locator(".hero h2").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(
    () =>
      document.querySelector(".category-bar").getBoundingClientRect().top > 100,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile page overflows horizontally",
  );
  await page.locator(".hero").click();
  await page.locator(".detail-action").waitFor();
  // A transformed scroll container must not anchor the fixed action bar.
  for (const width of [390, 320, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const fraction of [0, 0.5, 1]) {
      await page.locator(".detail").evaluate((element, fraction) => {
        element.scrollTop =
          (element.scrollHeight - element.clientHeight) * fraction;
      }, fraction);
      const bounds = await page.locator(".detail-action").boundingBox();
      assert.ok(
        bounds && Math.abs(bounds.y + bounds.height - 844) <= 1,
        `Detail actions must stay at viewport bottom: width=${width}, scroll=${fraction}, bounds=${JSON.stringify(bounds)}, viewport=${JSON.stringify(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))}`,
      );
      assert.ok(
        Math.abs(bounds.x - (width - Math.min(width, 760)) / 2) <= 1,
        "Detail actions must align with the centered detail panel",
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".detail").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole("button", { name: "加入收藏", exact: true }).click();
  const picker = page.getByRole("group", { name: "选择收藏状态", exact: true });
  await picker.waitFor();
  assert.equal(await picker.getByRole("button").count(), 6);
  await page
    .getByRole("button", { name: "取消选择收藏状态", exact: true })
    .click();
  await page.getByRole("button", { name: "加入收藏", exact: true }).waitFor();
  await page.getByRole("button", { name: "加入收藏", exact: true }).click();
  await picker.getByRole("button", { name: "看过", exact: true }).click();
  await page
    .getByRole("dialog", { name: "看完了，留下你的感想", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "取消评价", exact: true }).click();
  await page.getByRole("button", { name: "加入收藏", exact: true }).waitFor();
  await page.getByRole("button", { name: "加入收藏", exact: true }).click();
  await picker.getByRole("button", { name: "搁置", exact: true }).click();
  await page
    .getByRole("dialog", { name: "标记搁置，留下你的感想", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "暂不评价，标记搁置", exact: true })
    .click();
  await page.getByRole("button", { name: "修改收藏", exact: true }).waitFor();
  assert.equal(
    await page.locator(".detail-action > div > strong").innerText(),
    "搁置",
  );
  await page.getByRole("button", { name: "修改收藏", exact: true }).click();
  await picker.getByRole("button", { name: "抛弃", exact: true }).click();
  const droppedReview = page.getByRole("dialog", {
    name: "标记抛弃，留下你的感想",
    exact: true,
  });
  await droppedReview.waitFor();
  await droppedReview
    .getByRole("button", { name: "取消评价", exact: true })
    .click();
  assert.equal(
    await page.locator(".detail-action > div > strong").innerText(),
    "搁置",
  );
  await page.getByRole("button", { name: "修改收藏", exact: true }).click();
  await picker.getByRole("button", { name: "抛弃", exact: true }).click();
  await droppedReview
    .getByRole("button", { name: "评3分", exact: true })
    .click();
  await droppedReview.getByLabel("短评").fill("先放下这部作品");
  await droppedReview
    .getByRole("button", { name: "保存并标记抛弃", exact: true })
    .click();
  await droppedReview.waitFor({ state: "detached" });
  const dropped = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("CapacitorStorage.library-v1")),
  );
  assert.equal(dropped[featured.id].status, "dropped");
  assert.equal(dropped[featured.id].rate, 3);
  assert.equal(dropped[featured.id].comment, "先放下这部作品");
  await page.getByRole("button", { name: "修改收藏", exact: true }).click();
  await picker.getByRole("button", { name: "在看", exact: true }).click();
  assert.equal(
    await page.locator(".detail-action > div > strong").innerText(),
    "在看",
  );
  await page.getByRole("button", { name: "章节", exact: true }).click();
  await page
    .getByRole("button", { name: "标记看过第1话", exact: true })
    .click();
  await page
    .getByRole("button", { name: "取消标记第1话", exact: true })
    .waitFor();
  await page.screenshot({ path: "artifacts/mobile-detail.png" });
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  await page.locator(".subject-row").waitFor();
  await page.reload();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  await page.locator(".subject-row").waitFor();
  assert.match(
    await page.locator(".progress-caption").innerText(),
    /已看 1 集/,
    "Episode progress did not persist",
  );
  await page.screenshot({ path: "artifacts/mobile-library.png" });
  await page.locator(".subject-row").click();
  const detail = page.getByRole("dialog", { name: "作品详情", exact: true });
  await detail.getByRole("button", { name: "章节", exact: true }).click();
  await detail
    .getByRole("button", { name: "取消标记第1话", exact: true })
    .click();
  await detail.getByRole("button", { name: "看到第2话", exact: true }).click();
  await detail
    .getByRole("button", { name: "取消标记第1话", exact: true })
    .waitFor();
  await detail
    .getByRole("button", { name: "取消标记第2话", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".review-sheet").count(),
    0,
    "A partial season must not trigger the completion review",
  );
  await detail.getByRole("button", { name: "看过", exact: true }).click();
  const review = page.getByRole("dialog", {
    name: "看完了，留下你的感想",
    exact: true,
  });
  await review.waitFor();
  await review.getByRole("button", { name: "取消评价", exact: true }).click();
  assert.equal(
    await detail.locator(".collection-options .chips .active").innerText(),
    "在看",
  );
  await detail.getByRole("button", { name: "看过", exact: true }).click();
  await review.getByRole("button", { name: "评7分", exact: true }).click();
  await review.getByLabel("短评").fill("本机保存的感想");
  await review
    .getByRole("button", { name: "保存并标记看过", exact: true })
    .click();
  await review.waitFor({ state: "detached" });
  const local = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("CapacitorStorage.library-v1")),
  );
  assert.equal(local[featured.id].rate, 7);
  assert.equal(local[featured.id].comment, "本机保存的感想");
  assert.equal(local[featured.id].status, "done");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "搜索", exact: true })
    .click();
  await page.getByRole("textbox", { name: "作品名" }).fill("CLANNAD");
  await page.locator("button[type=submit]").click();
  await page.locator(".subject-row").waitFor();
  await page.locator("button[type=submit]").click();
  assert.equal(
    await page.locator(".subject-row").count(),
    1,
    "Submitting same query erased results",
  );
  await page
    .locator(".chips")
    .getByRole("button", { name: "全部", exact: true })
    .click();
  assert.equal(
    await page.locator(".subject-row").count(),
    1,
    "Selecting current category erased results",
  );
  await page.screenshot({ path: "artifacts/mobile-search.png" });
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "放送", exact: true })
    .click();
  await page.locator(".week-tabs button").nth(0).click();
  await page.locator(".subject-row").first().waitFor();
  assert.equal(
    await page.locator(".week-tabs button.active strong").innerText(),
    "一",
    "Weekday selection failed",
  );
  assert.equal(
    await page.locator(".subject-row").count(),
    calendar.find((d) => d.weekday.id === 1).items.length,
    "Calendar list does not match selected day",
  );
  await page.screenshot({ path: "artifacts/mobile-calendar.png" });
  const calendarImage = page.locator(".subject-row img").first();
  assert.ok(
    (await calendarImage.getAttribute("src")).startsWith("https://"),
    "Legacy calendar images must use HTTPS",
  );
  await calendarImage.evaluate((image) => image.scrollIntoView());
  await page.waitForFunction(
    () => document.querySelector(".subject-row img")?.naturalWidth > 0,
  );
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "320px page overflows",
  );
  await page.setViewportSize({ width: 760, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Tablet page overflows",
  );
  assert.deepEqual(errors, [], "Uncaught JavaScript errors");
  console.log(
    "PASS: mobile layout, detail, collection, episode persistence, search, calendar and responsive widths.",
  );
  // Separate fresh context verifies actual network failure without cached responses.
  const offline = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await offline.route("https://api.bgm.tv/**", (route) => route.abort());
  await offline.goto("http://localhost:5173");
  await offline.getByRole("heading", { name: "信号暂时走丢了" }).waitFor();
  await offline.getByRole("button", { name: "重新加载", exact: true }).click();
  await offline.getByRole("heading", { name: "信号暂时走丢了" }).waitFor();
  console.log("PASS: network failure and retry state.");
} finally {
  await browser.close();
}
