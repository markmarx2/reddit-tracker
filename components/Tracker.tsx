"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArchiveUnavailableError, fetchActivity } from "@/lib/archive";
import {
  normalizeUsername,
  USERNAME_RE,
  WINDOW_DAYS,
  type ActivityResult,
  type CommentItem,
  type Kind,
  type PostItem,
  type TimeRange,
} from "@/lib/shared";

type Status =
  | { state: "idle" }
  | { state: "loading"; found: number }
  | { state: "error"; message: string }
  | { state: "done"; result: ActivityResult };

type Sort = "new" | "top";

const KINDS: Kind[] = ["posts", "comments"];
const KIND_LABEL: Record<Kind, string> = { posts: "Posts", comments: "Comments" };
const MAX_CHIPS = 12;
const SCORE_TIP = "The archive records scores about 36 hours after something is posted.";

export default function Tracker({
  initialUser,
  initialKind,
}: {
  initialUser: string;
  initialKind: Kind;
}) {
  const [input, setInput] = useState(initialUser);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [subreddit, setSubreddit] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");
  const inFlight = useRef<AbortController | null>(null);

  async function search(rawUser: string, nextKind: Kind) {
    const user = normalizeUsername(rawUser);
    if (!USERNAME_RE.test(user)) {
      setStatus({ state: "error", message: "Enter a Reddit username, like spez or u/spez." });
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setInput(user);
    setSubreddit(null);
    setStatus({ state: "loading", found: 0 });
    window.history.replaceState(null, "", `?u=${encodeURIComponent(user)}&type=${nextKind}`);

    try {
      const result = await fetchActivity(user, nextKind, {
        signal: controller.signal,
        onProgress: (found) => {
          if (inFlight.current === controller) setStatus({ state: "loading", found });
        },
      });
      if (inFlight.current === controller) setStatus({ state: "done", result });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message =
        err instanceof ArchiveUnavailableError
          ? err.message
          : "Something went wrong. Check your connection and try again.";
      setStatus({ state: "error", message });
    }
  }

  // Run the search in the URL (?u=name&type=posts) when the page first loads.
  useEffect(() => {
    if (initialUser) void search(initialUser, initialKind);
    return () => inFlight.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseKind(next: Kind) {
    if (next === kind) return;
    setKind(next);
    if (status.state !== "idle" && USERNAME_RE.test(normalizeUsername(input))) {
      void search(input, next);
    }
  }

  const retry = () => void search(input, kind);
  const result = status.state === "done" ? status.result : null;

  const subredditCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of result?.items ?? []) {
      counts.set(item.subreddit, (counts.get(item.subreddit) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [result]);

  const visible = useMemo(() => {
    const items = result?.items ?? [];
    const filtered = subreddit ? items.filter((i) => i.subreddit === subreddit) : items;
    return sort === "top"
      ? [...filtered].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      : filtered;
  }, [result, subreddit, sort]);

  const noun = (n: number) => (kind === "posts" ? plural(n, "post") : plural(n, "comment"));
  const hasPendingScores = visible.some((i) => i.score === null);

  return (
    <main className="page">
      <header className="masthead">
        <h1>
          <Logo />
          Reddit Tracker
        </h1>
        <p>See a Reddit user&apos;s posts from the last 14 days or comments from the last 7 days.</p>
      </header>

      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(input, kind);
        }}
      >
        <label className="sr-only" htmlFor="username">
          Reddit username
        </label>
        <div className="field">
          <span className="field-prefix" aria-hidden="true">
            u/
          </span>
          <input
            id="username"
            name="username"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="username"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="primary" disabled={status.state === "loading"}>
          {status.state === "loading" ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="tabs" role="radiogroup" aria-label="What to show">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className="tab"
            onClick={() => chooseKind(k)}
          >
            {KIND_LABEL[k]} <span className="tab-hint">last {WINDOW_DAYS[k]} days</span>
          </button>
        ))}
      </div>

      {status.state === "idle" && (
        <p className="hint">Tip: you can also paste a profile link, like reddit.com/user/spez.</p>
      )}

      {status.state === "loading" && (
        <div aria-live="polite">
          <p className="hint">
            Searching the archive…
            {status.found > 0 && ` ${formatNumber(status.found)} found so far.`}
          </p>
          <LoadingList />
        </div>
      )}

      {status.state === "error" && (
        <div className="notice error" role="alert">
          {status.message}{" "}
          <button type="button" className="link-button" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {result && (
        <section className="results" aria-live="polite">
          <div className="profile">
            <div className="avatar" aria-hidden="true">
              {result.username.charAt(0).toUpperCase()}
            </div>
            <div className="profile-text">
              <a
                className="profile-name"
                href={`https://www.reddit.com/user/${result.username}/`}
                target="_blank"
                rel="noopener noreferrer"
              >
                u/{result.username}
              </a>
              <p className="profile-meta">Checked at {formatClock(result.checkedAt)}</p>
            </div>
            <button type="button" className="secondary" onClick={retry}>
              Refresh
            </button>
          </div>

          {result.failed.length > 0 && (
            <div className="notice warn">
              The archive was busy and didn&apos;t return {describeRanges(result.failed)}.{" "}
              <button type="button" className="link-button" onClick={retry}>
                Try again
              </button>
            </div>
          )}

          {result.stoppedEarly?.reason === "too-active" && (
            <p className="notice">
              This account is very active, so only the newest {formatNumber(result.items.length)} are
              shown (back to {formatDateTime(result.stoppedEarly.at)}).
            </p>
          )}

          {result.stoppedEarly?.reason === "slow" && (
            <div className="notice warn">
              The archive was slow, so only activity since {formatDateTime(result.stoppedEarly.at)}{" "}
              was loaded.{" "}
              <button type="button" className="link-button" onClick={retry}>
                Try again
              </button>
            </div>
          )}

          <div className="summary">
            <p>
              <strong>{formatNumber(visible.length)}</strong> {noun(visible.length)} in the last{" "}
              {result.days} days{subreddit ? ` in ${communityLabel(subreddit)}` : ""}
            </p>
            {result.items.length > 1 && (
              <div className="segmented" role="radiogroup" aria-label="Sort">
                <button type="button" role="radio" aria-checked={sort === "new"} onClick={() => setSort("new")}>
                  Newest
                </button>
                <button type="button" role="radio" aria-checked={sort === "top"} onClick={() => setSort("top")}>
                  Top
                </button>
              </div>
            )}
          </div>

          {subredditCounts.length > 1 && (
            <div className="chips" role="group" aria-label="Filter by community">
              <button
                type="button"
                className="chip"
                aria-pressed={subreddit === null}
                onClick={() => setSubreddit(null)}
              >
                All <span>{result.items.length}</span>
              </button>
              {subredditCounts.slice(0, MAX_CHIPS).map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  className="chip"
                  aria-pressed={subreddit === name}
                  onClick={() => setSubreddit(subreddit === name ? null : name)}
                >
                  {communityLabel(name)} <span>{count}</span>
                </button>
              ))}
            </div>
          )}

          {hasPendingScores && <p className="fine-print">{SCORE_TIP}</p>}

          {visible.length === 0 ? (
            <div className="empty">
              <p>
                No {noun(0)} in the last {result.days} days.
              </p>
              <p className="muted">
                Check the spelling. The archive can&apos;t tell a quiet account from one that
                doesn&apos;t exist.
              </p>
            </div>
          ) : (
            <ol className="feed">
              {visible.map((item) => (
                <li key={item.id}>
                  {item.kind === "post" ? <PostCard post={item} /> : <CommentCard comment={item} />}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <footer className="site-footer">
        Data from the{" "}
        <a href="https://github.com/ArthurHeitmann/arctic_shift" target="_blank" rel="noopener noreferrer">
          Arctic Shift
        </a>{" "}
        archive, which picks up new activity within minutes. Not affiliated with Reddit.
      </footer>
    </main>
  );
}

function PostCard({ post }: { post: PostItem }) {
  return (
    <article className="card">
      <Meta subreddit={post.subreddit} createdUtc={post.createdUtc}>
        {post.status && <span className="tag tag-status">{post.status}</span>}
        {post.flair && <span className="tag">{post.flair}</span>}
        {post.nsfw && <span className="tag tag-warn">NSFW</span>}
      </Meta>
      <h2 className="card-title">
        <a href={post.permalink} target="_blank" rel="noopener noreferrer">
          {post.title}
        </a>
      </h2>
      {post.externalUrl && (
        <a className="card-link" href={post.externalUrl} target="_blank" rel="noopener noreferrer">
          {post.domain ?? hostname(post.externalUrl)} ↗
        </a>
      )}
      {post.text && <ExpandableText text={post.text} />}
      <footer className="card-stats">
        <Score score={post.score} createdUtc={post.createdUtc} />
        {post.numComments !== null && (
          <span>
            {formatNumber(post.numComments)} {plural(post.numComments, "comment")}
          </span>
        )}
      </footer>
    </article>
  );
}

function CommentCard({ comment }: { comment: CommentItem }) {
  return (
    <article className="card">
      <Meta subreddit={comment.subreddit} createdUtc={comment.createdUtc}>
        {comment.status && <span className="tag tag-status">{comment.status}</span>}
        {comment.edited && <span className="tag">Edited</span>}
        {comment.nsfw && <span className="tag tag-warn">NSFW</span>}
      </Meta>
      <p className="card-context">
        on{" "}
        <a href={comment.postPermalink} target="_blank" rel="noopener noreferrer">
          {comment.postTitle || "this post"}
        </a>
      </p>
      <ExpandableText text={comment.body} />
      <footer className="card-stats">
        <Score score={comment.score} createdUtc={comment.createdUtc} />
        <a href={comment.permalink} target="_blank" rel="noopener noreferrer">
          View on Reddit ↗
        </a>
      </footer>
    </article>
  );
}

function Score({ score, createdUtc }: { score: number | null; createdUtc: number }) {
  if (score !== null) {
    return (
      <span>
        {formatNumber(score)} {plural(score, "point")}
      </span>
    );
  }
  const recent = Date.now() / 1000 - createdUtc < 48 * 3600;
  return <span title={SCORE_TIP}>{recent ? "Score pending" : "Score not recorded"}</span>;
}

function Meta({
  subreddit,
  createdUtc,
  children,
}: {
  subreddit: string;
  createdUtc: number;
  children?: ReactNode;
}) {
  const date = new Date(createdUtc * 1000);
  return (
    <div className="card-meta">
      <a className="sub" href={communityUrl(subreddit)} target="_blank" rel="noopener noreferrer">
        {communityLabel(subreddit)}
      </a>
      <span aria-hidden="true">·</span>
      <time dateTime={date.toISOString()} title={date.toLocaleString()}>
        {timeAgo(createdUtc)}
      </time>
      {children}
    </div>
  );
}

function ExpandableText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 480 || text.split("\n").length > 7;
  return (
    <>
      <p className={long && !open ? "card-text clamped" : "card-text"}>{text}</p>
      {long && (
        <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

function LoadingList() {
  return (
    <div className="feed" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card skeleton">
          <div className="sk sk-meta" />
          <div className="sk sk-title" />
          <div className="sk" />
          <div className="sk sk-short" />
        </div>
      ))}
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="var(--on-accent)" strokeWidth="2.75" />
      <path d="M19 19l5.5 5.5" stroke="var(--on-accent)" strokeWidth="2.75" strokeLinecap="round" />
    </svg>
  );
}

// Posts to a user's own profile live in a pseudo-subreddit named "u_<name>".
function communityLabel(name: string): string {
  return name.startsWith("u_") ? `u/${name.slice(2)}` : `r/${name}`;
}

function communityUrl(name: string): string {
  return name.startsWith("u_")
    ? `https://www.reddit.com/user/${name.slice(2)}/`
    : `https://www.reddit.com/r/${name}/`;
}

function describeRanges(ranges: TimeRange[]): string {
  const parts = ranges.map((r) => `${formatDateTime(r.from)} – ${formatDateTime(r.to)}`);
  return parts.length === 1 ? `activity from ${parts[0]}` : `activity from ${parts.join(", ")}`;
}

const numberFormat = new Intl.NumberFormat("en-US");

function formatNumber(n: number): string {
  return numberFormat.format(n);
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function formatClock(utc: number): string {
  return new Date(utc * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(utc: number): string {
  return new Date(utc * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function timeAgo(utc: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - utc));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
