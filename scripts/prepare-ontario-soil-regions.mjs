import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "@google-cloud/storage";
import simplify from "@turf/simplify";
import { DBFFile } from "dbffile";
import proj4 from "proj4";
import { read as readShapefile } from "shapefile";

const bucketName = process.env.SOIL_GCS_BUCKET ?? "nasa_spaceapps_2026_loam";
const sourcePrefix =
  process.env.CANSIS_SOURCE_PREFIX ??
  "raw/cansis-soil-landscapes-canada-v3-2";
const outputObject =
  process.env.CANSIS_PROCESSED_OBJECT ??
  "processed/cansis-slc-v3-2/ontario-regions.geojson";
const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCLOUD_PROJECT ??
  "nasa-spaceapps-2026";

const requiredFiles = [
  "ca_all_slc_v3r2.shp",
  "ca_all_slc_v3r2.dbf",
  "ca_all_slc_v3r2.prj",
  "ca_all_slc_v3r2_cmp.dbf",
  "ca_all_slc_v3r2_crt.dbf",
  "soil_name_canada_v2r20231107.dbf",
  "soil_layer_canada_v2r20231108.dbf",
];

const drainageNames = {
  VR: "Very rapidly drained",
  R: "Rapidly drained",
  W: "Well drained",
  MW: "Moderately well drained",
  I: "Imperfectly drained",
  P: "Poorly drained",
  VP: "Very poorly drained",
  "#": "Not applicable",
};

const rootDepthNames = {
  "1": "Less than 25 cm",
  "2": "25–49 cm",
  "3": "50–74 cm",
  "4": "75–99 cm",
  "5": "100 cm or more",
  "-": "Not applicable",
};

const sourceCrs = "+proj=longlat +datum=NAD83 +no_defs +type=crs";
const targetCrs = "+proj=longlat +datum=WGS84 +no_defs +type=crs";

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text !== "-9" ? text : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function round(value, places = 1) {
  return Number(value.toFixed(places));
}

async function readDbf(filePath) {
  const dbf = await DBFFile.open(filePath, { encoding: "windows-1252" });
  return dbf.readRecords(dbf.recordCount);
}

function topsoilAverage(layers, field) {
  let weighted = 0;
  let depth = 0;
  for (const layer of layers) {
    const upper = numberOrNull(layer.UDEPTH);
    const lower = numberOrNull(layer.LDEPTH);
    const value = numberOrNull(layer[field]);
    if (upper === null || lower === null || value === null) continue;
    const overlap = Math.max(0, Math.min(lower, 20) - Math.max(upper, 0));
    if (overlap <= 0) continue;
    weighted += value * overlap;
    depth += overlap;
  }
  return depth > 0 ? weighted / depth : null;
}

function weightedAverage(components, select) {
  let weighted = 0;
  let total = 0;
  for (const component of components) {
    const value = select(component);
    if (value === null) continue;
    weighted += value * component.percent;
    total += component.percent;
  }
  return total > 0 ? round(weighted / total) : null;
}

function weightedMode(components, select) {
  const weights = new Map();
  for (const component of components) {
    const value = select(component);
    if (!value) continue;
    weights.set(value, (weights.get(value) ?? 0) + component.percent);
  }
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function transformGeometry(geometry) {
  function visit(value) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      return proj4(sourceCrs, targetCrs, value);
    }
    return value.map(visit);
  }
  return { ...geometry, coordinates: visit(geometry.coordinates) };
}

function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(value) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
      return;
    }
    value.forEach(visit);
  }
  visit(geometry.coordinates);
  return bounds.map((value) => round(value, 6));
}

