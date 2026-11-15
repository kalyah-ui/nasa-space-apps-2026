from datetime import datetime

from pydantic import BaseModel


class GCSObjectMetadata(BaseModel):
    name: str
    size_bytes: int | None
    updated_at: datetime | None
    content_type: str | None
    md5_hash: str | None
    download_url: str


class GCSObjectPage(BaseModel):
    bucket: str
    prefix: str
    objects: list[GCSObjectMetadata]
    next_page_token: str | None