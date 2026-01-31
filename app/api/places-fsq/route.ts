import { NextRequest, NextResponse } from 'next/server';
import { rankPlacesFsq, logFsqRankingDebug, FsqPlaceRaw } from '@/lib/fsq-ranking';
import { Preferences } from '@/lib/types';

// =============================================================================
// FOURSQUARE API TYPES
// =============================================================================

interface FoursquareCategory {
  id: number;
  name: string;
  short_name?: string;
  plural_name?: string;
  icon?: { prefix: string; suffix: string };
}

interface FoursquarePlace {
  fsq_id: string;
  name: string;
  geocodes: {
    main: { latitude: number; longitude: number };
    drop_off?: { latitude: number; longitude: number };
  };
  categories: FoursquareCategory[];
  location: {
    formatted_address?: string;
    address?: string;
    address_extended?: string;
    locality?: string;
    region?: string;
    country?: string;
    postcode?: string;
  };
  distance?: number;
  
  // Quality signals (may be null/undefined)
  rating?: number;         // 0-10 rating
  stats?: {
    total_ratings?: number;
    total_tips?: number;
    total_photos?: number;
  };
  popularity?: number;     // 0-1 popularity score
  price?: number;          // 1-4 price tier
  
  // Operational
  hours?: {
    open_now?: boolean;
    regular?: Array<{
      day: number;
      open: string;
      close: string;
    }>;
  };
  hours_popular?: Array<{
    day: number;
    open: string;
    close: string;
  }>;
  
  // Contact & links
  website?: string;
  tel?: string;
  email?: string;
  social_media?: {
    facebook_id?: string;
    instagram?: string;
    twitter?: string;
  };
  
  // Additional
  description?: string;
  tastes?: string[];
  features?: string[];
  verified?: boolean;
}

