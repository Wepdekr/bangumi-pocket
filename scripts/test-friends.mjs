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
const s = browse.data[0];
const requests = [];
const errors = [];
let expired = false;
let empty = false;
let noFriends = false;
let reactionFailure = false;
let webExtra = false;
let publicFailure = false;
let publicRequests = 0;
let personalEmpty = false;
let personalFailure = false;
let wrongUser = false;
const personalRequests = [];
let reactions = [
  { value: 0, users: [{ id: 88, username: "friend", nickname: "我的好友" }] },
];
const writes = [];
const own = {
  id: 12,
  uid: 123,
  cat: 5,
  type: 1,
  createdAt: 1700000100,
  replies: 0,
  memo: { status: { tsukkomi: "我自己的动态" } },
};
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/public-timeline/**", (route) => {
  publicRequests++;
  assert.equal(route.request().headers().authorization, undefined);
  assert.equal(route.request().headers().cookie, undefined);
  const username = new URL(route.request().url()).pathname.split("/")[3];
  assert.ok(["tester", "friend"].includes(username));
  if (publicFailure) return route.fulfill({ status: 503, body: "Unavailable" });
  const row = (id, description, withSubject = false) =>
    `<li id="tml_${id}"><span class="info_full">${description}${withSubject ? '<div class="card"><p class="title"><a href="https://bgm.tv/subject/9999">接口缺失作品</a></p></div>' : ""}<div class="post_actions date"><span title="2026-10-17 09:39">刚刚</span></div></span></li>`;
  return route.fulfill({
    contentType: "text/html",
    body: `<h1><a href="/user/${username}">测试账号</a></h1><div id="timeline"><ul>${empty || personalEmpty || username === "friend" ? "" : row(12, "重复的个人动态") + (webExtra ? row(502, "完成了 接口缺失作品 2 of 12 话", true) + row(501, "在看 接口缺失作品", true) : "")}</ul></div>`,
  });
});
await page.route("https://api.bgm.tv/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({
    json:
      path === "/v0/me"
        ? { id: 123, username: "tester", nickname: "测试账号" }
        : path.includes("/collections")
          ? { total: 0, data: [] }
          : path === "/calendar"
            ? []
            : path === "/v0/subjects"
              ? browse
              : path === "/v0/episodes"
                ? { total: 0, data: [] }
                : path.endsWith("/characters")
                  ? []
                  : s,
  });
});
await page.route("**/friends-api/**", (route) => {
  const url = new URL(route.request().url());
  assert.equal(
    route.request().headers().authorization,
    "Bearer test-friends-token",
  );
  assert.equal(url.searchParams.has("token"), false);
  if (expired) return route.fulfill({ status: 401, json: {} });
  if (url.pathname.endsWith("/like")) {
    if (reactionFailure) return route.fulfill({ status: 500, json: {} });
    const method = route.request().method();
    writes.push({
      method,
      path: url.pathname,
      body: route.request().postDataJSON(),
    });
    reactions = reactions.map((r) => ({
      ...r,
      users: r.users.filter((u) => u.id !== 123),
    }));
    if (method === "PUT") {
      const value = route.request().postDataJSON().value;
      const item = reactions.find((r) => r.value === value);
      const me = { id: 123, username: "tester", nickname: "测试账号" };
      if (item) item.users.push(me);
      else reactions.push({ value, users: [me] });
    }
    reactions = reactions.filter((r) => r.users.length);
    return route.fulfill({ status: 204, body: "" });
  }
  if (url.pathname.endsWith("/friendlist"))
    return route.fulfill({
      json: { friendlist: empty || noFriends ? [] : [88] },
    });
  if (/\/users\/(tester|friend)\/timeline$/.test(url.pathname)) {
    personalRequests.push(url.pathname + url.search);
    if (personalFailure) return route.fulfill({ status: 503, json: {} });
    const isOwn = url.pathname.includes("/tester/");
    const event = isOwn
      ? own
      : {
          id: 10,
          uid: wrongUser ? 77 : 88,
          createdAt: 1700000000,
          cat: 3,
          type: 6,
          replies: 0,
          reactions,
          memo: {
            subject: [
              {
                subject: { ...s, nameCN: s.name_cn },
                collectID: 456,
                rate: 8,
                comment: "好友个人时间线评价",
              },
            ],
          },
        };
    return route.fulfill({
      json:
        empty || personalEmpty
          ? []
          : url.searchParams.has("until")
            ? Number(url.searchParams.get("until")) > 5
              ? [
                  event,
                  {
                    ...own,
                    id: 5,
                    uid: isOwn ? 123 : 88,
                    memo: { status: { tsukkomi: "更早的个人动态" } },
                  },
                ]
              : []
            : [event],
    });
  }
  assert.equal(
    url.searchParams.get("mode"),
    "friends",
    "Must never request the global timeline",
  );
  requests.push(url.searchParams.get("until"));
  const base = {
    uid: 88,
    user: { id: 88, username: "friend", nickname: "我的好友 &amp; 同好" },
    createdAt: 1700000000,
    replies: 0,
  };
  return route.fulfill({
    json: empty
      ? []
      : url.searchParams.has("until")
        ? [
            {
              ...base,
              id: 8,
              cat: 5,
              type: 1,
              memo: { status: { tsukkomi: "好友的第二条动态" } },
            },
          ]
        : [
            own,
            ...Array.from({ length: 14 }, (_, i) => ({
              ...base,
              id: 40 - i,
              cat: 3,
              type: i + 1,
              memo: {
                subject: [
                  {
                    subject: {
                      ...s,
                      id: 1000 + i,
                      nameCN: `状态测试 ${i + 1}`,
                    },
                  },
                ],
              },
            })),
            {
              ...base,
              id: 25,
              cat: 4,
              type: 0,
              memo: {
                progress: {
                  batch: {
                    subject: { ...s, type: 2, nameCN: "动画批量进度" },
                    epsUpdate: 25,
                    epsTotal: "25",
                    volsUpdate: 0,
                    volsTotal: "??",
                  },
                },
              },
            },
            {
              ...base,
              id: 24,
              cat: 4,
              type: 0,
              memo: {
                progress: {
                  batch: {
                    subject: { ...s, type: 1, nameCN: "书籍卷数进度" },
                    volsUpdate: 3,
                    volsTotal: "10",
                  },
                },
              },
            },
            {
              ...base,
              id: 23,
              cat: 4,
              type: 0,
              memo: {
                progress: {
                  batch: {
                    subject: { ...s, type: 1, nameCN: "未知总卷数" },
                    volsUpdate: 2,
                    volsTotal: "??",
                  },
                },
              },
            },
            {
              ...base,
              id: 11,
              uid: 77,
              user: { id: 77, username: "outsider", nickname: "路人" },
              cat: 5,
              type: 1,
              memo: { status: { tsukkomi: "路人的全站动态" } },
            },
            {
              ...base,
              id: 10,
              reactions,
              cat: 3,
              type: 6,
              memo: {
                subject: [
                  {
                    subject: { ...s, nameCN: s.name_cn },
                    rate: 8,
                    collectID: 456,
                    comment: "好友的评价",
                  },
                ],
              },
            },
            {
              ...base,
              id: 9,
              cat: 4,
              type: 2,
              memo: {
                progress: {
                  single: {
                    subject: s,
                    episode: { sort: 3, nameCN: "第三集 &amp; 回忆" },
                  },
                },
              },
            },
          ],
  });
});
try {
  await page.goto("http://localhost:5173");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "动态", exact: true })
    .click();
  await page
    .getByRole("button", { name: "连接 Bangumi 账号", exact: true })
    .waitFor();
  assert.equal(
    requests.length,
    0,
    "Guests must not request authenticated activity",
  );
  await page
    .getByRole("button", { name: "连接 Bangumi 账号", exact: true })
    .click();
  await page
    .getByLabel("个人访问令牌", { exact: true })
    .fill("test-friends-token");
  await page.getByRole("button", { name: "连接并同步", exact: true }).click();
  await page.getByRole("button", { name: "立即同步", exact: true }).waitFor();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "动态", exact: true })
    .click();
  await page.getByText("好友的评价", { exact: true }).waitFor();
  await page.getByText("我的好友 & 同好", { exact: true }).first().waitFor();
  assert.equal(publicRequests > 0, true);
  const labels = [
    "想读",
    "想看",
    "想听",
    "想玩",
    "读过",
    "看过",
    "听过",
    "玩过",
    "在读",
    "在看",
    "在听",
    "在玩",
    "搁置",
    "抛弃",
  ];
  for (let i = 0; i < labels.length; i++) {
    assert.equal(
      await page
        .locator(".friend-card")
        .filter({ hasText: `状态测试 ${i + 1}` })
        .filter({ has: page.getByText(`状态测试 ${i + 1}`, { exact: true }) })
        .locator(".friend-action")
        .innerText(),
      `标记为${labels[i]}`,
    );
  }
  const anime = page
    .locator(".friend-card")
    .filter({ hasText: "动画批量进度" });
  assert.equal(await anime.locator(".friend-action").innerText(), "完成了");
  assert.match(await anime.innerText(), /25 of 25 话/);
  assert.doesNotMatch(await anime.innerText(), /卷数|\?\?/);
  await page.getByText("卷数：3 / 10", { exact: true }).waitFor();
  await page.getByText("卷数：2", { exact: true }).waitFor();
  webExtra = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page
    .getByText("完成了 接口缺失作品 2 of 12 话", { exact: true })
    .waitFor();
  await page.getByText("在看 接口缺失作品", { exact: true }).waitFor();
  assert.match(
    await page.locator(".friend-card").first().innerText(),
    /完成了 接口缺失作品/,
  );
  assert.equal(
    await page.getByText("我自己的动态", { exact: true }).count(),
    1,
    "Public rows must not duplicate API records",
  );
  assert.equal(
    await page.getByText("重复的个人动态", { exact: true }).count(),
    0,
  );
  publicFailure = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page
    .getByText("部分个人动态暂时无法核对，可稍后刷新或查看原站时间线。", {
      exact: true,
    })
    .waitFor();
  await page.getByText("好友的评价", { exact: true }).waitFor();
  publicFailure = false;
  webExtra = false;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("好友的评价", { exact: true }).waitFor();
  await page.getByText("我自己的动态", { exact: true }).waitFor();
  const card = page.locator(".friend-card").filter({ hasText: "好友的评价" });
  await card.getByText("1 人互动", { exact: true }).waitFor();
  await card.getByRole("button", { name: "表情 0，1 人", exact: true }).click();
  await card
    .getByRole("button", { name: "表情 0，2 人", exact: true })
    .waitFor();
  assert.equal(
    await card
      .getByRole("button", { name: "表情 0，2 人" })
      .getAttribute("aria-pressed"),
    "true",
  );
  await card.getByRole("button", { name: "发表情", exact: true }).click();
  await card.getByRole("button", { name: "选择表情 54", exact: true }).click();
  await card
    .getByRole("button", { name: "表情 54，1 人", exact: true })
    .waitFor();
  await card.getByText("2 人互动", { exact: true }).waitFor();
  await card
    .getByRole("button", { name: "表情 54，1 人", exact: true })
    .click();
  await card.getByText("1 人互动", { exact: true }).waitFor();
  assert.deepEqual(
    writes.slice(0, 3).map((w) => [w.method, w.body?.value]),
    [
      ["PUT", 0],
      ["PUT", 54],
      ["DELETE", undefined],
    ],
  );
  assert.ok(
    writes
      .slice(0, 3)
      .every((w) => w.path === "/friends-api/subjects/-/collects/456/like"),
  );
  reactionFailure = true;
  await card.getByRole("button", { name: "表情 0，1 人", exact: true }).click();
  await card.getByRole("alert").waitFor();
  assert.equal(
    await card
      .getByRole("button", { name: "表情 0，1 人" })
      .getAttribute("aria-pressed"),
    "false",
  );
  reactionFailure = false;
  await card.getByRole("button", { name: "表情 0，1 人", exact: true }).click();
  await card
    .getByRole("button", { name: "表情 0，2 人", exact: true })
    .waitFor();
  assert.equal(await card.getByRole("alert").count(), 0);
  await card.getByRole("button", { name: "表情 0，2 人", exact: true }).click();
  await card.getByText("1 人互动", { exact: true }).waitFor();
  const myCard = page
    .locator(".friend-card")
    .filter({ hasText: "我自己的动态" });
  await myCard.getByRole("button", { name: "发表情", exact: true }).click();
  await myCard
    .getByRole("button", { name: "选择表情 79", exact: true })
    .click();
  await myCard
    .getByRole("button", { name: "表情 79，1 人", exact: true })
    .waitFor();
  assert.equal(writes.at(-1).path, "/friends-api/timeline/12/like");
  assert.equal(
    await page
      .locator(".friend-card")
      .filter({ hasText: "第 3 集" })
      .getByRole("button", { name: "发表情", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByText("路人的全站动态", { exact: true }).count(),
    0,
    "Non-friend activity must never be displayed",
  );
  await page.getByText("第 3 集 · 第三集 & 回忆", { exact: true }).waitFor();
  await page.getByRole("button", { name: "加载更多动态", exact: true }).click();
  await page.getByText("好友的第二条动态", { exact: true }).waitFor();
  assert.ok(requests.slice(0, -1).every((cursor) => cursor === null));
  assert.equal(requests.at(-1), "9");
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Five navigation tabs must fit narrow screens",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".friends-toolbar").scrollIntoViewIfNeeded();
  await myCard.getByRole("button", { name: "发表情", exact: true }).click();
  assert.equal(
    await myCard.locator(".reaction-picker img").evaluateAll(async (images) => {
      await Promise.all(images.map((img) => img.decode().catch(() => {})));
      return images.every((img) => img.complete && img.naturalWidth > 0);
    }),
    true,
    "Bundled emoji must render",
  );
  await page.screenshot({ path: "artifacts/mobile-friends.png" });
  await page.locator(".friend-subject").first().click();
  await page.getByRole("dialog", { name: "作品详情", exact: true }).waitFor();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  // Personal timelines stay in the app and use the scoped user endpoint.
  let popups = 0;
  page.on("popup", () => popups++);
  await myCard
    .getByRole("button", { name: "查看我的时间线", exact: true })
    .click();
  const ownTimeline = page.getByRole("dialog", {
    name: "我的时间线",
    exact: true,
  });
  await ownTimeline.getByText("我自己的动态", { exact: true }).waitFor();
  assert.match(personalRequests.at(-1), /\/users\/tester\/timeline\?limit=20$/);
  assert.equal(
    await ownTimeline.getByText("好友的评价", { exact: true }).count(),
    0,
  );
  await ownTimeline
    .getByRole("button", { name: "加载更多动态", exact: true })
    .click();
  await ownTimeline.getByText("更早的个人动态", { exact: true }).waitFor();
  assert.match(personalRequests.at(-1), /until=12/);
  assert.equal(
    await ownTimeline.getByText("我自己的动态", { exact: true }).count(),
    1,
  );
  await page.keyboard.press("Escape");
  await ownTimeline.waitFor({ state: "detached" });
  await card
    .getByRole("button", { name: "查看好友时间线", exact: true })
    .click();
  const friendTimeline = page.getByRole("dialog", {
    name: "我的好友 & 同好的时间线",
    exact: true,
  });
  await friendTimeline
    .getByText("好友个人时间线评价", { exact: true })
    .waitFor();
  assert.match(personalRequests.at(-1), /\/users\/friend\/timeline\?limit=20$/);
  await friendTimeline
    .locator(".timeline-profile")
    .getByText("我的好友 & 同好", { exact: true })
    .waitFor();
  const personalCard = friendTimeline.locator(".friend-card").first();
  await personalCard
    .getByRole("button", { name: "表情 0，1 人", exact: true })
    .click();
  await personalCard
    .getByRole("button", { name: "表情 0，2 人", exact: true })
    .waitFor();
  assert.equal(writes.at(-1).path, "/friends-api/subjects/-/collects/456/like");
  await friendTimeline
    .getByRole("button", { name: "加载更多动态", exact: true })
    .click();
  await friendTimeline.getByText("更早的个人动态", { exact: true }).waitFor();
  assert.match(personalRequests.at(-1), /until=10/);
  await friendTimeline
    .getByRole("button", { name: "加载更多动态", exact: true })
    .click();
  await friendTimeline
    .getByText("已经看到最早的动态了。", { exact: true })
    .waitFor();
  assert.equal(
    await friendTimeline
      .getByText("好友个人时间线评价", { exact: true })
      .count(),
    1,
  );
  await friendTimeline
    .locator(".friend-subject")
    .first()
    .scrollIntoViewIfNeeded();
  const scrollBefore = await friendTimeline.evaluate((el) => el.scrollTop);
  await friendTimeline.locator(".friend-subject").first().click();
  await page.getByRole("dialog", { name: "作品详情", exact: true }).waitFor();
  assert.equal(await page.locator(".user-timeline").getAttribute("inert"), "");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await friendTimeline.waitFor();
  assert.equal(
    await friendTimeline.evaluate((el) => el.scrollTop),
    scrollBefore,
  );
  await friendTimeline.getByText("更早的个人动态", { exact: true }).waitFor();
  personalFailure = true;
  await friendTimeline
    .getByRole("button", { name: "刷新", exact: true })
    .click();
  await friendTimeline.getByRole("alert").waitFor();
  personalFailure = false;
  wrongUser = true;
  await friendTimeline
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await friendTimeline
    .getByRole("alert")
    .filter({ hasText: "接口返回的时间线与用户不一致，请刷新重试。" })
    .waitFor();
  assert.equal(await friendTimeline.locator(".friend-card").count(), 0);
  wrongUser = false;
  personalEmpty = true;
  await friendTimeline
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await friendTimeline
    .getByText("还没有可显示的动态。", { exact: true })
    .waitFor();
  personalEmpty = false;
  await friendTimeline
    .getByRole("button", { name: "刷新", exact: true })
    .click();
  await friendTimeline
    .getByText("好友个人时间线评价", { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await friendTimeline.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/mobile-user-timeline.png" });
  await page.goBack();
  await friendTimeline.waitFor({ state: "detached" });
  await page.goForward();
  await friendTimeline
    .getByText("好友个人时间线评价", { exact: true })
    .waitFor();
  assert.equal(
    popups,
    0,
    "Timeline and subject navigation must stay inside the app",
  );
  await friendTimeline
    .getByRole("button", { name: "返回动态", exact: true })
    .click();
  await friendTimeline.waitFor({ state: "detached" });
  expired = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /更新官方个人令牌/);
  expired = false;
  noFriends = true;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("我自己的动态", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".friend-card").count(),
    1,
    "Own activity must remain visible without friends",
  );
  empty = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page
    .getByText("你和好友暂时还没有动态，过一会儿再来看看吧。", { exact: true })
    .waitFor();
  empty = false;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await myCard
    .getByRole("button", { name: "查看我的时间线", exact: true })
    .click();
  await ownTimeline.getByText("我自己的动态", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const { syncController } = await import("/src/sync.ts");
    await syncController.disconnect();
  });
  await ownTimeline.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => location.hash), "");
  await page.goBack();
  await page
    .getByRole("button", { name: "连接 Bangumi 账号", exact: true })
    .waitFor();
  assert.equal(await page.locator(".user-timeline").count(), 0);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "动态", exact: true })
    .click();
  assert.equal(await page.locator(".friend-card").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) =>
        value.includes("test-friends-token"),
      ),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: own/friend feed and in-app personal timelines, scoped pagination, identity validation, emoji interactions, retry/empty states, narrow layout, nested subject back navigation and history, logout isolation.",
  );
} finally {
  await browser.close();
}
