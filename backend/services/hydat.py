"""Read historical regional streamflow from a read-only HYDAT snapshot."""
import calendar
import math
import sqlite3
from contextlib import closing
from datetime import date
from pathlib import Path
from typing import Any

from shapely.geometry import shape

from backend.models.terrain import HydrologyObservation

HYDAT_OBJECT = "raw/hydat_2026-10-19.sqlite3"
MAX_HYDAT_BYTES = 2 * 1024 * 1024 * 1024
MAX_STATION_DISTANCE_KM = 50


def _distance_km(latitude: float, longitude: float, station: sqlite3.Row) -> float:
    lat1, lat2 = math.radians(latitude), math.radians(station["LATITUDE"])
    dlat = lat2 - lat1
    dlon = math.radians(station["LONGITUDE"] - longitude)
    haversine = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, haversine))))


def sample_hydat(database_path: Path, geometry: dict[str, Any]) -> HydrologyObservation | None:
    """Nearest gauge within 50 km of the centroid with recorded daily flow.

    Proximity does not establish watershed connectivity or irrigation access.
    Preserve observation dates, condition symbols and distance with results.
    """
    center = shape(geometry).centroid
    with closing(sqlite3.connect(f"{database_path.resolve().as_uri()}?mode=ro", uri=True)) as database:
        database.row_factory = sqlite3.Row
        latitude_margin = math.degrees(MAX_STATION_DISTANCE_KM / 6371.0088)
        stations = database.execute(
            "SELECT STATION_NUMBER, STATION_NAME, LATITUDE, LONGITUDE FROM STATIONS "
            "WHERE LATITUDE BETWEEN ? AND ? AND LONGITUDE BETWEEN -180 AND 180",
            (center.y - latitude_margin, center.y + latitude_margin),
        ).fetchall()
        nearby = sorted(
            ((_distance_km(center.y, center.x, station), station) for station in stations),
            key=lambda item: (item[0], item[1]["STATION_NUMBER"]),
        )
        for distance, station in nearby:
            if distance > MAX_STATION_DISTANCE_KM:
                break
            rows = database.execute(
                "SELECT * FROM DLY_FLOWS WHERE STATION_NUMBER = ? ORDER BY YEAR DESC, MONTH DESC",
                (station["STATION_NUMBER"],),
            )
            for row in rows:
                year, month = int(row["YEAR"]), int(row["MONTH"])
                for day in range(calendar.monthrange(year, month)[1], 0, -1):
                    value = row[f"FLOW{day}"]
                    if value is None or not math.isfinite(float(value)) or float(value) < 0:
                        continue
                    return HydrologyObservation(
                        station_number=station["STATION_NUMBER"],
                        station_name=station["STATION_NAME"],
                        distance_km=round(distance, 2),
                        observed_on=date(year, month, day).isoformat(),
                        daily_flow_m3_s=float(value),
                        flow_symbol=row[f"FLOW_SYMBOL{day}"],
                    )
    return None
