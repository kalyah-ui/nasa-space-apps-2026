import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sourcePath = path.resolve(
  process.argv[2] ?? "data/fields/on_oneSoil_field_boundaries_2023.gpkg",
);
const outputPath = path.resolve(process.argv[3] ?? "data/fields/fields.geojson");
const centerLongitude = Number(process.env.ONTARIO_FIELDS_CENTER_LON ?? -76.29715);
const centerLatitude = Number(process.env.ONTARIO_FIELDS_CENTER_LAT ?? 45.30783);
const windowSizeKm = Number(process.env.ONTARIO_FIELDS_WINDOW_KM ?? 10);
const sqliteCommand = process.env.SQLITE3_COMMAND ?? "sqlite3";

if (
  !Number.isFinite(centerLongitude) ||
  !Number.isFinite(centerLatitude) ||
  !Number.isFinite(windowSizeKm) ||
  windowSizeKm <= 0
) {
  throw new Error("The Ontario field extraction location or window size is invalid.");
}

const earthRadius = 6_378_137;

function toWebMercator(longitude, latitude) {
  const longitudeRadians = (longitude * Math.PI) / 180;
  const latitudeRadians = (latitude * Math.PI) / 180;
  return [
    earthRadius * longitudeRadians,
    earthRadius * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)),
  ];
}

function toLongitudeLatitude(x, y) {
  return [
    (x / earthRadius) * (180 / Math.PI),
    (2 * Math.atan(Math.exp(y / earthRadius)) - Math.PI / 2) * (180 / Math.PI),
  ];
}

function getWindowBounds() {
  const [centerX, centerY] = toWebMercator(centerLongitude, centerLatitude);
  const projectedHalfSize =
    ((windowSizeKm * 1_000) / 2) / Math.cos((centerLatitude * Math.PI) / 180);
  return {
    minX: centerX - projectedHalfSize,
    maxX: centerX + projectedHalfSize,
    minY: centerY - projectedHalfSize,
    maxY: centerY + projectedHalfSize,
  };
}

function getEnvelopeSize(indicator) {
  if (indicator === 0) return 0;
  if (indicator === 1) return 4 * 8;
  if (indicator === 2 || indicator === 3) return 6 * 8;
  if (indicator === 4) return 8 * 8;
  throw new Error(`Unsupported GeoPackage envelope indicator: ${indicator}`);
}

function readWkbGeometry(buffer, initialOffset) {
  let offset = initialOffset;
  const littleEndian = buffer.readUInt8(offset) === 1;
  offset += 1;
  const readUInt32 = () => {
    const value = littleEndian
      ? buffer.readUInt32LE(offset)
      : buffer.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const readDouble = () => {
    const value = littleEndian
      ? buffer.readDoubleLE(offset)
      : buffer.readDoubleBE(offset);
    offset += 8;
    return value;
  };

  const rawType = readUInt32();
  const geometryType = rawType % 1_000;
  const hasZ = rawType >= 1_000 && rawType < 2_000;
  const hasM = rawType >= 2_000 && rawType < 3_000;

  const readPosition = () => {
    const position = toLongitudeLatitude(readDouble(), readDouble());
    if (hasZ) readDouble();
    if (hasM) readDouble();
    return position;
  };

  if (geometryType === 3) {
    const ringCount = readUInt32();
    const coordinates = [];
    for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
      const pointCount = readUInt32();
      const ring = [];
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        ring.push(readPosition());
      }
      coordinates.push(ring);
    }
    return { geometry: { type: "Polygon", coordinates }, offset };
  }

  if (geometryType === 6) {
    const polygonCount = readUInt32();
    const coordinates = [];
    for (let polygonIndex = 0; polygonIndex < polygonCount; polygonIndex += 1) {
      const polygon = readWkbGeometry(buffer, offset);
      if (polygon.geometry.type !== "Polygon") {
        throw new Error("A MultiPolygon contained a non-Polygon geometry.");
      }
      coordinates.push(polygon.geometry.coordinates);
      offset = polygon.offset;
    }
    return { geometry: { type: "MultiPolygon", coordinates }, offset };
  }

  throw new Error(`Unsupported WKB geometry type: ${rawType}`);
}

function parseGeoPackageGeometry(hex) {
  const buffer = Buffer.from(hex, "hex");
  if (buffer.toString("ascii", 0, 2) !== "GP") {
    throw new Error("The source geometry is not a GeoPackage binary geometry.");
  }
  const flags = buffer.readUInt8(3);
  const envelopeIndicator = (flags >> 1) & 0b111;
  const wkbOffset = 8 + getEnvelopeSize(envelopeIndicator);
  return readWkbGeometry(buffer, wkbOffset).geometry;
}

const bounds = getWindowBounds();
const sql = `
  SELECT json_object(
    'objectId', field.OBJECTID,
    'areaHectares', field.area_ha,
    'year', field.year,
    'geometryHex', hex(field.Shape)
  )
  FROM on_oneSoil_field_boundaries_2023 AS field
  JOIN rtree_on_oneSoil_field_boundaries_2023_Shape AS bounds
    ON bounds.id = field.OBJECTID
  WHERE bounds.maxx >= ${bounds.minX}
    AND bounds.minx <= ${bounds.maxX}
    AND bounds.maxy >= ${bounds.minY}
    AND bounds.miny <= ${bounds.maxY}
  ORDER BY field.OBJECTID;
`;

const result = spawnSync(sqliteCommand, [sourcePath, sql], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(result.stderr.trim() || "The GeoPackage query failed.");
}

const rows = result.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (rows.length === 0) {
  throw new Error("No official Ontario field boundaries intersect the extraction window.");
}

const collection = {
  type: "FeatureCollection",
  metadata: {
    source:
      "Agriculture and Agri-Food Canada OneSoil field boundaries 2023 (Ontario)",
    sourceFile: path.basename(sourcePath),
    sourceCrs: "EPSG:3857",
    outputCrs: "EPSG:4326",
    center: [centerLongitude, centerLatitude],
    windowSizeKm,
    extractedAt: new Date().toISOString(),
  },
  features: rows.map((row) => ({
    type: "Feature",
    id: `aafc-on-2023-${row.objectId}`,
    properties: {
      name: `Ontario Field ${row.objectId}`,
      areaHectares: Number(Number(row.areaHectares).toFixed(2)),
      source: "AAFC OneSoil",
      sourceObjectId: row.objectId,
      year: row.year,
    },
    geometry: parseGeoPackageGeometry(row.geometryHex),
  })),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(collection)}\n`, "utf8");
console.log(
  `Extracted ${collection.features.length} Ontario field boundaries to ${outputPath}.`,
);
