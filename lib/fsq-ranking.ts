/**
 * DS-Style Multi-Stage Recommendation Engine for Foursquare Places
 * 
 * STAGE 1: Hard filters (must pass all)
 * STAGE 2: Multi-criteria ranking (quality > popularity > vibe > distance)
 * 
 * Distance is NEVER allowed to override quality or popularity.
 */

import { Preferences, Vibe } from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface FsqPlaceRaw {
  fsq_id: string;
  name: string;
  lat: number;
  lon: number;
  distanceMeters: number | null;
  categories: string[];
  categoryIds: number[];
  
  // Quality signals (nullable)
  rating: number | null;           // 0-10 scale
  ratingCount: number | null;      // Number of ratings
  popularity: number | null;       // 0-1 normalized or raw count
  price: number | null;            // 1-4 price tier
  
  // Operational
  openNow: boolean | null;
  
  // Completeness fields
  hasAddress: boolean;
  hasPhone: boolean;
  hasWebsite: boolean;
  hasHours: boolean;
  
  // For display
  address: string;
  type: string;
}

export interface RankedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string | null;
  type: string;
  tags: string[];
  distanceKm: number;
  walkMins: number;
  reasons: string[];
  vegFriendly: boolean;
  openStatus: 'open' | 'unknown';
  
  // Internal ranking signals (not exposed in UI)
  _rank: {
    qualityStrength: number;    // Primary: Bayesian-adjusted quality
    popularityNorm: number;     // Secondary: normalized popularity
    vibeConfidence: number;     // Tertiary: vibe match confidence
    distanceMeters: number;     // Tie-breaker only
  };
}

