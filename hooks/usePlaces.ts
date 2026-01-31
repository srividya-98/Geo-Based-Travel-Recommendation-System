'use client';

import { useState, useCallback } from 'react';
import { Place, Preferences, PlacesResponse, Recommendation } from '@/lib/types';

interface UsePlacesReturn {
  places: Place[];
  recommendations: Recommendation[];
  center: { lat: number; lon: number };
  isLoading: boolean;
  error: string | null;
  searchPlaces: (preferences: Preferences) => Promise<void>;
}

// Generate explanation for why a place was recommended
function generateExplanation(place: Place, preferences: Preferences): string[] {
  const reasons: string[] = [];
  
  // Distance
  if (place.distance) {
    const walkMinutes = Math.round(place.distance / 80);
    if (walkMinutes <= 5) {
      reasons.push(`Very close - only ${walkMinutes} minute walk`);
    } else if (walkMinutes <= preferences.maxWalkMinutes) {
      reasons.push(`Within your ${preferences.maxWalkMinutes} min walk limit (${walkMinutes} min)`);
    }
  }
  
  // Open status
  if (place.isOpenNow) {
    reasons.push('Currently open');
  }
  
  // Rating proxy
  if (place.ratingProxy >= 4) {
    reasons.push('Well-documented establishment (higher confidence)');
  } else if (place.ratingProxy >= 3.5) {
    reasons.push('Good metadata availability');
  }
  
  // Veg-friendly
  if (preferences.vegFriendly && place.vegFriendly) {
    reasons.push('Matches your veg-friendly preference');
  }
  
  // Category-specific
  if (place.category === 'food' && place.cuisine) {
    reasons.push(`Serves ${place.cuisine} cuisine`);
  }
  
  // Tags
  if (place.tags.length > 0) {
    const relevantTags = place.tags.filter(
      (t) => !['restaurant', 'cafe', 'park'].includes(t.toLowerCase())
    );
    if (relevantTags.length > 0) {
      reasons.push(`Features: ${relevantTags.slice(0, 2).join(', ')}`);
    }
  }
  
  return reasons.length > 0 ? reasons : ['Matches your search criteria'];
}

// Calculate recommendation score
function calculateScore(place: Place, preferences: Preferences): number {
  let score = 5; // Base score
  
  // Distance (up to +2)
  if (place.distance) {
    const maxDist = preferences.maxWalkMinutes * 80;
    const distRatio = 1 - place.distance / maxDist;
    score += distRatio * 2;
  }
  
  // Open status (+1)
  if (place.isOpenNow) {
    score += 1;
  }
  
  // Rating proxy (up to +1.5)
  score += (place.ratingProxy - 3) * 0.5;
  
  // Veg match (+0.5)
  if (preferences.vegFriendly && place.vegFriendly) {
    score += 0.5;
  }
  
  return Math.min(10, Math.max(1, score));
}

export function usePlaces(): UsePlacesReturn {
  const [places, setPlaces] = useState<Place[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [center, setCenter] = useState({ lat: 13.0827, lon: 80.2707 }); // Chennai default
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchPlaces = useCallback(async (preferences: Preferences) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/places', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preferences),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch places');
      }
      
      const data: PlacesResponse = await response.json();
      
      setPlaces(data.places);
      setCenter(data.center);
      
      // Generate recommendations for top 2 places
      const topPlaces = data.places.slice(0, 2);
      const recs: Recommendation[] = topPlaces.map((place) => ({
        place,
        explanation: generateExplanation(place, preferences),
        score: calculateScore(place, preferences),
      }));
      
      setRecommendations(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setPlaces([]);
      setRecommendations([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    places,
    recommendations,
    center,
    isLoading,
    error,
    searchPlaces,
  };
}
