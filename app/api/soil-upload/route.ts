import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  return NextResponse.json(
    { message: "Select a field and use the field-specific soil-test upload flow." },
    { status: 400 },
  );
}
