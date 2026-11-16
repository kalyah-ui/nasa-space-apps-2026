import "server-only";

import { fromArrayBuffer } from "geotiff";
import sharp from "sharp";
import { getDataBucketName, getServerStorage } from "@/lib/gcs/storage";

const defaultObjectPrefix = "raw/srtm-global-1-arc-second:v003:ontario";
const maxCoveringTiles = 9;
const maxCachedTiles = 2;
const noDataFallback = -32767;
const colors = ["#2c7bb6", "#00a6ca", "#ffffbf", "#fdae61", "#d7191c"];

type Position = [longitude: number, latitude: number];

export type ElevationGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type TileSpec = {
  objectName: string;
  bounds: Bounds;
};

export type ElevationOverlay = {
  image: string;
  bounds: Bounds;
  legend: {
    min: number;
    max: number;
    units: "m";
    stops: Array<{ value: number; color: string }>;
  };
};

export class MissingElevationCoverageError extends Error {
  constructor() {
    super("SRTM elevation coverage is not available for the selected field.");
    this.name = "MissingElevationCoverageError";
  }
}

export class InvalidElevationGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidElevationGeometryError";
  }
}

const storage = getServerStorage();
const tileCache = new Map<string, Promise<Buffer>>();

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function parseRing(value: unknown): Position[] {
  if (!Array.isArray(value) || value.length < 3 || !value.every(isPosition)) {
    throw new InvalidElevationGeometryError(
      "The selected field contains an invalid polygon boundary.",
    );
  }

  const ring = value.map(
    ([longitude, latitude]) => [longitude, latitude] as Position,
  );
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first]);
  }

  return ring;
}

export function parseElevationGeometry(value: unknown): ElevationGeometry {
  if (!value || typeof value !== "object") {
    throw new InvalidElevationGeometryError("Select a valid field boundary first.");
  }

  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map(parseRing),
    };
  }

  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon) => {
        if (!Array.isArray(polygon)) {
          throw new InvalidElevationGeometryError(
            "The selected field contains an invalid multipolygon boundary.",
          );
        }
        return polygon.map(parseRing);
      }),
    };
  }

  throw new InvalidElevationGeometryError(
    "The selected field must be a Polygon or MultiPolygon.",
  );
}

function getBounds(geometry: ElevationGeometry): Bounds {
  const positions =
    geometry.type === "Polygon"
      ? geometry.coordinates.flat()
      : geometry.coordinates.flat(2);

  if (positions.length > 20_000) {
    throw new InvalidElevationGeometryError(
      "The selected field boundary is too detailed to render safely.",
    );
  }

  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  const bounds = {
    west: Math.min(...longitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    north: Math.max(...latitudes),
  };

  if (bounds.west === bounds.east || bounds.south === bounds.north) {
    throw new InvalidElevationGeometryError(
      "The selected field boundary has no measurable area.",
    );
  }

  return bounds;
}

function formatLatitude(latitude: number): string {
  return `${latitude >= 0 ? "n" : "s"}${Math.abs(latitude)
    .toString()
    .padStart(2, "0")}`;
}

function formatLongitude(longitude: number): string {
  return `${longitude >= 0 ? "e" : "w"}${Math.abs(longitude)
    .toString()
    .padStart(3, "0")}`;
}

function getCoveringTiles(bounds: Bounds): TileSpec[] {
  const epsilon = 1e-10;
  const westTile = Math.floor(bounds.west);
  const eastTile = Math.floor(bounds.east - epsilon);
  const southTile = Math.floor(bounds.south);
  const northTile = Math.floor(bounds.north - epsilon);
  const tiles: TileSpec[] = [];

  for (let latitude = southTile; latitude <= northTile; latitude += 1) {
    for (let longitude = westTile; longitude <= eastTile; longitude += 1) {
      tiles.push({
        objectName: `${formatLatitude(latitude)}_${formatLongitude(longitude)}_1arc_v3.tif`,
        bounds: {
          west: longitude,
          south: latitude,
          east: longitude + 1,
          north: latitude + 1,
        },
      });
    }
  }

  if (tiles.length > maxCoveringTiles) {
    throw new InvalidElevationGeometryError(
      "The selected field is too large for the elevation overlay.",
    );
  }

  return tiles;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 404
  );
}

