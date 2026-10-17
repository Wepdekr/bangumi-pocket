import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncController } from "../src/sync";
import { accountApi, accountRequest, AccountError } from "../src/account-api";
import { watchedThrough, planWatchedThrough } from "../src/episode-progress";
import { imageUrl } from "../src/images";
import { batchProgressText, progressAction } from "../src/timeline-text";
import type { FriendEvent } from "../src/friends-api";
import type {
  RemoteCollection,
  Saved,
  Session,
  Subject,
  Review,
} from "../src/types";

const subject = (id: number): Subject => ({
  id,
  type: 2,
  name: `作品 ${id}`,
  images: { large: "https://example.com/cover.jpg" },
});
const saved = (
  id: number,
  status: Saved["status"] = "wish",
  watched: number[] = [],
): Saved => ({ subject: subject(id), status, watched, updated: 1 });
const remote = (id: number, type = 3, watched: number[] = []) => ({
  subject_id: id,
  subject_type: 2,
  type,
  subject: subject(id),
  ep_status: watched.length,
  private: true,
  rate: 9,
  comment: "保留原有短评",
  tags: ["我的标签"],
  updated_at: "2026-01-01T00:00:00Z",
  watched,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("Personal timeline requests are authenticated, scoped, and rejected after an account switch", async () => {
  const c = harness().create();
  const user = { id: 88, username: "friend", nickname: "好友" };
  await c.initialize();
  await assert.rejects(c.userTimeline(user, 100), /请先连接/);
  await c.connect("test-account-1");
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "/friends-api/users/friend/timeline?limit=20&until=100",
    );
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-account-1",
    );
    assert.equal(init?.credentials, "omit");
    return await new Promise<Response>((resolve) => {
      release = resolve;
    });
  };
  try {
    const request = c.userTimeline(user, 100);
    const rejected = assert.rejects(request, /账号已切换/);
    await c.connect("test-account-2");
    release(
      new Response(
        JSON.stringify([
          {
            id: 99,
            uid: 88,
            createdAt: 1,
            cat: 5,
            type: 1,
            memo: { status: { tsukkomi: "旧账号请求" } },
          },
        ]),
      ),
    );
    await rejected;
    assert.equal(c.getSnapshot().user?.id, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function harness(guest: Record<number, Saved> = {}) {
  const storage = new Map<string, string>();
  let session: Session | null = null;
  const accounts: Record<number, Record<number, ReturnType<typeof remote>>> = {
    1: {},
    2: {},
  };
  const calls: {
    kind: string;
    user: number;
    id?: number;
    status?: string;
    episodes?: number[];
    watched?: boolean;
    review?: Review;
    batch?: boolean;
  }[] = [];
  let offline = false,
    failSecondPage = false,
    failClear = false,
    failReview = false;
  const uid = (token: string) => {
    if (token === "test-account-1") return 1;
    if (token === "test-account-2") return 2;
    throw new AccountError(401);
  };
  const online = () => {
    if (offline) throw new AccountError(0);
  };
  const deps = {
    vault: {
      read: async () => clone(session),
      write: async (value: Session) => {
        session = clone(value);
      },
      clear: async () => {
        session = null;
      },
    },
    get: async (key: string) => storage.get(key) ?? null,
    set: async (key: string, value: string) => {
      storage.set(key, value);
    },
    readGuest: async () => clone(guest),
    writeGuest: async (library: Record<number, Saved>) => {
      guest = clone(library);
    },
    api: {
      setEpisodeProgress: async (
        token: string,
        episodeId: number,
        progress: { batch: true } | { type: 0 | 2 },
      ) => {
        online();
        const batch = "batch" in progress;
        const watched = batch || progress.type === 2;
        if (!watched && failClear) throw new AccountError(0);
        const user = uid(token);
        const id = 1;
        const row = accounts[user][id];
        if (!row) throw new AccountError(400);
        const episodes = batch
          ? [101, 102, 103].filter((ep) => ep <= episodeId)
          : [episodeId];
        calls.push({ kind: "episodes", user, id, episodes, watched, batch });
        const next = new Set(row.watched);
        for (const ep of episodes) {
          if (watched) next.add(ep);
          else next.delete(ep);
        }
        row.watched = [...next];
        row.ep_status = next.size;
      },
      me: async (token: string) => {
        online();
        const id = uid(token);
        return { id, username: `user${id}`, nickname: `账号${id}` };
      },
      collections: async (token: string, username: string, offset = 0) => {
        online();
        const id = uid(token);
        assert.equal(
          username,
          `user${id}`,
          "收藏接口必须使用用户名，不能使用 UID",
        );
        if (failSecondPage && offset > 0) throw new AccountError(0);
        const all = Object.values(accounts[id]);
        return {
          data: clone(all.slice(offset, offset + 1)) as RemoteCollection[],
          total: all.length,
        };
      },
      episodes: async (token: string, id: number, offset = 0) => {
        online();
        const user = uid(token);
        const watched = accounts[user][id]?.watched || [];
        const data = [101, 102, 103].map((ep) => ({
          type: watched.includes(ep) ? 2 : 0,
          episode: {
            id: ep,
            sort: ep - 100,
            name: "",
            name_cn: "",
            airdate: "",
            type: 0,
          },
        }));
        return { data: data.slice(offset), total: data.length };
      },
      setCollection: async (
        token: string,
        id: number,
        status: Saved["status"],
        review?: Review,
      ) => {
        online();
        if (review && failReview) throw new AccountError(0);
        const user = uid(token);
        calls.push({ kind: "collection", user, id, status, review });
        const type = { wish: 1, done: 2, doing: 3, hold: 4, dropped: 5 }[
          status
        ];
        accounts[user][id] = {
          ...(accounts[user][id] || remote(id)),
          type,
          ...review,
        };
      },
      setEpisodes: async (
        token: string,
        id: number,
        episodes: number[],
        watched: boolean,
      ) => {
        online();
        if (!watched && failClear) throw new AccountError(0);
        const user = uid(token);
        calls.push({ kind: "episodes", user, id, episodes, watched });
        const row = accounts[user][id];
        if (!row) throw new AccountError(400);
        const next = new Set(row.watched);
        for (const ep of episodes) {
          if (watched) next.add(ep);
          else next.delete(ep);
        }
        row.watched = [...next];
        row.ep_status = next.size;
      },
    },
  };
  return {
    deps,
    accounts,
    calls,
    storage,
    get session() {
      return session;
    },
    get guest() {
      return guest;
    },
    set offline(value: boolean) {
      offline = value;
    },
    set failSecondPage(value: boolean) {
      failSecondPage = value;
    },
    set failClear(value: boolean) {
      failClear = value;
    },
    set failReview(value: boolean) {
      failReview = value;
    },
    create: () => new SyncController(deps),
  };
}
test("Connecting downloads every page and keeps guest data separate without uploading it", async () => {
  const h = harness({ 9: saved(9) });
  h.accounts[1] = { 1: remote(1), 2: remote(2, 2) };
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  assert.deepEqual(Object.keys(c.getSnapshot().library), ["1", "2"]);
  assert.equal(c.getSnapshot().library[2].status, "done");
  assert.equal(c.getSnapshot().guestCount, 1);
  assert.equal(h.calls.length, 0);
  await c.disconnect();
  assert.deepEqual(Object.keys(c.getSnapshot().library), ["9"]);
  assert.equal(h.session, null);
});
test("401 authentication failure does not save an unverified token or erase current data", async () => {
  const h = harness({ 9: saved(9) });
  const c = h.create();
  await c.initialize();
  await assert.rejects(
    c.connect("invalid"),
    (e) => e instanceof AccountError && e.status === 401,
  );
  assert.equal(h.session, null);
  assert.deepEqual(Object.keys(c.getSnapshot().library), ["9"]);
});
test("Collection and chapter updates preserve remote rating, privacy, tags and comments", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1, 3, [101]);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  await c.hydrate(1);
  await c.save(subject(1), "hold", [101, 102]);
  const row = h.accounts[1][1];
  assert.equal(row.type, 4);
  assert.equal(row.rate, 9);
  assert.equal(row.comment, "保留原有短评");
  assert.equal(row.private, true);
  assert.deepEqual(row.tags, ["我的标签"]);
  assert.deepEqual(
    h.calls.find((call) => call.kind === "episodes")?.episodes,
    [102],
  );
  assert.equal(c.getSnapshot().pending, 0);
});
test("Offline edits survive restart and are uploaded only to the original account", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  h.offline = true;
  assert.equal(await c.save(subject(1), "hold"), false);
  assert.equal(c.getSnapshot().pending, 1);
  const restarted = h.create();
  await restarted.initialize();
  assert.equal(restarted.getSnapshot().library[1].status, "hold");
  assert.equal(restarted.getSnapshot().pending, 1);
  h.offline = false;
  await restarted.connect("test-account-2");
  assert.deepEqual(restarted.getSnapshot().library, {});
  assert.equal(h.accounts[1][1].type, 3);
  assert.equal(h.calls.length, 0);
  await restarted.connect("test-account-1");
  assert.equal(h.accounts[1][1].type, 4);
  assert.equal(restarted.getSnapshot().pending, 0);
  assert.equal(h.calls[0].user, 1);
});
test("A failed later page cannot replace or truncate a previously complete library", async () => {
  const h = harness();
  h.accounts[1] = { 1: remote(1), 2: remote(2) };
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  const before = c.getSnapshot().lastSync;
  h.accounts[1][3] = remote(3);
  h.failSecondPage = true;
  assert.equal(await c.sync(), false);
  assert.deepEqual(Object.keys(c.getSnapshot().library), ["1", "2"]);
  assert.equal(c.getSnapshot().lastSync, before);
});
test("Refreshing follows remote edits even if updated_at is unchanged, including deletion", async () => {
  const h = harness();
  h.accounts[1] = { 1: remote(1), 2: remote(2) };
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  h.accounts[1][1].type = 2;
  delete h.accounts[1][2];
  await c.sync();
  assert.equal(c.getSnapshot().library[1].status, "done");
  assert.equal(c.getSnapshot().library[2], undefined);
});
test("Progress must be hydrated before editing an existing cloud item", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1, 3, [101]);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  await assert.rejects(
    c.save(subject(1), "doing", [102]),
    /先加载账号章节进度/,
  );
  assert.equal(h.calls.length, 0);
  await c.hydrate(1);
  assert.deepEqual(c.getSnapshot().library[1].watched, [101]);
});
test("Partial chapter success acknowledges only successful fields and retry resumes the remaining change", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1, 3, [101]);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  await c.hydrate(1);
  h.failClear = true;
  assert.equal(await c.save(subject(1), "doing", [102]), false);
  assert.equal(c.getSnapshot().pending, 1);
  assert.deepEqual(h.accounts[1][1].watched, [101, 102]);
  const pending = JSON.parse(h.storage.get("account-library-v1:1")!).pending[1];
  assert.deepEqual(pending.progress, [{ episodeId: 101, type: 0 }]);
  h.failClear = false;
  await c.sync();
  assert.deepEqual(h.accounts[1][1].watched, [102]);
  assert.equal(h.calls.filter((call) => call.watched === true).length, 1);
  assert.equal(c.getSnapshot().pending, 0);
});
test("Import adds new entries and viewed chapters without replacing an existing remote status", async () => {
  const h = harness({ 1: saved(1, "wish", [102]), 2: saved(2, "wish") });
  h.accounts[1][1] = remote(1, 4, [101]);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  await c.importGuest();
  assert.equal(h.accounts[1][1].type, 4);
  assert.deepEqual(h.accounts[1][1].watched, [101, 102]);
  assert.equal(h.accounts[1][2].type, 1);
  assert.equal(h.accounts[1][1].private, true);
  assert.equal(h.guest[1].status, "wish");
});
test("Cloud deletion cannot accidentally turn into a local-only removal", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  await assert.rejects(c.save(subject(1), null), /Bangumi 原站/);
  assert.ok(c.getSnapshot().library[1]);
  assert.equal(h.calls.length, 0);
});
test("Reviews persist offline across restart and sync without changing privacy or tags", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1);
  let c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  assert.equal(c.getSnapshot().library[1].rate, 9);
  h.offline = true;
  assert.equal(
    await c.save(subject(1), "done", undefined, {
      rate: 8,
      comment: "新的感想\n第二行",
    }),
    false,
  );
  c = h.create();
  await c.initialize();
  assert.equal(c.getSnapshot().library[1].comment, "新的感想\n第二行");
  h.offline = false;
  await c.sync();
  assert.equal(h.accounts[1][1].rate, 8);
  assert.equal(h.accounts[1][1].comment, "新的感想\n第二行");
  assert.equal(h.accounts[1][1].type, 2);
  assert.equal(h.accounts[1][1].private, true);
  assert.deepEqual(h.accounts[1][1].tags, ["我的标签"]);
  assert.equal(c.getSnapshot().pending, 0);
  await c.save(subject(1), "done", undefined, { rate: 0, comment: "" });
  assert.equal(h.accounts[1][1].rate, 0);
  assert.equal(h.accounts[1][1].comment, "");
});
test("Failed collection upload keeps status and review together across restart", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1);
  let c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  h.failReview = true;
  const review = { rate: 10, comment: "非常喜欢" };
  assert.equal(await c.save(subject(1), "done", undefined, review), false);
  assert.equal(h.accounts[1][1].type, 3);
  assert.equal(h.calls.length, 0);
  c = h.create();
  await c.initialize();
  const pending = JSON.parse(h.storage.get("account-library-v1:1")!).pending[1];
  assert.equal(pending.status, "done");
  assert.deepEqual(pending.review, review);
  h.failReview = false;
  await c.sync();
  assert.deepEqual(
    h.calls.map((call) => call.kind),
    ["collection"],
  );
  assert.equal(h.calls[0].status, "done");
  assert.deepEqual(h.calls[0].review, review);
  assert.equal(c.getSnapshot().pending, 0);
});

