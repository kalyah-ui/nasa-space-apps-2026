import csv
import io
import json
import math
import os
import tempfile
import threading
from datetime import datetime
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

import fiona
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.mask import mask as mask_raster
from rasterio.warp import transform_geom
from shapely.geometry import mapping, shape

from backend.models.terrain import (
    CropClassCount,
    FieldTerrainRequest,
    FloodMapStudyObservation,
    LandsatObservation,
    SoilComponent,
    SoilHorizon,
    SoilLandscapeObservation,
    SourceExtraction,
    TerrainSample,
)
from backend.services.gcs import get_bucket
from backend.services.hydat import HYDAT_OBJECT, MAX_HYDAT_BYTES, sample_hydat

SRTM_TIFF_PREFIX = "raw/srtm-global-1-arc-second:v003:ontario/"
ACI_RASTER_OBJECT = "raw/annual-crop-inventory_2025_on_v1/aci_2025_on_v1.tif"
LANDSAT_SCENE_PREFIX = (
    "raw/landsat-surface-reflectance-collection-2-level-2-ontario/"
    "landsat-sample/LC08_L2SP_016028_20260923_02_T1/"
)
LANDSAT_MANIFEST_OBJECT = f"{LANDSAT_SCENE_PREFIX}manifest.json"
FLOOD_MAP_GDB_PREFIX = "raw/canada_flood_map_inventory.gdb/"
ACI_LEGEND_OBJECT = "processed/aci_crop_classifications_iac_classifications_des_cultures.csv"
SOIL_PREFIX = "raw/cansis-soil-landscapes-canada-v3-2/"
SOIL_SHAPE_OBJECT = f"{SOIL_PREFIX}ca_all_slc_v3r2.shp"
SOIL_ANALYTIC_OBJECTS = [
    SOIL_SHAPE_OBJECT,
    f"{SOIL_PREFIX}ca_all_slc_v3r2.shx",
    f"{SOIL_PREFIX}ca_all_slc_v3r2.dbf",
    f"{SOIL_PREFIX}ca_all_slc_v3r2.prj",
    f"{SOIL_PREFIX}ca_all_slc_v3r2.sbn",
    f"{SOIL_PREFIX}ca_all_slc_v3r2.sbx",
    f"{SOIL_PREFIX}ca_all_slc_v3r2_lst.dbf",
    f"{SOIL_PREFIX}soil_layer_canada_v2r20231108.dbf",
    f"{SOIL_PREFIX}soil_name_canada_v2r20231107.dbf",
]
MAX_SRTM_TIFF_BYTES = 64 * 1024 * 1024
MAX_ACI_TIFF_BYTES = 200 * 1024 * 1024
MAX_LANDSAT_MANIFEST_BYTES = 64 * 1024
MAX_LANDSAT_TIFF_BYTES = 2 * 1024 * 1024
MAX_FLOOD_GDB_OBJECT_BYTES = 8 * 1024 * 1024
MAX_FLOOD_GDB_TOTAL_BYTES = 16 * 1024 * 1024
MAX_SOIL_SHAPE_BYTES = 64 * 1024 * 1024
MAX_SOIL_TABLE_BYTES = 32 * 1024 * 1024
GCS_CACHE_DIR = Path(os.environ.get("LOAM_GCS_CACHE_DIR", tempfile.gettempdir())) / "loam-gcs-cache"
GCS_CACHE_LOCK = threading.Lock()


