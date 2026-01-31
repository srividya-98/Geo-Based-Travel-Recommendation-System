'use client';

import { useEffect, useState, forwardRef, useImperativeHandle, useRef } from 'react';
import { Place, LatLon } from '@/lib/types';
import type { MapClientHandle } from './MapClient';
import type { MapboxMapHandle } from './MapboxMap';

export interface MapViewHandle {
  panToPlace: (place: Place) => void;
  resetView: () => void;
  flyToLocation: (center: LatLon, zoom?: number) => void;
}

interface MapViewProps {
  center: LatLon;
  places: Place[];
  topPlaceIds: string[];
  recommendedPlaceId: string | null;  // Single recommended place (1.6x larger marker)
  selectedPlaceId: string | null;
  onSelectPlace: (place: Place) => void;
  isGlobeView?: boolean;  // Whether to show globe view (no location selected yet)
}

// Check for Mapbox token at module level
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const IS_DEV = process.env.NODE_ENV === 'development';

// Renderer type
type RendererType = 'mapbox' | 'leaflet' | null;

const MapView = forwardRef<MapViewHandle, MapViewProps>(
  ({ center, places, topPlaceIds, recommendedPlaceId, selectedPlaceId, onSelectPlace, isGlobeView = false }, ref) => {
    const [isLoading, setIsLoading] = useState(true);
    const [renderer, setRenderer] = useState<RendererType>(null);
    const [MapComponent, setMapComponent] = useState<React.ComponentType<any> | null>(null);
    
    const mapClientRef = useRef<MapClientHandle | MapboxMapHandle>(null);

    // Forward methods to parent
    useImperativeHandle(ref, () => ({
      panToPlace: (place: Place) => {
        mapClientRef.current?.panToPlace(place);
      },
      resetView: () => {
        mapClientRef.current?.resetView();
      },
      flyToLocation: (newCenter: LatLon, zoom?: number) => {
        if ('flyToLocation' in (mapClientRef.current || {})) {
          (mapClientRef.current as MapboxMapHandle).flyToLocation?.(newCenter, zoom);
        }
      },
    }));

    useEffect(() => {
      const loadMapComponent = async () => {
        // Check if Mapbox token is available and valid
        const hasValidToken = MAPBOX_TOKEN && MAPBOX_TOKEN.startsWith('pk.');
        
        if (hasValidToken) {
          try {
            // Dynamically import Mapbox GL JS
            const MapboxModule = await import('./MapboxMap');
            setMapComponent(() => MapboxModule.default);
            setRenderer('mapbox');
            
            console.log('[Map] renderer=mapbox');
            if (IS_DEV) {
              console.log('[Map] Mapbox GL JS initialized with token:', MAPBOX_TOKEN?.substring(0, 20) + '...');
            }
          } catch (error) {
            console.error('[Map] Failed to load Mapbox GL JS:', error);
            console.warn('[Map] Falling back to Leaflet/OSM');
            
            // Fallback to Leaflet/OSM
            const LeafletModule = await import('./MapClient');
            setMapComponent(() => LeafletModule.default);
            setRenderer('leaflet');
            console.log('[Map] renderer=leaflet (fallback)');
          }
        } else {
          // No valid token - use Leaflet/OSM
          if (IS_DEV) {
            if (MAPBOX_TOKEN) {
              console.warn('[Map] Invalid Mapbox token format (should start with "pk.")');
            } else {
              console.log('[Map] No NEXT_PUBLIC_MAPBOX_TOKEN found');
            }
          }
          
          const LeafletModule = await import('./MapClient');
          setMapComponent(() => LeafletModule.default);
          setRenderer('leaflet');
          console.log('[Map] renderer=leaflet');
        }
        
        setIsLoading(false);
      };

      loadMapComponent();
    }, []);

    // Loading state
    if (isLoading || !MapComponent) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center rounded-2xl relative">
          <div className="text-center">
            <div className="relative w-12 h-12 mx-auto mb-3">
              <div className="absolute inset-0 rounded-full border-4 border-slate-200"></div>
              <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
            </div>
            <p className="text-slate-500 text-sm font-medium">Loading map...</p>
          </div>
        </div>
      );
    }

    // Render map with dev overlay
    return (
      <div className="relative w-full h-full">
        {/* DEV-ONLY Renderer Overlay */}
        {IS_DEV && renderer && (
          <div className="absolute top-2 left-2 z-50 pointer-events-none">
            <div className={`
              px-2 py-1 rounded text-xs font-mono font-medium shadow-sm
              ${renderer === 'mapbox' 
                ? 'bg-blue-600 text-white' 
                : 'bg-emerald-600 text-white'}
            `}>
              {renderer === 'mapbox' ? '🗺️ Mapbox GL JS' : '🍃 Leaflet/OSM'}
            </div>
          </div>
        )}

        {/* Map Component */}
        {renderer === 'mapbox' && MAPBOX_TOKEN ? (
          <MapComponent
            ref={mapClientRef}
            center={center}
            places={places}
            topPlaceIds={topPlaceIds}
            recommendedPlaceId={recommendedPlaceId}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={onSelectPlace}
            mapboxToken={MAPBOX_TOKEN}
            isGlobeView={isGlobeView}
          />
        ) : (
          <MapComponent
            ref={mapClientRef}
            center={center}
            places={places}
            topPlaceIds={topPlaceIds}
            recommendedPlaceId={recommendedPlaceId}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={onSelectPlace}
            isGlobeView={isGlobeView}
          />
        )}
      </div>
    );
  }
);

MapView.displayName = 'MapView';

export default MapView;