test("Failed chapter write retries chapters without repeating the successful rated collection", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1, 3, [101]);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  await c.hydrate(1);
  h.failClear = true;
  assert.equal(
    await c.save(subject(1), "done", [102], { rate: 8, comment: "感想" }),
    false,
  );
  const count = h.calls.length;
  const pending = JSON.parse(h.storage.get("account-library-v1:1")!).pending[1];
  assert.equal(pending.status, undefined);
  assert.equal(pending.review, undefined);
  assert.deepEqual(pending.progress, [{ episodeId: 101, type: 0 }]);
  h.failClear = false;
  await c.sync();
  assert.deepEqual(
    h.calls.slice(count).map((call) => call.kind),
    ["episodes"],
  );
  assert.equal(h.accounts[1][1].rate, 8);
  assert.equal(h.accounts[1][1].comment, "感想");
});

test("Local reviews survive progress and status changes; invalid ratings are rejected", async () => {
  const h = harness();
  const c = h.create();
  await c.initialize();
  await c.save(subject(1), "done", undefined, { rate: 7, comment: "本机短评" });
  await c.save(subject(1), "doing", [101]);
  assert.equal(c.getSnapshot().library[1].rate, 7);
  assert.equal(h.guest[1].comment, "本机短评");
  await assert.rejects(
    c.save(subject(1), "done", undefined, { rate: 11, comment: "" }),
    /评分/,
  );
});
test("Watched-through resolves paginated real IDs by episode number and preserves later progress", async () => {
  const episode = (id: number, sort: number, type = 0) => ({
    id,
    sort,
    type,
    name: "",
    name_cn: "",
    airdate: "",
  });
  const target = episode(45, 3);
  const offsets: number[] = [];
  const watched = await watchedThrough(
    target,
    [900],
    [target, episode(11, 1)],
    5,
    async (offset) => {
      offsets.push(offset);
      return {
        total: 5,
        data: [episode(67, 2), episode(90, 4), episode(77, 0.5, 1)],
      };
    },
  );
  assert.deepEqual(offsets, [2]);
  assert.deepEqual(new Set(watched), new Set([900, 45, 11, 67]));
  const repeated = await watchedThrough(
    target,
    watched,
    [episode(11, 1), target],
    2,
    async () => {
      throw new Error("Unexpected request");
    },
  );
  assert.deepEqual(new Set(repeated), new Set(watched));
});
test("Watched-through refuses incomplete or duplicate pages without modifying saved progress", async () => {
  const target = {
    id: 1,
    sort: 1,
    type: 0,
    name: "",
    name_cn: "",
    airdate: "",
  };
  const watched = [9];
  await assert.rejects(
    watchedThrough(target, watched, [target], 2, async () => ({
      total: 2,
      data: [],
    })),
    /完整加载/,
  );
  await assert.rejects(
    watchedThrough(target, watched, [target], 2, async () => ({
      total: 2,
      data: [target],
    })),
    /异常/,
  );
  assert.deepEqual(watched, [9]);
});

