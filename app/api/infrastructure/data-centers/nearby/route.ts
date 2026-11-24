import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { WebSearchError, parseSearchLocation, fetchDataCenterEvidence, summarizeDataCenterEvidence } from "@/lib/server/data-center-search";
import type { FarmScopeAssessment } from "@/lib/datasets/data-centers-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const CACHE_SECONDS = 7 * 24 * 60 * 60;

// Next's persistent Data Cache shares results between Vercel instances.
// This bounded local map also shares in-flight work within a warm instance.
const cache = new Map<string, Promise<FarmScopeAssessment>>();

class IncompleteAssessment extends Error {
  constructor(readonly result: FarmScopeAssessment) { super("Analysis incomplete; retain search evidence only."); }
}

export async function POST(request: Request) {
  let location;
  try { location = parseSearchLocation(await request.json()); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Invalid search location." }, { status: 400 }); }
  const tavilyApiKey = process.env.TAVILY_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!tavilyApiKey) return NextResponse.json({ message: "Live research is not configured. Set TAVILY_API_KEY in the server environment." }, { status: 503 });
  const model = process.env.GEMINI_SEARCH_MODEL?.trim() || "gemini-3.8-flash";
  const fallbackModel = process.env.GEMINI_SUMMARY_FALLBACK_MODEL?.trim() || "gemini-3.1-flash-lite";
  const key = JSON.stringify(["tavily-local-v5", process.env.VERCEL_ENV ?? "development", location, model, fallbackModel, Boolean(geminiApiKey)]);
  let entry = cache.get(key);
  if (!entry) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    // Keys contain search inputs and model configuration, never API secrets.
    // Throwing failures are not stored as successful persistent results.
    const loadEvidence = unstable_cache(async () => ({
      evidence: await fetchDataCenterEvidence(location, tavilyApiKey),
      searchedAt: new Date().toISOString(),
    }), ["tavily-evidence-v4", process.env.VERCEL_ENV ?? "development", JSON.stringify(location)], { revalidate: CACHE_SECONDS });
    entry = (async () => {
      // Call the two persistent caches sequentially, not nested: nested
      // unstable_cache callbacks bypass the inner cache in Next.js 15.
      const search = await loadEvidence();
      const loadAssessment = unstable_cache(async () => {
        const result = { ...await summarizeDataCenterEvidence(location, search.evidence, geminiApiKey, model, fetch, fallbackModel), searched_at: search.searchedAt };
        if (result.assessment_status === "sources_only") throw new IncompleteAssessment(result);
        return result;
      }, ["data-center-report-v5", key, search.searchedAt], { revalidate: CACHE_SECONDS });
      try { return await loadAssessment(); }
      catch (error) {
        if (error instanceof IncompleteAssessment) return error.result;
        throw error;
      }
    })();
    cache.set(key, entry);
  }
  try { return NextResponse.json(await entry, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    console.error("Nearby data-center search failed", error instanceof WebSearchError
      ? { status: error.status, provider: error.provider, providerMessage: error.providerMessage, model }
      : error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ message: error instanceof Error ? error.message : "Web search is unavailable. Please retry." }, { status: error instanceof WebSearchError && [429, 432, 433].includes(error.status) ? 429 : 502 });
  } finally {
    if (cache.get(key) === entry) cache.delete(key);
  }
}
