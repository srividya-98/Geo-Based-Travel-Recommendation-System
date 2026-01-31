/**
 * Production-grade Vibe Scoring & Ranking Engine
 * 
 * Supports FSQ-first scoring (rating/popularity/price/categories/photos/tips)
 * with OSM fallback using completeness signals.
 */

import { Vibe, Preferences, PlaceRaw } from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface ScoredPlace {
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
  // Internal ranking signal (not shown in UI)
  _internalScore?: number;
}

export interface RankingResult {
  recommended: ScoredPlace | null;
  others: ScoredPlace[];
  allPlaces: ScoredPlace[];
  debug: {
    rawCount: number;
    afterDedupeCount: number;
    top5: Array<{ name: string; distanceKm: number }>;
  };
}

interface VibeProfile {
  name: string;
  weights: {
    quality: number;      // FSQ rating/popularity OR OSM completeness
    distance: number;     // Non-linear distance scoring
    veg: number;          // Veg-friendly bonus
    open: number;         // Open now / evening bonus
    completeness: number; // Tag completeness
    price: number;        // Price tier bonus (budget vibe)
  };
  categoryBoost: string[];   // Tags/categories that get boosted
  categoryPenalty: string[]; // Tags/categories that get penalized
  eveningBonus: boolean;     // Bonus for places open in evening
  keywords: {
    positive: string[];      // Name/tag keywords that boost score
    negative: string[];      // Name/tag keywords that penalize
  };
}

// =============================================================================
// VIBE PROFILES - Production-grade configuration
// =============================================================================

export const VIBE_PROFILES: Record<NonNullable<Vibe>, VibeProfile> = {
  insta: {
    name: 'Insta / Aesthetic',
    weights: {
      quality: 30,      // High - we want pretty places
      distance: 25,     // Medium - willing to walk for aesthetics
      veg: 5,
      open: 10,
      completeness: 20, // Photos, website important
      price: 10,        // Trendy places often pricier
    },
    categoryBoost: [
      'cafe', 'coffee', 'brunch', 'bakery', 'dessert', 'ice_cream',
      'rooftop', 'terrace', 'garden', 'art', 'gallery', 'boutique',
      'concept', 'specialty', 'artisan', 'organic', 'vegan'
    ],
    categoryPenalty: [
      'fast_food', 'takeaway', 'food_court', 'canteen', 'kebab',
      'gas_station', 'convenience'
    ],
    eveningBonus: false,
    keywords: {
      positive: ['aesthetic', 'artisan', 'boutique', 'garden', 'terrace', 'rooftop', 'vintage', 'design', 'concept', 'specialty', 'craft', 'organic', 'brunch'],
      negative: ['fast', 'quick', 'express', 'cheap', 'discount', '24h', 'drive']
    }
  },
  
  work: {
    name: 'Work-friendly',
    weights: {
      quality: 20,
      distance: 35,     // Very important - close to work
      veg: 5,
      open: 15,         // Needs to be open during work hours
      completeness: 20, // WiFi, power important
      price: 5,
    },
    categoryBoost: [
      'cafe', 'coffee', 'coworking', 'library', 'wifi', 'laptop',
      'quiet', 'study', 'work'
    ],
    categoryPenalty: [
      'bar', 'pub', 'nightclub', 'club', 'karaoke', 'disco',
      'fast_food', 'takeaway'
    ],
    eveningBonus: false,
    keywords: {
      positive: ['wifi', 'laptop', 'work', 'study', 'quiet', 'cozy', 'spacious', 'power', 'outlet', 'coworking'],
      negative: ['loud', 'party', 'club', 'disco', 'karaoke', 'live music', 'sports bar']
    }
  },
  
  romantic: {
    name: 'Romantic',
    weights: {
      quality: 35,      // High quality important
      distance: 20,     // Willing to travel
      veg: 5,
      open: 20,         // Evening hours crucial
      completeness: 15,
      price: 5,         // Not budget-focused
    },
    categoryBoost: [
      'fine_dining', 'italian', 'french', 'wine_bar', 'cocktail',
      'rooftop', 'terrace', 'garden', 'candlelit', 'intimate',
      'jazz', 'piano', 'lounge'
    ],
    categoryPenalty: [
      'fast_food', 'food_court', 'cafeteria', 'canteen', 'sports_bar',
      'family', 'kids', 'playground', 'buffet'
    ],
    eveningBonus: true,
    keywords: {
      positive: ['romantic', 'intimate', 'cozy', 'candlelit', 'wine', 'cocktail', 'terrace', 'rooftop', 'garden', 'fine', 'elegant', 'charming'],
      negative: ['family', 'kids', 'loud', 'sports', 'tv', 'screens', 'fast', 'quick', 'buffet']
    }
  },
  
  budget: {
    name: 'Budget',
    weights: {
      quality: 15,
      distance: 30,     // Close is important
      veg: 5,
      open: 15,
      completeness: 10,
      price: 25,        // Price is key
    },
    categoryBoost: [
      'street_food', 'food_court', 'cafeteria', 'fast_food', 'takeaway',
      'market', 'deli', 'bakery', 'local', 'traditional'
    ],
    categoryPenalty: [
      'fine_dining', 'michelin', 'upscale', 'luxury', 'premium',
      'gourmet', 'tasting_menu'
    ],
    eveningBonus: false,
    keywords: {
      positive: ['cheap', 'budget', 'affordable', 'value', 'deal', 'discount', 'local', 'street', 'market', 'homemade', 'traditional'],
      negative: ['luxury', 'premium', 'fine', 'upscale', 'gourmet', 'michelin', 'tasting']
    }
  },
  
  lively: {
    name: 'Lively',
    weights: {
      quality: 25,
      distance: 25,
      veg: 5,
      open: 25,         // Evening/late hours important
      completeness: 15,
      price: 5,
    },
    categoryBoost: [
      'bar', 'pub', 'nightclub', 'club', 'live_music', 'karaoke',
      'tapas', 'beer_garden', 'rooftop', 'cocktail', 'sports_bar',
      'brewery', 'dance'
    ],
    categoryPenalty: [
      'library', 'quiet', 'study', 'meditation', 'spa', 'wellness'
    ],
    eveningBonus: true,
    keywords: {
      positive: ['lively', 'vibrant', 'party', 'live', 'music', 'dance', 'social', 'fun', 'popular', 'trendy', 'buzzing'],
      negative: ['quiet', 'peaceful', 'relaxing', 'meditation', 'spa', 'wellness']
    }
  }
};