def _cached_gcs_file(object_name: str, max_bytes: int) -> Path:
    if (
        not object_name
        or object_name.startswith("/")
        or "\\" in object_name
        or any(part in {".", ".."} for part in object_name.split("/"))
    ):
        raise ValueError("Invalid GCS cache object path.")

    relative_path = PurePosixPath(object_name)
    safe_parts = [quote(part, safe="._-") for part in relative_path.parts]
    cache_path = GCS_CACHE_DIR.joinpath(*safe_parts)
    if cache_path.is_file() and cache_path.stat().st_size > 0:
        return cache_path

    with GCS_CACHE_LOCK:
        if cache_path.is_file() and cache_path.stat().st_size > 0:
            return cache_path

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        blob = get_bucket().blob(object_name)
        blob.reload()
        if blob.size is not None and blob.size > max_bytes:
            raise ValueError(f"GCS object {object_name} exceeds the allowed download size.")

        temporary_file = tempfile.NamedTemporaryFile(
            dir=cache_path.parent,
            prefix=f"{cache_path.name}.",
            suffix=".part",
            delete=False,
        )
        temporary_path = Path(temporary_file.name)
        temporary_file.close()
        try:
            blob.download_to_filename(str(temporary_path))
            if blob.size is not None and temporary_path.stat().st_size != blob.size:
                raise ValueError(f"GCS download for {object_name} was incomplete.")
            os.replace(temporary_path, cache_path)
        finally:
            temporary_path.unlink(missing_ok=True)

    return cache_path


def build_srtm_object_name(geometry: dict[str, Any]) -> str:
    field_geometry = shape(geometry)
    min_longitude, min_latitude, max_longitude, max_latitude = field_geometry.bounds
    tile_latitude = math.floor(field_geometry.centroid.y)
    tile_longitude = math.floor(field_geometry.centroid.x)
    if math.floor(min_latitude) != tile_latitude or math.floor(max_latitude) != tile_latitude:
        raise ValueError("Field must fit within one SRTM latitude tile.")
    if math.floor(min_longitude) != tile_longitude or math.floor(max_longitude) != tile_longitude:
        raise ValueError("Field must fit within one SRTM longitude tile.")

    latitude_prefix = "n" if tile_latitude >= 0 else "s"
    longitude_prefix = "w" if tile_longitude < 0 else "e"
    filename = (
        f"{latitude_prefix}{abs(tile_latitude):02d}_"
        f"{longitude_prefix}{abs(tile_longitude):03d}_1arc_v3.tif"
    )
    return f"{SRTM_TIFF_PREFIX}{filename}"


def sample_srtm_geotiff(
    geotiff_bytes: bytes, geometry: dict[str, Any]
) -> tuple[float, float | None, int]:
    field_geometry = shape(geometry)
    with MemoryFile(geotiff_bytes) as memory_file:
        with memory_file.open() as dataset:
            if dataset.crs is None or dataset.crs.to_epsg() != 4326:
                raise ValueError("The SRTM tile must use the WGS84 geographic coordinate system.")
            try:
                clipped, transform = mask_raster(
                    dataset,
                    [mapping(field_geometry)],
                    crop=True,
                    filled=False,
                )
            except ValueError as error:
                raise ValueError("The selected field does not overlap its SRTM tile.") from error

            elevation_band = clipped[0]
            valid = ~np.ma.getmaskarray(elevation_band)
            elevation_values = np.asarray(elevation_band.data, dtype=np.float64)
            valid &= np.isfinite(elevation_values)
            sample_count = int(np.count_nonzero(valid))
            if sample_count == 0:
                raise ValueError("The SRTM tile has no valid elevation samples inside this field.")

            mean_elevation = float(np.mean(elevation_values[valid]))
            slope_mean: float | None = None
            if elevation_values.shape[0] > 1 and elevation_values.shape[1] > 1:
                latitude_radians = math.radians(field_geometry.centroid.y)
                pixel_height_m = abs(transform.e) * 111_320
                pixel_width_m = abs(transform.a) * 111_320 * max(abs(math.cos(latitude_radians)), 1e-6)
                filled_elevations = np.where(valid, elevation_values, np.nan)
                gradient_y, gradient_x = np.gradient(
                    filled_elevations,
                    pixel_height_m,
                    pixel_width_m,
                )
                slopes = np.degrees(np.arctan(np.hypot(gradient_x, gradient_y)))
                valid_slopes = valid & np.isfinite(slopes)
                if np.any(valid_slopes):
                    slope_mean = float(np.mean(slopes[valid_slopes]))

    return round(mean_elevation, 2), round(slope_mean, 4) if slope_mean is not None else None, sample_count


