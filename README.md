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

#### Private SRTM elevation overlay

The field map reads SRTM tiles from the private
`nasa_spaceapps_2026_loam` bucket through a server-only Next.js API route.
Authenticate locally with Application Default Credentials before starting the
app:

```bash
gcloud auth application-default login
npm install
npm run dev
```

The authenticated account needs read access to the bucket. The defaults can be
overridden server-side with `GOOGLE_CLOUD_PROJECT`, `SRTM_GCS_BUCKET`, and
`SRTM_GCS_PREFIX`; do not use `NEXT_PUBLIC_` variables for credentials or
bucket access.

#### Landsat true colour and NDVI

The original objects under
`raw/landsat-surface-reflectance-collection-2-level-2-ontario/` were inspected
and found to be SRTM `.hgt.zip` elevation tiles, not Landsat imagery. A bounded
sample from the real USGS Landsat 8 Collection 2 Level-2 scene
`LC08_L2SP_016028_20260923_02_T1` was therefore imported for the current field
area. Its acquisition date is September 23, 2026. The private sample includes
the original integer B2, B3, B4, B5, `QA_PIXEL`, and `QA_RADSAT` values plus a
provenance manifest.

The configured API data provider first uses that sample when it completely
covers the selected field. For any other selected polygon, the server searches
the Microsoft Planetary Computer `landsat-c2-l2` STAC collection for recent
Landsat 8 or 9 L2SP scenes, signs the required COG assets on the server, and
reads only the raster window around the field.

The server applies the Collection 2 surface-reflectance scale `0.0000275` and
offset `-0.2` exactly once. It masks fill, dilated cloud, cirrus, cloud, cloud
shadow, snow, and radiometrically saturated pixels before producing true colour
or calculating NDVI as `(NIR - red) / (NIR + red)`. Browser code receives only
a clipped PNG and summary metadata; it never receives GCS credentials, private
bucket URLs, or Planetary Computer signed asset URLs.

To recreate the private sample with Application Default Credentials and bucket
write access:

```bash
gcloud auth application-default login
npm run import:landsat-sample
```

To test the map:

1. Start the app with `npm run dev` and open `http://localhost:3000/field-info`.
2. Click inside an official field polygon.
3. Select **Satellite image** and verify that the true-colour image, acquisition
   date, average NDVI, clear-pixel and QA-masked percentages, source, and scene
   ID are displayed.
4. Select **NDVI** and verify the clipped overlay and `-1` to `1` legend appear.
5. To exercise the fallback without changing stored fields, POST an Ontario
   polygon outside the sample crop to `/api/landsat`, for example:

   ```bash
   curl -X POST http://localhost:3000/api/landsat \
     -H "Content-Type: application/json" \
     -d '{"layer":"ndvi","geometry":{"type":"Polygon","coordinates":[[[-80.01,43.20],[-79.995,43.20],[-79.995,43.21],[-80.01,43.21],[-80.01,43.20]]]}}'
   ```

   The response should report `"provider":"planetary-computer"`. If no scene
   has at least 20% clear field pixels, the API and map show a too-cloudy
   message. If a field is too small to contain a usable 30 m pixel, the API
   returns a specific message.

Server-side overrides are `LANDSAT_GCS_BUCKET` and `LANDSAT_GCS_PREFIX`.

#### Field boundaries

Field boundaries are persisted by the Next.js server in the private GCS object
`processed/fields/ontario-fields.geojson`. The browser requests them through
`/api/fields`; it never reads GCS directly. Drawing, renaming, vertex editing,
deleting, and `.geojson`, `.json`, or `.kml` uploads update the same private
object.

The current local field collection is extracted from Agriculture and Agri-Food
Canada's 2023 Ontario OneSoil GeoPackage. The complete Ontario source contains
678,096 polygons and is too large to send to the browser as one GeoJSON file,
so the checked-in extractor creates a bounded collection around the demo map.
After downloading `on_oneSoil_field_boundaries_2023.gpkg` into `data/fields/`,
regenerate and publish the collection with:

```bash
node scripts/extract-ontario-fields.mjs
npm run publish:fields
```

The extraction defaults to a 10 km window centred near Arnprior. Override it
with `ONTARIO_FIELDS_CENTER_LON`, `ONTARIO_FIELDS_CENTER_LAT`, and
`ONTARIO_FIELDS_WINDOW_KM`. The source GeoPackage and generated runtime GeoJSON
are ignored by Git because of their size and local mutability. The publish step
validates the generated collection and uploads it privately using Application
Default Credentials. A missing GCS field object is reported as an error; the
deployed app does not silently replace it with demo Plot A/Plot B boundaries.

To test locally:

1. Open `http://localhost:3000/field-info`.
2. Click **Add field**, draw at least three points, double-click to finish, name
   the field, and save it.
3. Click inside any field and verify the outline highlights, the map zooms to
   it, and the Selected field panel shows its name, area, and field ID.
4. Use **Rename**, **Edit boundary**, and **Delete** in the Selected field panel.
5. Upload a GeoJSON or KML file containing Polygon or MultiPolygon features.
6. Select **Elevation**, click a covered field, and verify the clipped elevation
   overlay and metre legend appear.

#### CanSIS regional soil suitability and soil CSV uploads

The **Productivity map** control displays regional soil-suitability polygons
prepared from AAFC CanSIS Soil Landscapes of Canada v3.2. It is intentionally
labelled **Regional soil suitability — not measured productivity** because the
source is a 1:1,000,000 regional inventory, not a field soil test and not a
yield/productivity model.

