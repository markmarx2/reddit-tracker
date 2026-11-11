// Source 1: Reddit's official Data API (https://www.reddit.com/dev/api).
// Uses app-only OAuth (client credentials), so it needs REDDIT_CLIENT_ID and
// REDDIT_CLIENT_SECRET. Gives live scores and karma.

import { inWindow, num, toItems, type Raw } from "./normalize";
import { DataError, WINDOW_DAYS, type ActivityResult, type Kind, type Profile } from "./shared";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // Reddit listings stop at ~1,000 items anyway.

export function hasRedditCredentials(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

function userAgent(): string {
  return process.env.REDDIT_USER_AGENT || "web:reddit-tracker:1.0.0";
}

let token: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

async function requestToken(): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID ?? "";
  const secret = process.env.REDDIT_CLIENT_SECRET ?? "";
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(),
    },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json().catch(() => null)) as Raw | null;
  if (!res.ok || typeof json?.access_token !== "string") {
    const detail = json?.error ? `, ${json.error}` : "";
    throw new DataError(
      `Reddit rejected the API credentials (HTTP ${res.status}${detail}). Check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.`,
      502,
    );
  }
  token = {
    value: json.access_token,
    expiresAt: Date.now() + num(json.expires_in || 3600) * 1000,
  };
  return token.value;
}

async function getToken(): Promise<string> {
  if (token && token.expiresAt - 60_000 > Date.now()) return token.value;
  pendingToken ??= requestToken().finally(() => {
    pendingToken = null;
  });
  return pendingToken;
}

function httpError(status: number): DataError {
  switch (status) {
    case 404:
      return new DataError("No Reddit user with that name was found.", 404);
    case 403:
      return new DataError(
        "Reddit won't share this user's history. The account may be suspended or deleted, or your API app may not have access.",
        403,
      );
    case 429:
      return new DataError(
        "Reddit is rate-limiting requests right now. Wait a minute and try again.",
        429,
      );
    default:
      return new DataError(`Reddit returned an unexpected error (HTTP ${status}).`, 502);
  }
}

async function apiGet(path: string, params: Record<string, string>, retry = true): Promise<Raw> {
  const url = new URL(path, API_BASE);
  url.searchParams.set("raw_json", "1");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await getToken()}`, "User-Agent": userAgent() },
  });
  if (res.status === 401 && retry) {
    token = null;
    return apiGet(path, params, false);
  }
  if (!res.ok) throw httpError(res.status);
  return (await res.json()) as Raw;
}

async function fetchProfile(username: string): Promise<Profile> {
  const json = await apiGet(`/user/${username}/about`, {});
  const d = json?.data as Raw | undefined;
  if (!d?.name) throw new DataError("No Reddit user with that name was found.", 404);
  if (d.is_suspended) throw new DataError(`u/${d.name} is suspended.`, 410);
  const icon = [d.snoovatar_img, d.icon_img].find(
    (u): u is string => typeof u === "string" && u.startsWith("https://"),
  );
  return {
    name: String(d.name),
    url: `https://www.reddit.com/user/${d.name}/`,
    iconUrl: icon ?? null,
    linkKarma: num(d.link_karma),
    commentKarma: num(d.comment_karma),
    createdUtc: num(d.created_utc) || null,
  };
}

async function fetchListing(username: string, kind: Kind, sinceUtc: number) {
  const path = `/user/${username}/${kind === "posts" ? "submitted" : "comments"}`;
  const raw: Raw[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { sort: "new", limit: String(PAGE_SIZE) };
    if (after) params.after = after;
    const json = await apiGet(path, params);
    const children: Raw[] = (json?.data?.children ?? [])
      .map((c: Raw) => c?.data)
      .filter(Boolean);
    raw.push(...children);
    const oldest = children[children.length - 1];
    if (!oldest || num(oldest.created_utc) < sinceUtc) return { raw, truncated: false };
    after = typeof json?.data?.after === "string" ? json.data.after : null;
    // Reddit ends every listing at ~1,000 items, even if there is older history.
    if (!after) return { raw, truncated: raw.length >= MAX_PAGES * PAGE_SIZE - 10 };
  }
  return { raw, truncated: true };
}

export async function fetchFromRedditApi(username: string, kind: Kind): Promise<ActivityResult> {
  const days = WINDOW_DAYS[kind];
  const sinceUtc = Math.floor(Date.now() / 1000) - days * 86_400;
  const [profile, listing] = await Promise.allSettled([
    fetchProfile(username),
    fetchListing(username, kind, sinceUtc),
  ]);
  // Prefer the profile error ("not found", "suspended"): it explains the listing error.
  if (profile.status === "rejected") throw profile.reason;
  if (listing.status === "rejected") throw listing.reason;
  return {
    profile: profile.value,
    kind,
    days,
    sinceUtc,
    source: "reddit",
    items: toItems(inWindow(listing.value.raw, sinceUtc), kind),
    truncated: listing.value.truncated,
  };
}