export interface RankingResult {
  places: RankedPlace[];
  recommended: RankedPlace | null;
  topPlaces: RankedPlace[];
  vegFilterApplied: boolean;
  vegFilterWarning: string | null;
  debug: {
    totalRaw: number;
    afterHardFilters: number;
    meanRating: number;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const BAYESIAN_M = 30;  // Minimum votes for full Bayesian weight
const WALKING_SPEED_KMH = 4.5;

// Vibe-to-category confidence mapping
const VIBE_CATEGORY_AFFINITY: Record<NonNullable<Vibe>, Record<string, number>> = {
  insta: {
    cafe: 0.95, restaurant: 0.8, scenic: 0.9, indoor: 0.7, grocery: 0.3,
  },
  work: {
    cafe: 0.95, restaurant: 0.5, indoor: 0.7, scenic: 0.3, grocery: 0.2,
  },
  romantic: {
    restaurant: 0.95, scenic: 0.85, cafe: 0.7, indoor: 0.6, grocery: 0.1,
  },
  budget: {
    grocery: 0.9, cafe: 0.7, restaurant: 0.6, indoor: 0.5, scenic: 0.8,
  },
  lively: {
    restaurant: 0.9, cafe: 0.7, indoor: 0.8, scenic: 0.6, grocery: 0.2,
  },
};

// Keywords that boost vibe confidence
const VIBE_KEYWORDS: Record<NonNullable<Vibe>, string[]> = {
  insta: ['aesthetic', 'artisan', 'boutique', 'rooftop', 'garden', 'terrace', 'design', 'craft', 'specialty', 'brunch'],
  work: ['wifi', 'coworking', 'quiet', 'study', 'laptop', 'workspace', 'coffee'],
  romantic: ['candlelit', 'intimate', 'wine', 'fine dining', 'rooftop', 'waterfront', 'sunset', 'cozy'],
  budget: ['cheap', 'affordable', 'value', 'deal', 'budget', 'street food', 'local', 'fast'],
  lively: ['bar', 'pub', 'live music', 'club', 'party', 'nightlife', 'sports', 'crowded', 'popular'],
};

// =============================================================================
// STAGE 1: HARD FILTERS
// =============================================================================

function categoryMatches(placeCategories: string[], selectedCategory: string | null): boolean {
  // No category filter = matches all
  if (!selectedCategory) return true;
  
  const categoryMap: Record<string, string[]> = {
    restaurant: ['restaurant', 'food', 'dining', 'eatery', 'bistro', 'bar', 'grill', 'pizzeria', 'steakhouse', 'sushi', 'fast food'],
    cafe: ['cafe', 'coffee', 'tea', 'bakery', 'dessert', 'pastry', 'juice'],
    grocery: ['grocery', 'supermarket', 'convenience', 'market', 'food store', 'deli'],
    scenic: ['park', 'garden', 'viewpoint', 'attraction', 'landmark', 'scenic', 'nature', 'beach', 'plaza'],
    indoor: ['museum', 'cinema', 'theater', 'theatre', 'library', 'gallery', 'mall', 'entertainment', 'arcade'],
  };
  
  const keywords = categoryMap[selectedCategory.toLowerCase()] || [];
  
  for (const cat of placeCategories) {
    const catLower = cat.toLowerCase();
    if (keywords.some(kw => catLower.includes(kw))) {
      return true;
    }
  }
  return false;
}

function hasQualitySignal(place: FsqPlaceRaw): boolean {
  return place.rating !== null || place.popularity !== null;
}

function computeVibeConfidence(place: FsqPlaceRaw, vibe: Vibe, category: string | null): number {
  // No vibe filter = full confidence
  if (!vibe) return 1.0;
  
  // Base confidence from category affinity (use 'restaurant' as default if no category)
  const categoryKey = category || 'restaurant';
  let confidence = VIBE_CATEGORY_AFFINITY[vibe]?.[categoryKey] ?? 0.5;
  
  // Boost from keyword matches in categories/name
  const keywords = VIBE_KEYWORDS[vibe] || [];
  const textToSearch = [...place.categories, place.name, place.type].join(' ').toLowerCase();
  
  const keywordMatches = keywords.filter(kw => textToSearch.includes(kw)).length;
  confidence += Math.min(0.3, keywordMatches * 0.1);
  
  // Budget vibe: boost for low price tier
  if (vibe === 'budget' && place.price !== null && place.price <= 2) {
    confidence += 0.2;
  }
  
  // Romantic/lively: boost if open in evening (we can't check time, but openNow is a proxy)
  if ((vibe === 'romantic' || vibe === 'lively') && place.openNow === true) {
    confidence += 0.1;
  }
  
  return Math.min(1.0, confidence);
}

const VIBE_CONFIDENCE_THRESHOLD = 0.4;

function passesHardFilters(
  place: FsqPlaceRaw,
  prefs: Preferences,
  radiusMeters: number
): { passes: boolean; vibeConfidence: number } {
  // 1. Category must match
  if (!categoryMatches(place.categories, prefs.category)) {
    return { passes: false, vibeConfidence: 0 };
  }
  
  // 2. Must have quality signal (rating OR popularity)
  if (!hasQualitySignal(place)) {
    return { passes: false, vibeConfidence: 0 };
  }
  
  // 3. Distance must be within radius (eligibility only)
  if (place.distanceMeters !== null && place.distanceMeters > radiusMeters) {
    return { passes: false, vibeConfidence: 0 };
  }
  
  // 4. Vibe confidence must meet threshold
  const vibeConfidence = computeVibeConfidence(place, prefs.vibe, prefs.category);
  if (vibeConfidence < VIBE_CONFIDENCE_THRESHOLD) {
    return { passes: false, vibeConfidence };
  }
  
  return { passes: true, vibeConfidence };
}

// =============================================================================
// STAGE 2: RANKING (Multi-criteria, NOT distance-dominant)
// =============================================================================

function computeBayesianQuality(
  rating: number | null,
  ratingCount: number | null,
  meanRating: number
): number {
  if (rating === null) return meanRating * 0.8; // Penalize unknowns slightly
  
  const v = ratingCount ?? 1;
  const R = rating;
  const C = meanRating;
  const m = BAYESIAN_M;
  
  // WR = (v/(v+m)) * R + (m/(v+m)) * C
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

function normalizePopularity(popularity: number | null, maxPopularity: number): number {
  if (popularity === null || popularity <= 0) return 0.3; // Slight penalty for unknown
  if (maxPopularity <= 0) return 0.5;
  
  // Log-normalized to prevent outliers dominating
  const logPop = Math.log10(popularity + 1);
  const logMax = Math.log10(maxPopularity + 1);
  
  return Math.max(0, Math.min(1, logPop / logMax));
}

/**
 * Multi-criteria comparison for sorting
 * Returns negative if a should rank higher, positive if b should rank higher
 * 
 * Order: quality > popularity > vibeConfidence > distance (asc)
 */
function compareForRanking(a: RankedPlace, b: RankedPlace): number {
  // Primary: quality strength (higher is better)
  const qualityDiff = b._rank.qualityStrength - a._rank.qualityStrength;
  if (Math.abs(qualityDiff) > 0.3) return qualityDiff > 0 ? 1 : -1;
  
  // Secondary: popularity (higher is better)
  const popDiff = b._rank.popularityNorm - a._rank.popularityNorm;
  if (Math.abs(popDiff) > 0.15) return popDiff > 0 ? 1 : -1;
  
  // Tertiary: vibe confidence (higher is better)
  const vibeDiff = b._rank.vibeConfidence - a._rank.vibeConfidence;
  if (Math.abs(vibeDiff) > 0.1) return vibeDiff > 0 ? 1 : -1;
  
  // Last tie-breaker: distance (lower is better)
  return a._rank.distanceMeters - b._rank.distanceMeters;
}

// =============================================================================
// REASON GENERATION
// =============================================================================

// Vibe-specific reason labels
const VIBE_REASON_LABELS: Record<NonNullable<Vibe>, string> = {
  insta: 'Aesthetic spot',
  work: 'Work-friendly',
  romantic: 'Romantic setting',
  budget: 'Great value',
  lively: 'Lively atmosphere',
};

function generateReasons(place: FsqPlaceRaw, vibeConfidence: number, prefs: Preferences): string[] {
  const reasons: string[] = [];
  
  // Vibe-specific reason (if high confidence and vibe is set)
  if (vibeConfidence >= 0.7 && prefs.vibe) {
    reasons.push(VIBE_REASON_LABELS[prefs.vibe]);
  }
  
  // Quality signals
  if (place.rating !== null && place.rating >= 8) {
    reasons.push('Highly rated');
  } else if (place.rating !== null && place.rating >= 7) {
    reasons.push('Well reviewed');
  }
  
  // Popularity
  if (place.popularity !== null && place.popularity > 0.6) {
    reasons.push('Popular nearby');
  }
  
  // Open status
  if (place.openNow === true) {
    reasons.push('Open now');
  }
  
  // Distance/walkability
  const distanceKm = (place.distanceMeters ?? 0) / 1000;
  if (distanceKm <= 0.5) {
    reasons.push('Walkable');
  }
  
  // Budget-friendly (specific for budget vibe)
  if (prefs.vibe === 'budget' && place.price !== null && place.price <= 2) {
    reasons.push('Budget-friendly');
  }
  
  // Work-friendly extras
  if (prefs.vibe === 'work') {
    const cats = place.categories.join(' ').toLowerCase();
    if (cats.includes('coffee') || cats.includes('cafe')) {
      if (!reasons.includes('Work-friendly')) reasons.push('Cafe vibes');
    }
  }
  
  // Romantic extras
  if (prefs.vibe === 'romantic' && place.openNow === true) {
    const cats = place.categories.join(' ').toLowerCase();
    if (cats.includes('wine') || cats.includes('cocktail') || cats.includes('italian') || cats.includes('french')) {
      if (!reasons.includes('Romantic setting')) reasons.push('Perfect for dates');
    }
  }
  
  // Data completeness
  const completeness = [place.hasAddress, place.hasPhone, place.hasWebsite, place.hasHours]
    .filter(Boolean).length;
  if (completeness >= 3) {
    reasons.push('Good data');
  }
  
  // Ensure at least 2 reasons
  if (reasons.length < 2) {
    if (!reasons.includes('Walkable') && distanceKm <= 1.5) {
      reasons.push('Walkable');
    }
    if (reasons.length < 2) {
      reasons.push('Matches your search');
    }
  }
  
  return reasons.slice(0, 3);
}

// =============================================================================
// VEG FILTERING (Filter only, not scoring)
// =============================================================================

function isVegFriendly(name: string, categories: string[]): boolean {
  const vegKeywords = ['vegetarian', 'vegan', 'veggie', 'plant-based', 'organic', 'salad', 'health food'];
  
  const nameLower = name.toLowerCase();
  if (vegKeywords.some(kw => nameLower.includes(kw))) return true;
  
  for (const cat of categories) {
    const catLower = cat.toLowerCase();
    if (vegKeywords.some(kw => catLower.includes(kw))) return true;
  }
  
  return false;
}

// =============================================================================
// MAIN RANKING FUNCTION
// =============================================================================

export function rankPlacesFsq(
  places: FsqPlaceRaw[],
  prefs: Preferences,
  radiusMeters: number
): RankingResult {
  const totalRaw = places.length;
  
  // =========================================================================
  // STAGE 1: HARD FILTERS
  // =========================================================================
  
  // Veg filter (if enabled)
  let filtered = places;
  let vegFilterApplied = false;
  let vegFilterWarning: string | null = null;
  
  if (prefs.vegOnly) {
    vegFilterApplied = true;
    const vegPlaces = places.filter(p => isVegFriendly(p.name, p.categories));
    
    if (vegPlaces.length === 0) {
      vegFilterWarning = 'Veg filter not supported by provider - showing all results';
    } else {
      filtered = vegPlaces;
    }
  }
  
  // Apply walk time filter
  const maxWalkMeters = (prefs.maxWalkMinutes / 60) * WALKING_SPEED_KMH * 1000;
  
  // Apply all hard filters and compute vibe confidence
  const filteredWithConfidence: { place: FsqPlaceRaw; vibeConfidence: number }[] = [];
  
  for (const place of filtered) {
    // Override radius with walk distance for eligibility
    const effectiveRadius = Math.min(radiusMeters, maxWalkMeters);
    const result = passesHardFilters(place, prefs, effectiveRadius);
    
    if (result.passes) {
      filteredWithConfidence.push({ place, vibeConfidence: result.vibeConfidence });
    }
  }
  
  const afterHardFilters = filteredWithConfidence.length;
  
  // =========================================================================
  // STAGE 2: RANKING
  // =========================================================================
  
  // Calculate mean rating for Bayesian adjustment
  const placesWithRating = filteredWithConfidence.filter(p => p.place.rating !== null);
  const meanRating = placesWithRating.length > 0
    ? placesWithRating.reduce((sum, p) => sum + (p.place.rating || 0), 0) / placesWithRating.length
    : 6.0;
  
  // Calculate max popularity for normalization
  const maxPopularity = Math.max(1, ...filteredWithConfidence.map(p => p.place.popularity || 0));
  
  // Build ranked places with internal ranking signals
  const ranked: RankedPlace[] = filteredWithConfidence.map(({ place, vibeConfidence }) => {
    const distanceKm = (place.distanceMeters ?? 0) / 1000;
    const walkMins = Math.round((distanceKm / WALKING_SPEED_KMH) * 60);
    
    const qualityStrength = computeBayesianQuality(place.rating, place.ratingCount, meanRating);
    const popularityNorm = normalizePopularity(place.popularity, maxPopularity);
    
    return {
      id: place.fsq_id,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      category: prefs.category,
      type: place.type,
      tags: place.categories.slice(0, 3),
      distanceKm: Math.round(distanceKm * 100) / 100,
      walkMins,
      reasons: generateReasons(place, vibeConfidence, prefs),
      vegFriendly: isVegFriendly(place.name, place.categories),
      openStatus: place.openNow === true ? 'open' : 'unknown',
      _rank: {
        qualityStrength,
        popularityNorm,
        vibeConfidence,
        distanceMeters: place.distanceMeters ?? radiusMeters,
      },
    };
  });
  
  // Sort using multi-criteria comparison (NOT distance-dominant)
  ranked.sort(compareForRanking);
  
  // Extract top results
  const recommended = ranked.length > 0 ? ranked[0] : null;
  const topPlaces = ranked.slice(0, 5);
  
  return {
    places: ranked,
    recommended,
    topPlaces,
    vegFilterApplied,
    vegFilterWarning,
    debug: {
      totalRaw,
      afterHardFilters,
      meanRating: Math.round(meanRating * 10) / 10,
    },
  };
}

/**
 * Log ranking debug info (dev only)
 */
export function logFsqRankingDebug(result: RankingResult): void {
  console.log('[FSQ Pipeline] Stats:');
  console.log(`  Raw: ${result.debug.totalRaw}`);
  console.log(`  After hard filters: ${result.debug.afterHardFilters}`);
  console.log(`  Mean rating: ${result.debug.meanRating}`);
  
  if (result.vegFilterWarning) {
    console.warn(`  Warning: ${result.vegFilterWarning}`);
  }
  
  console.log('[FSQ Pipeline] Top 5:');
  result.topPlaces.forEach((p, i) => {
    const r = p._rank;
    console.log(`  ${i + 1}. ${p.name} | Q:${r.qualityStrength.toFixed(1)} P:${r.popularityNorm.toFixed(2)} V:${r.vibeConfidence.toFixed(2)} D:${r.distanceMeters}m`);
  });
}