// =============================================================================
// SCORING FUNCTIONS
// =============================================================================

/**
 * Non-linear distance scoring
 * - Very strong bonus within 0-500m (score 45-50)
 * - Medium bonus 500m-2km (score 20-45)
 * - Sharp decay after 2km (score 0-20)
 */
function scoreDistance(distanceKm: number, maxDistanceKm: number = 5): number {
  if (distanceKm <= 0) return 50;
  
  // Very close (0-500m): exponential bonus
  if (distanceKm <= 0.5) {
    return 50 - (distanceKm / 0.5) * 5; // 50 → 45
  }
  
  // Medium distance (500m-2km): linear decay
  if (distanceKm <= 2) {
    return 45 - ((distanceKm - 0.5) / 1.5) * 25; // 45 → 20
  }
  
  // Far (2km+): sharp decay
  if (distanceKm <= maxDistanceKm) {
    return 20 - ((distanceKm - 2) / (maxDistanceKm - 2)) * 20; // 20 → 0
  }
  
  return 0;
}

/**
 * Quality scoring based on FSQ data (if available) or OSM completeness
 */
function scoreQuality(place: PlaceRaw, profile: VibeProfile): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const tags = place.tags || {};
  
  // FSQ-specific scoring (if data available)
  const fsqRating = parseFloat(tags['fsq:rating'] || '0');
  const fsqPopularity = parseFloat(tags['fsq:popularity'] || '0');
  const fsqPriceTier = parseInt(tags['fsq:price_tier'] || '0', 10);
  const fsqPhotosCount = parseInt(tags['fsq:photos_count'] || '0', 10);
  const fsqTipsCount = parseInt(tags['fsq:tips_count'] || '0', 10);
  
  if (fsqRating > 0) {
    // FSQ rating (0-10 scale, normalize to 0-15)
    const ratingScore = (fsqRating / 10) * 15;
    score += ratingScore;
    if (fsqRating >= 8) reasons.push(`Highly rated (${fsqRating.toFixed(1)})`);
    
    // Popularity bonus (log-normalized)
    if (fsqPopularity > 0) {
      const popScore = Math.min(Math.log10(fsqPopularity + 1) * 3, 10);
      score += popScore;
      if (fsqPopularity >= 100) reasons.push('Popular spot');
    }
    
    // Photos/tips as quality signals
    if (fsqPhotosCount >= 10) {
      score += 3;
      reasons.push('Well-photographed');
    }
    if (fsqTipsCount >= 5) {
      score += 2;
    }
    
    // Price tier for budget vibe
    if (profile.name === 'Budget' && fsqPriceTier > 0) {
      if (fsqPriceTier === 1) {
        score += 10;
        reasons.push('Budget-friendly');
      } else if (fsqPriceTier === 2) {
        score += 5;
        reasons.push('Moderately priced');
      }
    }
  } else {
    // OSM completeness fallback scoring
    let completeness = 0;
    
    if (tags.opening_hours) { completeness += 4; }
    if (tags.website || tags['contact:website']) { completeness += 3; reasons.push('Has website'); }
    if (tags.phone || tags['contact:phone']) { completeness += 2; }
    if (tags.cuisine) { completeness += 2; }
    if (tags['addr:street'] || tags['addr:housenumber']) { completeness += 1; }
    if (tags.outdoor_seating === 'yes') { completeness += 2; reasons.push('Outdoor seating'); }
    if (tags.wheelchair === 'yes') { completeness += 1; }
    if (tags.internet_access === 'yes' || tags.internet_access === 'wlan') { 
      completeness += 2; 
      if (profile.name === 'Work-friendly') reasons.push('WiFi available');
    }
    
    score = Math.min(completeness * 2, 20); // Cap at 20
    if (completeness >= 6) reasons.push('Well-documented');
  }
  
  return { score: Math.min(score, 30), reasons };
}