The private source remains in
`raw/cansis-soil-landscapes-canada-v3-2/`. A one-time server-side preparation
script downloads only the required shapefile and join tables, filters Ontario
components, reprojects NAD83 (EPSG:4269) to EPSG:4326, calculates top-20-cm and
component-percentage-weighted attributes, simplifies the polygons, and writes
the result to the private object
`processed/cansis-slc-v3-2/ontario-regions.geojson`:

```bash
gcloud auth application-default login
npm install
npm run prepare:soil-regions
```

The authenticated identity needs read access to the raw prefix and write
access to the processed prefix. At runtime it needs read access to the
processed object. CSV uploads need write access to `uploads/soil-csv/`. These
settings are server-side only and can be overridden with `SOIL_GCS_BUCKET`,
`CANSIS_SOURCE_PREFIX`, `CANSIS_PROCESSED_OBJECT`, and `SOIL_UPLOAD_PREFIX`.
Never use `NEXT_PUBLIC_` for these values or for credentials.

To test locally:

1. Run `npm run dev`, open `http://localhost:3000/field-info`, and select
   **Productivity map**.
2. Switch among corn, soybean, winter wheat, canola, and forage. Verify that the
   regional polygon colours and ratings update and that the legend includes
   Good, Moderate, Limited and Insufficient data.
3. Click a coloured region and verify texture percentages, pH, drainage,
   organic carbon, rooting depth, limiting factors, components, source, and the
   regional-estimate note appear.
4. Select **Ontario Field 565252** to exercise a known field crossing two SLC
   regions. The current prepared data reports approximately 94.5% in polygon
   545005 and 5.5% in polygon 545004; percentages may change only if the source
   or field boundary is regenerated.
5. Click **Upload soil data**, select a `.csv` no larger than 10 MB, and verify
   progress followed by a success message. A non-CSV file, missing credentials,
   or missing bucket write permission must show an error and must not report a
   successful upload.

If a OneDrive-synced checkout fails with an `EINVAL readlink` error in `.next`,
use a separate ignored build cache in PowerShell:

```powershell
$env:NEXT_DIST_DIR = ".next-dev"
npm run dev
```

The suitability rules and official source URLs live in
`lib/soil/suitability.ts`. No official crop-specific LSRS rating table was
present in the bucket, so the app does not claim these categories are LSRS.

#### Public deployment with private map data

The public website can display all map layers while the bucket remains private.
Deploy the **Next.js application**, not only the FastAPI `Dockerfile`, because
the field, elevation, Landsat, soil-region, and soil-upload endpoints are
Next.js server routes. Copy `.env.example` into the hosting provider's
configuration and set the values there; do not commit a populated `.env` file.

For Google Cloud Run, attach a service account to the Next.js service and grant
it the minimum required bucket permissions. Application Default Credentials are
then automatic. For Vercel or another non-Google host, add either
`GCP_SERVICE_ACCOUNT_JSON` or `GCP_SERVICE_ACCOUNT_JSON_BASE64` as a protected
server-only secret. Never name either variable with `NEXT_PUBLIC_`.

The runtime identity needs:

- read access to the SRTM and Landsat raw prefixes;
- read access to `processed/cansis-slc-v3-2/ontario-regions.geojson`;
- read/write access to `processed/fields/ontario-fields.geojson` if public users
  may add, edit, or delete shared fields;
- write access to `uploads/soil-csv/` if CSV upload is enabled.

Before deployment, run `npm run publish:fields` once from an authenticated
machine. A Mapbox token only renders the basemap and does not grant GCS access.
After deploying, verify `/api/fields` returns the real field collection and test
Elevation, Satellite image, NDVI, and Productivity map from `/field-info`.

`Dockerfile.frontend` builds the public Next.js service, including all map data
routes. The existing `Dockerfile` remains the separate FastAPI backend. For a
container deployment, pass the public Mapbox token at build time and provide
Google credentials only to the running service:

```bash
docker build -f Dockerfile.frontend \
  --build-arg NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN="$NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN" \
  -t loam-frontend .
docker run --rm -p 8080:8080 \
  -e GOOGLE_CLOUD_PROJECT=nasa-spaceapps-2026 \
  -e GCS_BUCKET_NAME=nasa_spaceapps_2026_loam \
  -e GCP_SERVICE_ACCOUNT_JSON_BASE64="$GCP_SERVICE_ACCOUNT_JSON_BASE64" \
  loam-frontend
```

On Cloud Run, omit the service-account JSON variable and attach the authorized
service account to the service instead. On Vercel, configure the Mapbox token as
a build/public environment variable and the GCP credential as a protected
server-only environment variable.

### Backend

Requires Python 3.10 or later.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

The API health check is available at http://localhost:8000/health.
Crop classification can optionally use Gemini to suggest a botanical family and
relative crop-water-demand category. Configure `GEMINI_API_KEY` in the backend
process environment only; never put it in `app/.env.local` or a
`NEXT_PUBLIC_` variable. `GEMINI_MODEL` optionally selects the model and
defaults to `gemini-2.5-flash`. Without a key, or if the Gemini request fails,
the API uses its local crop reference and leaves unknown crops available for
manual family selection. These water-demand categories are broad crop
references, not field irrigation-volume predictions.

For local development, export the key in the shell before starting FastAPI:

```bash
export GEMINI_API_KEY="your-key"
export GEMINI_MODEL="gemini-2.5-flash"
uvicorn backend.main:app --reload
```

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
