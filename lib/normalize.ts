// Turns raw Reddit objects (from the official API or the Arctic Shift archive,
// which stores the same shape) into the trimmed-down items the UI renders.

import type { ActivityItem, CommentItem, Kind, PostItem } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<string, any>;

const REDDIT = "https://www.reddit.com";
const MAX_TEXT = 5000;

export function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function clip(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
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

export function postUrl(subreddit: string, postId: string): string {
  return `${REDDIT}/r/${subreddit}/comments/${postId}/`;
}

export function toPost(d: Raw): PostItem {
  const id = String(d.id ?? "");
  const subreddit = String(d.subreddit ?? "");
  const isSelf = Boolean(d.is_self);
  const permalink = httpUrl(d.permalink) ?? postUrl(subreddit, id);
  const external = isSelf ? null : httpUrl(d.url);
  const selftext = typeof d.selftext === "string" ? d.selftext : "";
  return {
    kind: "post",
    id,
    subreddit,
    title: String(d.title ?? ""),
    permalink,
    externalUrl: external && external !== permalink ? external : null,
    domain: !isSelf && typeof d.domain === "string" ? d.domain : null,
    text: clip(selftext),
    score: num(d.score),
    numComments: num(d.num_comments),
    createdUtc: num(d.created_utc),
    nsfw: Boolean(d.over_18),
    flair: typeof d.link_flair_text === "string" && d.link_flair_text ? d.link_flair_text : null,
    removed:
      Boolean(d.removed_by_category) || selftext === "[removed]" || selftext === "[deleted]",
  };
}

export interface ParentPost {
  title: string;
  permalink: string;
}

export function toComment(d: Raw, parent?: ParentPost): CommentItem {
  const id = String(d.id ?? "");
  const subreddit = String(d.subreddit ?? "");
  const postId = String(d.link_id ?? "").replace(/^t3_/, "");
  const postPermalink =
    httpUrl(d.link_permalink) ??
    parent?.permalink ??
    (postId ? postUrl(subreddit, postId) : `${REDDIT}/r/${subreddit}/`);
  const permalink =
    httpUrl(d.permalink) ?? (postId ? `${postUrl(subreddit, postId)}_/${id}/` : postPermalink);
  return {
    kind: "comment",
    id,
    subreddit,
    body: clip(d.body),
    permalink,
    postTitle: String(d.link_title ?? parent?.title ?? ""),
    postPermalink,
    score: num(d.score),
    createdUtc: num(d.created_utc),
    edited: Boolean(d.edited),
    nsfw: Boolean(d.over_18),
  };
}

/** Drops items outside the window and duplicates, newest first. */
export function inWindow(raw: Raw[], sinceUtc: number): Raw[] {
  const seen = new Set<string>();
  return raw
    .filter((d) => {
      const id = String(d.id ?? "");
      if (!id || seen.has(id) || num(d.created_utc) < sinceUtc) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => num(b.created_utc) - num(a.created_utc));
}

export function toItems(
  raw: Raw[],
  kind: Kind,
  parents?: Map<string, ParentPost>,
): ActivityItem[] {
  return raw.map((d) =>
    kind === "posts"
      ? toPost(d)
      : toComment(d, parents?.get(String(d.link_id ?? "").replace(/^t3_/, ""))),
  );
}
