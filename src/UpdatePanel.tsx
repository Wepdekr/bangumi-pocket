import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  APP_VERSION,
  RELEASES_URL,
  checkUpdate,
  installedVersion,
  isNewer,
  openUpdateUrl,
  type Update,
} from "./updates";

export default function UpdatePanel() {
  const [current, setCurrent] = useState(APP_VERSION);
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<Update>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function check() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setUpdate(undefined);
    try {
      const current = await installedVersion();
      setCurrent(current);
      const latest = await checkUpdate();
      if (isNewer(latest.version, current)) setUpdate(latest);
      else setMessage("当前已是最新版本");
    } catch (e) {
      setError(
        e instanceof Error && !/fetch|network|timeout|abort/i.test(e.message)
          ? e.message
          : "无法连接更新服务，请检查网络后重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function open(url: string) {
    try {
      await openUpdateUrl(url);
    } catch {
      setError("无法打开下载页面，请重试。");
    }
  }
  return (
    <section className="update-panel" aria-label="应用更新">
      <div className="update-heading">
        <div>
          <h3>应用更新</h3>
          <p>番组口袋 · 当前版本 {current}</p>
        </div>
        <button className="secondary" disabled={busy} onClick={check}>
          <RefreshCw size={16} className={busy ? "spin" : ""} />
          {busy ? "正在检查…" : "检查更新"}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {message && <p>{message}</p>}
        {update && (
          <p className="update-found">
            发现新版本 {update.version} ·{" "}
            {(update.size / 1024 / 1024).toFixed(1)} MB
          </p>
        )}
      </div>
      {error && (
        <p className="update-error" role="alert">
          {error}
        </p>
      )}
      {update && (
        <>
          <details className="update-notes" open>
            <summary>更新说明</summary>
            <div>{update.notes || "此版本暂无更新说明。"}</div>
          </details>
          <p className="account-hint">
            下载 APK
            后打开文件，按手机提示安装即可升级，收藏和账号会保留。若手机询问安装权限，请允许用于下载的浏览器安装此应用。
          </p>
          <div className="account-actions">
            <button className="primary" onClick={() => open(update.apk)}>
              <Download size={16} />
              下载更新
            </button>
            <button
              className="text-button"
              onClick={() => setUpdate(undefined)}
            >
              暂不更新
            </button>
          </div>
        </>
      )}
      <button
        className="text-button update-link"
        onClick={() => open(update?.page || RELEASES_URL)}
      >
        查看 GitHub 版本页面
      </button>
    </section>
  );
}
