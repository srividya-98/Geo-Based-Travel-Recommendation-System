import { 
  Place, 
  Category, 
  OverpassElement,
  CITY_COORDS 
} from './types';

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Map our categories to OSM tags
const CATEGORY_TAGS: Record<Category, string[]> = {
  food: [
    'amenity=restaurant',
    'amenity=cafe',
    'amenity=fast_food',
    'amenity=food_court',
    'shop=bakery',
  ],
  scenic: [
    'leisure=park',
    'leisure=garden',
    'tourism=viewpoint',
    'natural=beach',
    'amenity=fountain',
    'historic=monument',
  ],
  indoor: [
    'amenity=library',
    'amenity=cinema',
    'amenity=theatre',
    'shop=mall',
    'shop=department_store',
    'tourism=museum',
    'tourism=gallery',
  ],
};

// Build Overpass QL query
function buildQuery(
  lat: number,
  lon: number,
  radiusMeters: number,
  category: Category
): string {
  const tags = CATEGORY_TAGS[category];
  const tagQueries = tags
    .map((tag) => {
      const [key, value] = tag.split('=');
      return `node["${key}"="${value}"](around:${radiusMeters},${lat},${lon});`;
    })
    .join('\n');

  return `
    [out:json][timeout:25];
    (
      ${tagQueries}
    );
    out body;
    >;
    out skel qt;
  `.trim();
}

// Check if a place is likely veg-friendly based on tags
function isVegFriendly(tags: Record<string, string>): boolean {
  const vegTags = [
    'diet:vegetarian',
    'diet:vegan',
    'cuisine',
  ];
  
  for (const tag of vegTags) {
    const value = tags[tag]?.toLowerCase() || '';
    if (
      value.includes('vegetarian') ||
      value.includes('vegan') ||
      value.includes('south_indian') ||
      value.includes('indian')
    ) {
      return true;
    }
  }
  
  // Check name for common veg indicators
  const name = tags.name?.toLowerCase() || '';
  const vegKeywords = ['veg', 'vegetarian', 'vegan', 'saravana', 'murugan', 'ananda'];
  return vegKeywords.some((kw) => name.includes(kw));
}

// Simple heuristic for "open now" based on opening_hours
function checkOpenNow(openingHours?: string): boolean {
  if (!openingHours) return true; // Assume open if no data
  
  // Very basic parsing - in production use a proper library
  const now = new Date();
  const hour = now.getHours();
  
  // Most places are open 9-22
  if (hour >= 9 && hour < 22) return true;
  
  // Check for 24/7
  if (openingHours.includes('24/7')) return true;
  
  return false;
}

// Calculate rating proxy based on available metadata
function calculateRatingProxy(tags: Record<string, string>): number {
  let score = 3; // Base score
  
  // Has name = more established
  if (tags.name) score += 0.5;
  
  // Has website = more established
  if (tags.website || tags['contact:website']) score += 0.5;
  
  // Has phone = more established
  if (tags.phone || tags['contact:phone']) score += 0.3;
  
  // Has opening hours = well documented
  if (tags.opening_hours) score += 0.3;
  
  // Has cuisine tag = restaurant is well documented
  if (tags.cuisine) score += 0.2;
  
  // Wheelchair accessible = established place
  if (tags.wheelchair === 'yes') score += 0.2;
  
  return Math.min(5, Math.max(1, score));
}

// Extract tags for display
function extractDisplayTags(tags: Record<string, string>, category: Category): string[] {
  const displayTags: string[] = [];
  
  if (tags.cuisine) {
    displayTags.push(tags.cuisine.split(';')[0].replace(/_/g, ' '));
  }
  
  if (tags.amenity) {
    displayTags.push(tags.amenity.replace(/_/g, ' '));
  }
  
  if (tags.leisure) {
    displayTags.push(tags.leisure.replace(/_/g, ' '));
  }
  
  if (tags.tourism) {
    displayTags.push(tags.tourism.replace(/_/g, ' '));
  }
  
  if (isVegFriendly(tags)) {
    displayTags.push('veg-friendly');
  }
  
  if (tags.outdoor_seating === 'yes') {
    displayTags.push('outdoor seating');
  }
  
  if (tags.wheelchair === 'yes') {
    displayTags.push('accessible');
  }
  
  return [...new Set(displayTags)].slice(0, 4);
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Normalize Overpass element to our Place type
function normalizePlace(
  element: OverpassElement,
  category: Category,
  centerLat: number,
  centerLon: number
): Place | null {
  const tags = element.tags || {};
  
  // Skip places without names
  if (!tags.name) return null;
  
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  
  if (lat === undefined || lon === undefined) return null;
  
  return {
    id: `${element.type}-${element.id}`,
    name: tags.name,
    lat,
    lon,
    category,
    tags: extractDisplayTags(tags, category),
    cuisine: tags.cuisine?.split(';')[0].replace(/_/g, ' '),
    vegFriendly: isVegFriendly(tags),
    openingHours: tags.opening_hours,
    isOpenNow: checkOpenNow(tags.opening_hours),
    distance: calculateDistance(centerLat, centerLon, lat, lon),
    ratingProxy: calculateRatingProxy(tags),
  };
}

// Main function to fetch places from Overpass
export async function fetchPlaces(
  city: string,
  category: Category,
  radiusMeters: number = 2000
): Promise<{ places: Place[]; center: { lat: number; lon: number } }> {
  const coords = CITY_COORDS[city] || CITY_COORDS['Chennai'];
  const { lat, lon } = coords;
  
  const query = buildQuery(lat, lon, radiusMeters, category);
  
  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  
  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }
  
  const data = await response.json();
  const elements: OverpassElement[] = data.elements || [];
  
  const places = elements
    .map((el) => normalizePlace(el, category, lat, lon))
    .filter((p): p is Place => p !== null)
    .sort((a, b) => (a.distance || 0) - (b.distance || 0));
  
  return { places, center: coords };
}

// Convert walk minutes to meters (assuming 80m/min walking speed)
export function walkMinutesToMeters(minutes: number): number {
  return minutes * 80;
}
