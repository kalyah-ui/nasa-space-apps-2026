import unittest
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np
from pydantic import ValidationError
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds
from shapely.geometry import Polygon, mapping

from backend.models.terrain import FieldTerrainRequest
from backend.services.terrain import (
    build_srtm_object_name,
    get_terrain_sample,
    _nullable_int,
    _cached_gcs_file,
    load_crop_legend,
    sample_crop_inventory_dataset,
    sample_flood_map_studies,
    sample_landsat_ndvi_dataset,
    sample_srtm_geotiff,
)


FIELD_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[
        [-76.9999, 45.9999],
        [-76.998, 45.9999],
        [-76.998, 45.998],
        [-76.9999, 45.998],
        [-76.9999, 45.9999],
    ]],
}


def make_geotiff() -> bytes:
    raster = np.fromfunction(lambda row, column: 100 + row + column, (10, 10), dtype=int)
    with MemoryFile() as memory_file:
        with memory_file.open(
            driver="GTiff",
            width=10,
            height=10,
            count=1,
            dtype="int16",
            crs="EPSG:4326",
            transform=from_origin(-77, 46, 1 / 3600, 1 / 3600),
            nodata=-9999,
        ) as dataset:
            dataset.write(raster.astype("int16"), 1)
        return memory_file.read()


def make_crop_inventory_geotiff() -> MemoryFile:
    min_longitude, min_latitude, max_longitude, max_latitude = Polygon(
        FIELD_GEOMETRY["coordinates"][0]
    ).bounds
    left, bottom, right, top = transform_bounds(
        "EPSG:4326",
        "EPSG:10820",
        min_longitude,
        min_latitude,
        max_longitude,
        max_latitude,
    )
    margin = 100
    raster = np.resize(np.array([122, 158, 220], dtype=np.uint8), (20, 20))
    memory_file = MemoryFile()
    with memory_file.open(
        driver="GTiff",
        width=20,
        height=20,
        count=1,
        dtype="uint8",
        crs="EPSG:10820",
        transform=from_origin(
            left - margin,
            top + margin,
            (right - left + margin * 2) / 20,
            (top - bottom + margin * 2) / 20,
        ),
    ) as dataset:
        dataset.write(raster, 1)
    return memory_file


class FakeBlob:
    updated = datetime(2026, 11, 15, tzinfo=timezone.utc)

    def __init__(self, content: bytes) -> None:
        self.content = content
        self.size = len(content)

    def reload(self) -> None:
        return None

    def download_as_bytes(self) -> bytes:
        return self.content

    def download_to_filename(self, filename: str) -> None:
        Path(filename).write_bytes(self.content)


class FakeBucket:
    def __init__(self, blob: FakeBlob) -> None:
        self._blob = blob
        self.requested_name: str | None = None

    def blob(self, name: str) -> FakeBlob:
        self.requested_name = name
        return self._blob


class FakeFloodMapLayer:
    crs = "EPSG:4326"

    def __init__(self, features) -> None:
        self.features = features

    def filter(self, bbox):
        return iter(self.features)


