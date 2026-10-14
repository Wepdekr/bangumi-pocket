import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Capacitor } from "@capacitor/core";
import UpdateDialog from "./UpdateDialog";
import {
  APP_VERSION,
  checkUpdate,
  installedVersion,
  openUpdateUrl,
  updateLevel,
  type Update,
} from "./updates";
import { startupUpdateChecks, rememberRequiredUpdate } from "./startup-updates";
import {
  useUpdateDownload,
  downloadUpdate,
  installUpdate,
  cancelUpdate,
} from "./update-download";

type UpdateInfo = { current: string; update?: Update; required: boolean };
function useUpdateManager(startup: boolean) {
  const { state: downloadState, setState: setDownloadState } =
    useUpdateDownload();
  const [info, setInfo] = useState<UpdateInfo>({
    current: APP_VERSION,
    required: false,
  });
  const [busy, setBusy] = useState(false),
    [actionBusy, setActionBusy] = useState(false);
  const checking = useRef(false),
    acting = useRef(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const downloading =
    downloadState?.phase === "downloading" ||
    downloadState?.phase === "verifying";
  const showUpdate = useCallback((update: Update, current: string) => {
    setInfo((previous) =>
      previous.required &&
      previous.update &&
      updateLevel(previous.update.version, update.version) !== "none"
        ? previous
        : {
            current,
            update,
            required: updateLevel(update.version, current) === "major",
          },
    );
    setDialogOpen(true);
  }, []);
  useEffect(() => {
    if (!startup) return;
    let active = true;
    const tasks = startupUpdateChecks();
    void tasks.local.then((result) => {
      if (active && result.update) showUpdate(result.update, result.current);
    });
    void tasks.remote.then((result) => {
      if (!active || !result?.update) return;
      const level = updateLevel(result.update.version, result.current);
      if (level === "major" || level === "minor")
        showUpdate(result.update, result.current);
    });
    return () => {
      active = false;
    };
  }, [startup, showUpdate]);
  const closeDialog = useCallback(() => {
    if (!info.required) setDialogOpen(false);
  }, [info.required]);
  const openDialog = () => {
    setError("");
    setDialogOpen(true);
  };
  async function check() {
    if (checking.current || downloading || acting.current) return;
    checking.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const current = await installedVersion(),
        latest = await checkUpdate();
      const level = updateLevel(latest.version, current);
      if (level !== "none") {
        if (level === "major") await rememberRequiredUpdate(latest);
        showUpdate(latest, current);
      } else {
        setMessage("当前已是最新版本");
        setInfo((previous) =>
          previous.required ? previous : { current, required: false },
        );
      }
    } catch (e) {
      setError(
        e instanceof Error && !/fetch|network|timeout|abort/i.test(e.message)
          ? e.message
          : "无法连接更新服务，请检查网络后重试。",
      );
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }
  async function runDownloadAction(action: "download" | "install" | "cancel") {
    if (acting.current) return;
    acting.current = true;
    setActionBusy(true);
    setError("");
    try {
      const next =
        action === "cancel"
          ? await cancelUpdate()
          : action === "install"
            ? await installUpdate()
            : info.update
              ? await downloadUpdate(info.update)
              : undefined;
      if (next) setDownloadState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新操作失败，请重试。");
    } finally {
      acting.current = false;
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
  return {
    ...info,
    busy,
    actionBusy,
    message,
    error,
    dialogOpen,
    downloadState,
    downloading,
    check,
    closeDialog,
    openDialog,
    runDownloadAction,
    open,
  };
}
const UpdateContext = createContext<ReturnType<typeof useUpdateManager> | null>(
  null,
);
export function useUpdates() {
  const manager = useContext(UpdateContext);
  if (!manager) throw new Error("UpdateProvider is missing");
  return manager;
}
export function UpdateProvider({
  children,
  startup = Capacitor.isNativePlatform(),
}: {
  children: ReactNode;
  startup?: boolean;
}) {
  const manager = useUpdateManager(startup);
  const { update, required, dialogOpen, downloadState } = manager;
  return (
    <UpdateContext.Provider value={manager}>
      {children}
      {update && (dialogOpen || required) && (
        <UpdateDialog
          update={update}
          required={required}
          error={manager.error}
          close={manager.closeDialog}
          downloadState={
            downloadState?.version === update.version
              ? downloadState
              : undefined
          }
          actionBusy={manager.actionBusy || manager.busy}
          checking={manager.busy}
          retryCheck={() => void manager.check()}
          download={() =>
            void manager.runDownloadAction(
              downloadState?.phase === "ready" &&
                downloadState.version === update.version
                ? "install"
                : "download",
            )
          }
          cancelDownload={() => void manager.runDownloadAction("cancel")}
          openPage={() => void manager.open(update.page)}
        />
      )}
    </UpdateContext.Provider>
  );
}
