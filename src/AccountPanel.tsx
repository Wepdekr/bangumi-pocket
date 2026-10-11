import { displayText } from "./text";
import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import {
  Cloud,
  RefreshCw,
  LogOut,
  KeyRound,
  ArrowUpRight,
  LoaderCircle,
  Upload,
  ShieldCheck,
  X,
} from "lucide-react";
import { syncController } from "./sync";
import { imageUrl } from "./images";
import type { SyncState } from "./sync";
async function officialTokenPage() {
  const url = "https://next.bgm.tv/demo/access-token";
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
export default function AccountPanel({ state }: { state: SyncState }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    }
  };
  const connect = async () => {
    await run(async () => {
      await syncController.connect(token);
      setToken("");
      setEditing(false);
    });
  };
  return (
    <section className="account-panel" aria-label="账号与同步">
      {state.user ? (
        <>
          <div className="account-profile">
            {state.user.avatar?.medium ? (
              <img src={imageUrl(state.user.avatar.medium)} alt="" />
            ) : (
              <span className="account-avatar">
                <Cloud size={24} />
              </span>
            )}
            <div>
              <h3>{displayText(state.user.nickname || state.user.username)}</h3>
              <p>Bangumi · @{state.user.username}</p>
            </div>
            <ShieldCheck size={20} />
          </div>
          <div className="sync-summary" role="status">
            <Cloud size={15} />
            <span>
              {state.busy
                ? "正在同步…"
                : state.pending
                  ? `${state.pending} 部作品待同步`
                  : state.lastSync
                    ? `上次同步 ${new Date(state.lastSync).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                    : "尚未完成同步"}
            </span>
          </div>
          <div className="account-actions">
            <button
              className="secondary"
              disabled={state.busy}
              onClick={() => run(syncController.sync)}
            >
              {state.busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              立即同步
            </button>
            <button
              className="text-button"
              disabled={state.busy}
              onClick={() => {
                setEditing((v) => !v);
                setError("");
              }}
            >
              <KeyRound size={14} />
              更新授权
            </button>
            <button
              className="text-button"
              disabled={state.busy}
              onClick={() =>
                run(async () => {
                  await syncController.disconnect();
                  setToken("");
                  setConfirmImport(false);
                  setEditing(false);
                })
              }
            >
              <LogOut size={14} />
              退出
            </button>
          </div>
          {state.guestCount > 0 && (
            <>
              <button
                className="import-button"
                disabled={state.busy}
                onClick={() => setConfirmImport((v) => !v)}
              >
                <Upload size={15} />
                导入本机片单（{state.guestCount} 部）
              </button>
              {confirmImport && (
                <div className="import-confirm">
                  <p>
                    将本机收藏和已看章节加入当前账号。账号中已有的收藏状态、评分、短评及私密设置会保留。
                  </p>
                  <div>
                    <button
                      className="primary"
                      disabled={state.busy}
                      onClick={() =>
                        run(async () => {
                          const ok = await syncController.importGuest();
                          if (ok) setConfirmImport(false);
                        })
                      }
                    >
                      确认导入
                    </button>
                    <button
                      className="text-button"
                      disabled={state.busy}
                      onClick={() => setConfirmImport(false)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <p className="account-hint">
            退出后，未同步修改会保留到此账号的缓存，重新连接后继续同步。
          </p>
        </>
      ) : (
        <>
          <div className="account-title">
            <span>
              <Cloud size={23} />
            </span>
            <div>
              <h3>与 Bangumi 账号同步</h3>
              <p>收藏与章节进度，在不同设备间延续。</p>
            </div>
          </div>
          <p className="account-hint">
            在官方页面生成个人访问令牌，再粘贴到下方连接账号。原有本机片单会保留，不会自动上传。
          </p>
        </>
      )}
      {(!state.user || editing) && (
        <>
          <button
            className="token-link"
            onClick={() => void officialTokenPage()}
          >
            前往 Bangumi 获取个人令牌 <ArrowUpRight size={15} />
          </button>
          <form
            className="token-form"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <label htmlFor="account-token">个人访问令牌</label>
            <div>
              <KeyRound size={17} />
              <input
                id="account-token"
                name="bangumi-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="粘贴个人访问令牌"
                disabled={state.busy}
              />
              {token && (
                <button
                  type="button"
                  aria-label="清空令牌"
                  onClick={() => setToken("")}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              className="primary"
              disabled={!state.ready || state.busy || !token.trim()}
              type="submit"
            >
              {state.busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Cloud size={16} />
              )}
              连接并同步
            </button>
          </form>
          <p className="account-hint">
            {Capacitor.isNativePlatform()
              ? "令牌在 Android 端加密保存。过期后请重新生成并更新授权。"
              : "网页预览中的令牌仅在本次会话使用，刷新后需要重新连接。"}
          </p>
          <details className="account-hint">
            <summary>可以直接用账号密码登录吗？</summary>
            <p>
              Bangumi
              开放接口使用授权令牌。请在上方官方页面输入账号密码登录，再生成令牌。
              当前版本尚未配置 OAuth 网页授权，仍需复制令牌；App 不收集你的
              Bangumi 密码。
            </p>
          </details>
        </>
      )}
      {(error || state.error) && (
        <div className="sync-error" role="alert">
          {error || state.error}
          {state.pending > 0 && <small>修改已保存到本机，尚未提交成功。</small>}
        </div>
      )}
    </section>
  );
}
