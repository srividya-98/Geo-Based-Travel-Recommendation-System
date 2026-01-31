-- Create spatial and other indexes for fast POI queries
-- This file runs automatically on database initialization

-- Note: Most indexes are created by import_osm.sh after data import
-- This file creates indexes for the poi.places table (alternative structure)

-- Ensure PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- If using poi.places table (alternative to osm_pois)
DO $$
BEGIN
    -- Spatial index for fast radius queries
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'poi' AND table_name = 'places') THEN
        CREATE INDEX IF NOT EXISTS idx_poi_places_geom 
            ON poi.places USING GIST (geom);
        
        -- Category index for filtering
        CREATE INDEX IF NOT EXISTS idx_poi_places_category 
            ON poi.places (category);
        
        -- Name search index (trigram for fuzzy search)
        CREATE INDEX IF NOT EXISTS idx_poi_places_name 
            ON poi.places USING gin (name gin_trgm_ops);
        
        -- Compound index for common queries
        CREATE INDEX IF NOT EXISTS idx_poi_places_cat_geom 
            ON poi.places USING GIST (geom) WHERE category IS NOT NULL;
        
        -- Tags JSONB index for flexible filtering
        CREATE INDEX IF NOT EXISTS idx_poi_places_tags 
            ON poi.places USING gin (tags);
        
        -- Vegetarian/vegan index
        CREATE INDEX IF NOT EXISTS idx_poi_places_vegetarian 
            ON poi.places (vegetarian) WHERE vegetarian IS NOT NULL;
        
        -- Region index
        CREATE INDEX IF NOT EXISTS idx_poi_places_region 
            ON poi.places (region);
    END IF;
    
    -- OpenTripMap cache indexes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'poi' AND table_name = 'opentripmap_cache') THEN
        CREATE INDEX IF NOT EXISTS idx_opentripmap_geom 
            ON poi.opentripmap_cache USING GIST (geom);
        
        CREATE INDEX IF NOT EXISTS idx_opentripmap_category 
            ON poi.opentripmap_cache (category);
        
        CREATE INDEX IF NOT EXISTS idx_opentripmap_fetched 
            ON poi.opentripmap_cache (fetched_at);
    END IF;
END $$;

-- Vacuum analyze after index creation
-- (Run manually after large data imports)
-- VACUUM ANALYZE;
