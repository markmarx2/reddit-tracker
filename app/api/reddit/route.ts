import { NextResponse, type NextRequest } from "next/server";
import { fetchFromArcticShift } from "@/lib/arctic-shift";
import { fetchFromRedditApi, hasRedditCredentials } from "@/lib/reddit-api";
import { DataError, normalizeUsername, USERNAME_RE } from "@/lib/shared";

export const maxDuration = 30;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

// GET /api/reddit?user=<username>&type=posts|comments
export async function GET(req: NextRequest) {
  const user = normalizeUsername(req.nextUrl.searchParams.get("user") ?? "");
  const type = req.nextUrl.searchParams.get("type");

  if (!USERNAME_RE.test(user)) {
    return errorResponse("That doesn't look like a Reddit username.", 400);
  }
  if (type !== "posts" && type !== "comments") {
    return errorResponse("type must be \"posts\" or \"comments\".", 400);
  }

  try {
    const result = hasRedditCredentials()
      ? await fetchFromRedditApi(user, type)
      : await fetchFromArcticShift(user, type);
    return NextResponse.json(result, {
      // Let Vercel's CDN reuse a lookup for 2 minutes to save API quota.
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (err) {
    if (err instanceof DataError) return errorResponse(err.message, err.status);
    console.error(err);
    return errorResponse("Something went wrong while fetching data. Try again.", 500);
  }
}
