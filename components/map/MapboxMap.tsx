'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { Place, LatLon } from '@/lib/types';
import 'mapbox-gl/dist/mapbox-gl.css';

export interface MapboxMapHandle {
  panToPlace: (place: Place) => void;
  resetView: () => void;
  flyToLocation: (center: LatLon, zoom?: number) => void;
}

interface MapboxMapProps {
  center: LatLon;  // Single source of truth for map center
  places: Place[];
  topPlaceIds: string[];
  recommendedPlaceId: string | null;  // Single recommended place (1.6x larger marker)
  selectedPlaceId: string | null;
  onSelectPlace: (place: Place) => void;
  mapboxToken: string;
  isGlobeView?: boolean;  // true = show globe, false = show mercator at center
}

// Debug info for dev mode
interface DebugInfo {
  center: [number, number];
  zoom: number;
  projection: string;
}

// Helper to check if we have a valid location (not default 0,0)
const hasValidLocation = (center: LatLon): boolean => {
  return center.lat !== 0 || center.lon !== 0;
};

// Simple, clean category colors (no gradients, no blur - just solid colors)
const CATEGORY_COLORS: Record<string, { bg: string; border: string; letter: string }> = {
  restaurant: { bg: '#ef4444', border: '#b91c1c', letter: 'R' },  // Red
  cafe: { bg: '#f59e0b', border: '#b45309', letter: 'C' },        // Amber
  grocery: { bg: '#3b82f6', border: '#1d4ed8', letter: 'G' },     // Blue
  scenic: { bg: '#22c55e', border: '#15803d', letter: 'S' },      // Green
  indoor: { bg: '#8b5cf6', border: '#6d28d9', letter: 'I' },      // Purple
};

const IS_DEV = process.env.NODE_ENV === 'development';
const CATEGORIES = ['restaurant', 'cafe', 'grocery', 'scenic', 'indoor'];

// Icon sizes - kept small for clean rendering
const ICON_SIZE_NORMAL = 24;  // 24x24 for normal places
const ICON_SIZE_LARGE = 32;   // 32x32 for top places
const ICON_SIZE_RECOMMENDED = 40;  // 40x40 for recommended place (1.6x larger)

/**
 * Create a simple, clean marker icon (small colored circle with letter)
 * Produces tightly cropped icons without extra padding or effects
 */
function createSimpleIcon(category: string, size: number, isTop: boolean = false): ImageData {
  // Dev warning if icon is too large
  if (IS_DEV && size > 64) {
    console.warn(`[Mapbox] icon ${category} is large (${size}x${size}). Use 32px max.`);
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  
  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.restaurant;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = (size / 2) - 2;  // Leave 2px margin
  
  // Clear with transparency
  ctx.clearRect(0, 0, size, size);
  
  // Subtle drop shadow
  ctx.beginPath();
  ctx.arc(centerX, centerY + 1, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fill();
  
  // Main circle (solid color, no gradient)
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  
  // Border
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = isTop ? '#ffffff' : colors.border;
  ctx.lineWidth = isTop ? 2 : 1;
  ctx.stroke();
  
  // Letter in center
  const fontSize = Math.round(radius * 1.1);
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(colors.letter, centerX, centerY + 1);
  
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Load an image icon (SVG or PNG) from /public/icons/ and register it with the map
 */
async function loadImageIcon(map: mapboxgl.Map, iconName: string, imagePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Remove existing icon first
      if (map.hasImage(iconName)) {
        map.removeImage(iconName);
      }
      map.addImage(iconName, img, { sdf: false });
      if (IS_DEV) console.log(`[Mapbox] loaded icon: ${iconName} (${img.width}x${img.height})`);
      resolve(true);
    };
    img.onerror = () => {
      if (IS_DEV) console.warn(`[Mapbox] Icon not found: ${imagePath}`);
      resolve(false);
    };
    img.src = imagePath;
  });
}

/**
 * Register all category icons with the map
 * Tries SVG first (best quality), then PNG, falls back to canvas-generated icons
 */
