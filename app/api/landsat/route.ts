import { NextResponse } from "next/server";
import {
  createLandsatOverlay,
  LandsatAccessError,
  LandsatTooCloudyError,
  LandsatTooSmallError,
  LandsatUnavailableError,
} from "@/lib/landsat/overlay";
import { InvalidFieldError, parseFieldGeometry } from "@/lib/fields/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { geometry?: unknown; layer?: unknown };
    if (body.layer !== "satellite" && body.layer !== "ndvi") {
      return NextResponse.json(
        { code: "INVALID_LAYER", message: "Satellite image or NDVI is required." },
        { status: 400 },
      );
    }
    const geometry = parseFieldGeometry(body.geometry);
    return NextResponse.json(await createLandsatOverlay(geometry, body.layer), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof InvalidFieldError) {
      return NextResponse.json(
        { code: "INVALID_FIELD", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof LandsatTooCloudyError) {
      return NextResponse.json(
        { code: "TOO_CLOUDY", message: error.message },
        { status: 422 },
      );
    }
    if (error instanceof LandsatTooSmallError) {
      return NextResponse.json(
        { code: "FIELD_TOO_SMALL", message: error.message },
        { status: 422 },
      );
    }
    if (error instanceof LandsatUnavailableError) {
      return NextResponse.json(
        { code: "NO_IMAGERY", message: error.message },
        { status: 404 },
      );
    }
    if (error instanceof LandsatAccessError) {
      return NextResponse.json(
        { code: "LANDSAT_ACCESS_ERROR", message: error.message },
        { status: 503 },
      );
    }
    console.error("Landsat overlay failed", error);
    return NextResponse.json(
      {
        code: "LANDSAT_ERROR",
        message:
          "Landsat imagery could not be loaded because of an unexpected server error.",
      },
      { status: 500 },
    );
  }
}
