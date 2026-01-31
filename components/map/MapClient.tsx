'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Place, LatLon } from '@/lib/types';

export interface MapClientHandle {
  panToPlace: (place: Place) => void;
  resetView: () => void;
  flyToLocation?: (center: LatLon, zoom?: number) => void;
}

interface MapClientProps {
  center: LatLon;
  places: Place[];
  topPlaceIds: string[];
  selectedPlaceId: string | null;
  onSelectPlace: (place: Place) => void;
  isGlobeView?: boolean;
}

// Category colors
const CATEGORY_COLORS: Record<string, string> = {
  restaurant: '#f97316',
  cafe: '#f59e0b',
  grocery: '#0ea5e9',
  scenic: '#22c55e',
  indoor: '#8b5cf6',
  default: '#6b7280',
};

// Category emoji icons
const CATEGORY_EMOJI: Record<string, string> = {
  restaurant: '🍽️',
  cafe: '☕',
  grocery: '🛒',
  scenic: '🌳',
  indoor: '🏛️',
};

const getCategoryColor = (category: string): string => {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
};

const getCategoryEmoji = (category: string): string => {
  return CATEGORY_EMOJI[category] || '📍';
};

// Icon cache
const iconCache = new Map<string, L.DivIcon>();

// Create category icon with emoji
const getPlaceIcon = (category: string, isTop: boolean, isSelected: boolean): L.DivIcon => {
  const cacheKey = `place-${category}-${isTop}-${isSelected}`;
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const color = getCategoryColor(category);
  const emoji = getCategoryEmoji(category);
  
  // Top places: larger, full opacity
  // Non-top: smaller, lighter
  const size = isTop ? (isSelected ? 42 : 36) : (isSelected ? 32 : 28);
  const fontSize = isTop ? (isSelected ? 18 : 16) : (isSelected ? 14 : 12);
  const borderWidth = isTop ? 3 : 2;
  const opacity = isTop ? 1 : 0.85;
  const glowSize = isSelected ? size + 16 : 0;

  const icon = L.divIcon({
    className: 'custom-place-marker',
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center;">
        ${isSelected ? `
          <div style="
            position: absolute;
            width: ${glowSize}px;
            height: ${glowSize}px;
            background-color: ${color};
            border-radius: 50%;
            opacity: 0.25;
            filter: blur(6px);
          "></div>
        ` : ''}
        <div style="
          width: ${size}px;
          height: ${size}px;
          background-color: ${color};
          border: ${borderWidth}px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          opacity: ${opacity};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: ${fontSize}px;
          transition: all 0.2s ease;
        ">${emoji}</div>
      </div>
    `,
    iconSize: [size + 16, size + 16],
    iconAnchor: [(size + 16) / 2, (size + 16) / 2],
    popupAnchor: [0, -(size / 2 + 8)],
  });

  iconCache.set(cacheKey, icon);
  return icon;
};

// Center marker icon
let centerIconCache: L.DivIcon | null = null;
const getCenterIcon = (): L.DivIcon => {
  if (centerIconCache) return centerIconCache;

  centerIconCache = L.divIcon({
    className: 'custom-center-marker',
    html: `
      <div style="position: relative;">
        <div style="
          width: 18px;
          height: 18px;
          background-color: #2563eb;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.25), 0 2px 8px rgba(0,0,0,0.3);
        "></div>
        <div style="
          position: absolute;
          top: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: #2563eb;
          color: white;
          font-size: 10px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
        ">You</div>
      </div>
    `,
    iconSize: [18, 40],
    iconAnchor: [9, 9],
  });

  return centerIconCache;
};

// Generate popup HTML
const getPopupHtml = (place: Place, isTopPlace: boolean, topRank: number): string => {
  return `<div style="padding: 8px; min-width: 180px;">
    ${isTopPlace ? `<div style="font-size: 11px; font-weight: 600; color: #3b82f6; margin-bottom: 4px;">🏆 #${topRank} Recommendation</div>` : ''}
    <div style="font-weight: 600; color: #1e293b; font-size: 15px; margin-bottom: 4px;">${place.name}</div>
    <div style="font-size: 12px; color: #64748b; margin-bottom: 8px;">${place.type}</div>
    <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #475569; margin-bottom: 6px;">
      <span>${place.distanceKm} km</span>
      <span>•</span>
      <span>${place.walkMins} min</span>
    </div>
    ${place.vegFriendly ? `
      <div style="padding-top: 6px; border-top: 1px solid #e2e8f0;">
        <span style="font-size: 11px; background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px;">🥬 Veg</span>
      </div>
    ` : ''}
  </div>`;
};

const MapClient = forwardRef<MapClientHandle, MapClientProps>(
  ({ center, places, topPlaceIds, selectedPlaceId, onSelectPlace, isGlobeView = false }, ref) => {
    const mapRef = useRef<L.Map | null>(null);
    const centerMarkerRef = useRef<L.Marker | null>(null);
    const topMarkersLayerRef = useRef<L.LayerGroup | null>(null);
    const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [showGlobeOverlay, setShowGlobeOverlay] = useState(isGlobeView);

    // Hide globe overlay when places are loaded or isGlobeView changes
    useEffect(() => {
      if (!isGlobeView || places.length > 0) {
        setShowGlobeOverlay(false);
      }
    }, [isGlobeView, places.length]);

    // Memoize top IDs set for O(1) lookup
    const topIdsSet = useMemo(() => new Set(topPlaceIds), [topPlaceIds]);

    // Memoize click handler
    const handleMarkerClick = useCallback((place: Place) => {
      onSelectPlace(place);
    }, [onSelectPlace]);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      panToPlace: (place: Place) => {
        if (mapRef.current) {
          mapRef.current.setView([place.lat, place.lon], 16, {
            animate: true,
            duration: 0.5,
          });
        }
      },
      flyToLocation: (newCenter: LatLon, zoom: number = 15) => {
        if (mapRef.current) {
          setShowGlobeOverlay(false);
          mapRef.current.flyTo([newCenter.lat, newCenter.lon], zoom, {
            animate: true,
            duration: 2.5,
          });
        }
      },
      resetView: () => {
        if (mapRef.current && places.length > 0) {
          const allPoints: L.LatLngExpression[] = [
            [center.lat, center.lon],
            ...places.map((p) => [p.lat, p.lon] as L.LatLngExpression),
          ];
          const bounds = L.latLngBounds(allPoints);
          mapRef.current.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 15,
            animate: true,
            duration: 0.5,
          });
        } else if (mapRef.current) {
          mapRef.current.setView([center.lat, center.lon], 14, {
            animate: true,
            duration: 0.5,
          });
        }
      },
    }), [center.lat, center.lon, places]);

    // Initialize map once
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;

      // Use world view for globe mode, otherwise city view
      const initialCenter: [number, number] = isGlobeView ? [20, 0] : [center.lat, center.lon];
      const initialZoom = isGlobeView ? 2 : 14;

      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
        preferCanvas: true,
      }).setView(initialCenter, initialZoom);

      // OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);

      mapRef.current.zoomControl.setPosition('topright');

      // Layer for top 5 markers (no clustering)
      topMarkersLayerRef.current = L.layerGroup().addTo(mapRef.current);

      // Cluster group for non-top markers
      clusterGroupRef.current = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          const size = count < 10 ? 36 : count < 30 ? 42 : 48;
          return L.divIcon({
            html: `<div style="
              width: ${size}px;
              height: ${size}px;
              background-color: #94a3b8;
              border: 3px solid white;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 13px;
              font-weight: 600;
              color: white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            ">${count}</div>`,
            className: 'custom-cluster-icon',
            iconSize: L.point(size, size),
          });
        },
      }).addTo(mapRef.current);

      return () => {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
      };
    }, []);

    // Update center marker
    useEffect(() => {
      if (!mapRef.current) return;

      if (centerMarkerRef.current) {
        centerMarkerRef.current.remove();
      }

      centerMarkerRef.current = L.marker([center.lat, center.lon], {
        icon: getCenterIcon(),
        zIndexOffset: 1000,
      })
        .addTo(mapRef.current)
        .bindPopup(
          `<div style="text-align: center; padding: 4px;">
            <div style="font-weight: 600; color: #1e293b; font-size: 14px;">Search Center</div>
            <div style="font-size: 12px; color: #64748b;">Your starting point</div>
          </div>`,
          { className: 'custom-popup' }
        );

      mapRef.current.setView([center.lat, center.lon], 14, {
        animate: true,
        duration: 0.3,
      });
    }, [center.lat, center.lon]);

    // Update place markers
    useEffect(() => {
      if (!mapRef.current || !topMarkersLayerRef.current || !clusterGroupRef.current) return;

      // Clear existing markers
      topMarkersLayerRef.current.clearLayers();
      clusterGroupRef.current.clearLayers();

      // Clear icon cache for fresh selection state
      iconCache.clear();

      // Add markers
      places.forEach((place) => {
        const isTopPlace = topIdsSet.has(place.id);
        const topRank = isTopPlace ? topPlaceIds.indexOf(place.id) + 1 : 0;
        const isSelected = selectedPlaceId === place.id;

        const marker = L.marker([place.lat, place.lon], {
          icon: getPlaceIcon(place.category, isTopPlace, isSelected),
          zIndexOffset: isSelected ? 500 : (isTopPlace ? 100 : 0),
        });

        marker
          .bindPopup(getPopupHtml(place, isTopPlace, topRank), {
            className: 'custom-popup',
            maxWidth: 280,
          })
          .on('click', () => handleMarkerClick(place));

        if (isSelected) {
          setTimeout(() => marker.openPopup(), 100);
        }

        // Top 5 go to separate layer (no clustering)
        // Non-top go to cluster group
        if (isTopPlace) {
          topMarkersLayerRef.current!.addLayer(marker);
        } else {
          clusterGroupRef.current!.addLayer(marker);
        }
      });

      // Fit bounds
      if (places.length > 0) {
        const allPoints: L.LatLngExpression[] = [
          [center.lat, center.lon],
          ...places.map((p) => [p.lat, p.lon] as L.LatLngExpression),
        ];
        const bounds = L.latLngBounds(allPoints);
        mapRef.current.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 15,
          animate: true,
          duration: 0.5,
        });
      }
    }, [places, topPlaceIds, topIdsSet, selectedPlaceId, handleMarkerClick, center.lat, center.lon]);

    return (
      <div className="relative w-full h-full" style={{ minHeight: '350px' }}>
        <div
          ref={containerRef}
          className="w-full h-full"
        />
        
        {/* Globe view overlay - prompt to search */}
        {showGlobeOverlay && (
          <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-8 z-[1000]">
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-6 py-4 shadow-xl border border-white/50 text-center max-w-sm mx-4 animate-fade-in">
              <div className="flex items-center justify-center gap-3 mb-2">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span className="text-slate-700 font-medium">Search a city or use your location to begin</span>
              </div>
              <p className="text-xs text-slate-500">Explore restaurants, cafés, and attractions worldwide</p>
            </div>
          </div>
        )}
      </div>
    );
  }
);

MapClient.displayName = 'MapClient';

export default MapClient;