/**
 * Vibe-specific category and keyword matching
 */
function scoreVibeMatch(place: PlaceRaw, profile: VibeProfile): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const tags = place.tags || {};
  const nameLower = place.name.toLowerCase();
  
  // Collect all relevant text for matching
  const allText = [
    nameLower,
    tags.cuisine || '',
    tags.amenity || '',
    tags.shop || '',
    tags.leisure || '',
    tags.description || '',
    Object.values(tags).join(' ')
  ].join(' ').toLowerCase();
  
  // Category boost matching
  for (const boost of profile.categoryBoost) {
    if (allText.includes(boost.toLowerCase())) {
      score += 5;
      break; // Only count once
    }
  }
  
  // Category penalty matching
  for (const penalty of profile.categoryPenalty) {
    if (allText.includes(penalty.toLowerCase())) {
      score -= 5;
      break;
    }
  }
  
  // Keyword matching
  let keywordBonus = 0;
  for (const keyword of profile.keywords.positive) {
    if (allText.includes(keyword.toLowerCase())) {
      keywordBonus += 2;
      if (keywordBonus === 2) reasons.push(`Matches "${keyword}" vibe`);
    }
  }
  score += Math.min(keywordBonus, 10);
  
  // Negative keyword penalty
  for (const keyword of profile.keywords.negative) {
    if (allText.includes(keyword.toLowerCase())) {
      score -= 3;
      break;
    }
  }
  
  return { score: Math.max(score, 0), reasons };
}

/**
 * Open status and evening bonus scoring
 */
