import { z } from 'zod';

// Vibe options - 5 recruiter-grade vibe chips (OPTIONAL feature)
export const VibeSchema = z.enum(['insta', 'work', 'romantic', 'budget', 'lively']).nullable().optional();
export type Vibe = 'insta' | 'work' | 'romantic' | 'budget' | 'lively' | null | undefined;

// Vibe display info for UI
export const VIBE_OPTIONS = [
  { id: 'insta', label: 'Insta / Aesthetic', emoji: '📸' },
  { id: 'work', label: 'Work-friendly', emoji: '💻' },
  { id: 'romantic', label: 'Romantic', emoji: '🌙' },
  { id: 'budget', label: 'Budget', emoji: '💸' },
  { id: 'lively', label: 'Lively', emoji: '🎉' },
] as const;

// Categories where vibe filter makes sense
export const VIBE_APPLICABLE_CATEGORIES = ['restaurant', 'cafe'] as const;

// Category options
export const CategorySchema = z.enum(['restaurant', 'cafe', 'grocery', 'scenic', 'indoor']);
export type Category = z.infer<typeof CategorySchema>;

// User preferences schema
export const PreferencesSchema = z.object({
  location: z.string().min(1, 'Location is required'),
  neighborhood: z.string().optional(),
  vegOnly: z.boolean().default(false),
  maxWalkMinutes: z.number().min(5).max(60).default(15),
  vibe: VibeSchema.default(null),  // Vibe is OPTIONAL - null means no vibe filter
  category: CategorySchema.nullable().default(null),  // No default - user must click a category
});

export type Preferences = z.infer<typeof PreferencesSchema>;

// Lat/Lon interface
export interface LatLon {
  lat: number;
  lon: number;
}

// Geocode response from API
export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  country?: string;
  city?: string;
  bbox?: [number, number, number, number]; // [south, north, west, east]
}

// Selected location for autocomplete
export interface SelectedLocation {
  lat: number;
  lon: number;
  displayName: string;
}

// Autocomplete suggestion
export interface LocationSuggestion {
  id: string;
  displayName: string;
  shortName: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
}

// Open status type
export type OpenStatus = 'open' | 'unknown';

// Place interface (returned from API after ranking)
export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  type: string;
  tags: string[];
  distanceKm: number;
  walkMins: number;
  reasons: string[];
  vegFriendly: boolean;
  openStatus: OpenStatus;
  
  // Bayesian ranking fields (optional, present when using Bayesian model)
  probability?: number;    // Posterior mean P(user_likes_venue) - 0 to 1
  p10?: number;           // 10th percentile credible interval
  p90?: number;           // 90th percentile credible interval
  confidence?: number;    // Confidence score (1 - interval width) - 0 to 1
}

// Confidence level based on credible interval width
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// Helper function to get confidence level from score
export function getConfidenceLevel(confidence?: number): ConfidenceLevel {
  if (confidence === undefined) return 'medium';
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

// Helper function to format probability as percentage
export function formatProbability(probability?: number): string {
  if (probability === undefined) return '--';
  return `${Math.round(probability * 100)}%`;
}

// Helper function to format credible interval
export function formatCredibleInterval(p10?: number, p90?: number): string {
  if (p10 === undefined || p90 === undefined) return '';
  return `${Math.round(p10 * 100)}-${Math.round(p90 * 100)}%`;
}

// Raw place from Overpass (before ranking)
export interface PlaceRaw {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

// Overpass API element
export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// Places API response
export interface PlacesApiResponse {
  ok: boolean;
  allPlaces: Place[];
  topPlaces: Place[];
  recommended: Place | null;  // Single recommended place (1.6x larger marker on map)
  cached: boolean;
  totalBeforeFilter: number;
  totalAfterFilter: number;
  dataSource?: string;
  rankingModel?: string;  // 'ds-bayesian' for Foursquare DS-style ranking
  vegFilterWarning?: string | null;  // Warning if veg filter couldn't be applied
}

// Default center for globe view (center of Earth)
export const DEFAULT_CENTER: LatLon = {
  lat: 0,
  lon: 0,
};

// LocalStorage key for persisting last location
export const STORAGE_KEY_LAST_LOCATION = 'travel_agent_last_location';

// Suggested areas (now generic examples)
export const SUGGESTED_LOCATIONS = [
  'Paris, France',
  'Tokyo, Japan',
  'New York, USA',
  'Chennai, India',
  'Barcelona, Spain',
];