function getCachedTile(
  objectName: string,
  loader: () => Promise<Buffer>,
): Promise<Buffer> {
  const cached = tileCache.get(objectName);
  if (cached) {
    return cached;
  }

  const pending = loader().catch((error) => {
    tileCache.delete(objectName);
    throw error;
  });
  tileCache.set(objectName, pending);

  while (tileCache.size > maxCachedTiles) {
    const oldestKey = tileCache.keys().next().value as string | undefined;
    if (!oldestKey || oldestKey === objectName) {
      break;
    }
    tileCache.delete(oldestKey);
  }

  return pending;
}

async function downloadTile(objectName: string): Promise<Buffer> {
  const bucketName = getDataBucketName(process.env.SRTM_GCS_BUCKET);
  const objectPrefix = process.env.SRTM_GCS_PREFIX ?? defaultObjectPrefix;
  const file = storage.bucket(bucketName).file(`${objectPrefix}/${objectName}`);

  try {
    const [contents] = await file.download({ validation: "crc32c" });
    return contents;
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new MissingElevationCoverageError();
    }
    throw error;
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function intersection(first: Bounds, second: Bounds): Bounds | null {
  const result = {
    west: Math.max(first.west, second.west),
    south: Math.max(first.south, second.south),
    east: Math.min(first.east, second.east),
    north: Math.min(first.north, second.north),
  };

  return result.west < result.east && result.south < result.north
    ? result
    : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function getOutputDimensions(bounds: Bounds): { width: number; height: number } {
  const meanLatitude = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
  const widthMeters =
    (bounds.east - bounds.west) * Math.cos(meanLatitude) * 111_320;
  const heightMeters = (bounds.north - bounds.south) * 111_320;
  const aspectRatio = widthMeters / heightMeters;
  const longestSide = 512;
  const shortestSide = 72;

  if (aspectRatio >= 1) {
    return {
      width: longestSide,
      height: Math.max(shortestSide, Math.round(longestSide / aspectRatio)),
    };
  }

  return {
    width: Math.max(shortestSide, Math.round(longestSide * aspectRatio)),
    height: longestSide,
  };
}

function isInsideRing([longitude, latitude]: Position, ring: Position[]): boolean {
  let inside = false;

  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const [currentLongitude, currentLatitude] = ring[index];
    const [previousLongitude, previousLatitude] = ring[previous];
    const crossesLatitude =
      currentLatitude > latitude !== previousLatitude > latitude;
    const intersectionLongitude =
      ((previousLongitude - currentLongitude) *
        (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;

    if (crossesLatitude && longitude < intersectionLongitude) {
      inside = !inside;
    }
  }

  return inside;
}

function isInsidePolygon(position: Position, polygon: Position[][]): boolean {
  return (
    isInsideRing(position, polygon[0]) &&
    polygon.slice(1).every((hole) => !isInsideRing(position, hole))
  );
}

function isInsideGeometry(
  position: Position,
  geometry: ElevationGeometry,
): boolean {
  return geometry.type === "Polygon"
    ? isInsidePolygon(position, geometry.coordinates)
    : geometry.coordinates.some((polygon) =>
        isInsidePolygon(position, polygon),
      );
}

async function readTileIntoGrid(
  tile: TileSpec,
  fieldBounds: Bounds,
  values: Float32Array,
  outputWidth: number,
  outputHeight: number,
): Promise<void> {
  if (!intersection(tile.bounds, fieldBounds)) {
    return;
  }

  const buffer = await getCachedTile(tile.objectName, () =>
    downloadTile(tile.objectName),
  );
  const geotiff = await fromArrayBuffer(toArrayBuffer(buffer));
  const image = await geotiff.getImage();
  const [imageWest, imageSouth, imageEast, imageNorth] = image.getBoundingBox();
  const covered = intersection(
    { west: imageWest, south: imageSouth, east: imageEast, north: imageNorth },
    fieldBounds,
  );
  if (!covered) {
    throw new MissingElevationCoverageError();
  }

  const imageWidth = image.getWidth();
  const imageHeight = image.getHeight();
  const [resolutionX, resolutionY] = image.getResolution();
  const sourceLeft = clamp(
    Math.floor((covered.west - imageWest) / resolutionX),
    0,
    imageWidth - 1,
  );
  const sourceRight = clamp(
    Math.ceil((covered.east - imageWest) / resolutionX) + 1,
    sourceLeft + 1,
    imageWidth,
  );
  const sourceTop = clamp(
    Math.floor((imageNorth - covered.north) / Math.abs(resolutionY)),
    0,
    imageHeight - 1,
  );
  const sourceBottom = clamp(
    Math.ceil((imageNorth - covered.south) / Math.abs(resolutionY)) + 1,
    sourceTop + 1,
    imageHeight,
  );

  const outputLeft = clamp(
    Math.floor(
      ((covered.west - fieldBounds.west) /
        (fieldBounds.east - fieldBounds.west)) *
        outputWidth,
    ),
    0,
    outputWidth - 1,
  );
  const outputRight = clamp(
    Math.ceil(
      ((covered.east - fieldBounds.west) /
        (fieldBounds.east - fieldBounds.west)) *
        outputWidth,
    ),
    outputLeft + 1,
    outputWidth,
  );
  const outputTop = clamp(
    Math.floor(
      ((fieldBounds.north - covered.north) /
        (fieldBounds.north - fieldBounds.south)) *
        outputHeight,
    ),
    0,
    outputHeight - 1,
  );
  const outputBottom = clamp(
    Math.ceil(
      ((fieldBounds.north - covered.south) /
        (fieldBounds.north - fieldBounds.south)) *
        outputHeight,
    ),
    outputTop + 1,
    outputHeight,
  );
  const readWidth = outputRight - outputLeft;
  const readHeight = outputBottom - outputTop;
  const raster = await image.readRasters({
    window: [sourceLeft, sourceTop, sourceRight, sourceBottom],
    samples: [0],
    width: readWidth,
    height: readHeight,
    interleave: true,
    resampleMethod: "bilinear",
  });
  const rasterValues = raster as unknown as ArrayLike<number>;
  const noData = image.getGDALNoData() ?? noDataFallback;

  for (let row = 0; row < readHeight; row += 1) {
    for (let column = 0; column < readWidth; column += 1) {
      const value = rasterValues[row * readWidth + column];
      if (Number.isFinite(value) && value !== noData && value > -32_000) {
        values[(outputTop + row) * outputWidth + outputLeft + column] = value;
      }
    }
  }
}

function parseHexColor(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function colorForValue(
  value: number,
  minimum: number,
  maximum: number,
): [number, number, number] {
  if (maximum === minimum) {
    return parseHexColor(colors[Math.floor(colors.length / 2)]);
  }

  const scaled =
    clamp((value - minimum) / (maximum - minimum), 0, 1) *
    (colors.length - 1);
  const lowerIndex = Math.min(colors.length - 2, Math.floor(scaled));
  const fraction = scaled - lowerIndex;
  const lower = parseHexColor(colors[lowerIndex]);
  const upper = parseHexColor(colors[lowerIndex + 1]);

  return lower.map((channel, index) =>
    Math.round(channel + (upper[index] - channel) * fraction),
  ) as [number, number, number];
}

export async function createElevationOverlay(
  geometry: ElevationGeometry,
): Promise<ElevationOverlay> {
  const bounds = getBounds(geometry);
  const { width, height } = getOutputDimensions(bounds);
  const values = new Float32Array(width * height);
  values.fill(Number.NaN);

  await Promise.all(
    getCoveringTiles(bounds).map((tile) =>
      readTileIntoGrid(tile, bounds, values, width, height),
    ),
  );

  const visible = new Uint8Array(width * height);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const longitude =
        bounds.west +
        ((column + 0.5) / width) * (bounds.east - bounds.west);
      const latitude =
        bounds.north -
        ((row + 0.5) / height) * (bounds.north - bounds.south);
      const value = values[index];

      if (
        Number.isFinite(value) &&
        isInsideGeometry([longitude, latitude], geometry)
      ) {
        visible[index] = 1;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    }
  }

  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new MissingElevationCoverageError();
  }

  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < values.length; index += 1) {
    if (!visible[index]) {
      continue;
    }

    const [red, green, blue] = colorForValue(values[index], minimum, maximum);
    const offset = index * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 218;
  }

  const png = await sharp(pixels, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 8 })
    .toBuffer();

  return {
    image: `data:image/png;base64,${png.toString("base64")}`,
    bounds,
    legend: {
      min: Math.round(minimum),
      max: Math.round(maximum),
      units: "m",
      stops: colors.map((color, index) => ({
        value: Math.round(
          minimum + (index / (colors.length - 1)) * (maximum - minimum),
        ),
        color,
      })),
    },
  };
}
