import { Storage } from "@google-cloud/storage";
import { fromUrl, writeArrayBuffer } from "geotiff";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import proj4 from "proj4";

const sceneId =
  process.env.LANDSAT_SAMPLE_SCENE ?? "LC08_L2SP_016028_20260923_02_T1";
const bucketName = process.env.LANDSAT_GCS_BUCKET ?? "nasa_spaceapps_2026_loam";
const objectPrefix =
  process.env.LANDSAT_GCS_PREFIX ??
  "raw/landsat-surface-reflectance-collection-2-level-2-ontario";
const samplePrefix = `${objectPrefix}/landsat-sample/${sceneId}`;
const fieldsPath = path.resolve("data/fields/fields.geojson");
const paddingMeters = 300;
const assetKeys = ["blue", "green", "red", "nir08", "qa_pixel", "qa_radsat"];

proj4.defs(
  "EPSG:32618",
  "+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs +type=crs",
);

function getGeometryBounds(collection) {
  const bounds = {
    west: Number.POSITIVE_INFINITY,
    south: Number.POSITIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY,
  };
  function visit(value) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      bounds.west = Math.min(bounds.west, value[0]);
      bounds.south = Math.min(bounds.south, value[1]);
      bounds.east = Math.max(bounds.east, value[0]);
      bounds.north = Math.max(bounds.north, value[1]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  }
  collection.features.forEach((feature) => visit(feature.geometry.coordinates));
  return bounds;
}

function projectBounds(bounds) {
  const corners = [
    [bounds.west, bounds.south],
    [bounds.west, bounds.north],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
  ].map((position) => proj4("EPSG:4326", "EPSG:32618", position));
  return {
    west: Math.min(...corners.map(([x]) => x)) - paddingMeters,
    south: Math.min(...corners.map(([, y]) => y)) - paddingMeters,
    east: Math.max(...corners.map(([x]) => x)) + paddingMeters,
    north: Math.max(...corners.map(([, y]) => y)) + paddingMeters,
  };
}

async function getSignedAsset(asset) {
  const response = await fetch(
    `https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(asset.href)}`,
  );
  if (!response.ok) {
    throw new Error(`Could not sign Landsat asset: ${response.status}`);
  }
  const signed = await response.json();
  return signed.href;
}

function getRasterWindow(image, bounds) {
  const [west, , , north] = image.getBoundingBox();
  const [resolutionX, resolutionY] = image.getResolution();
  const pixelWidth = Math.abs(resolutionX);
  const pixelHeight = Math.abs(resolutionY);
  const left = Math.max(0, Math.floor((bounds.west - west) / pixelWidth));
  const right = Math.min(
    image.getWidth(),
    Math.ceil((bounds.east - west) / pixelWidth),
  );
  const top = Math.max(0, Math.floor((north - bounds.north) / pixelHeight));
  const bottom = Math.min(
    image.getHeight(),
    Math.ceil((north - bounds.south) / pixelHeight),
  );
  if (left >= right || top >= bottom) {
    throw new Error("The selected Landsat scene does not cover the current fields.");
  }
  return {
    window: [left, top, right, bottom],
    width: right - left,
    height: bottom - top,
    west: west + left * pixelWidth,
    north: north - top * pixelHeight,
    east: west + right * pixelWidth,
    south: north - bottom * pixelHeight,
    pixelWidth,
    pixelHeight,
  };
}

