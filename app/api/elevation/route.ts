import { NextResponse } from "next/server";
import {
  createElevationOverlay,
  InvalidElevationGeometryError,
  MissingElevationCoverageError,
  parseElevationGeometry,
} from "@/lib/elevation/srtm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ElevationRequest = {
  geometry?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ElevationRequest;
    const geometry = parseElevationGeometry(body.geometry);
    const overlay = await createElevationOverlay(geometry);

    return NextResponse.json(overlay, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof InvalidElevationGeometryError) {
      return NextResponse.json(
        { code: "INVALID_FIELD", message: error.message },
        { status: 400 },
      );
    }

    if (error instanceof MissingElevationCoverageError) {
      return NextResponse.json(
        { code: "NO_COVERAGE", message: error.message },
        { status: 404 },
      );
    }

    console.error("Elevation overlay failed", error);
    return NextResponse.json(
      {
        code: "ELEVATION_ERROR",
        message:
          "Elevation could not be loaded. Check the server's Google Cloud credentials and bucket access.",
      },
      { status: 500 },
    );
  }
}
