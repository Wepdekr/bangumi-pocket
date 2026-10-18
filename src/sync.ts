import { Preferences } from "@capacitor/preferences";
import { accountApi, remoteToStatus } from "./account-api";
import { readLibrary, writeLibrary, setPublicAccount } from "./api";
import { sessionVault } from "./vault";
import {
  readFriendsTimeline,
  readUserTimeline,
  setTimelineReaction,
} from "./friends-api";
import type { FriendEvent } from "./friends-api";
import type { Saved, Session, Subject, User, Review } from "./types";
import type { WatchThrough } from "./episode-progress";

type Library = Record<number, Saved>;
type ProgressOperation =
  | { episodeId: number; batch: true; episodeIds: number[] }
  | { episodeId: number; type: 0 | 2 };
type Pending = {
  status?: Saved["status"];
  review?: Review;
  episodes: Record<number, boolean>;
  // Ordered web operations survive restarts; episodes keeps older pending edits.
  progress?: ProgressOperation[];
};
const hasPending = (change: Pending) =>
  change.status !== undefined ||
  change.review !== undefined ||
  Object.keys(change.episodes).length > 0 ||
  !!change.progress?.length;
type AccountCache = {
  library: Library;
  pending: Record<number, Pending>;
  lastSync: number;
};
export type SyncState = {
  library: Library;
  user: User | null;
  ready: boolean;
  busy: boolean;
  error: string;
  lastSync: number;
  pending: number;
  guestCount: number;
  progressErrors: Record<number, string>;
};
const emptyCache = (): AccountCache => ({
  library: {},
  pending: {},
  lastSync: 0,
});
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "同步失败，请重试。";
type Dependencies = {
  onSessionChange?: (session: Session | null) => void;
  api: typeof accountApi;
  vault: typeof sessionVault;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  readGuest: () => Promise<Library>;
  writeGuest: (library: Library) => Promise<unknown>;
};
const defaults: Dependencies = {
  onSessionChange: setPublicAccount,
  api: accountApi,
  vault: sessionVault,
  get: async (key) => (await Preferences.get({ key })).value,
  set: async (key, value) => Preferences.set({ key, value }),
  readGuest: readLibrary,
  writeGuest: writeLibrary,
};