test("Anime and live-action watched-through use one web batch operation and keep later watched episodes", async () => {
  for (const type of [2, 6]) {
    const h = harness();
    h.accounts[1][1] = remote(1, 3, [102, 103]);
    const c = h.create();
    await c.initialize();
    await c.connect("test-account-1");
    await c.hydrate(1);
    const chapters = [101, 102, 103].map((id) => ({
      id,
      sort: id - 100,
      type: 0,
      name: "",
      name_cn: "",
      airdate: "",
    }));
    const plan = await planWatchedThrough(
      chapters[1],
      [102, 103],
      chapters,
      3,
      async () => {
        throw new Error("Unexpected pagination");
      },
    );
    assert.equal(
      await c.save(
        { ...subject(1), type },
        "doing",
        plan.watched,
        undefined,
        plan.through,
      ),
      true,
    );
    assert.deepEqual(
      h.calls.map((call) => ({ episodes: call.episodes, batch: call.batch })),
      [{ episodes: [101, 102], batch: true }],
    );
    assert.deepEqual(
      new Set(h.accounts[1][1].watched),
      new Set([101, 102, 103]),
    );
    assert.equal(h.accounts[1][1].rate, 9);
    assert.equal(h.accounts[1][1].private, true);
    assert.equal(c.getSnapshot().pending, 0);
  }
});

