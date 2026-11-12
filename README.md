# Reddit Tracker

Search for a Reddit user and see their **posts from the last 14 days** or their **comments from the last 7 days**. New activity usually shows up within a few minutes of being posted.

You can filter by community, sort by newest or top, and share a lookup by link, for example `/?u=spez&type=comments`.

No API key or setup is needed.

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this GitHub repository.
2. Click **Deploy**. Vercel detects Next.js automatically. There are no environment variables to set.

Every push to `main` redeploys the site.

## Where the data comes from

Reddit closed its API to new developers on October 31, 2026, and blocks logged-out requests from scripts. This site uses the [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) archive instead. Arctic Shift saves new Reddit posts and comments within minutes. In testing, the newest items were 1 to 11 minutes old.

The lookup runs in the visitor's browser and calls the archive directly, so each visitor stays within the archive's limits on their own.

**Things to know:**

- **Scores and comment counts** are saved about 36 hours after something is posted. Until then the site shows "Score pending" rather than a wrong number.
- **Deleted and removed items still appear** if the archive saved them first. They're tagged, for example "Deleted by user" or "Removed by mods".
- **The archive is a free service** that often turns away requests when it's busy. The site retries automatically. If part of a time range keeps failing, it splits that range into smaller pieces and tries again. Any period it still can't load is shown with a **Try again** button.
- **Very active accounts** show their newest 1,000 items.
- **A misspelled username** shows "no activity". The archive can't tell a quiet account from one that doesn't exist.
- The archive may be affected when Reddit shuts down its public API in March 2027.

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Code

- [lib/archive.ts](lib/archive.ts) runs the lookup: retries, splitting failed ranges, and paging.
- [lib/normalize.ts](lib/normalize.ts) converts archived Reddit records into what the page shows.
- [components/Tracker.tsx](components/Tracker.tsx) is the search page.

This site isn't affiliated with Reddit, Inc.
