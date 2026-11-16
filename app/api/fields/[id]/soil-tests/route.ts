import { NextResponse } from "next/server";
import { getOrCreateSoilOwner } from "@/lib/soil/owner";
import { listSoilTestUploads, saveSoilTestUpload } from "@/lib/soil/upload-store";
import type { SoilCsvMapping, SoilSamplingScope } from "@/lib/soil/upload-types";
import type { SoilCropId } from "@/lib/soil/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maximumBytes = 10 * 1024 * 1024;
const cropIds = new Set<SoilCropId>(["corn", "soybean", "winter-wheat", "canola", "forage"]);
type RouteContext = { params: Promise<{ id: string }> };

function withOwnerCookie(response: NextResponse, setCookie: string | null) {
  if (setCookie) response.headers.set("Set-Cookie", setCookie);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const cropValue = new URL(request.url).searchParams.get("crop") as SoilCropId | null;
    const crop = cropValue && cropIds.has(cropValue) ? cropValue : "corn";
    const owner = getOrCreateSoilOwner(request);
    return withOwnerCookie(NextResponse.json(await listSoilTestUploads(owner.ownerIdHash, id, crop)), owner.setCookie);
  } catch (error) {
    console.error("Could not load field soil tests", error);
    return NextResponse.json({ message: error instanceof Error ? error.message : "Soil tests could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    const mappingRaw = form.get("mapping");
    const scope = form.get("samplingScope");
    const cropValue = form.get("crop");
    const address = form.get("address");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) return NextResponse.json({ message: "Choose a CSV file." }, { status: 400 });
    if (file.size === 0 || file.size > maximumBytes) return NextResponse.json({ message: "The CSV must be between 1 byte and 10 MB." }, { status: 400 });
    if (typeof mappingRaw !== "string") return NextResponse.json({ message: "Column mapping is required." }, { status: 400 });
    if (scope !== "whole-field-composite" && scope !== "individual-samples") return NextResponse.json({ message: "Choose the sampling scope." }, { status: 400 });
    if (typeof cropValue !== "string" || !cropIds.has(cropValue as SoilCropId)) return NextResponse.json({ message: "Choose a supported crop." }, { status: 400 });
    const mapping = JSON.parse(mappingRaw) as SoilCsvMapping;
    const owner = getOrCreateSoilOwner(request);
    const result = await saveSoilTestUpload({ ownerIdHash: owner.ownerIdHash, fieldId: id, address: typeof address === "string" && address.trim() ? address.trim() : null, fileName: file.name, csv: Buffer.from(await file.arrayBuffer()), mapping, samplingScope: scope as SoilSamplingScope, crop: cropValue as SoilCropId });
    if (!result.upload) return withOwnerCookie(NextResponse.json({ message: "Correct the CSV before saving.", errors: result.errors }, { status: 422 }), owner.setCookie);
    return withOwnerCookie(NextResponse.json(result.upload, { status: 201 }), owner.setCookie);
  } catch (error) {
    console.error("Soil-test upload failed", error);
    return NextResponse.json({ message: error instanceof Error ? error.message : "The soil test could not be stored." }, { status: 500 });
  }
}