test("Offline batch and subsequent single edits retain order across restart and partial success", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1, 3, [103]);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  await c.hydrate(1);
  h.offline = true;
  assert.equal(
    await c.save(subject(1), "doing", [103, 101, 102], undefined, {
      episodeId: 102,
      episodeIds: [101, 102],
    }),
    false,
  );
  assert.equal(await c.save(subject(1), "doing", [103, 102]), false);
  const pending = JSON.parse(h.storage.get("account-library-v1:1")!).pending[1];
  assert.deepEqual(pending.episodes, {});
  assert.deepEqual(pending.progress, [
    { episodeId: 102, episodeIds: [101, 102], batch: true },
    { episodeId: 101, type: 0 },
  ]);
  h.offline = false;
  h.failClear = true;
  const restarted = h.create();
  await restarted.initialize();
  assert.equal(restarted.getSnapshot().pending, 1);
  assert.deepEqual(new Set(h.accounts[1][1].watched), new Set([101, 102, 103]));
  const cached = JSON.parse(h.storage.get("account-library-v1:1")!);
  assert.deepEqual(cached.pending[1].progress, [{ episodeId: 101, type: 0 }]);
  // A further batch must run after the pending uncheck, never before it.
  assert.equal(
    await restarted.save(subject(1), "doing", [103, 102, 101], undefined, {
      episodeId: 101,
      episodeIds: [101],
    }),
    false,
  );
  h.failClear = false;
  assert.equal(await restarted.sync(), true);
  assert.deepEqual(
    h.calls.map((call) => [call.batch, call.episodes, call.watched]),
    [
      [true, [101, 102], true],
      [false, [101], false],
      [true, [101], true],
    ],
  );
  assert.deepEqual(new Set(h.accounts[1][1].watched), new Set([101, 102, 103]));
  assert.equal(restarted.getSnapshot().pending, 0);
});

