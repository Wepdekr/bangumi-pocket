import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const browse = JSON.parse(
  await fs.readFile("tests/fixtures/browse.json", "utf8"),
);
const calendar = JSON.parse(
  await fs.readFile("tests/fixtures/calendar.json", "utf8"),
);
const subject = { ...browse.data[0], eps: 2, total_episodes: 2 };
const guest = browse.data[1];
const cloud = {
  subject_id: subject.id,
  subject_type: 2,
  type: 3,
  ep_status: 1,
  private: true,
  rate: 9,
  comment: "原有短评",
  tags: ["原有标签"],
  updated_at: "2026-01-01T00:00:00Z",
  subject: { ...subject, score: subject.rating.score },
};
let offline = false,
  expired = false;
const watched = new Set([1001]);
const writes = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(
  ({ guest }) =>
    localStorage.setItem(
      "CapacitorStorage.library-v1",
      JSON.stringify({
        [guest.id]: { subject: guest, status: "wish", watched: [], updated: 1 },
      }),
    ),
  { guest },
);
await page.route("https://api.bgm.tv/**", async (route) => {
  const request = route.request(),
    url = new URL(request.url()),
    method = request.method();
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  };
  const json = (data, status = 200) =>
    route.fulfill({ status, json: data, headers });
  const authorized =
    request.headers().authorization === "Bearer test-ui-account";
  if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
  if (url.pathname === "/v0/me")
    return authorized
      ? json({ id: 123, username: "pocket_tester", nickname: "同步测试账号" })
      : json({ error: "unauthorized" }, 401);
  if (url.pathname.startsWith("/v0/users/")) {
    if (!authorized || expired) return json({ error: "unauthorized" }, 401);
    if (offline) return route.abort();
    // Production returns 404 for the numeric UID of an account with a username.
    if (url.pathname === "/v0/users/123/collections")
      return json({ error: "user not found" }, 404);
    if (url.pathname === "/v0/users/pocket_tester/collections")
      return json({ total: 1, data: [{ ...cloud, ep_status: watched.size }] });
    if (
      url.pathname === `/v0/users/-/collections/${subject.id}` &&
      method === "PATCH"
    ) {
      const body = request.postDataJSON();
      if ("type" in body) {
        assert.deepEqual(Object.keys(body), ["type"]);
        cloud.type = body.type;
        writes.push({ kind: "status", body });
      } else {
        assert.deepEqual(Object.keys(body).sort(), ["comment", "rate"]);
        Object.assign(cloud, body);
        writes.push({ kind: "review", body });
      }
      return route.fulfill({ status: 204, headers });
    }
    if (url.pathname === `/v0/users/-/collections/${subject.id}/episodes`) {
      if (method === "PATCH") {
        const body = request.postDataJSON();
        for (const id of body.episode_id) {
          if (body.type === 2) watched.add(id);
          else watched.delete(id);
        }
        writes.push({ kind: "episodes", body });
        return route.fulfill({ status: 204, headers });
      }
      return json({
        total: 2,
        data: [1001, 1002].map((id, i) => ({
          type: watched.has(id) ? 2 : 0,
          episode: {
            id,
            sort: i + 1,
            name: "",
            name_cn: `第${i + 1}话`,
            type: 0,
            airdate: "2008-10-02",
          },
        })),
      });
    }
    throw new Error(`Unexpected account API ${method} ${url.pathname}`);
  }
  if (url.pathname === "/calendar") return json(calendar);
  if (url.pathname === "/v0/subjects") return json(browse);
  if (url.pathname === `/v0/subjects/${subject.id}`) return json(subject);
  if (url.pathname === "/v0/episodes")
    return json({
      total: 2,
      data: [1001, 1002].map((id, i) => ({
        id,
        sort: i + 1,
        name: "",
        name_cn: `第${i + 1}话`,
        type: 0,
        airdate: "2008-10-02",
      })),
    });
  if (url.pathname.endsWith("/characters")) return json([]);
  return route.abort();
});
try {
  await page.goto("http://localhost:5173");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  await page
    .getByLabel("个人访问令牌", { exact: true })
    .fill("invalid-ui-token");
  await page.getByRole("button", { name: "连接并同步", exact: true }).click();
  await page.locator(".sync-error").waitFor();
  assert.equal(await page.locator(".account-profile").count(), 0);
  await page
    .getByLabel("个人访问令牌", { exact: true })
    .fill("test-ui-account");
  await page.getByRole("button", { name: "连接并同步", exact: true }).click();
  await page.getByRole("button", { name: "立即同步", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".account-actions .secondary").disabled,
  );
  assert.equal(await page.locator(".subject-row").count(), 1);
  assert.match(await page.locator(".subject-row h3").innerText(), /CLANNAD/);
  assert.equal(
    writes.length,
    0,
    "Guest items were uploaded without the explicit import action",
  );
  assert.equal(
    await page.evaluate(() =>
      Object.values(localStorage).some((v) => v.includes("test-ui-account")),
    ),
    false,
    "Bearer token leaked into localStorage",
  );
  await page.screenshot({ path: "artifacts/mobile-account-connected.png" });
  await page.locator(".subject-row").click();
  await page.getByRole("button", { name: "章节", exact: true }).click();
  await page
    .getByRole("button", { name: "取消标记第1话", exact: true })
    .waitFor();
  const second = page.getByRole("button", {
    name: "标记看过第2话",
    exact: true,
  });
  await second.waitFor();
  await page.getByRole("button", { name: "看到第2话", exact: true }).click();
  const review = page.getByRole("dialog", {
    name: "看完了，留下你的感想",
    exact: true,
  });
  await review.waitFor();
  assert.equal(await review.getByLabel("短评").inputValue(), "原有短评");
  assert.equal(
    await review
      .getByRole("button", { name: "评9分", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await review
    .getByRole("button", { name: "暂不评价，标记看过", exact: true })
    .click();
  await page
    .getByRole("button", { name: "取消标记第2话", exact: true })
    .waitFor();
  assert.deepEqual(writes.find((w) => w.kind === "episodes").body, {
    episode_id: [1002],
    type: 2,
  });
  assert.equal(cloud.type, 2);
  assert.equal(
    cloud.rate,
    9,
    "Skipping a review must preserve the previous rating",
  );
  assert.equal(cloud.comment, "原有短评");
  await page
    .getByRole("dialog", { name: "作品详情", exact: true })
    .getByRole("button", { name: "看过", exact: true })
    .click();
  await review.waitFor();
  await review.getByRole("button", { name: "取消评价", exact: true }).click();
  assert.equal(cloud.rate, 9);
  assert.equal(cloud.comment, "原有短评");
  await page
    .getByRole("dialog", { name: "作品详情", exact: true })
    .getByRole("button", { name: "看过", exact: true })
    .click();
  await review.waitFor();
  await review.getByRole("button", { name: "评8分", exact: true }).click();
  await review.getByLabel("短评").fill("新的短评");
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Review dialog overflows on narrow phones",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/mobile-review.png" });
  await review
    .getByRole("button", { name: "保存并标记看过", exact: true })
    .click();
  await review.waitFor({ state: "detached" });
  assert.deepEqual(writes.find((w) => w.kind === "review").body, {
    rate: 8,
    comment: "新的短评",
  });
  offline = true;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "搁置", exact: true })
    .click();
  await page
    .getByRole("button", { name: "暂不评价，标记搁置", exact: true })
    .click();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".sync-summary")?.textContent.includes("待同步"),
  );
  assert.match(await page.locator(".sync-error").innerText(), /网络连接失败/);
  await page.screenshot({ path: "artifacts/mobile-account-offline.png" });
  offline = false;
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".sync-summary")
        ?.textContent.includes("上次同步") &&
      !document.querySelector(".account-actions .secondary").disabled,
  );
  assert.equal(cloud.type, 4);
  assert.equal(cloud.private, true);
  assert.equal(cloud.rate, 8);
  assert.equal(cloud.comment, "新的短评");
  expired = true;
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await page.locator(".sync-error").waitFor();
  assert.match(await page.locator(".sync-error").innerText(), /授权已失效/);
  expired = false;
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("button", { name: "连接并同步", exact: true }).waitFor();
  assert.match(
    await page.locator(".subject-row h3").innerText(),
    new RegExp(guest.name_cn || guest.name),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: "artifacts/mobile-account-login.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: invalid authorization, authenticated download, wire-format/204 writes, selective chapter updates, offline retry, expired token, guest isolation, logout and token non-persistence.",
  );
} finally {
  await browser.close();
}
