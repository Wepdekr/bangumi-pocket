import { build } from "esbuild";
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
await fs.mkdir("artifacts", { recursive: true });
await build({
  stdin: {
    contents:
      'import React from "react"; import {createRoot} from "react-dom/client"; import UpdatePanel from "./src/UpdatePanel"; createRoot(document.getElementById("root")).render(<UpdatePanel/>);',
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  format: "iife",
  outfile: "artifacts/update-download-fixture.js",
  plugins: [
    {
      name: "android-updater-fixture",
      setup(build) {
        build.onResolve({ filter: /^@capacitor\// }, (args) => ({
          path: args.path,
          namespace: "native",
        }));
        build.onLoad({ filter: /.*/, namespace: "native" }, (args) => ({
          contents:
            args.path === "@capacitor/core"
              ? 'export const Capacitor = {isNativePlatform:()=>true,getPlatform:()=>"android"}; export const CapacitorHttp = {get: async()=>({status:200,data:window.release})}; export const registerPlugin = () => window.updater;'
              : args.path === "@capacitor/app"
                ? 'export const App = {getInfo:async()=>({version:"0.10.0"})};'
                : "export const Browser = {open:async options=>window.browserLinks.push(options.url)};",
        }));
      },
    },
  ],
});
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
});
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({
    content: await fs.readFile("src/styles.css", "utf8"),
  });
  await page.evaluate(() => {
    window.browserLinks = [];
    window.nativeCalls = [];
    window.release = {
      tag_name: "v9.0.0",
      draft: false,
      prerelease: false,
      body: "### 改进\n- 更新体验",
      assets: [
        {
          name: "bangumi-pocket-9.0.0.apk",
          state: "uploaded",
          size: 4000000,
          digest: "sha256:" + "a".repeat(64),
          browser_download_url:
            "https://github.com/Wepdekr/bangumi-pocket/releases/download/v9.0.0/bangumi-pocket-9.0.0.apk",
        },
      ],
    };
    window.downloadState = {
      phase: "idle",
      version: "",
      received: 0,
      size: 0,
      error: "",
      installerOpened: false,
    };
    window.updater = {
      getState: async () => ({ ...window.downloadState }),
      download: async (options) => {
        window.nativeCalls.push(["download", options]);
        window.downloadState = {
          phase: "downloading",
          version: options.version,
          received: 2000000,
          size: options.size,
          error: "",
          installerOpened: false,
        };
        return { ...window.downloadState };
      },
      cancel: async () => {
        window.nativeCalls.push(["cancel"]);
        window.downloadState.phase = "idle";
        return { ...window.downloadState };
      },
      install: async () => {
        window.nativeCalls.push(["install"]);
        window.downloadState.installerOpened = true;
        return { ...window.downloadState };
      },
    };
  });
  await page.addScriptTag({ path: "artifacts/update-download-fixture.js" });
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await dialog.getByText("9.0.0 · 正在下载 50%", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByRole("progressbar").getAttribute("value"),
    "2000000",
  );
  assert.deepEqual(await page.evaluate(() => window.nativeCalls[0]), [
    "download",
    {
      version: "9.0.0",
      url: "https://github.com/Wepdekr/bangumi-pocket/releases/download/v9.0.0/bangumi-pocket-9.0.0.apk",
      size: 4000000,
      sha256: "a".repeat(64),
    },
  ]);
  assert.deepEqual(await page.evaluate(() => window.browserLinks), []);
  await dialog.getByRole("button", { name: "后台下载", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "查看更新说明", exact: true }).click();
  await page.evaluate(() => {
    window.downloadState.phase = "error";
    window.downloadState.error = "下载失败，请检查网络后重试。";
  });
  await dialog.getByRole("button", { name: "重新下载", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "重新下载", exact: true }).click();
  await dialog.getByRole("button", { name: "取消下载", exact: true }).click();
  await dialog.getByRole("button", { name: "下载更新", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await page.evaluate(() => {
    window.downloadState.phase = "ready";
    window.downloadState.error = "请允许番组口袋安装应用，返回后继续安装。";
  });
  await dialog.getByText(/请允许番组口袋安装应用/).waitFor();
  await dialog.getByRole("button", { name: "安装更新", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.nativeCalls.at(-1)[0]),
    "install",
  );
  await page.screenshot({
    path: "artifacts/mobile-native-update-download.png",
  });
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await dialog.getByRole("button", { name: "暂不更新", exact: true }).click();
  await page.evaluate(() => {
    window.downloadState.phase = "idle";
    delete window.release.assets[0].digest;
  });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "缺少校验数据" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.browserLinks), []);
  console.log(
    "PASS: native download wire data, progress, background dialog close, cancellation, failure retry, permission message, install retry, missing digest and narrow layout.",
  );
} finally {
  await browser.close();
}
