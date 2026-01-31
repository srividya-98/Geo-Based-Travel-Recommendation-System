"""
Ranking Logic for Local Travel & Restaurant Intelligence Agent.

This module implements the decision-making logic for ranking places based on
user preferences. It mirrors the TypeScript implementation in the Next.js app
and serves as a prototype for experimentation and validation.

Scoring Formula (max 100 points):
- Distance Score: 0-50 (closer = higher)
- Category Match: 0-20 (always 20 since we filter by category)
- Vibe Bonus: 0-10 (matches calm/lively preference)
- Veg Bonus: 0-10 (veg-friendly signals)
- Completeness Bonus: 0-10 (has hours/website/phone)
- Open Bonus: 0-5 (24/7 places)
"""

from dataclasses import dataclass, field
from typing import Literal, TypedDict
from math import radians, sin, cos, sqrt, atan2


@dataclass
class Place:
    """Represents a place from OpenStreetMap data."""
    id: str
    name: str
    lat: float
    lon: float
    category: Literal["food", "scenic", "indoor"]
    tags: dict = field(default_factory=dict)


class Preferences(TypedDict):
    """User search preferences."""
    category: Literal["food", "scenic", "indoor"]
    vibe: Literal["calm", "lively"]
    max_walk_mins: int
    veg_only: bool


@dataclass
class RankedPlace:
    """A place with computed ranking information."""
    place: Place
    score: float
    reasons: list[str]
    distance_km: float
    walk_mins: int
    metrics: dict


# Vibe keywords for matching
VIBE_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "food": {
        "calm": ["cafe", "tea", "coffee", "bakery", "quiet", "fine_dining"],
        "lively": ["fast_food", "bar", "pub", "nightclub", "food_court"],
    },
    "scenic": {
        "calm": ["park", "garden", "viewpoint", "nature", "temple", "church"],
        "lively": ["beach", "amusement", "zoo", "theme_park", "attraction"],
    },
    "indoor": {
        "calm": ["museum", "library", "gallery", "art"],
        "lively": ["cinema", "theatre", "mall", "arcade"],
    },
}

