#!/usr/bin/env python3
"""
Download OpenStreetMap PBF extracts from Geofabrik.

Usage:
    python download_geofabrik.py europe/spain
    python download_geofabrik.py europe/united-kingdom/england
    python download_geofabrik.py asia/japan

Data is saved to ../data/osm/<region>.osm.pbf
"""

import os
import sys
import hashlib
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Tuple

# Base URL for Geofabrik downloads
GEOFABRIK_BASE = "https://download.geofabrik.de"

# Common region shortcuts
REGION_SHORTCUTS = {
    "spain": "europe/spain",
    "france": "europe/france",
    "germany": "europe/germany",
    "italy": "europe/italy",
    "uk": "europe/united-kingdom",
    "england": "europe/united-kingdom/england",
    "japan": "asia/japan",
    "india": "asia/india",
    "usa": "north-america/us",
    "california": "north-america/us/california",
    "new-york": "north-america/us/new-york",
}

def get_script_dir() -> Path:
    """Get the directory where this script is located."""
    return Path(__file__).parent.resolve()

def get_data_dir() -> Path:
    """Get the data/osm directory."""
    script_dir = get_script_dir()
    data_dir = script_dir.parent / "data" / "osm"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir

def resolve_region(region: str) -> str:
    """Resolve region shortcuts to full paths."""
    return REGION_SHORTCUTS.get(region.lower(), region)

def get_download_urls(region: str) -> Tuple[str, str, str]:
    """Get PBF download URL and MD5 checksum URL."""
    region = resolve_region(region)
    # Geofabrik uses the last part of the path as filename
    filename = region.replace("/", "-")
    pbf_url = f"{GEOFABRIK_BASE}/{region}-latest.osm.pbf"
    md5_url = f"{GEOFABRIK_BASE}/{region}-latest.osm.pbf.md5"
    return pbf_url, md5_url, filename

def download_file(url: str, dest_path: Path, desc: str = "file") -> bool:
    """Download a file with progress indicator."""
    print(f"Downloading {desc}...")
    print(f"  URL: {url}")
    print(f"  Destination: {dest_path}")
    
    try:
        # Create request with User-Agent
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "LocalTravelAgent/1.0 (OSM data pipeline)"
            }
        )
        
        with urllib.request.urlopen(request, timeout=30) as response:
            total_size = response.headers.get('Content-Length')
            total_size = int(total_size) if total_size else None
            
            downloaded = 0
            chunk_size = 1024 * 1024  # 1MB chunks
            
            with open(dest_path, 'wb') as f:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    
                    if total_size:
                        pct = (downloaded / total_size) * 100
                        size_mb = downloaded / (1024 * 1024)
                        total_mb = total_size / (1024 * 1024)
                        print(f"\r  Progress: {size_mb:.1f} MB / {total_mb:.1f} MB ({pct:.1f}%)", end="", flush=True)
                    else:
                        size_mb = downloaded / (1024 * 1024)
                        print(f"\r  Downloaded: {size_mb:.1f} MB", end="", flush=True)
            
            print()  # New line after progress
            return True
            
    except urllib.error.HTTPError as e:
        print(f"\n  ERROR: HTTP {e.code} - {e.reason}")
        if e.code == 404:
            print(f"  Region not found. Check available regions at: {GEOFABRIK_BASE}")
        return False
    except urllib.error.URLError as e:
        print(f"\n  ERROR: {e.reason}")
        return False
    except Exception as e:
        print(f"\n  ERROR: {e}")
        return False

def verify_checksum(pbf_path: Path, md5_path: Path) -> bool:
    """Verify MD5 checksum of downloaded file."""
    if not md5_path.exists():
        print("  Checksum file not available, skipping verification")
        return True
    
    print("Verifying checksum...")
    
    # Read expected checksum
    with open(md5_path, 'r') as f:
        content = f.read().strip()
        # Format: "checksum  filename" or just "checksum"
        expected_md5 = content.split()[0].lower()
    
    # Calculate actual checksum
    md5_hash = hashlib.md5()
    with open(pbf_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192 * 1024), b""):
            md5_hash.update(chunk)
    
    actual_md5 = md5_hash.hexdigest().lower()
    
    if actual_md5 == expected_md5:
        print(f"  Checksum OK: {actual_md5}")
        return True
    else:
        print(f"  Checksum MISMATCH!")
        print(f"    Expected: {expected_md5}")
        print(f"    Actual:   {actual_md5}")
        return False

def download_region(region: str, force: bool = False) -> Optional[Path]:
    """
    Download OSM PBF for a region.
    
    Args:
        region: Region path (e.g., 'europe/spain')
        force: Re-download even if file exists
    
    Returns:
        Path to downloaded PBF file, or None if failed
    """
    pbf_url, md5_url, filename = get_download_urls(region)
    data_dir = get_data_dir()
    
    pbf_path = data_dir / f"{filename}.osm.pbf"
    md5_path = data_dir / f"{filename}.osm.pbf.md5"
    
    print(f"\n{'='*60}")
    print(f"Downloading OSM data for: {region}")
    print(f"{'='*60}\n")
    
    # Check if already exists
    if pbf_path.exists() and not force:
        size_mb = pbf_path.stat().st_size / (1024 * 1024)
        print(f"File already exists: {pbf_path}")
        print(f"  Size: {size_mb:.1f} MB")
        print(f"  Use --force to re-download")
        return pbf_path
    
    # Download MD5 checksum first (small file)
    download_file(md5_url, md5_path, "checksum file")
    
    # Download PBF file
    if not download_file(pbf_url, pbf_path, "OSM PBF file"):
        return None
    
    # Verify checksum
    if not verify_checksum(pbf_path, md5_path):
        print("\nWARNING: Checksum verification failed!")
        print("The file may be corrupted. Consider re-downloading with --force")
    
    size_mb = pbf_path.stat().st_size / (1024 * 1024)
    print(f"\nDownload complete!")
    print(f"  File: {pbf_path}")
    print(f"  Size: {size_mb:.1f} MB")
    
    return pbf_path

def list_popular_regions():
    """Print list of popular regions."""
    print("\nPopular regions (shortcuts):")
    print("-" * 40)
    for shortcut, full_path in sorted(REGION_SHORTCUTS.items()):
        print(f"  {shortcut:15} -> {full_path}")
    
    print("\nOther regions:")
    print("-" * 40)
    print("  Browse: https://download.geofabrik.de/")
    print("\nExamples:")
    print("  python download_geofabrik.py spain")
    print("  python download_geofabrik.py europe/france")
    print("  python download_geofabrik.py asia/india")
    print("  python download_geofabrik.py north-america/us/california")

def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print(__doc__)
        list_popular_regions()
        sys.exit(0)
    
    region = sys.argv[1]
    force = "--force" in sys.argv or "-f" in sys.argv
    
    result = download_region(region, force=force)
    
    if result:
        print(f"\nNext step: Import into PostGIS")
        print(f"  docker compose --profile import run osm2pgsql /scripts/import_osm.sh {region}")
        sys.exit(0)
    else:
        print("\nDownload failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()