def sample_crop_inventory_dataset(
    dataset: rasterio.DatasetReader,
    geometry: dict[str, Any],
) -> tuple[list[CropClassCount], int]:
    projected_geometry = transform_geom("EPSG:4326", dataset.crs, geometry)
    try:
        values, _ = mask_raster(
            dataset,
            [projected_geometry],
            crop=True,
            filled=False,
        )
    except ValueError as error:
        raise ValueError("The selected field does not overlap the crop inventory raster.") from error

    band = values[0]
    valid = ~np.ma.getmaskarray(band)
    class_values = np.asarray(band.data)[valid]
    if class_values.size == 0:
        raise ValueError("The crop inventory has no valid pixels inside this field.")

    classes, counts = np.unique(class_values, return_counts=True)
    total = int(counts.sum())
    return (
        [
            CropClassCount(
                class_code=int(class_code),
                pixel_count=int(count),
                field_share_pct=round(float(count) / total * 100, 2),
            )
            for class_code, count in zip(classes, counts, strict=True)
        ],
        total,
    )


def sample_landsat_ndvi_dataset(
    red_dataset: rasterio.DatasetReader,
    nir_dataset: rasterio.DatasetReader,
    qa_pixel_dataset: rasterio.DatasetReader,
    geometry: dict[str, Any],
    reflectance_scale: float,
    reflectance_offset: float,
    reflectance_nodata: int,
    qa_mask_bits: dict[str, int],
) -> tuple[float, int]:
    datasets = (red_dataset, nir_dataset, qa_pixel_dataset)
    if (
        red_dataset.crs is None
        or any(
            dataset.crs != red_dataset.crs
            or dataset.transform != red_dataset.transform
            or dataset.shape != red_dataset.shape
            for dataset in datasets[1:]
        )
    ):
        raise ValueError("Landsat red, NIR, and QA rasters must share one grid.")
    if not math.isfinite(reflectance_scale) or reflectance_scale <= 0 or not math.isfinite(reflectance_offset):
        raise ValueError("Landsat reflectance scale and offset must be finite.")
    if not qa_mask_bits or any(not 0 <= bit <= 15 for bit in qa_mask_bits.values()):
        raise ValueError("Landsat QA mask bits are invalid.")

    projected_geometry = transform_geom("EPSG:4326", red_dataset.crs, geometry)
    try:
        red_data, _ = mask_raster(red_dataset, [projected_geometry], crop=True, filled=False)
        nir_data, _ = mask_raster(nir_dataset, [projected_geometry], crop=True, filled=False)
        qa_data, _ = mask_raster(qa_pixel_dataset, [projected_geometry], crop=True, filled=False)
    except ValueError as error:
        raise ValueError("The selected area does not overlap the Landsat scene.") from error

    red_raw = np.asarray(red_data[0].data, dtype=np.float64)
    nir_raw = np.asarray(nir_data[0].data, dtype=np.float64)
    qa_values = np.asarray(qa_data[0].data, dtype=np.uint16)
    valid = ~(
        np.ma.getmaskarray(red_data[0])
        | np.ma.getmaskarray(nir_data[0])
        | np.ma.getmaskarray(qa_data[0])
    )
    valid &= (red_raw != reflectance_nodata) & (nir_raw != reflectance_nodata)

    qa_mask = sum(1 << bit for bit in qa_mask_bits.values())
    valid &= (qa_values & qa_mask) == 0

    red_reflectance = red_raw * reflectance_scale + reflectance_offset
    nir_reflectance = nir_raw * reflectance_scale + reflectance_offset
    denominator = nir_reflectance + red_reflectance
    valid &= (
        np.isfinite(red_reflectance)
        & np.isfinite(nir_reflectance)
        & np.isfinite(denominator)
        & (denominator != 0)
    )
    clear_pixel_count = int(np.count_nonzero(valid))
    if clear_pixel_count == 0:
        raise ValueError("The selected area has no clear Landsat pixels.")

    ndvi = (nir_reflectance[valid] - red_reflectance[valid]) / denominator[valid]
    return round(float(np.mean(ndvi)), 4), clear_pixel_count


