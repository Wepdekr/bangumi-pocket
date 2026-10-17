import { useEffect, useRef } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import { FriendFeed } from "./FriendsView";
import { displayText } from "./text";
import { imageUrl } from "./images";
import type { Subject, User } from "./types";

export type UserTimelineRoute = { user: User; accountId: number };

export function userTimelineRoute(state: unknown): UserTimelineRoute | null {
  const route = (state as { userTimeline?: UserTimelineRoute } | null)
    ?.userTimeline;
  if (
    !route ||
    !Number.isSafeInteger(route.accountId) ||
    route.accountId <= 0 ||
    !Number.isSafeInteger(route.user?.id) ||
    route.user.id <= 0 ||
    typeof route.user.username !== "string" ||
    !route.user.username
  )
    return null;
  return route;
}

export default function UserTimeline({
  user,
  currentUser,
  lastSync,
  covered,
  close,
  open,
  openWebsite,
}: {
  user: User;
  currentUser: User;
  lastSync: number;
  covered: boolean;
  close: () => void;
  open: (subject: Subject) => void;
  openWebsite: (url: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const isSelf = user.id === currentUser.id;
  const label = isSelf
    ? "我的时间线"
    : `${displayText(user.nickname || user.username)}的时间线`;
  useEffect(() => {
    if (covered) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector(".update-dialog")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), summary, a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex='0']",
          ) || []),
        ];
        const first = items[0],
          last = items.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [covered, user.id]);
  return (
    <div
      className="detail user-timeline"
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      inert={covered}
    >
      <div className="detail-top">
        <button className="icon-button" onClick={close} aria-label="返回动态">
          <ArrowLeft size={22} />
        </button>
        <span>{isSelf ? "我的时间线" : "好友时间线"}</span>
        <span className="timeline-header-spacer" aria-hidden="true" />
      </div>
      <div className="user-timeline-body">
        <header className="timeline-profile">
          {user.avatar?.medium ? (
            <img src={imageUrl(user.avatar.medium)} alt="" />
          ) : (
            <span className="timeline-avatar">
              <UserRound size={28} />
            </span>
          )}
          <div>
            <h1>{displayText(user.nickname || user.username)}</h1>
            <p>@{user.username}</p>
          </div>
        </header>
        <FriendFeed
          currentUser={currentUser}
          lastSync={lastSync}
          targetUser={user}
          open={open}
          openWebsite={openWebsite}
          openTimeline={() => {}}
        />
      </div>
    </div>
  );
}
