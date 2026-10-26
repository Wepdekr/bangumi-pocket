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
            "export const Capacitor={isNativePlatform:()=>true}; export const CapacitorHttp={request:async options=>{window.nativeTimelineCalls.push(options);return {status:window.nativeTimelineStatus,data:options.url.includes('/v0/episodes/')?window.nativeEpisodeData:window.nativeTimelineHtml};}};",
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

  const singles = await page.evaluate(() => {
    const user = { id: 123, username: "tester", nickname: "测试账号" };
    const parse = (action, label, href = "/subject/ep/1234") =>
      PublicTimelineTest.parsePublicTimeline(
        `<h1><a href="/user/tester">测试账号</a></h1><div id="timeline"><li id="tml_123"><span class="info_full">${action} <a class="l" href="${href}">${label}</a><div class="card"><p class="title"><a href="/subject/9999">作品 &amp;amp; 名称</a></p></div><div class="post_actions date"><span title="2026-10-26 17:25">刚刚</span></div></span></li></div>`,
        user,
      )[0];
    const watched = parse("看过", "ep.4 第一段／第二段 &amp;amp; 第三段");
    const old = {
      ...watched,
      webSummary: undefined,
      type: 1,
      createdAt: 42,
      replies: 3,
      reactions: [{ value: 0, users: [{ id: 88, username: "friend" }] }],
      memo: {
        progress: {
          single: {
            subject: { id: 9999, name: "旧作品" },
            episode: { sort: 2, name: "旧标题" },
          },
        },
      },
    };
    return {
      watched,
      wish: parse("想看", "ep.5.5 番外", "https://chii.in/ep/5678"),
      dropped: parse("抛弃", "ep.0 序章"),
      noTitle: parse("看过", "ep.8"),
      untrusted: parse(
        "看过",
        "ep.4 标题",
        "https://untrusted.invalid/ep/1234",
      ),
      literal: parse("我看过", "ep.4 标题"),
      merged: PublicTimelineTest.mergePublicTimeline(
        [old],
        [watched],
        user.id,
        0,
      )[0],
    };
  });
  assert.equal(singles.watched.cat, 4);
  assert.equal(singles.watched.type, 2);
  assert.deepEqual(singles.watched.memo.progress.single.episode, {
    id: 1234,
    sort: 4,
    name: "第一段／第二段 &amp; 第三段",
  });
  assert.equal(
    singles.watched.memo.progress.single.subject.name,
    "作品 &amp; 名称",
  );
  assert.equal(
    singles.watched.memo.subject,
    undefined,
    "A single episode must render its subject once",
  );
  assert.equal(singles.wish.type, 1);
  assert.equal(singles.wish.memo.progress.single.episode.sort, 5.5);
  assert.equal(singles.dropped.type, 3);
  assert.equal(singles.noTitle.memo.progress.single.episode.name, "");
  assert.equal(singles.untrusted.memo.progress, undefined);
  assert.equal(singles.literal.memo.progress, undefined);
  assert.equal(singles.merged.type, 2);
  assert.deepEqual(singles.merged.memo, singles.watched.memo);
  assert.equal(singles.merged.createdAt, 42);
  assert.equal(singles.merged.replies, 3);
  assert.equal(singles.merged.reactions[0].users[0].id, 88);

  const translations = await page.evaluate(async (source) => {
    const userId = source.uid;
    const single = source.memo.progress.single;
    const api = {
      ...source,
      webSummary: undefined,
      memo: {
        progress: {
          single: {
            ...single,
            episode: {
              ...single.episode,
              nameCN: "中文 &amp;amp; 标题",
            },
          },
        },
      },
    };
    const merge = (previous) =>
      PublicTimelineTest.mergePublicTimeline(
        [previous],
        [source],
        userId,
        0,
      )[0];
    const kept = merge(api);
    const wrongId = merge({
      ...api,
      memo: {
        progress: {
          single: {
            ...api.memo.progress.single,
            episode: { ...api.memo.progress.single.episode, id: 5678 },
          },
        },
      },
    });
    const changed = merge({
      ...api,
      memo: {
        progress: {
          single: {
            ...api.memo.progress.single,
            episode: { ...api.memo.progress.single.episode, sort: 2 },
          },
        },
      },
    });
    const originalFetch = window.fetch;
    const calls = [];
    let payload = {
      id: 1234,
      subject_id: 9999,
      sort: 4,
      name_cn: "中文 &amp;amp; 标题",
    };
    let failure = false;
    let status = 200;
    window.fetch = async (url, options) => {
      calls.push({
        url,
        credentials: options.credentials,
        redirect: options.redirect,
        headers: options.headers,
      });
      if (failure) throw new Error("offline");
      return { ok: status === 200, json: async () => payload };
    };
    const localize = () => PublicTimelineTest.localizePublicTimeline([source]);
    try {
      const before = JSON.stringify(source);
      const localized = await PublicTimelineTest.localizePublicTimeline([
        source,
        { ...source, id: 124 },
        kept,
      ]);
      const callCount = calls.length;
      payload = { ...payload, name_cn: "" };
      const noTranslation = await localize();
      payload = { ...payload, name_cn: "错误标题", subject_id: 1 };
      const wrongSubject = await localize();
      payload = { ...payload, subject_id: 9999, id: 999 };
      const wrongEpisode = await localize();
      payload = { ...payload, id: 1234, sort: 2 };
      const wrongSort = await localize();
      payload = null;
      const malformed = await localize();
      status = 404;
      const notFound = await localize();
      failure = true;
      const offline = await localize();
      return {
        kept,
        wrongId,
        changed,
        localized,
        callCount,
        calls,
        fallbacks: [
          noTranslation,
          wrongSubject,
          wrongEpisode,
          wrongSort,
          malformed,
          notFound,
          offline,
        ],
        mutated: JSON.stringify(source) !== before,
      };
    } finally {
      window.fetch = originalFetch;
    }
  }, singles.watched);
  assert.equal(
    translations.kept.memo.progress.single.episode.nameCN,
    "中文 &amp; 标题",
  );
  assert.equal(
    translations.wrongId.memo.progress.single.episode.nameCN,
    undefined,
  );
  assert.equal(
    translations.changed.memo.progress.single.episode.nameCN,
    undefined,
  );
  assert.equal(
    translations.callCount,
    1,
    "Deduplicate exact-ID lookups and retain known translations",
  );
  assert.equal(translations.mutated, false);
  assert.equal(
    translations.localized[0].memo.progress.single.episode.nameCN,
    "中文 &amp; 标题",
  );
  assert.deepEqual(translations.localized[2], translations.kept);
  for (const fallback of translations.fallbacks)
    assert.deepEqual(fallback[0], singles.watched);
  assert.equal(
    translations.calls[0].url,
    "https://api.bgm.tv/v0/episodes/1234",
  );
  assert.equal(translations.calls[0].credentials, "omit");
  assert.equal(translations.calls[0].redirect, "error");
  assert.equal(translations.calls[0].headers, undefined);

  const invalidProgress = await page.evaluate(() => {
    const user = { id: 123, username: "tester", nickname: "测试账号" };
    const html = (count, total, link = true) =>
      `<h1><a href="/user/tester">测试账号</a></h1><div id="timeline"><ul><li id="tml_999"><span class="info_full">完成了 ${link ? '<a href="https://bgm.tv/subject/9999" class="l">测试作品</a>' : "测试作品"} ${count} of ${total} 话<div class="card"><p class="title"><a href="https://bgm.tv/subject/9999">测试作品</a></p></div><div class="post_actions date"><span title="2026-10-18 17:56">刚刚</span></div></span></li></ul></div>`;
    const parse = (...args) =>
      PublicTimelineTest.parsePublicTimeline(html(...args), user)[0];
    const bad = parse(12, 8);
    const api = {
      ...bad,
      invalidProgress: false,
      webSummary: undefined,
      cat: 4,
      memo: {
        progress: {
          batch: {
            subject: { id: 9999, name: "测试作品", type: 2 },
            epsUpdate: 8,
            epsTotal: "8",
          },
        },
      },
    };
    return {
      bad,
      valid: parse(8, 8),
      unknown: parse(12, "??"),
      literal: parse(12, 8, false),
      merged: PublicTimelineTest.mergePublicTimeline(
        [api],
        [bad],
        user.id,
        0,
      )[0],
    };
  });
  assert.equal(invalidProgress.bad.invalidProgress, true);
  assert.equal(invalidProgress.bad.webSummary, "完成了 测试作品 12 of 8 话");
  assert.equal(invalidProgress.valid.invalidProgress, false);
  assert.equal(invalidProgress.unknown.invalidProgress, false);
  assert.equal(
    invalidProgress.literal.invalidProgress,
    false,
    "Do not reinterpret free-form status text as a progress record",
  );
  assert.equal(
    invalidProgress.merged.invalidProgress,
    true,
    "Public merge must preserve anomaly information",
  );

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

  const nativeTranslation = await page.evaluate(async (source) => {
    window.nativeTimelineStatus = 200;
    window.nativeTimelineCalls = [];
    window.nativeEpisodeData = {
      id: 1234,
      subject_id: 9999,
      sort: 4,
      name_cn: "原生中文 &amp; 标题",
    };
    const rows = await NativeTimelineTest.localizePublicTimeline([source]);
    window.nativeTimelineStatus = 503;
    const fallback = await NativeTimelineTest.localizePublicTimeline([source]);
    return { rows, fallback, calls: window.nativeTimelineCalls };
  }, singles.watched);
  assert.equal(
    nativeTranslation.rows[0].memo.progress.single.episode.nameCN,
    "原生中文 & 标题",
  );
  assert.deepEqual(nativeTranslation.fallback[0], singles.watched);
  assert.equal(
    nativeTranslation.calls[0].url,
    "https://api.bgm.tv/v0/episodes/1234",
  );
  assert.equal(nativeTranslation.calls[0].method, "GET");
  assert.equal(nativeTranslation.calls[0].headers.Authorization, undefined);
  assert.equal(nativeTranslation.calls[0].headers.Cookie, "");
  assert.equal(nativeTranslation.calls[0].disableRedirects, true);

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