function scoreOpenStatus(place: PlaceRaw, profile: VibeProfile): { score: number; isOpen: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const tags = place.tags || {};
  const openingHours = tags.opening_hours || '';
  
  let score = 0;
  let isOpen = false;
  
  // Check if currently open (simplified - full implementation would parse opening_hours)
  if (openingHours) {
    // 24/7 places
    if (openingHours.includes('24/7') || openingHours.toLowerCase().includes('24 hours')) {
      score += 5;
      isOpen = true;
      reasons.push('Open 24/7');
    } else {
      // Has opening hours defined
      score += 3;
      isOpen = true; // Assume open if hours defined (simplified)
    }
    
    // Evening bonus for romantic/lively vibes
    if (profile.eveningBonus) {
      const currentHour = new Date().getHours();
      if (currentHour >= 18 || currentHour <= 2) {
        // Check if likely open in evening
        if (openingHours.includes('22:') || openingHours.includes('23:') || 
            openingHours.includes('00:') || openingHours.includes('24:') ||
            openingHours.includes('Mo-Su') || openingHours.includes('24/7')) {
          score += 5;
          reasons.push('Open late');
        }
      }
    }
  }
  
  return { score: Math.min(score, 15), isOpen, reasons };
}

/**
 * Vegetarian-friendly scoring
 */
function scoreVegFriendly(place: PlaceRaw, vegOnly: boolean): { score: number; isVegFriendly: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const tags = place.tags || {};
  const nameLower = place.name.toLowerCase();
  const cuisineLower = (tags.cuisine || '').toLowerCase();
  
  const vegKeywords = ['vegan', 'vegetarian', 'veggie', 'plant-based', 'organic'];
  const isVegFriendly = vegKeywords.some(kw => 
    nameLower.includes(kw) || cuisineLower.includes(kw) ||
    tags['diet:vegetarian'] === 'yes' || tags['diet:vegan'] === 'yes'
  );
  
  let score = 0;
  if (isVegFriendly) {
    score = vegOnly ? 10 : 5;
    reasons.push('Veg-friendly');
  } else if (!vegOnly) {
    score = 3; // Small score for non-veg when not filtering
  }
  
  return { score, isVegFriendly, reasons };
}

// =============================================================================
// MAIN SCORING FUNCTION
// =============================================================================

/**
 * Score a single place based on user preferences and vibe
 * Returns score 0-100
 */
// Vibe-specific reason labels
const VIBE_REASON_LABELS: Record<NonNullable<Vibe>, string> = {
  insta: 'Aesthetic spot',
  work: 'Work-friendly',
  romantic: 'Romantic setting',
  budget: 'Great value',
  lively: 'Lively atmosphere',
};