def sample_flood_map_studies(
    dataset: fiona.Collection,
    geometry: dict[str, Any],
) -> list[FloodMapStudyObservation]:
    if not dataset.crs:
        raise ValueError("The flood-map inventory must declare a coordinate system.")

    projected_geometry = shape(transform_geom("EPSG:4326", dataset.crs, geometry))
    studies: list[FloodMapStudyObservation] = []
    for feature in dataset.filter(bbox=projected_geometry.bounds):
        if not feature["geometry"]:
            continue
        if not shape(feature["geometry"]).intersects(projected_geometry):
            continue

        properties = feature["properties"]
        province = properties.get("province_or_territory")
        study_name = properties.get("study_name")
        if not isinstance(province, str) or not isinstance(study_name, str):
            continue

        studies.append(
            FloodMapStudyObservation(
                province_or_territory=province,
                study_name=study_name,
                study_date=properties.get("study_date"),
                availability_status=properties.get("availability_status"),
                study_status=properties.get("study_status"),
                public_link=properties.get("public_link"),
            )
        )
    return studies


def load_crop_legend() -> dict[int, str]:
    blob = get_bucket().blob(ACI_LEGEND_OBJECT)
    blob.reload()
    if blob.size is not None and blob.size > 1024 * 1024:
        raise ValueError("Crop classification legend exceeds the allowed size.")
    contents = blob.download_as_bytes()
    if len(contents) > 1024 * 1024:
        raise ValueError("Crop classification legend exceeds the allowed size.")
    reader = csv.DictReader(io.StringIO(contents.decode("cp1252")))
    if not reader.fieldnames or not {"Code", "Label"}.issubset(reader.fieldnames):
        raise ValueError("Crop classification legend is missing Code or Label columns.")
    labels: dict[int, str] = {}
    for row in reader:
        code = int(row["Code"].strip())
        label = row["Label"].strip()
        if not label or code in labels:
            raise ValueError("Crop classification legend contains an empty or duplicate entry.")
        labels[code] = label
    if not labels:
        raise ValueError("Crop classification legend is empty.")
    return labels


def _nullable_float(value: Any) -> float | None:
    if value is None or value == -9:
        return None
    return float(value)


def _nullable_int(value: Any) -> int | None:
    if value is None or value == -9:
        return None
    return int(value)


@lru_cache(maxsize=1)
def _load_soil_join_tables() -> tuple[dict[str, dict[str, Any]], dict[str, SoilHorizon]]:
    names_path = _cached_gcs_file(
        f"{SOIL_PREFIX}soil_name_canada_v2r20231107.dbf",
        MAX_SOIL_TABLE_BYTES,
    )
    layers_path = _cached_gcs_file(
        f"{SOIL_PREFIX}soil_layer_canada_v2r20231108.dbf",
        MAX_SOIL_TABLE_BYTES,
    )

    soil_names: dict[str, dict[str, Any]] = {}
    with fiona.open(names_path) as table:
        for feature in table:
            properties = dict(feature["properties"])
            soil_id = properties.get("SOIL_ID")
            if soil_id:
                soil_names[str(soil_id)] = properties

    surface_horizons: dict[str, SoilHorizon] = {}
    with fiona.open(layers_path) as table:
        for feature in table:
            properties = dict(feature["properties"])
            soil_id = properties.get("SOIL_ID")
            if not soil_id or properties.get("LAYER_NO") != 1:
                continue
            surface_horizons[str(soil_id)] = SoilHorizon(
                layer_no=1,
                upper_depth_cm=properties.get("UDEPTH"),
                lower_depth_cm=properties.get("LDEPTH"),
                sand_pct=_nullable_int(properties.get("TSAND")),
                silt_pct=_nullable_int(properties.get("TSILT")),
                clay_pct=_nullable_int(properties.get("TCLAY")),
                organic_carbon_pct=_nullable_float(properties.get("ORGCARB")),
                ph_cacl2=_nullable_float(properties.get("PHCA")),
                ph_water=_nullable_float(properties.get("PH2")),
            )

    return soil_names, surface_horizons