async function registerIcons(map: mapboxgl.Map): Promise<void> {
  for (const category of CATEGORIES) {
    const iconName = `icon-${category}`;
    const svgPath = `/icons/${category}.svg`;
    const pngPath = `/icons/${category}.png`;
    
    // Try SVG first (best quality, scales perfectly)
    let loaded = await loadImageIcon(map, iconName, svgPath);
    
    // Try PNG if SVG not found
    if (!loaded) {
      loaded = await loadImageIcon(map, iconName, pngPath);
    }
    
    // Fallback to canvas-generated icon if no image found
    if (!loaded) {
      if (map.hasImage(iconName)) {
        map.removeImage(iconName);
      }
      const size = ICON_SIZE_NORMAL;
      const imageData = createSimpleIcon(category, size, false);
      map.addImage(iconName, { width: size, height: size, data: imageData.data }, { sdf: false });
      if (IS_DEV) console.log(`[Mapbox] fallback icon: ${iconName} (${size}x${size})`);
    }
    
    // For large icons - try SVG/PNG first, then canvas fallback
    const largeIconName = `icon-${category}-large`;
    let largeLoaded = await loadImageIcon(map, largeIconName, svgPath);
    
    if (!largeLoaded) {
      largeLoaded = await loadImageIcon(map, largeIconName, pngPath);
    }
    
    if (!largeLoaded) {
      if (map.hasImage(largeIconName)) {
        map.removeImage(largeIconName);
      }
      const size = ICON_SIZE_LARGE;
      const imageData = createSimpleIcon(category, size, true);
      map.addImage(largeIconName, { width: size, height: size, data: imageData.data }, { sdf: false });
      if (IS_DEV) console.log(`[Mapbox] fallback icon: ${largeIconName} (${size}x${size})`);
    }
  }
}