async function main() {
  const storage = new Storage({ projectId });
  const bucket = storage.bucket(bucketName);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "loam-cansis-"));
  const localOutput = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../data/processed/ontario-soil-regions.geojson",
  );

  try {
    console.log(`Downloading ${requiredFiles.length} required CanSIS objects only...`);
    await Promise.all(
      requiredFiles.map(async (name) => {
        const destination = path.join(temporaryDirectory, name);
        await bucket.file(`${sourcePrefix}/${name}`).download({ destination });
      }),
    );

    const [cmpRows, crtRows, soilNameRows, soilLayerRows, polygons] =
      await Promise.all([
        readDbf(path.join(temporaryDirectory, "ca_all_slc_v3r2_cmp.dbf")),
        readDbf(path.join(temporaryDirectory, "ca_all_slc_v3r2_crt.dbf")),
        readDbf(path.join(temporaryDirectory, "soil_name_canada_v2r20231107.dbf")),
        readDbf(path.join(temporaryDirectory, "soil_layer_canada_v2r20231108.dbf")),
        readShapefile(
          path.join(temporaryDirectory, "ca_all_slc_v3r2.shp"),
          path.join(temporaryDirectory, "ca_all_slc_v3r2.dbf"),
          { encoding: "windows-1252" },
        ),
      ]);

    const ontarioComponents = cmpRows.filter(
      (row) => cleanText(row.PROVINCE)?.toUpperCase() === "ON",
    );
    const ontarioPolyIds = new Set(
      ontarioComponents.map((row) => cleanText(row.POLY_ID)).filter(Boolean),
    );
    const ontarioSoilIds = new Set(
      ontarioComponents.map((row) => cleanText(row.SOIL_ID)).filter(Boolean),
    );
    const ontarioCmpIds = new Set(
      ontarioComponents.map((row) => cleanText(row.CMP_ID)).filter(Boolean),
    );

    const soilNames = new Map(
      soilNameRows
        .filter((row) => ontarioSoilIds.has(cleanText(row.SOIL_ID)))
        .map((row) => [cleanText(row.SOIL_ID), row]),
    );
    const ratings = new Map(
      crtRows
        .filter((row) => ontarioCmpIds.has(cleanText(row.CMP_ID)))
        .map((row) => [cleanText(row.CMP_ID), row]),
    );
    const layersBySoil = new Map();
    for (const row of soilLayerRows) {
      const soilId = cleanText(row.SOIL_ID);
      if (!soilId || !ontarioSoilIds.has(soilId)) continue;
      const rows = layersBySoil.get(soilId) ?? [];
      rows.push(row);
      layersBySoil.set(soilId, rows);
    }

    const componentsByPolygon = new Map();
    for (const row of ontarioComponents) {
      const polyId = cleanText(row.POLY_ID);
      const soilId = cleanText(row.SOIL_ID);
      const cmpId = cleanText(row.CMP_ID);
      const percent = numberOrNull(row.PERCENT);
      if (!polyId || !soilId || !cmpId || percent === null || percent <= 0) continue;
      const name = soilNames.get(soilId);
      const rating = ratings.get(cmpId);
      const layers = layersBySoil.get(soilId) ?? [];
      const component = {
        soilId,
        soilName: cleanText(name?.SOILNAME),
        percent,
        drainageCode: cleanText(name?.DRAINAGE),
        parentMaterial:
          [cleanText(name?.PMTEX1), cleanText(name?.PMCHEM1)]
            .filter(Boolean)
            .join("; ") || null,
        rootDepthCode: cleanText(rating?.DEPTH),
        sand: topsoilAverage(layers, "TSAND"),
        silt: topsoilAverage(layers, "TSILT"),
        clay: topsoilAverage(layers, "TCLAY"),
        ph: topsoilAverage(layers, "PH2"),
        organicCarbon: topsoilAverage(layers, "ORGCARB"),
      };
      const components = componentsByPolygon.get(polyId) ?? [];
      components.push(component);
      componentsByPolygon.set(polyId, components);
    }

    const features = [];
    for (const polygon of polygons.features) {
      const polyId = cleanText(polygon.properties?.POLY_ID);
      if (!polyId || !ontarioPolyIds.has(polyId) || !polygon.geometry) continue;
      const components = (componentsByPolygon.get(polyId) ?? []).sort(
        (a, b) => b.percent - a.percent,
      );
      if (components.length === 0) continue;
      const dominant = components[0];
      const geometry = transformGeometry(polygon.geometry);
      const simplified = simplify(
        { type: "Feature", properties: {}, geometry },
        { tolerance: 0.0005, highQuality: true },
      ).geometry;
      const drainageCode = weightedMode(components, (component) => component.drainageCode);
      const rootDepthCode = weightedMode(components, (component) => component.rootDepthCode);

      features.push({
        type: "Feature",
        id: polyId,
        properties: {
          polyId,
          source: "AAFC CanSIS SLC v3.2",
          scale: "1:1,000,000",
          dominantSoil: dominant.soilName ?? dominant.soilId,
          dominantPercent: round(dominant.percent),
          drainageCode,
          drainage: drainageCode ? drainageNames[drainageCode] ?? drainageCode : null,
          sand: weightedAverage(components, (component) => component.sand),
          silt: weightedAverage(components, (component) => component.silt),
          clay: weightedAverage(components, (component) => component.clay),
          ph: weightedAverage(components, (component) => component.ph),
          phMethod: "CanSIS PH2 (pH as reported by the source project)",
          organicCarbon: weightedAverage(
            components,
            (component) => component.organicCarbon,
          ),
          rootDepthCode,
          rootDepth: rootDepthCode
            ? rootDepthNames[rootDepthCode] ?? rootDepthCode
            : null,
          components: components.map((component) => ({
            soilId: component.soilId,
            soilName: component.soilName,
            percent: round(component.percent),
            drainageCode: component.drainageCode,
            drainage: component.drainageCode
              ? drainageNames[component.drainageCode] ?? component.drainageCode
              : null,
            parentMaterial: component.parentMaterial,
          })),
          bbox: geometryBounds(simplified),
        },
        geometry: simplified,
      });
    }

    const collection = {
      type: "FeatureCollection",
      name: "Ontario regional soil suitability inputs",
      generatedAt: new Date().toISOString(),
      sourceCrs: "EPSG:4269",
      crs: "EPSG:4326",
      sourceScale: "1:1,000,000",
      source: "AAFC CanSIS SLC v3.2",
      note: "Regional estimate inputs; not a soil test and not official LSRS ratings.",
      id: randomUUID(),
      features,
    };
    const serialized = `${JSON.stringify(collection)}\n`;
    await mkdir(path.dirname(localOutput), { recursive: true });
    await writeFile(localOutput, serialized, "utf8");
    await bucket.file(outputObject).save(serialized, {
      contentType: "application/geo+json",
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=3600",
        metadata: {
          source: "AAFC CanSIS SLC v3.2",
          sourceScale: "1:1,000,000",
          crs: "EPSG:4326",
        },
      },
    });

    const missingLayers = [...ontarioSoilIds].filter(
      (soilId) => !layersBySoil.has(soilId),
    );
    console.log(
      JSON.stringify(
        {
          bucket: bucketName,
          sourcePrefix,
          outputObject,
          localOutput,
          ontarioPolygons: features.length,
          ontarioComponents: ontarioComponents.length,
          ontarioSoils: ontarioSoilIds.size,
          soilsWithoutLayerRows: missingLayers,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

