// Looks up a user's recent posts or comments in the Arctic Shift archive
// (https://github.com/ArthurHeitmann/arctic_shift), which saves new Reddit
// activity within minutes of it being posted. Runs in the visitor's browser.
//
// The archive is a free service that often rejects a request when it's busy.
// To keep lookups working anyway:
//   1. every request is retried with a short backoff;
//   2. if a time range keeps failing, it's split in half and each half is
//      tried separately (smaller queries succeed far more often);
//   3. ranges that still fail are reported, and everything else is shown.

import { num, toItems, type Raw } from "./normalize";
import { WINDOW_DAYS, type ActivityResult, type Kind, type TimeRange } from "./shared";

const BASE = "https://arctic-shift.photon-reddit.com/api";
const PAGE_SIZE = 100;
const MAX_ITEMS = 1000;
const MAX_REQUESTS = 40;
const TIME_BUDGET_MS = 45_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Ranges shorter than this are retried harder instead of split further. */
const MIN_SPLIT_SECONDS = 2 * 3600;
const RETRY_DELAYS_MS = [600, 1200, 2400];
/**
 * Give up early if this many requests in a row fail before anything loads.
 * That's enough to split a busy account's range down to under a day (which
 * usually succeeds) while not leaving people waiting when the archive is down.
 */
const FAILURES_BEFORE_GIVING_UP = 12;

export class ArchiveUnavailableError extends Error {
  constructor() {
    super("The archive is busy right now and didn't answer. Try again in a minute.");
    this.name = "ArchiveUnavailableError";
  }
}

interface Session {
  path: string;
  author: string;
  signal?: AbortSignal;
  deadline: number;
  requests: number;
  successes: number;
  items: Map<string, Raw>;
  onProgress?: (found: number) => void;
}

type Outcome =
  | { type: "done" }
  | { type: "failed"; range: TimeRange }
  | { type: "stopped"; at: number };

function outOfBudget(s: Session): boolean {
  return s.items.size >= MAX_ITEMS || s.requests >= MAX_REQUESTS || Date.now() > s.deadline;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** One HTTP request. Returns null if the archive didn't give a usable answer. */
async function requestOnce(s: Session, params: Record<string, string>): Promise<Raw[] | null> {
  const url = new URL(`${BASE}${s.path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  s.signal?.addEventListener("abort", onAbort, { once: true });
  s.requests++;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as Raw | null;
    return Array.isArray(json?.data) ? (json.data as Raw[]) : null;
  } catch {
    if (s.signal?.aborted) throw abortError(s.signal);
    return null;
  } finally {
    clearTimeout(timer);
    s.signal?.removeEventListener("abort", onAbort);
  }
}

async function requestWithRetry(
  s: Session,
  params: Record<string, string>,
  attempts: number,
): Promise<Raw[] | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)], s.signal);
    }
    if (s.requests >= MAX_REQUESTS || Date.now() > s.deadline) return null;
    const page = await requestOnce(s, params);
    if (page) {
      s.successes++;
      return page;
    }
  }
  return null;
}

/** Pages through one time range, newest first. */
async function fetchRange(s: Session, range: TimeRange): Promise<Outcome> {
  let before = range.to;
  for (;;) {
    if (outOfBudget(s)) return { type: "stopped", at: before };
    const attempts = before - range.from <= MIN_SPLIT_SECONDS ? 4 : 3;
    const page = await requestWithRetry(
      s,
      {
        author: s.author,
        after: String(range.from),
        before: String(before),
        limit: String(PAGE_SIZE),
        sort: "desc",
      },
      attempts,
    );
    if (!page) {
      return outOfBudget(s)
        ? { type: "stopped", at: before }
        : { type: "failed", range: { from: range.from, to: before } };
    }
    for (const d of page) {
      const id = String(d.id ?? "");
      if (id) s.items.set(id, d);
    }
    s.onProgress?.(s.items.size);
    if (page.length < PAGE_SIZE) return { type: "done" };
    const oldest = Math.min(...page.map((d) => num(d.created_utc)));
    // +1 so items sharing that second aren't skipped; repeats are de-duplicated by id.
    if (oldest + 1 >= before) return { type: "done" };
    before = oldest + 1;
  }
}

export async function fetchActivity(
  username: string,
  kind: Kind,
  options: { signal?: AbortSignal; onProgress?: (found: number) => void } = {},
): Promise<ActivityResult> {
  const days = WINDOW_DAYS[kind];
  const checkedAt = Math.floor(Date.now() / 1000);
  const sinceUtc = checkedAt - days * 86_400;
  const s: Session = {
    path: kind === "posts" ? "/posts/search" : "/comments/search",
    author: username,
    signal: options.signal,
    deadline: Date.now() + TIME_BUDGET_MS,
    requests: 0,
    successes: 0,
    items: new Map(),
    onProgress: options.onProgress,
  };

  // A stack of ranges still to fetch; the newest range is always on top.
  const pending: TimeRange[] = [{ from: sinceUtc, to: checkedAt + 60 }];
  const failed: TimeRange[] = [];
  let stoppedAt: number | null = null;

  while (pending.length > 0) {
    if (s.successes === 0 && s.requests >= FAILURES_BEFORE_GIVING_UP) break;
    const range = pending.pop()!;
    const outcome = await fetchRange(s, range);
    if (outcome.type === "stopped") {
      stoppedAt = outcome.at;
      break;
    }
    if (outcome.type === "failed") {
      const { from, to } = outcome.range;
      if (to - from > MIN_SPLIT_SECONDS) {
        const mid = Math.floor((from + to) / 2);
        pending.push({ from, to: mid }, { from: mid, to });
      } else {
        failed.push(outcome.range);
      }
    }
  }

  if (s.successes === 0) throw new ArchiveUnavailableError();

  const items = toItems(s.items.values(), kind, sinceUtc);
  const first = items.length > 0 ? s.items.get(items[0].id) : undefined;
  return {
    username: typeof first?.author === "string" ? first.author : username,
    kind,
    days,
    sinceUtc,
    checkedAt,
    items,
    failed: mergeRanges(failed),
    stoppedEarly:
      stoppedAt === null
        ? null
        : { at: stoppedAt, reason: s.items.size >= MAX_ITEMS ? "too-active" : "slow" },
  };
}

/** Joins touching ranges and returns them newest first. */
function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => b.to - a.to);
  const merged: TimeRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.to >= last.from) last.from = Math.min(last.from, r.from);
    else merged.push({ ...r });
  }
  return merged;
}