export function scorePlace(
  place: PlaceRaw,
  centerLat: number,
  centerLon: number,
  prefs: Preferences
): ScoredPlace {
  // Use a neutral profile if no vibe selected, otherwise use the selected vibe's profile
  const profile = prefs.vibe ? VIBE_PROFILES[prefs.vibe] : VIBE_PROFILES['insta']; // Fallback to insta as neutral-ish
  const allReasons: string[] = [];
  
  // Calculate distance
  const distanceKm = haversineDistance(centerLat, centerLon, place.lat, place.lon);
  const walkMins = Math.round(distanceKm * 12); // ~5km/h walking speed
  
  // Score components
  const distanceScore = scoreDistance(distanceKm);
  const { score: qualityScore, reasons: qualityReasons } = scoreQuality(place, profile);
  const { score: vibeScore, reasons: vibeReasons } = prefs.vibe 
    ? scoreVibeMatch(place, profile) 
    : { score: 5, reasons: [] }; // Neutral vibe score when no vibe selected
  const { score: openScore, isOpen, reasons: openReasons } = scoreOpenStatus(place, profile);
  const { score: vegScore, isVegFriendly, reasons: vegReasons } = scoreVegFriendly(place, prefs.vegOnly);
  
  // Add vibe-specific reason if score is high AND vibe is selected
  if (prefs.vibe && vibeScore >= 8) {
    allReasons.push(VIBE_REASON_LABELS[prefs.vibe]);
  }
  
  // Collect other reasons
  allReasons.push(...qualityReasons, ...vibeReasons, ...openReasons, ...vegReasons);
  
  // Add distance reason
  if (distanceKm <= 0.3) allReasons.push('Walkable');
  else if (distanceKm <= 0.8) allReasons.push('Walkable');
  else if (distanceKm <= 1.5) allReasons.push('Nearby');
  
  // Weighted total score
  const weights = profile.weights;
  const totalWeight = weights.quality + weights.distance + weights.veg + weights.open + weights.completeness + weights.price;
  
  // Normalize weights to 100
  const normalizedScore = Math.round(
    (qualityScore * (weights.quality / totalWeight) +
     distanceScore * (weights.distance / totalWeight) +
     vegScore * (weights.veg / totalWeight) +
     openScore * (weights.open / totalWeight) +
     vibeScore * ((weights.completeness + weights.price) / totalWeight)) * 2
  );
  
  const finalScore = Math.min(Math.max(normalizedScore, 0), 100);
  
  // Determine place type
  const tags = place.tags || {};
  const placeType = tags.cuisine || tags.amenity || tags.shop || tags.leisure || 'Place';
  
  // Extract display tags
  const displayTags: string[] = [];
  if (tags.cuisine) displayTags.push(...tags.cuisine.split(';').slice(0, 2));
  if (tags.outdoor_seating === 'yes') displayTags.push('Outdoor seating');
  if (tags.internet_access === 'yes' || tags.internet_access === 'wlan') displayTags.push('WiFi');
  if (tags.takeaway === 'yes') displayTags.push('Takeaway');
  if (tags.delivery === 'yes') displayTags.push('Delivery');
  
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    category: prefs.category,
    type: capitalize(placeType),
    tags: displayTags.slice(0, 4),
    distanceKm: Math.round(distanceKm * 100) / 100,
    walkMins,
    reasons: allReasons.slice(0, 3), // Top 3 reasons only
    vegFriendly: isVegFriendly,
    openStatus: isOpen ? 'open' : 'unknown',
    _internalScore: finalScore, // Internal only, not shown in UI
  };
}

// =============================================================================
// VIBE FILTERING - Hard filter places that don't match vibe
// =============================================================================

/**
 * Check if a place matches the selected vibe
 * Returns: 'strong' | 'weak' | 'mismatch'
 */
function getVibeMatchLevel(place: PlaceRaw, vibe: Vibe): 'strong' | 'weak' | 'mismatch' {
  // If no vibe selected, all places are neutral matches
  if (!vibe) return 'weak';
  
  const profile = VIBE_PROFILES[vibe];
  if (!profile) return 'weak';
  
  const tags = place.tags || {};
  const nameLower = place.name.toLowerCase();
  
  // Collect all text for matching
  const allText = [
    nameLower,
    tags.cuisine || '',
    tags.amenity || '',
    tags.shop || '',
    tags.leisure || '',
    tags.description || '',
    Object.values(tags).join(' ')
  ].join(' ').toLowerCase();
  
  // Check for strong negative keywords (mismatch)
  const negativeMatches = profile.keywords.negative.filter(kw => allText.includes(kw.toLowerCase()));
  if (negativeMatches.length >= 2) {
    return 'mismatch';
  }
  
  // Check for penalty categories
  const penaltyMatches = profile.categoryPenalty.filter(cat => allText.includes(cat.toLowerCase()));
  if (penaltyMatches.length >= 2) {
    return 'mismatch';
  }
  
  // Check for strong positive keywords
  const positiveMatches = profile.keywords.positive.filter(kw => allText.includes(kw.toLowerCase()));
  if (positiveMatches.length >= 2) {
    return 'strong';
  }
  
  // Check for boost categories
  const boostMatches = profile.categoryBoost.filter(cat => allText.includes(cat.toLowerCase()));
  if (boostMatches.length >= 1) {
    return 'strong';
  }
  
  // Default to weak match (neutral)
  return 'weak';
}

/**
 * Compute a vibe-specific score for a place (0-100)
 * This is the KEY function that differentiates results by vibe
 * Uses name patterns heavily since OSM tags are often sparse
 */
