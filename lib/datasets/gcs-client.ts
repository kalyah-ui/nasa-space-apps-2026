export interface GcsObjectMetadata {
  name: string;
  size_bytes: number | null;
  updated_at: string | null;
  content_type: string | null;
  md5_hash: string | null;
  download_url: string;
}

export interface GcsObjectPage {
  bucket: string;
  prefix: string;
  objects: GcsObjectMetadata[];
  next_page_token: string | null;
}

export interface ListGcsObjectsOptions {
  prefix?: string;
  pageSize?: number;
  pageToken?: string;
  signal?: AbortSignal;
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function listGcsObjects({
  prefix = "raw/",
  pageSize = 100,
  pageToken,
  signal,
}: ListGcsObjectsOptions = {}): Promise<GcsObjectPage> {
  const url = new URL(`${apiBaseUrl}/api/data/objects`);
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("page_size", String(pageSize));
  if (pageToken) url.searchParams.set("page_token", pageToken);

  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return response.json() as Promise<GcsObjectPage>;
}

export function getGcsObjectUrl(objectName: string): string {
  const encodedName = objectName.split("/").map(encodeURIComponent).join("/");
  return `${apiBaseUrl}/api/data/objects/${encodedName}`;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Fall back to the HTTP status when the server does not return JSON.
  }
  return `Data API request failed (${response.status}).`;
}