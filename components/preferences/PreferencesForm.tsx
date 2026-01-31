'use client';

import { useCallback } from 'react';
import { Preferences, SelectedLocation, VIBE_OPTIONS, Vibe, VIBE_APPLICABLE_CATEGORIES } from '@/lib/types';
import AutocompleteInput, { Suggestion } from '@/components/ui/AutocompleteInput';

interface PreferencesFormProps {
  preferences: Preferences;
  onChange: (prefs: Preferences) => void;
  onSubmit: () => void;
  isLoading: boolean;
  geocodeError?: string | null;
  onUseMyLocation?: () => void;
  isLocating?: boolean;
  locationError?: string | null;
  usingCurrentLocation?: boolean;
  selectedCity: SelectedLocation | null;
  onSelectCity: (city: SelectedLocation | null) => void;
  selectedArea: SelectedLocation | null;
  onSelectArea: (area: SelectedLocation | null) => void;
}

// Fetch city suggestions
async function fetchCitySuggestions(query: string): Promise<Suggestion[]> {
  try {
    const params = new URLSearchParams({ q: query, type: 'city' });
    const response = await fetch(`/api/geocode/suggest?${params}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.suggestions || [];
  } catch {
    return [];
  }
}

// Fetch area suggestions (with city context)
async function fetchAreaSuggestions(query: string, nearLat?: number, nearLon?: number): Promise<Suggestion[]> {
  try {
    const params = new URLSearchParams({ q: query, type: 'area' });
    if (nearLat !== undefined && nearLon !== undefined) {
      params.set('nearLat', nearLat.toString());
      params.set('nearLon', nearLon.toString());
    }
    const response = await fetch(`/api/geocode/suggest?${params}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.suggestions || [];
  } catch {
    return [];
  }
}

export default function PreferencesForm({
  preferences,
  onChange,
  onSubmit,
  isLoading,
  geocodeError,
  onUseMyLocation,
  isLocating = false,
  locationError,
  usingCurrentLocation = false,
  selectedCity,
  onSelectCity,
  selectedArea,
  onSelectArea,
}: PreferencesFormProps) {
  const updatePref = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    onChange({ ...preferences, [key]: value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  // Handle city selection
  const handleCitySelect = useCallback((suggestion: Suggestion) => {
    onSelectCity({
      lat: suggestion.lat,
      lon: suggestion.lon,
      displayName: suggestion.shortName,
    });
    updatePref('location', suggestion.shortName);
    // Clear area when city changes
    onSelectArea(null);
    updatePref('neighborhood', undefined);
  }, [onSelectCity, onSelectArea, updatePref]);

  // Handle area selection
  const handleAreaSelect = useCallback((suggestion: Suggestion) => {
    onSelectArea({
      lat: suggestion.lat,
      lon: suggestion.lon,
      displayName: suggestion.shortName,
    });
    updatePref('neighborhood', suggestion.shortName);
  }, [onSelectArea, updatePref]);

  // Fetch area suggestions with city context
  const fetchAreaWithContext = useCallback((query: string) => {
    return fetchAreaSuggestions(query, selectedCity?.lat, selectedCity?.lon);
  }, [selectedCity?.lat, selectedCity?.lon]);

  // Handle city input change (clear selected city if user types)
  const handleCityChange = useCallback((value: string) => {
    updatePref('location', value);
    // If user is typing something different from selected, clear selection
    if (selectedCity && value !== selectedCity.displayName) {
      onSelectCity(null);
    }
  }, [selectedCity, onSelectCity, updatePref]);

  // Handle area input change
  const handleAreaChange = useCallback((value: string) => {
    updatePref('neighborhood', value || undefined);
    // If user is typing something different from selected, clear selection
    if (selectedArea && value !== selectedArea.displayName) {
      onSelectArea(null);
    }
  }, [selectedArea, onSelectArea, updatePref]);

  return (
    <form onSubmit={handleSubmit} className="card-premium-solid p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800">Search Preferences</h2>
          <p className="text-xs text-slate-500">Find places anywhere in the world</p>
        </div>
      </div>

      {/* Location Section */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Location</span>
        </div>

        {/* Use My Location Button */}
        {onUseMyLocation && (
          <button
            type="button"
            onClick={onUseMyLocation}
            disabled={isLocating}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-200 mb-3 ${
              usingCurrentLocation
                ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50/50'
            }`}
          >
            {isLocating ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm font-medium">Getting location...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm font-medium">
                  {usingCurrentLocation ? '✓ Using your location' : 'Use my current location'}
                </span>
              </>
            )}
          </button>
        )}

        {locationError && (
          <p className="mb-3 text-xs text-red-600 flex items-center gap-1 bg-red-50 px-3 py-2 rounded-lg">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {locationError}
          </p>
        )}

        {/* Divider */}
        {!usingCurrentLocation && (
          <>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 bg-white text-xs text-slate-400">or search by city/place</span>
              </div>
            </div>

            {/* City/Location Input with Autocomplete */}
            <div className="mb-3">
              <AutocompleteInput
                label="Where are you searching?"
                placeholder="e.g., Madrid, Tokyo, New York"
                value={usingCurrentLocation ? 'Current location' : preferences.location}
                onChange={handleCityChange}
                onSelect={handleCitySelect}
                fetchSuggestions={fetchCitySuggestions}
                disabled={usingCurrentLocation}
                error={geocodeError}
              />
              {selectedCity && (
                <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Location selected
                </p>
              )}
            </div>

            {/* Area/Neighborhood Input with Autocomplete */}
            <div>
              <AutocompleteInput
                label="Specific area (optional)"
                placeholder="e.g., Downtown, Malasaña, Shibuya"
                value={preferences.neighborhood || ''}
                onChange={handleAreaChange}
                onSelect={handleAreaSelect}
                fetchSuggestions={fetchAreaWithContext}
                helpText={selectedCity ? `Searching near ${selectedCity.displayName}` : 'Select a city first for better results'}
              />
              {selectedArea && (
                <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Area selected
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Category Section - no default; results only after user selects */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</span>
          <span className="text-xs text-slate-400 font-normal">(select to see results)</span>
        </div>
        
        <div className="grid grid-cols-1 gap-2">
          {([
            { value: 'restaurant', label: 'Restaurant', color: 'orange', borderColor: 'border-orange-400', bgColor: 'bg-orange-50' },
            { value: 'cafe', label: 'Café', color: 'amber', borderColor: 'border-amber-400', bgColor: 'bg-amber-50' },
            { value: 'grocery', label: 'Grocery Store', color: 'green', borderColor: 'border-green-400', bgColor: 'bg-green-50' },
            { value: 'scenic', label: 'Scenic & Outdoors', color: 'blue', borderColor: 'border-blue-400', bgColor: 'bg-blue-50' },
            { value: 'indoor', label: 'Indoor Activities', color: 'purple', borderColor: 'border-purple-400', bgColor: 'bg-purple-50' },
          ] as const).map((option) => (
            <label
              key={option.value}
              className={`flex items-center p-3.5 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                preferences.category === option.value
                  ? `${option.borderColor} ${option.bgColor} shadow-sm`
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="category"
                value={option.value}
                checked={preferences.category === option.value}
                onChange={() => {
                  // Single update so category is not overwritten by stale closure (e.g. when clearing vibe)
                  const isVibeCategory = VIBE_APPLICABLE_CATEGORIES.includes(option.value as typeof VIBE_APPLICABLE_CATEGORIES[number]);
                  onChange({
                    ...preferences,
                    category: option.value,
                    vibe: isVibeCategory ? preferences.vibe : null,
                  });
                }}
                className="sr-only"
              />
              {/* Custom SVG Icon */}
              <div className="w-8 h-8 mr-3 flex-shrink-0 rounded-lg overflow-hidden shadow-sm">
                <img 
                  src={`/icons/${option.value}.svg`} 
                  alt={option.label}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className={`text-sm font-medium ${
                preferences.category === option.value ? 'text-slate-800' : 'text-slate-600'
              }`}>
                {option.label}
              </span>
              {preferences.category === option.value && (
                <svg className="w-5 h-5 text-blue-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Vibe Section - Only for Restaurant/Cafe categories (OPTIONAL) */}
      {VIBE_APPLICABLE_CATEGORIES.includes(preferences.category as typeof VIBE_APPLICABLE_CATEGORIES[number]) && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Vibe</span>
              <span className="text-xs text-slate-400 font-normal">(optional)</span>
            </div>
            {preferences.vibe && (
              <button
                type="button"
                onClick={() => updatePref('vibe', null)}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2">
            {VIBE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  // Toggle: click again to deselect
                  if (preferences.vibe === option.id) {
                    updatePref('vibe', null);
                  } else {
                    updatePref('vibe', option.id as Vibe);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full border-2 text-sm font-medium transition-all duration-200 ${
                  preferences.vibe === option.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm ring-2 ring-blue-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="text-base">{option.emoji}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          
          {!preferences.vibe && (
            <p className="mt-2 text-xs text-slate-400">
              Select a vibe to filter results, or leave empty for all options
            </p>
          )}
        </div>
      )}

      {/* Walk Time Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Max Walk</span>
          </div>
          <span className="text-sm font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
            {preferences.maxWalkMinutes} min
          </span>
        </div>
        <input
          type="range"
          min={5}
          max={45}
          step={5}
          value={preferences.maxWalkMinutes}
          onChange={(e) => updatePref('maxWalkMinutes', parseInt(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1.5">
          <span>5 min</span>
          <span>25 min</span>
          <span>45 min</span>
        </div>
      </div>

      {/* Diet Section */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Diet</span>
        </div>
        
        <label className="flex items-center justify-between p-3.5 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-all duration-200">
          <div className="flex items-center gap-3">
            <span className="text-xl">🥬</span>
            <span className="text-sm font-medium text-slate-700">Vegetarian only</span>
          </div>
          <button
            type="button"
            onClick={() => updatePref('vegOnly', !preferences.vegOnly)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
              preferences.vegOnly ? 'bg-emerald-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                preferences.vegOnly ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Loading indicator for auto-search */}
      {isLoading && (usingCurrentLocation || selectedCity || selectedArea) && (
        <div className="mb-4 flex items-center justify-center gap-2 py-3 px-4 bg-blue-50 rounded-xl border border-blue-200 animate-pulse">
          <svg className="animate-spin h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium text-blue-700">Updating results...</span>
        </div>
      )}

      {/* Submit Button - only needed for initial search or when no location is set */}
      {!(usingCurrentLocation || selectedCity || selectedArea) && (
        <button
          type="submit"
          disabled={isLoading || (!usingCurrentLocation && !preferences.location.trim())}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-blue-400 disabled:to-indigo-400 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Finding best options...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Find My Best Option</span>
            </>
          )}
        </button>
      )}
    </form>
  );
}