function computeVibeScore(place: PlaceRaw, vibe: Vibe): number {
  // If no vibe selected, return neutral score (all places treated equally)
  if (!vibe) return 50;
  
  const tags = place.tags || {};
  const nameLower = place.name.toLowerCase();
  const amenity = (tags.amenity || '').toLowerCase();
  const cuisine = (tags.cuisine || '').toLowerCase();
  const allText = [nameLower, amenity, cuisine, tags.description || ''].join(' ');
  
  // Start with base score based on vibe
  let score = 40;
  
  switch (vibe) {
    case 'insta':
      // Aesthetic places: look for trendy/artsy names
      if (tags.outdoor_seating === 'yes') score += 30;
      // Name patterns that suggest aesthetic/instagram-worthy
      if (/secret|hidden|artisan|craft|botanic|garden|terrace|rooftop/i.test(nameLower)) score += 35;
      if (/brunch|organic|vegan|specialty|concept/i.test(allText)) score += 25;
      if (/la |el |café|coffee|tea house/i.test(nameLower)) score += 15;
      if (amenity === 'cafe') score += 10;
      // Penalize generic/chain/fast
      if (/mcdonald|burger king|kfc|subway|domino/i.test(nameLower)) score -= 50;
      if (amenity === 'fast_food') score -= 40;
      if (/cafeteria|comedor|cantina/i.test(nameLower)) score -= 20;
      break;
      
    case 'work':
      // Work-friendly: WiFi, cafe chains, quiet names
      if (tags.internet_access === 'wlan' || tags.internet_access === 'yes') score += 40;
      // Name patterns suggesting work-friendly
      if (/starbucks|costa|nero|pret|coffee/i.test(nameLower)) score += 30;
      if (/library|librería|study|cowork/i.test(nameLower)) score += 35;
      if (amenity === 'cafe') score += 20;
      if (amenity === 'library') score += 40;
      // Penalize bars/noisy
      if (amenity === 'bar' || amenity === 'pub') score -= 50;
      if (/disco|club|karaoke|sports/i.test(nameLower)) score -= 40;
      if (/cervecería|bar /i.test(nameLower)) score -= 30;
      break;
      
    case 'romantic':
      // Romantic: wine bars, italian, french, elegant names
      if (/wine|vino|bodega|cocktail/i.test(nameLower)) score += 35;
      if (/italian|italiano|french|français|bistro/i.test(allText)) score += 30;
      if (/la |el |le |restaurant|ristorante/i.test(nameLower)) score += 15;
      if (tags.outdoor_seating === 'yes') score += 20;
      if (amenity === 'restaurant') score += 15;
      // Name patterns suggesting romantic
      if (/secret|intimate|garden|terrace|vista|moon|star/i.test(nameLower)) score += 25;
      // Penalize
      if (/mcdonald|burger|kfc|subway|pizza hut/i.test(nameLower)) score -= 60;
      if (amenity === 'fast_food') score -= 50;
      if (/cafeteria|comedor|family|kids/i.test(nameLower)) score -= 30;
      break;
      
    case 'budget':
      // Budget: fast food, takeaway, local names
      if (amenity === 'fast_food') score += 40;
      if (tags.takeaway === 'yes') score += 25;
      // Name patterns suggesting budget-friendly
      if (/kebab|döner|pizza|burger|sandwich|bocadillo/i.test(nameLower)) score += 30;
      if (/bar |cafetería|comedor|local/i.test(nameLower)) score += 20;
      if (/mcdonald|burger king|kfc|subway/i.test(nameLower)) score += 25;
      // Penalize expensive-sounding
      if (/gourmet|fine|premium|luxury|michelin/i.test(nameLower)) score -= 40;
      if (/bistro|ristorante/i.test(nameLower)) score -= 15;
      break;
      
    case 'lively':
      // Lively: bars, pubs, sports, music
      if (amenity === 'bar' || amenity === 'pub') score += 40;
      // Name patterns suggesting lively
      if (/bar |pub |cervecería|beer|sports|irish/i.test(nameLower)) score += 35;
      if (/live|music|karaoke|disco|club/i.test(nameLower)) score += 30;
      if (/tapas|vermut|cocktail/i.test(nameLower)) score += 20;
      if (amenity === 'nightclub') score += 35;
      // Penalize quiet
      if (amenity === 'library') score -= 60;
      if (/quiet|peaceful|zen|relax/i.test(nameLower)) score -= 30;
      break;
  }
  
  return Math.max(0, Math.min(100, score));
}

