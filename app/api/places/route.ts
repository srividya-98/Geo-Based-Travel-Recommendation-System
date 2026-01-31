import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseAvailable, queryPoisInRadius, DbPoi } from '@/lib/db';

// Allow longer runs on Vercel (Overpass can be slow). Hobby = 10s max; Pro = 60s.
export const maxDuration = 30;
import { placesCache, makeCacheKey } from '@/lib/cache';
import { scorePlace as scorePlaceNew, rankPlaces, logRankingDebug, ScoredPlace } from '@/lib/scoring';
import { Preferences, Vibe } from '@/lib/types';

// Types
interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface PlaceRaw {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

type OpenStatus = 'open' | 'unknown';
type DataSource = 'postgis' | 'overpass' | 'foursquare';

// Foursquare API types
interface FoursquarePlace {
  fsq_id: string;
  name: string;
  geocodes: {
    main: { latitude: number; longitude: number };
  };
  categories: Array<{ id: number; name: string }>;
  location: {
    address?: string;
    locality?: string;
  };
  hours?: {
    open_now?: boolean;
  };
  website?: string;
  tel?: string;
}

interface FoursquareResponse {
  results: FoursquarePlace[];
}

interface PlaceRanked {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  type: string;
  tags: string[];
  distanceKm: number;
  walkMins: number;
  reasons: string[];
  vegFriendly: boolean;
  openStatus: OpenStatus;
}

// Constants - OPTIMIZED FOR PERFORMANCE
const REQUEST_TIMEOUT = 10000;  // 10s timeout with AbortController
const RETRY_BACKOFF_MS = 500;   // 500ms backoff for retries
const MAX_RETRIES = 1;          // Max 1 retry for 429/503
const WALKING_SPEED_KMH = 4.5;
const DEFAULT_RADIUS = 2000;    // 2km default for broader retrieval
const MAX_RADIUS = 5000;
const MAX_DB_RESULTS = 100;     // Broader retrieval for ranking
const MAX_MAP_PLACES = 100;     // Map rendering cap (increased from 60)
const MAX_OVERPASS_RESULTS = 100; // Cap Overpass results (increased for broader ranking)

// Foursquare API config
const FOURSQUARE_API_KEY = process.env.FOURSQUARE_API_KEY;
const FOURSQUARE_API_URL = 'https://api.foursquare.com/v3/places/search';

// Bayesian Ranking API config
const BAYESIAN_API_URL = process.env.BAYESIAN_API_URL || 'http://localhost:8000';
const USE_BAYESIAN_RANKING = process.env.USE_BAYESIAN_RANKING === 'true';

// Foursquare category IDs (https://docs.foursquare.com/data-products/docs/categories)
const FOURSQUARE_CATEGORIES: Record<string, string> = {
  restaurant: '13065',      // Restaurant
  cafe: '13032,13035',      // Coffee Shop, Café
  grocery: '17069,17070',   // Grocery Store, Supermarket
  scenic: '16000,16032',    // Landmarks, Parks
  indoor: '10027,10024',    // Museum, Movie Theater
};

// Multiple Overpass API endpoints for fallback
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Category to Overpass query mapping (fallback) - EXPANDED for broader retrieval
const CATEGORY_QUERIES: Record<string, string> = {
  restaurant: `
    node["amenity"="restaurant"](around:{radius},{lat},{lon});
    node["amenity"="fast_food"](around:{radius},{lat},{lon});
    node["amenity"="cafe"](around:{radius},{lat},{lon});
    node["amenity"="bar"](around:{radius},{lat},{lon});
    node["amenity"="bistro"](around:{radius},{lat},{lon});
    node["amenity"="food_court"](around:{radius},{lat},{lon});
    node["amenity"="pub"](around:{radius},{lat},{lon});
    way["amenity"="restaurant"](around:{radius},{lat},{lon});
    way["amenity"="fast_food"](around:{radius},{lat},{lon});
    way["amenity"="cafe"](around:{radius},{lat},{lon});
    way["amenity"="bar"](around:{radius},{lat},{lon});
    way["amenity"="food_court"](around:{radius},{lat},{lon});
  `,
  cafe: `
    node["amenity"="cafe"](around:{radius},{lat},{lon});
    node["amenity"="coffee_shop"](around:{radius},{lat},{lon});
    node["shop"="coffee"](around:{radius},{lat},{lon});
    node["amenity"="tea"](around:{radius},{lat},{lon});
    way["amenity"="cafe"](around:{radius},{lat},{lon});
    way["shop"="coffee"](around:{radius},{lat},{lon});
  `,
  grocery: `
    node["shop"="supermarket"](around:{radius},{lat},{lon});
    node["shop"="convenience"](around:{radius},{lat},{lon});
    node["shop"="grocery"](around:{radius},{lat},{lon});
    way["shop"="supermarket"](around:{radius},{lat},{lon});
    way["shop"="convenience"](around:{radius},{lat},{lon});
    way["shop"="grocery"](around:{radius},{lat},{lon});
  `,
  scenic: `
    node["tourism"="attraction"](around:{radius},{lat},{lon});
    node["tourism"="viewpoint"](around:{radius},{lat},{lon});
    node["leisure"="park"](around:{radius},{lat},{lon});
    node["leisure"="garden"](around:{radius},{lat},{lon});
    way["tourism"="attraction"](around:{radius},{lat},{lon});
    way["tourism"="viewpoint"](around:{radius},{lat},{lon});
    way["leisure"="park"](around:{radius},{lat},{lon});
    way["leisure"="garden"](around:{radius},{lat},{lon});
  `,
  indoor: `
    node["tourism"="museum"](around:{radius},{lat},{lon});
    node["amenity"="cinema"](around:{radius},{lat},{lon});
    node["amenity"="library"](around:{radius},{lat},{lon});
    node["amenity"="theatre"](around:{radius},{lat},{lon});
    way["tourism"="museum"](around:{radius},{lat},{lon});
    way["amenity"="cinema"](around:{radius},{lat},{lon});
    way["amenity"="library"](around:{radius},{lat},{lon});
    way["amenity"="theatre"](around:{radius},{lat},{lon});
  `,
};

// Vibe keywords for matching
const VIBE_KEYWORDS: Record<string, { calm: string[]; lively: string[] }> = {
  restaurant: {
    calm: ['fine_dining', 'quiet', 'traditional', 'family', 'vegetarian'],
    lively: ['fast_food', 'bar', 'pub', 'food_court', 'buffet'],
  },
  cafe: {
    calm: ['tea', 'coffee', 'bakery', 'quiet', 'bookshop', 'organic'],
    lively: ['chain', 'starbucks', 'costa', 'busy'],
  },
  grocery: {
    calm: ['organic', 'local', 'specialty', 'health', 'farmers'],
    lively: ['supermarket', '24', 'hypermarket', 'wholesale'],
  },
  scenic: {
    calm: ['park', 'garden', 'viewpoint', 'nature', 'temple', 'church'],
    lively: ['beach', 'amusement', 'zoo', 'theme_park', 'attraction'],
  },
  indoor: {
    calm: ['museum', 'library', 'gallery', 'art'],
    lively: ['cinema', 'theatre', 'mall', 'arcade'],
  },
};

// Haversine distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// =============================================================================
// BAYESIAN RANKING API INTEGRATION
// =============================================================================

interface BayesianRankRequest {
  places: Array<{
    id: string;
    name: string;
    category: string;
    distanceMeters: number;
    rating?: number | null;
    ratingCount?: number | null;
    openNow?: boolean | null;
    vegFriendly?: boolean;
    hasAddress?: boolean;
    hasPhone?: boolean;
    hasWebsite?: boolean;
    hasHours?: boolean;
  }>;
  prefs: {
    vibe: string;
    category: string;
    vegOnly: boolean;
    maxWalkMinutes: number;
  };
  strategy: 'mean' | 'lower_bound';
}

interface BayesianRankedVenue {
  id: string;
  name: string;
  category: string;
  probability: number;
  p10: number;
  p90: number;
  confidence: number;
  rank: number;
}

interface BayesianRankResponse {
  ranked_places: BayesianRankedVenue[];
  model_info: Record<string, unknown>;
  debug: Record<string, unknown>;
}

/**
 * Call Bayesian ranking API to get probabilistic rankings.
 * Returns null if the service is unavailable (graceful fallback).
 */
async function callBayesianRankingApi(
  places: PlaceRaw[],
  centerLat: number,
  centerLon: number,
  prefs: { vibe: string; category: string; vegOnly: boolean; maxWalkMinutes: number },
  strategy: 'mean' | 'lower_bound' = 'mean'
): Promise<BayesianRankResponse | null> {
  if (!USE_BAYESIAN_RANKING) {
    return null;
  }

  try {
    // Convert places to API format
    const placesData = places.map(p => ({
      id: p.id,
      name: p.name,
      category: prefs.category,
      distanceMeters: calculateDistance(centerLat, centerLon, p.lat, p.lon) * 1000,
      rating: p.tags['fsq:rating'] ? parseFloat(p.tags['fsq:rating']) : null,
      ratingCount: p.tags['fsq:rating_count'] ? parseInt(p.tags['fsq:rating_count']) : null,
      openNow: p.tags.opening_hours?.includes('24/7') || null,
      vegFriendly: isVegFriendly(p.tags, p.name),
      hasAddress: !!(p.tags['addr:street'] || p.tags['addr:housenumber']),
      hasPhone: !!(p.tags.phone || p.tags['contact:phone']),
      hasWebsite: !!(p.tags.website || p.tags['contact:website']),
      hasHours: !!p.tags.opening_hours,
    }));

    const requestBody: BayesianRankRequest = {
      places: placesData,
      prefs: {
        vibe: prefs.vibe,
        category: prefs.category,
        vegOnly: prefs.vegOnly,
        maxWalkMinutes: prefs.maxWalkMinutes,
      },
      strategy,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(`${BAYESIAN_API_URL}/rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Bayesian API] Request failed: ${response.status}`);
      return null;
    }

    const result: BayesianRankResponse = await response.json();
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Bayesian API] Ranked ${result.ranked_places.length} places`);
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[Bayesian API] Request timed out');
    } else {
      console.warn('[Bayesian API] Service unavailable:', error instanceof Error ? error.message : 'Unknown error');
    }
    return null;
  }
}

/**
 * Merge Bayesian predictions into ranked places.
 */
function mergeBayesianPredictions(
  rankedPlaces: ScoredPlace[],
  bayesianResult: BayesianRankResponse
): ScoredPlace[] {
  const bayesianMap = new Map(
    bayesianResult.ranked_places.map(p => [p.id, p])
  );

  return rankedPlaces.map(place => {
    const bayesian = bayesianMap.get(place.id);
    if (bayesian) {
      return {
        ...place,
        probability: bayesian.probability,
        p10: bayesian.p10,
        p90: bayesian.p90,
        confidence: bayesian.confidence,
      };
    }
    return place;
  });
}

// Determine open status from opening_hours tag
function getOpenStatus(tags: Record<string, string>): OpenStatus {
  const hours = tags.opening_hours;
  if (!hours) return 'unknown';
  if (hours.includes('24/7') || hours.toLowerCase().includes('24 hours')) return 'open';
  return 'unknown';
}

// Check if place is veg-friendly
function isVegFriendly(tags: Record<string, string>, name: string): boolean {
  if (tags['diet:vegetarian'] === 'yes' || tags['diet:vegetarian'] === 'only') return true;
  if (tags['diet:vegan'] === 'yes' || tags['diet:vegan'] === 'only') return true;
  
  const cuisine = (tags.cuisine || '').toLowerCase();
  if (cuisine.includes('vegetarian') || cuisine.includes('vegan') || cuisine.includes('south_indian')) return true;
  
  const nameLower = name.toLowerCase();
  const vegKeywords = ['veg', 'vegetarian', 'vegan', 'saravana', 'murugan', 'ananda', 'pure veg', 'bhavan'];
  return vegKeywords.some((kw) => nameLower.includes(kw));
}

// Get place type from tags or subcategory
function getPlaceType(tags: Record<string, string>, subcategory?: string): string {
  // From subcategory (PostGIS)
  if (subcategory) {
    const subcatMap: Record<string, string> = {
      restaurant: 'Restaurant',
      fast_food: 'Fast Food',
      cafe: 'Café',
      bar: 'Bar',
      coffee_shop: 'Coffee Shop',
      supermarket: 'Supermarket',
      convenience: 'Convenience Store',
      grocery: 'Grocery Store',
      greengrocer: 'Greengrocer',
      bakery: 'Bakery',
      museum: 'Museum',
      cinema: 'Cinema',
      theatre: 'Theatre',
      library: 'Library',
      gallery: 'Gallery',
      park: 'Park',
      garden: 'Garden',
      viewpoint: 'Viewpoint',
      attraction: 'Attraction',
      artwork: 'Artwork',
    };
    if (subcatMap[subcategory]) return subcatMap[subcategory];
  }
  
  // Fallback to tags (Overpass)
  if (tags.amenity === 'restaurant') return 'Restaurant';
  if (tags.amenity === 'fast_food') return 'Fast Food';
  if (tags.amenity === 'cafe') return 'Café';
  if (tags.shop === 'supermarket') return 'Supermarket';
  if (tags.shop === 'convenience') return 'Convenience Store';
  if (tags.shop === 'grocery') return 'Grocery Store';
  if (tags.amenity === 'cinema') return 'Cinema';
  if (tags.amenity === 'library') return 'Library';
  if (tags.amenity === 'theatre') return 'Theatre';
  if (tags.tourism === 'museum') return 'Museum';
  if (tags.leisure === 'park') return 'Park';
  if (tags.leisure === 'garden') return 'Garden';
  if (tags.tourism === 'viewpoint') return 'Viewpoint';
  if (tags.tourism === 'attraction') return 'Attraction';
  return 'Place';
}

// Extract display tags
function extractDisplayTags(tags: Record<string, string>): string[] {
  const result: string[] = [];
  if (tags.cuisine) {
    const cuisine = tags.cuisine.split(';')[0].replace(/_/g, ' ');
    result.push(cuisine.charAt(0).toUpperCase() + cuisine.slice(1));
  }
  if (tags.outdoor_seating === 'yes') result.push('Outdoor seating');
  if (tags.wheelchair === 'yes') result.push('Accessible');
  if (tags.takeaway === 'yes') result.push('Takeaway');
  if (tags.internet_access === 'wlan' || tags.internet_access === 'yes') result.push('WiFi');
  return result.slice(0, 4);
}

// Check vibe match
function getVibeMatch(tags: Record<string, string>, category: string, vibe: string): { matches: boolean; keyword?: string } {
  const vibeConfig = VIBE_KEYWORDS[category];
  if (!vibeConfig) return { matches: false };
  
  const keywords = vibe === 'calm' ? vibeConfig.calm : vibeConfig.lively;
  const tagValues = Object.values(tags).join(' ').toLowerCase();
  const name = (tags.name || '').toLowerCase();
  
  for (const kw of keywords) {
    if (tagValues.includes(kw) || name.includes(kw)) {
      return { matches: true, keyword: kw.replace(/_/g, ' ') };
    }
  }
  
  if (vibe === 'calm') {
    if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.amenity === 'cafe') {
      return { matches: true, keyword: getPlaceType(tags).toLowerCase() };
    }
  } else {
    if (tags.amenity === 'fast_food' || tags.amenity === 'cinema') {
      return { matches: true, keyword: getPlaceType(tags).toLowerCase() };
    }
  }
  
  return { matches: false };
}

// Legacy scoring function - kept for reference but replaced by lib/scoring.ts
// This function is no longer used; ranking is done via rankPlaces()

// Convert DbPoi to PlaceRaw
function dbPoiToPlaceRaw(poi: DbPoi): PlaceRaw {
  return {
    id: `${poi.osm_type}-${poi.osm_id}`,
    name: poi.name,
    lat: poi.lat,
    lon: poi.lon,
    tags: poi.tags || {},
  };
}

// Query PostGIS database
async function queryPostgis(
  lat: number,
  lon: number,
  radiusMeters: number,
  category: string
): Promise<{ places: PlaceRaw[]; subcategories: Map<string, string> }> {
  try {
    const dbPois = await queryPoisInRadius(lat, lon, radiusMeters, category, MAX_DB_RESULTS);
    const places = dbPois.map(dbPoiToPlaceRaw);
    const subcategories = new Map<string, string>();
    
    for (const poi of dbPois) {
      subcategories.set(`${poi.osm_type}-${poi.osm_id}`, poi.subcategory);
    }
    
    return { places, subcategories };
  } catch (error) {
    console.error('[PostGIS] Query error:', error);
    throw error;
  }
}

// Build Overpass QL query
function buildOverpassQuery(lat: number, lon: number, radiusMeters: number, category: string): string {
  const categoryQuery = CATEGORY_QUERIES[category];
  if (!categoryQuery) throw new Error(`Invalid category: ${category}`);

  const filledQuery = categoryQuery
    .replace(/{radius}/g, radiusMeters.toString())
    .replace(/{lat}/g, lat.toFixed(5))
    .replace(/{lon}/g, lon.toFixed(5));

  return `[out:json][timeout:10];(${filledQuery});out center ${MAX_OVERPASS_RESULTS};`.trim();
}

// Query Foursquare API (fastest, primary source when API key available)
async function queryFoursquare(
  lat: number,
  lon: number,
  radiusMeters: number,
  category: string
): Promise<PlaceRaw[]> {
  if (!FOURSQUARE_API_KEY) {
    throw new Error('Foursquare API key not configured');
  }

  const categories = FOURSQUARE_CATEGORIES[category];
  if (!categories) {
    throw new Error(`No Foursquare category mapping for: ${category}`);
  }

  const params = new URLSearchParams({
    ll: `${lat},${lon}`,
    radius: Math.min(radiusMeters, 50000).toString(), // Foursquare max is 100km
    categories: categories,
    limit: MAX_OVERPASS_RESULTS.toString(),
    sort: 'DISTANCE',
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Foursquare] Querying: ${category} at ${lat},${lon} radius=${radiusMeters}m`);
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
      throw new Error(`Foursquare API error: ${response.status} ${errorText}`);
    }

    const data: FoursquareResponse = await response.json();
    
    const places: PlaceRaw[] = data.results
      .filter(p => p.name && p.geocodes?.main)
      .map(p => ({
        id: `fsq-${p.fsq_id}`,
        name: p.name,
        lat: p.geocodes.main.latitude,
        lon: p.geocodes.main.longitude,
        tags: {
          // Convert Foursquare data to OSM-like tags
          name: p.name,
          ...(p.categories?.[0]?.name && { amenity: p.categories[0].name.toLowerCase() }),
          ...(p.website && { website: p.website }),
          ...(p.tel && { phone: p.tel }),
          ...(p.hours?.open_now !== undefined && { 
            opening_hours: p.hours.open_now ? '24/7' : 'unknown' 
          }),
          ...(p.location?.address && { 'addr:street': p.location.address }),
        },
      }));

    if (process.env.NODE_ENV === 'development') {
      console.log(`[Foursquare] Success: ${places.length} places`);
    }

    return places;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Fetch with timeout helper
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Query Overpass API (fallback) with retry logic
async function queryOverpass(
  lat: number,
  lon: number,
  radiusMeters: number,
  category: string
): Promise<PlaceRaw[]> {
  const query = buildOverpassQuery(lat, lon, radiusMeters, category);
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    let retryCount = 0;
    
    while (retryCount <= MAX_RETRIES) {
      try {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Overpass] Trying ${endpoint} (attempt ${retryCount + 1})`);
        }

        const response = await fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'LocalTravelAgent/1.0',
              'Accept': 'application/json',
            },
            body: `data=${encodeURIComponent(query)}`,
          },
          REQUEST_TIMEOUT
        );

        // Retry on 429 (rate limit) or 503 (service unavailable)
        if ((response.status === 429 || response.status === 503) && retryCount < MAX_RETRIES) {
          retryCount++;
          if (process.env.NODE_ENV === 'development') {
            console.log(`[Overpass] Got ${response.status}, retrying in ${RETRY_BACKOFF_MS}ms...`);
          }
          await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
          continue;
        }

        if (response.status === 429) {
          lastError = new Error('Rate limited');
          break; // Try next endpoint
        }

        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`);
          break; // Try next endpoint
        }

        const data = await response.json();
        const elements: OverpassElement[] = data.elements || [];

        const places = elements
          .map((el) => {
            const tags = el.tags || {};
            if (!tags.name) return null;
            const elLat = el.lat ?? el.center?.lat;
            const elLon = el.lon ?? el.center?.lon;
            if (elLat === undefined || elLon === undefined) return null;
            return {
              id: `${el.type}-${el.id}`,
              name: tags.name,
              lat: elLat,
              lon: elLon,
              tags,
            };
          })
          .filter((p): p is PlaceRaw => p !== null)
          .slice(0, MAX_OVERPASS_RESULTS); // Hard cap

        if (process.env.NODE_ENV === 'development') {
          console.log(`[Overpass] Success: ${places.length} places from ${endpoint}`);
        }
        
        return places;
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Unknown error');
        
        // Timeout - don't retry, try next endpoint
        if (err.name === 'AbortError') {
          lastError = new Error('Request timed out');
          if (process.env.NODE_ENV === 'development') {
            console.log(`[Overpass] Timeout on ${endpoint}`);
          }
          break;
        }
        
        lastError = err;
        break;
      }
    }
  }

  throw lastError || new Error('All Overpass endpoints failed');
}

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  const searchParams = request.nextUrl.searchParams;
  
  const latStr = searchParams.get('lat');
  const lonStr = searchParams.get('lon');
  const category = searchParams.get('category');
  const radiusStr = searchParams.get('radiusMeters');
  const maxWalkMinsStr = searchParams.get('maxWalkMins');
  const vegOnly = searchParams.get('vegOnly') === 'true';
  const vibe = searchParams.get('vibe') || null;  // Vibe is optional - null means no vibe filter

  // Validation
  if (!latStr || !lonStr) {
    return NextResponse.json({ error: 'lat and lon are required' }, { status: 400 });
  }
  if (!category || !['restaurant', 'cafe', 'grocery', 'scenic', 'indoor'].includes(category)) {
    return NextResponse.json({ error: 'category must be one of: restaurant, cafe, grocery, scenic, indoor' }, { status: 400 });
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  const radiusMeters = Math.min(radiusStr ? parseInt(radiusStr, 10) : DEFAULT_RADIUS, MAX_RADIUS);
  const maxWalkMins = maxWalkMinsStr ? parseInt(maxWalkMinsStr, 10) : 30;

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon values' }, { status: 400 });
  }

  // Check cache first - INCLUDE VIBE in cache key!
  const cacheKey = makeCacheKey({
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    radius: radiusMeters,
    category,
    vibe,  // Different vibes = different cache entries
    vegOnly,
  });

  const cached = placesCache.get(cacheKey) as { places: PlaceRaw[]; subcategories: Map<string, string>; source: DataSource } | null;
  
  let rawPlaces: PlaceRaw[];
  let subcategories: Map<string, string> = new Map();
  let dataSource: DataSource;
  let fromCache = false;

  if (cached) {
    rawPlaces = cached.places;
    subcategories = cached.subcategories;
    dataSource = cached.source;
    fromCache = true;
  } else {
    // Priority: 1) Foursquare (fastest) 2) PostGIS 3) Overpass (slowest)
    let fetchError: Error | null = null;

    // Try Foursquare first (fastest)
    if (FOURSQUARE_API_KEY) {
      try {
        rawPlaces = await queryFoursquare(lat, lon, radiusMeters, category);
        dataSource = 'foursquare';
      } catch (error) {
        fetchError = error instanceof Error ? error : new Error('Unknown error');
        if (process.env.NODE_ENV === 'development') {
          console.warn('[API] Foursquare failed:', fetchError.message);
        }
      }
    }

    // Fallback to PostGIS
    if (!rawPlaces) {
      const dbAvailable = await isDatabaseAvailable();
      if (dbAvailable) {
        try {
          const result = await queryPostgis(lat, lon, radiusMeters, category);
          rawPlaces = result.places;
          subcategories = result.subcategories;
          dataSource = 'postgis';
          if (process.env.NODE_ENV === 'development') {
            console.log(`[API] PostGIS returned ${rawPlaces.length} places`);
          }
        } catch (error) {
          fetchError = error instanceof Error ? error : new Error('Unknown error');
          if (process.env.NODE_ENV === 'development') {
            console.warn('[API] PostGIS failed:', fetchError.message);
          }
        }
      }
    }

    // Final fallback to Overpass
    if (!rawPlaces) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[API] Falling back to Overpass API');
      }
      try {
        rawPlaces = await queryOverpass(lat, lon, radiusMeters, category);
        dataSource = 'overpass';
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Unknown error');
        if (err.message === 'Request timed out' || err.name === 'AbortError') {
          return NextResponse.json(
            { ok: false, error: 'Place search timed out. Try again or reduce radius.' },
            { status: 504 }
          );
        }
        if (err.message === 'Rate limited') {
          return NextResponse.json(
            { ok: false, error: 'Too many requests. Please wait a moment and try again.' },
            { status: 429 }
          );
        }
        console.error('[API] All data sources failed:', err.message);
        return NextResponse.json(
          { ok: false, error: 'Place search service temporarily unavailable. Try again.' },
          { status: 502 }
        );
      }
    }

    // Cache the raw results
    placesCache.set(cacheKey, { places: rawPlaces, subcategories, source: dataSource });
  }

  // Build preferences object for new scoring system
  const prefs: Preferences = {
    location: '',  // Not needed for scoring
    vegOnly,
    maxWalkMinutes: maxWalkMins,
    vibe: vibe as Vibe,
    category: category as 'restaurant' | 'cafe' | 'grocery' | 'scenic' | 'indoor',
  };

  // Use new production-grade scoring and ranking engine
  const rankingResult = rankPlaces(rawPlaces, lat, lon, prefs);
  
  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    logRankingDebug(dataSource, rankingResult, vibe);
  }

  // Try Bayesian ranking API (optional enhancement)
  let usedBayesian = false;
  let allPlacesWithBayesian = rankingResult.allPlaces;
  
  if (USE_BAYESIAN_RANKING) {
    const bayesianResult = await callBayesianRankingApi(
      rawPlaces,
      lat,
      lon,
      { vibe, category, vegOnly, maxWalkMinutes: maxWalkMins },
      'mean'
    );
    
    if (bayesianResult) {
      // Merge Bayesian predictions into places
      allPlacesWithBayesian = mergeBayesianPredictions(
        rankingResult.allPlaces,
        bayesianResult
      );
      usedBayesian = true;
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[API] Bayesian predictions merged');
      }
    }
  }

  // Extract recommended and others
  const recommended = rankingResult.recommended;
  const allPlaces = allPlacesWithBayesian.slice(0, MAX_MAP_PLACES);
  const topPlaces = recommended 
    ? [recommended, ...rankingResult.others.slice(0, 4)]  // Top 5 for display
    : rankingResult.others.slice(0, 5);

  const duration = Math.round(performance.now() - startTime);
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[API] /places: ${duration}ms, source=${dataSource}, cached=${fromCache}, raw=${rawPlaces.length}, ranked=${allPlaces.length}`);
  }

  return NextResponse.json({
    ok: true,
    allPlaces,
    topPlaces,
    recommended: recommended || null,  // Single recommended place
    cached: fromCache,
    dataSource,
    rankingModel: usedBayesian ? 'bayesian' : 'deterministic',
    totalBeforeFilter: rankingResult.debug.rawCount,
    totalAfterFilter: rankingResult.debug.afterDedupeCount,
    _meta: { 
      durationMs: duration,
      vibe,
      debugTop5: rankingResult.debug.top5,
      bayesianEnabled: USE_BAYESIAN_RANKING,
      usedBayesian,
    },
  });
}
