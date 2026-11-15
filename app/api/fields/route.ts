import { NextResponse } from "next/server";
import { createField, listFields } from "@/lib/fields/store";
import { InvalidFieldError } from "@/lib/fields/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listFields(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Could not load fields", error);
    return NextResponse.json(
      { message: "Stored field boundaries could not be loaded." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: unknown; geometry?: unknown };
    return NextResponse.json(await createField(body.name, body.geometry), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof InvalidFieldError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    console.error("Could not create field", error);
    return NextResponse.json(
      { message: "The field could not be saved." },
      { status: 500 },
    );
  }
}