def _build_soil_components(
    polygon_rows: dict[str, dict[str, Any]],
    soil_names: dict[str, dict[str, Any]],
    surface_horizons: dict[str, SoilHorizon],
) -> list[SoilComponent]:
    soil_components: list[SoilComponent] = []
    for soil_id, component in polygon_rows.items():
        name_record = soil_names.get(soil_id, {})
        texture_codes = [
            str(name_record.get(field_name))
            for field_name in ("PMTEX1", "PMTEX2", "PMTEX3")
            if name_record.get(field_name) not in (None, "", "-")
        ]
        soil_components.append(
            SoilComponent(
                soil_id=soil_id,
                soil_name=name_record.get("SOILNAME"),
                composition_pct=round(component["composition_pct"], 1),
                drainage_code=name_record.get("DRAINAGE"),
                parent_material_texture_codes=texture_codes,
                landform_type_codes=sorted(component["landform_type_codes"]),
                landform_slope_codes=sorted(component["landform_slope_codes"]),
                cropped_codes=sorted(component["cropped_codes"]),
                surface_horizon=surface_horizons.get(soil_id),
            )
        )
    return sorted(soil_components, key=lambda component: component.composition_pct, reverse=True)


def extract_soil_landscapes(
    geometry: dict[str, Any],
) -> list[SoilLandscapeObservation]:
    soil_paths = {
        object_name: _cached_gcs_file(
            object_name,
            MAX_SOIL_SHAPE_BYTES if object_name.endswith(".shp") else MAX_SOIL_TABLE_BYTES,
        )
        for object_name in SOIL_ANALYTIC_OBJECTS
    }
    shape_path = soil_paths[SOIL_SHAPE_OBJECT]
    with fiona.open(shape_path) as polygons:
        projected_geometry = shape(
            transform_geom("EPSG:4326", polygons.crs, geometry)
        )
        field_area = projected_geometry.area
        overlaps: dict[int, float] = {}
        for feature in polygons.filter(bbox=projected_geometry.bounds):
            polygon_geometry = shape(feature["geometry"])
            intersection_area = polygon_geometry.intersection(projected_geometry).area
            if intersection_area > 0:
                polygon_id = int(feature["properties"]["POLY_ID"])
                overlaps[polygon_id] = overlaps.get(polygon_id, 0) + intersection_area

    if not overlaps or field_area <= 0:
        return []

    landscape_path = soil_paths[f"{SOIL_PREFIX}ca_all_slc_v3r2_lst.dbf"]
    component_rows: dict[int, dict[str, dict[str, Any]]] = {
        polygon_id: {} for polygon_id in overlaps
    }
    with fiona.open(landscape_path) as landscape_table:
        for feature in landscape_table:
            properties = dict(feature["properties"])
            polygon_id = properties.get("POLY_ID")
            if polygon_id not in component_rows:
                continue

            soil_id = str(properties.get("SOIL_ID") or "")
            if not soil_id:
                continue
            component = component_rows[polygon_id].setdefault(
                soil_id,
                {
                    "soil_id": soil_id,
                    "composition_pct": 0.0,
                    "landform_type_codes": set(),
                    "landform_slope_codes": set(),
                    "cropped_codes": set(),
                },
            )
            component["composition_pct"] += float(properties.get("PERCENT") or 0)
            for field_name, key in (
                ("LF_TYPE", "landform_type_codes"),
                ("LF_SLOPE", "landform_slope_codes"),
                ("CROPPED", "cropped_codes"),
            ):
                value = properties.get(field_name)
                if value not in (None, ""):
                    component[key].add(str(value))

    soil_names, surface_horizons = _load_soil_join_tables()
    return [
        SoilLandscapeObservation(
            polygon_id=polygon_id,
            field_overlap_pct=round(overlap_area / field_area * 100, 2),
            components=_build_soil_components(
                component_rows[polygon_id],
                soil_names,
                surface_horizons,
            )
        )
        for polygon_id, overlap_area in sorted(
            overlaps.items(),
            key=lambda row: row[1],
            reverse=True,
        )
    ]


