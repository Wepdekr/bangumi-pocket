import { chromium } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
await build({
  entryPoints: ["src/detail-api.ts"],
  outfile: "artifacts/test-detail-api.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { orderedCharacters } = await import("../artifacts/test-detail-api.mjs");
await build({
  entryPoints: ["src/relation-order.ts"],
  outfile: "artifacts/test-relation-order.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { relationGroups } = await import("../artifacts/test-relation-order.mjs");
const orderingFixture = [
  "原声集",
  "其他",
  "续集",
  "改编",
  "前传",
  "番外篇",
  "总集篇",
  "未知关系",
  "续集",
].map((relation, i) => ({ id: i + 1, name: `关系${i}`, relation }));
assert.deepEqual(
  relationGroups(orderingFixture).map(([label]) => label),
  ["前传", "续集", "总集篇", "番外篇", "改编", "原声集", "未知关系", "其他"],
);
assert.deepEqual(
  relationGroups(orderingFixture)
    .find(([label]) => label === "续集")[1]
    .map((row) => row.id),
  [3, 9],
);
const image = "https://lain.bgm.tv/test-detail.png";
const row = (id, name, type, order, cast = "声优") => ({
  character: { id, name, images: { medium: image } },
  type,
  order,
  casts: [{ person: { id: 1000 + id, name: cast } }],
});
const characters = [
  row(1, "闲角", 4, 0),
  row(2, "配角", 2, 1),
  row(3, "主角二", 1, 2),
  row(4, "主角一", 1, 1),
  row(5, "配角二", 2, 2),
  row(6, "客串", 3, 0, "声优甲 / 声优乙 / 声优丙 / 声优丁"),
];
assert.deepEqual(
  orderedCharacters(characters).map((c) => c.id),
  [4, 3, 2, 5, 6, 1],
);
const browse = JSON.parse(
  await fs.readFile("tests/fixtures/browse.json", "utf8"),
);
const original = { ...browse.data[0], summary: "测试简介 ".repeat(800) };
const related = { ...browse.data[1], id: 987654, name_cn: "关联测试作品" };
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route("https://lain.bgm.tv/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#e9c3ce"/></svg>',
    }),
  );
  let relationError = false;
  await page.route("**/community-api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/characters")) {
      assert.equal(route.request().headers().authorization, undefined);
      const offset = Number(
        new URL(route.request().url()).searchParams.get("offset") || 0,
      );
      return route.fulfill({
        json: {
          data: characters.slice(offset, offset + 2),
          total: characters.length,
        },
      });
    }
    if (path.endsWith("/relations")) {
      if (relationError) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({
        json: [
          {
            subject: { ...related, id: 987655, nameCN: "改编测试作品" },
            relation: { cn: "改编" },
            order: 0,
          },
          {
            subject: { ...related, nameCN: related.name_cn },
            relation: { cn: "续集" },
            order: 0,
          },
          {
            subject: { ...related, id: 987656, nameCN: "前传测试作品" },
            relation: { cn: "前传" },
            order: 0,
          },
        ],
      });
    }
    return route.fulfill({ json: { data: [], total: 0 } });
  });
  await page.route("https://api.bgm.tv/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/calendar") return route.fulfill({ json: [] });
    if (path === `/v0/subjects/${related.id}`)
      return route.fulfill({ json: related });
    if (path === `/v0/subjects/${original.id}`)
      return route.fulfill({ json: original });
    if (path.endsWith("/subjects")) {
      if (relationError) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: browse });
    }
    if (path === "/v0/episodes")
      return route.fulfill({ json: { data: [], total: 0 } });
    return route.fulfill({ json: browse });
  });
  await page.goto("http://localhost:5173");
  await page.locator(".hero h2").waitFor();
  await page.locator(".hero").click();
  await page.locator(".detail-tabs").waitFor();
  assert.equal(await page.locator(".detail-tabs button").count(), 5);
  const initial = await page.locator(".detail-tabs").boundingBox();
  assert.ok(initial.y > 200);
  for (const width of [320, 393, 1024]) {
    await page.setViewportSize({ width, height: 852 });
    await page.locator(".detail").evaluate((el) => {
      el.scrollTop = 650;
    });
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector(".detail-tabs").getBoundingClientRect().top -
            document.querySelector(".detail-top").getBoundingClientRect()
              .bottom,
        ) < 1,
    );
    const overflow = await page.locator(".detail").evaluate((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
      items: [...el.querySelectorAll("*")]
        .filter(
          (n) =>
            n.getBoundingClientRect().right >
            el.getBoundingClientRect().right + 1,
        )
        .slice(0, 5)
        .map((n) => ({
          class: n.className,
          tag: n.tagName,
          right: n.getBoundingClientRect().right,
        })),
    }));
    assert.ok(overflow.scroll <= overflow.width, JSON.stringify(overflow));
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page
    .locator(".detail-tabs")
    .getByRole("button", { name: "角色", exact: true })
    .click();
  await page.locator(".characters button").first().waitFor();
  assert.deepEqual(await page.locator(".characters h3").allTextContents(), [
    "主角一",
    "主角二",
    "配角",
    "配角二",
    "客串",
    "闲角",
  ]);
  const gap = await page
    .locator(".characters button")
    .first()
    .evaluate(
      (el) =>
        el.querySelector("small").getBoundingClientRect().top -
        el.querySelector("h3").getBoundingClientRect().bottom,
    );
  assert.ok(gap <= 8, `Name/actor gap is ${gap}`);
  assert.equal(await page.locator(".characters p:empty").count(), 0);
  await page.screenshot({ path: "artifacts/detail-characters-compact.png" });
  await page
    .locator(".detail-tabs")
    .getByRole("button", { name: "关联", exact: true })
    .click();
  await page
    .getByRole("region", { name: "关联作品" })
    .getByRole("button")
    .first()
    .waitFor();
  assert.deepEqual(
    await page.locator(".relation-group > h3").allTextContents(),
    ["前传", "续集", "改编"],
  );
  await page.screenshot({ path: "artifacts/detail-relations.png" });
  let external = 0;
  await page.exposeFunction("recordExternal", () => external++);
  await page.evaluate(() => {
    window.open = () => {
      window.recordExternal();
      return null;
    };
  });
  await page
    .locator(".relation-row")
    .filter({ hasText: related.name_cn })
    .click();
  await page
    .locator(".detail h1")
    .filter({ hasText: related.name_cn })
    .waitFor();
  assert.equal(new URL(page.url()).hash, `#${related.id}`);
  assert.equal(external, 0);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .locator(".detail h1")
    .filter({ hasText: original.name_cn || original.name })
    .waitFor();
  assert.equal(new URL(page.url()).hash, `#${original.id}`);
  relationError = true;
  await page
    .locator(".detail-tabs")
    .getByRole("button", { name: "关联", exact: true })
    .click();
  await page.getByText("关联作品加载失败", { exact: false }).waitFor();
  relationError = false;
  await page
    .getByRole("region", { name: "关联作品" })
    .getByRole("button", { name: "重试" })
    .click();
  await page.locator(".relation-row").first().waitFor();
  console.log(
    "PASS: sticky tabs at mobile/desktop widths, compact ordered cast, internal relation navigation/back and failure retry.",
  );
} finally {
  await browser.close();
}
