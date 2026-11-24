import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { fetchOntarioWells, parseWellLocation } from "@/lib/server/ontario-wells";

export const runtime = "nodejs";

const loadWells = unstable_cache(fetchOntarioWells, ["ontario-well-records-v1"], { revalidate: 7 * 24 * 60 * 60 });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let location;
  try { location = parseWellLocation(params.get("latitude"), params.get("longitude")); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Invalid location." }, { status: 400 }); }
  try { return NextResponse.json(await loadWells(location.latitude, location.longitude)); }
  catch (error) {
    console.error("Ontario well-record query failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ message: "Ontario well records are temporarily unavailable. Try again later." }, { status: 502 });
  }
}
