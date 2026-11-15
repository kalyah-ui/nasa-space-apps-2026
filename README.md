# loam
### The dirt on your dirt.

loam helps farmers and future landowners evaluate land, understand field conditions, compare crop rotations, and explore long-term resilience using Earth observation and agricultural data.

## Repository Layout

- `app/`: Next.js App Router pages for the dashboard and core workflows.
- `components/`: Shared layout, map, chart, card, and UI components.
- `backend/`: FastAPI application and API routes.
- `data/`: NASA, USDA, and processed datasets (local data files are not committed).
- `lib/`: Dataset catalog, maps, scoring, and recommendation logic.
- `scripts/`: Data acquisition and processing jobs.
- `assets/`: Project images, icons, and demo media.
- `docs/`: Dataset notes, scoring methodology, project plan, and story.

See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for the feature and team ownership overview.

## Getting Started

### Frontend

Requires Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### Backend

Requires Python 3.10 or later.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

The API health check is available at http://localhost:8000/health.

## Accessing shared Earth-observation data

After datasets have been uploaded, team members can browse or download them
from the private Google Cloud Storage bucket. The current bucket name is
`nasa_spaceapps_2026_loam`; confirm the bucket and object paths with the data
lead before using them. Files are not available here until they have actually
been uploaded.

### Access with the Google Cloud CLI

Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), then
sign in with an account that has **Storage Object Viewer** access to the
bucket:

```bash
gcloud auth login
gcloud storage ls gs://nasa_spaceapps_2026_loam/raw/
```

For example, to copy the daily IMERG files for 2020 to the local `data/`
directory:

```bash
gcloud storage cp --recursive \
  gs://nasa_spaceapps_2026_loam/raw/gpm-imerg-final/v07/daily/2020/ \
  ./data/imerg/daily/2020/
```

Only copy the dataset and time range needed for your task. Cloud Storage
access, downloads, and storage may incur charges on the bucket's billing
account; check with the data lead before retrieving large datasets.

### Read a NetCDF4 file with Python

For local Python access, install the libraries and authenticate with
Application Default Credentials:

```bash
python -m pip install google-cloud-storage netCDF4
gcloud auth application-default login
```

Download a specific object and inspect its precipitation variable:

```python
from pathlib import Path

import netCDF4
from google.cloud import storage

bucket_name = "nasa_spaceapps_2026_loam"
object_name = (
    "raw/gpm-imerg-final/v07/daily/2020/"
    "REPLACE_WITH_THE_ORIGINAL_NASA_GRANULE_FILENAME.nc4"
)
local_path = Path("data/imerg") / Path(object_name).name
local_path.parent.mkdir(parents=True, exist_ok=True)

storage_client = storage.Client()
storage_client.bucket(bucket_name).blob(object_name).download_to_filename(
    str(local_path)
)

with netCDF4.Dataset(str(local_path)) as dataset:
    precipitation = dataset.variables["precipitation"]
    print("Units:", getattr(precipitation, "units", "not specified"))
    print("Shape:", precipitation.shape)
    print("Values:", precipitation[:])
```

Check each product's metadata, units, time range, coordinate system, and
missing-value conventions before using it in a score. NetCDF files may contain
variables beyond precipitation; inspect the file rather than assuming all
products have the same schema.

Applications running in Google Cloud should use their attached service
account or workload identity for server-side bucket access. Do not make the
bucket public, put credentials in the frontend, or commit service-account key
files or Earthdata credentials.

### Application data API

The FastAPI backend lists and streams objects from the approved `raw/`,
`processed/`, and `catalogs/` prefixes. It uses Application Default Credentials
on a developer machine and the attached service identity when deployed. Start
the backend with:

```bash
gcloud auth application-default login
export GCS_BUCKET_NAME=nasa_spaceapps_2026_loam
uvicorn backend.main:app --reload
```

Browse a bounded page of raw objects at
`http://localhost:8000/api/data/objects?prefix=raw/&page_size=100`. Follow
`next_page_token` to request another page. Each object includes a
`download_url`; downloads are streamed through the backend so Google Cloud
credentials stay server-side. The API supports `GCS_ALLOWED_PREFIXES` as a
comma-separated allowlist and `FRONTEND_ORIGINS` as a comma-separated CORS
allowlist. Set `NEXT_PUBLIC_DATA_API_URL` to the backend origin when the
frontend and API are not both running on localhost.

The object API exposes stored files but does not yet decode raw NetCDF, raster,
or STAC assets into field-layer samples. Keep `NEXT_PUBLIC_DATA_PROVIDER=mock`
until a dataset-specific adapter and its spatial/temporal semantics are
validated.

### STAC catalogs and file naming

A STAC catalog is a metadata index with links to assets; it is not the data
itself. Harmony-generated catalogs can point to temporary output URLs that
expire. Preserve the catalog as provenance, but make sure the team's durable
catalog points to the GCS objects where the actual data is stored.

Keep original NASA granule filenames unchanged because they encode source
product and acquisition date. Use descriptive prefixes to distinguish source
data, derived data, and catalog metadata:

```text
raw/gpm-imerg-final/v07/daily/<year>/<original-nasa-granule-filename>.nc4
processed/precipitation/daily/<region>/<year>/<derived-file>
catalogs/gpm-imerg-final/v07/<descriptive-catalog-name>.stac.json
```

When naming a catalog, describe its product, resolution or cadence, geographic
extent, and date range. Make sure its item links and asset links remain valid
after moving or renaming it, and verify actual item coverage before treating
the catalog as complete.