# Local Travel & Restaurant Intelligence Agent

A web application that provides personalized place recommendations based on your preferences, powered by OpenStreetMap data.

## Features

- **Smart Recommendations**: Get top 2 places ranked by distance, vibe match, and preferences
- **Interactive Map**: Leaflet-powered map with clickable markers
- **Geocoding**: Search by neighborhood (T. Nagar, Adyar, etc.)
- **Filtering**: Category (food/scenic/indoor), veg-only, walk time, vibe (calm/lively)
- **Transparent Scoring**: See why each place was recommended with score breakdown

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Map**: Leaflet + OpenStreetMap tiles
- **APIs**: Overpass API (places), Nominatim (geocoding)
- **No paid APIs**: Fully free, open-source data

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [https://travel-engine.netlify.app/](https://travel-engine.netlify.app/) in your browser.

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── places/route.ts    # Overpass API + ranking logic
│   │   └── geocode/route.ts   # Nominatim geocoding
│   ├── page.tsx               # Main UI
│   └── layout.tsx
├── components/
│   ├── map/                   # Leaflet map components
│   ├── preferences/           # Search form
│   └── results/               # Place cards with explanations
├── lib/
│   └── types.ts               # TypeScript types
└── python/                    # Decision logic prototype (see below)
```

## Decision Logic (Python Prototype)

The `python/` folder contains a standalone Python implementation of the ranking algorithm. This was used to:

- Prototype and validate the scoring logic before TypeScript implementation
- Experiment with different weights and formulas
- Serve as clear documentation of the decision-making process

The Python code mirrors the TypeScript implementation in `app/api/places/route.ts` and uses the same:
- Haversine distance formula
- Walking speed (4.5 km/h)
- Scoring weights (distance 0-50, category 0-20, vibe 0-10, veg 0-10, completeness 0-10)

To run the Python demo:

```bash
cd python
python run_demo.py
```

> **Note**: The Python code is for prototyping/validation only. The production app uses the TypeScript implementation.

## Scoring Algorithm

Places are scored on a 0-100 scale:

| Component | Max Points | Description |
|-----------|------------|-------------|
| Distance | 50 | Closer = higher (0km=50, 3km=0) |
| Category | 20 | Match with search category |
| Vibe | 10 | Calm/lively preference match |
| Veg Bonus | 10 | Vegetarian-friendly signals |
| Completeness | 10 | Has hours/website/phone |
| Open Bonus | 5 | Open 24/7 |

## API Endpoints

### GET /api/places

Search for places near a location.

```
?lat=13.08&lon=80.27&category=food&maxWalkMins=20&vegOnly=false&vibe=calm
```

Returns top 2 ranked places with scores and explanations.

### GET /api/geocode

Geocode a neighborhood name.

```
?city=Chennai&query=T.%20Nagar
```

Returns `{ lat, lon, displayName }`.

## Deploy to Vercel

The app is a standard Next.js project and runs on Vercel with no extra config.

### 1. Deploy

- Push the repo to GitHub, then connect it at [vercel.com](https://vercel.com) → **Add New Project**.
- Or use the CLI: `npm i -g vercel` then `vercel` in the project root.

### 2. Will the backend work?

**Yes, out of the box:**

- **Next.js API routes** (`/api/places`, `/api/geocode`, etc.) run as serverless functions on Vercel.
- **Overpass API** (OpenStreetMap) is called over HTTP from those functions; no extra setup.
- **Geocoding** (Nominatim) is also HTTP; it works from Vercel.
- **Map**: If you don’t set a Mapbox token, the app uses **Leaflet + OSM** and works without any map env vars.

**Optional / not required for basic use:**

| Feature | On Vercel | Notes |
|--------|-----------|--------|
| **Mapbox** | Optional | Set `NEXT_PUBLIC_MAPBOX_TOKEN` for Mapbox map; otherwise Leaflet/OSM is used. |
| **Foursquare** | Effectively off | API is deprecated (410). App falls back to Overpass. |
| **PostGIS** | Optional | Set `POSTGRES_*` if you use a DB; otherwise Overpass is used. |
| **Bayesian ranking** | Off by default | Python service does not run on Vercel. App uses TypeScript ranking. To use Bayesian, deploy the Python service elsewhere and set `BAYESIAN_API_URL` + `USE_BAYESIAN_RANKING=true`. |

### 3. Environment variables (Vercel project → Settings → Environment Variables)

- **None required** for a minimal deploy (Overpass + Leaflet/OSM + TypeScript ranking).
- **Optional:**
  - `NEXT_PUBLIC_MAPBOX_TOKEN` – Mapbox map (must start with `pk.`).
  - `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` – only if you use Postgres/PostGIS.
  - `FOURSQUARE_API_KEY` – legacy; Foursquare endpoint is deprecated.
  - `BAYESIAN_API_URL`, `USE_BAYESIAN_RANKING` – only if you deploy the Python Bayesian service elsewhere.

### 4. Timeouts

- The `/api/places` route can take 6–12s when Overpass is slow. `maxDuration` is set to 30 in the route for Vercel Pro.
- On the **Hobby (free)** plan, serverless functions are capped at **10 seconds**; slow Overpass responses may sometimes time out. If that happens, try again or use a Vercel Pro plan for a 30s limit.

## License

MIT
