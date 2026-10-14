import { RefreshCw } from "lucide-react";
import UpdateDownloadProgress from "./UpdateDownloadProgress";
import { RELEASES_URL } from "./updates";
import { useUpdates } from "./UpdateManager";
export default function UpdatePanel() {
  const {
    current,
    busy,
    actionBusy,
    update,
    message,
    error,
    downloadState,
    downloading,
    check,
    openDialog,
    runDownloadAction,
    open,
  } = useUpdates();
  return (
    <section className="update-panel" aria-label="应用更新">
      <div className="update-heading">
        <div>
          <h3>应用更新</h3>
          <p>番组口袋 · 当前版本 {current}</p>
        </div>
        <button
          className="secondary"
          disabled={busy || downloading || actionBusy}
          onClick={check}
        >
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
      <UpdateDownloadProgress state={downloadState} />
      {downloadState?.phase === "ready" && (
        <button
          className="secondary"
          disabled={actionBusy}
          onClick={() => void runDownloadAction("install")}
        >
          安装更新
        </button>
      )}
      {downloading && (
        <button
          className="text-button"
          disabled={actionBusy}
          onClick={() => void runDownloadAction("cancel")}
        >
          取消下载
        </button>
      )}
      {error && (
        <p className="update-error" role="alert">
          {error}
        </p>
      )}
      {update && (
        <button
          className="secondary"
          onClick={() => {
            openDialog();
          }}
        >
          查看更新说明
        </button>
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
