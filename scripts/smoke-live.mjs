import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const failed = [];
page.on("requestfailed", (r) => {
  if (r.url().includes("bgm.tv"))
    failed.push({ url: r.url(), error: r.failure()?.errorText });
});
try {
  await page.goto("http://localhost:5173");
  await page.locator(".hero h2").waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () => {
      const image = document.querySelector(".hero>img");
      return image?.complete && image.naturalWidth > 0;
    },
    {},
    { timeout: 45000 },
  );
  await page.screenshot({ path: "artifacts/mobile-live-home.png" });
  console.log(
    "PASS: live Bangumi API and cover image. Featured:",
    await page.locator(".hero h2").innerText(),
  );
  await page.locator(".hero").click();
  await page.locator(".detail-title h1").waitFor();
  await page.waitForFunction(
    () => document.querySelector(".detail-cover")?.naturalWidth > 0,
  );
  await page.screenshot({ path: "artifacts/mobile-live-detail.png" });
  console.log("PASS: live subject details.");
  await page.getByRole("button", { name: "章节", exact: true }).click();
  await page.locator(".episode").first().waitFor({ timeout: 30000 });
  console.log("PASS: live episode list.");
  await page.getByRole("button", { name: "评论", exact: true }).click();
  await page.locator(".community-card").first().waitFor({ timeout: 30000 });
  await page
    .locator(".community-tab")
    .evaluate((element) => element.scrollIntoView());
  await page.screenshot({ path: "artifacts/mobile-live-comments.png" });
  console.log("PASS: live subject short comments.");
  await page.getByRole("button", { name: "长评", exact: true }).click();
  await page.locator(".community-card h3").first().waitFor({ timeout: 30000 });
  console.log("PASS: live subject long reviews.");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "搜索", exact: true })
    .click();
  await page.getByRole("textbox", { name: "作品名" }).fill("葬送的芙莉莲");
  await page.locator("button[type=submit]").click();
  await page.locator(".subject-row").first().waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelector(".subject-row img")?.naturalWidth > 0,
  );
  await page.screenshot({ path: "artifacts/mobile-live-search.png" });
  console.log("PASS: live Chinese search.");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "放送", exact: true })
    .click();
  await page.locator(".subject-row").first().waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () => {
      const image = document.querySelector(".subject-row img");
      return (
        image?.src.startsWith("https://") &&
        image.complete &&
        image.naturalWidth > 0
      );
    },
    {},
    { timeout: 45000 },
  );
  await page.screenshot({ path: "artifacts/mobile-live-calendar.png" });
  console.log("PASS: live calendar and HTTPS cover image.");
} catch (error) {
  console.log("Live smoke check failed:", error.message);
  console.log("Failed requests:", JSON.stringify(failed));
  throw error;
} finally {
  await browser.close();
}
