import os
from functools import lru_cache

from google.cloud import storage

DEFAULT_BUCKET_NAME = "nasa_spaceapps_2026_loam"
DEFAULT_ALLOWED_PREFIXES = ("raw/", "processed/", "catalogs/")


def get_bucket_name() -> str:
    return os.environ.get("GCS_BUCKET_NAME", DEFAULT_BUCKET_NAME).strip()


def get_allowed_prefixes() -> tuple[str, ...]:
    configured = os.environ.get("GCS_ALLOWED_PREFIXES")
    if configured is None:
        return DEFAULT_ALLOWED_PREFIXES

    prefixes = tuple(
        f"{item.strip().strip('/')}/"
        for item in configured.split(",")
        if item.strip().strip("/")
    )
    return prefixes


@lru_cache(maxsize=1)
def get_storage_client() -> storage.Client:
    return storage.Client()


def get_bucket() -> storage.Bucket:
    bucket_name = get_bucket_name()
    if not bucket_name:
        raise ValueError("GCS_BUCKET_NAME must not be empty.")
    return get_storage_client().bucket(bucket_name)