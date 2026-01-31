'use client';

import { useState, useEffect } from 'react';

export type Provider = 'foursquare' | 'openstreetmap';

interface ProviderStatus {
  providers: {
    foursquare: { configured: boolean; name: string; description: string };
    openstreetmap: { configured: boolean; name: string; description: string };
  };
  defaultProvider: Provider;
}

// Default status to use if API fails or is slow
const DEFAULT_STATUS: ProviderStatus = {
  providers: {
    foursquare: { configured: false, name: 'Foursquare', description: 'Unavailable' },
    openstreetmap: { configured: true, name: 'OpenStreetMap', description: 'Open data via Overpass API' },
  },
  defaultProvider: 'openstreetmap',
};

interface ProviderToggleProps {
  value: Provider;
  onChange: (provider: Provider) => void;
}

export function ProviderToggle({ value, onChange }: ProviderToggleProps) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    
    // Timeout after 3 seconds - use defaults if API is slow
    const timeout = setTimeout(() => {
      if (loading) {
        console.log('[ProviderToggle] Timeout - using default status');
        setStatus(DEFAULT_STATUS);
        setLoading(false);
      }
    }, 3000);
    
    fetch('/api/provider-status', { signal: controller.signal })
      .then(res => res.json())
      .then((data: ProviderStatus) => {
        clearTimeout(timeout);
        setStatus(data);
        // Set default provider on initial load
        if (data.defaultProvider && value !== data.defaultProvider) {
          onChange(data.defaultProvider);
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Failed to fetch provider status:', err);
        }
        // Use defaults on error
        setStatus(DEFAULT_STATUS);
      })
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });
    
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  if (loading || !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <div className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
        Loading providers...
      </div>
    );
  }

  const fsqConfigured = status.providers.foursquare.configured;

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium text-slate-600">Data:</span>
      <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
        {/* Foursquare Button */}
        <button
          type="button"
          onClick={() => fsqConfigured && onChange('foursquare')}
          disabled={!fsqConfigured}
          className={`
            relative px-3 py-1.5 text-sm font-medium rounded-md transition-all
            ${value === 'foursquare' 
              ? 'bg-white text-blue-600 shadow-sm' 
              : fsqConfigured 
                ? 'text-slate-600 hover:text-slate-800' 
                : 'text-slate-400 cursor-not-allowed'
            }
          `}
          title={fsqConfigured ? 'Foursquare Places API' : 'Set FOURSQUARE_API_KEY to enable'}
        >
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.727 3H6.273A2.273 2.273 0 0 0 4 5.273v13.454A2.273 2.273 0 0 0 6.273 21h11.454A2.273 2.273 0 0 0 20 18.727V5.273A2.273 2.273 0 0 0 17.727 3zm-1.59 4.364l-.682 3.182a.57.57 0 0 1-.568.454H12.5l-.568 2.614a.284.284 0 0 1-.284.227h-1.42a.284.284 0 0 1-.284-.34l1.705-7.842a.568.568 0 0 1 .568-.454h4.773a.568.568 0 0 1 .568.682l-.568 1.477z"/>
            </svg>
            Foursquare
            {value === 'foursquare' && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
            )}
          </span>
        </button>

        {/* OpenStreetMap Button */}
        <button
          type="button"
          onClick={() => onChange('openstreetmap')}
          className={`
            relative px-3 py-1.5 text-sm font-medium rounded-md transition-all
            ${value === 'openstreetmap' 
              ? 'bg-white text-green-600 shadow-sm' 
              : 'text-slate-600 hover:text-slate-800'
            }
          `}
          title="OpenStreetMap via Overpass API"
        >
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            OSM
            {value === 'openstreetmap' && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
            )}
          </span>
        </button>
      </div>
      
      {!fsqConfigured && (
        <span className="text-xs text-slate-500" title="Foursquare API migration in progress">
          FSQ unavailable
        </span>
      )}
    </div>
  );
}