async function main() {
  const collection = JSON.parse(await readFile(fieldsPath, "utf8"));
  const requestedBounds = projectBounds(getGeometryBounds(collection));
  const itemUrl =
    "https://planetarycomputer.microsoft.com/api/stac/v1/collections/" +
    `landsat-c2-l2/items/${sceneId}`;
  const itemResponse = await fetch(itemUrl);
  if (!itemResponse.ok) {
    throw new Error(`Landsat STAC item was not found: ${itemResponse.status}`);
  }
  const item = await itemResponse.json();
  for (const key of assetKeys) {
    if (!item.assets?.[key]?.href) {
      throw new Error(`The Landsat scene is missing the required ${key} asset.`);
    }
  }

  const storage = new Storage({
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GCLOUD_PROJECT ??
      "nasa-spaceapps-2026",
  });
  const bucket = storage.bucket(bucketName);
  const uploadedAssets = {};
  let sampleWindow;

  for (const key of assetKeys) {
    const asset = item.assets[key];
    const geotiff = await fromUrl(await getSignedAsset(asset));
    const image = await geotiff.getImage();
    const window = sampleWindow ?? getRasterWindow(image, requestedBounds);
    sampleWindow = window;
    const raster = await image.readRasters({
      window: window.window,
      interleave: true,
    });
    await geotiff.close();

    const output = writeArrayBuffer(raster, {
      width: window.width,
      height: window.height,
      BitsPerSample: [16],
      SampleFormat: [1],
      SamplesPerPixel: [1],
      PhotometricInterpretation: [1],
      PlanarConfiguration: [1],
      RowsPerStrip: [window.height],
      ModelPixelScale: [window.pixelWidth, window.pixelHeight, 0],
      ModelTiepoint: [0, 0, 0, window.west, window.north, 0],
      ProjectedCSTypeGeoKey: 32618,
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
      GTCitationGeoKey: "WGS 84 / UTM zone 18N",
      GDAL_NODATA: key.startsWith("qa_") ? "1" : "0",
    });
    const objectName = `${samplePrefix}/${key}.tif`;
    await bucket.file(objectName).save(Buffer.from(output), {
      resumable: false,
      contentType: "image/tiff",
      metadata: {
        cacheControl: "private, max-age=3600",
        metadata: { landsatScene: sceneId, stacAsset: key },
      },
    });
    uploadedAssets[key] = objectName;
    console.log(`Uploaded ${key}: ${raster.byteLength} source bytes.`);
  }

  const boundsProjected = {
    west: sampleWindow.west,
    south: sampleWindow.south,
    east: sampleWindow.east,
    north: sampleWindow.north,
  };
  const boundsWgs84 = {
    southwest: proj4("EPSG:32618", "EPSG:4326", [
      boundsProjected.west,
      boundsProjected.south,
    ]),
    northwest: proj4("EPSG:32618", "EPSG:4326", [
      boundsProjected.west,
      boundsProjected.north,
    ]),
    northeast: proj4("EPSG:32618", "EPSG:4326", [
      boundsProjected.east,
      boundsProjected.north,
    ]),
    southeast: proj4("EPSG:32618", "EPSG:4326", [
      boundsProjected.east,
      boundsProjected.south,
    ]),
  };
  const reflectanceBand = item.assets.red["raster:bands"]?.[0] ?? {};
  const manifest = {
    version: 1,
    sceneId,
    sourceProductId: item.assets.red.href.split("/").at(-2),
    acquiredAt: item.properties.datetime,
    platform: item.properties.platform,
    source: "USGS Landsat Collection 2 Level-2 Surface Reflectance",
    sourceCatalog: itemUrl,
    distribution: "Microsoft Planetary Computer",
    collection: "landsat-c2-l2",
    processingLevel: item.properties?.["landsat:correction"],
    wrsPath: item.properties?.["landsat:wrs_path"],
    wrsRow: item.properties?.["landsat:wrs_row"],
    sceneCloudCoverPercent: item.properties?.["eo:cloud_cover"],
    projection: "EPSG:32618",
    pixelSizeMeters: 30,
    width: sampleWindow.width,
    height: sampleWindow.height,
    boundsProjected,
    boundsWgs84,
    reflectanceScale: reflectanceBand.scale,
    reflectanceOffset: reflectanceBand.offset,
    reflectanceNoData: reflectanceBand.nodata,
    qaPixelNoData: item.assets.qa_pixel["raster:bands"]?.[0]?.nodata,
    qaMaskBits: {
      fill: 0,
      dilatedCloud: 1,
      cirrus: 2,
      cloud: 3,
      cloudShadow: 4,
      snow: 5,
    },
    assets: uploadedAssets,
    importedAt: new Date().toISOString(),
  };
  const manifestObject = `${samplePrefix}/manifest.json`;
  await bucket.file(manifestObject).save(`${JSON.stringify(manifest, null, 2)}\n`, {
    resumable: false,
    contentType: "application/json",
    metadata: { cacheControl: "private, max-age=300" },
  });
  await bucket.file(`${objectPrefix}/landsat-sample/manifest.json`).save(
    `${JSON.stringify({ ...manifest, manifestObject }, null, 2)}\n`,
    {
      resumable: false,
      contentType: "application/json",
      metadata: { cacheControl: "private, max-age=300" },
    },
  );
  console.log(`Uploaded manifest: gs://${bucketName}/${manifestObject}`);
}

await main();
