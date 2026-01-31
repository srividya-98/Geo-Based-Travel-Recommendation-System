import { NextRequest, NextResponse } from 'next/server';

// Types
interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
  class: string;
  importance: number;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
    neighbourhood?: string;
    suburb?: string;
    district?: string;
  };
}

interface Suggestion {
  id: string;
  displayName: string;
  shortName: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
}

// Cache
interface CacheEntry {
  data: Suggestion[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const REQUEST_TIMEOUT = 8000; // 8 seconds
const MAX_SUGGESTIONS = 6;

// Clean expired cache
function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}

// Generate cache key
function getCacheKey(q: string, type: string, nearLat?: number, nearLon?: number): string {
  const normalizedQ = q.toLowerCase().trim();
  const nearKey = nearLat && nearLon ? `${nearLat.toFixed(2)},${nearLon.toFixed(2)}` : '';
  return `${normalizedQ}:${type}:${nearKey}`;
}

// Extract short name from display_name
function getShortName(result: NominatimResult, type: string): string {
  const parts = result.display_name.split(',').map(p => p.trim());
  
  if (type === 'city') {
    // For cities, show city + country (or first 2-3 parts)
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[parts.length - 1]}`;
    }
    return parts[0];
  } else {
    // For areas, show area name + city/context
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[1]}`;
    }
    return parts[0];
  }
}

// Get suggestion type label
function getSuggestionType(result: NominatimResult): string {
  const { address } = result;
  if (address?.neighbourhood) return 'Neighborhood';
  if (address?.suburb) return 'Suburb';
  if (address?.district) return 'District';
  if (address?.city || address?.town) return 'City';
  if (address?.village) return 'Village';
  if (address?.state) return 'State';
  if (address?.country) return 'Country';
  return result.type || 'Place';
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get('q');
  const type = searchParams.get('type') || 'city'; // city or area
  const nearLatStr = searchParams.get('nearLat');
  const nearLonStr = searchParams.get('nearLon');

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const normalizedQ = q.trim();
  const nearLat = nearLatStr ? parseFloat(nearLatStr) : undefined;
  const nearLon = nearLonStr ? parseFloat(nearLonStr) : undefined;

  // Check cache
  cleanCache();
  const cacheKey = getCacheKey(normalizedQ, type, nearLat, nearLon);
  const cached = cache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ suggestions: cached.data, cached: true });
  }

  // Build Nominatim request
  const params = new URLSearchParams({
    q: normalizedQ,
    format: 'json',
    limit: '10', // Get more, then filter
    addressdetails: '1',
  });

  // For area search with location context, add viewbox for biasing
  if (type === 'area' && nearLat !== undefined && nearLon !== undefined) {
    // Create a viewbox around the location (~50km)
    const delta = 0.5; // ~50km
    params.set('viewbox', `${nearLon - delta},${nearLat + delta},${nearLon + delta},${nearLat - delta}`);
    params.set('bounded', '0'); // Don't strictly bound, just bias
  }

  // For city search, add feature type filters
  if (type === 'city') {
    params.set('featuretype', 'city');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          'User-Agent': 'LocalTravelAgent/1.0 (https://github.com/local-travel-agent)',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`Nominatim error: ${response.status}`);
      return NextResponse.json({ suggestions: [], error: 'Search failed' });
    }

    const results: NominatimResult[] = await response.json();

    // Transform and filter results
    const suggestions: Suggestion[] = results
      .filter(r => r.display_name && r.lat && r.lon)
      .map(r => ({
        id: `${r.place_id}`,
        displayName: r.display_name,
        shortName: getShortName(r, type),
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        type: getSuggestionType(r),
        importance: r.importance || 0,
      }))
      .slice(0, MAX_SUGGESTIONS);

    // Cache results
    cache.set(cacheKey, { data: suggestions, timestamp: Date.now() });

    return NextResponse.json({ suggestions });

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ suggestions: [], error: 'Request timeout' });
    }
    console.error('Suggest error:', error);
    return NextResponse.json({ suggestions: [], error: 'Search failed' });
  }
}
