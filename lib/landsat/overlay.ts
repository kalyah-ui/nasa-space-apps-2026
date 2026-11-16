import "server-only";

import { fromArrayBuffer, fromUrl, type GeoTIFFImage } from "geotiff";
import proj4 from "proj4";
import sharp from "sharp";
import type { FieldGeometry, FieldPosition } from "@/lib/fields/types";
import { getDataBucketName, getServerStorage } from "@/lib/gcs/storage";

const defaultPrefix =
  "raw/landsat-surface-reflectance-collection-2-level-2-ontario";
const stacSearchUrl =
  "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const planetaryComputerSignUrl =
  "https://planetarycomputer.microsoft.com/api/sas/v1/sign";
const assetKeys = [
  "blue",
  "green",
  "red",
  "nir08",
  "qa_pixel",
  "qa_radsat",
] as const;
const reflectanceAssetKeys = ["blue", "green", "red", "nir08"] as const;
const reflectanceScale = 0.0000275;
const reflectanceOffset = -0.2;
const minimumClearPixelPercent = 20;
const maximumCandidates = 12;
const ndviStops = [
  { value: -1, color: "#7f3b08" },
  { value: 0, color: "#f7f7f7" },
  { value: 0.25, color: "#d9f0a3" },
  { value: 0.5, color: "#78c679" },
  { value: 0.75, color: "#238443" },
  { value: 1, color: "#004529" },
];

type LandsatLayer = "satellite" | "ndvi";
type AssetKey = (typeof assetKeys)[number];
type Bounds = { west: number; south: number; east: number; north: number };
type RasterValues = ArrayLike<number>;
type RasterBandMetadata = {
  scale?: number;
  offset?: number;
  nodata?: number;
};
type StacAsset = {
  href?: string;
  type?: string;
  roles?: string[];
  "proj:epsg"?: number;
  "raster:bands"?: RasterBandMetadata[];
};
type StacItem = {
  id: string;
  geometry?: FieldGeometry;
  properties: {
    datetime?: string;
    platform?: string;
    "eo:cloud_cover"?: number;
    "landsat:correction"?: string;
    "proj:epsg"?: number;
  };
  assets: Partial<Record<AssetKey, StacAsset>>;
};
type SampleManifest = {
  version?: number;
  sceneId: string;
  acquiredAt: string;
  platform: string;
  source: string;
  collection?: string;
  processingLevel?: string;
  sceneCloudCoverPercent: number;
  projection: string;
  pixelSizeMeters: number;
  width: number;
  height: number;
  boundsProjected: Bounds;
  reflectanceScale: number;
  reflectanceOffset: number;
  reflectanceNoData: number;
  assets: Record<AssetKey, string>;
};
type OpenRaster = {
  image: GeoTIFFImage;
  close: () => Promise<void>;
};
type RasterWindow = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  bounds: Bounds;
};
type RasterSet = {
  width: number;
  height: number;
  projectedBounds: Bounds;
  pixelWidth: number;
  pixelHeight: number;
  epsg: number;
  scale: number;
  offset: number;
  nodata: number;
  blue: RasterValues;
  green: RasterValues;
  red: RasterValues;
  nir: RasterValues;
  qaPixel: RasterValues;
  qaRadsat: RasterValues;
  imageDate: string;
  source: string;
  sceneId: string;
  provider: "bucket-sample" | "planetary-computer";
};

export type LandsatOverlay = {
  image: string;
  coordinates: [FieldPosition, FieldPosition, FieldPosition, FieldPosition];
  averageNdvi: number | null;
  clearPixelPercent: number;
  maskedPixelPercent: number;
  imageDate: string;
  source: string;
  sceneId: string;
  provider: "bucket-sample" | "planetary-computer";
  legend: null | {
    min: -1;
    max: 1;
    units: "NDVI";
    stops: typeof ndviStops;
  };
};

export class LandsatUnavailableError extends Error {
  constructor(message = "No suitable Landsat imagery covers the selected field.") {
    super(message);
    this.name = "LandsatUnavailableError";
  }
}

