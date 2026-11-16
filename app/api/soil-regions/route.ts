import { NextResponse } from "next/server";
import type { FieldGeometry } from "@/lib/fields/types";
import { InvalidFieldError, parseFieldGeometry } from "@/lib/fields/validation";
import {
  getSoilRegions,
  InvalidSoilRegionRequestError,
  MissingPreparedSoilDataError,
  parseBounds,
  parseSoilCrop,
} from "@/lib/soil/regions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      bbox?: unknown;
      crop?: unknown;
      fieldGeometry?: FieldGeometry | null;
    };
    const fieldGeometry =
      body.fieldGeometry === null || body.fieldGeometry === undefined
        ? null
        : parseFieldGeometry(body.fieldGeometry);
    const collection = await getSoilRegions(
      parseBounds(body.bbox),
      parseSoilCrop(body.crop),
      fieldGeometry,
    );
    return NextResponse.json(collection, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (
      error instanceof InvalidSoilRegionRequestError ||
      error instanceof InvalidFieldError
    ) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (error instanceof MissingPreparedSoilDataError) {
      return NextResponse.json({ message: error.message }, { status: 503 });
    }
    console.error("CanSIS soil-region request failed", error);
    return NextResponse.json(
      {
        message:
          "Regional soil suitability could not be loaded. Check the server's Google Cloud credentials and bucket access.",
      },
      { status: 500 },
    );
  }
}

