from typing import Literal

from pydantic import BaseModel, Field, field_validator

CropFamily = Literal[
    "Poaceae",
    "Fabaceae",
    "Brassicaceae",
    "Solanaceae",
    "Asteraceae",
    "Amaranthaceae",
    "Cucurbitaceae",
    "Apiaceae",
    "Amaryllidaceae",
    "Linaceae",
    "Polygonaceae",
    "Rosaceae",
    "Cannabaceae",
    "Other",
]
WaterDemand = Literal["lower", "moderate", "higher", "unknown"]
ClassificationMethod = Literal["gemini", "crop-reference", "manual"]


class CropFieldContext(BaseModel):
    region: str = Field(default="Ontario, Canada", max_length=100)
    sand_pct: float | None = Field(default=None, ge=0, le=100)
    silt_pct: float | None = Field(default=None, ge=0, le=100)
    clay_pct: float | None = Field(default=None, ge=0, le=100)
    ph_cacl2: float | None = Field(default=None, ge=0, le=14)


class CropClassificationRequest(BaseModel):
    crop_names: list[str] = Field(min_length=1, max_length=20)
    field_context: CropFieldContext | None = None

    @field_validator("crop_names")
    @classmethod
    def validate_crop_names(cls, values: list[str]) -> list[str]:
        cleaned = [name.strip() for name in values]
        if any(not name for name in cleaned):
            raise ValueError("Crop names must not be empty.")
        if any(len(name) > 120 for name in cleaned):
            raise ValueError("Crop names must be at most 120 characters.")
        return cleaned


class CropClassification(BaseModel):
    crop_name: str
    family: CropFamily | None
    water_demand: WaterDemand
    family_method: ClassificationMethod
    water_method: ClassificationMethod
    note: str


class CropClassificationResponse(BaseModel):
    classifications: list[CropClassification]
    provider: Literal["gemini", "crop-reference"]