export class LandsatTooCloudyError extends Error {
  constructor() {
    super(
      "The available Landsat imagery has less than 20% clear pixels over this field.",
    );
    this.name = "LandsatTooCloudyError";
  }
}

export class LandsatTooSmallError extends Error {
  constructor() {
    super("This field is too small to contain a usable 30 metre Landsat pixel.");
    this.name = "LandsatTooSmallError";
  }
}

export class LandsatAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LandsatAccessError";
  }
}

const storage = getServerStorage();
let sampleManifestPromise: Promise<SampleManifest> | null = null;

function projectionName(epsg: number) {
  if (!Number.isInteger(epsg) || epsg < 32601 || epsg > 32660) {
    throw new LandsatUnavailableError(
      `The Landsat image projection EPSG:${epsg} is not a supported northern UTM CRS.`,
    );
  }
  const name = `EPSG:${epsg}`;
  if (!proj4.defs(name)) {
    proj4.defs(
      name,
      `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs +type=crs`,
    );
  }
  return name;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function isFiniteBounds(value: unknown): value is Bounds {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Partial<Bounds>;
  return [bounds.west, bounds.south, bounds.east, bounds.north].every(
    (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
  );
}

function isClose(left: number, right: number, tolerance = 0.001) {
  return Math.abs(left - right) <= tolerance;
}

function validateSampleManifest(value: unknown): SampleManifest {
  if (!value || typeof value !== "object") {
    throw new LandsatAccessError("The private Landsat sample manifest is invalid.");
  }
  const manifest = value as Partial<SampleManifest>;
  const source = manifest.source ?? "";
  const assets = manifest.assets;
  if (
    !manifest.sceneId ||
    !manifest.acquiredAt ||
    Number.isNaN(Date.parse(manifest.acquiredAt)) ||
    !source.includes("Landsat Collection 2 Level-2") ||
    (manifest.collection !== undefined && manifest.collection !== "landsat-c2-l2") ||
    (manifest.processingLevel !== undefined && manifest.processingLevel !== "L2SP") ||
    manifest.projection !== "EPSG:32618" ||
    manifest.pixelSizeMeters !== 30 ||
    !Number.isInteger(manifest.width) ||
    !Number.isInteger(manifest.height) ||
    !isFiniteBounds(manifest.boundsProjected) ||
    !isClose(manifest.reflectanceScale ?? Number.NaN, reflectanceScale, 1e-12) ||
    !isClose(manifest.reflectanceOffset ?? Number.NaN, reflectanceOffset, 1e-12) ||
    typeof manifest.reflectanceNoData !== "number" ||
    !assets ||
    assetKeys.some((key) => typeof assets[key] !== "string" || !assets[key])
  ) {
    throw new LandsatAccessError(
      "The private bucket sample could not be verified as aligned Landsat Collection 2 Level-2 surface reflectance.",
    );
  }
  return manifest as SampleManifest;
}

async function loadSampleManifest(): Promise<SampleManifest> {
  const bucketName = getDataBucketName(process.env.LANDSAT_GCS_BUCKET);
  const prefix = process.env.LANDSAT_GCS_PREFIX ?? defaultPrefix;
  try {
    const [buffer] = await storage
      .bucket(bucketName)
      .file(`${prefix}/landsat-sample/manifest.json`)
      .download();
    return validateSampleManifest(JSON.parse(buffer.toString("utf8")));
  } catch (error) {
    if (error instanceof LandsatAccessError) throw error;
    throw new LandsatAccessError(
      "The server could not read the private Landsat sample. Configure Google Application Default Credentials with access to the bucket.",
    );
  }
}

function getSampleManifest() {
  sampleManifestPromise ??= loadSampleManifest().catch((error) => {
    sampleManifestPromise = null;
    throw error;
  });
  return sampleManifestPromise;
}

function getRings(geometry: FieldGeometry): FieldPosition[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function allPositions(geometry: FieldGeometry): FieldPosition[] {
  return getRings(geometry).flat(2) as FieldPosition[];
}

function projectGeometryBounds(geometry: FieldGeometry, epsg: number): Bounds {
  const projected = allPositions(geometry).map((position) =>
    proj4("EPSG:4326", projectionName(epsg), position),
  );
  return {
    west: Math.min(...projected.map(([x]) => x)),
    south: Math.min(...projected.map(([, y]) => y)),
    east: Math.max(...projected.map(([x]) => x)),
    north: Math.max(...projected.map(([, y]) => y)),
  };
}

function containsBounds(container: Bounds, requested: Bounds, tolerance = 0.01) {
  return (
    requested.west >= container.west - tolerance &&
    requested.south >= container.south - tolerance &&
    requested.east <= container.east + tolerance &&
    requested.north <= container.north + tolerance
  );
}

function canContainThirtyMetrePixel(geometry: FieldGeometry) {
  const positions = allPositions(geometry);
  const meanLongitude =
    positions.reduce((total, [longitude]) => total + longitude, 0) /
    positions.length;
  const utmZone = clamp(Math.floor((meanLongitude + 180) / 6) + 1, 1, 60);
  const bounds = projectGeometryBounds(geometry, 32600 + utmZone);
  return bounds.east - bounds.west >= 30 && bounds.north - bounds.south >= 30;
}

function pointInRing([x, y]: FieldPosition, ring: FieldPosition[]) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(point: FieldPosition, geometry: FieldGeometry) {
  return getRings(geometry).some(
    (rings) =>
      pointInRing(point, rings[0]) &&
      !rings.slice(1).some((hole) => pointInRing(point, hole)),
  );
}

function getEpsg(image: GeoTIFFImage) {
  const geoKeys = image.getGeoKeys();
  const value = geoKeys?.ProjectedCSTypeGeoKey;
  return typeof value === "number" ? value : Number(value);
}

function getImageMetadata(image: GeoTIFFImage) {
  const [west, south, east, north] = image.getBoundingBox();
  const [resolutionX, resolutionY] = image.getResolution();
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    bounds: { west, south, east, north },
    pixelWidth: Math.abs(resolutionX),
    pixelHeight: Math.abs(resolutionY),
    epsg: getEpsg(image),
  };
}

function assertAlignedImages(images: GeoTIFFImage[], expectedEpsg: number) {
  const reference = getImageMetadata(images[0]);
  if (reference.epsg !== expectedEpsg) {
    throw new LandsatUnavailableError(
      `The Landsat raster CRS does not match EPSG:${expectedEpsg}.`,
    );
  }
  for (const image of images.slice(1)) {
    const candidate = getImageMetadata(image);
    if (
      candidate.width !== reference.width ||
      candidate.height !== reference.height ||
      candidate.epsg !== reference.epsg ||
      !isClose(candidate.pixelWidth, reference.pixelWidth) ||
      !isClose(candidate.pixelHeight, reference.pixelHeight) ||
      !isClose(candidate.bounds.west, reference.bounds.west) ||
      !isClose(candidate.bounds.south, reference.bounds.south) ||
      !isClose(candidate.bounds.east, reference.bounds.east) ||
      !isClose(candidate.bounds.north, reference.bounds.north)
    ) {
      throw new LandsatUnavailableError(
        "The required Landsat reflectance and quality bands are not aligned.",
      );
    }
  }
  return reference;
}

function getRasterWindow(image: GeoTIFFImage, requestedBounds: Bounds): RasterWindow {
  const metadata = getImageMetadata(image);
  if (!containsBounds(metadata.bounds, requestedBounds, metadata.pixelWidth)) {
    throw new LandsatUnavailableError(
      "This Landsat scene does not completely cover the selected field.",
    );
  }
  const left = Math.max(
    0,
    Math.floor((requestedBounds.west - metadata.bounds.west) / metadata.pixelWidth),
  );
  const right = Math.min(
    metadata.width,
    Math.ceil((requestedBounds.east - metadata.bounds.west) / metadata.pixelWidth),
  );
  const top = Math.max(
    0,
    Math.floor((metadata.bounds.north - requestedBounds.north) / metadata.pixelHeight),
  );
  const bottom = Math.min(
    metadata.height,
    Math.ceil((metadata.bounds.north - requestedBounds.south) / metadata.pixelHeight),
  );
  if (left >= right || top >= bottom) throw new LandsatTooSmallError();
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    bounds: {
      west: metadata.bounds.west + left * metadata.pixelWidth,
      north: metadata.bounds.north - top * metadata.pixelHeight,
      east: metadata.bounds.west + right * metadata.pixelWidth,
      south: metadata.bounds.north - bottom * metadata.pixelHeight,
    },
  };
}

async function readWindow(image: GeoTIFFImage, window: RasterWindow) {
  return (await image.readRasters({
    window: [window.left, window.top, window.right, window.bottom],
    interleave: true,
  })) as RasterValues;
}

async function openBucketRaster(objectName: string): Promise<OpenRaster> {
  const bucketName = getDataBucketName(process.env.LANDSAT_GCS_BUCKET);
  const [buffer] = await storage.bucket(bucketName).file(objectName).download();
  const geotiff = await fromArrayBuffer(toArrayBuffer(buffer));
  return {
    image: await geotiff.getImage(),
    close: async () => {
      await geotiff.close();
    },
  };
}

async function loadSampleRasterSet(
  geometry: FieldGeometry,
  manifest: SampleManifest,
): Promise<RasterSet> {
  let opened: OpenRaster[] = [];
  try {
    opened = await Promise.all(assetKeys.map((key) => openBucketRaster(manifest.assets[key])));
    const images = opened.map(({ image }) => image);
    const metadata = assertAlignedImages(images, 32618);
    if (
      metadata.width !== manifest.width ||
      metadata.height !== manifest.height ||
      !isClose(metadata.pixelWidth, manifest.pixelSizeMeters) ||
      !isClose(metadata.pixelHeight, manifest.pixelSizeMeters) ||
      !isClose(metadata.bounds.west, manifest.boundsProjected.west) ||
      !isClose(metadata.bounds.south, manifest.boundsProjected.south) ||
      !isClose(metadata.bounds.east, manifest.boundsProjected.east) ||
      !isClose(metadata.bounds.north, manifest.boundsProjected.north)
    ) {
      throw new LandsatAccessError(
        "The private Landsat sample GeoTIFF metadata does not match its manifest.",
      );
    }
    const window = getRasterWindow(images[0], projectGeometryBounds(geometry, 32618));
    const values = await Promise.all(images.map((image) => readWindow(image, window)));
    return {
      width: window.width,
      height: window.height,
      projectedBounds: window.bounds,
      pixelWidth: metadata.pixelWidth,
      pixelHeight: metadata.pixelHeight,
      epsg: 32618,
      scale: manifest.reflectanceScale,
      offset: manifest.reflectanceOffset,
      nodata: manifest.reflectanceNoData,
      blue: values[0],
      green: values[1],
      red: values[2],
      nir: values[3],
      qaPixel: values[4],
      qaRadsat: values[5],
      imageDate: manifest.acquiredAt.slice(0, 10),
      source: manifest.source,
      sceneId: manifest.sceneId,
      provider: "bucket-sample",
    };
  } catch (error) {
    if (
      error instanceof LandsatUnavailableError ||
      error instanceof LandsatTooSmallError ||
      error instanceof LandsatAccessError
    ) {
      throw error;
    }
    throw new LandsatAccessError(
      "The server could not read or decode the verified private Landsat sample.",
    );
  } finally {
    await Promise.allSettled(opened.map(({ close }) => close()));
  }
}

function isoDateYearsAgo(years: number) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString();
}