interface FoursquareResponse {
  results: FoursquarePlace[];
  context?: {
    geo_bounds?: {
      circle?: { center: { latitude: number; longitude: number }; radius: number };
    };
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const FOURSQUARE_API_KEY = process.env.FOURSQUARE_API_KEY;
const FOURSQUARE_API_URL = 'https://api.foursquare.com/v3/places/search';
const REQUEST_TIMEOUT = 12000;
const CACHE_TTL = 120000; // 2 minutes
const DEFAULT_RADIUS = 2000;
const MAX_RADIUS = 5000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

// Foursquare category IDs (https://docs.foursquare.com/data-products/docs/categories)
const CATEGORY_IDS: Record<string, string> = {
  restaurant: '13065',           // Restaurants
  cafe: '13032,13035',           // Coffee Shops, Cafes
  grocery: '17069,17070,17067',  // Grocery Stores, Supermarkets, Convenience Stores
  scenic: '16000,16032,16046',   // Landmarks, Parks, Gardens
  indoor: '10027,10024,12104',   // Museums, Movie Theaters, Performing Arts
};

// Fields to request from Foursquare (max quality signals)
const FSQ_FIELDS = [
  'fsq_id',
  'name',
  'geocodes',
  'categories',
  'location',
  'distance',
  'rating',
  'stats',
  'popularity',
  'price',
  'hours',
  'website',
  'tel',
  'description',
  'verified',
].join(',');

// =============================================================================
// CACHE
// =============================================================================

interface CacheEntry {
  data: FsqPlaceRaw[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function makeCacheKey(lat: number, lon: number, radius: number, category: string, vibe: string, limit: number): string {
  return `${lat.toFixed(4)}|${lon.toFixed(4)}|${radius}|${category}|${vibe}|${limit}`;
}

function getCached(key: string): FsqPlaceRaw[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: FsqPlaceRaw[]): void {
  if (cache.size > 100) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, timestamp: Date.now() });
}

// =============================================================================
// NORMALIZATION
// =============================================================================

/**
 * Normalize Foursquare place to FsqPlaceRaw format
 * Extracts all available quality signals
 */
function normalizePlace(p: FoursquarePlace): FsqPlaceRaw | null {
  if (!p.name || !p.geocodes?.main) return null;
  
  const categories = p.categories?.map(c => c.name) || [];
  const categoryIds = p.categories?.map(c => c.id) || [];
  
  // Build address string
  const address = p.location?.formatted_address 
    || [p.location?.address, p.location?.locality].filter(Boolean).join(', ')
    || '';
  
  // Get type from first category
  const type = p.categories?.[0]?.name || 'Place';
  
  return {
    fsq_id: p.fsq_id,
    name: p.name,
    lat: p.geocodes.main.latitude,
    lon: p.geocodes.main.longitude,
    distanceMeters: p.distance ?? null,
    categories,
    categoryIds,
    
    // Quality signals - preserve nulls if not available
    rating: p.rating ?? null,
    ratingCount: p.stats?.total_ratings ?? null,
    popularity: p.popularity ?? null,
    price: p.price ?? null,
    
    // Operational
    openNow: p.hours?.open_now ?? null,
    
    // Completeness
    hasAddress: Boolean(p.location?.address || p.location?.formatted_address),
    hasPhone: Boolean(p.tel),
    hasWebsite: Boolean(p.website),
    hasHours: Boolean(p.hours?.regular?.length),
    
    // Display
    address,
    type,
  };
}

// =============================================================================
// API HANDLER
// =============================================================================

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  const IS_DEV = process.env.NODE_ENV === 'development';
  
  // Check API key
  if (!FOURSQUARE_API_KEY) {
    return NextResponse.json(
      { 
        ok: false, 
        error: 'Foursquare API key not configured',
        detail: 'Set FOURSQUARE_API_KEY in environment variables',
      },
      { status: 400 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  
  // Parse params
  const latStr = searchParams.get('lat');
  const lonStr = searchParams.get('lon');
  const category = searchParams.get('category');
  const radiusStr = searchParams.get('radiusMeters');
  const maxWalkMinsStr = searchParams.get('maxWalkMins');
  const vegOnly = searchParams.get('vegOnly') === 'true';
  const vibe = searchParams.get('vibe') || 'insta';

  // Validation
  if (!latStr || !lonStr) {
    return NextResponse.json({ ok: false, error: 'lat and lon are required' }, { status: 400 });
  }
  if (!category || !CATEGORY_IDS[category]) {
    return NextResponse.json(
      { ok: false, error: 'category must be one of: restaurant, cafe, grocery, scenic, indoor' },
      { status: 400 }
    );
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  const radiusMeters = Math.min(radiusStr ? parseInt(radiusStr, 10) : DEFAULT_RADIUS, MAX_RADIUS);
  const maxWalkMins = maxWalkMinsStr ? parseInt(maxWalkMinsStr, 10) : 30;

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ ok: false, error: 'Invalid lat/lon values' }, { status: 400 });
  }

  // Build preferences for ranking
  const prefs: Preferences = {
    location: '',
    vegOnly,
    maxWalkMinutes: maxWalkMins,
    vibe: vibe as any,
    category: category as any,
  };

  // Check cache - include ALL parameters to avoid stale results
  const limit = 50; // Default limit
  const cacheKey = makeCacheKey(lat, lon, radiusMeters, category, vibe, limit);
  let rawPlaces = getCached(cacheKey);
  let fromCache = false;
  
  if (rawPlaces) {
    fromCache = true;
    if (IS_DEV) {
      console.log(`[FSQ API] Cache hit: ${rawPlaces.length} raw places`);
    }
  } else {
    // Query Foursquare API
    const categoryIds = CATEGORY_IDS[category];
    
    const params = new URLSearchParams({
      ll: `${lat},${lon}`,
      radius: radiusMeters.toString(),
      categories: categoryIds,
      limit: DEFAULT_LIMIT.toString(),
      sort: 'RELEVANCE',  // Use relevance sort, not just distance
      fields: FSQ_FIELDS,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      if (IS_DEV) {
        console.log(`[FSQ API] Querying: ${category} at ${lat.toFixed(4)},${lon.toFixed(4)} radius=${radiusMeters}m`);
      }

      const response = await fetch(`${FOURSQUARE_API_URL}?${params}`, {
        headers: {
          'Authorization': FOURSQUARE_API_KEY,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[FSQ API] Error ${response.status}:`, errorText);
        
        if (response.status === 401) {
          return NextResponse.json(
            { ok: false, error: 'Invalid Foursquare API key' },
            { status: 401 }
          );
        }
        if (response.status === 429) {
          return NextResponse.json(
            { ok: false, error: 'Foursquare rate limit exceeded. Try again in a moment.' },
            { status: 429 }
          );
        }
        if (response.status === 410) {
          return NextResponse.json(
            { ok: false, error: 'Foursquare API endpoint deprecated. Please use OpenStreetMap provider.' },
            { status: 410 }
          );
        }
        return NextResponse.json(
          { ok: false, error: `Foursquare API error: ${response.status}` },
          { status: 502 }
        );
      }

      const data: FoursquareResponse = await response.json();
      
      if (IS_DEV) {
        console.log(`[FSQ API] Raw response: ${data.results?.length || 0} places`);
      }
      
      // Normalize places
      rawPlaces = data.results
        .map(normalizePlace)
        .filter((p): p is FsqPlaceRaw => p !== null);
      
      // Cache raw results
      setCache(cacheKey, rawPlaces);
      
      if (IS_DEV) {
        console.log(`[FSQ API] Normalized: ${rawPlaces.length} places`);
        // Log sample signals
        const sample = rawPlaces.slice(0, 3);
        sample.forEach(p => {
          console.log(`  ${p.name}: rating=${p.rating}, count=${p.ratingCount}, pop=${p.popularity}, price=${p.price}`);
        });
      }

    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      
      if (err.name === 'AbortError') {
        return NextResponse.json(
          { ok: false, error: 'Foursquare search timed out. Try again or reduce radius.' },
          { status: 504 }
        );
      }

      console.error('[FSQ API] Error:', err.message);
      return NextResponse.json(
        { ok: false, error: 'Failed to search Foursquare. Try again.' },
        { status: 502 }
      );
    }
  }

  // Apply DS-style ranking
  const rankingResult = rankPlacesFsq(rawPlaces, prefs, radiusMeters);
  
  if (IS_DEV) {
    logFsqRankingDebug(rankingResult);
  }

  const duration = Math.round(performance.now() - startTime);
  
  if (IS_DEV) {
    console.log(`[FSQ API] Complete: ${duration}ms, ${rankingResult.places.length} ranked places`);
  }

  // Build response (no scores or ranking details exposed)
  return NextResponse.json({
    ok: true,
    allPlaces: rankingResult.places.slice(0, 60),
    topPlaces: rankingResult.topPlaces,
    recommended: rankingResult.recommended,
    totalBeforeFilter: rankingResult.debug.totalRaw,
    totalAfterFilter: rankingResult.places.length,
    cached: fromCache,
    dataSource: 'foursquare',
    vegFilterWarning: rankingResult.vegFilterWarning,
    _meta: { durationMs: duration },
  });
}
