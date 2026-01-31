import "./globals.css";
import "leaflet/dist/leaflet.css";
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Local Travel Agent | Discover Places Nearby',
  description: 'Intelligent travel recommendations using OpenStreetMap data. Find restaurants, scenic spots, and indoor activities in your city.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 antialiased">
        {children}
      </body>
    </html>
  );
}
