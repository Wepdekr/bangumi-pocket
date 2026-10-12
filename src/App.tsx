import { displayText } from "./text";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Compass,
  CalendarDays,
  Search,
  Library,
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  Star,
  Plus,
  Check,
  X,
  RefreshCw,
  Heart,
  BookOpen,
  Gamepad2,
  Music2,
  Film,
  Tv,
  WifiOff,
  LoaderCircle,
  Users,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { api } from "./api";
import { syncController } from "./sync";
import AccountPanel from "./AccountPanel";
import UpdatePanel from "./UpdatePanel";
import { airStatus, episodeToggleStyle, localDate } from "./air-progress";
import ReviewSheet from "./ReviewSheet";
import CommentsTab from "./CommentsTab";
import FriendsView from "./FriendsView";
import { watchedThrough } from "./episode-progress";
import { imageUrl } from "./images";
import type { SyncState } from "./sync";
import type {
  Subject,
  Page,
  CalendarDay,
  Saved,
  Episode,
  Character,
  Review,
} from "./types";

const categories = [
  { id: 2, name: "动画", icon: Tv },
  { id: 1, name: "书籍", icon: BookOpen },
  { id: 4, name: "游戏", icon: Gamepad2 },
  { id: 3, name: "音乐", icon: Music2 },
  { id: 6, name: "三次元", icon: Film },
];
const statuses: { id: Saved["status"]; name: string }[] = [
  { id: "wish", name: "想看" },
  { id: "doing", name: "在看" },
  { id: "done", name: "看过" },
  { id: "hold", name: "搁置" },
  { id: "dropped", name: "抛弃" },
];
const statusName = (status: Saved["status"], type?: number) => {
  const index = ["wish", "doing", "done"].indexOf(status);
  const words =
    type === 1
      ? ["想读", "在读", "读过"]
      : type === 3
        ? ["想听", "在听", "听过"]
        : type === 4
          ? ["想玩", "在玩", "玩过"]
          : ["想看", "在看", "看过"];
  return index >= 0
    ? words[index]
    : statuses.find((s) => s.id === status)!.name;
};
const title = (s: Subject) => displayText(s.name_cn || s.name);
const score = (s: Subject) =>
  s.rating?.score ? s.rating.score.toFixed(1) : "—";
const cover = (s: Subject) =>
  imageUrl(s.images?.large || s.images?.common || s.images?.medium);
const weekday = () => new Date().getDay() || 7;
const formatNumber = (n = 0) =>
  n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString();