# Veg-friendly keywords in names
VEG_NAME_KEYWORDS = [
    "veg", "vegetarian", "vegan", "saravana", "murugan", 
    "ananda", "pure veg", "bhavan"
]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points using the Haversine formula.
    
    Args:
        lat1, lon1: Coordinates of first point (degrees)
        lat2, lon2: Coordinates of second point (degrees)
    
    Returns:
        Distance in kilometers
    """
    R = 6371  # Earth's radius in km
    
    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)
    
    a = sin(delta_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    
    return R * c


def estimate_walk_mins(distance_km: float, speed_kmh: float = 4.5) -> int:
    """
    Estimate walking time in minutes.
    
    Args:
        distance_km: Distance in kilometers
        speed_kmh: Walking speed (default 4.5 km/h, average walking pace)
    
    Returns:
        Estimated walking time in minutes (rounded)
    """
    return round((distance_km / speed_kmh) * 60)


def is_veg_friendly(tags: dict, name: str) -> bool:
    """
    Check if a place has veg-friendly signals.
    
    Args:
        tags: OSM tags dictionary
        name: Place name
    
    Returns:
        True if veg-friendly signals are found
    """
    # Check diet tags
    if tags.get("diet:vegetarian") in ("yes", "only"):
        return True
    if tags.get("diet:vegan") in ("yes", "only"):
        return True
    
    # Check cuisine
    cuisine = tags.get("cuisine", "").lower()
    if any(kw in cuisine for kw in ["vegetarian", "vegan", "south_indian"]):
        return True
    
    # Check name
    name_lower = name.lower()
    if any(kw in name_lower for kw in VEG_NAME_KEYWORDS):
        return True
    
    return False


def get_vibe_match(tags: dict, name: str, category: str, vibe: str) -> tuple[bool, str | None]:
    """
    Check if a place matches the desired vibe.
    
    Args:
        tags: OSM tags dictionary
        name: Place name
        category: Place category
        vibe: Desired vibe ("calm" or "lively")
    
    Returns:
        Tuple of (matches: bool, matched_keyword: str | None)
    """
    vibe_config = VIBE_KEYWORDS.get(category, {})
    keywords = vibe_config.get(vibe, [])
    
    # Check in tags and name
    tag_values = " ".join(str(v) for v in tags.values()).lower()
    name_lower = name.lower()
    
    for kw in keywords:
        if kw in tag_values or kw in name_lower:
            return True, kw.replace("_", " ")
    
    # Default matches based on category + amenity/leisure
    if vibe == "calm":
        if tags.get("leisure") in ("park", "garden") or tags.get("amenity") == "cafe":
            place_type = tags.get("leisure") or tags.get("amenity") or "place"
            return True, place_type
    else:  # lively
        if tags.get("amenity") in ("fast_food", "cinema"):
            return True, tags.get("amenity").replace("_", " ")
    
    return False, None


def get_open_status(tags: dict) -> Literal["open", "unknown"]:
    """
    Determine if a place is open based on opening_hours tag.
    
    We only confidently say "open" for 24/7 places.
    Complex parsing is avoided for reliability.
    
    Args:
        tags: OSM tags dictionary
    
    Returns:
        "open" if 24/7, otherwise "unknown"
    """
    hours = tags.get("opening_hours", "")
    if "24/7" in hours or "24 hours" in hours.lower():
        return "open"
    return "unknown"


def score_place(
    place: Place,
    center_lat: float,
    center_lon: float,
    prefs: Preferences
) -> tuple[float, list[str], dict]:
    """
    Score a single place based on preferences.
    
    Scoring breakdown (max 100):
    - Distance: 0-50 (closer = higher, 0km=50, 3km+=0)
    - Category Match: 20 (always, since filtered by category)
    - Vibe Bonus: 0-10 (matches calm/lively)
    - Veg Bonus: 0-10 (veg-friendly signals)
    - Completeness: 0-10 (has hours/website/phone)
    - Open Bonus: 0-5 (24/7 places)
    
    Args:
        place: Place to score
        center_lat, center_lon: Search center coordinates
        prefs: User preferences
    
    Returns:
        Tuple of (score, reasons list, metrics dict)
    """
    tags = place.tags
    reasons: list[str] = []
    
    # Calculate distance
    distance_km = haversine_km(center_lat, center_lon, place.lat, place.lon)
    walk_mins = estimate_walk_mins(distance_km)
    
    # 1. Distance Score (0-50)
    # Linear: 0km = 50pts, 3km = 0pts
    distance_score = max(0, 50 - (distance_km / 3) * 50)
    reasons.append(f"Close by: {distance_km:.1f} km (~{walk_mins} min walk)")
    
    # 2. Category Match (0-20)
    # All places match since we filter by category
    category_score = 20
    
    # 3. Vibe Bonus (0-10)
    vibe_score = 0
    vibe_matches, vibe_keyword = get_vibe_match(tags, place.name, place.category, prefs["vibe"])
    if vibe_matches:
        vibe_score = 10
        reasons.append(f"Matches {prefs['vibe']} vibe: {vibe_keyword}")
    
    # 4. Veg Bonus (0-10)
    veg_score = 0
    veg_friendly = is_veg_friendly(tags, place.name)
    if veg_friendly:
        veg_score = 10 if prefs["veg_only"] else 5
        reasons.append("Veg-friendly")
    
    # 5. Completeness Bonus (0-10)
    completeness_score = 0
    completeness_details: list[str] = []
    
    if tags.get("opening_hours"):
        completeness_score += 4
        completeness_details.append("hours")
    if tags.get("website") or tags.get("contact:website"):
        completeness_score += 3
        completeness_details.append("website")
    if tags.get("phone") or tags.get("contact:phone"):
        completeness_score += 3
        completeness_details.append("phone")
    
    if completeness_details:
        reasons.append(f"Has: {', '.join(completeness_details)}")
    
    # 6. Open Bonus (0-5)
    open_bonus = 0
    open_status = get_open_status(tags)
    if open_status == "open":
        open_bonus = 5
        reasons.append("Open 24/7")
    
    # Total score (capped at 100)
    total_score = min(100, round(
        distance_score + category_score + vibe_score + 
        veg_score + completeness_score + open_bonus
    ))
    
    # Metrics for debugging/analysis
    metrics = {
        "distance_km": round(distance_km, 2),
        "walk_mins": walk_mins,
        "distance_score": round(distance_score, 1),
        "category_score": category_score,
        "vibe_score": vibe_score,
        "veg_score": veg_score,
        "completeness_score": completeness_score,
        "open_bonus": open_bonus,
        "veg_friendly": veg_friendly,
        "open_status": open_status,
    }
    
    return total_score, reasons, metrics


def rank_places(
    places: list[Place],
    center_lat: float,
    center_lon: float,
    prefs: Preferences
) -> list[RankedPlace]:
    """
    Rank places and return top 2 recommendations.
    
    Process:
    1. Filter by max walk time
    2. Filter by veg-only preference (if enabled)
    3. Score each place
    4. Sort by score descending
    5. Return top 2
    
    Args:
        places: List of places to rank
        center_lat, center_lon: Search center coordinates
        prefs: User preferences
    
    Returns:
        List of top 2 RankedPlace objects
    """
    ranked: list[RankedPlace] = []
    
    for place in places:
        # Filter by category
        if place.category != prefs["category"]:
            continue
        
        # Calculate distance first for walk time filter
        distance_km = haversine_km(center_lat, center_lon, place.lat, place.lon)
        walk_mins = estimate_walk_mins(distance_km)
        
        # Filter by max walk time
        if walk_mins > prefs["max_walk_mins"]:
            continue
        
        # Filter by veg-only
        if prefs["veg_only"] and not is_veg_friendly(place.tags, place.name):
            continue
        
        # Score the place
        score, reasons, metrics = score_place(place, center_lat, center_lon, prefs)
        
        ranked.append(RankedPlace(
            place=place,
            score=score,
            reasons=reasons,
            distance_km=round(distance_km, 2),
            walk_mins=walk_mins,
            metrics=metrics,
        ))
    
    # Sort by score descending
    ranked.sort(key=lambda r: r.score, reverse=True)
    
    # Return top 2
    return ranked[:2]


if __name__ == "__main__":
    # Quick test
    test_place = Place(
        id="test-1",
        name="Saravana Bhavan",
        lat=13.0604,
        lon=80.2496,
        category="food",
        tags={
            "amenity": "restaurant",
            "cuisine": "south_indian;vegetarian",
            "opening_hours": "06:00-23:00",
        }
    )
    
    prefs: Preferences = {
        "category": "food",
        "vibe": "calm",
        "max_walk_mins": 20,
        "veg_only": False,
    }
    
    # Chennai center
    center_lat, center_lon = 13.0827, 80.2707
    
    score, reasons, metrics = score_place(test_place, center_lat, center_lon, prefs)
    
    print(f"Place: {test_place.name}")
    print(f"Score: {score}/100")
    print("Reasons:")
    for r in reasons:
        print(f"  - {r}")
    print(f"Metrics: {metrics}")
