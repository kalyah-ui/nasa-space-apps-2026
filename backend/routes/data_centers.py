from fastapi import APIRouter

from backend.models.data_centers import FarmScopeAssessment, NearbyDataCenterRequest
from backend.services.data_centers import lookup_nearby_data_centers

router = APIRouter()


@router.post("/nearby", response_model=FarmScopeAssessment)
def read_nearby_data_centers(request: NearbyDataCenterRequest) -> FarmScopeAssessment:
    return lookup_nearby_data_centers(request)
