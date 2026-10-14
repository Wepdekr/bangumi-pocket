import { Preferences } from "@capacitor/preferences";
import {
  checkUpdate,
  installedVersion,
  parseRelease,
  updateLevel,
  type Update,
} from "./updates";
const REQUIRED_UPDATE_KEY = "required-update-v1";
function releaseData(update: Update) {
  return {
    tag_name: `v${update.version}`,
    draft: false,
    prerelease: false,
    body: update.notes,
    assets: [
      {
        name: `bangumi-pocket-${update.version}.apk`,
        state: "uploaded",
        size: update.size,
        browser_download_url: update.apk,
        digest: update.sha256 ? `sha256:${update.sha256}` : undefined,
      },
    ],
  };
}
export async function rememberRequiredUpdate(update: Update) {
  try {
    await Preferences.set({
      key: REQUIRED_UPDATE_KEY,
      value: JSON.stringify(releaseData(update)),
    });
  } catch {
    /* Keep the current launch blocked even if persistence is unavailable. */
  }
}
export async function cachedRequiredUpdate(
  current: string,
): Promise<Update | undefined> {
  try {
    const { value } = await Preferences.get({ key: REQUIRED_UPDATE_KEY });
    if (!value) return;
    const update = parseRelease(JSON.parse(value));
    if (updateLevel(update.version, current) === "major") return update;
  } catch {
    /* Invalid or obsolete cached metadata cannot impose a requirement. */
  }
  try {
    await Preferences.remove({ key: REQUIRED_UPDATE_KEY });
  } catch {
    /* Retry on the next launch. */
  }
}
type StartupResult = { current: string; update?: Update };
let startupTasks:
  | {
      local: Promise<StartupResult>;
      remote: Promise<StartupResult | undefined>;
    }
  | undefined;
export function startupUpdateChecks() {
  // One request per JS launch, including React StrictMode's development remount.
  if (!startupTasks) {
    const current = installedVersion();
    const local = current.then(async (current) => ({
      current,
      update: await cachedRequiredUpdate(current),
    }));
    const remote = current
      .then(async (current) => {
        const update = await checkUpdate();
        if (updateLevel(update.version, current) === "major")
          await rememberRequiredUpdate(update);
        return { current, update };
      })
      .catch(() => undefined);
    startupTasks = {
      local: local.catch(() => ({ current: "", update: undefined })),
      remote,
    };
  }
  return startupTasks;
}
