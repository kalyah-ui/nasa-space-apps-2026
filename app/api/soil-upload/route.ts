import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDataBucketName, getServerStorage } from "@/lib/gcs/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumBytes = 10 * 1024 * 1024;
const bucketName = getDataBucketName(process.env.SOIL_GCS_BUCKET);
const uploadPrefix = process.env.SOIL_UPLOAD_PREFIX ?? "uploads/soil-csv";
const storage = getServerStorage();

function safeName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 100) || "soil-data.csv";
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Choose a CSV file to upload." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ message: "Only CSV files are accepted." }, { status: 400 });
    }
    if (file.size === 0 || file.size > maximumBytes) {
      return NextResponse.json(
        { message: "The CSV must be between 1 byte and 10 MB." },
        { status: 400 },
      );
    }

    const date = new Date();
    const objectName = `${uploadPrefix}/${date.getUTCFullYear()}/${String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0")}/${randomUUID()}.csv`;
    await storage
      .bucket(bucketName)
      .file(objectName)
      .save(Buffer.from(await file.arrayBuffer()), {
        resumable: false,
        contentType: "text/csv",
        metadata: {
          cacheControl: "private, no-store",
          metadata: {
            originalName: safeName(file.name),
            uploadedAt: date.toISOString(),
          },
        },
      });

    return NextResponse.json(
      { fileName: file.name, size: file.size, uploadId: objectName.split("/").at(-1) },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Soil CSV upload failed", error);
    return NextResponse.json(
      {
        message:
          "The soil CSV could not be stored. Check the server's Google Cloud credentials and bucket write access.",
      },
      { status: 500 },
    );
  }
}

