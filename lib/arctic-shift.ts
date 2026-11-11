// Source 2 (fallback, no key needed): the Arctic Shift archive
// (https://github.com/ArthurHeitmann/arctic_shift). It's a free community
// service that copies Reddit as things are posted. Trade-offs: no uptime
// guarantee, scores and comment counts can lag by up to ~36 hours, no karma or
// avatar, and items the user deleted after posting may still appear.

import { httpUrl, inWindow, num, postUrl, toItems, type ParentPost, type Raw } from "./normalize";
import { DataError, WINDOW_DAYS, type ActivityResult, type Kind } from "./shared";

const BASE = "https://arctic-shift.photon-reddit.com/api";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const IDS_PER_LOOKUP = 100;

const UNAVAILABLE =
  "The Arctic Shift archive didn't answer. It's a free community service that is sometimes overloaded, so try again in a minute. Adding Reddit API credentials avoids this.";

// The archive stores text HTML-escaped (as Reddit's API sends it without raw_json=1).
function unescapeHtml<T>(value: T): T | string {
  return typeof value === "string"
    ? value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    : value;
}

function unescapeText(d: Raw): Raw {
  return {
    ...d,
    title: unescapeHtml(d.title),
    selftext: unescapeHtml(d.selftext),
    body: unescapeHtml(d.body),
  };
}

async function archiveGet(path: string, params: Record<string, string>): Promise<Raw[]> {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "reddit-tracker/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new DataError(UNAVAILABLE, 504);
  }
  if (res.status === 429) {
    throw new DataError("The Arctic Shift archive is rate-limiting requests. Wait a minute and try again.", 429);
  }
  const json = (await res.json().catch(() => null)) as Raw | null;
  if (!res.ok || !Array.isArray(json?.data)) throw new DataError(UNAVAILABLE, 503);
  return json.data as Raw[];
}

async function fetchWindow(username: string, kind: Kind, sinceUtc: number) {
  const path = kind === "posts" ? "/posts/search" : "/comments/search";
  const raw: Raw[] = [];
  let before: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      author: username,
      after: String(sinceUtc),
      limit: String(PAGE_SIZE),
      sort: "desc",
    };
    // +1 so items sharing the oldest second aren't skipped; duplicates are removed later.
    if (before !== null) params.before = String(before + 1);
    const batch = await archiveGet(path, params);
    raw.push(...batch);
    if (batch.length < PAGE_SIZE) return { raw, truncated: false };
    const oldest = num(batch[batch.length - 1].created_utc);
    if (before !== null && oldest >= before) return { raw, truncated: false };
    before = oldest;
  }
  return { raw, truncated: true };
}

/** Archived comments don't carry their post's title, so look those up in batches. */
async function fetchParentPosts(comments: Raw[]): Promise<Map<string, ParentPost>> {
  const ids = [
    ...new Set(
      comments.map((c) => String(c.link_id ?? "").replace(/^t3_/, "")).filter(Boolean),
    ),
  ];
  const parents = new Map<string, ParentPost>();
  for (let i = 0; i < ids.length; i += IDS_PER_LOOKUP) {
    try {
      const posts = await archiveGet("/posts/ids", { ids: ids.slice(i, i + IDS_PER_LOOKUP).join(",") });
      for (const p of posts) {
        const id = String(p.id ?? "");
        parents.set(id, {
          title: String(unescapeHtml(p.title) ?? ""),
          permalink: httpUrl(p.permalink) ?? postUrl(String(p.subreddit ?? ""), id),
        });
      }
    } catch {
      // Titles are nice to have; show the comments without them.
    }
  }
  return parents;
}

export async function fetchFromArcticShift(username: string, kind: Kind): Promise<ActivityResult> {
  const days = WINDOW_DAYS[kind];
  const sinceUtc = Math.floor(Date.now() / 1000) - days * 86_400;
  const { raw, truncated } = await fetchWindow(username, kind, sinceUtc);
  const kept = inWindow(raw, sinceUtc).map(unescapeText);
  const parents = kind === "comments" ? await fetchParentPosts(kept) : undefined;
  const name = typeof kept[0]?.author === "string" ? kept[0].author : username;
  return {
    profile: {
      name,
      url: `https://www.reddit.com/user/${name}/`,
      iconUrl: null,
      linkKarma: null,
      commentKarma: null,
      createdUtc: null,
    },
    kind,
    days,
    sinceUtc,
    source: "arctic-shift",
    items: toItems(kept, kind, parents),
    truncated,
  };
}
