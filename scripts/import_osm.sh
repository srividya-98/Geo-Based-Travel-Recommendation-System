#!/bin/bash
#
# Import OSM PBF data into PostGIS using osm2pgsql flex output.
#
# Usage:
#   ./import_osm.sh europe/spain
#   ./import_osm.sh europe-spain  (filename format also works)
#
# This script is designed to run inside the osm2pgsql Docker container.

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check arguments
if [ -z "$1" ]; then
    echo "Usage: $0 <region>"
    echo ""
    echo "Examples:"
    echo "  $0 europe/spain"
    echo "  $0 europe-spain"
    echo "  $0 asia/japan"
    echo ""
    echo "The region should match the downloaded PBF filename."
    exit 1
fi

REGION="$1"
# Convert region path to filename format (europe/spain -> europe-spain)
FILENAME=$(echo "$REGION" | tr '/' '-')

# Paths
OSM_DATA_DIR="/osm-data"
SCRIPTS_DIR="/scripts"
PBF_FILE="${OSM_DATA_DIR}/${FILENAME}.osm.pbf"
STYLE_FILE="${SCRIPTS_DIR}/poi_style.lua"

# Database connection (from environment)
DB_HOST="${PGHOST:-postgis}"
DB_PORT="${PGPORT:-5432}"
DB_NAME="${PGDATABASE:-travel_agent}"
DB_USER="${PGUSER:-travel_user}"

log_info "=========================================="
log_info "OSM POI Import Script"
log_info "=========================================="
log_info "Region: $REGION"
log_info "PBF File: $PBF_FILE"
log_info "Database: $DB_NAME@$DB_HOST:$DB_PORT"
log_info ""

# Check if PBF file exists
if [ ! -f "$PBF_FILE" ]; then
    log_error "PBF file not found: $PBF_FILE"
    log_info "Available files in $OSM_DATA_DIR:"
    ls -la "$OSM_DATA_DIR"/*.pbf 2>/dev/null || echo "  No .pbf files found"
    echo ""
    log_info "Download the region first:"
    log_info "  python scripts/download_geofabrik.py $REGION"
    exit 1
fi

# Check if style file exists
if [ ! -f "$STYLE_FILE" ]; then
    log_error "Style file not found: $STYLE_FILE"
    exit 1
fi

# Get file size
FILE_SIZE=$(du -h "$PBF_FILE" | cut -f1)
log_info "PBF file size: $FILE_SIZE"

# Wait for database to be ready
log_info "Waiting for database to be ready..."
for i in {1..30}; do
    if pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
        log_info "Database is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        log_error "Database connection timeout after 30 seconds"
        exit 1
    fi
    sleep 1
done

# Record start time
START_TIME=$(date +%s)
log_info "Starting import at $(date)"

# Update region status to 'importing'
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    INSERT INTO poi.regions (region_name, pbf_filename, import_started_at, status)
    VALUES ('$REGION', '$FILENAME.osm.pbf', NOW(), 'importing')
    ON CONFLICT (region_name) DO UPDATE SET
        import_started_at = NOW(),
        status = 'importing';
" 2>/dev/null || log_warn "Could not update region status (table may not exist yet)"

# Drop existing osm_pois table to allow re-import
log_info "Dropping existing osm_pois table (if any)..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    DROP TABLE IF EXISTS public.osm_pois CASCADE;
" 2>/dev/null || true

# Run osm2pgsql with flex output
log_info "Running osm2pgsql..."
log_info "This may take a while depending on region size..."
echo ""

osm2pgsql \
    --create \
    --output=flex \
    --style="$STYLE_FILE" \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --database="$DB_NAME" \
    --user="$DB_USER" \
    --cache=1000 \
    --number-processes=2 \
    --log-progress=true \
    "$PBF_FILE"

echo ""
log_info "osm2pgsql completed!"

# Count imported POIs
POI_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT COUNT(*) FROM public.osm_pois;
" | tr -d ' ')

log_info "Imported $POI_COUNT POIs"

# Show category breakdown
log_info "Category breakdown:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT category, subcategory, COUNT(*) as count
    FROM public.osm_pois
    GROUP BY category, subcategory
    ORDER BY category, count DESC;
"

# Create spatial index
log_info "Creating spatial index..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    CREATE INDEX IF NOT EXISTS idx_osm_pois_geom ON public.osm_pois USING GIST (geom);
    CREATE INDEX IF NOT EXISTS idx_osm_pois_category ON public.osm_pois (category);
    CREATE INDEX IF NOT EXISTS idx_osm_pois_name ON public.osm_pois USING gin (name gin_trgm_ops);
    ANALYZE public.osm_pois;
"

# Update region status
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    UPDATE poi.regions
    SET import_completed_at = NOW(),
        place_count = $POI_COUNT,
        status = 'completed',
        bbox = (SELECT ST_Envelope(ST_Collect(geom)) FROM public.osm_pois)
    WHERE region_name = '$REGION';
" 2>/dev/null || log_warn "Could not update region status"

log_info "=========================================="
log_info "Import completed successfully!"
log_info "=========================================="
log_info "Region: $REGION"
log_info "POIs imported: $POI_COUNT"
log_info "Duration: ${DURATION}s"
log_info ""
log_info "Next steps:"
log_info "  1. Run the Next.js app: npm run dev"
log_info "  2. Search for places - they'll come from your local DB!"
