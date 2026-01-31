# Data Sources

This document explains the data sources used by the Local Travel & Restaurant Intelligence Agent.

## OpenStreetMap (OSM)

**Source**: [OpenStreetMap](https://www.openstreetmap.org/)  
**License**: [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/)

### What is OSM?

OpenStreetMap is a collaborative project to create a free editable map of the world. It's often called the "Wikipedia of maps" because anyone can contribute and edit the data.

### ODbL Attribution Requirements

When using OSM data, you must:

1. **Credit OpenStreetMap** - Display "© OpenStreetMap contributors" in your app
2. **Share-Alike** - If you enhance the data, share your improvements
3. **Keep it open** - Don't restrict others from using the data

Our app includes proper attribution in the map footer and data source indicators.

### How We Use OSM

We extract POI (Points of Interest) data from OSM regional extracts:

| Category | OSM Tags |
|----------|----------|
| Restaurant | `amenity=restaurant`, `amenity=fast_food` |
| Café | `amenity=cafe`, `amenity=bar`, `shop=coffee` |
| Grocery | `shop=supermarket`, `shop=convenience`, `shop=grocery` |
| Scenic | `tourism=attraction`, `tourism=viewpoint`, `leisure=park` |
| Indoor | `tourism=museum`, `amenity=cinema`, `amenity=theatre` |

### Data Quality

OSM data quality varies by region:

- **Excellent coverage**: Western Europe, Japan, USA, Australia
- **Good coverage**: Eastern Europe, South America, major Asian cities
- **Variable coverage**: Africa, rural areas, less-developed regions

## Geofabrik Extracts

**Source**: [Geofabrik Download Server](https://download.geofabrik.de/)  
**License**: Same as OSM (ODbL)

Geofabrik provides pre-processed regional extracts of OSM data:

- Updated daily
- Available in PBF format (efficient binary format)
- Organized by continent > country > region
- Much faster than querying the full planet file

### Available Regions

```
europe/
├── spain-latest.osm.pbf (~1.2 GB)
├── france-latest.osm.pbf (~4.5 GB)
├── germany-latest.osm.pbf (~3.8 GB)
└── ...

asia/
├── japan-latest.osm.pbf (~2.1 GB)
├── india-latest.osm.pbf (~1.0 GB)
└── ...

north-america/
├── us/
│   ├── california-latest.osm.pbf (~1.1 GB)
│   └── new-york-latest.osm.pbf (~300 MB)
└── ...
```

## Overpass API (Fallback)

**Source**: Various public endpoints  
**License**: ODbL (same data as OSM)

When local database is not available, we fall back to Overpass API:

- Real-time queries against OSM data
- Rate-limited and can be slow
- Good for development/testing
- Not recommended for production at scale

### Endpoints Used

1. `overpass.kumi.systems` (primary)
2. `overpass-api.de` (backup)
3. `maps.mail.ru` (backup)

## Nominatim (Geocoding)

**Source**: [Nominatim](https://nominatim.org/)  
**License**: ODbL

Used for:
- Converting addresses to coordinates
- Location autocomplete suggestions
- Reverse geocoding

### Usage Policy

We follow Nominatim's usage policy:
- Maximum 1 request per second
- Debounced autocomplete (350ms)
- Response caching (10-30 minutes)
- Proper User-Agent header

## Coverage Confidence

We display a "coverage confidence" indicator based on data availability:

| Level | Criteria |
|-------|----------|
| 🟢 High | 50+ POIs in 5km radius |
| 🟡 Medium | 10-50 POIs in 5km radius |
| 🔴 Low | <10 POIs in 5km radius |

Low coverage doesn't mean the area is empty—it may just have less OSM mapping activity.

## OpenTripMap (Optional Enrichment)

**Source**: [OpenTripMap](https://opentripmap.io/)  
**License**: CC BY-SA (Creative Commons Attribution-ShareAlike)

Optional enrichment for scenic/indoor categories:
- Tourist attractions database
- Wikipedia integration
- Images and descriptions

This is behind a feature flag and only used when OSM coverage is sparse.

## Data Freshness

| Source | Update Frequency |
|--------|------------------|
| Local PostGIS | When you re-import |
| Geofabrik | Daily |
| Overpass | Real-time |
| Nominatim | ~Daily |

For best results, re-import regional data monthly or when you notice significant changes.

---

**Questions?** Check the [setup guide](./setup_local_db.md) for import instructions.