test("Hydration overlays pending web batches and single edits; legacy pending edits remain supported", async () => {
  const h = harness();
  h.accounts[1][1] = remote(1, 3, [103]);
  const c = h.create();
  await c.initialize();
  await c.connect("test-account-1");
  const cache = JSON.parse(h.storage.get("account-library-v1:1")!);
  cache.pending[1] = {
    episodes: { 102: true },
    progress: [
      { episodeId: 102, episodeIds: [101, 102], batch: true },
      { episodeId: 101, type: 0 },
    ],
  };
  h.storage.set("account-library-v1:1", JSON.stringify(cache));
  h.failClear = true;
  // Block the legacy write so hydration must overlay the entire pending journal.
  const legacy = h.deps.api.setEpisodes;
  h.deps.api.setEpisodes = async () => {
    throw new AccountError(0);
  };
  const restarted = h.create();
  await restarted.initialize();
  assert.equal(await restarted.hydrate(1), true);
  assert.deepEqual(
    new Set(restarted.getSnapshot().library[1].watched),
    new Set([102, 103]),
  );
  h.deps.api.setEpisodes = legacy;
  h.failClear = false;
  assert.equal(await restarted.sync(), true);
  assert.deepEqual(
    h.calls.map((call) => [call.batch, call.episodes]),
    [
      [undefined, [102]],
      [true, [101, 102]],
      [false, [101]],
    ],
  );
  assert.deepEqual(new Set(h.accounts[1][1].watched), new Set([102, 103]));
});