// Create popup HTML
const getPopupHtml = (place: Place, isTopPlace: boolean, topRank: number): string => {
  const colors = CATEGORY_COLORS[place.category] || CATEGORY_COLORS.restaurant;
  return `
    <div style="padding: 12px; min-width: 200px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      ${isTopPlace ? `
        <div style="
          display: inline-flex; align-items: center; gap: 6px;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          color: white; font-size: 11px; font-weight: 600;
          padding: 4px 10px; border-radius: 20px; margin-bottom: 10px;
        ">
          <span>🏆</span> #${topRank} Recommendation
        </div>
      ` : ''}
      <div style="font-weight: 700; color: #1e293b; font-size: 16px; margin-bottom: 6px;">${place.name}</div>
      <div style="
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 12px; color: #64748b; margin-bottom: 10px;
      ">
        <span style="
          width: 8px; height: 8px; border-radius: 50%;
          background: ${colors.bg};
        "></span>
        ${place.type}
      </div>
      <div style="display: flex; gap: 12px; font-size: 13px; color: #475569; margin-bottom: 10px;">
        <span style="display: flex; align-items: center; gap: 4px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          ${place.distanceKm} km
        </span>
        <span style="display: flex; align-items: center; gap: 4px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          ${place.walkMins} min
        </span>
      </div>
      ${place.vegFriendly ? `
        <div style="padding-top: 10px; border-top: 1px solid #e2e8f0;">
          <span style="
            font-size: 11px; background: linear-gradient(135deg, #dcfce7, #bbf7d0);
            color: #166534; padding: 3px 8px; border-radius: 12px; font-weight: 500;
          ">🥬 Veg-friendly</span>
        </div>
      ` : ''}
    </div>
  `;
};

const MapboxMap = forwardRef<MapboxMapHandle, MapboxMapProps>(
  ({ center, places, topPlaceIds, recommendedPlaceId, selectedPlaceId, onSelectPlace, mapboxToken, isGlobeView = false }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const popupRef = useRef<mapboxgl.Popup | null>(null);
    const centerMarkerRef = useRef<mapboxgl.Marker | null>(null);
    const mapLoadedRef = useRef(false);
    const iconsLoadedRef = useRef(false);
    const lastAppliedCenterRef = useRef<string>('');  // Track last applied center to avoid duplicate flyTo
    const flyingToLocationRef = useRef(false);  // Prevent auto-fit during flyTo animation
    const [mapError, setMapError] = useState<string | null>(null);
    const [showGlobeOverlay, setShowGlobeOverlay] = useState(isGlobeView && !hasValidLocation(center));
    const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
    const [tooManyPlaces, setTooManyPlaces] = useState(false);  // Performance warning
    
    // Update debug info
    const updateDebugInfo = useCallback(() => {
      if (mapRef.current) {
        const c = mapRef.current.getCenter();
        const info = {
          center: [c.lat, c.lng] as [number, number],
          zoom: Math.round(mapRef.current.getZoom() * 10) / 10,
          projection: mapRef.current.getProjection()?.name || 'unknown',
        };
        setDebugInfo(info);
        if (IS_DEV) {
          console.log('[Mapbox] Debug:', info);
        }
      }
    }, []);
    
    // Globe overlay: show only when isGlobeView=true AND no valid location
    useEffect(() => {
      const shouldShowGlobe = isGlobeView && !hasValidLocation(center);
      setShowGlobeOverlay(shouldShowGlobe);
      if (IS_DEV) {
        console.log('[Mapbox] Globe overlay:', shouldShowGlobe, 'isGlobeView:', isGlobeView, 'hasLocation:', hasValidLocation(center));
      }
    }, [isGlobeView, center]);

    // Create set for O(1) lookup
    const topIdsSet = useMemo(() => new Set(topPlaceIds), [topPlaceIds]);

    // Create places lookup map
    const placesMap = useMemo(() => {
      const map = new Map<string, Place>();
      places.forEach(p => map.set(p.id, p));
      return map;
    }, [places]);
    
    // Refs for handlers to access latest data (avoids stale closures)
    const placesMapRef = useRef<Map<string, Place>>(placesMap);
    const topPlaceIdsRef = useRef<string[]>(topPlaceIds);
    const onSelectPlaceRef = useRef(onSelectPlace);
    
    // Keep refs updated
    useEffect(() => {
      placesMapRef.current = placesMap;
      topPlaceIdsRef.current = topPlaceIds;
      onSelectPlaceRef.current = onSelectPlace;
    }, [placesMap, topPlaceIds, onSelectPlace]);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      panToPlace: (place: Place) => {
        if (mapRef.current) {
          mapRef.current.flyTo({
            center: [place.lon, place.lat],
            zoom: 17,
            duration: 1000,
            essential: true,
          });
        }
      },
      resetView: () => {
        if (mapRef.current && places.length > 0) {
          const bounds = new mapboxgl.LngLatBounds();
          bounds.extend([center.lon, center.lat]);
          places.forEach(p => bounds.extend([p.lon, p.lat]));
          mapRef.current.fitBounds(bounds, {
            padding: { top: 80, bottom: 80, left: 60, right: 60 },
            maxZoom: 16,
            minZoom: 13, // Ensures ~5km view
            duration: 1000,
          });
        } else if (mapRef.current) {
          mapRef.current.flyTo({
            center: [center.lon, center.lat],
            zoom: 14, // ~5km radius
            duration: 1000,
          });
        }
      },
      flyToLocation: (newCenter: LatLon, zoom: number = 13) => {
        const map = mapRef.current;
        if (!map) {
          console.warn('[Mapbox] flyToLocation: map not ready');
          return;
        }
        
        if (IS_DEV) {
          console.log('[Mapbox] flyToLocation - lat=' + newCenter.lat + ' lon=' + newCenter.lon);
          console.log('[Mapbox] center=[' + newCenter.lon + ',' + newCenter.lat + '] (lon,lat order)');
        }
        
        // Hide globe overlay
        setShowGlobeOverlay(false);
        
        // Prevent auto-fit during animation
        flyingToLocationRef.current = true;
        
        // Switch projection to mercator and fly
        map.setProjection('mercator');
        map.flyTo({
          center: [newCenter.lon, newCenter.lat],  // Mapbox uses [lon, lat]
          zoom: zoom,
          essential: true,
          duration: 2000,
        });
        
        // 3. Update debug and reset flag after animation completes
        map.once('moveend', () => {
          flyingToLocationRef.current = false;
          updateDebugInfo();
        });
        
        // Track this center as applied
        lastAppliedCenterRef.current = `${newCenter.lat},${newCenter.lon}`;
      },
    }), [center, places, updateDebugInfo]);

    // Helper to show popup
    const showPopup = (map: mapboxgl.Map, place: Place, isTop: boolean, rank: number) => {
      if (popupRef.current) {
        popupRef.current.remove();
      }
      popupRef.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '300px',
        offset: 25,
        className: 'modern-popup',
      })
        .setLngLat([place.lon, place.lat])
        .setHTML(getPopupHtml(place, isTop, rank))
        .addTo(map);
    };

    // Initialize map
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;

      mapboxgl.accessToken = mapboxToken;

      if (IS_DEV) {
        console.log('[MapboxMap] Initializing, globe view:', isGlobeView);
      }

      // Initial state based on isGlobeView
      const initialCenter: [number, number] = isGlobeView ? [0, 20] : [center.lon, center.lat];
      const initialZoom = isGlobeView ? 1.5 : 15;
      const initialProjection = isGlobeView ? 'globe' : 'mercator';

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: initialCenter,
        zoom: initialZoom,
        projection: initialProjection,
        attributionControl: true,
        antialias: true,
      });

      mapRef.current = map;

      // Add atmosphere for globe view (no rotation - it causes coordinate issues)
      if (isGlobeView && !hasValidLocation(center)) {
        map.on('style.load', () => {
          map.setFog({
            color: 'rgb(186, 210, 235)',
            'high-color': 'rgb(36, 92, 223)',
            'horizon-blend': 0.02,
            'space-color': 'rgb(11, 11, 25)',
            'star-intensity': 0.6,
          });
        });
        console.log('[Mapbox] Initialized in globe view');
      }

      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      map.on('error', (e) => {
        const errorMsg = e.error?.message || 'Map failed to load';
        console.error('[MapboxMap] Error:', errorMsg);
        if (errorMsg.includes('401') || errorMsg.includes('access token')) {
          setMapError('Invalid Mapbox token');
        }
      });

      // Track zoom/move changes for debug info
      if (IS_DEV) {
        map.on('moveend', () => {
          const c = map.getCenter();
          setDebugInfo({
            center: [c.lat, c.lng],
            zoom: Math.round(map.getZoom() * 10) / 10,
            projection: map.getProjection()?.name || 'unknown',
          });
        });
      }

      map.on('load', () => {
        if (IS_DEV) console.log('[MapboxMap] Loaded, registering icons...');
        mapLoadedRef.current = true;

        // Register all icons (async - loads PNGs from /public/icons/)
        registerIcons(map).then(() => {
          iconsLoadedRef.current = true;
          if (IS_DEV) console.log('[Mapbox] All icons registered');
        });

        // === DATA SOURCES ===
        
        // Source for RECOMMENDED place (single, largest marker)
        map.addSource('source-recommended', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        
        // Source for TOP places (no clustering)
        map.addSource('source-top', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // Source for OTHER places (NO clustering - show all individual icons)
        map.addSource('source-other', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: false,  // Disabled: show all places as individual icons
        });

        // === LAYERS ===

        // OTHER markers (normal size, allow some overlap control)
        map.addLayer({
          id: 'other-points',
          type: 'symbol',
          source: 'source-other',
          layout: {
            'icon-image': ['concat', 'icon-', ['get', 'category']],
            'icon-size': 0.8,  // 24px * 0.8 = ~19px on map
            'icon-allow-overlap': false,  // Avoid messy overlaps for normal places
            'icon-ignore-placement': false,
            'icon-anchor': 'center',
            'icon-padding': 2,
          },
          paint: { 'icon-opacity': 0.85 },
        });

        // TOP markers (larger, always visible on top)
        map.addLayer({
          id: 'top-points',
          type: 'symbol',
          source: 'source-top',
          layout: {
            'icon-image': ['concat', 'icon-', ['get', 'category'], '-large'],
            'icon-size': 1.0,  // 32px * 1.0 = 32px on map
            'icon-allow-overlap': true,   // Top places always visible
            'icon-ignore-placement': true,
            'icon-anchor': 'center',
          },
          paint: { 'icon-opacity': 1 },
        });
        
        // RECOMMENDED marker (1.6x larger, most prominent, on top of everything)
        map.addLayer({
          id: 'recommended-point',
          type: 'symbol',
          source: 'source-recommended',
          layout: {
            'icon-image': ['concat', 'icon-', ['get', 'category'], '-large'],
            'icon-size': 1.6,  // 32px * 1.6 = ~51px on map (1.6x larger)
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-anchor': 'center',
          },
          paint: { 'icon-opacity': 1 },
        });

        // === CLICK & HOVER HANDLERS ===
        
        // Helper to handle marker interaction (click or hover)
        const handleMarkerInteraction = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }, layerType: 'recommended' | 'top' | 'other') => {
          const feature = e.features?.[0];
          if (!feature?.properties?.id) return;
          
          const placeId = feature.properties.id as string;
          const place = placesMapRef.current.get(placeId);
          
          if (!place) {
            if (IS_DEV) console.warn('[Mapbox] Place not found for id:', placeId);
            return;
          }
          
          // Determine rank for popup display
          let isTop = false;
          let rank = 0;
          
          if (layerType === 'recommended') {
            isTop = true;
            rank = 1;
          } else if (layerType === 'top') {
            isTop = true;
            rank = topPlaceIdsRef.current.indexOf(place.id) + 1;
          }
          
          onSelectPlaceRef.current(place);
          showPopup(map, place, isTop, rank);
        };

        // Click handlers for all layers
        map.on('click', 'recommended-point', (e) => handleMarkerInteraction(e, 'recommended'));
        map.on('click', 'top-points', (e) => handleMarkerInteraction(e, 'top'));
        map.on('click', 'other-points', (e) => handleMarkerInteraction(e, 'other'));

        // Hover handlers for all layers (show popup on hover too)
        map.on('mouseenter', 'recommended-point', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          handleMarkerInteraction(e, 'recommended');
        });
        map.on('mouseenter', 'top-points', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          handleMarkerInteraction(e, 'top');
        });
        map.on('mouseenter', 'other-points', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          handleMarkerInteraction(e, 'other');
        });
        
        // Mouse leave - reset cursor (popup stays until user clicks elsewhere or hovers another)
        ['recommended-point', 'top-points', 'other-points'].forEach(layer => {
          map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = '';
          });
        });

        if (IS_DEV) console.log('[MapboxMap] All layers ready');
      });

      return () => {
        map.remove();
        mapRef.current = null;
        mapLoadedRef.current = false;
        iconsLoadedRef.current = false;
      };
    // Only re-initialize on token change, NOT on isGlobeView change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapboxToken]);

    // CRITICAL: When center changes to a valid location, fly to it
    // This is the single effect that handles the globe->mercator transition
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      
      const centerKey = `${center.lat},${center.lon}`;
      const alreadyApplied = lastAppliedCenterRef.current === centerKey;
      
      // If we have a valid location and haven't already flown there
      if (hasValidLocation(center) && !alreadyApplied) {
        // Prevent auto-fit during animation
        flyingToLocationRef.current = true;
        
        if (IS_DEV) {
          console.log('[Mapbox] Center changed - lat=' + center.lat + ' lon=' + center.lon);
          console.log('[Mapbox] flyTo center=[' + center.lon + ',' + center.lat + '] (lon,lat order)');
        }
        
        map.setProjection('mercator');
        map.flyTo({
          center: [center.lon, center.lat],  // Mapbox uses [lon, lat]
          zoom: 13,
          essential: true,
          duration: 2000,
        });
        
        setShowGlobeOverlay(false);
        lastAppliedCenterRef.current = centerKey;
        
        map.once('moveend', () => {
          flyingToLocationRef.current = false;
          updateDebugInfo();
        });
      }
    }, [center, updateDebugInfo]);

    // Update center marker
    useEffect(() => {
      if (!mapRef.current || !mapLoadedRef.current) return;
      
      // Don't show marker in globe view or at default center
      if (isGlobeView || (center.lat === 0 && center.lon === 0)) {
        if (centerMarkerRef.current) {
          centerMarkerRef.current.remove();
          centerMarkerRef.current = null;
        }
        return;
      }

      if (centerMarkerRef.current) {
        centerMarkerRef.current.remove();
      }

      const el = document.createElement('div');
      el.innerHTML = `
        <div class="center-marker">
          <div class="center-marker-pulse"></div>
          <div class="center-marker-dot"></div>
          <div class="center-marker-label">You</div>
        </div>
      `;

      centerMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([center.lon, center.lat])
        .addTo(mapRef.current);

    }, [center.lon, center.lat, isGlobeView]);

    // Update GeoJSON data
    useEffect(() => {
      if (!mapRef.current || !mapLoadedRef.current || !iconsLoadedRef.current) return;
      if (!mapRef.current.getSource('source-top') || !mapRef.current.getSource('source-other') || !mapRef.current.getSource('source-recommended')) return;

      const map = mapRef.current;
      const recommendedFeatures: GeoJSON.Feature[] = [];
      const topFeatures: GeoJSON.Feature[] = [];
      const otherFeatures: GeoJSON.Feature[] = [];
      
      // Performance guard: limit to 200 places max
      const MAX_DISPLAY_PLACES = 200;
      const hasExceeded = places.length > MAX_DISPLAY_PLACES;
      setTooManyPlaces(hasExceeded);
      
      // Sort by distance if we need to limit (places should already be sorted, but ensure)
      const placesToShow = hasExceeded 
        ? [...places].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, MAX_DISPLAY_PLACES)
        : places;

      placesToShow.forEach((place) => {
        const isRecommended = place.id === recommendedPlaceId;
        const isTop = topIdsSet.has(place.id) && !isRecommended;  // Don't double-show recommended
        const feature: GeoJSON.Feature = {
          type: 'Feature',
          properties: {
            id: place.id,
            name: place.name,
            category: place.category,
            isTop,
            isRecommended,
          },
          geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
        };

        if (isRecommended) {
          recommendedFeatures.push(feature);
        } else if (isTop) {
          topFeatures.push(feature);
        } else {
          otherFeatures.push(feature);
        }
      });

      // Update all three sources
      (map.getSource('source-recommended') as mapboxgl.GeoJSONSource).setData({
        type: 'FeatureCollection', features: recommendedFeatures,
      });
      (map.getSource('source-top') as mapboxgl.GeoJSONSource).setData({
        type: 'FeatureCollection', features: topFeatures,
      });
      (map.getSource('source-other') as mapboxgl.GeoJSONSource).setData({
        type: 'FeatureCollection', features: otherFeatures,
      });

      if (IS_DEV) {
        console.log(`[MapboxMap] Data updated: ${recommendedFeatures.length} recommended, ${topFeatures.length} top, ${otherFeatures.length} other${hasExceeded ? ` (limited from ${places.length})` : ''}`);
      }

      // DON'T auto-fit if we're currently flying to a location
      if (flyingToLocationRef.current) {
        if (IS_DEV) {
          console.log('[MapboxMap] Skipping auto-fit (flying to location)');
        }
        return;
      }

      // Fit bounds only when we have places and valid center
      if (places.length > 0 && (center.lat !== 0 || center.lon !== 0)) {
        // Ensure mercator projection
        if (map.getProjection()?.name === 'globe') {
          map.setProjection('mercator');
          setShowGlobeOverlay(false);
        }
        
        // Calculate bounds
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([center.lon, center.lat]);
        places.forEach(p => bounds.extend([p.lon, p.lat]));
        
        // Check current zoom - only auto-fit if result would be >= 11
        const currentZoom = map.getZoom();
        if (currentZoom < 10) {
          // Zoom is too low, fly to center first at street level
          map.flyTo({
            center: [center.lon, center.lat],
            zoom: 13,
            speed: 1.2,
            curve: 1.4,
            essential: true,
          });
          
          if (IS_DEV) {
            console.log('[MapboxMap] Flying to center (zoom was too low:', currentZoom, ')');
          }
        }
        // If zoom is already reasonable, we don't auto-fit - let user use "Fit All"
        
        updateDebugInfo();
      }
    }, [places, topIdsSet, recommendedPlaceId, center.lon, center.lat, updateDebugInfo]);

    // Update selection styling
    useEffect(() => {
      if (!mapRef.current || !mapLoadedRef.current) return;
      const map = mapRef.current;
      if (!map.getLayer('top-points')) return;

      const selectedId = selectedPlaceId || '';

      // Animate selected marker (scale up slightly when selected)
      map.setLayoutProperty('top-points', 'icon-size', [
        'case', ['==', ['get', 'id'], selectedId], 1.2, 1.0
      ]);
      map.setLayoutProperty('other-points', 'icon-size', [
        'case', ['==', ['get', 'id'], selectedId], 1.0, 0.8
      ]);

      // Show popup
      if (selectedPlaceId) {
        const place = placesMap.get(selectedPlaceId);
        if (place) {
          const isTop = topIdsSet.has(place.id);
          showPopup(map, place, isTop, isTop ? topPlaceIds.indexOf(place.id) + 1 : 0);
        }
      }
    }, [selectedPlaceId, placesMap, topIdsSet, topPlaceIds]);

    return (
      <div className="relative w-full h-full" style={{ minHeight: '350px' }}>
        <div ref={containerRef} className="w-full h-full" />
        
        {/* Globe overlay */}
        {showGlobeOverlay && (
          <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-10 z-10">
            <div className="globe-overlay-card">
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="globe-search-icon">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <span className="text-slate-700 font-semibold">Search a city or use your location</span>
              </div>
              <p className="text-sm text-slate-500">Discover amazing places around the world</p>
            </div>
          </div>
        )}
        
        {/* Performance warning */}
        {tooManyPlaces && !showGlobeOverlay && (
          <div className="absolute top-2 left-2 right-2 z-10 pointer-events-none">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 shadow-sm pointer-events-auto">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-xs text-amber-800">
                  Too many places ({places.length}). Showing closest 200. Reduce radius for better performance.
                </span>
              </div>
            </div>
          </div>
        )}
        
        {/* Error overlay */}
        {mapError && (
          <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center z-20">
            <div className="bg-white rounded-2xl p-8 mx-4 max-w-md text-center shadow-2xl">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Map Error</h3>
              <p className="text-slate-600">{mapError}</p>
            </div>
          </div>
        )}

        {/* Debug overlay (dev only) */}
        {IS_DEV && debugInfo && (
          <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded font-mono z-10">
            Center: {debugInfo.center[0].toFixed(4)}, {debugInfo.center[1].toFixed(4)} | Zoom: {debugInfo.zoom} | Projection: {debugInfo.projection}
          </div>
        )}

        {/* Custom styles */}
        <style jsx global>{`
          .center-marker {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .center-marker-pulse {
            position: absolute;
            width: 40px;
            height: 40px;
            background: rgba(59, 130, 246, 0.3);
            border-radius: 50%;
            animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          }
          .center-marker-dot {
            width: 20px;
            height: 20px;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
            z-index: 1;
          }
          .center-marker-label {
            position: absolute;
            top: 28px;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            color: white;
            font-size: 11px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 8px;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          }
          @keyframes pulse-ring {
            0% { transform: scale(0.8); opacity: 1; }
            100% { transform: scale(2); opacity: 0; }
          }
          .globe-overlay-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border-radius: 20px;
            padding: 20px 28px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.8);
            text-align: center;
            animation: float-up 0.8s ease-out;
          }
          .globe-search-icon {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          @keyframes float-up {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .modern-popup .mapboxgl-popup-content {
            padding: 0;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
            overflow: hidden;
          }
          .modern-popup .mapboxgl-popup-tip {
            border-top-color: white;
          }
          .mapboxgl-popup-close-button {
            font-size: 20px;
            padding: 8px 12px;
            color: #64748b;
          }
          .mapboxgl-popup-close-button:hover {
            background: #f1f5f9;
            color: #1e293b;
          }
        `}</style>
      </div>
    );
  }
);

MapboxMap.displayName = 'MapboxMap';

export default MapboxMap;