def get_terrain_sample(request: FieldTerrainRequest) -> TerrainSample:
    object_name = build_srtm_object_name(request.geometry)
    geotiff_path = _cached_gcs_file(object_name, MAX_SRTM_TIFF_BYTES)
    blob = get_bucket().blob(object_name)
    blob.reload()
    geotiff_bytes = geotiff_path.read_bytes()
    mean_elevation_m, mean_slope_degrees, sample_count = sample_srtm_geotiff(
        geotiff_bytes,
        request.geometry,
    )

    sources = [
        SourceExtraction(
            source_id="terrain",
            label="SRTM terrain",
            status="extracted",
            detail=f"Sampled {sample_count} valid elevation pixels within the selected boundary.",
            source_objects=[object_name],
        )
    ]

    soil_landscapes: list[SoilLandscapeObservation] = []
    try:
        soil_landscapes = extract_soil_landscapes(request.geometry)
        if not soil_landscapes:
            sources.append(
                SourceExtraction(
                    source_id="soil",
                    label="Soil landscapes",
                    status="unavailable",
                    detail="No soil landscape polygon intersects this field.",
                    source_objects=SOIL_ANALYTIC_OBJECTS,
                )
            )
        else:
            soil_overlap_pct = sum(landscape.field_overlap_pct for landscape in soil_landscapes)
            sources.append(
                SourceExtraction(
                    source_id="soil",
                    label="Soil landscapes",
                    status="extracted",
                    detail=(
                        f"Joined {len(soil_landscapes)} intersecting SLC polygons to "
                        f"{sum(len(landscape.components) for landscape in soil_landscapes)} soil components, "
                        f"covering {min(soil_overlap_pct, 100):.1f}% of the selected area. "
                        "Includes soil names, drainage codes, and surface horizons at 1:1,000,000 scale."
                    ),
                    source_objects=SOIL_ANALYTIC_OBJECTS,
                )
            )
    except Exception as error:
        sources.append(
            SourceExtraction(
                source_id="soil",
                label="Soil landscapes",
                status="error",
                detail=f"Soil extraction failed: {error}",
                source_objects=SOIL_ANALYTIC_OBJECTS,
            )
        )

    crop_class_counts: list[CropClassCount] = []
    crop_sample_count = 0
    try:
        crop_path = _cached_gcs_file(ACI_RASTER_OBJECT, MAX_ACI_TIFF_BYTES)
        with rasterio.open(crop_path) as crop_dataset:
            crop_class_counts, crop_sample_count = sample_crop_inventory_dataset(
                crop_dataset,
                request.geometry,
            )
        try:
            labels = load_crop_legend()
            for crop_class in crop_class_counts:
                crop_class.label = labels.get(crop_class.class_code)
            legend_detail = "Classes are labelled using the AAFC classification legend."
            source_objects = [ACI_RASTER_OBJECT, ACI_LEGEND_OBJECT]
        except Exception:
            legend_detail = "The classification legend is unavailable; class codes remain unlabelled."
            source_objects = [ACI_RASTER_OBJECT]
        sources.append(
            SourceExtraction(
                source_id="crop_inventory",
                label="Annual crop inventory",
                status="extracted",
                detail=(
                    f"Extracted {len(crop_class_counts)} raw class codes from {crop_sample_count} pixels. "
                    f"{legend_detail}"
                ),
                source_objects=source_objects,
            )
        )
    except Exception as error:
        sources.append(
            SourceExtraction(
                source_id="crop_inventory",
                label="Annual crop inventory",
                status="error",
                detail=f"Crop inventory extraction failed: {error}",
                source_objects=[ACI_RASTER_OBJECT],
            )
        )

    landsat_observation: LandsatObservation | None = None
    landsat_objects = [LANDSAT_MANIFEST_OBJECT]
    try:
        manifest_path = _cached_gcs_file(LANDSAT_MANIFEST_OBJECT, MAX_LANDSAT_MANIFEST_BYTES)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("The Landsat manifest must be a JSON object.")

        scene_id = manifest.get("sceneId")
        acquired_at_value = manifest.get("acquiredAt")
        assets = manifest.get("assets")
        qa_mask_bits = manifest.get("qaMaskBits")
        if not isinstance(scene_id, str) or not isinstance(acquired_at_value, str):
            raise ValueError("The Landsat manifest is missing scene identity or acquisition time.")
        if not isinstance(assets, dict) or not isinstance(qa_mask_bits, dict):
            raise ValueError("The Landsat manifest is missing raster assets or QA mask bits.")

        asset_names = [assets.get("red"), assets.get("nir08"), assets.get("qa_pixel")]
        if any(
            not isinstance(name, str)
            or not name.startswith(LANDSAT_SCENE_PREFIX)
            or "\\" in name
            or any(part in {".", ".."} for part in name.split("/"))
            for name in asset_names
        ):
            raise ValueError("The Landsat manifest contains an invalid raster object path.")
        red_object, nir_object, qa_object = asset_names
        landsat_objects.extend([red_object, nir_object, qa_object])

        qa_mask_bits = {
            name: bit
            for name, bit in qa_mask_bits.items()
            if isinstance(name, str) and isinstance(bit, int) and not isinstance(bit, bool)
        }
        scale = manifest.get("reflectanceScale")
        offset = manifest.get("reflectanceOffset")
        nodata = manifest.get("reflectanceNoData")
        if (
            not isinstance(scale, (int, float))
            or isinstance(scale, bool)
            or not isinstance(offset, (int, float))
            or isinstance(offset, bool)
            or not isinstance(nodata, int)
            or isinstance(nodata, bool)
        ):
            raise ValueError("The Landsat manifest has invalid reflectance scale, offset, or NoData values.")

        red_path = _cached_gcs_file(red_object, MAX_LANDSAT_TIFF_BYTES)
        nir_path = _cached_gcs_file(nir_object, MAX_LANDSAT_TIFF_BYTES)
        qa_path = _cached_gcs_file(qa_object, MAX_LANDSAT_TIFF_BYTES)
        with rasterio.open(red_path) as red_dataset, rasterio.open(nir_path) as nir_dataset, rasterio.open(
            qa_path
        ) as qa_pixel_dataset:
            mean_ndvi, clear_pixel_count = sample_landsat_ndvi_dataset(
                red_dataset,
                nir_dataset,
                qa_pixel_dataset,
                request.geometry,
                float(scale),
                float(offset),
                nodata,
                qa_mask_bits,
            )

        landsat_observation = LandsatObservation(
            scene_id=scene_id,
            acquired_at=datetime.fromisoformat(acquired_at_value.replace("Z", "+00:00")),
            mean_ndvi=mean_ndvi,
            clear_pixel_count=clear_pixel_count,
        )
        sources.append(
            SourceExtraction(
                source_id="landsat",
                label="Landsat surface reflectance",
                status="extracted",
                detail=(
                    f"Calculated cloud-masked NDVI from {clear_pixel_count} clear 30 m pixels "
                    f"in the {scene_id} scene."
                ),
                source_objects=landsat_objects,
            )
        )
    except Exception as error:
        sources.append(
            SourceExtraction(
                source_id="landsat",
                label="Landsat surface reflectance",
                status="error",
                detail=f"Landsat extraction failed: {error}",
                source_objects=landsat_objects,
            )
        )

    flood_map_studies: list[FloodMapStudyObservation] = []
    try:
        flood_blobs = list(get_bucket().list_blobs(prefix=FLOOD_MAP_GDB_PREFIX))
        total_size = sum(blob.size or 0 for blob in flood_blobs)
        if not flood_blobs:
            raise ValueError("The flood-map inventory is missing from the GCS bucket.")
        if total_size > MAX_FLOOD_GDB_TOTAL_BYTES:
            raise ValueError("The flood-map inventory exceeds the allowed cache size.")

        gdb_paths = [
            _cached_gcs_file(blob.name, MAX_FLOOD_GDB_OBJECT_BYTES)
            for blob in flood_blobs
        ]
        gdb_directory = gdb_paths[0].parent
        with fiona.open(gdb_directory, layer="flood_map") as flood_dataset:
            flood_map_studies = sample_flood_map_studies(flood_dataset, request.geometry)

        study_count = len(flood_map_studies)
        detail = (
            f"Found {study_count} flood-map inventory study footprints intersecting the area. "
            "The inventory is incomplete and is not a flood-hazard determination."
        )
        sources.append(
            SourceExtraction(
                source_id="flood_inventory",
                label="Flood-map inventory",
                status="extracted",
                detail=detail,
                source_objects=[FLOOD_MAP_GDB_PREFIX],
            )
        )
    except Exception as error:
        sources.append(
            SourceExtraction(
                source_id="flood_inventory",
                label="Flood-map inventory",
                status="error",
                detail=f"Flood-map inventory extraction failed: {error}",
                source_objects=[FLOOD_MAP_GDB_PREFIX],
            )
        )

    hydrology_observation = None
    try:
        configured_path = os.environ.get("HYDAT_SQLITE_PATH")
        hydat_path = (
            Path(configured_path) if configured_path
            else _cached_gcs_file(HYDAT_OBJECT, MAX_HYDAT_BYTES)
        )
        hydrology_observation = sample_hydat(hydat_path, request.geometry)
        sources.append(
            SourceExtraction(
                source_id="water",
                label="Regional streamflow (HYDAT)",
                status="extracted" if hydrology_observation else "unavailable",
                detail=(
                    "Historical daily streamflow from the nearest gauge with records within "
                    "50 km of the area centroid; not a measure of field water availability."
                    if hydrology_observation else
                    "No gauge with daily streamflow records was found within 50 km of the area centroid."
                ),
                source_objects=[HYDAT_OBJECT],
            )
        )
    except Exception as error:
        sources.append(
            SourceExtraction(
                source_id="water",
                label="Regional streamflow (HYDAT)",
                status="error",
                detail=f"HYDAT extraction failed: {error}",
                source_objects=[HYDAT_OBJECT],
            )
        )

    return TerrainSample(
        field_id=request.field_id,
        field_name=request.field_name,
        mean_elevation_m=mean_elevation_m,
        mean_slope_degrees=mean_slope_degrees,
        sample_count=sample_count,
        source_object=object_name,
        source_updated_at=blob.updated,
        soil_landscapes=soil_landscapes,
        crop_class_counts=crop_class_counts,
        crop_sample_count=crop_sample_count,
        landsat_observation=landsat_observation,
        flood_map_studies=flood_map_studies,
        hydrology_observation=hydrology_observation,
        sources=sources,
    )