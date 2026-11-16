import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.models.terrain import FieldTerrainRequest
from backend.services.hydat import sample_hydat
from backend.services.terrain import get_terrain_sample
from backend.tests.test_terrain import FIELD_GEOMETRY, FakeBlob, FakeBucket, make_geotiff


class HydatTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "hydat.sqlite3"
        with sqlite3.connect(self.path) as database:
            database.execute("CREATE TABLE STATIONS (STATION_NUMBER TEXT PRIMARY KEY, STATION_NAME TEXT, LATITUDE REAL, LONGITUDE REAL)")
            columns = ", ".join(f"FLOW{day} REAL, FLOW_SYMBOL{day} TEXT" for day in range(1, 32))
            database.execute(f"CREATE TABLE DLY_FLOWS (STATION_NUMBER TEXT, YEAR INTEGER, MONTH INTEGER, {columns})")
            database.execute("CREATE INDEX flow_station_date ON DLY_FLOWS(STATION_NUMBER, YEAR, MONTH)")

    def station(self, number, latitude=45.999, longitude=-76.999):
        with sqlite3.connect(self.path) as database:
            database.execute("INSERT INTO STATIONS VALUES (?, ?, ?, ?)", (number, f"Gauge {number}", latitude, longitude))

    def flow(self, number, year=2024, month=2, day=29, value=0, symbol=None):
        with sqlite3.connect(self.path) as database:
            database.execute(
                f"INSERT INTO DLY_FLOWS (STATION_NUMBER, YEAR, MONTH, FLOW{day}, FLOW_SYMBOL{day}) VALUES (?, ?, ?, ?, ?)",
                (number, year, month, value, symbol),
            )

    def test_nearest_station_with_flow_skips_levels_only_station(self):
        self.station("levels-only")
        self.station("near-flow", latitude=46.01)
        self.station("far-flow", latitude=46.1)
        self.flow("near-flow", value=12.5, symbol="B")
        self.flow("far-flow", value=99)
        observation = sample_hydat(self.path, FIELD_GEOMETRY)
        self.assertEqual(observation.station_number, "near-flow")
        self.assertAlmostEqual(observation.daily_flow_m3_s, 12.5)
        self.assertEqual(observation.flow_symbol, "B")
        self.assertGreater(observation.distance_km, 0)

    def test_zero_is_valid_and_calendar_ignores_nonexistent_days(self):
        self.station("zero")
        self.flow("zero")
        with sqlite3.connect(self.path) as database:
            database.execute("UPDATE DLY_FLOWS SET FLOW30 = 999")
        observation = sample_hydat(self.path, FIELD_GEOMETRY)
        self.assertEqual(observation.observed_on, "2024-02-29")
        self.assertEqual(observation.daily_flow_m3_s, 0)

    def test_skips_empty_new_months_and_negative_sentinels(self):
        self.station("gauge")
        self.flow("gauge", year=2025, value=None)
        self.flow("gauge", year=2024, value=-9999)
        self.flow("gauge", year=2023, day=28, value=2)
        observation = sample_hydat(self.path, FIELD_GEOMETRY)
        self.assertEqual(observation.observed_on, "2023-02-28")
        self.assertEqual(observation.daily_flow_m3_s, 2)

    def test_excludes_distant_stations_and_returns_none_without_flow(self):
        self.station("distant", latitude=47)
        self.flow("distant")
        self.assertIsNone(sample_hydat(self.path, FIELD_GEOMETRY))
        self.station("empty")
        self.assertIsNone(sample_hydat(self.path, FIELD_GEOMETRY))

    def test_missing_database_does_not_create_an_empty_file(self):
        missing = self.path.parent / "missing.sqlite3"
        with self.assertRaises(sqlite3.OperationalError):
            sample_hydat(missing, FIELD_GEOMETRY)
        self.assertFalse(missing.exists())

    def test_terrain_returns_hydrology_and_preserves_other_source_failures(self):
        self.station("gauge")
        self.flow("gauge", value=3.5)
        with patch.dict("os.environ", {"HYDAT_SQLITE_PATH": str(self.path)}), patch(
            "backend.services.terrain.get_bucket", return_value=FakeBucket(FakeBlob(make_geotiff()))
        ), patch("backend.services.terrain.GCS_CACHE_DIR", self.path.parent / "cache"):
            sample = get_terrain_sample(FieldTerrainRequest(field_id="test", field_name="Test", geometry=FIELD_GEOMETRY))
        self.assertEqual(sample.hydrology_observation.daily_flow_m3_s, 3.5)
        self.assertEqual(next(source for source in sample.sources if source.source_id == "water").status, "extracted")

    def test_database_error_isolated_from_other_terrain_observations(self):
        with patch.dict("os.environ", {"HYDAT_SQLITE_PATH": str(self.path.parent / "missing.sqlite3")}), patch(
            "backend.services.terrain.get_bucket", return_value=FakeBucket(FakeBlob(make_geotiff()))
        ), patch("backend.services.terrain.GCS_CACHE_DIR", self.path.parent / "cache"):
            sample = get_terrain_sample(FieldTerrainRequest(field_id="test", field_name="Test", geometry=FIELD_GEOMETRY))
        self.assertIsNone(sample.hydrology_observation)
        self.assertGreater(sample.mean_elevation_m, 0)
        self.assertEqual(next(source for source in sample.sources if source.source_id == "water").status, "error")
