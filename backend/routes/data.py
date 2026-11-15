import mimetypes
from collections.abc import Iterator
from pathlib import PurePosixPath
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from google.api_core.exceptions import Forbidden, GoogleAPICallError, NotFound
from google.auth.exceptions import DefaultCredentialsError

from backend.models.data import GCSObjectMetadata, GCSObjectPage
from backend.services.gcs import get_allowed_prefixes, get_bucket, get_bucket_name

router = APIRouter()
MAX_PAGE_SIZE = 500
GCS_LIST_FIELDS = "items(name,size,updated,contentType,md5Hash),nextPageToken"


def _validate_object_prefix(value: str, *, is_object: bool) -> str:
    normalized = value.strip()
    if (
        not normalized
        or normalized.startswith("/")
        or "\\" in normalized
        or any(part in {".", ".."} for part in normalized.split("/"))
    ):
        raise HTTPException(status_code=400, detail="Invalid GCS object path or prefix.")

    if is_object and normalized.endswith("/"):
        raise HTTPException(status_code=400, detail="An object path must identify a file.")

    candidate = normalized if normalized.endswith("/") else f"{normalized}/"
    if not any(candidate.startswith(allowed) for allowed in get_allowed_prefixes()):
        raise HTTPException(status_code=400, detail="The requested GCS prefix is not allowed.")

    return candidate if not is_object else normalized


def _translate_gcs_error(error: Exception) -> HTTPException:
    if isinstance(error, DefaultCredentialsError):
        return HTTPException(
            status_code=503,
            detail="Google Cloud credentials are unavailable. Configure Application Default Credentials.",
        )
    if isinstance(error, Forbidden):
        return HTTPException(status_code=403, detail="The configured identity cannot access this bucket.")
    if isinstance(error, NotFound):
        return HTTPException(status_code=404, detail="The requested GCS object was not found.")
    if isinstance(error, GoogleAPICallError):
        return HTTPException(status_code=502, detail="Google Cloud Storage request failed.")
    if isinstance(error, ValueError):
        return HTTPException(status_code=503, detail=str(error))
    raise error


def _object_download_url(object_name: str) -> str:
    encoded_name = "/".join(quote(part, safe="") for part in object_name.split("/"))
    return f"/api/data/objects/{encoded_name}"


@router.get("/objects", response_model=GCSObjectPage)
def list_objects(
    prefix: str = Query(default="raw/", min_length=1, max_length=1024),
    page_size: int = Query(default=100, ge=1, le=MAX_PAGE_SIZE),
    page_token: str | None = Query(default=None, max_length=4096),
) -> GCSObjectPage:
    safe_prefix = _validate_object_prefix(prefix, is_object=False)
    try:
        iterator = get_bucket().list_blobs(
            prefix=safe_prefix,
            max_results=page_size,
            page_token=page_token,
            fields=GCS_LIST_FIELDS,
        )
        objects = [
            GCSObjectMetadata(
                name=blob.name,
                size_bytes=blob.size,
                updated_at=blob.updated,
                content_type=blob.content_type,
                md5_hash=blob.md5_hash,
                download_url=_object_download_url(blob.name),
            )
            for blob in iterator
        ]
        return GCSObjectPage(
            bucket=get_bucket_name(),
            prefix=safe_prefix,
            objects=objects,
            next_page_token=iterator.next_page_token,
        )
    except Exception as error:
        raise _translate_gcs_error(error) from error


@router.get("/objects/{object_name:path}")
def download_object(object_name: str) -> StreamingResponse:
    safe_name = _validate_object_prefix(object_name, is_object=True)
    try:
        blob = get_bucket().blob(safe_name)
        blob.reload()
    except Exception as error:
        raise _translate_gcs_error(error) from error

    def content_stream() -> Iterator[bytes]:
        with blob.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                yield chunk

    filename = PurePosixPath(safe_name).name
    media_type = blob.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    headers = {
        "Cache-Control": "private, no-store",
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
    }
    if blob.size is not None:
        headers["Content-Length"] = str(blob.size)

    return StreamingResponse(content_stream(), media_type=media_type, headers=headers)