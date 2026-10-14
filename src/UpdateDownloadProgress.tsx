import { downloadLabel, type DownloadState } from "./update-download";
export default function UpdateDownloadProgress({
  state,
}: {
  state?: DownloadState;
}) {
  if (!state || state.phase === "idle") return null;
  return (
    <div className="update-download" role="status" aria-live="polite">
      <p>
        {state.version} · {downloadLabel(state)}
      </p>
      {state.phase === "downloading" && (
        <progress
          aria-label="更新下载进度"
          max={state.size || 1}
          value={state.received}
        />
      )}
    </div>
  );
}
