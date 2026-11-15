from fastapi import APIRouter, HTTPException
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError
from google.api_core.exceptions import Forbidden, NotFound

from backend.models.terrain import FieldTerrainRequest, TerrainSample
from backend.routes.data import _translate_gcs_error
from backend.services.terrain import get_terrain_sample

router = APIRouter()


@router.post("/terrain", response_model=TerrainSample)
def read_terrain(request: FieldTerrainRequest) -> TerrainSample:
    try:
        return get_terrain_sample(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (DefaultCredentialsError, Forbidden, NotFound, GoogleAPICallError) as error:
        raise _translate_gcs_error(error) from error