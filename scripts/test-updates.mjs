import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

await fs.mkdir("artifacts", { recursive: true });
await build({
  entryPoints: ["src/updates.ts"],
  outfile: "artifacts/test-updates.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { isNewer, parseRelease, APP_VERSION } =
  await import("../artifacts/test-updates.mjs");
assert.equal(isNewer("0.10.0", "0.9.9"), true);
assert.equal(isNewer("v1.0.0", "0.99.9"), true);
assert.equal(isNewer(APP_VERSION, APP_VERSION), false);
assert.equal(isNewer("0.7.2", APP_VERSION), false);
assert.throws(() => isNewer("1.0.0-beta", APP_VERSION));
const release = {
  tag_name: "v9.0.0",
  draft: false,
  prerelease: false,
  body: "### 新增\n- 检查更新\n<script>unsafe</script>",
  assets: [
    {
      name: "bangumi-pocket-9.0.0.apk",
      state: "uploaded",
      size: 4377840,
      browser_download_url:
        "https://github.com/Wepdekr/bangumi-pocket/releases/download/v9.0.0/bangumi-pocket-9.0.0.apk",
    },
  ],
};
assert.equal(parseRelease(release).version, "9.0.0");
// Exercise the Android HTTP branch, including JSON attachment responses returned as text.
await build({
  entryPoints: ["src/updates.ts"],
  outfile: "artifacts/test-updates-native.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "native-transport-fixture",
      setup(build) {
        build.onResolve({ filter: /^@capacitor\// }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "@capacitor/core"
              ? "export const Capacitor = { isNativePlatform: () => true }; export const CapacitorHttp = { get: async options => { globalThis.updateNativeRequests.push(options); return globalThis.updateNativeResponse; } };"
              : args.path === "@capacitor/app"
                ? "export const App = { getInfo: async () => ({ version: '0.8.0' }) };"
                : "export const Browser = { open: async () => {} };",
        }));
      },
    },
  ],
});
globalThis.updateNativeRequests = [];
globalThis.updateNativeResponse = {
  status: 200,
  data: JSON.stringify(release),
};
const native = await import("../artifacts/test-updates-native.mjs");
assert.equal(await native.installedVersion(), "0.8.0");
assert.equal((await native.checkUpdate()).version, "9.0.0");
assert.equal(
  globalThis.updateNativeRequests[0].url,
  "https://github.com/Wepdekr/bangumi-pocket/releases/latest/download/update.json",
);
assert.equal(
  globalThis.updateNativeRequests[0].headers.Authorization,
  undefined,
);
globalThis.updateNativeResponse = {
  status: 200,
  data: "<html>access denied</html>",
};
await assert.rejects(native.checkUpdate(), /格式不正确/);
delete globalThis.updateNativeRequests;
delete globalThis.updateNativeResponse;
for (const invalid of [
  null,
  { ...release, draft: true },
  { ...release, prerelease: true },
  { ...release, assets: [] },
  {
    ...release,
    assets: [
      {
        ...release.assets[0],
        browser_download_url: "https://example.com/app.apk",
      },
    ],
  },
]) {
  assert.throws(() => parseRelease(invalid));
}
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
});
try {
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 1,
  });
  const browse = JSON.parse(
    await fs.readFile("tests/fixtures/browse.json", "utf8"),
  );
  const calendar = JSON.parse(
    await fs.readFile("tests/fixtures/calendar.json", "utf8"),
  );
  await page.route("https://api.bgm.tv/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/calendar") ? calendar : browse,
    }),
  );
  await page.route("https://lain.bgm.tv/**", (route) => route.abort());
  let response = release,
    status = 200,
    requests = 0;
  let apiRequests = 0;
  await page.route("https://api.github.com/**", async (route) => {
    apiRequests++;
    await route.fulfill({
      status: 403,
      json: { message: "API rate limit exceeded" },
    });
  });
  await page.route("**/app-update/update.json", async (route) => {
    requests++;
    assert.equal(
      route.request().headers().authorization,
      undefined,
      "Bangumi credentials must never be sent to GitHub",
    );
    await route.fulfill({
      status,
      json: response,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("http://localhost:5173");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "收藏" })
    .click();
  const panel = page.getByRole("region", { name: "应用更新" });
  await panel.waitFor();
  assert.equal(requests, 0, "Checks should only happen when requested");
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发现新版本 9.0.0" });
  await dialog.waitFor();
  assert.equal(
    await dialog.getByRole("heading", { name: "新增", exact: true }).count(),
    1,
  );
  assert.equal(await dialog.locator("script").count(), 0);
  assert.equal(await page.locator("#root").evaluate((el) => el.inert), true);
  assert.equal(await dialog.locator("script").count(), 0);
  await page.screenshot({
    path: "artifacts/mobile-app-update.png",
    fullPage: true,
  });
  const opened = [];
  await page.exposeFunction("recordUpdateLink", (url) => opened.push(url));
  await page.evaluate(() => {
    window.open = (url) => {
      window.recordUpdateLink(url);
      return null;
    };
  });
  await dialog.getByRole("button", { name: "下载更新" }).click();
  assert.equal(opened[0], release.assets[0].browser_download_url);
  await dialog.getByRole("button", { name: "暂不更新" }).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator("#root").evaluate((el) => el.inert), false);
  await panel.getByRole("button", { name: "查看更新说明" }).click();
  await dialog.waitFor();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("bangumi-update-back")),
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  await panel.getByRole("button", { name: "查看更新说明" }).click();
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await panel.getByRole("button", { name: "下载更新" }).count(),
    0,
  );
  response = {
    ...release,
    tag_name: `v${APP_VERSION}`,
    assets: [
      {
        ...release.assets[0],
        name: `bangumi-pocket-${APP_VERSION}.apk`,
        browser_download_url: `https://github.com/Wepdekr/bangumi-pocket/releases/download/v${APP_VERSION}/bangumi-pocket-${APP_VERSION}.apk`,
      },
    ],
  };
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await panel.getByText("当前已是最新版本", { exact: true }).waitFor();
  status = 403;
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "拒绝访问（403）" })
    .waitFor();
  status = 429;
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "暂时受限" }).waitFor();
  status = 404;
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "更新信息尚未就绪" })
    .waitFor();
  status = 200;
  response = { ...release, assets: [] };
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "尚未就绪" }).waitFor();
  assert.equal(
    apiRequests,
    0,
    "Checking updates must work without any GitHub REST API request, even when that API is rate limited",
  );
  console.log(
    "Update tests passed: numeric versions, release validation, credentials isolation, optional download, same version, rate limits and missing APK.",
  );
} finally {
  await browser.close();
}
