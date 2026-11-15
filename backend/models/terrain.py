from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator
from shapely import get_num_coordinates
from shapely.geometry import shape


class FieldTerrainRequest(BaseModel):
    field_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._-]+$")
    field_name: str = Field(min_length=1, max_length=120)
    geometry: dict[str, Any]

    @field_validator("geometry")
    @classmethod
    def validate_geometry(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            field_geometry = shape(value)
        except (TypeError, ValueError) as error:
            raise ValueError("Field geometry must be a valid GeoJSON polygon.") from error

        if field_geometry.geom_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError("Field geometry must be a Polygon or MultiPolygon.")
        if field_geometry.is_empty or not field_geometry.is_valid or field_geometry.area <= 0:
            raise ValueError("Field geometry must be a non-empty, valid polygon.")
        if get_num_coordinates(field_geometry) > 20_000:
            raise ValueError("Field geometry contains too many coordinates.")

        min_longitude, min_latitude, max_longitude, max_latitude = field_geometry.bounds
        if not (-180 <= min_longitude <= max_longitude <= 180):
            raise ValueError("Field longitude coordinates must be within -180 to 180.")
        if not (-56 <= min_latitude <= max_latitude <= 60):
            raise ValueError("Field latitude coordinates must be within SRTM coverage.")
        return value


class SoilHorizon(BaseModel):
    layer_no: int
    upper_depth_cm: int | None
    lower_depth_cm: int | None
    sand_pct: int | None
    silt_pct: int | None
    clay_pct: int | None
    organic_carbon_pct: float | None
    ph_cacl2: float | None
    ph_water: float | None


class SoilComponent(BaseModel):
    soil_id: str
    soil_name: str | None
    composition_pct: float
    drainage_code: str | None
    parent_material_texture_codes: list[str]
    landform_type_codes: list[str]
    landform_slope_codes: list[str]
    cropped_codes: list[str]
    surface_horizon: SoilHorizon | None


class CropClassCount(BaseModel):
    class_code: int
    pixel_count: int
    field_share_pct: float


class SourceExtraction(BaseModel):
    source_id: str
    label: str
    status: Literal["extracted", "unavailable", "error"]
    detail: str
    source_objects: list[str]


class SoilLandscapeObservation(BaseModel):
    polygon_id: int
    field_overlap_pct: float
    components: list[SoilComponent]


class TerrainSample(BaseModel):
    field_id: str
    field_name: str
    mean_elevation_m: float
    mean_slope_degrees: float | None
    sample_count: int
    source_object: str
    source_updated_at: datetime | None
    soil_landscapes: list[SoilLandscapeObservation]
    crop_class_counts: list[CropClassCount]
    crop_sample_count: int
    sources: list[SourceExtraction]