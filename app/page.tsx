'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import PreferencesForm from '@/components/preferences/PreferencesForm';
import ResultsPanel from '@/components/results/ResultsPanel';
import { ProviderToggle, Provider } from '@/components/ProviderToggle';
import { Preferences, Place, PlacesApiResponse, DEFAULT_CENTER, LatLon, GeocodeResult, SelectedLocation, STORAGE_KEY_LAST_LOCATION } from '@/lib/types';
import type { MapViewHandle } from '@/components/map/MapView';

// Debounce hook for responsive filter changes
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// Type for saved location in localStorage
interface SavedLocation {
  center: LatLon;
  displayName: string;
  timestamp: number;
}

const MapView = dynamic(() => import('@/components/map/MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center rounded-2xl">
      <div className="text-center">
        <div className="relative w-14 h-14 mx-auto mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-slate-200"></div>
          <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
        </div>
        <p className="text-slate-500 font-medium">Loading map...</p>
      </div>
    </div>
  ),
});

async function geocodeLocation(query: string): Promise<GeocodeResult> {
  const params = new URLSearchParams({ query });
  const response = await fetch(`/api/geocode?${params.toString()}`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Geocoding failed');
  }
  return response.json();
}

async function fetchPlaces(
  lat: number, lon: number, category: string, maxWalkMins: number,
  vegOnly: boolean, vibe: string | null | undefined, radiusMeters: number = 3000,
  signal?: AbortSignal
): Promise<PlacesApiResponse> {
  const params = new URLSearchParams({
    lat: lat.toString(), lon: lon.toString(), category,
    maxWalkMins: maxWalkMins.toString(), vegOnly: vegOnly.toString(),
    radiusMeters: radiusMeters.toString(),
  });
  // Only add vibe param if it has a value
  if (vibe) {
    params.set('vibe', vibe);
  }
  const response = await fetch(`/api/places?${params.toString()}`, { signal });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to fetch places');
  }
  return response.json();
}

async function fetchPlacesFoursquare(
  lat: number, lon: number, category: string, maxWalkMins: number,
  vegOnly: boolean, radiusMeters: number = 3000,
  signal?: AbortSignal
): Promise<PlacesApiResponse> {
  const params = new URLSearchParams({
    lat: lat.toString(), lon: lon.toString(), category,
    maxWalkMins: maxWalkMins.toString(), vegOnly: vegOnly.toString(),
    radiusMeters: radiusMeters.toString(), limit: '60',
  });
  const response = await fetch(`/api/places-fsq?${params.toString()}`, { signal });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to fetch places from Foursquare');
  }
  return response.json();
}

// Simple client-side cache for search results (avoids duplicate fetches)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
interface CacheEntry {
  data: PlacesApiResponse;
  timestamp: number;
}

