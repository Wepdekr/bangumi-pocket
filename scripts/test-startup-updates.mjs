import { build } from "esbuild";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
await fs.mkdir("artifacts", { recursive: true });
await build({
  stdin: {
    contents:
      'import React from "react"; import {createRoot} from "react-dom/client"; import {UpdateProvider} from "./src/UpdateManager"; import UpdatePanel from "./src/UpdatePanel"; createRoot(document.getElementById("root")).render(<React.StrictMode><UpdateProvider><button>首页内容</button><UpdatePanel/></UpdateProvider></React.StrictMode>);',
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  format: "iife",
  outfile: "artifacts/startup-updates-fixture.js",
  plugins: [
    {
      name: "startup-native-fixture",
      setup(build) {
        build.onResolve({ filter: /^@capacitor\// }, (args) => ({
          path: args.path,
          namespace: "native",
        }));
        build.onLoad({ filter: /.*/, namespace: "native" }, (args) => ({
          contents:
            args.path === "@capacitor/core"
              ? 'export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>"android"}; export const registerPlugin=()=>window.updater; export const CapacitorHttp={get:async()=>{window.checks++; await new Promise(r=>setTimeout(r,40)); if(window.offline)throw new Error("offline");return {status:window.status,data:window.release};}};'
              : args.path === "@capacitor/app"
                ? "export const App={getInfo:async()=>({version:window.installed})};"
                : args.path === "@capacitor/preferences"
                  ? 'export const Preferences={get:async({key})=>({value:localStorage.getItem("fixture:"+key)}),set:async({key,value})=>localStorage.setItem("fixture:"+key,value),remove:async({key})=>localStorage.removeItem("fixture:"+key)};'
                  : "export const Browser={open:async({url})=>window.opened.push(url)};",
        }));
      },
    },
  ],
});
const bundle = await fs.readFile(
    "artifacts/startup-updates-fixture.js",
    "utf8",
  ),
  css = await fs.readFile("src/styles.css", "utf8");
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
});
function release(version) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    body: "### 改进\n- 新版更新说明",
    assets: [
      {
        name: `bangumi-pocket-${version}.apk`,
        state: "uploaded",
        size: 4000000,
        digest: "sha256:" + "a".repeat(64),
        browser_download_url: `https://github.com/Wepdekr/bangumi-pocket/releases/download/v${version}/bangumi-pocket-${version}.apk`,
      },
    ],
  };
}
async function launch(
  latest,
  { current = "0.10.2", status = 200, offline = false, cache = null } = {},
) {
  const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://startup.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<style>${css}</style><div id="root"></div><script>${bundle}</script>`,
    }),
  );
  await page.addInitScript(
    ({ latest, current, status, offline, cache }) => {
      window.release = latest;
      window.installed = localStorage.getItem("test:installed") || current;
      window.offline = localStorage.getItem("test:offline") === "1" || offline;
      window.status = status;
      window.checks = 0;
      window.calls = [];
      window.opened = [];
      window.backgroundEsc = 0;
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") window.backgroundEsc++;
        },
        true,
      );
      if (!localStorage.getItem("test:seeded")) {
        if (cache)
          localStorage.setItem(
            "fixture:required-update-v1",
            JSON.stringify(cache),
          );
        localStorage.setItem("test:seeded", "1");
      }
      window.nativeState = {
        phase: "idle",
        version: "",
        received: 0,
        size: 0,
        error: "",
        installerOpened: false,
      };
      window.updater = {
        getState: async () => ({ ...window.nativeState }),
        download: async (options) => {
          window.calls.push(["download", options]);
          window.nativeState = {
            phase: "downloading",
            version: options.version,
            received: 2000000,
            size: options.size,
            error: "",
            installerOpened: false,
          };
          return { ...window.nativeState };
        },
        cancel: async () => {
          window.nativeState.phase = "idle";
          window.calls.push(["cancel"]);
          return { ...window.nativeState };
        },
        install: async () => {
          window.nativeState.installerOpened = true;
          window.calls.push(["install"]);
          return { ...window.nativeState };
        },
      };
    },
    { latest, current, status, offline, cache },
  );
  await page.goto("http://startup.test/");
  await page.waitForFunction(() => window.checks === 1);
  await page.waitForTimeout(150);
  return { page, context, errors };
}
try {
  for (const [latest, options] of [
    [release("0.10.2"), {}],
    [release("0.10.3"), {}],
    [release("0.9.99"), {}],
    [release("0.11.0"), { offline: true }],
    [null, {}],
    [release("0.11.0"), { status: 403 }],
  ]) {
    const { page, context, errors } = await launch(latest, options);
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.locator("#root").evaluate((el) => el.inert), false);
    assert.equal(await page.evaluate(() => window.checks), 1);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(errors, []);
    if (latest?.tag_name === "v0.10.3") {
      await page.getByRole("button", { name: "检查更新", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "暂不更新", exact: true }).click();
      assert.equal(await page.getByRole("dialog").count(), 0);
    }
    await context.close();
  }
  const minor = await launch(release("0.11.0"));
  await minor.page.getByRole("dialog").waitFor();
  await minor.page
    .getByRole("heading", { name: "改进", exact: true })
    .waitFor();
  await minor.page.screenshot({
    path: "artifacts/mobile-startup-minor-update.png",
  });
  await minor.page
    .getByRole("button", { name: "暂不更新", exact: true })
    .click();
  assert.equal(
    await minor.page.locator("#root").evaluate((el) => el.inert),
    false,
  );
  await minor.page.reload();
  await minor.page.getByRole("dialog").waitFor();
  assert.equal(await minor.page.evaluate(() => window.checks), 1);
  await minor.page.evaluate(() =>
    document.dispatchEvent(new Event("bangumi-update-back")),
  );
  assert.equal(await minor.page.getByRole("dialog").count(), 0);
  await minor.context.close();
  const major = await launch(release("1.0.0")),
    page = major.page,
    dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "暂不更新", exact: true }).count(),
    0,
  );
  assert.equal(
    await dialog
      .getByRole("button", { name: "关闭更新说明", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.locator("#root").evaluate((el) => el.inert), true);
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    document.dispatchEvent(new Event("bangumi-update-back")),
  );
  await page.locator(".update-overlay").click({ position: { x: 2, y: 2 } });
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.evaluate(() => window.backgroundEsc), 0);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(
        () => !!document.activeElement.closest(".update-dialog"),
      ),
      true,
    );
  }
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await dialog.getByText(/正在下载 50%/).waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "后台下载", exact: true }).count(),
    0,
  );
  await dialog.getByRole("button", { name: "取消下载", exact: true }).click();
  assert.equal(await dialog.count(), 1);
  await page.evaluate(() => {
    window.nativeState = {
      phase: "ready",
      version: "1.0.0",
      received: 4000000,
      size: 4000000,
      error: "",
      installerOpened: false,
    };
  });
  await dialog.getByRole("button", { name: "安装更新", exact: true }).click();
  assert.equal(await page.evaluate(() => window.calls.at(-1)[0]), "install");
  assert.equal(await dialog.count(), 1);
  assert.deepEqual(await page.evaluate(() => window.opened), []);
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: "artifacts/mobile-startup-major-update.png" });
  await page.evaluate((latest) => {
    window.release = latest;
  }, release("0.10.3"));
  await dialog
    .getByRole("button", { name: "重新检查更新", exact: true })
    .click();
  await page.waitForTimeout(150);
  assert.match(await dialog.innerText(), /1\.0\.0/);
  assert.equal(await page.locator("#root").evaluate((el) => el.inert), true);
  await page.evaluate(() => localStorage.setItem("test:offline", "1"));
  await page.reload();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.locator("#root").evaluate((el) => el.inert), true);
  await page.evaluate(() => localStorage.setItem("test:installed", "1.0.0"));
  await page.reload();
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("fixture:required-update-v1"),
    ),
    null,
  );
  assert.deepEqual(major.errors, []);
  await major.context.close();
  const invalidCache = release("1.0.0");
  invalidCache.assets[0].browser_download_url = "https://example.com/a.apk";
  const invalid = await launch(null, { offline: true, cache: invalidCache });
  assert.equal(await invalid.page.getByRole("dialog").count(), 0);
  assert.equal(
    await invalid.page.evaluate(() =>
      localStorage.getItem("fixture:required-update-v1"),
    ),
    null,
  );
  await invalid.context.close();
  console.log(
    "PASS: one startup check under StrictMode, quiet none/patch/downgrade/failure, manual patch check, optional minor every launch, mandatory major, all dismiss paths, focus, downloads, install cancellation, stale metadata, cached offline requirement, installed upgrade and invalid cache.",
  );
} finally {
  await browser.close();
}
