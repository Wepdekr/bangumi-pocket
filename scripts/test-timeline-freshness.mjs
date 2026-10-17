import { build } from "esbuild";
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

await fs.mkdir("artifacts", { recursive: true });
await build({
  entryPoints: ["src/public-timeline.ts"],
  bundle: true,
  format: "iife",
  globalName: "PublicTimelineTest",
  outfile: "artifacts/public-timeline-test.js",
});
await build({
  entryPoints: ["src/public-timeline.ts"],
  bundle: true,
  format: "iife",
  globalName: "NativeTimelineTest",
  outfile: "artifacts/native-timeline-test.js",
  plugins: [
    {
      name: "native-http",
      setup(build) {
        build.onResolve({ filter: /^@capacitor\/core$/ }, () => ({
          path: "core",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const Capacitor={isNativePlatform:()=>true}; export const CapacitorHttp={request:async options=>{window.nativeTimelineCalls.push(options);return {status:window.nativeTimelineStatus,data:window.nativeTimelineHtml};}};",
        }));
      },
    },
  ],
});
await build({
  stdin: {
    contents: `import React from "react"; import {createRoot} from "react-dom/client";
      import FriendsView from "./src/FriendsView"; import {syncController} from "./src/sync";
      const user = {id:123, username:"tester", nickname:"测试账号"};
      const event = (id, title) => ({id, uid:123, cat:5, type:1, createdAt:1792198800, replies:0, memo:{status:{tsukkomi:title}}});
      window.feedRequests = 0; window.writeComplete = false;
      syncController.friendsTimeline = async until => {
        window.feedRequests++;
        if(until) return new Promise(resolve => window.finishOldPage = () => resolve({events:[event(9,"旧分页结果")],cursor:9,hasMore:false,warning:""}));
        return {events:[window.writeComplete?event(20,"同步后的新动态"):event(10,"修改前的动态")],cursor:10,hasMore:true,warning:""};
      };
      const root = createRoot(document.getElementById("root"));
      window.renderSyncedAccount = lastSync => root.render(<FriendsView account={{ready:true,user,lastSync}} connect={()=>{}} open={()=>{}} openWebsite={()=>{}} openTimeline={()=>{}}/>);
      window.renderSyncedAccount(1);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  format: "iife",
  outfile: "artifacts/friend-refresh-test.js",
});

const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: "artifacts/public-timeline-test.js" });
  const result = await page.evaluate(() => {
    const user = { id: 123, username: "tester", nickname: "测试账号" };
    const shell = (content) =>
      `<h1><a href="/user/tester">测试账号</a></h1><div id="timeline"><ul>${content}</ul></div>`;
    const row = (id, description, name = "作品 &amp;amp; 名称", extras = "") =>
      `<li id="tml_${id}"><span class="info_full">${description}<div class="collectInfo"><div class="comment"><span class="starlight stars8"></span>评价 &amp;amp; 保留</div></div><div class="card"><p class="title"><a href="https://bgm.tv/subject/9999">${name}<small>原名</small></a></p><img src="//lain.bgm.tv/pic/cover/m/test.jpg" onerror="window.untrustedCodeRan=true"></div>${extras}<div class="post_actions date"><span title="2026-10-17 09:39">刚刚</span> · next</div></span></li>`;
    const parse = (html) => PublicTimelineTest.parsePublicTimeline(html, user);
    window.nativeTimelineHtml = shell(row(502, "完成了 作品 2 of 12 话"));
    window.untrustedCodeRan = false;
    const events = parse(
      shell(
        row(
          502,
          "完成了 作品 2 of 12 话",
          undefined,
          '<script>window.untrustedCodeRan=true</script><iframe srcdoc="<script>parent.untrustedCodeRan=true</script>"></iframe>',
        ) + row(501, "在看 作品"),
      ),
    );
    const rejects = [];
    for (const bad of [
      "<html>验证页面</html>",
      '<h1><a href="/user/other">他人</a></h1><div id="timeline"></div>',
      shell('<li id="tml_123"><span class="info_full">未知日期</span></li>'),
    ]) {
      try {
        parse(bad);
        rejects.push(false);
      } catch {
        rejects.push(true);
      }
    }
    const invalidLink = parse(
      shell(
        row(503, "有记录", "作品")
          .replace("https://bgm.tv/subject/9999", "javascript:alert(1)")
          .replace(
            "//lain.bgm.tv/pic/cover/m/test.jpg",
            "https://untrusted.invalid/track",
          ),
      ),
    );
    return {
      events,
      rejects,
      ran: window.untrustedCodeRan,
      empty: parse(shell("")),
      invalidLink,
    };
  });
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].webSummary, "完成了 作品 2 of 12 话");
  assert.equal(result.events[1].webSummary, "在看 作品");
  assert.equal(
    result.events[0].memo.subject[0].subject.name,
    "作品 &amp; 名称",
  );
  assert.equal(result.events[0].memo.subject[0].comment, "评价 &amp; 保留");
  assert.equal(result.events[0].memo.subject[0].rate, 8);
  assert.equal(
    result.events[0].createdAt,
    Date.parse("2026-10-17T09:39:00+08:00") / 1000,
  );
  assert.deepEqual(result.rejects, [true, true, true]);
  assert.equal(result.ran, false);
  assert.deepEqual(result.empty, []);
  assert.deepEqual(result.invalidLink[0].memo.subject, []);

  const merge = await page.evaluate(() => {
    const user = { id: 123, username: "tester" };
    const original = PublicTimelineTest.parsePublicTimeline(
      window.nativeTimelineHtml,
      user,
    );
    const next = {
      id: 502,
      uid: 123,
      cat: 4,
      type: 0,
      createdAt: 1,
      replies: 0,
      source: { name: "next" },
      memo: {
        progress: {
          batch: {
            subject: { id: 9999, name: "旧资料" },
            epsUpdate: 1,
            epsTotal: "12",
          },
        },
      },
    };
    const api = {
      id: 501,
      uid: 123,
      cat: 3,
      type: 10,
      createdAt: 1,
      replies: 2,
      source: { name: "API" },
      batch: false,
      reactions: [{ value: 0, users: [{ id: 88, username: "friend" }] }],
      memo: {
        subject: [
          {
            subject: { id: 9999, name: "旧资料" },
            collectID: 77,
            rate: 5,
            comment: "旧短评",
          },
        ],
      },
    };
    const currentCollection = {
      ...original[0],
      id: 501,
      webSummary: "在看 作品",
    };
    const friend = { ...api, id: 503, uid: 88 };
    const rows = PublicTimelineTest.mergePublicTimeline(
      [next, api, friend],
      [
        ...original,
        currentCollection,
        { ...original[0], id: 5 },
        { ...original[0], id: 600, uid: 999 },
      ],
      123,
      10,
    );
    const repeated = PublicTimelineTest.mergePublicTimeline(
      rows,
      [...original, currentCollection],
      123,
      10,
    );
    return { rows, repeated };
  });
  assert.deepEqual(
    merge.rows.map((row) => row.id),
    [503, 502, 501],
  );
  assert.equal(merge.rows[1].source.name, "next");
  assert.equal(merge.rows[2].source.name, "API");
  assert.equal(merge.rows[1].webSummary, "完成了 作品 2 of 12 话");
  assert.equal(
    merge.rows[1].memo.progress,
    undefined,
    "Merged progress must not show the stale 1-of-12 payload below current text",
  );
  assert.equal(merge.rows[2].webSummary, "在看 作品");
  assert.equal(merge.rows[2].memo.subject[0].collectID, 77);
  assert.equal(merge.rows[2].memo.subject[0].rate, 8);
  assert.equal(merge.rows[2].memo.subject[0].comment, "评价 &amp; 保留");
  assert.equal(merge.rows[2].reactions[0].users[0].id, 88);
  assert.equal(merge.rows[2].batch, false);
  assert.deepEqual(
    merge.repeated,
    merge.rows,
    "Refreshing the same records must not duplicate them",
  );

  await page.addScriptTag({ path: "artifacts/native-timeline-test.js" });
  const native = await page.evaluate(async () => {
    window.nativeTimelineCalls = [];
    window.nativeTimelineStatus = 200;
    const rows = await NativeTimelineTest.readPublicTimeline({
      id: 123,
      username: "tester",
    });
    window.nativeTimelineStatus = 302;
    let rejected = false;
    try {
      await NativeTimelineTest.readPublicTimeline({
        id: 123,
        username: "tester",
      });
    } catch {
      rejected = true;
    }
    return { rows, calls: window.nativeTimelineCalls, rejected };
  });
  assert.equal(native.rows[0].id, 502);
  assert.equal(native.calls[0].url, "https://bgm.tv/user/tester/timeline");
  assert.equal(native.calls[0].headers.Authorization, undefined);
  assert.equal(native.calls[0].headers.Cookie, "");
  assert.equal(native.calls[0].responseType, "text");
  assert.equal(native.calls[0].disableRedirects, true);
  assert.equal(native.rejected, true);

  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: "artifacts/friend-refresh-test.js" });
  await page.getByText("修改前的动态", { exact: true }).waitFor();
  await page.getByRole("button", { name: "加载更多动态", exact: true }).click();
  await page.waitForFunction(() => typeof window.finishOldPage === "function");
  await page.evaluate(() => {
    window.writeComplete = true;
    window.renderSyncedAccount(2);
  });
  await page.getByText("同步后的新动态", { exact: true }).waitFor();
  await page.evaluate(() => window.finishOldPage());
  assert.equal(
    await page.getByText("旧分页结果", { exact: true }).count(),
    0,
    "A pre-refresh page must not overwrite or append to the refreshed feed",
  );
  assert.equal(
    await page.getByText("修改前的动态", { exact: true }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.feedRequests), 3);
  console.log(
    "PASS: public timeline parsing, API/next source-independent merging, updated same-ID progress, reaction preservation, inert content, credential-independent data and refresh with stale-pagination isolation.",
  );
} finally {
  await browser.close();
}
