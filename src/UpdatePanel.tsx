import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import UpdateDialog from "./UpdateDialog";
import UpdateDownloadProgress from "./UpdateDownloadProgress";
import {
  useUpdateDownload,
  downloadUpdate,
  installUpdate,
  cancelUpdate,
} from "./update-download";
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
  const { state: downloadState, setState: setDownloadState } =
    useUpdateDownload();
  const [actionBusy, setActionBusy] = useState(false);
  const downloading =
    downloadState?.phase === "downloading" ||
    downloadState?.phase === "verifying";
  const [current, setCurrent] = useState(APP_VERSION);
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<Update>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const closeDialog = useCallback(() => setDialogOpen(false), []);
  async function check() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setUpdate(undefined);
    setDialogOpen(false);
    try {
      const current = await installedVersion();
      setCurrent(current);
      const latest = await checkUpdate();
      if (isNewer(latest.version, current)) {
        setUpdate(latest);
        setDialogOpen(true);
      } else setMessage("当前已是最新版本");
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
  async function runDownloadAction(action: "download" | "install" | "cancel") {
    if (actionBusy) return;
    setActionBusy(true);
    setError("");
    try {
      const next =
        action === "cancel"
          ? await cancelUpdate()
          : action === "install"
            ? await installUpdate()
            : update
              ? await downloadUpdate(update)
              : undefined;
      if (next) setDownloadState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新操作失败，请重试。");
    } finally {
      setActionBusy(false);
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
            setError("");
            setDialogOpen(true);
          }}
        >
          查看更新说明
        </button>
      )}
      {update && dialogOpen && (
        <UpdateDialog
          update={update}
          error={error}
          close={closeDialog}
          downloadState={
            downloadState?.version === update.version
              ? downloadState
              : undefined
          }
          actionBusy={actionBusy}
          download={() =>
            void runDownloadAction(
              downloadState?.phase === "ready" &&
                downloadState.version === update.version
                ? "install"
                : "download",
            )
          }
          cancelDownload={() => void runDownloadAction("cancel")}
          openPage={() => void open(update.page)}
        />
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
