# Reddit Tracker

Search for a Reddit user and see their **posts from the last 14 days** or their **comments from the last 7 days**. You can filter by community, sort by newest or top, and share a lookup by link (`/?u=spez&type=comments`).

Built with Next.js and ready to deploy on Vercel.

## Where the data comes from

The server uses one of two sources:

| | Reddit's official API | Arctic Shift archive (fallback) |
|---|---|---|
| When it's used | When `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are set | When they aren't set |
| Setup | Needs a Reddit API app (see below) | None |
| Scores and comment counts | Live | Can lag by up to ~36 hours |
| Karma, avatar, join date | Yes | No |
| Deleted items | Hidden | May still appear |
| Reliability | High | Free community service with no uptime guarantee. It is sometimes overloaded and returns an error. |

Reddit's logged-out `.json` and RSS endpoints aren't used. They return 403 or 429 errors to scripts, especially from cloud servers like Vercel.

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this GitHub repository.
2. Leave the defaults. Vercel detects Next.js automatically.
3. Optional: add the Reddit API environment variables (below) under **Settings → Environment Variables**, then redeploy.
4. Click **Deploy**.

Every push to `main` redeploys the site automatically.

## Getting Reddit API credentials (optional)

1. Sign in to Reddit and open [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps).
2. Click **create another app**, choose **script**, and enter any redirect URI (for example `http://localhost:3000`).
3. Copy the ID under the app name (`REDDIT_CLIENT_ID`) and the **secret** (`REDDIT_CLIENT_SECRET`).

Since late 2025, Reddit's Responsible Builder Policy says new API access must be approved by Reddit. If Reddit rejects the credentials, the site shows an error that says so. Remove the variables to switch back to the archive.

| Variable | Required | Purpose |
|---|---|---|
| `REDDIT_CLIENT_ID` | For the official API | Your app's client ID |
| `REDDIT_CLIENT_SECRET` | For the official API | Your app's secret |
| `REDDIT_USER_AGENT` | No | A descriptive User-Agent, as Reddit asks, for example `web:reddit-tracker:1.0.0 (by /u/your_name)` |

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local   # optional: add your Reddit credentials
npm run dev
```

Then open http://localhost:3000.

## How it works

- [app/api/reddit/route.ts](app/api/reddit/route.ts): `GET /api/reddit?user=<name>&type=posts|comments`. It validates the input, picks a source, and returns JSON. Vercel's CDN caches each lookup for 2 minutes to save API quota.
- [lib/reddit-api.ts](lib/reddit-api.ts): app-only OAuth with Reddit. It pages through the user's newest items until it passes the 7- or 14-day cutoff. Reddit returns at most ~1,000 items per user.
- [lib/arctic-shift.ts](lib/arctic-shift.ts): the same lookup against the Arctic Shift archive.
- [components/Tracker.tsx](components/Tracker.tsx): the search page.

This site isn't affiliated with Reddit, Inc.
