// Turns raw archived Reddit objects into the trimmed-down items the UI renders.

import type { ActivityItem, CommentItem, Kind, PostItem } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<string, any>;

const REDDIT = "https://www.reddit.com";
const MAX_TEXT = 5000;
/** The archive re-checks scores about 36 hours after posting (see _meta.retrieved_2nd_on). */
const FIRST_LOOK_WINDOW = 6 * 3600;

export function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
}

/** Resolves relative Reddit paths and rejects anything that isn't http(s). */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, REDDIT);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function postUrl(subreddit: string, postId: string): string {
  return `${REDDIT}/r/${subreddit}/comments/${postId}/`;
}

/**
 * The archive first saves an item seconds after it's posted (score 1, no
 * comments) and saves it again about 36 hours later with real numbers.
 */
function scoreIsKnown(d: Raw): boolean {
  if (d._meta?.retrieved_2nd_on) return true;
  const firstSeen = num(d.retrieved_on);
  return firstSeen > 0 && firstSeen - num(d.created_utc) > FIRST_LOOK_WINDOW;
}

function statusLabel(d: Raw, content: string): string | null {
  const meta: Raw = d._meta ?? {};
  const removal =
    typeof meta.removal_type === "string" && meta.removal_type
      ? meta.removal_type
      : typeof d.removed_by_category === "string" && d.removed_by_category
        ? d.removed_by_category
        : null;
  if (removal === "deleted" || removal === "author") return "Deleted by user";
  if (removal === "moderator" || removal === "automod_filtered") return "Removed by mods";
  if (removal === "reddit" || removal === "anti_evil_ops" || removal === "content_takedown") {
    return "Removed by Reddit";
  }
  if (removal) return "Removed";
  if (meta.was_deleted_later) return "Deleted later";
  if (content === "[deleted]") return "Deleted";
  if (content === "[removed]") return "Removed";
  return null;
}

export function toPost(d: Raw): PostItem {
  const id = String(d.id ?? "");
  const subreddit = text(d.subreddit);
  const isSelf = Boolean(d.is_self);
  const permalink = httpUrl(d.permalink) ?? postUrl(subreddit, id);
  const external = isSelf ? null : httpUrl(d.url);
  const selftext = text(d.selftext);
  const known = scoreIsKnown(d);
  return {
    kind: "post",
    id,
    subreddit,
    title: text(d.title),
    permalink,
    externalUrl: external && external !== permalink ? external : null,
    domain: !isSelf && typeof d.domain === "string" ? d.domain : null,
    text: selftext === "[removed]" || selftext === "[deleted]" ? "" : clip(selftext),
    score: known ? num(d.score) : null,
    numComments: known ? num(d.num_comments) : null,
    createdUtc: num(d.created_utc),
    nsfw: Boolean(d.over_18),
    flair: text(d.link_flair_text) || null,
    status: statusLabel(d, selftext),
  };
}

export function toComment(d: Raw): CommentItem {
  const id = String(d.id ?? "");
  const subreddit = text(d.subreddit);
  const postId = text(d.link_id).replace(/^t3_/, "");
  const postPermalink =
    httpUrl(d.link_permalink) ?? (postId ? postUrl(subreddit, postId) : `${REDDIT}/r/${subreddit}/`);
  const body = text(d.body);
  return {
    kind: "comment",
    id,
    subreddit,
    body: clip(body),
    permalink:
      httpUrl(d.permalink) ?? (postId ? `${postUrl(subreddit, postId)}_/${id}/` : postPermalink),
    postTitle: text(d.link_title),
    postPermalink,
    score: scoreIsKnown(d) ? num(d.score) : null,
    createdUtc: num(d.created_utc),
    edited: Boolean(d.edited),
    nsfw: Boolean(d.over_18),
    status: statusLabel(d, body),
  };
}

/** Keeps items inside the window, newest first, and converts them. */
export function toItems(raw: Iterable<Raw>, kind: Kind, sinceUtc: number): ActivityItem[] {
  return [...raw]
    .filter((d) => num(d.created_utc) >= sinceUtc)
    .sort((a, b) => num(b.created_utc) - num(a.created_utc))
    .map((d) => (kind === "posts" ? toPost(d) : toComment(d)));
}