async function searchStac(geometry: FieldGeometry): Promise<StacItem[]> {
  let response: Response;
  try {
    response = await fetch(stacSearchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collections: ["landsat-c2-l2"],
        intersects: geometry,
        datetime: `${isoDateYearsAgo(3)}/${new Date().toISOString()}`,
        query: { "eo:cloud_cover": { lt: 80 } },
        sortby: [{ field: "properties.datetime", direction: "desc" }],
        limit: maximumCandidates,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new LandsatAccessError(
      "The Microsoft Planetary Computer Landsat catalog could not be reached.",
    );
  }
  if (!response.ok) {
    throw new LandsatAccessError(
      `The Microsoft Planetary Computer Landsat search failed (${response.status}).`,
    );
  }
  const result = (await response.json()) as { features?: StacItem[] };
  return (result.features ?? []).filter((item) => {
    const platform = item.properties.platform;
    return (
      (platform === "landsat-8" || platform === "landsat-9") &&
      item.properties["landsat:correction"] === "L2SP" &&
      assetKeys.every((key) => Boolean(item.assets[key]?.href))
    );
  });
}

async function signAsset(href: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(
        `${planetaryComputerSignUrl}?href=${encodeURIComponent(href)}`,
        { cache: "no-store", signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      throw new LandsatAccessError("A Planetary Computer Landsat asset could not be signed.");
    }
    if (response.ok) {
      const result = (await response.json()) as { href?: string };
      if (!result.href) {
        throw new LandsatAccessError(
          "Planetary Computer returned an invalid signed asset URL.",
        );
      }
      return result.href;
    }
    if (response.status !== 429 || attempt === 2) {
      throw new LandsatAccessError(
        `A Planetary Computer Landsat asset could not be signed (${response.status}).`,
      );
    }
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMilliseconds = Number.isFinite(retryAfterSeconds)
      ? Math.min(retryAfterSeconds * 1_000, 5_000)
      : 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
  }
  throw new LandsatAccessError("A Planetary Computer Landsat asset could not be signed.");
}

function getStacReflectanceMetadata(item: StacItem) {
  const bands = reflectanceAssetKeys.map(
    (key) => item.assets[key]?.["raster:bands"]?.[0],
  );
  if (
    bands.some(
      (band) =>
        !band ||
        !isClose(band.scale ?? Number.NaN, reflectanceScale, 1e-12) ||
        !isClose(band.offset ?? Number.NaN, reflectanceOffset, 1e-12) ||
        typeof band.nodata !== "number",
    )
  ) {
    throw new LandsatUnavailableError(
      "The catalog scene does not have verified Landsat Collection 2 reflectance scale, offset and nodata metadata.",
    );
  }
  const nodata = bands[0]?.nodata as number;
  if (bands.some((band) => band?.nodata !== nodata)) {
    throw new LandsatUnavailableError(
      "The Landsat reflectance bands do not use the same nodata value.",
    );
  }
  return { scale: reflectanceScale, offset: reflectanceOffset, nodata };
}

async function openRemoteRaster(asset: StacAsset): Promise<OpenRaster> {
  if (!asset.href) throw new LandsatUnavailableError();
  const signedHref = await signAsset(asset.href);
  const geotiff = await fromUrl(
    signedHref,
    { allowFullFile: false, maxRanges: 16 },
    AbortSignal.timeout(45_000),
  );
  return {
    image: await geotiff.getImage(),
    close: async () => {
      await geotiff.close();
    },
  };
}

async function loadStacRasterSet(
  geometry: FieldGeometry,
  item: StacItem,
): Promise<RasterSet> {
  const epsg =
    item.properties["proj:epsg"] ??
    item.assets.red?.["proj:epsg"] ??
    item.assets.blue?.["proj:epsg"];
  if (typeof epsg !== "number") {
    throw new LandsatUnavailableError("The Landsat scene has no projected CRS metadata.");
  }
  projectionName(epsg);
  const bandMetadata = getStacReflectanceMetadata(item);
  const opened: OpenRaster[] = [];
  try {
    for (const key of assetKeys) {
      opened.push(await openRemoteRaster(item.assets[key]!));
    }
    const images = opened.map(({ image }) => image);
    const metadata = assertAlignedImages(images, epsg);
    if (!isClose(metadata.pixelWidth, 30, 0.1) || !isClose(metadata.pixelHeight, 30, 0.1)) {
      throw new LandsatUnavailableError("The Landsat scene is not at the expected 30 metre resolution.");
    }
    const window = getRasterWindow(images[0], projectGeometryBounds(geometry, epsg));
    const values = await Promise.all(images.map((image) => readWindow(image, window)));
    return {
      width: window.width,
      height: window.height,
      projectedBounds: window.bounds,
      pixelWidth: metadata.pixelWidth,
      pixelHeight: metadata.pixelHeight,
      epsg,
      scale: bandMetadata.scale,
      offset: bandMetadata.offset,
      nodata: bandMetadata.nodata,
      blue: values[0],
      green: values[1],
      red: values[2],
      nir: values[3],
      qaPixel: values[4],
      qaRadsat: values[5],
      imageDate: item.properties.datetime?.slice(0, 10) ?? "",
      source: "USGS Landsat Collection 2 Level-2 via Microsoft Planetary Computer",
      sceneId: item.id,
      provider: "planetary-computer",
    };
  } finally {
    await Promise.allSettled(opened.map(({ close }) => close()));
  }
}

function isMasked(qaPixel: number, qaRadsat: number) {
  const invalidBits =
    (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);
  return (qaPixel & invalidBits) !== 0 || qaRadsat !== 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function colorForNdvi(value: number): [number, number, number] {
  const colors = [
    [127, 59, 8],
    [247, 247, 247],
    [217, 240, 163],
    [120, 198, 121],
    [35, 132, 67],
    [0, 69, 41],
  ];
  for (let index = 1; index < ndviStops.length; index += 1) {
    if (value <= ndviStops[index].value) {
      const lower = ndviStops[index - 1];
      const upper = ndviStops[index];
      const ratio = (value - lower.value) / (upper.value - lower.value);
      return colors[index - 1].map((channel, channelIndex) =>
        Math.round(channel + (colors[index][channelIndex] - channel) * ratio),
      ) as [number, number, number];
    }
  }
  return colors.at(-1) as [number, number, number];
}

function trueColorChannel(reflectance: number) {
  const stretched = clamp((reflectance - 0.01) / 0.29, 0, 1);
  return Math.round(Math.pow(stretched, 0.75) * 255);
}

function rasterCoordinates(rasters: RasterSet): LandsatOverlay["coordinates"] {
  const projection = projectionName(rasters.epsg);
  const { west, north, east, south } = rasters.projectedBounds;
  return [
    proj4(projection, "EPSG:4326", [west, north]) as FieldPosition,
    proj4(projection, "EPSG:4326", [east, north]) as FieldPosition,
    proj4(projection, "EPSG:4326", [east, south]) as FieldPosition,
    proj4(projection, "EPSG:4326", [west, south]) as FieldPosition,
  ];
}

async function renderRasterSet(
  rasters: RasterSet,
  geometry: FieldGeometry,
  layer: LandsatLayer,
): Promise<LandsatOverlay> {
  const pixels = Buffer.alloc(rasters.width * rasters.height * 4);
  const projection = projectionName(rasters.epsg);
  let fieldPixels = 0;
  let validPixels = 0;
  let ndviSum = 0;

  for (let row = 0; row < rasters.height; row += 1) {
    for (let column = 0; column < rasters.width; column += 1) {
      const x = rasters.projectedBounds.west + (column + 0.5) * rasters.pixelWidth;
      const y = rasters.projectedBounds.north - (row + 0.5) * rasters.pixelHeight;
      const point = proj4(projection, "EPSG:4326", [x, y]) as FieldPosition;
      if (!pointInGeometry(point, geometry)) continue;
      fieldPixels += 1;
      const index = row * rasters.width + column;
      const blueRaw = rasters.blue[index];
      const greenRaw = rasters.green[index];
      const redRaw = rasters.red[index];
      const nirRaw = rasters.nir[index];
      if (
        blueRaw === rasters.nodata ||
        greenRaw === rasters.nodata ||
        redRaw === rasters.nodata ||
        nirRaw === rasters.nodata ||
        isMasked(rasters.qaPixel[index], rasters.qaRadsat[index])
      ) {
        continue;
      }
      const blue = blueRaw * rasters.scale + rasters.offset;
      const green = greenRaw * rasters.scale + rasters.offset;
      const red = redRaw * rasters.scale + rasters.offset;
      const nir = nirRaw * rasters.scale + rasters.offset;
      const denominator = nir + red;
      if (![blue, green, red, nir].every(Number.isFinite) || Math.abs(denominator) < 1e-6) {
        continue;
      }
      const ndvi = clamp((nir - red) / denominator, -1, 1);
      ndviSum += ndvi;
      validPixels += 1;
      const outputIndex = index * 4;
      const color =
        layer === "ndvi"
          ? colorForNdvi(ndvi)
          : [trueColorChannel(red), trueColorChannel(green), trueColorChannel(blue)];
      pixels[outputIndex] = color[0];
      pixels[outputIndex + 1] = color[1];
      pixels[outputIndex + 2] = color[2];
      pixels[outputIndex + 3] = layer === "ndvi" ? 220 : 255;
    }
  }

  if (fieldPixels === 0) throw new LandsatTooSmallError();
  const clearPixelPercent = (validPixels / fieldPixels) * 100;
  if (clearPixelPercent < minimumClearPixelPercent) throw new LandsatTooCloudyError();
  const png = await sharp(pixels, {
    raw: { width: rasters.width, height: rasters.height, channels: 4 },
  })
    .png({ compressionLevel: 8 })
    .toBuffer();

  return {
    image: `data:image/png;base64,${png.toString("base64")}`,
    coordinates: rasterCoordinates(rasters),
    averageNdvi: Number((ndviSum / validPixels).toFixed(3)),
    clearPixelPercent: Number(clearPixelPercent.toFixed(1)),
    maskedPixelPercent: Number((100 - clearPixelPercent).toFixed(1)),
    imageDate: rasters.imageDate,
    source: rasters.source,
    sceneId: rasters.sceneId,
    provider: rasters.provider,
    legend:
      layer === "ndvi"
        ? { min: -1, max: 1, units: "NDVI", stops: ndviStops }
        : null,
  };
}

export async function createLandsatOverlay(
  geometry: FieldGeometry,
  layer: LandsatLayer,
): Promise<LandsatOverlay> {
  if (!canContainThirtyMetrePixel(geometry)) throw new LandsatTooSmallError();
  let sampleAccessError: LandsatAccessError | null = null;
  try {
    const manifest = await getSampleManifest();
    const sampleProjectedBounds = projectGeometryBounds(geometry, 32618);
    if (containsBounds(manifest.boundsProjected, sampleProjectedBounds)) {
      return renderRasterSet(
        await loadSampleRasterSet(geometry, manifest),
        geometry,
        layer,
      );
    }
  } catch (error) {
    if (error instanceof LandsatAccessError) sampleAccessError = error;
    else throw error;
  }

  let candidates: StacItem[];
  try {
    candidates = await searchStac(geometry);
  } catch (error) {
    if (sampleAccessError && error instanceof LandsatAccessError) {
      throw new LandsatAccessError(
        `${sampleAccessError.message} The Planetary Computer fallback was also unavailable.`,
      );
    }
    throw error;
  }
  if (candidates.length === 0) throw new LandsatUnavailableError();
  let sawTooSmall = false;
  let sawTooCloudy = false;
  let lastAccessError: LandsatAccessError | null = null;

  for (const item of candidates) {
    try {
      const rasters = await loadStacRasterSet(geometry, item);
      return await renderRasterSet(rasters, geometry, layer);
    } catch (error) {
      if (error instanceof LandsatTooSmallError) sawTooSmall = true;
      else if (error instanceof LandsatTooCloudyError) sawTooCloudy = true;
      else if (error instanceof LandsatAccessError) lastAccessError = error;
      else if (!(error instanceof LandsatUnavailableError)) {
        lastAccessError = new LandsatAccessError(
          "A Planetary Computer Landsat scene could not be read.",
        );
      }
    }
  }

  if (sawTooSmall) throw new LandsatTooSmallError();
  if (sawTooCloudy) throw new LandsatTooCloudyError();
  if (lastAccessError) throw lastAccessError;
  throw new LandsatUnavailableError();
}