export class SyncController {
  private state: SyncState = {
    library: {},
    user: null,
    ready: false,
    busy: false,
    error: "",
    lastSync: 0,
    pending: 0,
    guestCount: 0,
    progressErrors: {},
  };
  private session: Session | null = null;
  private account = emptyCache();
  private guest: Library = {};
  private listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private boot: Promise<void> | null = null;
  private scheduledSync: Promise<boolean> | null = null;
  constructor(private deps: Dependencies = defaults) {}
  getSnapshot = () => this.state;
  userTimeline = async (user: User, until?: number) => {
    const session = this.session;
    if (!session) throw new Error("请先连接 Bangumi 账号。");
    const page = await readUserTimeline(session.token, user, until);
    if (this.session !== session)
      throw new Error("账号已切换，请重新读取时间线。");
    return page;
  };
  friendsTimeline = async (until?: number) => {
    const session = this.session;
    if (!session) throw new Error("请先连接 Bangumi 账号。");
    const events = await readFriendsTimeline(
      session.token,
      session.user,
      until,
    );
    if (this.session !== session)
      throw new Error("账号已切换，请重新读取好友动态。");
    return events;
  };
  reactToTimeline = async (event: FriendEvent, value: number | null) => {
    const session = this.session;
    if (!session) throw new Error("请先连接 Bangumi 账号。");
    await setTimelineReaction(session.token, event, value);
    if (this.session !== session)
      throw new Error("账号已切换，请重新读取动态。");
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      this.publish({ busy: true });
      try {
        return await work();
      } finally {
        this.publish({ busy: false });
      }
    });
    this.tail = next.catch(() => {});
    return next;
  }
  private async readAccount(id: number) {
    const raw = await this.deps.get(`account-library-v1:${id}`);
    if (!raw) return emptyCache();
    const cache = JSON.parse(raw) as AccountCache;
    if (!cache.library || !cache.pending)
      throw new Error("账号缓存损坏，未覆盖已有数据。");
    return cache;
  }
  private async store(next: AccountCache) {
    if (!this.session) throw new Error("请先连接账号。");
    await this.deps.set(
      `account-library-v1:${this.session.user.id}`,
      JSON.stringify(next),
    );
    this.account = next;
    this.publish({
      library: next.library,
      lastSync: next.lastSync,
      pending: Object.keys(next.pending).length,
    });
  }
  initialize() {
    if (this.boot) return this.boot;
    this.boot = this.exclusive(async () => {
      try {
        this.guest = await this.deps.readGuest();
        this.publish({
          guestCount: Object.keys(this.guest).length,
          library: this.guest,
        });
        const session = await this.deps.vault.read();
        if (session?.token && session.user?.id) {
          const account = await this.readAccount(session.user.id);
          this.session = session;
          this.deps.onSessionChange?.(session);
          this.account = account;
          this.publish({
            user: session.user,
            library: account.library,
            lastSync: account.lastSync,
            pending: Object.keys(account.pending).length,
            ready: true,
          });
          await this.syncUnlocked();
        }
      } catch (error) {
        this.publish({ error: errorMessage(error) });
      } finally {
        this.publish({ ready: true });
      }
    });
    return this.boot;
  }
  connect(token: string) {
    return this.exclusive(async () => {
      token = token.trim().replace(/^Bearer\s+/i, "");
      if (!token || /\s/.test(token) || token.length > 4096)
        throw new Error("请粘贴完整的个人访问令牌。");
      const response = await this.deps.api.me(token);
      const user: User = {
        id: response.id,
        username: response.username,
        nickname: response.nickname,
        avatar: response.avatar,
      };
      if (!Number.isInteger(user.id) || user.id <= 0)
        throw new Error("无法确认令牌对应的账号。");
      const account = await this.readAccount(user.id);
      await this.deps.vault.write({ token, user });
      this.session = { token, user };
      this.deps.onSessionChange?.(this.session);
      this.account = account;
      this.publish({
        user,
        library: account.library,
        pending: Object.keys(account.pending).length,
        lastSync: account.lastSync,
        error: "",
        progressErrors: {},
      });
      // Failure to pull does not erase an authenticated session or its offline edits.
      await this.syncUnlocked();
    });
  }
  disconnect() {
    return this.exclusive(async () => {
      await this.deps.vault.clear();
      this.session = null;
      this.deps.onSessionChange?.(null);
      this.account = emptyCache();
      this.publish({
        user: null,
        library: this.guest,
        error: "",
        pending: 0,
        lastSync: 0,
        progressErrors: {},
      });
    });
  }
  private async acknowledge(
    id: number,
    field: "collection" | "progress" | number[],
  ) {
    const entry = this.account.pending[id];
    if (!entry) return;
    const change: Pending = { ...entry, episodes: { ...entry.episodes } };
    if (field === "collection") {
      delete change.status;
      delete change.review;
    } else if (field === "progress") {
      change.progress = change.progress?.slice(1);
    } else for (const ep of field) delete change.episodes[ep];
    const pending = { ...this.account.pending };
    if (!hasPending(change)) delete pending[id];
    else pending[id] = change;
    await this.store({ ...this.account, pending });
  }
  private async flush() {
    if (!this.session) return;
    const token = this.session.token;
    for (const key of Object.keys(this.account.pending)) {
      const id = Number(key);
      const change = this.account.pending[id];
      if (change?.status !== undefined || change?.review !== undefined) {
        const status = change.status ?? this.account.library[id]?.status;
        if (!status) throw new Error("收藏状态缺失，已保留待同步评价。");
        await this.deps.api.setCollection(token, id, status, change.review);
        // Status and review share one request and one persisted acknowledgement.
        await this.acknowledge(id, "collection");
      }
      for (const watched of [true, false]) {
        const ids = Object.entries(this.account.pending[id]?.episodes || {})
          .filter(([, value]) => value === watched)
          .map(([ep]) => Number(ep));
        for (let offset = 0; offset < ids.length; offset += 100) {
          const chunk = ids.slice(offset, offset + 100);
          await this.deps.api.setEpisodes(token, id, chunk, watched);
          await this.acknowledge(id, chunk);
        }
      }
      while (this.account.pending[id]?.progress?.length) {
        const operation = this.account.pending[id].progress![0];
        await this.deps.api.setEpisodeProgress(
          token,
          operation.episodeId,
          "batch" in operation
            ? { batch: true, episodeIds: operation.episodeIds }
            : { type: operation.type },
        );
        await this.acknowledge(id, "progress");
      }
    }
  }
  private async pull() {
    if (!this.session) return;
    const library: Library = {};
    let offset = 0,
      total = 0;
    do {
      const page = await this.deps.api.collections(
        this.session.token,
        // The API rejects numeric UIDs once an account has chosen a username.
        this.session.user.username,
        offset,
      );
      if (!Array.isArray(page.data) || !Number.isFinite(page.total))
        throw new Error("收藏列表响应异常，已保留当前记录。");
      total = page.total;
      if (!page.data.length && offset < total)
        throw new Error("收藏列表未完整加载，已保留当前记录。");
      for (const row of page.data) {
        if (!remoteToStatus[row.type]) continue;
        const previous = this.account.library[row.subject_id];
        const subject = {
          ...previous?.subject,
          ...row.subject,
          id: row.subject_id,
          type: row.subject_type,
        };
        if (row.subject?.score !== undefined)
          subject.rating = { score: row.subject.score, rank: row.subject.rank };
        library[row.subject_id] = {
          rate: row.rate ?? 0,
          comment: row.comment ?? "",
          subject,
          status: remoteToStatus[row.type],
          updated: Date.parse(row.updated_at) || 0,
          watched: previous?.watched || [],
          watchedCount: row.ep_status || 0,
          episodesLoaded: false,
        };
      }
      offset += page.data.length;
    } while (offset < total);
    // Commit only a complete pull. A network failure halfway through cannot delete the cache.
    await this.store({ ...this.account, library, lastSync: Date.now() });
  }
  private async syncUnlocked() {
    if (!this.session) return true;
    try {
      await this.flush();
      await this.pull();
      this.publish({ error: "" });
      return true;
    } catch (error) {
      this.publish({ error: errorMessage(error) });
      return false;
    }
  }
  sync = () => {
    if (this.scheduledSync) return this.scheduledSync;
    const task = this.exclusive(() => this.syncUnlocked());
    this.scheduledSync = task;
    const clear = () => {
      if (this.scheduledSync === task) this.scheduledSync = null;
    };
    task.then(clear, clear);
    return task;
  };
  save(
    subject: Subject,
    status: Saved["status"] | null,
    watched?: number[],
    review?: Review,
    through?: WatchThrough,
  ) {
    return this.exclusive(async () => {
      if (
        review &&
        (!Number.isInteger(review.rate) || review.rate < 0 || review.rate > 10)
      )
        throw new Error("评分必须是 0 到 10 之间的整数。");
      const old = this.state.library[subject.id];
      if (
        through &&
        (!watched ||
          ![2, 6].includes(subject.type ?? 0) ||
          !Number.isSafeInteger(through.episodeId) ||
          through.episodeId <= 0 ||
          !through.episodeIds.includes(through.episodeId) ||
          through.episodeIds.some(
            (id) =>
              !Number.isSafeInteger(id) || id <= 0 || !watched.includes(id),
          ))
      )
        throw new Error("批量章节资料异常，请重新加载后重试。");
      if (!this.session) {
        const library = { ...this.guest };
        if (status === null) delete library[subject.id];
        else
          library[subject.id] = {
            ...old,
            ...review,
            subject,
            status,
            watched: watched ?? old?.watched ?? [],
            updated: Date.now(),
          };
        await this.deps.writeGuest(library);
        this.guest = library;
        this.publish({ library, guestCount: Object.keys(library).length });
        return true;
      }
      if (status === null)
        throw new Error("请在 Bangumi 原站管理删除收藏，随后刷新账号片单。");
      if (watched !== undefined && old && !old.episodesLoaded)
        throw new Error("请先加载账号章节进度，避免覆盖已有记录。");
      const change: Pending = {
        ...this.account.pending[subject.id],
        episodes: { ...this.account.pending[subject.id]?.episodes },
        progress: [...(this.account.pending[subject.id]?.progress || [])],
      };
      if (!old || old.status !== status) change.status = status;
      if (review !== undefined) change.review = { ...review };
      if (watched !== undefined) {
        const before = new Set(old?.watched || []);
        const after = new Set(watched);
        if (through) {
          change.progress!.push({
            ...through,
            episodeIds: [...through.episodeIds],
            batch: true,
          });
        }
        for (const ep of new Set([...after, ...before]))
          if (
            before.has(ep) !== after.has(ep) &&
            !through?.episodeIds.includes(ep)
          ) {
            if ([2, 6].includes(subject.type ?? 0)) {
              change.progress!.push({
                episodeId: ep,
                type: after.has(ep) ? 2 : 0,
              });
            } else change.episodes[ep] = after.has(ep);
          }
      }
      const pending = { ...this.account.pending };
      if (hasPending(change)) pending[subject.id] = change;
      const saved: Saved = {
        ...old,
        ...review,
        subject,
        status,
        watched: watched ?? old?.watched ?? [],
        updated: Date.now(),
        watchedCount:
          watched !== undefined ? watched.length : old?.watchedCount || 0,
        episodesLoaded:
          watched !== undefined ? true : (old?.episodesLoaded ?? true),
      };
      await this.store({
        ...this.account,
        library: { ...this.account.library, [subject.id]: saved },
        pending,
      });
      return this.syncUnlocked();
    });
  }
  private async hydrateUnlocked(id: number) {
    const old = this.account.library[id];
    if (!this.session || !old || old.episodesLoaded) return;
    const watched: number[] = [];
    let offset = 0,
      total = 0;
    do {
      const page = await this.deps.api.episodes(this.session.token, id, offset);
      total = page.total;
      if (
        !Array.isArray(page.data) ||
        !Number.isFinite(total) ||
        (!page.data.length && offset < total)
      )
        throw new Error("账号章节进度未完整加载，请重试。");
      for (const row of page.data)
        if (row.type === 2) watched.push(row.episode.id);
      offset += page.data.length;
    } while (offset < total);
    const merged = new Set(watched);
    for (const [ep, value] of Object.entries(
      this.account.pending[id]?.episodes || {},
    )) {
      if (value) merged.add(Number(ep));
      else merged.delete(Number(ep));
    }
    for (const operation of this.account.pending[id]?.progress || []) {
      if ("batch" in operation) {
        for (const ep of operation.episodeIds) merged.add(ep);
      } else if (operation.type === 2) merged.add(operation.episodeId);
      else merged.delete(operation.episodeId);
    }
    const saved = {
      ...old,
      watched: [...merged],
      watchedCount: merged.size,
      episodesLoaded: true,
    };
    await this.store({
      ...this.account,
      library: { ...this.account.library, [id]: saved },
    });
  }
  hydrate = (id: number) =>
    this.exclusive(async () => {
      try {
        await this.hydrateUnlocked(id);
        const errors = { ...this.state.progressErrors };
        delete errors[id];
        this.publish({ progressErrors: errors });
        return true;
      } catch (error) {
        this.publish({
          progressErrors: {
            ...this.state.progressErrors,
            [id]: errorMessage(error),
          },
        });
        return false;
      }
    });
  importGuest = () =>
    this.exclusive(async () => {
      if (!this.session) return false;
      if (!(await this.syncUnlocked())) return false;
      // Import is additive. Existing remote statuses, ratings, privacy and comments are kept.
      for (const local of Object.values(this.guest)) {
        const id = local.subject.id;
        let old = this.account.library[id];
        if (old && local.watched.length) {
          await this.hydrateUnlocked(id);
          old = this.account.library[id];
        }
        const additions = local.watched.filter(
          (ep) => !old?.watched.includes(ep),
        );
        if (old && !additions.length) continue;
        const change: Pending = {
          episodes: Object.fromEntries(additions.map((ep) => [ep, true])),
        };
        if (!old) change.status = local.status;
        if (!old && (local.rate !== undefined || local.comment !== undefined))
          change.review = {
            rate: local.rate ?? 0,
            comment: local.comment ?? "",
          };
        const watched = [
          ...new Set([...(old?.watched || []), ...local.watched]),
        ];
        const library = {
          ...this.account.library,
          [id]: {
            ...local,
            ...old,
            watched,
            watchedCount: watched.length,
            episodesLoaded: true,
          },
        };
        await this.store({
          ...this.account,
          library,
          pending: { ...this.account.pending, [id]: change },
        });
      }
      return this.syncUnlocked();
    });
}
export const syncController = new SyncController();
