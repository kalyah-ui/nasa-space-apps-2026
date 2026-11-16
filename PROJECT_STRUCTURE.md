# Loam
### The Dirt on Your Dirt.

NASA Space Apps Challenge project

---

# Vision

loam helps farmers and landowners answer:

> Is this land suitable for my goals today?

Using NASA Earth observation data, agricultural datasets, and explainable recommendations, loam helps users:

1. Evaluate farmland before purchase
2. Understand current field conditions
3. Compare crop rotation strategies
4. Understand local environmental risks

---

# Core Features

## 1. Farm Discovery

Evaluate potential farmland.

Outputs:

- Overall farm score
- Soil score
- Water availability score
- Flood risk
- Erosion risk
- Heat risk
- Recommended crops
- Unsuitable crops

Datasets:

- SMAP
- GPM
- SRTM
- SSURGO
- PRISM
- POWER
- CDL

---

## 2. Field Info

View current field insights.

Outputs:

- Current soil moisture
- Recent rainfall
- Vegetation health
- Terrain information
- Historical trends

Datasets:

- SMAP
- GPM
- Landsat
- MODIS
- SRTM

---

## 3. Rotation Planner

Compare multiple rotation strategies.

Options:

- Current rotation
- Profit-focused
- Water conservation
- Soil regeneration

Outputs:

- Water usage
- Soil health impact
- Resilience score
- Market viability

Datasets:

- SMAP
- GPM
- POWER
- CropScape
- USDA Market News

---

# Team Structure

## Arabella
### Data Acquisition Lead

Responsibilities:

- NASA APIs
- USDA datasets
- Data processing
- Data cleaning

Owns:

/data
/scripts
/api/data

---

## Salma
### Frontend Lead

Responsibilities:

- UI/UX
- Navigation
- Components
- Dashboard pages

Owns:

/app
/components
/styles

---

## Armeena
### GIS & Mapping Lead

Responsibilities:

- Mapbox
- Parcel boundaries
- Layer overlays
- Farm comparison tools

Owns:

/components/map
/lib/maps

---

## Kalyah
### Scoring & Recommendation Lead

Responsibilities:

- Farm score calculations
- Crop recommendations
- Rotation scoring

Owns:

/lib/scoring
/lib/recommendations

---

## Safeyyah
### Visualization Lead

Responsibilities:

- Graphs
- Charts
- Trend visualizations
- Scenario comparisons

Owns:

/components/charts

---

## Lana
### Storytelling & Demo Lead

Responsibilities:

- Farmer interview
- Demo script
- Competition submission
- Video editing
- Create slides

Owns:

/assets/video
/docs/story

---

# Suggested Tech Stack

Frontend:

- Next.js
- React
- TypeScript
- Tailwind CSS

Maps:

- Mapbox GL
or
- Leaflet

Backend:

- FastAPI

Data Processing:

- Python
- Pandas
- GeoPandas
- Rasterio
- NumPy

Charts:

- Recharts
or
- Chart.js

Deployment:

- Vercel
- Render

---

# Initial File Structure

loam/
│
├── app/
│   ├── page.tsx
│   ├── discovery/
│   │   └── page.tsx
│   ├── field-info/
│   │   └── page.tsx
│   ├── rotation-planner/
│   │   └── page.tsx
│
├── components/
│   ├── layout/
│   ├── map/
│   ├── charts/
│   ├── cards/
│   └── ui/
│
├── data/
│   ├── nasa/
│   ├── usda/
│   └── processed/
│
├── api/
│   ├── data/
│   ├── scoring/
│   └── recommendations/
│
├── backend/
│   ├── services/
│   ├── models/
│   ├── routes/
│   └── utils/
│
├── lib/
│   ├── scoring/
│   ├── recommendations/
│   ├── maps/
│   └── datasets/
│
├── scripts/
│   ├── smap/
│   ├── gpm/
│   ├── power/
│   ├── prism/
│   └── ecostress/
│
├── assets/
│   ├── images/
│   ├── icons/
│   └── video/
│
├── docs/
│   ├── datasets.md
│   ├── scoring-methodology.md
│   ├── story.md
│   └── project-plan.md
│
├── public/
│
├── README.md
│
└── PROJECT_STRUCTURE.md

---

# Hackathon MVP Priorities

## Must-Have

✅ Homepage

✅ Farm Discovery

✅ Farm Score


✅ Interactive Map

✅ Local Farmer Story

---

## Nice to Have

✅ Rotation Planner

✅ Comparison Charts

✅ Market Analysis

---

## Stretch Goals

✅ Climate Analog Explorer

✅ AI Chat Assistant

✅ Advanced Scenario Modeling

---

# Demo Flow

1. Introduce a local farmer.
2. Show a real community problem.
3. Select a local farm parcel.
4. Review the farm discovery analysis.
5. Explore rotation recommendations.
6. Close with NASA data making local decisions easier.

---

# Main Pitch

loam combines Earth observations with agricultural datasets to help farmers evaluate land and compare crop rotation strategies using explainable, current-condition data.

Rather than replacing farmer expertise, loam supports better decisions through accessible, explainable environmental insights.
