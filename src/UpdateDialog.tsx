import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import UpdateDownloadProgress from "./UpdateDownloadProgress";
import { directUpdates, type DownloadState } from "./update-download";
import type { Update } from "./updates";

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}
function ReleaseNotes({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  function flush() {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
      paragraph = [];
    }
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(<h3 key={blocks.length}>{inline(heading[1])}</h3>);
    } else if (item) {
      if (paragraph.length) flush();
      list.push(item[1]);
    } else if (!line.trim()) flush();
    else {
      if (list.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return (
    <div className="release-notes">
      {blocks.length ? blocks : <p>此版本暂无更新说明。</p>}
    </div>
  );
}

export default function UpdateDialog({
  update,
  error,
  close,
  download,
  openPage,
  downloadState,
  actionBusy,
  cancelDownload,
  required = false,
  retryCheck,
  checking = false,
}: {
  update: Update;
  required?: boolean;
  retryCheck?: () => void;
  checking?: boolean;
  error: string;
  close: () => void;
  download: () => void;
  openPage: () => void;
  downloadState?: DownloadState;
  actionBusy: boolean;
  cancelDownload: () => void;
}) {
  const downloading =
    downloadState?.phase === "downloading" ||
    downloadState?.phase === "verifying";
  const dismiss = () => {
    if (!required) close();
  };
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    const wasInert = root?.inert;
    const overflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!required) close();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ||
          [],
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", keydown, true);
    const back = () => {
      if (!required) close();
    };
    document.addEventListener("bangumi-update-back", back);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      document.removeEventListener("bangumi-update-back", back);
      if (root) root.inert = wasInert ?? false;
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [close, required]);
  return createPortal(
    <div
      className="update-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <header>
          <div>
            <h2 id="update-dialog-title">发现新版本 {update.version}</h2>
            <p>{(update.size / 1024 / 1024).toFixed(1)} MB · 更新说明</p>
          </div>
          {!required && (
            <button
              className="icon-button"
              aria-label="关闭更新说明"
              onClick={close}
            >
              <X size={20} />
            </button>
          )}
        </header>
        <div className="update-dialog-body">
          <ReleaseNotes text={update.notes} />
          {required && (
            <p className="update-required">此版本需要更新后才能继续使用。</p>
          )}
          <p className="account-hint">
            {directUpdates()
              ? "下载完成后会打开系统安装界面，按提示确认即可。"
              : "下载后打开安装包，按手机提示升级即可。"}
          </p>
          <UpdateDownloadProgress state={downloadState} />
          {error && (
            <p className="update-error" role="alert">
              {error}
            </p>
          )}
          {required && retryCheck && (
            <button
              className="secondary"
              disabled={checking || actionBusy || downloading}
              onClick={retryCheck}
            >
              {checking ? "正在检查…" : "重新检查更新"}
            </button>
          )}
          <button className="text-button" onClick={openPage}>
            查看 GitHub 版本页面
          </button>
        </div>
        <footer>
          {!required && (
            <button className="text-button" onClick={dismiss}>
              {downloading ? "后台下载" : "暂不更新"}
            </button>
          )}
          {downloading ? (
            <button
              className="secondary"
              disabled={actionBusy}
              onClick={cancelDownload}
            >
              取消下载
            </button>
          ) : (
            <button
              className="primary"
              disabled={actionBusy}
              onClick={download}
            >
              <Download size={16} />
              {actionBusy
                ? "请稍候…"
                : downloadState?.phase === "ready"
                  ? "安装更新"
                  : downloadState?.phase === "error"
                    ? "重新下载"
                    : "下载更新"}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