// =============================================================================
// RANKING FUNCTION
// =============================================================================

/**
 * Rank all places and return recommended + others
 */
export function rankPlaces(
  places: PlaceRaw[],
  centerLat: number,
  centerLon: number,
  prefs: Preferences
): RankingResult {
  const rawCount = places.length;
  
  // De-duplicate by name (case-insensitive) and location
  const seen = new Map<string, PlaceRaw>();
  for (const place of places) {
    const key = `${place.name.toLowerCase()}-${place.lat.toFixed(4)}-${place.lon.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.set(key, place);
    }
  }
  const dedupedPlaces = Array.from(seen.values());
  const afterDedupeCount = dedupedPlaces.length;
  
  // STEP 1: Score all places (with vibe-specific scoring if vibe is selected)
  const vibeScored = dedupedPlaces.map(place => ({
    place,
    vibeScore: computeVibeScore(place, prefs.vibe),
    distanceKm: haversineDistance(centerLat, centerLon, place.lat, place.lon),
  }));
  
  // STEP 2: Filter out places with very low vibe scores (< 20) - ONLY if vibe is selected
  // When no vibe is selected, keep all places
  const vibeFiltered = prefs.vibe 
    ? vibeScored.filter(item => item.vibeScore >= 20)
    : vibeScored;
  
  // STEP 3: Score remaining places using standard scoring
  // Vibe weight: 60% if vibe selected, 0% if no vibe (use only standard scoring)
  const vibeWeight = prefs.vibe ? 0.6 : 0;
  const standardWeight = prefs.vibe ? 0.4 : 1.0;
  
  const scoredPlaces: ScoredPlace[] = vibeFiltered.map(item => {
    const scored = scorePlace(item.place, centerLat, centerLon, prefs);
    // Combine with vibe score based on whether vibe is selected
    const combinedScore = (scored._internalScore || 0) * standardWeight + item.vibeScore * vibeWeight;
    return { ...scored, _internalScore: combinedScore };
  });
  
  // STEP 4: Filter by walk time
  const maxWalkKm = (prefs.maxWalkMinutes / 12); // Convert back to km
  const distanceFiltered = scoredPlaces.filter(p => p.distanceKm <= maxWalkKm);
  
  // STEP 5: Filter by veg preference
  const vegFiltered = prefs.vegOnly 
    ? distanceFiltered.filter(p => p.vegFriendly)
    : distanceFiltered;
  
  // STEP 6: Sort by combined score descending
  vegFiltered.sort((a, b) => (b._internalScore || 0) - (a._internalScore || 0));
  
  // Get top 5 for debug (no scores exposed)
  const top5 = vegFiltered.slice(0, 5).map(p => ({
    name: p.name,
    distanceKm: p.distanceKm,
  }));
  
  // Recommended is top 1
  const recommended = vegFiltered.length > 0 ? vegFiltered[0] : null;
  const others = vegFiltered.slice(1);
  
  return {
    recommended,
    others,
    allPlaces: vegFiltered,
    debug: {
      rawCount,
      afterDedupeCount,
      top5
    }
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Haversine distance calculation (km)
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function capitalize(str: string): string {
  return str
    .split(/[_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// =============================================================================
// EXPORT DEBUG LOGGING HELPER
// =============================================================================

export function logRankingDebug(source: string, result: RankingResult, vibe?: string): void {
  console.log(`[Ranking] Source: ${source}${vibe ? `, Vibe: ${vibe}` : ''}`);
  console.log(`[Ranking] Raw: ${result.debug.rawCount}, Deduped: ${result.debug.afterDedupeCount}, Final: ${result.allPlaces.length}`);
  console.log(`[Ranking] Top 5:`);
  result.debug.top5.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name} (${p.distanceKm}km)`);
  });
  if (result.recommended) {
    console.log(`[Ranking] Recommended: "${result.recommended.name}"`);
  }
}
