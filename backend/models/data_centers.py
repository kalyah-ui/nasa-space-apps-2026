from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

AssessmentStatus = Literal["reported", "no_reports_found", "unavailable", "error"]
FacilityStatus = Literal[
    "operational",
    "under_construction",
    "approved",
    "submitted",
    "proposed",
    "announced",
    "cancelled",
    "unverified",
]
FacilityType = Literal[
    "hyperscale",
    "colocation",
    "enterprise",
    "server_farm",
    "computing_campus",
    "unknown",
]
ScoreConfidence = Literal["high", "medium", "low", "insufficient"]
PurchaseRecommendation = Literal[
    "No identified data center concerns",
    "Routine due diligence recommended",
    "Additional investigation recommended",
    "Significant documented concerns requiring specialist review",
    "Insufficient evidence to assess",
]
ExposureFactorName = Literal[
    "existing_facility_proximity",
    "development_pipeline",
    "water_related_concerns",
    "land_use_concerns",
    "energy_infrastructure_concerns",
    "environmental_and_construction_concerns",
]


class FarmLocation(BaseModel):
    latitude: float
    longitude: float
    address: str | None
    province: str
    country: str = "Canada"
    is_demo_location: bool = False


class DataCenterSource(BaseModel):
    title: str
    url: str
    publication_date: date | None = None


class DataCenterFacility(BaseModel):
    name: str
    company: str | None
    status: FacilityStatus
    facility_type: FacilityType
    address: str | None
    latitude: float | None
    longitude: float | None
    distance_km: float | None
    distance_is_approximate: bool
    announcement_date: date | None
    expected_construction_date: str | None
    expected_completion_date: str | None
    municipal_approvals: list[str]
    power_information: str | None
    cooling_and_water_information: str | None
    evidence_summary: str
    sources: list[DataCenterSource]


class EvidenceFinding(BaseModel):
    finding: str
    documented: bool
    sources: list[DataCenterSource]


class ExposureFactor(BaseModel):
    factor: ExposureFactorName
    weight_pct: int
    score: int | None = Field(default=None, ge=0, le=100)
    rationale: str
    sources: list[DataCenterSource]


class KeyFinding(BaseModel):
    finding: str
    sources: list[DataCenterSource]


class NearbyDataCenterRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    farm_address: str | None = Field(default=None, max_length=240)
    radius_km: int = Field(default=25, ge=1, le=100)
    province: str = Field(default="Ontario", min_length=2, max_length=80)
    country: str = Field(default="Canada", min_length=2, max_length=80)
    is_demo_location: bool = False


class FarmScopeAssessment(BaseModel):
    assessment_status: AssessmentStatus
    farm_location: FarmLocation
    assessment_date: date
    search_radius_km: int
    existing_data_centers: list[DataCenterFacility]
    planned_data_centers: list[DataCenterFacility]
    closest_verified_facility_km: float | None
    water_concerns: list[EvidenceFinding]
    energy_concerns: list[EvidenceFinding]
    land_use_concerns: list[EvidenceFinding]
    environmental_concerns: list[EvidenceFinding]
    exposure_factors: list[ExposureFactor]
    exposure_score: int | None
    score_confidence: ScoreConfidence
    purchase_recommendation: PurchaseRecommendation
    key_findings: list[KeyFinding]
    recommended_due_diligence: list[str]
    data_gaps: list[str]
    sources: list[DataCenterSource]
    provider: Literal["gemini-google-search", "unavailable"]
