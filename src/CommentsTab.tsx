import { displayText } from "./text";
import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle, RefreshCw, Star } from "lucide-react";
import { communityPage } from "./community-api";
import type {
  CommunityItem,
  CommunityKind,
  SubjectComment,
  SubjectReview,
} from "./community-api";
import { imageUrl } from "./images";

export default function CommentsTab({
  id,
  openWebsite,
}: {
  id: number;
  openWebsite: (url: string) => void;
}) {
  const [kind, setKind] = useState<CommunityKind>("comments");
  return (
    <section className="community-tab" aria-label="作品评论">
      <div className="section-heading">
        <h2>听听大家怎么说</h2>
        <button
          className="text-button"
          onClick={() => openWebsite(`https://bgm.tv/subject/${id}`)}
        >
          原站 <ArrowUpRight size={14} />
        </button>
      </div>
      <p className="account-hint">以下内容可能包含剧透。</p>
      <div
        className="chips community-switch"
        role="group"
        aria-label="评论类型"
      >
        <button
          className={kind === "comments" ? "active" : ""}
          aria-pressed={kind === "comments"}
          onClick={() => setKind("comments")}
        >
          短评
        </button>
        <button
          className={kind === "reviews" ? "active" : ""}
          aria-pressed={kind === "reviews"}
          onClick={() => setKind("reviews")}
        >
          长评
        </button>
      </div>
      <CommentFeed
        key={`${id}:${kind}`}
        id={id}
        kind={kind}
        openWebsite={openWebsite}
      />
    </section>
  );
}
function CommentFeed({
  id,
  kind,
  openWebsite,
}: {
  id: number;
  kind: CommunityKind;
  openWebsite: (url: string) => void;
}) {
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    communityPage(id, kind)
      .then((page) => {
        if (!active) return;
        setItems(page.data);
        setTotal(page.total);
        setOffset(page.data.length);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error ? error.message : "评论加载失败，请重试。",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [id, kind, version]);
  async function more() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const page = await communityPage(id, kind, offset);
      if (!page.data.length && offset < page.total)
        throw new Error("评论列表发生变化，请刷新后重试。");
      setItems((old) => [
        ...new Map([...old, ...page.data].map((row) => [row.id, row])).values(),
      ]);
      setOffset(offset + page.data.length);
      setTotal(page.total);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "评论加载失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  const date = (time: number) =>
    time ? new Date(time * 1000).toLocaleDateString("zh-CN") : "";
  return (
    <div className="community-feed" aria-busy={busy}>
      <div className="community-count">
        <span>
          {busy && !items.length
            ? "正在读取…"
            : `共 ${total.toLocaleString()} 条${kind === "comments" ? "短评" : "长评"}`}
        </span>
        <button
          aria-label="刷新评论"
          disabled={busy}
          onClick={() => {
            setItems([]);
            setOffset(0);
            setVersion((v) => v + 1);
          }}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {items.map((row) => {
        const comment = row as SubjectComment,
          review = row as SubjectReview;
        return (
          <article className="community-card" key={row.id}>
            <header>
              <img
                src={imageUrl(row.user.avatar?.medium)}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.style.visibility = "hidden";
                }}
              />
              <div>
                <strong>
                  {displayText(row.user.nickname || row.user.username)}
                </strong>
                <small>
                  {date(
                    kind === "comments"
                      ? comment.updatedAt
                      : review.entry.createdAt,
                  )}
                </small>
              </div>
              {kind === "comments" && comment.rate > 0 && (
                <span className="community-rating">
                  <Star size={13} fill="currentColor" />
                  {comment.rate} / 10
                </span>
              )}
            </header>
            {kind === "comments" ? (
              <p className="community-content">
                {displayText(comment.comment)}
              </p>
            ) : (
              <>
                <h3>{displayText(review.entry.title)}</h3>
                <p className="community-content">
                  {displayText(review.entry.summary) || "这篇长评暂无摘要。"}
                </p>
                <button
                  className="text-button"
                  onClick={() =>
                    openWebsite(`https://bgm.tv/blog/${review.entry.id}`)
                  }
                >
                  阅读全文 <ArrowUpRight size={14} />
                  <small>{review.entry.replies} 条回复</small>
                </button>
              </>
            )}
          </article>
        );
      })}
      {busy && (
        <p className="community-loading" role="status">
          <LoaderCircle className="spin" size={18} />
          正在加载评论…
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              items.length ? void more() : setVersion((v) => v + 1)
            }
          >
            重试
          </button>
        </div>
      )}
      {!busy && !error && !items.length && (
        <p className="community-empty">
          暂时还没有{kind === "comments" ? "短评" : "长评"}。
        </p>
      )}
      {items.length > 0 && offset < total && !error && (
        <button
          className="load-more"
          disabled={busy}
          onClick={() => void more()}
        >
          加载更多{kind === "comments" ? "短评" : "长评"}
        </button>
      )}
    </div>
  );
}
