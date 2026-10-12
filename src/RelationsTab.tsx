import { useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { api } from "./api";
import { imageUrl } from "./images";
import { displayText } from "./text";
import { relationGroups } from "./relation-order";
import type { RelatedSubject, Subject } from "./types";

export default function RelationsTab({
  id,
  open,
}: {
  id: number;
  open: (subject: Subject) => void;
}) {
  const [rows, setRows] = useState<RelatedSubject[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setRows(undefined);
    setError(false);
    api
      .relations(id)
      .then((data) => {
        if (active) setRows(data);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [id, retry]);
  const groups = relationGroups(rows || []);
  return (
    <section className="relations" aria-label="关联作品">
      <h2>关联作品</h2>
      {error ? (
        <div className="inline-error">
          关联作品加载失败
          <button
            className="text-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      ) : !rows ? (
        <p className="muted">正在读取关联作品…</p>
      ) : !rows.length ? (
        <p className="muted">暂无关联作品。</p>
      ) : (
        groups.map(([relation, subjects]) => (
          <div className="relation-group" key={relation}>
            <h3>{relation}</h3>
            {subjects.map((subject) => (
              <button
                className="relation-row"
                key={subject.id}
                onClick={() => open(subject)}
              >
                <img
                  src={imageUrl(
                    subject.images?.common ||
                      subject.images?.medium ||
                      subject.images?.large,
                  )}
                  alt=""
                  loading="lazy"
                />
                <div>
                  <strong>
                    {displayText(subject.name_cn || subject.name)}
                  </strong>
                  {subject.name_cn && <p>{displayText(subject.name)}</p>}
                  <small>
                    {(
                      {
                        1: "书籍",
                        2: "动画",
                        3: "音乐",
                        4: "游戏",
                        6: "三次元",
                      } as Record<number, string>
                    )[subject.type || 0] || "作品"}
                  </small>
                </div>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
