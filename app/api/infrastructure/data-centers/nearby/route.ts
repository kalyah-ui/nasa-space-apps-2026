import { NextResponse } from "next/server";
import { GeminiSearchError, parseSearchLocation, searchDataCenters } from "@/lib/server/data-center-search";
import type { FarmScopeAssessment } from "@/lib/datasets/data-centers-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bound warm-instance caching and share concurrent requests for the same point.
const cache = new Map<string, { expires: number; result: Promise<FarmScopeAssessment> }>();

export async function POST(request: Request) {
  let location;
  try { location = parseSearchLocation(await request.json()); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Invalid search location." }, { status: 400 }); }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ message: "Web search is not configured. Set GEMINI_API_KEY in the Next.js server environment and redeploy." }, { status: 503 });
  const model = process.env.GEMINI_SEARCH_MODEL?.trim() || "gemini-3.8-flash";
  const key = JSON.stringify([location, model]);
  let entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    entry = { expires: Date.now() + 15 * 60_000, result: searchDataCenters(location, apiKey, model) };
    cache.set(key, entry);
  }
  try { return NextResponse.json(await entry.result, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    console.error("Nearby data-center search failed", error instanceof GeminiSearchError
      ? { status: error.status, ...error.diagnostics }
      : error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ message: error instanceof Error ? error.message : "Web search is unavailable. Please retry." }, { status: error instanceof GeminiSearchError && error.status === 429 ? 429 : 502 });
  }
}
