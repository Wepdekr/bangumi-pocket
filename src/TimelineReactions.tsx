import { displayText } from "./text";
import { useRef, useState } from "react";
import { SmilePlus, LoaderCircle } from "lucide-react";
import { reactionImages, reactionTarget } from "./friends-api";
import type { FriendEvent } from "./friends-api";
import type { User } from "./types";
import { syncController } from "./sync";

export default function TimelineReactions({
  event,
  user,
  update,
}: {
  event: FriendEvent;
  user: User;
  update: (event: FriendEvent) => void;
}) {
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const target = reactionTarget(event);
  const reactions = (event.reactions || []).filter(
    (r) => Number.isInteger(r.value) && Array.isArray(r.users),
  );
  const people = [
    ...new Map(
      reactions.flatMap((r) => r.users).map((u) => [u.id, u]),
    ).values(),
  ];
  if (!target && !people.length) return null;
  const selected = (value: number) =>
    reactions.some(
      (r) => r.value === value && r.users.some((u) => u.id === user.id),
    );
  const emoji = (value: number) =>
    reactionImages[value] ? (
      <img
        src={`/reactions/${reactionImages[value]}.gif`}
        alt={`表情 ${value}`}
      />
    ) : (
      <span>表情 {value}</span>
    );
  async function react(value: number) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const remove = selected(value);
    try {
      await syncController.reactToTimeline(event, remove ? null : value);
      // Only change counts after the server acknowledges the write.
      // A user has exactly one reaction per target; switching replaces it.
      const next = reactions.map((r) => ({
        ...r,
        users: r.users.filter((u) => u.id !== user.id),
      }));
      if (!remove) {
        const item = next.find((r) => r.value === value);
        const me = {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
        };
        if (item) item.users.push(me);
        else next.push({ value, users: [me] });
      }
      update({ ...event, reactions: next.filter((r) => r.users.length) });
      setPicker(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "表情互动失败，请重试。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="timeline-reactions" aria-label="表情互动" aria-busy={busy}>
      <div className="reaction-row">
        {reactions
          .filter((r) => r.users.length)
          .map((r) => (
            <button
              key={r.value}
              className="reaction-chip"
              aria-label={`表情 ${r.value}，${r.users.length} 人`}
              aria-pressed={selected(r.value)}
              disabled={busy || !target?.values.includes(r.value)}
              title={r.users
                .map((u) => displayText(u.nickname || u.username))
                .join("、")}
              onClick={() => void react(r.value)}
            >
              {emoji(r.value)}
              <span>{r.users.length}</span>
            </button>
          ))}
        {target && (
          <button
            className="text-button"
            disabled={busy}
            aria-expanded={picker}
            onClick={() => setPicker((v) => !v)}
          >
            <SmilePlus size={17} />
            发表情
          </button>
        )}
        {busy && (
          <LoaderCircle size={16} className="spin" aria-label="正在提交表情" />
        )}
      </div>
      {people.length ? (
        <details className="reaction-people">
          <summary>{people.length} 人互动</summary>
          <p>
            {people
              .map((u) => displayText(u.nickname || u.username))
              .join("、")}
          </p>
        </details>
      ) : (
        <small className="reaction-empty">还没有人互动</small>
      )}
      {picker && target && (
        <div className="reaction-picker" role="group" aria-label="选择表情">
          {target.values.map((value) => (
            <button
              key={value}
              disabled={busy}
              aria-label={`选择表情 ${value}`}
              aria-pressed={selected(value)}
              onClick={() => void react(value)}
            >
              {emoji(value)}
            </button>
          ))}
          <small>点已选表情可取消，选其他表情可更换。</small>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
