import { displayText } from "./text";
import { useEffect, useRef, useState } from "react";
import { Star, X, LoaderCircle } from "lucide-react";
import type { Review, Saved, Subject } from "./types";

const labels = [
  "未评分",
  "不忍直视",
  "很差",
  "差",
  "较差",
  "不过不失",
  "还行",
  "推荐",
  "力荐",
  "神作",
  "超神作",
];
export default function ReviewSheet({
  subject,
  initial,
  cloudMode,
  completing,
  completingLabel = "看过",
  close,
  submit,
}: {
  subject: Subject;
  initial?: Saved;
  cloudMode: boolean;
  completing: boolean;
  completingLabel?: string;
  close: () => void;
  submit: (review?: Review) => Promise<boolean>;
}) {
  const [rate, setRate] = useState(initial?.rate ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) close();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea:not(:disabled)",
        ) || [],
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
    document.addEventListener("keydown", keydown, true);
    const back = () => {
      if (!busyRef.current) close();
    };
    document.addEventListener("bangumi-review-back", back);
    return () => {
      document.removeEventListener("bangumi-review-back", back);
      document.removeEventListener("keydown", keydown, true);
      previous?.focus();
    };
  }, []);
  async function save(review?: Review) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await submit(review)))
        setError("保存失败，请重试。你的输入仍保留在这里。");
    } catch {
      setError("保存失败，请重试。你的输入仍保留在这里。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="review-overlay">
      <div
        className="review-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        tabIndex={-1}
        ref={panel}
      >
        <header>
          <div>
            <span className="eyebrow">YOUR IMPRESSION</span>
            <h2 id="review-title">
              {completing
                ? completingLabel === "搁置" || completingLabel === "抛弃"
                  ? `标记${completingLabel}，留下你的感想`
                  : "看完了，留下你的感想"
                : "我的评分与短评"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="取消评价"
            disabled={busy}
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <p className="review-subject">
          {displayText(subject.name_cn || subject.name)}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save({ rate, comment });
          }}
        >
          <div className="review-score">
            <strong>{rate ? `${rate} / 10` : "未评分"}</strong>
            <span>{labels[rate]}</span>
          </div>
          <div className="review-ratings" role="group" aria-label="选择评分">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
              <button
                type="button"
                key={value}
                disabled={busy}
                aria-label={`评${value}分`}
                aria-pressed={rate === value}
                className={value <= rate ? "selected" : ""}
                onClick={() => setRate(value)}
              >
                <Star
                  size={20}
                  fill={value <= rate ? "currentColor" : "none"}
                />
                <span>{value}</span>
              </button>
            ))}
          </div>
          <button
            className="text-button"
            type="button"
            disabled={busy || rate === 0}
            onClick={() => setRate(0)}
          >
            清除评分
          </button>
          <label htmlFor="review-comment">
            短评 <small>选填</small>
          </label>
          <textarea
            id="review-comment"
            rows={4}
            value={comment}
            disabled={busy}
            placeholder="哪些瞬间让你记住了这个故事？"
            onChange={(event) => setComment(event.target.value)}
          />
          <p className="account-hint">
            {cloudMode
              ? "评分和短评将按这部作品现有的收藏可见性同步到 Bangumi。"
              : "评分和短评保存在本机。"}
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="review-buttons">
            <button type="submit" className="primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={16} />}
              {completing ? `保存并标记${completingLabel}` : "保存评价"}
            </button>
            {completing && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void save()}
              >
                暂不评价，标记{completingLabel}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
