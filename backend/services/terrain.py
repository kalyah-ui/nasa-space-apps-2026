import csv
import io
import math
import os
import tempfile
import threading
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any

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
    SoilComponent,
    SoilHorizon,
    SoilLandscapeObservation,
    SourceExtraction,
    TerrainSample,
)
from backend.services.gcs import get_bucket

SRTM_TIFF_PREFIX = "raw/srtm-global-1-arc-second:v003:ontario/"
ACI_RASTER_OBJECT = "raw/annual-crop-inventory_2025_on_v1/aci_2025_on_v1.tif"
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
MAX_SOIL_SHAPE_BYTES = 64 * 1024 * 1024
MAX_SOIL_TABLE_BYTES = 32 * 1024 * 1024
GCS_CACHE_DIR = Path(os.environ.get("LOAM_GCS_CACHE_DIR", tempfile.gettempdir())) / "loam-gcs-cache"
GCS_CACHE_LOCK = threading.Lock()


def _cached_gcs_file(object_name: str, max_bytes: int) -> Path:
    relative_path = PurePosixPath(object_name)
    cache_path = GCS_CACHE_DIR.joinpath(*relative_path.parts)
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
            detail=f"Sampled {sample_count} valid elevation pixels within the field boundary.",
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
                        f"covering {min(soil_overlap_pct, 100):.1f}% of the field. "
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

    sources.extend(
        [
            SourceExtraction(
                source_id="water",
                label="Water availability",
                status="unavailable",
                detail=(
                    "HYDAT is present as a 1.21 GiB SQLite database, but no station-to-field "
                    "spatial index or request-time query is configured."
                ),
                source_objects=["raw/hydat_2026-10-19.sqlite3"],
            ),
            SourceExtraction(
                source_id="climate",
                label="Climate and reflectance",
                status="unavailable",
                detail=(
                    "No valid Landsat reflectance source was found. The similarly named GCS prefix "
                    "contains SRTM HGT archives, not Landsat imagery."
                ),
                source_objects=["raw/landsat-surface-reflectance-collection-2-level-2-ontario/"],
            ),
        ]
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
        sources=sources,
    )