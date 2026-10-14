import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEffect, useState } from "react";
import { openUpdateUrl, type Update } from "./updates";
export type DownloadState = {
  phase: "idle" | "downloading" | "verifying" | "ready" | "error";
  version: string;
  received: number;
  size: number;
  error: string;
  installerOpened: boolean;
};
const updater = registerPlugin<{
  getState(): Promise<DownloadState>;
  download(options: {
    version: string;
    url: string;
    sha256: string;
    size: number;
  }): Promise<DownloadState>;
  install(): Promise<DownloadState>;
  cancel(): Promise<DownloadState>;
}>("AppUpdater");
export const directUpdates = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
export async function downloadUpdate(update: Update) {
  if (!directUpdates()) {
    await openUpdateUrl(update.apk);
    return;
  }
  if (!update.sha256)
    throw new Error("更新信息缺少校验数据，请重新检查更新或前往版本页面下载。");
  return updater.download({
    version: update.version,
    url: update.apk,
    sha256: update.sha256,
    size: update.size,
  });
}
export const installUpdate = () => updater.install();
export const cancelUpdate = () => updater.cancel();
export function useUpdateDownload() {
  const [state, setState] = useState<DownloadState>();
  useEffect(() => {
    if (!directUpdates()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await updater.getState();
        if (!cancelled) setState(next);
      } catch {
        /* A resume or a later poll can recover the native bridge. */
      }
      if (!cancelled) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return { state, setState };
}
export function downloadLabel(state?: DownloadState) {
  if (!state || state.phase === "idle") return "";
  if (state.phase === "verifying") return "正在校验安装包…";
  if (state.phase === "error") return state.error || "下载失败，请重试。";
  if (state.phase === "ready")
    return (
      state.error ||
      (state.installerOpened
        ? "安装界面已打开，取消后可再次安装。"
        : "下载完成，准备安装…")
    );
  return (
    state.error ||
    `正在下载 ${Math.min(100, Math.floor((state.received / state.size) * 100))}%`
  );
}
