import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
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