class TerrainTests(unittest.TestCase):
    @patch("backend.services.terrain.get_bucket")
    def test_loads_bilingual_crop_legend(self, get_bucket_mock) -> None:
        contents = "Code,Label,Étiquette\n122,Pasture/forages,Pâturage\n158,Soybeans,Soya\n".encode("cp1252")
        get_bucket_mock.return_value = FakeBucket(FakeBlob(contents))
        self.assertEqual(load_crop_legend(), {122: "Pasture/forages", 158: "Soybeans"})

    @patch("backend.services.terrain.get_bucket")
    def test_rejects_invalid_crop_legend(self, get_bucket_mock) -> None:
        get_bucket_mock.return_value = FakeBucket(FakeBlob(b"Code,Name\n158,Soybeans\n"))
        with self.assertRaises(ValueError):
            load_crop_legend()

    @patch("backend.services.terrain.get_bucket")
    def test_rejects_duplicate_crop_codes(self, get_bucket_mock) -> None:
        get_bucket_mock.return_value = FakeBucket(FakeBlob(b"Code,Label\n158,Soybeans\n158,Corn\n"))
        with self.assertRaises(ValueError):
            load_crop_legend()

    def test_builds_correct_srtm_geotiff_tile_name_for_field(self) -> None:
        object_name = build_srtm_object_name({
            "type": "Polygon",
            "coordinates": [[
                [-76.31, 45.31], [-76.30, 45.31], [-76.30, 45.30],
                [-76.31, 45.30], [-76.31, 45.31],
            ]],
        })

        self.assertEqual(
            object_name,
            "raw/srtm-global-1-arc-second:v003:ontario/n45_w077_1arc_v3.tif",
        )

    @patch("backend.services.terrain.get_bucket")
    def test_gcs_cache_encodes_object_path_segments_for_windows(self, get_bucket_mock) -> None:
        object_name = "raw/srtm-global-1-arc-second:v003:ontario/n45_w077_1arc_v3.tif"
        bucket = FakeBucket(FakeBlob(b"sample geotiff"))
        get_bucket_mock.return_value = bucket

        with tempfile.TemporaryDirectory() as cache_dir:
            with patch("backend.services.terrain.GCS_CACHE_DIR", Path(cache_dir)):
                cached_path = _cached_gcs_file(object_name, 1024)
                self.assertTrue(cached_path.is_file())
                self.assertIn("srtm-global-1-arc-second%3Av003%3Aontario", str(cached_path))
                self.assertEqual(cached_path.read_bytes(), b"sample geotiff")
                self.assertEqual(bucket.requested_name, object_name)

    def test_samples_geotiff_cells_inside_field_and_derives_slope(self) -> None:
        mean_elevation, mean_slope, sample_count = sample_srtm_geotiff(make_geotiff(), FIELD_GEOMETRY)

        self.assertGreater(mean_elevation, 100)
        self.assertIsNotNone(mean_slope)
        self.assertGreater(mean_slope, 0)
        self.assertGreater(sample_count, 0)

    def test_extracts_crop_codes_after_reprojecting_field_into_aci_crs(self) -> None:
        memory_file = make_crop_inventory_geotiff()
        try:
            with memory_file.open() as dataset:
                classes, sample_count = sample_crop_inventory_dataset(dataset, FIELD_GEOMETRY)
        finally:
            memory_file.close()

        self.assertGreater(sample_count, 0)
        self.assertEqual({item.class_code for item in classes}, {122, 158, 220})
        self.assertAlmostEqual(sum(item.field_share_pct for item in classes), 100, delta=0.02)

    def test_samples_landsat_ndvi_after_masking_cloud_and_nodata_pixels(self) -> None:
        transform = from_origin(-77, 46, 1 / 3600, 1 / 3600)
        geometry = {
            "type": "Polygon",
            "coordinates": [[
                [-77, 46],
                [-77 + 2 / 3600, 46],
                [-77 + 2 / 3600, 46 - 2 / 3600],
                [-77, 46 - 2 / 3600],
                [-77, 46],
            ]],
        }
        with (
            MemoryFile() as red_memory,
            MemoryFile() as nir_memory,
            MemoryFile() as qa_memory,
        ):
            with (
                red_memory.open(
                    driver="GTiff",
                    width=2,
                    height=2,
                    count=1,
                    dtype="uint16",
                    crs="EPSG:4326",
                    transform=transform,
                    nodata=0,
                ) as red_dataset,
                nir_memory.open(
                    driver="GTiff",
                    width=2,
                    height=2,
                    count=1,
                    dtype="uint16",
                    crs="EPSG:4326",
                    transform=transform,
                    nodata=0,
                ) as nir_dataset,
                qa_memory.open(
                    driver="GTiff",
                    width=2,
                    height=2,
                    count=1,
                    dtype="uint16",
                    crs="EPSG:4326",
                    transform=transform,
                    nodata=1,
                ) as qa_dataset,
            ):
                red_dataset.write(np.array([[10000, 12000], [0, 10000]], dtype="uint16"), 1)
                nir_dataset.write(np.array([[20000, 18000], [0, 15000]], dtype="uint16"), 1)
                qa_dataset.write(np.array([[0, 1 << 3], [0, 0]], dtype="uint16"), 1)

                mean_ndvi, clear_pixel_count = sample_landsat_ndvi_dataset(
                    red_dataset,
                    nir_dataset,
                    qa_dataset,
                    geometry,
                    reflectance_scale=0.0000275,
                    reflectance_offset=-0.2,
                    reflectance_nodata=0,
                    qa_mask_bits={"fill": 0, "cloud": 3},
                )

        self.assertEqual(clear_pixel_count, 2)
        expected_ndvi = (
            (0.35 - 0.075) / (0.35 + 0.075)
            + (0.2125 - 0.075) / (0.2125 + 0.075)
        ) / 2
        self.assertAlmostEqual(mean_ndvi, expected_ndvi, delta=0.0001)

    def test_extracts_only_flood_map_studies_intersecting_the_region(self) -> None:
        region = Polygon([
            (-76.3, 45.3),
            (-76.2, 45.3),
            (-76.2, 45.4),
            (-76.3, 45.4),
            (-76.3, 45.3),
        ])
        local_study = Polygon([
            (-76.28, 45.32),
            (-76.27, 45.32),
            (-76.27, 45.33),
            (-76.28, 45.33),
            (-76.28, 45.32),
        ])
        remote_study = Polygon([
            (-75.0, 44.0),
            (-74.9, 44.0),
            (-74.9, 44.1),
            (-75.0, 44.1),
            (-75.0, 44.0),
        ])
        features = [
            {
                "geometry": mapping(local_study),
                "properties": {
                    "province_or_territory": "Ontario",
                    "study_name": "Mississippi River flood study",
                    "study_date": "2019-09-01",
                    "availability_status": "not publicly available",
                    "study_status": "final",
                    "public_link": None,
                },
            },
            {
                "geometry": mapping(remote_study),
                "properties": {
                    "province_or_territory": "Ontario",
                    "study_name": "Remote flood study",
                },
            },
        ]

        studies = sample_flood_map_studies(
            FakeFloodMapLayer(features),
            mapping(region),
        )

        self.assertEqual(len(studies), 1)
        self.assertEqual(studies[0].study_name, "Mississippi River flood study")
        self.assertEqual(studies[0].availability_status, "not publicly available")

    @patch("backend.services.terrain.get_bucket")
    def test_gcs_sample_includes_object_name_and_update_time(self, get_bucket_mock) -> None:
        bucket = FakeBucket(FakeBlob(make_geotiff()))
        get_bucket_mock.return_value = bucket
        request = FieldTerrainRequest(field_id="PlotA", field_name="PlotA", geometry=FIELD_GEOMETRY)

        with tempfile.TemporaryDirectory() as cache_dir:
            with patch("backend.services.terrain.GCS_CACHE_DIR", Path(cache_dir)):
                result = get_terrain_sample(request)

        self.assertEqual(result.field_id, "PlotA")
        self.assertEqual(result.source_updated_at, bucket._blob.updated)
        self.assertEqual(result.source_object, "raw/srtm-global-1-arc-second:v003:ontario/n45_w077_1arc_v3.tif")
        self.assertEqual(
            {source.source_id for source in result.sources},
            {"terrain", "soil", "crop_inventory", "landsat", "flood_inventory", "water"},
        )

    def test_rejects_invalid_or_unbounded_field_geometries(self) -> None:
        with self.assertRaises(ValidationError):
            FieldTerrainRequest(field_id="../private", field_name="Bad field", geometry=FIELD_GEOMETRY)

    def test_soil_missing_value_sentinel_is_not_reported_as_a_measurement(self) -> None:
        self.assertIsNone(_nullable_int(-9))
        self.assertEqual(_nullable_int(68), 68)


if __name__ == "__main__":
    unittest.main()
