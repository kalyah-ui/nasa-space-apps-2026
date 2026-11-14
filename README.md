# Farmish
### The dirt on your dirt.

Farmish helps farmers and future landowners evaluate land, understand field conditions, compare crop rotations, and explore long-term resilience using Earth observation and agricultural data.

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