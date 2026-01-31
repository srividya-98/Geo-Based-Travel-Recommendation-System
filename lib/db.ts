/**
 * Database connection and query utilities for PostGIS.
 * 
 * This module provides a connection pool and helper functions
 * for querying the local POI database.
 */

import { Pool, PoolConfig, QueryResult } from 'pg';

// Database configuration from environment variables
const dbConfig: PoolConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'travel_agent',
  user: process.env.POSTGRES_USER || 'travel_user',
  password: process.env.POSTGRES_PASSWORD || 'travel_secret_2024',
  max: 10, // Maximum connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// Singleton pool instance
let pool: Pool | null = null;

/**
 * Get the database connection pool (lazy initialization).
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(dbConfig);
    
    // Log connection errors
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err);
    });
  }
  return pool;
}

/**
 * Check if database is available and has POI data.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  // Skip database check if pg module fails to load
  if (!pool) {
    try {
      getPool();
    } catch (error) {
      console.warn('[DB] Failed to initialize pool:', error instanceof Error ? error.message : error);
      return false;
    }
  }
  
  try {
    const p = getPool();
    const result = await p.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'osm_pois') as exists"
    );
    return result.rows[0]?.exists === true;
  } catch (error) {
    // Don't spam console - database not running is expected without Docker
    if (process.env.NODE_ENV === 'development') {
      console.log('[DB] Database not available, using Overpass API fallback');
    }
    return false;
  }
}

/**
 * Get POI count from database.
 */
export async function getPoiCount(): Promise<number> {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT COUNT(*) as count FROM public.osm_pois');
    return parseInt(result.rows[0]?.count || '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Raw POI data from database.
 */
export interface DbPoi {
  osm_id: string;
  osm_type: string;
  name: string;
  category: string;
  subcategory: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
  distance_meters?: number;
}

/**
 * Query POIs within radius of a point.
 */
export async function queryPoisInRadius(
  lat: number,
  lon: number,
  radiusMeters: number,
  category: string,
  limit: number = 200
): Promise<DbPoi[]> {
  const pool = getPool();
  
  const query = `
    SELECT 
      osm_id::text,
      osm_type,
      name,
      category,
      subcategory,
      ST_Y(geom) as lat,
      ST_X(geom) as lon,
      tags,
      ST_Distance(
        geom::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      ) as distance_meters
    FROM public.osm_pois
    WHERE category = $3
      AND ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $4
      )
    ORDER BY distance_meters ASC
    LIMIT $5
  `;
  
  const result = await pool.query<DbPoi>(query, [lat, lon, category, radiusMeters, limit]);
  return result.rows;
}

/**
 * Query all categories within radius (for map display).
 */
export async function queryAllPoisInRadius(
  lat: number,
  lon: number,
  radiusMeters: number,
  limit: number = 200
): Promise<DbPoi[]> {
  const pool = getPool();
  
  const query = `
    SELECT 
      osm_id::text,
      osm_type,
      name,
      category,
      subcategory,
      ST_Y(geom) as lat,
      ST_X(geom) as lon,
      tags,
      ST_Distance(
        geom::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      ) as distance_meters
    FROM public.osm_pois
    WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3
      )
    ORDER BY distance_meters ASC
    LIMIT $4
  `;
  
  const result = await pool.query<DbPoi>(query, [lat, lon, radiusMeters, limit]);
  return result.rows;
}

/**
 * Get region info from database.
 */
export interface RegionInfo {
  region_name: string;
  place_count: number;
  status: string;
  import_completed_at: Date | null;
}

export async function getImportedRegions(): Promise<RegionInfo[]> {
  try {
    const pool = getPool();
    const result = await pool.query<RegionInfo>(`
      SELECT region_name, place_count, status, import_completed_at
      FROM poi.regions
      WHERE status = 'completed'
      ORDER BY place_count DESC
    `);
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * Close the database pool (for cleanup).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
