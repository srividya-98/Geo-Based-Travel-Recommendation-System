import { NextResponse } from 'next/server';

export async function GET() {
  // Foursquare requires migration to new API - disabled for now
  // const foursquareConfigured = !!process.env.FOURSQUARE_API_KEY;
  const foursquareConfigured = false; // Disabled until API migration complete
  
  return NextResponse.json({
    providers: {
      foursquare: {
        configured: foursquareConfigured,
        name: 'Foursquare',
        description: 'Currently unavailable - API migration in progress',
      },
      openstreetmap: {
        configured: true, // Always available
        name: 'OpenStreetMap',
        description: 'Open data via Overpass API (reliable)',
      },
    },
    // Always default to OSM for now as it's reliable
    defaultProvider: 'openstreetmap',
  });
}
