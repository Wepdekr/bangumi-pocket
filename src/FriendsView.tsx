import { displayText } from "./text";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  LoaderCircle,
  RefreshCw,
  Star,
  Users,
} from "lucide-react";
import { syncController } from "./sync";
import type { SyncState } from "./sync";
import type { FriendEvent, TimelineSubject } from "./friends-api";
import type { Subject, User } from "./types";
import TimelineReactions from "./TimelineReactions";
import { imageUrl } from "./images";
import {
  collectionAction,
  batchProgressText,
  progressAction,
} from "./timeline-text";
export default function FriendsView({
  account,
  connect,
  open,
  openWebsite,
}: {
  account: SyncState;
  connect: () => void;
  open: (subject: Subject) => void;
  openWebsite: (url: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">STORIES AMONG FRIENDS</div>
        <h1>
          同好们，最近在看什么<span className="pink-dot">.</span>
        </h1>
        <p>记录自己的日常，也看看好友的新鲜事。</p>
      </div>
      {!account.ready ? (
        <p className="community-loading">
          <LoaderCircle className="spin" size={18} />
          正在读取账号…
        </p>
      ) : !account.user ? (
        <div className="friends-login">
          <Users size={36} />
          <h2>连接账号，看看好友动态</h2>
          <p>使用已连接的 Bangumi 账号，读取好友的收藏、章节进度和吐槽。</p>
          <button className="primary centered" onClick={connect}>
            连接 Bangumi 账号
          </button>
        </div>
      ) : (
        <FriendFeed
          key={account.user.id}
          currentUser={account.user}
          lastSync={account.lastSync}
          open={open}
          openWebsite={openWebsite}
        />
      )}
    </>
  );
}
function FriendFeed({
  currentUser,
  lastSync,
  open,
  openWebsite,
}: {
  currentUser: User;
  lastSync: number;
  open: (subject: Subject) => void;
  openWebsite: (url: string) => void;
}) {
  const [events, setEvents] = useState<FriendEvent[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState<number>();
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    let active = true;
    setBusy(true);
    setError("");
    setWarning("");
    setEvents([]);
    setMore(false);
    syncController
      .friendsTimeline()
      .then((page) => {
        if (active) {
          setEvents(page.events);
          setWarning(page.warning);
          setCursor(page.cursor);
          setMore(page.hasMore);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [version, lastSync]);
  async function loadMore() {
    if (busy || !events.length || !cursor) return;
    setBusy(true);
    setError("");
    const requestedGeneration = generation.current;
    try {
      const page = await syncController.friendsTimeline(cursor);
      if (requestedGeneration !== generation.current) return;
      const older = page.events;
      setEvents((old) => [
        ...new Map([...old, ...older].map((row) => [row.id, row])).values(),
      ]);
      setCursor(page.cursor);
      setMore(page.hasMore);
    } catch (error) {
      if (requestedGeneration !== generation.current) return;
      setError(
        error instanceof Error ? error.message : "好友动态读取失败，请重试。",
      );
    } finally {
      if (requestedGeneration === generation.current) setBusy(false);
    }
  }
  return (
    <section className="friends-feed" aria-label="好友动态" aria-busy={busy}>
      <div className="friends-toolbar">
        <strong>我与好友的动态</strong>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setVersion((v) => v + 1)}
        >
          <RefreshCw size={15} />
          刷新
        </button>
        <button
          className="text-button"
          onClick={() => openWebsite("https://bgm.tv")}
        >
          原站 <ArrowUpRight size={14} />
        </button>
      </div>
      {events.map((event) => (
        <FriendCard
          key={event.id}
          event={event}
          currentUser={currentUser}
          update={(updated) =>
            setEvents((old) =>
              old.map((row) => (row.id === updated.id ? updated : row)),
            )
          }
          open={open}
          openWebsite={openWebsite}
        />
      ))}
      {busy && (
        <p className="community-loading" role="status">
          <LoaderCircle className="spin" size={18} />
          正在读取好友动态…
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              events.length ? void loadMore() : setVersion((v) => v + 1)
            }
          >
            重试
          </button>
        </div>
      )}
      {warning && (
        <div className="account-hint" role="status">
          <span>{warning}</span>
          <button
            className="text-button"
            onClick={() =>
              openWebsite(
                `https://bgm.tv/user/${encodeURIComponent(currentUser.username)}/timeline`,
              )
            }
          >
            查看我的时间线 <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      {!busy && !error && !warning && !events.length && (
        <p className="community-empty">
          你和好友暂时还没有动态，过一会儿再来看看吧。
        </p>
      )}
      {events.length > 0 && more && !error && (
        <button
          className="load-more"
          disabled={busy}
          onClick={() => void loadMore()}
        >
          加载更多动态
        </button>
      )}
      {!busy && events.length > 0 && !more && !error && (
        <p className="community-empty">已经看到最早的动态了。</p>
      )}
    </section>
  );
}
function FriendCard({
  event,
  currentUser,
  update,
  open,
  openWebsite,
}: {
  event: FriendEvent;
  currentUser: User;
  update: (event: FriendEvent) => void;
  open: (subject: Subject) => void;
  openWebsite: (url: string) => void;
}) {
  const label =
    (
      {
        1: "更新了近况",
        2: "参与了资料编辑",
        3: collectionAction(event.type),
        4: progressAction(event),
        5: "发布了近况",
        6: "发表了日志",
        7: "更新了目录",
        8: "收藏了人物",
        9: "更新了天窗",
      } as Record<number, string>
    )[event.cat] || "有了新的动态";
  const progress = event.memo.progress;
  const author = event.uid === currentUser.id ? currentUser : event.user;
  const username = author?.username || String(event.uid);
  const subject = (item: TimelineSubject) => (
    <button
      className="friend-subject"
      onClick={() => open({ ...item, name_cn: item.nameCN })}
    >
      <img
        src={imageUrl(item.images?.medium || item.images?.large)}
        alt=""
        loading="lazy"
      />
      <strong>
        {event.webSummary !== undefined
          ? item.nameCN || item.name
          : displayText(item.nameCN || item.name)}
      </strong>
      <ArrowUpRight size={15} />
    </button>
  );
  return (
    <article className="community-card friend-card">
      <header>
        <img src={imageUrl(author?.avatar?.medium)} alt="" loading="lazy" />
        <div>
          <strong>
            {displayText(author?.nickname || username)}
            {event.uid === currentUser.id && (
              <span className="friend-self">我</span>
            )}
          </strong>
          <small>
            {new Date(event.createdAt * 1000).toLocaleString("zh-CN", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        </div>
      </header>
      <p className="friend-action">{event.webSummary ?? label}</p>
      {event.memo.subject?.map((item) => (
        <div key={item.subject.id}>
          {subject(item.subject)}
          {item.rate ? (
            <span className="community-rating">
              <Star size={13} fill="currentColor" />
              {item.rate} / 10
            </span>
          ) : null}
          {item.comment && (
            <p className="community-content">
              {event.webSummary !== undefined
                ? item.comment
                : displayText(item.comment)}
            </p>
          )}
        </div>
      ))}
      {progress?.single && (
        <>
          {subject(progress.single.subject)}
          <p className="community-content">
            第 {progress.single.episode.sort} 集 ·{" "}
            {displayText(
              progress.single.episode.nameCN || progress.single.episode.name,
            )}
          </p>
        </>
      )}
      {progress?.batch && (
        <>
          {subject(progress.batch.subject)}
          <p className="community-content">
            {batchProgressText(progress.batch)}
          </p>
        </>
      )}
      {event.memo.status?.tsukkomi && (
        <p className="community-content">
          {displayText(event.memo.status.tsukkomi)}
        </p>
      )}
      {event.memo.status?.sign && (
        <p className="community-content">
          {displayText(event.memo.status.sign)}
        </p>
      )}
      {event.memo.status?.nickname && (
        <p className="community-content">
          新昵称：{displayText(event.memo.status.nickname.after)}
        </p>
      )}
      {event.memo.blog && (
        <button
          className="text-button"
          onClick={() =>
            openWebsite(`https://bgm.tv/blog/${event.memo.blog!.id}`)
          }
        >
          {displayText(event.memo.blog.title)} <ArrowUpRight size={14} />
        </button>
      )}
      <TimelineReactions event={event} user={currentUser} update={update} />
      <button
        className="text-button"
        onClick={() =>
          openWebsite(
            `https://bgm.tv/user/${encodeURIComponent(username)}/timeline`,
          )
        }
      >
        {event.uid === currentUser.id ? "查看我的时间线" : "查看好友时间线"}{" "}
        <ArrowUpRight size={14} />
      </button>
    </article>
  );
}
