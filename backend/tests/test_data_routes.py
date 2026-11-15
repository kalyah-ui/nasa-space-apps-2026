import asyncio
import io
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import HTTPException

from backend.routes.data import download_object, list_objects


class FakeBlob:
    def __init__(self, name: str, content: bytes = b"sample-data") -> None:
        self.name = name
        self.size = len(content)
        self.updated = datetime(2026, 11, 14, tzinfo=timezone.utc)
        self.content_type = "application/octet-stream"
        self.md5_hash = "sample-md5"
        self._content = content

    def reload(self) -> None:
        return None

    def open(self, mode: str) -> io.BytesIO:
        if mode != "rb":
            raise ValueError("FakeBlob only supports binary reads.")
        return io.BytesIO(self._content)


class FakeBlobIterator:
    def __init__(self, blobs: list[FakeBlob], next_page_token: str | None) -> None:
        self._blobs = blobs
        self.next_page_token = next_page_token

    def __iter__(self):
        return iter(self._blobs)


class FakeBucket:
    def __init__(self, blobs: list[FakeBlob]) -> None:
        self._blobs = {blob.name: blob for blob in blobs}
        self.list_call: dict[str, object] | None = None

    def list_blobs(self, **kwargs: object) -> FakeBlobIterator:
        self.list_call = kwargs
        prefix = str(kwargs["prefix"])
        page_size = int(kwargs["max_results"])
        matches = [blob for name, blob in self._blobs.items() if name.startswith(prefix)]
        return FakeBlobIterator(matches[:page_size], "next-token" if len(matches) > page_size else None)

    def blob(self, name: str) -> FakeBlob:
        return self._blobs[name]


class DataRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.bucket = FakeBucket(
            [
                FakeBlob("raw/gpm/day-1.nc4"),
                FakeBlob("raw/gpm/day-2.nc4"),
                FakeBlob("processed/precipitation/daily.json"),
            ]
        )

    @patch("backend.routes.data.get_bucket_name", return_value="test-bucket")
    @patch("backend.routes.data.get_bucket")
    def test_list_objects_returns_metadata_and_pagination(
        self, get_bucket_mock, _get_bucket_name_mock
    ) -> None:
        get_bucket_mock.return_value = self.bucket

        page = list_objects(prefix="raw", page_size=1, page_token=None)

        self.assertEqual(page.bucket, "test-bucket")
        self.assertEqual(page.prefix, "raw/")
        self.assertEqual([item.name for item in page.objects], ["raw/gpm/day-1.nc4"])
        self.assertEqual(page.objects[0].download_url, "/api/data/objects/raw/gpm/day-1.nc4")
        self.assertEqual(page.next_page_token, "next-token")
        self.assertEqual(self.bucket.list_call["prefix"], "raw/")

    @patch("backend.routes.data.get_bucket")
    def test_list_objects_rejects_unapproved_prefix_before_gcs_access(self, get_bucket_mock) -> None:
        with self.assertRaises(HTTPException) as raised:
            list_objects(prefix="private/", page_size=100, page_token=None)

        self.assertEqual(raised.exception.status_code, 400)
        get_bucket_mock.assert_not_called()

    @patch("backend.routes.data.get_bucket")
    def test_download_streams_object_content(self, get_bucket_mock) -> None:
        get_bucket_mock.return_value = self.bucket

        response = download_object("raw/gpm/day-1.nc4")
        content = asyncio.run(self._read_response(response))

        self.assertEqual(content, b"sample-data")
        self.assertEqual(response.media_type, "application/octet-stream")
        self.assertIn("attachment", response.headers["content-disposition"])
        self.assertEqual(response.headers["content-length"], str(len(content)))

    @patch("backend.routes.data.get_bucket")
    def test_download_rejects_path_traversal(self, get_bucket_mock) -> None:
        with self.assertRaises(HTTPException) as raised:
            download_object("raw/../secrets.json")

        self.assertEqual(raised.exception.status_code, 400)
        get_bucket_mock.assert_not_called()

    async def _read_response(self, response) -> bytes:
        return b"".join([chunk async for chunk in response.body_iterator])


if __name__ == "__main__":
    unittest.main()