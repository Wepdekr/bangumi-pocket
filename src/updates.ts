import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { version } from "../package.json";

export const RELEASES_URL =
  "https://github.com/Wepdekr/bangumi-pocket/releases/latest";
const API_URL =
  "https://api.github.com/repos/Wepdekr/bangumi-pocket/releases/latest";
const REPO_URL = "https://github.com/Wepdekr/bangumi-pocket";
export const APP_VERSION = version;
export type Update = {
  version: string;
  notes: string;
  apk: string;
  size: number;
  page: string;
};

function parts(value: string) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error("版本信息格式不正确，请前往版本页面查看。");
  return match.slice(1).map(Number);
}
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest),
    b = parts(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
export function parseRelease(data: unknown): Update {
  const release = data as {
    tag_name?: string;
    draft?: boolean;
    prerelease?: boolean;
    body?: string;
    html_url?: string;
    assets?: {
      name: string;
      browser_download_url: string;
      size: number;
      state: string;
    }[];
  } | null;
  if (
    !release ||
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== "string"
  ) {
    throw new Error("暂无可用的正式版本，请稍后再试。");
  }
  parts(release.tag_name);
  const version = release.tag_name.replace(/^v/, "");
  const apk = Array.isArray(release.assets)
    ? release.assets.find(
        (a) =>
          a &&
          a.name === `bangumi-pocket-${version}.apk` &&
          a.state === "uploaded",
      )
    : undefined;
  const expected = `${REPO_URL}/releases/download/${release.tag_name}/bangumi-pocket-${version}.apk`;
  if (!apk || apk.browser_download_url !== expected || !(apk.size > 0)) {
    throw new Error("新版安装包尚未就绪，请前往版本页面查看。");
  }
  return {
    version,
    notes: typeof release.body === "string" ? release.body : "",
    apk: expected,
    size: apk.size,
    page: `${REPO_URL}/releases/tag/${release.tag_name}`,
  };
}
export async function installedVersion(): Promise<string> {
  return Capacitor.isNativePlatform()
    ? (await App.getInfo()).version
    : APP_VERSION;
}
export async function checkUpdate(): Promise<Update> {
  let status: number, data: unknown;
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.get({
      url: API_URL,
      headers: { Accept: "application/vnd.github+json" },
      connectTimeout: 12000,
      readTimeout: 18000,
    });
    status = result.status;
    data = result.data;
  } else {
    const response = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(18000),
    });
    status = response.status;
    if (response.ok) data = await response.json();
  }
  if (status === 403 || status === 429)
    throw new Error("检查更新暂时受限，请稍后重试，或直接查看版本页面。");
  if (status === 404) throw new Error("暂时没有可用的发布版本。");
  if (status < 200 || status >= 300)
    throw new Error(`检查更新失败（${status}），请稍后重试。`);
  return parseRelease(data);
}
export async function openUpdateUrl(url: string) {
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
