-- Initialize database with required extensions and schemas
-- This runs on first container startup

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For text search

-- Create schema for our POI data
CREATE SCHEMA IF NOT EXISTS poi;

-- Create enum types for categories
DO $$ BEGIN
    CREATE TYPE poi.category_type AS ENUM (
        'restaurant', 'cafe', 'grocery', 'scenic', 'indoor'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Main POI table
CREATE TABLE IF NOT EXISTS poi.places (
    id BIGSERIAL PRIMARY KEY,
    osm_id BIGINT NOT NULL,
    osm_type VARCHAR(10) NOT NULL, -- 'node', 'way', 'relation'
    name VARCHAR(500),
    category poi.category_type NOT NULL,
    subcategory VARCHAR(100), -- e.g., 'restaurant', 'supermarket', 'museum'
    
    -- Location
    geom GEOMETRY(Point, 4326) NOT NULL,
    lat DOUBLE PRECISION GENERATED ALWAYS AS (ST_Y(geom)) STORED,
    lon DOUBLE PRECISION GENERATED ALWAYS AS (ST_X(geom)) STORED,
    
    -- Tags (JSONB for flexible querying)
    tags JSONB DEFAULT '{}',
    
    -- Extracted common fields for fast filtering
    cuisine VARCHAR(200),
    opening_hours VARCHAR(500),
    website VARCHAR(500),
    phone VARCHAR(100),
    wheelchair VARCHAR(50),
    outdoor_seating BOOLEAN,
    vegetarian VARCHAR(50), -- 'yes', 'only', 'no'
    vegan VARCHAR(50),
    
    -- Metadata
    region VARCHAR(200), -- e.g., 'europe/spain'
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT unique_osm_place UNIQUE (osm_id, osm_type)
);

-- OpenTripMap cache table (optional enrichment)
CREATE TABLE IF NOT EXISTS poi.opentripmap_cache (
    id SERIAL PRIMARY KEY,
    xid VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(500),
    category VARCHAR(100),
    kinds VARCHAR(500), -- comma-separated kinds
    geom GEOMETRY(Point, 4326) NOT NULL,
    lat DOUBLE PRECISION GENERATED ALWAYS AS (ST_Y(geom)) STORED,
    lon DOUBLE PRECISION GENERATED ALWAYS AS (ST_X(geom)) STORED,
    description TEXT,
    wikipedia VARCHAR(500),
    image_url VARCHAR(500),
    tags JSONB DEFAULT '{}',
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Region metadata table
CREATE TABLE IF NOT EXISTS poi.regions (
    id SERIAL PRIMARY KEY,
    region_name VARCHAR(200) UNIQUE NOT NULL,
    pbf_filename VARCHAR(300),
    import_started_at TIMESTAMP WITH TIME ZONE,
    import_completed_at TIMESTAMP WITH TIME ZONE,
    place_count INTEGER DEFAULT 0,
    bbox GEOMETRY(Polygon, 4326),
    status VARCHAR(50) DEFAULT 'pending' -- 'pending', 'importing', 'completed', 'failed'
);

-- Grant permissions
GRANT USAGE ON SCHEMA poi TO travel_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA poi TO travel_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA poi TO travel_user;

-- Create indexes will be handled by create_indexes.sql after data import
