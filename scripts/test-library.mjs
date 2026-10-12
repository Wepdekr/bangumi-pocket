import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browse = JSON.parse(
  await fs.readFile("tests/fixtures/browse.json", "utf8"),
);
const library = Object.fromEntries(
  ["doing", "doing", "wish", "done", "hold", "dropped"].map((status, i) => {
    const subject = {
      ...browse.data[0],
      id: 80000 + i,
      name: `test-${i}`,
      name_cn: `${["在看动画", "在看电视剧", "想看作品", "看过作品", "搁置作品", "抛弃作品"][i]}`,
      type: i === 1 ? 6 : 2,
    };
    return [subject.id, { subject, status, watched: [], updated: i + 1 }];
  }),
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.addInitScript(
    (library) =>
      localStorage.setItem(
        "CapacitorStorage.library-v1",
        JSON.stringify(library),
      ),
    library,
  );
  await page.route("https://api.bgm.tv/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/calendar") ? [] : browse,
    }),
  );
  await page.route("https://lain.bgm.tv/**", (route) => route.abort());
  await page.goto("http://localhost:5173");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  await page.locator(".subject-row").first().waitFor();
  assert.equal(await page.locator("main .chips .active").innerText(), "在看");
  assert.equal(await page.locator(".subject-row").count(), 2);
  assert.ok(
    (await page.locator(".subject-row small").allTextContents()).every(
      (text) => text === "在看",
    ),
  );
  await page
    .locator("main .chips")
    .getByRole("button", { name: "全部", exact: true })
    .click();
  assert.equal(await page.locator(".subject-row").count(), 6);
  assert.deepEqual(await page.locator(".subject-row small").allTextContents(), [
    "抛弃",
    "搁置",
    "看过",
    "想看",
    "在看",
    "在看",
  ]);
  assert.ok(
    !(await page.locator(".subject-list").innerText()).includes("已收藏"),
  );
  await page.locator("main .chips").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/mobile-library-status.png" });
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "发现", exact: true })
    .click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  assert.equal(await page.locator("main .chips .active").innerText(), "在看");
  console.log(
    "PASS: library opens on in-progress items and all statuses show without redundant collection wording.",
  );
} finally {
  await browser.close();
}
