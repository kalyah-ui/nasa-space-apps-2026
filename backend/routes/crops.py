from fastapi import APIRouter

from backend.models.crops import CropClassificationRequest, CropClassificationResponse
from backend.services.crop_classifier import classify_crops

router = APIRouter()


@router.post("/classify", response_model=CropClassificationResponse)
def classify_crop_names(request: CropClassificationRequest) -> CropClassificationResponse:
    return classify_crops(request)
