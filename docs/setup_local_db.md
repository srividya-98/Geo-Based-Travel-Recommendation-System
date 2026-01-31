# Setting Up the Local POI Database

This guide walks you through setting up a local PostgreSQL/PostGIS database with OSM data for fast, reliable POI queries.

## Prerequisites

- **Docker** and **Docker Compose** installed
- **Python 3.8+** (for download script)
- **10-50 GB disk space** (depends on regions you import)
- **4+ GB RAM** for imports

## Quick Start

```bash
# 1. Start PostgreSQL with PostGIS
cd infra
docker compose up -d postgis

# 2. Wait for database to be ready (check logs)
docker compose logs -f postgis

# 3. Download a region (e.g., Spain)
cd ../scripts
python download_geofabrik.py spain

# 4. Import the data
cd ../infra
docker compose --profile import run osm2pgsql /scripts/import_osm.sh europe/spain

# 5. Verify the import
docker compose exec postgis psql -U travel_user -d travel_agent -c "SELECT category, COUNT(*) FROM public.osm_pois GROUP BY category;"
```

## Detailed Steps

### Step 1: Start the Database

```bash
cd infra
docker compose up -d postgis
```

This starts:
- PostgreSQL 16 with PostGIS 3.4
- Persistent data volume
- Health checks enabled

Check it's running:
```bash
docker compose ps
docker compose logs postgis
```

### Step 2: Download OSM Data

Use our download script to fetch regional extracts from Geofabrik:

```bash
cd scripts
python download_geofabrik.py <region>
```

**Examples:**
```bash
# Popular regions (shortcuts)
python download_geofabrik.py spain        # Europe/Spain
python download_geofabrik.py uk           # UK
python download_geofabrik.py japan        # Asia/Japan
python download_geofabrik.py california   # US/California

# Full paths
python download_geofabrik.py europe/france
python download_geofabrik.py asia/india
python download_geofabrik.py north-america/us/new-york

# List available shortcuts
python download_geofabrik.py --help
```

The script:
- Downloads `.osm.pbf` file to `data/osm/`
- Verifies MD5 checksum
- Shows download progress

**File sizes (approximate):**
| Region | Size |
|--------|------|
| Spain | ~1.2 GB |
| UK | ~1.5 GB |
| France | ~4.5 GB |
| Germany | ~3.8 GB |
| Japan | ~2.1 GB |
| California | ~1.1 GB |
| New York | ~300 MB |

### Step 3: Import into PostGIS

Run the import using osm2pgsql:

```bash
cd infra
docker compose --profile import run osm2pgsql /scripts/import_osm.sh <region>
```

**Examples:**
```bash
# Match the region name used in download
docker compose --profile import run osm2pgsql /scripts/import_osm.sh europe/spain
docker compose --profile import run osm2pgsql /scripts/import_osm.sh europe-spain  # Also works
```

The import:
1. Reads the PBF file
2. Extracts POIs matching our categories
3. Creates spatial indexes
4. Reports category breakdown

**Import times (approximate):**
| Region | POIs | Time |
|--------|------|------|
| Spain | ~150k | 2-5 min |
| France | ~300k | 5-10 min |
| Japan | ~250k | 4-8 min |

### Step 4: Verify the Import

Check POI counts:
```bash
docker compose exec postgis psql -U travel_user -d travel_agent -c "
SELECT category, subcategory, COUNT(*) as count
FROM public.osm_pois
GROUP BY category, subcategory
ORDER BY category, count DESC;
"
```

Check imported regions:
```bash
docker compose exec postgis psql -U travel_user -d travel_agent -c "
SELECT region_name, place_count, status, import_completed_at
FROM poi.regions;
"
```

Test a radius query:
```bash
# Madrid city center (40.4168, -3.7038)
docker compose exec postgis psql -U travel_user -d travel_agent -c "
SELECT name, category, ST_Distance(
  geom::geography,
  ST_SetSRID(ST_MakePoint(-3.7038, 40.4168), 4326)::geography
) as distance_m
FROM public.osm_pois
WHERE ST_DWithin(
  geom::geography,
  ST_SetSRID(ST_MakePoint(-3.7038, 40.4168), 4326)::geography,
  1000
)
ORDER BY distance_m
LIMIT 10;
"
```

## Importing Multiple Regions

You can import multiple regions into the same database:

```bash
python download_geofabrik.py spain
python download_geofabrik.py france
python download_geofabrik.py italy

cd ../infra
docker compose --profile import run osm2pgsql /scripts/import_osm.sh europe/spain
docker compose --profile import run osm2pgsql /scripts/import_osm.sh europe/france
docker compose --profile import run osm2pgsql /scripts/import_osm.sh europe/italy
```

Note: Each import replaces the `osm_pois` table. For multiple regions, you'd need to modify the import script to append rather than replace.

## Updating Data

To refresh data for a region:

```bash
# Re-download (will show if file exists)
python download_geofabrik.py spain --force

# Re-import
docker compose --profile import run osm2pgsql /scripts/import_osm.sh europe/spain
```

Geofabrik updates daily, so monthly refreshes are usually sufficient.

## Troubleshooting

### "PBF file not found"

Make sure you downloaded the file first:
```bash
ls -la data/osm/
python download_geofabrik.py spain
```

### "Database connection refused"

Check if PostgreSQL is running:
```bash
docker compose ps
docker compose logs postgis
```

### "Import fails with memory error"

Increase Docker memory limit or reduce osm2pgsql cache:
```bash
# Edit import_osm.sh, change:
osm2pgsql ... --cache=500  # Reduce from 1000
```

### "Slow queries after import"

Run VACUUM ANALYZE:
```bash
docker compose exec postgis psql -U travel_user -d travel_agent -c "VACUUM ANALYZE public.osm_pois;"
```

## Database Connection Details

For connecting from your app:

| Setting | Value |
|---------|-------|
| Host | `localhost` |
| Port | `5432` |
| Database | `travel_agent` |
| User | `travel_user` |
| Password | `travel_secret_2024` |

**Environment variables:**
```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=travel_agent
POSTGRES_USER=travel_user
POSTGRES_PASSWORD=travel_secret_2024
```

## Production Considerations

1. **Change the password** in `docker-compose.yml`
2. **Enable SSL** for external connections
3. **Set up backups** of the data volume
4. **Monitor disk space** - indexes can grow large
5. **Consider read replicas** for high traffic

---

**Next:** Read about [data sources](./data_sources.md) for attribution requirements.