async function openWebsite(url: string) {
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

function useResource<T>(fn: () => Promise<T>, keys: unknown[]) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setData(undefined);
    setLoading(true);
    setError("");
    fn()
      .then((d) => {
        if (current) setData(d);
      })
      .catch(() => {
        if (current) setError("暂时连接不上 Bangumi，请检查网络后重试。");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [...keys, version]);
  return { data, loading, error, retry: () => setVersion((v) => v + 1) };
}
function ErrorState({
  retry,
  message,
}: {
  retry: () => void;
  message?: string;
}) {
  return (
    <div className="empty" role="alert">
      <WifiOff size={32} />
      <h3>信号暂时走丢了</h3>
      <p>{message || "请检查网络后重试。"}</p>
      <button className="secondary" onClick={retry}>
        <RefreshCw size={16} />
        重新加载
      </button>
    </div>
  );
}
function Empty({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="empty">
      <Library size={36} />
      <h3>{heading}</h3>
      <p>{body}</p>
    </div>
  );
}
function Skeleton() {
  return (
    <div className="skeleton-grid" aria-label="正在加载">
      <div />
      <div />
      <div />
      <div />
      <div />
      <div />
    </div>
  );
}
function Poster({
  subject,
  open,
  saved,
}: {
  subject: Subject;
  open: (s: Subject) => void;
  saved?: Saved;
}) {
  return (
    <button className="poster" onClick={() => open(subject)}>
      <div className="poster-image">
        <img
          src={cover(subject)}
          loading="lazy"
          alt=""
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
        <span className="rating">
          <Star size={11} fill="currentColor" />
          {score(subject)}
        </span>
        {saved && (
          <span className="saved-badge">
            <Check size={13} />
          </span>
        )}
      </div>
      <h3>{title(subject)}</h3>
      <p>
        {subject.date || subject.air_date || "日期待定"}{" "}
        <span>
          ·{" "}
          {subject.platform ||
            categories.find((c) => c.id === subject.type)?.name ||
            "动画"}
        </span>
      </p>
    </button>
  );
}

export default function App() {
  const [tab, setTab] = useState("discover");
  const [type, setType] = useState(2);
  const [sort, setSort] = useState("rank");
  const account = useSyncExternalStore(
    syncController.subscribe,
    syncController.getSnapshot,
  );
  const { library, ready } = account;
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<number | null>(
    () => Number(location.hash.slice(1)) || null,
  );
  useEffect(() => {
    void syncController.initialize();
    const onHash = () => setSelected(Number(location.hash.slice(1)) || null);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!ready || !account.user) return;
    const resume = () => {
      if (document.visibilityState === "visible") void syncController.sync();
    };
    const online = () => void syncController.sync();
    const timer = setInterval(() => {
      if (
        syncController.getSnapshot().pending &&
        !syncController.getSnapshot().busy
      )
        void syncController.sync();
    }, 60000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", online);
    const listener = Capacitor.isNativePlatform()
      ? NativeApp.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void syncController.sync();
        })
      : null;
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", online);
      if (listener) void listener.then((l) => l.remove());
    };
  }, [ready, account.user?.id]);
  useEffect(() => {
    if (
      selected &&
      account.user &&
      library[selected] &&
      !library[selected].episodesLoaded
    )
      void syncController.hydrate(selected);
  }, [selected, account.user?.id, account.lastSync]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    setToast("");
  }, [account.user?.id]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener("backButton", () => {
      if (document.querySelector(".update-dialog")) {
        document.dispatchEvent(new Event("bangumi-update-back"));
        return;
      }
      if (document.querySelector(".review-sheet, .collection-picker")) {
        document.dispatchEvent(new Event("bangumi-review-back"));
        return;
      }
      if (location.hash) history.back();
      else if (tab !== "discover") setTab("discover");
      else void NativeApp.exitApp();
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, [tab]);
  const browse = useResource(
    () => api.browse(type, sort),
    [type, sort, account.user?.id],
  );
  const calendar = useResource(api.calendar, [account.user?.id]);
  const open = (s: Subject) => {
    history.pushState({ detail: true }, "", `#${s.id}`);
    setSelected(s.id);
  };
  const close = () => {
    if (history.state?.detail) history.back();
    else {
      history.replaceState(null, "", location.pathname + location.search);
      setSelected(null);
    }
  };
  const save = async (
    s: Subject,
    status: Saved["status"] | null,
    watched?: number[],
    review?: Review,
  ) => {
    if (!ready) return false;
    try {
      const synced = await syncController.save(s, status, watched, review);
      setToast(
        account.user
          ? synced
            ? "已同步到 Bangumi"
            : "已保存到本机，等待同步"
          : status === null
            ? "已移出收藏"
            : "已保存到本机收藏",
      );
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请重试。");
      return false;
    }
  };
  const navigate = (next: string) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  };
  return (
    <div className="app-shell">
      <header className="app-header" inert={Boolean(selected)}>
        <button
          className="brand"
          onClick={() => navigate("discover")}
          aria-label="返回发现"
        >
          <img src="/icon.svg" alt="" />
          <div>
            <strong>
              番组口袋<span>Bangumi Pocket</span>
            </strong>
          </div>
        </button>
        <button
          className="icon-button"
          aria-label="搜索作品"
          onClick={() => navigate("search")}
        >
          <Search size={21} />
        </button>
      </header>
      <main inert={Boolean(selected)}>
        {tab === "discover" && (
          <>
            <div className="page-heading">
              <div className="eyebrow">YOUR NEXT FAVORITE</div>
              <h1>
                下一部心动，
                <br />
                从这里开始<span className="pink-dot">.</span>
              </h1>
              <p>在故事里，遇见另一个世界。</p>
            </div>
            <div className="category-bar">
              <div className="category-tabs">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    className={type === c.id ? "active" : ""}
                    onClick={() => setType(c.id)}
                  >
                    <c.icon size={17} />
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            {browse.loading ? (
              <div className="hero skeleton" />
            ) : browse.error ? (
              <ErrorState retry={browse.retry} message={browse.error} />
            ) : (
              browse.data?.data[0] && (
                <button
                  className="hero"
                  onClick={() => open(browse.data!.data[0])}
                >
                  <img src={cover(browse.data.data[0])} alt="" />
                  <div className="hero-shade" />
                  <div className="hero-content">
                    <span className="hero-label">
                      <Star size={13} fill="currentColor" />
                      口碑之选 · #
                      {browse.data.data[0].rating?.rank ||
                        browse.data.data[0].rank ||
                        "—"}
                    </span>
                    <h2>{title(browse.data.data[0])}</h2>
                    <p>
                      {(
                        displayText(browse.data.data[0].summary) ||
                        "每个好故事，都值得被发现。"
                      ).slice(0, 72)}
                    </p>
                    <span className="hero-link">
                      走进这个故事 <ArrowUpRight size={18} />
                    </span>
                  </div>
                  <div className="hero-score">
                    {score(browse.data.data[0])}
                    <small>Bangumi 评分</small>
                  </div>
                </button>
              )
            )}
            {type === 2 && (
              <section>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">ON AIR</span>
                    <h2>今天有新故事</h2>
                  </div>
                  <button onClick={() => navigate("calendar")}>
                    放送表
                    <ChevronRight size={16} />
                  </button>
                </div>
                {calendar.loading ? (
                  <Skeleton />
                ) : calendar.error ? (
                  <div className="inline-error">
                    每日放送加载失败{" "}
                    <button onClick={calendar.retry}>重试</button>
                  </div>
                ) : (
                  <div className="poster-rail">
                    {calendar.data
                      ?.find((d) => d.weekday.id === weekday())
                      ?.items.slice(0, 10)
                      .map((s) => (
                        <Poster
                          key={s.id}
                          subject={s}
                          open={open}
                          saved={library[s.id]}
                        />
                      ))}
                  </div>
                )}
              </section>
            )}
            <section>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">THE GOOD STUFF</span>
                  <h2>{sort === "rank" ? "值得反复回味" : "新鲜上架"}</h2>
                </div>
                <button
                  onClick={() =>
                    setSort((s) => (s === "rank" ? "date" : "rank"))
                  }
                >
                  {sort === "rank" ? "看最新" : "看排行"}
                  <RefreshCw size={14} />
                </button>
              </div>
              {browse.data && (
                <BrowseGrid
                  initial={browse.data}
                  type={type}
                  sort={sort}
                  open={open}
                  library={library}
                />
              )}
            </section>
            <footer className="source-note">
              内容来自 Bangumi · 非官方客户端
              <br />
              <button onClick={() => openWebsite("https://bgm.tv")}>
                去 Bangumi 遇见更多同好 <ArrowUpRight size={12} />
              </button>
            </footer>
          </>
        )}
        {tab === "calendar" && (
          <CalendarView resource={calendar} open={open} library={library} />
        )}
        {tab === "search" && <SearchView open={open} library={library} />}
        {tab === "friends" && (
          <FriendsView
            account={account}
            connect={() => navigate("library")}
            open={open}
            openWebsite={(url) => void openWebsite(url)}
          />
        )}
        {tab === "library" && (
          <LibraryView
            library={library}
            open={open}
            discover={() => navigate("discover")}
            ready={ready}
            account={account}
          />
        )}
      </main>
      <nav className="bottom-nav" aria-label="主导航" inert={Boolean(selected)}>
        {[
          { id: "discover", name: "发现", icon: Compass },
          { id: "calendar", name: "放送", icon: CalendarDays },
          { id: "search", name: "搜索", icon: Search },
          { id: "library", name: "收藏", icon: Library },
          { id: "friends", name: "动态", icon: Users },
        ].map((n) => (
          <button
            key={n.id}
            aria-current={tab === n.id ? "page" : undefined}
            className={tab === n.id ? "active" : ""}
            onClick={() => navigate(n.id)}
          >
            <span>
              <n.icon size={23} />
            </span>
            {n.name}
          </button>
        ))}
      </nav>
      {selected && (
        <Detail
          id={selected}
          close={close}
          saved={library[selected]}
          save={save}
          ready={ready && !account.busy}
          cloudMode={Boolean(account.user)}
          progressReady={
            !account.user ||
            !library[selected] ||
            Boolean(library[selected].episodesLoaded)
          }
          progressError={account.progressErrors[selected]}
          retryProgress={() => void syncController.hydrate(selected)}
          accountId={account.user?.id}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function BrowseGrid({
  initial,
  type,
  sort,
  open,
  library,
}: {
  initial: Page;
  type: number;
  sort: string;
  open: (s: Subject) => void;
  library: Record<number, Saved>;
}) {
  const [items, setItems] = useState(initial.data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    setItems(initial.data);
    setError(false);
  }, [initial]);
  async function more() {
    setBusy(true);
    setError(false);
    try {
      const page = await api.browse(type, sort, items.length);
      setItems((old) => [...old, ...page.data]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="poster-grid">
        {items.map((s) => (
          <Poster key={s.id} subject={s} open={open} saved={library[s.id]} />
        ))}
      </div>
      {items.length < initial.total && (
        <button className="load-more" disabled={busy} onClick={more}>
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : error ? (
            <RefreshCw size={17} />
          ) : (
            <Plus size={17} />
          )}{" "}
          {busy ? "正在加载" : error ? "加载失败，点击重试" : "再发现一些"}
        </button>
      )}
    </>
  );
}
function CalendarView({
  resource,
  open,
  library,
}: {
  resource: ReturnType<typeof useResource<CalendarDay[]>>;
  open: (s: Subject) => void;
  library: Record<number, Saved>;
}) {
  const [day, setDay] = useState(weekday());
  const items = resource.data?.find((d) => d.weekday.id === day)?.items || [];
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">A LITTLE JOY, EVERY DAY</div>
        <h1>
          每一天，都有期待<span className="pink-dot">.</span>
        </h1>
        <p>一周放送，一眼掌握。放送日期以 Bangumi 标注为准。</p>
      </div>
      <div className="week-tabs">
        {["一", "二", "三", "四", "五", "六", "日"].map((n, i) => (
          <button
            key={n}
            className={day === i + 1 ? "active" : ""}
            onClick={() => setDay(i + 1)}
          >
            <small>{weekday() === i + 1 ? "今天" : "周"}</small>
            <strong>{n}</strong>
            <i />
          </button>
        ))}
      </div>
      <div className="section-heading">
        <h2>周{["一", "二", "三", "四", "五", "六", "日"][day - 1]}放送</h2>
        <span className="muted">{items.length} 部作品</span>
      </div>
      {resource.loading ? (
        <Skeleton />
      ) : resource.error ? (
        <ErrorState retry={resource.retry} />
      ) : items.length ? (
        <div className="subject-list">
          {items.map((s) => (
            <SubjectRow
              key={s.id}
              subject={s}
              open={open}
              saved={library[s.id]}
            />
          ))}
        </div>
      ) : (
        <Empty
          heading="今天暂时没有放送"
          body="换一天看看，或去发现页寻找好故事。"
        />
      )}
    </>
  );
}
function SubjectRow({
  subject: s,
  open,
  saved,
}: {
  subject: Subject;
  open: (s: Subject) => void;
  saved?: Saved;
}) {
  return (
    <button className="subject-row" onClick={() => open(s)}>
      <img src={cover(s)} alt="" loading="lazy" />
      <div>
        <h3>{title(s)}</h3>
        <p className="original-name">
          {s.name_cn
            ? displayText(s.name)
            : categories.find((c) => c.id === s.type)?.name || "动画"}
        </p>
        <p>
          <Star size={13} fill="currentColor" />
          <b>{score(s)}</b>
          <span>{s.date || s.air_date || "日期待定"}</span>
        </p>
        {saved && (
          <small className="pink">
            {statusName(saved.status, s.type)}
          </small>
        )}
      </div>
      <ChevronRight size={18} />
    </button>
  );
}
function SearchView({
  open,
  library,
}: {
  open: (s: Subject) => void;
  library: Record<number, Saved>;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState(0);
  const [offset, setOffset] = useState(0);
  const [all, setAll] = useState<Subject[]>([]);
  const result = useResource(
    () =>
      query
        ? api.search(query, type, offset)
        : Promise.resolve({ data: [], total: 0, limit: 24, offset: 0 }),
    [query, type, offset],
  );
  useEffect(() => {
    if (result.data)
      setAll((old) =>
        offset ? [...old, ...result.data!.data] : result.data!.data,
      );
  }, [result.data]);
  const search = (value: string) => {
    setInput(value);
    if (value.trim() === query && offset === 0) return;
    setAll([]);
    setOffset(0);
    setQuery(value.trim());
  };
  const chooseType = (next: number) => {
    if (next === type) return;
    setAll([]);
    setOffset(0);
    setType(next);
  };
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">FIND YOUR WORLD</div>
        <h1>
          寻找你的心头好<span className="pink-dot">.</span>
        </h1>
        <p>动画、书籍、音乐、游戏，还有更多。</p>
      </div>
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          search(input);
        }}
      >
        <Search size={20} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="作品名，中文或日文都可以"
          aria-label="作品名"
          enterKeyHint="search"
        />
        {input && (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={() => {
              setInput("");
              setQuery("");
              setAll([]);
            }}
          >
            <X size={17} />
          </button>
        )}
        <button type="submit">搜索</button>
      </form>
      <div className="chips">
        <button
          className={!type ? "active" : ""}
          onClick={() => {
            chooseType(0);
          }}
        >
          全部
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={type === c.id ? "active" : ""}
            onClick={() => {
              chooseType(c.id);
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      {!query ? (
        <>
          <div className="search-intro">
            <span>从一个名字，开始一段旅程</span>
            <h2>今天，想遇见什么？</h2>
            <p>试试这些关键词</p>
            <div className="chips">
              {["葬送的芙莉莲", "夏目友人帐", "命运石之门", "孤独摇滚"].map(
                (k) => (
                  <button key={k} onClick={() => search(k)}>
                    {k}
                    <ArrowUpRight size={13} />
                  </button>
                ),
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="section-heading">
            <h2>「{query}」</h2>
            <span className="muted">
              {result.data ? `${result.data.total} 个结果` : "搜索中"}
            </span>
          </div>
          {result.loading && !offset ? (
            <Skeleton />
          ) : result.error ? (
            <ErrorState retry={result.retry} />
          ) : !all.length && !result.loading ? (
            <Empty
              heading="还没有找到这部作品"
              body="试试原名、更短的关键词，或切换分类。"
            />
          ) : (
            <>
              <div className="subject-list">
                {all.map((s) => (
                  <SubjectRow
                    key={s.id}
                    subject={s}
                    open={open}
                    saved={library[s.id]}
                  />
                ))}
              </div>
              {result.data && all.length < result.data.total && (
                <button
                  disabled={result.loading}
                  className="load-more"
                  onClick={() => setOffset(all.length)}
                >
                  {result.loading ? "正在加载" : "更多搜索结果"}
                </button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
function LibraryView({
  library,
  open,
  discover,
  ready,
  account,
}: {
  library: Record<number, Saved>;
  open: (s: Subject) => void;
  discover: () => void;
  ready: boolean;
  account: SyncState;
}) {
  const [filter, setFilter] = useState("doing");
  const all = Object.values(library).sort((a, b) => b.updated - a.updated);
  const items = all.filter((s) => filter === "all" || s.status === filter);
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">STORIES YOU KEEP</div>
        <h1>
          把喜欢，放进口袋<span className="pink-dot">.</span>
        </h1>
        <p>你的私人片单，每一次心动都有迹可循。</p>
      </div>
      <AccountPanel state={account} />
      <UpdatePanel />
      <div className="library-stats">
        <div>
          <strong>{all.length}</strong>
          <span>收藏作品</span>
        </div>
        <div>
          <strong>{all.filter((s) => s.status === "doing").length}</strong>
          <span>正在探索</span>
        </div>
        <div>
          <strong>{all.filter((s) => s.status === "done").length}</strong>
          <span>已完成</span>
        </div>
        <Heart size={37} />
      </div>
      <div className="chips">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          全部
        </button>
        {statuses.map((s) => (
          <button
            key={s.id}
            className={filter === s.id ? "active" : ""}
            onClick={() => setFilter(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>
      {!ready ? (
        <Skeleton />
      ) : !items.length ? (
        <>
          <Empty
            heading={
              all.length ? "这个分类还没有作品" : "口袋里，还差一个好故事"
            }
            body="在作品详情页标记收藏，喜欢的故事就会留在这里。"
          />
          <button className="primary centered" onClick={discover}>
            去发现 <ArrowUpRight size={17} />
          </button>
        </>
      ) : (
        <div className="subject-list">
          {items.map((s) => (
            <div key={s.subject.id}>
              <SubjectRow subject={s.subject} open={open} saved={s} />
              {(s.watchedCount ?? s.watched.length) > 0 && (
                <div className="progress-caption">
                  已看 {s.watchedCount ?? s.watched.length} 集
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="local-note">
        <Library size={16} />
        <div>
          <strong>{account.user ? "账号片单" : "本机收藏"}</strong>
          <p>
            {account.user
              ? "修改会同步到 Bangumi；断网时先保存在本机，联网后重试。"
              : "连接上方账号可同步收藏；未登录时记录保存在当前设备。"}
          </p>
        </div>
      </div>
    </>
  );
}

function Detail({
  id,
  close,
  saved,
  save,
  ready,
  cloudMode,
  progressReady,
  progressError,
  retryProgress,
  accountId,
}: {
  id: number;
  close: () => void;
  saved?: Saved;
  save: (
    s: Subject,
    status: Saved["status"] | null,
    watched?: number[],
    review?: Review,
  ) => Promise<boolean>;
  ready: boolean;
  cloudMode: boolean;
  progressReady: boolean;
  progressError?: string;
  retryProgress: () => void;
  accountId?: number;
}) {
  const subject = useResource(() => api.subject(id), [id, accountId]);
  const episodes = useResource(() => api.episodes(id), [id, accountId]);
  const characters = useResource(() => api.characters(id), [id, accountId]);
  const [tab, setTab] = useState("about");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCompleting, setReviewCompleting] = useState(true);
  const [reviewTargetStatus, setReviewTargetStatus] =
    useState<Saved["status"]>("done");
  const [moreEpisodes, setMoreEpisodes] = useState<Episode[]>([]);
  const [epBusy, setEpBusy] = useState(false);
  const [epError, setEpError] = useState(false);
  const [throughError, setThroughError] = useState("");
  const [airToday, setAirToday] = useState(localDate());
  useEffect(() => {
    const refresh = () => setAirToday(localDate());
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    setTab("about");
    setExpanded(false);
    setMoreEpisodes([]);
    setThroughError("");
    setReviewOpen(false);
    setCollectionOpen(false);
    panel.current?.scrollTo(0, 0);
  }, [id]);
  useEffect(() => {
    if (!collectionOpen) return;
    const closePicker = () => setCollectionOpen(false);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
      }
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("bangumi-review-back", closePicker);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("bangumi-review-back", closePicker);
    };
  }, [collectionOpen]);
  const s = subject.data;
  const ep = [...(episodes.data?.data || []), ...moreEpisodes];
  async function change(status: Saved["status"] | null, watched?: number[]) {
    if (!s) return;
    setCollectionOpen(false);
    if (
      status &&
      ["done", "hold", "dropped"].includes(status) &&
      watched === undefined
    ) {
      setReviewTargetStatus(status);
      setReviewCompleting(true);
      setReviewOpen(true);
      return;
    }
    setSaving(true);
    try {
      const stored = await save(s, status, watched);
      const total = episodes.data?.total ?? 0;
      // Count only a complete normal-episode list, never one page or a partial season.
      if (
        stored &&
        watched &&
        total > 0 &&
        watched.length >= total &&
        total >= (s.eps || 0) &&
        ep.every((e) => watched.includes(e.id)) &&
        ep.some((e) => !saved?.watched.includes(e.id))
      ) {
        setReviewTargetStatus("done");
        setReviewCompleting(true);
        setReviewOpen(true);
      }
    } finally {
      setSaving(false);
    }
  }
  async function loadEpisodes() {
    setEpBusy(true);
    setEpError(false);
    try {
      const next = await api.episodes(id, ep.length);
      setMoreEpisodes((old) => [...old, ...next.data]);
    } catch {
      setEpError(true);
    } finally {
      setEpBusy(false);
    }
  }
  async function markThrough(target: Episode) {
    if (!s || !ready || saving || epBusy || !progressReady) return;
    setSaving(true);
    setThroughError("");
    try {
      const watched = await watchedThrough(
        target,
        saved?.watched || [],
        ep,
        episodes.data?.total || 0,
        (offset) => api.episodes(id, offset),
      );
      await change(
        !saved || saved.status === "wish" ? "doing" : saved.status,
        watched,
      );
    } catch (error) {
      setThroughError(
        error instanceof Error ? error.message : "批量标记失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div
        className="detail"
        inert={reviewOpen}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="作品详情"
      >
        <div className="detail-top">
          <button className="icon-button" onClick={close} aria-label="返回">
            <ArrowLeft size={22} />
          </button>
          <span>作品详情</span>
          <button
            className="icon-button"
            aria-label="在 Bangumi 打开"
            onClick={() => openWebsite(`https://bgm.tv/subject/${id}`)}
          >
            <ArrowUpRight size={22} />
          </button>
        </div>
        {subject.loading ? (
          <div className="detail-body">
            <Skeleton />
          </div>
        ) : subject.error ? (
          <ErrorState retry={subject.retry} />
        ) : (
          s && (
            <>
              <div className="detail-banner">
                <img src={cover(s)} alt="" />
                <div />
              </div>
              <div className="detail-body">
                <div className="detail-title">
                  <img
                    className="detail-cover"
                    src={cover(s)}
                    alt={`${title(s)}封面`}
                  />
                  <div>
                    <span className="eyebrow">
                      {categories.find((c) => c.id === s.type)?.name || "作品"}{" "}
                      · {s.date?.slice(0, 4) || "未定"}
                    </span>
                    <h1>{title(s)}</h1>
                    {s.name_cn && <p>{displayText(s.name)}</p>}
                    <small>
                      {s.date || "日期待定"}
                      {s.eps ? ` / ${s.eps} 话` : ""}
                    </small>
                  </div>
                </div>
                <div className="score-panel">
                  <div>
                    <strong>{score(s)}</strong>
                    <span>
                      <span className="stars">★★★★★</span>
                      <small>{formatNumber(s.rating?.total)} 人评分</small>
                    </span>
                  </div>
                  <div>
                    <b>#{s.rating?.rank || s.rank || "—"}</b>
                    <small>Bangumi 排名</small>
                  </div>
                  <div>
                    <b>{formatNumber(s.collection?.doing)}</b>
                    <small>正在关注</small>
                  </div>
                </div>
                <div className="chips tags">
                  {s.tags?.slice(0, 6).map((t) => (
                    <span key={t.name}>{displayText(t.name)}</span>
                  ))}
                </div>
                <div className="detail-tabs">
                  {[
                    { id: "about", name: "简介" },
                    { id: "episodes", name: "章节" },
                    { id: "characters", name: "角色" },
                    { id: "comments", name: "评论" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      className={tab === t.id ? "active" : ""}
                      onClick={() => setTab(t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {tab === "about" && (
                  <>
                    <h2>关于这个故事</h2>
                    <p className={`synopsis ${expanded ? "" : "collapsed"}`}>
                      {displayText(s.summary) || "这部作品还没有简介。"}
                    </p>
                    {(s.summary?.length || 0) > 180 && (
                      <button
                        className="text-button"
                        onClick={() => setExpanded((v) => !v)}
                      >
                        {expanded ? "收起简介" : "展开完整简介"}
                        <ChevronRight size={14} />
                      </button>
                    )}
                    {s.rating?.count && (
                      <>
                        <h2>评分分布</h2>
                        <div className="rating-chart" aria-label="评分分布">
                          {Array.from({ length: 10 }, (_, i) => i + 1).map(
                            (n) => (
                              <div
                                key={n}
                                title={`${n}分：${s.rating!.count![n] || 0}人`}
                              >
                                <span
                                  style={{
                                    height: `${Math.max(3, ((s.rating!.count![n] || 0) / Math.max(...Object.values(s.rating!.count!), 1)) * 80)}px`,
                                  }}
                                />
                                <small>{n}</small>
                              </div>
                            ),
                          )}
                        </div>
                      </>
                    )}
                    <h2>作品资料</h2>
                    <dl className="infobox">
                      {s.infobox?.slice(0, 18).map((info, i) => (
                        <div key={i}>
                          <dt>{displayText(info.key)}</dt>
                          <dd>
                            {typeof info.value === "string"
                              ? displayText(info.value)
                              : info.value
                                  .map((v) => displayText(v.v))
                                  .join("、")}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <button
                      className="load-more"
                      onClick={() =>
                        openWebsite(`https://bgm.tv/subject/${id}`)
                      }
                    >
                      在 Bangumi 查看讨论与更多资料 <ArrowUpRight size={16} />
                    </button>
                  </>
                )}
                {tab === "episodes" && (
                  <>
                    <div className="section-heading">
                      <h2>章节与进度</h2>
                      <span className="muted">
                        已看 {saved?.watchedCount ?? saved?.watched.length ?? 0}{" "}
                        / {episodes.data?.total || 0}
                      </span>
                    </div>
                    <p className="muted">
                      {cloudMode
                        ? "点击右侧圆圈标记进度，记录同步到 Bangumi。"
                        : "点击右侧圆圈标记进度，记录保存在本机。"}
                    </p>
                    {cloudMode && !progressReady && (
                      <div className="inline-error">
                        {progressError || "正在读取账号章节进度…"}
                        {progressError && (
                          <button onClick={retryProgress}>重试</button>
                        )}
                      </div>
                    )}
                    {episodes.loading ? (
                      <Skeleton />
                    ) : episodes.error ? (
                      <ErrorState retry={episodes.retry} />
                    ) : !ep.length ? (
                      <Empty
                        heading="暂无章节资料"
                        body="该类型作品可能没有章节，或资料尚未添加。"
                      />
                    ) : (
                      <>
                        <p className="account-hint">
                          「看到这里」会标记本集及之前的正篇章节，保留后续已看进度。
                        </p>
                        {throughError && (
                          <p className="inline-error" role="alert">
                            {throughError}
                          </p>
                        )}
                        <div className="episodes">
                          {ep.map((e) => (
                            <div className="episode" key={e.id}>
                              <span>{String(e.sort).padStart(2, "0")}</span>
                              <div>
                                <h3>
                                  {displayText(e.name_cn || e.name) ||
                                    `第 ${e.sort} 话`}
                                </h3>
                                <small>{e.airdate || "日期待定"}</small>
                              </div>
                              <button
                                className="episode-through"
                                aria-label={`看到第${e.sort}话`}
                                disabled={
                                  !ready || saving || epBusy || !progressReady
                                }
                                onClick={() => void markThrough(e)}
                              >
                                看到这里
                              </button>
                              <button
                                disabled={
                                  !ready || saving || epBusy || !progressReady
                                }
                                aria-label={`${saved?.watched.includes(e.id) ? "取消标记" : "标记看过"}第${e.sort}话`}
                                className={`episode-toggle ${episodeToggleStyle(e, Boolean(saved?.watched.includes(e.id)), s.type, airToday)}`}
                                title={`${airStatus(e, airToday)} · ${saved?.watched.includes(e.id) ? "已看" : "未看"}`}
                                onClick={() =>
                                  change(
                                    !saved || saved.status === "wish"
                                      ? "doing"
                                      : saved.status,
                                    saved?.watched.includes(e.id)
                                      ? saved.watched.filter((n) => n !== e.id)
                                      : [...(saved?.watched || []), e.id],
                                  )
                                }
                              >
                                <Check size={19} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {ep.length < (episodes.data?.total || 0) && (
                      <button
                        className="load-more"
                        disabled={epBusy || saving}
                        onClick={loadEpisodes}
                      >
                        {epBusy
                          ? "正在加载"
                          : epError
                            ? "失败，点击重试"
                            : "加载更多章节"}
                      </button>
                    )}
                  </>
                )}
                {tab === "comments" && (
                  <CommentsTab
                    id={id}
                    openWebsite={(url) => void openWebsite(url)}
                  />
                )}
                {tab === "characters" && (
                  <>
                    <h2>与他们相遇</h2>
                    {characters.loading ? (
                      <Skeleton />
                    ) : characters.error ? (
                      <ErrorState retry={characters.retry} />
                    ) : !characters.data?.length ? (
                      <Empty
                        heading="暂无角色资料"
                        body="这部作品还没有关联角色。"
                      />
                    ) : (
                      <div className="characters">
                        {characters.data.map((c) => (
                          <button
                            key={c.id}
                            onClick={() =>
                              openWebsite(`https://bgm.tv/character/${c.id}`)
                            }
                          >
                            <img
                              src={imageUrl(c.images?.medium)}
                              alt=""
                              loading="lazy"
                            />
                            <h3>{displayText(c.name)}</h3>
                            <p>{displayText(c.role)}</p>
                            <small>
                              {c.actors
                                ?.map((a) => displayText(a.name))
                                .join(" / ")}
                            </small>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <div className="collection-options">
                  <h2>我的收藏</h2>
                  {saved && (
                    <div className="my-review">
                      <div>
                        <strong>
                          我的评分 ·{" "}
                          {saved.rate ? `${saved.rate} / 10` : "未评分"}
                        </strong>
                        {saved.comment && <p>{displayText(saved.comment)}</p>}
                      </div>
                      <button
                        className="text-button"
                        disabled={!ready || saving}
                        onClick={() => {
                          setReviewCompleting(false);
                          setReviewOpen(true);
                        }}
                      >
                        评分与短评
                      </button>
                    </div>
                  )}
                  <div className="chips">
                    {statuses.map((t) => (
                      <button
                        disabled={!ready || saving}
                        key={t.id}
                        className={saved?.status === t.id ? "active" : ""}
                        onClick={() => change(t.id)}
                      >
                        {statusName(t.id, s.type)}
                      </button>
                    ))}
                  </div>
                  {saved && !cloudMode && (
                    <button
                      disabled={saving}
                      className="text-button"
                      onClick={() => change(null)}
                    >
                      移出本机收藏
                    </button>
                  )}
                  {saved && cloudMode && (
                    <button
                      className="text-button"
                      onClick={() =>
                        openWebsite(`https://bgm.tv/subject/${id}`)
                      }
                    >
                      在 Bangumi 管理收藏 <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="detail-action">
                {collectionOpen && (
                  <div
                    className="collection-picker"
                    role="group"
                    aria-label="选择收藏状态"
                  >
                    <header>
                      <strong>加入哪个收藏？</strong>
                      <button
                        className="icon-button"
                        aria-label="取消选择收藏状态"
                        onClick={() => setCollectionOpen(false)}
                      >
                        <X size={18} />
                      </button>
                    </header>
                    <div className="collection-picker-options">
                      {statuses.map((status) => (
                        <button
                          key={status.id}
                          disabled={!ready || saving}
                          aria-pressed={saved?.status === status.id}
                          onClick={() => void change(status.id)}
                        >
                          {statusName(status.id, s.type)}
                          {saved?.status === status.id && <Check size={16} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <strong>
                    {saved
                      ? statusName(saved.status, s.type)
                      : "喜欢这个故事？"}
                  </strong>
                  <small>
                    {saved ? "已收藏到你的口袋" : "收藏起来，慢慢探索"}
                  </small>
                </div>
                <button
                  className="primary"
                  disabled={!ready || saving}
                  aria-expanded={collectionOpen}
                  onClick={() => setCollectionOpen((open) => !open)}
                >
                  {saving ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : saved ? (
                    <Check size={18} />
                  ) : (
                    <Plus size={18} />
                  )}{" "}
                  {saved ? "修改收藏" : "加入收藏"}
                </button>
              </div>
            </>
          )
        )}
      </div>
      {reviewOpen && s && (
        <ReviewSheet
          subject={s}
          initial={saved}
          cloudMode={cloudMode}
          completing={reviewCompleting}
          completingLabel={statusName(reviewTargetStatus, s.type)}
          close={() => setReviewOpen(false)}
          submit={async (review) => {
            const stored = await save(
              s,
              reviewCompleting ? reviewTargetStatus : (saved?.status ?? "done"),
              undefined,
              review,
            );
            if (stored) setReviewOpen(false);
            return stored;
          }}
        />
      )}
    </>
  );
}
