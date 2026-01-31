import { NextRequest, NextResponse } from 'next/server';

// Types
interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
  };
  boundingbox?: [string, string, string, string]; // [south, north, west, east]
}

interface GeocodeResponse {
  lat: number;
  lon: number;
  displayName: string;
  country?: string;
  city?: string;
  bbox?: [number, number, number, number];
}

// Cache
interface CacheEntry {
  data: GeocodeResponse;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const REQUEST_TIMEOUT = 10000; // 10 seconds

// Nominatim endpoints (with fallbacks)
const NOMINATIM_ENDPOINTS = [
  'https://nominatim.openstreetmap.org/search',
];

// Clean expired cache entries
function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}

// Extract city name from address
function extractCity(address?: NominatimResult['address']): string | undefined {
  if (!address) return undefined;
  return address.city || address.town || address.village || address.municipality || address.county;
}

// Normalize cache key
function getCacheKey(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');

  if (!query || query.trim().length < 2) {
    return NextResponse.json(
      { error: 'Query must be at least 2 characters' },
      { status: 400 }
    );
  }

  const normalizedQuery = query.trim();
  const cacheKey = getCacheKey(normalizedQuery);

  // Clean expired entries
  cleanCache();

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached.data);
  }

  // Build Nominatim request
  const params = new URLSearchParams({
    q: normalizedQuery,
    format: 'json',
    limit: '5',
    addressdetails: '1',
  });

  let lastError: Error | null = null;

  for (const endpoint of NOMINATIM_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(`${endpoint}?${params.toString()}`, {
        headers: {
          'User-Agent': 'LocalTravelAgent/1.0 (https://github.com/local-travel-agent)',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          lastError = new Error('Rate limited');
          continue;
        }
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      const results: NominatimResult[] = await response.json();

      if (!results || results.length === 0) {
        return NextResponse.json(
          { error: `No results found for "${normalizedQuery}". Try a different search term.` },
          { status: 404 }
        );
      }

      // Use the best (first) result
      const best = results[0];
      
      const geocodeResponse: GeocodeResponse = {
        lat: parseFloat(best.lat),
        lon: parseFloat(best.lon),
        displayName: best.display_name,
        country: best.address?.country,
        city: extractCity(best.address),
        bbox: best.boundingbox
          ? [
              parseFloat(best.boundingbox[0]),
              parseFloat(best.boundingbox[1]),
              parseFloat(best.boundingbox[2]),
              parseFloat(best.boundingbox[3]),
            ]
          : undefined,
      };

      // Cache the result
      cache.set(cacheKey, {
        data: geocodeResponse,
        timestamp: Date.now(),
      });

      return NextResponse.json(geocodeResponse);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      continue;
    }
  }

  // All endpoints failed
  if (lastError?.name === 'AbortError') {
    return NextResponse.json(
      { error: 'Geocoding request timed out. Please try again.' },
      { status: 504 }
    );
  }

  if (lastError?.message === 'Rate limited') {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429 }
    );
  }

  console.error('Geocoding failed:', lastError?.message);
  return NextResponse.json(
    { error: 'Geocoding service temporarily unavailable. Please try again.' },
    { status: 502 }
  );
}