test("Web progress transport uses website payloads and keeps failed batches queued without v0 fallback", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body: unknown }[] = [];
  let status = 200;
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, "PATCH");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-account-1",
    );
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status });
  };
  try {
    await accountApi.setEpisodeProgress("test-account-1", 102, { batch: true });
    await accountApi.setEpisodeProgress("test-account-1", 101, { type: 0 });
    assert.deepEqual(requests, [
      { url: "/account-api/collections/episodes/102", body: { batch: true } },
      { url: "/account-api/collections/episodes/101", body: { type: 0 } },
    ]);
    for (const failure of [401, 403, 404, 429, 500]) {
      status = failure;
      const h = harness();
      h.accounts[1][1] = remote(1, 3, [103]);
      h.deps.api.setEpisodeProgress = accountApi.setEpisodeProgress;
      const c = h.create();
      await c.initialize();
      await c.connect("test-account-1");
      await c.hydrate(1);
      const before = requests.length;
      assert.equal(
        await c.save(subject(1), "doing", [103, 101, 102], undefined, {
          episodeId: 102,
          episodeIds: [101, 102],
        }),
        false,
      );
      assert.equal(requests.length, before + 1);
      assert.equal(h.calls.length, 0);
      assert.equal(c.getSnapshot().pending, 1);
      assert.deepEqual(c.getSnapshot().library[1].watched, [103, 101, 102]);
      assert.match(
        c.getSnapshot().error,
        failure === 429
          ? /频繁/
          : failure === 401
            ? /失效/
            : failure === 403
              ? /权限/
              : /章节进度失败/,
      );
      status = 200;
      assert.equal(await c.sync(), true);
      assert.equal(c.getSnapshot().pending, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Timeline distinguishes cumulative completion from single episode status without phantom volumes", () => {
  const batch = {
    subject: { ...subject(1), type: 2 },
    epsUpdate: 2,
    epsTotal: "12",
    volsUpdate: 0,
    volsTotal: "??",
  };
  const event = {
    cat: 4,
    type: 0,
    memo: { progress: { batch } },
  } as FriendEvent;
  assert.equal(progressAction(event), "完成了");
  assert.equal(batchProgressText(batch), "2 of 12 话");
  assert.equal(batchProgressText({ ...batch, epsUpdate: 0 }), "0 of 12 话");
  assert.equal(batchProgressText({ ...batch, epsTotal: "??" }), "2 话");
  for (const [type, text] of [
    [1, "想看"],
    [2, "看过"],
    [3, "抛弃"],
  ] as const) {
    assert.equal(
      progressAction({
        ...event,
        type,
        memo: {
          progress: { single: { subject: subject(1), episode: { sort: 26 } } },
        },
      }),
      text,
    );
  }
});
test("Legacy image addresses are upgraded without changing their paths or cache queries", () => {
  assert.equal(
    imageUrl("http://lain.bgm.tv/pic/cover/l/a.jpg?r=123"),
    "https://lain.bgm.tv/pic/cover/l/a.jpg?r=123",
  );
  assert.equal(
    imageUrl("https://lain.bgm.tv/pic/cover/l/a.jpg"),
    "https://lain.bgm.tv/pic/cover/l/a.jpg",
  );
  assert.equal(
    imageUrl("//lain.bgm.tv/pic/user/m/1.jpg"),
    "https://lain.bgm.tv/pic/user/m/1.jpg",
  );
  assert.equal(imageUrl(undefined), undefined);
  assert.equal(imageUrl("javascript:alert(1)"), undefined);
});

// Model the official server's mayCreateTimeline: only requests containing type
// emit a collection event, whose review is copied from the request body.
test("Actual account transport sends complete reviews in collection timeline payloads", async () => {
  const h = harness();
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  const timeline: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  let exists = true;
  globalThis.fetch = async (_input, init) => {
    const method = init?.method ?? "GET";
    const body = JSON.parse(String(init?.body ?? "{}"));
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-account-1",
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    requests.push({ method, body });
    if (method === "PATCH" && !exists)
      return new Response("{}", { status: 404 });
    exists = true;
    Object.assign(h.accounts[1][1], body);
    if ("type" in body)
      timeline.push({
        type: body.type,
        rate: body.rate ?? 0,
        comment: body.comment ?? "",
      });
    return new Response(null, { status: 204 });
  };
  try {
    h.accounts[1][1] = remote(1);
    // Reproduce the previous sequence: review stored, timeline review empty.
    await accountRequest(
      "test-account-1",
      "/v0/users/-/collections/1",
      "PATCH",
      { type: 2 },
    );
    await accountRequest(
      "test-account-1",
      "/v0/users/-/collections/1",
      "PATCH",
      { rate: 8, comment: "感想" },
    );
    assert.equal(h.accounts[1][1].rate, 8);
    assert.equal(h.accounts[1][1].comment, "感想");
    assert.deepEqual(timeline.pop(), { type: 2, rate: 0, comment: "" });
    requests.length = 0;
    h.accounts[1][1] = remote(1);
    h.deps.api.setCollection = accountApi.setCollection;
    const c = h.create();
    await c.initialize();
    await c.connect("test-account-1");
    for (const status of ["done", "hold", "dropped"] as const) {
      const review = { rate: 8, comment: `感想 ${status}` };
      assert.equal(await c.save(subject(1), status, undefined, review), true);
      assert.deepEqual(requests.at(-1)?.body, {
        type: { done: 2, hold: 4, dropped: 5 }[status],
        ...review,
      });
      assert.deepEqual(timeline.at(-1), requests.at(-1)?.body);
    }
    assert.equal(
      requests.length,
      3,
      "One collection request for each rated status change",
    );
    assert.equal(c.getSnapshot().pending, 0);
    // Editing only a review still supplies its unchanged collection status.
    await c.save(subject(1), "dropped", undefined, { rate: 0, comment: "" });
    assert.deepEqual(timeline.at(-1), { type: 5, rate: 0, comment: "" });
    // New collections retain the same complete payload through PATCH -> POST.
    exists = false;
    await accountApi.setCollection("test-account-1", 1, "done", {
      rate: 10,
      comment: "新收藏",
    });
    assert.deepEqual(
      requests.slice(-2).map((r) => r.method),
      ["PATCH", "POST"],
    );
    assert.deepEqual(requests.at(-2)?.body, requests.at(-1)?.body);
    assert.deepEqual(timeline.at(-1), { type: 2, rate: 10, comment: "新收藏" });
    assert.equal("private" in requests.at(-1)!.body, false);
    assert.equal("tags" in requests.at(-1)!.body, false);
    await accountApi.setCollection("test-account-1", 1, "wish");
    assert.deepEqual(
      requests.at(-1)?.body,
      { type: 1 },
      "Skipping a review does not erase stored review fields",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