export default function Home() {
  const mapRef = useRef<MapViewHandle>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const searchCacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const [preferences, setPreferences] = useState<Preferences>({
    location: '',
    neighborhood: undefined,
    vegOnly: false,
    maxWalkMinutes: 15,
    vibe: null,
    category: null,  // No default - results only after user clicks a category
  });
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [topPlaces, setTopPlaces] = useState<Place[]>([]);
  const [recommendedPlaceId, setRecommendedPlaceId] = useState<string | null>(null);  // Single recommended place
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchStats, setSearchStats] = useState<{ before: number; after: number } | null>(null);
  const [loadingTooLong, setLoadingTooLong] = useState(false);  // Shows warning after 12s
  const loadingStartRef = useRef<number>(0);
  const [provider, setProvider] = useState<Provider>('openstreetmap');  // OSM is reliable default
  const [dataSource, setDataSource] = useState<string | null>(null);  // Track which provider was used
  const [mapCenter, setMapCenter] = useState<LatLon>(DEFAULT_CENTER);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<LatLon | null>(null);
  const [usingCurrentLocation, setUsingCurrentLocation] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<SelectedLocation | null>(null);
  const [selectedArea, setSelectedArea] = useState<SelectedLocation | null>(null);
  const [isGlobeView, setIsGlobeView] = useState(true);  // Always start with globe view

  // Save location to localStorage after successful search
  const saveLocationToStorage = useCallback((center: LatLon, displayName: string) => {
    try {
      const data: SavedLocation = {
        center,
        displayName,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY_LAST_LOCATION, JSON.stringify(data));
      if (process.env.NODE_ENV === 'development') {
        console.log('[Home] Saved location to localStorage:', displayName);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }
    setIsLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        const newCenter = { lat, lon };
        
        // Log coordinates for debugging
        console.log(`[Geo] Received: lat=${lat.toFixed(6)}, lon=${lon.toFixed(6)}, accuracy=${Math.round(accuracy)}m`);
        
        // Warn if accuracy is poor (>1km)
        if (accuracy > 1000) {
          console.warn('[Geo] Low accuracy location - may not be precise');
        }
        
        setUserLocation(newCenter);
        setMapCenter(newCenter);
        setUsingCurrentLocation(true);
        setIsLocating(false);
        setLocationError(null);
        setResolvedLocation(`Your location (±${Math.round(accuracy)}m)`);
        
        // Clear selected locations when using current location
        setSelectedCity(null);
        setSelectedArea(null);
        
        // Switch from globe to street view
        setIsGlobeView(false);
        
        // Save to localStorage
        saveLocationToStorage(newCenter, 'Your current location');
      },
      (error) => {
        setIsLocating(false);
        setUsingCurrentLocation(false);
        // Keep globe view on error - friendly message, no harsh error
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationError('Location access not granted. You can search for a city instead.');
            break;
          case error.POSITION_UNAVAILABLE:
            setLocationError('Location unavailable. Try searching for a city.');
            break;
          case error.TIMEOUT:
            setLocationError('Location request timed out. Try searching for a city.');
            break;
          default:
            setLocationError('Could not get location. Try searching for a city.');
        }
      },
      // Use high accuracy and fresh location (no caching)
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [saveLocationToStorage]);

  const handleSearch = useCallback(async () => {
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    setIsLoading(true);
    setHasSearched(true);
    setGeocodeError(null);
    setSearchError(null);
    setLoadingTooLong(false);
    loadingStartRef.current = Date.now();
    
    // DON'T clear previous results - keep them visible while loading for smoother UX
    // Results will be replaced when new data arrives
    
    // Show warning if loading takes > 8 seconds (reduced from 12)
    const loadingTimer = setTimeout(() => {
      setLoadingTooLong(true);
    }, 8000);

    let searchCenter: LatLon;
    let locationDisplay: string;

    if (usingCurrentLocation && userLocation) {
      // Priority 1: User's current location
      searchCenter = userLocation;
      locationDisplay = 'Your current location';
    } else if (selectedArea) {
      // Priority 2: Selected area from autocomplete
      searchCenter = { lat: selectedArea.lat, lon: selectedArea.lon };
      locationDisplay = selectedArea.displayName + (selectedCity ? `, ${selectedCity.displayName}` : '');
    } else if (selectedCity) {
      // Priority 3: Selected city from autocomplete
      searchCenter = { lat: selectedCity.lat, lon: selectedCity.lon };
      locationDisplay = selectedCity.displayName;
    } else {
      // Priority 4: Fallback to geocoding the typed text
      let geocodeQuery = preferences.location.trim();
      if (preferences.neighborhood && preferences.neighborhood.trim()) {
        geocodeQuery = `${preferences.neighborhood.trim()}, ${preferences.location.trim()}`;
      }

      if (!geocodeQuery) {
        setGeocodeError('Please enter a location');
        setIsLoading(false);
        return;
      }

      try {
        const geocoded = await geocodeLocation(geocodeQuery);
        searchCenter = { lat: geocoded.lat, lon: geocoded.lon };
        locationDisplay = geocoded.displayName;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Could not find this location';
        setGeocodeError(errorMessage);
        setIsLoading(false);
        return;
      }
    }

    // Require category - no search until user selects a category
    if (!preferences.category) {
      setGeocodeError(null);
      setSearchError(null);
      setIsLoading(false);
      setHasSearched(false);  // Don't show results panel as "searched" until we actually fetch
      return;
    }

    setMapCenter(searchCenter);
    setResolvedLocation(locationDisplay);
    
    // Switch from globe to street view
    // The map will automatically fly when it detects center changed
    setIsGlobeView(false);
    console.log('[Home] Search location:', searchCenter.lat, searchCenter.lon);
    
    // Save to localStorage
    saveLocationToStorage(searchCenter, locationDisplay);
    
    const radiusMeters = Math.round((preferences.maxWalkMinutes / 60) * 4.5 * 1000);
    // Use 5km radius for map coverage but cap at API max
    const searchRadius = Math.min(Math.max(radiusMeters, 3000), 5000);

    // Create cache key
    const cacheKey = `${searchCenter.lat.toFixed(4)}|${searchCenter.lon.toFixed(4)}|${searchRadius}|${preferences.category}|${preferences.vibe}|${preferences.vegOnly}|${provider}`;
    
    // Check cache first
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[Search] Cache hit for ${preferences.category}`);
      const data = cached.data;
      setAllPlaces(data.allPlaces);
      setTopPlaces(data.topPlaces);
      const recId = data.recommended?.id || data.topPlaces[0]?.id || null;
      setRecommendedPlaceId(recId);
      setSelectedPlaceId(recId);
      setSearchStats({ before: data.totalBeforeFilter, after: data.totalAfterFilter });
      setDataSource(data.dataSource || provider);
      setSearchError(null);
      clearTimeout(loadingTimer);
      setIsLoading(false);
      return;
    }

    // Dev logging - before fetch
    console.log(`[Search] lat=${searchCenter.lat.toFixed(4)} lon=${searchCenter.lon.toFixed(4)} radius=${searchRadius} category=${preferences.category} vibe=${preferences.vibe}`);

    try {
      const fetchStart = performance.now();
      
      // Use the selected provider with abort signal
      const data = provider === 'foursquare'
        ? await fetchPlacesFoursquare(
            searchCenter.lat, searchCenter.lon, preferences.category,
            preferences.maxWalkMinutes, preferences.vegOnly, searchRadius, signal
          )
        : await fetchPlaces(
            searchCenter.lat, searchCenter.lon, preferences.category,
            preferences.maxWalkMinutes, preferences.vegOnly, preferences.vibe,
            searchRadius, signal
          );
      
      const duration = Math.round(performance.now() - fetchStart);
      
      // Store in cache
      searchCacheRef.current.set(cacheKey, { data, timestamp: Date.now() });
      
      // Dev logging - after fetch
      console.log(`[Search] returned ${data.allPlaces.length} places in ${duration}ms (source: ${data.dataSource || provider})`);
      
      setAllPlaces(data.allPlaces);
      setTopPlaces(data.topPlaces);
      // Set recommended place (from API) - single larger marker
      const recId = data.recommended?.id || data.topPlaces[0]?.id || null;
      setRecommendedPlaceId(recId);
      setSelectedPlaceId(recId);
      setSearchStats({ before: data.totalBeforeFilter, after: data.totalAfterFilter });
      setDataSource(data.dataSource || provider);
      setSearchError(null);
      // DON'T auto-call resetView() - let flyToLocation handle the zoom
    } catch (error) {
      // Ignore abort errors (user started new search)
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[Search] Request aborted (new search started)');
        return;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to search';
      if (process.env.NODE_ENV === 'development') {
        console.error(`[Search] error (${provider}): ${errorMessage}`);
      }
      setSearchError(errorMessage);
      setAllPlaces([]);
      setTopPlaces([]);
      setDataSource(null);
    } finally {
      clearTimeout(loadingTimer);
      // Only update loading state if this request wasn't aborted
      if (!signal.aborted) {
        setIsLoading(false);
        setLoadingTooLong(false);
      }
    }
  }, [preferences, usingCurrentLocation, userLocation, selectedCity, selectedArea, isGlobeView, saveLocationToStorage, provider]);

  // Memoized handlers - only update selectedId, no re-sorting
  const handleSelectPlace = useCallback((place: Place) => {
    setSelectedPlaceId((prev) => {
      if (prev === place.id) return prev; // No change
      mapRef.current?.panToPlace(place);
      return place.id;
    });
  }, []);

  const handleMarkerSelect = useCallback((place: Place) => {
    setSelectedPlaceId((prev) => prev === place.id ? prev : place.id);
  }, []);

  const handlePreferencesChange = useCallback((newPrefs: Preferences) => {
    // If user types in location, disable "using current location" mode
    if (newPrefs.location !== preferences.location) {
      setUsingCurrentLocation(false);
    }
    setPreferences(newPrefs);
  }, [preferences.location]);
  
  // Create a filter key that changes when any filter changes (include category so switch triggers search)
  const filterKey = `${preferences.category ?? ''}|${preferences.vibe ?? ''}|${preferences.maxWalkMinutes}|${preferences.vegOnly}`;
  const debouncedFilterKey = useDebounce(filterKey, 150);
  
  const isInitialMount = useRef(true);
  const prevFilterKey = useRef(filterKey);
  
  // Auto-search when filters change (including category) - only when we have location AND a category selected
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevFilterKey.current = debouncedFilterKey;
      return;
    }
    
    if (debouncedFilterKey === prevFilterKey.current) {
      return;
    }
    
    const hasLocation = usingCurrentLocation || selectedCity || selectedArea;
    const hasCategory = preferences.category != null;
    
    // Require both location and category; trigger even if loading (handleSearch will abort and refetch)
    if (hasLocation && hasCategory) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Home] Filters changed - auto-searching:', debouncedFilterKey);
      }
      prevFilterKey.current = debouncedFilterKey;
      handleSearch();
    }
  }, [debouncedFilterKey, preferences.category, usingCurrentLocation, selectedCity, selectedArea, handleSearch]);
  
  // Also auto-search when location is selected (city or area)
  const prevLocationRef = useRef<string | null>(null);
  useEffect(() => {
    const currentLocationKey = selectedCity?.displayName || selectedArea?.displayName || (usingCurrentLocation ? 'current' : null);
    
    if (currentLocationKey && currentLocationKey !== prevLocationRef.current && !isLoading) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Home] Location selected - auto-searching:', currentLocationKey);
      }
      prevLocationRef.current = currentLocationKey;
      handleSearch();
    }
  }, [selectedCity, selectedArea, usingCurrentLocation, isLoading, handleSearch]);

  // Handle city selection from autocomplete
  const handleSelectCity = useCallback((city: SelectedLocation | null) => {
    setSelectedCity(city);
    setUsingCurrentLocation(false);
    if (city) {
      // Clear area when city changes
      setSelectedArea(null);
    }
  }, []);

  // Handle area selection from autocomplete  
  const handleSelectArea = useCallback((area: SelectedLocation | null) => {
    setSelectedArea(area);
  }, []);

  // Memoize topPlaceIds to avoid unnecessary map re-renders
  const topPlaceIds = useMemo(() => topPlaces.map(p => p.id), [topPlaces]);

  return (
    <div className="min-h-screen">
      {/* Premium Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700"></div>
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyek0zNiAyNHYySDI0di0yaDEyeiIvPjwvZz48L2c+PC9zdmc+')] opacity-50"></div>
        
        <div className="relative container mx-auto max-w-7xl px-4 py-10 md:py-14">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-white">
                    Global Travel Intelligence
                  </h1>
                  <p className="text-blue-100 text-sm md:text-base">
                    Discover places anywhere in the world with explainable AI
                  </p>
                </div>
              </div>
              
              {/* Badges */}
              <div className="flex flex-wrap gap-2 mt-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/20 backdrop-blur rounded-full text-xs font-medium text-white">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                  OpenStreetMap + Nominatim
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/20 backdrop-blur rounded-full text-xs font-medium text-white">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                  Explainable Ranking
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/20 backdrop-blur rounded-full text-xs font-medium text-white">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM4.5 10a5.5 5.5 0 1111 0 5.5 5.5 0 01-11 0z" />
                  </svg>
                  100% Free & Open
                </span>
              </div>
            </div>
            
            {/* Stats (only show after search) */}
            {searchStats && (
              <div className="flex gap-4 md:gap-6">
                <div className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-white">{searchStats.before}</div>
                  <div className="text-xs text-blue-200">Places Found</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-white">{searchStats.after}</div>
                  <div className="text-xs text-blue-200">Matched Filters</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-emerald-300">{topPlaces.length}</div>
                  <div className="text-xs text-blue-200">Top Picks</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* Left Column - Preferences */}
          <div className="w-full lg:w-96 flex-shrink-0">
            <div className="lg:sticky lg:top-6 space-y-6">
              {/* Provider Toggle */}
              <div className="card-premium-solid p-4">
                <ProviderToggle value={provider} onChange={setProvider} />
              </div>
              
              <PreferencesForm
                preferences={preferences}
                onChange={handlePreferencesChange}
                onSubmit={handleSearch}
                isLoading={isLoading}
                geocodeError={geocodeError}
                onUseMyLocation={handleUseMyLocation}
                isLocating={isLocating}
                locationError={locationError}
                usingCurrentLocation={usingCurrentLocation}
                selectedCity={selectedCity}
                onSelectCity={handleSelectCity}
                selectedArea={selectedArea}
                onSelectArea={handleSelectArea}
              />

              {/* Map Legend */}
              {allPlaces.length > 0 && (
                <div className="card-premium-solid p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Map Legend
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 border-2 border-white shadow-md"></div>
                      <span className="text-slate-600">{usingCurrentLocation ? 'Your Location' : 'Search Center'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-400 to-orange-500 border-2 border-white shadow-md"></div>
                      <span className="text-slate-600">Restaurant</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 border-2 border-white shadow-md"></div>
                      <span className="text-slate-600">Café</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-400 to-sky-500 border-2 border-white shadow-md"></div>
                      <span className="text-slate-600">Grocery Store</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 border-2 border-white shadow-md"></div>
                      <span className="text-slate-600">Scenic & Outdoors</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-400 to-purple-500 border-2 border-white shadow-md"></div>
                      <span className="text-slate-600">Indoor Activities</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Map & Results */}
          <div className="flex-1 space-y-8">
            {/* Resolved Location Banner */}
            {resolvedLocation && hasSearched && (
              <div className="flex items-center gap-3 px-5 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl animate-fade-in">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-blue-600 font-medium">Searching near</p>
                  <p className="text-sm text-slate-800 font-semibold truncate">{resolvedLocation}</p>
                </div>
              </div>
            )}

            {/* Map Card */}
            <div className="card-premium-solid overflow-hidden">
              <div className="h-[380px] md:h-[450px]">
                <MapView
                  ref={mapRef}
                  center={mapCenter}
                  places={allPlaces}
                  topPlaceIds={topPlaceIds}
                  recommendedPlaceId={recommendedPlaceId}
                  selectedPlaceId={selectedPlaceId}
                  onSelectPlace={handleMarkerSelect}
                  isGlobeView={isGlobeView}
                />
              </div>
              {allPlaces.length > 0 && (
                <div className="px-5 py-4 bg-gradient-to-r from-slate-50 to-slate-100 border-t border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-slate-600">
                      Showing <span className="font-semibold text-slate-800">{allPlaces.length}</span> places on map
                    </span>
                  </div>
                  <button
                    onClick={() => mapRef.current?.resetView()}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                    Fit All
                  </button>
                </div>
              )}
            </div>

            {/* Error State with Retry */}
            {searchError && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5 animate-fade-in">
                <div className="flex gap-4">
                  <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-red-800">Search Failed</h4>
                    <p className="text-sm text-red-700 mt-1">{searchError}</p>
                    <button
                      onClick={handleSearch}
                      className="mt-3 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded-lg transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Results Section */}
            <ResultsPanel
              places={topPlaces}
              totalNearby={allPlaces.length}
              selectedPlaceId={selectedPlaceId}
              onSelectPlace={handleSelectPlace}
              isLoading={isLoading}
              hasSearched={hasSearched}
              preferences={preferences}
              loadingTooLong={loadingTooLong}
              onRetry={handleSearch}
              dataSource={dataSource}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-16">
        <div className="container mx-auto max-w-7xl px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-sm text-slate-500">Global Travel Intelligence</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-slate-500">
              <span>Data from <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OpenStreetMap</a></span>
              <span>•</span>
              <span>Geocoding by <a href="https://nominatim.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Nominatim</a></span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
