// Types and helpers shared by the server (API route) and the browser (UI).

export type Kind = "posts" | "comments";
export type Source = "reddit" | "arctic-shift";

/** How far back each kind of history goes. */
export const WINDOW_DAYS: Record<Kind, number> = { posts: 14, comments: 7 };

export interface Profile {
  name: string;
  url: string;
  iconUrl: string | null;
  linkKarma: number | null;
  commentKarma: number | null;
  createdUtc: number | null;
}

export interface PostItem {
  kind: "post";
  id: string;
  subreddit: string;
  title: string;
  permalink: string;
  externalUrl: string | null;
  domain: string | null;
  text: string;
  score: number;
  numComments: number;
  createdUtc: number;
  nsfw: boolean;
  flair: string | null;
  removed: boolean;
}

export interface CommentItem {
  kind: "comment";
  id: string;
  subreddit: string;
  body: string;
  permalink: string;
  postTitle: string;
  postPermalink: string;
  score: number;
  createdUtc: number;
  edited: boolean;
  nsfw: boolean;
}

export type ActivityItem = PostItem | CommentItem;

export interface ActivityResult {
  profile: Profile;
  kind: Kind;
  days: number;
  sinceUtc: number;
  source: Source;
  items: ActivityItem[];
  /** True when the user has more activity in the window than could be fetched. */
  truncated: boolean;
}

export const USERNAME_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** Accepts "spez", "u/spez", "/u/spez", "@spez" or a profile URL and returns "spez". */
export function normalizeUsername(input: string): string {
  const s = input.trim();
  const fromPath = s.match(/(?:^|\/)(?:u|user)\/([A-Za-z0-9_-]+)/i);
  if (fromPath) return fromPath[1];
  return s.replace(/^@/, "");
}

/** An error whose message is safe to show to the person using the site. */
export class DataError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DataError";
    this.status = status;
  }
}
