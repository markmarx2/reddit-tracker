// Types and small helpers used across the app.

export type Kind = "posts" | "comments";

/** How far back each kind of history goes. */
export const WINDOW_DAYS: Record<Kind, number> = { posts: 14, comments: 7 };

export interface PostItem {
  kind: "post";
  id: string;
  subreddit: string;
  title: string;
  permalink: string;
  externalUrl: string | null;
  domain: string | null;
  text: string;
  /** null until the archive re-checks the item, about 36 hours after posting. */
  score: number | null;
  numComments: number | null;
  createdUtc: number;
  nsfw: boolean;
  flair: string | null;
  /** e.g. "Deleted by user" or "Removed by mods"; null if still up. */
  status: string | null;
}

export interface CommentItem {
  kind: "comment";
  id: string;
  subreddit: string;
  body: string;
  permalink: string;
  postTitle: string;
  postPermalink: string;
  score: number | null;
  createdUtc: number;
  edited: boolean;
  nsfw: boolean;
  status: string | null;
}

export type ActivityItem = PostItem | CommentItem;

/** A span of time in Unix seconds. */
export interface TimeRange {
  from: number;
  to: number;
}

export interface ActivityResult {
  username: string;
  kind: Kind;
  days: number;
  sinceUtc: number;
  /** When the lookup ran (Unix seconds). */
  checkedAt: number;
  items: ActivityItem[];
  /** Periods the archive couldn't return even after retries, newest first. */
  failed: TimeRange[];
  /** Set when the lookup stopped before reaching the start of the window. */
  stoppedEarly: { at: number; reason: "too-active" | "slow" } | null;
}

export const USERNAME_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** Accepts "spez", "u/spez", "/u/spez", "@spez" or a profile URL and returns "spez". */
export function normalizeUsername(input: string): string {
  const s = input.trim();
  const fromPath = s.match(/(?:^|\/)(?:u|user)\/([A-Za-z0-9_-]+)/i);
  if (fromPath) return fromPath[1];
  return s.replace(/^@/, "");
}
