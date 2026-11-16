import "server-only";

import { randomUUID } from "node:crypto";
import { listFields } from "@/lib/fields/store";
import { getDataBucketName, getServerStorage } from "@/lib/gcs/storage";
import { validateSoilCsv } from "./csv";
import { rateUploadedComposite } from "./suitability";
import type { SoilCropId } from "./types";
import type { SoilCsvMapping, SoilSamplingScope, SoilTestCollection, SoilTestUpload } from "./upload-types";

const storage = getServerStorage();
const bucketName = getDataBucketName(process.env.SOIL_GCS_BUCKET);
const prefix = (process.env.SOIL_TEST_UPLOAD_PREFIX ?? "uploads/soil-tests").replace(/\/+$/, "");
const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
const fieldPrefix = (ownerIdHash: string, fieldId: string) => prefix + "/" + ownerIdHash + "/" + safeSegment(fieldId);

export async function saveSoilTestUpload(input: { ownerIdHash: string; fieldId: string; address: string | null; fileName: string; csv: Buffer; mapping: SoilCsvMapping; samplingScope: SoilSamplingScope; crop: SoilCropId }) {
  const collection = await listFields();
  const field = collection.features.find((candidate) => candidate.id === input.fieldId);
  if (!field) throw new Error("The selected field no longer exists.");
  const validation = validateSoilCsv(input.csv.toString("utf8"), input.mapping, input.samplingScope, field);
  if (validation.errors.length) return { errors: validation.errors, upload: null };
  const uploadId = randomUUID();
  const base = fieldPrefix(input.ownerIdHash, field.id) + "/" + uploadId;
  const upload: SoilTestUpload = {
    uploadId, ownerIdHash: input.ownerIdHash, fieldId: field.id, fieldName: field.properties.name,
    fieldBoundary: field.geometry, address: input.address, originalFileName: input.fileName,
    uploadedAt: new Date().toISOString(), samplingScope: input.samplingScope, mapping: input.mapping,
    samples: validation.samples,
    assessment: input.samplingScope === "whole-field-composite" ? rateUploadedComposite(validation.samples[0], input.crop) : null,
  };
  const bucket = storage.bucket(bucketName);
  await Promise.all([
    bucket.file(base + "/original.csv").save(input.csv, { resumable: false, contentType: "text/csv", metadata: { cacheControl: "private, no-store", metadata: { ownerIdHash: input.ownerIdHash, fieldId: field.id, uploadId } } }),
    bucket.file(base + "/record.json").save(JSON.stringify(upload) + "\n", { resumable: false, contentType: "application/json", metadata: { cacheControl: "private, no-store", metadata: { ownerIdHash: input.ownerIdHash, fieldId: field.id, uploadId } } }),
  ]);
  return { errors: [], upload };
}

export async function listSoilTestUploads(ownerIdHash: string, fieldId: string, crop: SoilCropId): Promise<SoilTestCollection> {
  const [files] = await storage.bucket(bucketName).getFiles({ prefix: fieldPrefix(ownerIdHash, fieldId) + "/" });
  const uploads = await Promise.all(files.filter((file) => file.name.endsWith("/record.json")).map(async (file) => {
    const [data] = await file.download();
    const upload = JSON.parse(data.toString("utf8")) as SoilTestUpload;
    if (upload.ownerIdHash !== ownerIdHash || upload.fieldId !== fieldId) return null;
    return { ...upload, assessment: upload.samplingScope === "whole-field-composite" && upload.samples[0] ? rateUploadedComposite(upload.samples[0], crop) : null };
  }));
  return { fieldId, uploads: uploads.filter((upload): upload is SoilTestUpload => upload !== null).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)), authentication: "signed-anonymous-cookie", ownershipNote: "Private to this browser's signed owner cookie. Configure account authentication for cross-device ownership." };
}
