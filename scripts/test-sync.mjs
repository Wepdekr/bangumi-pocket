import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
await mkdir("artifacts", { recursive: true });
await build({
  entryPoints: ["tests/sync.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "artifacts/sync-tests.mjs",
  external: ["@capacitor/core", "@capacitor/preferences"],
});
const result = spawnSync(
  process.execPath,
  ["--test", "artifacts/sync-tests.mjs"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
if (!process.exitCode) {
  await build({
    entryPoints: ["src/account-api.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: "artifacts/account-native-test.mjs",
    plugins: [
      {
        name: "native-http-fixture",
        setup(build) {
          build.onResolve({ filter: /^@capacitor\/core$/ }, () => ({
            path: "core",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const Capacitor = {isNativePlatform:()=>true}; export const CapacitorHttp = {request:async options => {globalThis.progressNativeRequests.push(options);return {status:globalThis.progressNativeStatus,data:globalThis.progressNativeData??{code:202,error:'Accepted'}};}};",
          }));
        },
      },
    ],
  });
  const { accountApi, AccountError } = await import(
    pathToFileURL(path.resolve("artifacts/account-native-test.mjs"))
  );
  globalThis.progressNativeRequests = [];
  globalThis.progressNativeStatus = 200;
  try {
    await accountApi.setEpisodeProgress("native-test-token", 102, {
      batch: true,
      episodeIds: [101, 102],
    });
    await accountApi.setEpisodeProgress("native-test-token", 101, { type: 0 });
    const [batch, single] = globalThis.progressNativeRequests;
    assert.equal(
      batch.url,
      "https://api.bgm.tv/ep/102/status/watched?ep_id=101%2C102",
    );
    assert.equal(batch.method, "POST");
    assert.equal(batch.data, "ep_id=101%2C102");
    assert.equal(
      batch.headers["Content-Type"],
      "application/x-www-form-urlencoded",
    );
    assert.equal(batch.headers.Authorization, "Bearer native-test-token");
    assert.equal(batch.disableRedirects, true);
    assert.equal(single.url, "https://next.bgm.tv/p1/collections/episodes/101");
    assert.deepEqual(single.data, { type: 0 });
    globalThis.progressNativeStatus = 429;
    await assert.rejects(
      accountApi.setEpisodeProgress("native-test-token", 102, {
        batch: true,
        episodeIds: [101, 102],
      }),
      (error) => error instanceof AccountError && error.status === 429,
    );
    assert.equal(
      globalThis.progressNativeRequests.length,
      3,
      "No v0 fallback after a web write fails",
    );
    globalThis.progressNativeStatus = 200;
    globalThis.progressNativeData = { code: 401, error: "Unauthorized" };
    await assert.rejects(
      accountApi.setEpisodeProgress("native-test-token", 102, {
        batch: true,
        episodeIds: [101, 102],
      }),
      (error) => error instanceof AccountError && error.status === 401,
    );
    globalThis.progressNativeData = JSON.stringify({ code: 200, error: "OK" });
    await accountApi.setEpisodeProgress("native-test-token", 102, {
      batch: true,
      episodeIds: [101, 102],
    });
    globalThis.progressNativeData = { code: 304, error: "Not Modified" };
    await accountApi.setEpisodeProgress("native-test-token", 102, {
      batch: true,
      episodeIds: [101, 102],
    });
    for (const invalid of [{}, [], "<html>unexpected response</html>"]) {
      globalThis.progressNativeData = invalid;
      await assert.rejects(
        accountApi.setEpisodeProgress("native-test-token", 102, {
          batch: true,
          episodeIds: [101, 102],
        }),
        (error) =>
          !(error instanceof AccountError) &&
          /未确认|未返回可确认/.test(error.message),
      );
    }
    console.log(
      "PASS: Android query IDs and form agree, official success descriptions are accepted, HTTP-200 failures are rejected, malformed responses do not fabricate 500, redirects remain disabled.",
    );
  } finally {
    delete globalThis.progressNativeRequests;
    delete globalThis.progressNativeStatus;
    delete globalThis.progressNativeData;
  }
}
