import { NextResponse } from "next/server";
import { deleteField, updateField } from "@/lib/fields/store";
import { InvalidFieldError } from "@/lib/fields/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: unknown; geometry?: unknown };
    const field = await updateField(id, body);
    return field
      ? NextResponse.json(field)
      : NextResponse.json({ message: "Field not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof InvalidFieldError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    console.error("Could not update field", error);
    return NextResponse.json(
      { message: "The field could not be updated." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return (await deleteField(id))
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ message: "Field not found." }, { status: 404 });
  } catch (error) {
    console.error("Could not delete field", error);
    return NextResponse.json(
      { message: "The field could not be deleted." },
      { status: 500 },
    );
  }
}
