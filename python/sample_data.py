"""
Sample place data for testing the ranking logic.

This data simulates places in Chennai with a mix of:
- Categories: food, scenic, indoor
- Tags: cuisine types, amenities, opening hours
- Veg-friendly and non-veg options
- Varying distances from city center
"""

from ranking_logic import Place


# Chennai city center coordinates
CHENNAI_CENTER = (13.0827, 80.2707)

# Sample places - mix of categories and attributes
SAMPLE_PLACES: list[Place] = [
    # === FOOD ===
    Place(
        id="food-1",
        name="Saravana Bhavan",
        lat=13.0604,
        lon=80.2496,
        category="food",
        tags={
            "amenity": "restaurant",
            "cuisine": "south_indian;vegetarian",
            "diet:vegetarian": "only",
            "opening_hours": "06:00-23:00",
            "website": "https://saravanabhavan.com",
            "phone": "+91 44 2434 7979",
        }
    ),
    Place(
        id="food-2",
        name="Murugan Idli Shop",
        lat=13.0678,
        lon=80.2376,
        category="food",
        tags={
            "amenity": "restaurant",
            "cuisine": "south_indian",
            "diet:vegetarian": "yes",
            "opening_hours": "07:00-22:00",
        }
    ),
    Place(
        id="food-3",
        name="Cafe Coffee Day",
        lat=13.0850,
        lon=80.2750,
        category="food",
        tags={
            "amenity": "cafe",
            "cuisine": "coffee_shop",
            "internet_access": "wlan",
            "opening_hours": "08:00-23:00",
        }
    ),
    Place(
        id="food-4",
        name="McDonald's Express",
        lat=13.0900,
        lon=80.2800,
        category="food",
        tags={
            "amenity": "fast_food",
            "cuisine": "burger",
            "brand": "McDonald's",
            "opening_hours": "24/7",
            "takeaway": "yes",
        }
    ),
    Place(
        id="food-5",
        name="Ananda Bhavan",
        lat=13.0750,
        lon=80.2600,
        category="food",
        tags={
            "amenity": "restaurant",
            "cuisine": "indian;vegetarian",
            "diet:vegetarian": "only",
            "outdoor_seating": "yes",
        }
    ),
    
    # === SCENIC ===
    Place(
        id="scenic-1",
        name="Marina Beach",
        lat=13.0500,
        lon=80.2824,
        category="scenic",
        tags={
            "natural": "beach",
            "tourism": "attraction",
            "opening_hours": "24/7",
        }
    ),
    Place(
        id="scenic-2",
        name="Semmozhi Poonga",
        lat=13.0650,
        lon=80.2550,
        category="scenic",
        tags={
            "leisure": "park",
            "name:ta": "செம்மொழி பூங்கா",
            "opening_hours": "10:00-20:00",
            "fee": "yes",
        }
    ),
    Place(
        id="scenic-3",
        name="Guindy National Park",
        lat=13.0060,
        lon=80.2350,
        category="scenic",
        tags={
            "leisure": "park",
            "tourism": "attraction",
            "boundary": "national_park",
            "opening_hours": "09:00-17:30",
            "website": "https://forests.tn.gov.in",
        }
    ),
    
    # === INDOOR ===
    Place(
        id="indoor-1",
        name="Government Museum Chennai",
        lat=13.0694,
        lon=80.2538,
        category="indoor",
        tags={
            "tourism": "museum",
            "museum": "history",
            "opening_hours": "09:30-17:00",
            "website": "https://chennaimuseum.org",
            "wheelchair": "yes",
        }
    ),
    Place(
        id="indoor-2",
        name="Sathyam Cinemas",
        lat=13.0500,
        lon=80.2500,
        category="indoor",
        tags={
            "amenity": "cinema",
            "brand": "Sathyam",
            "opening_hours": "09:00-01:00",
            "website": "https://sfrcinemas.com",
            "phone": "+91 44 4224 4224",
        }
    ),
    Place(
        id="indoor-3",
        name="Connemara Public Library",
        lat=13.0680,
        lon=80.2560,
        category="indoor",
        tags={
            "amenity": "library",
            "building": "yes",
            "historic": "yes",
            "opening_hours": "Mo-Sa 09:30-18:00",
        }
    ),
    Place(
        id="indoor-4",
        name="Express Avenue Mall",
        lat=13.0590,
        lon=80.2640,
        category="indoor",
        tags={
            "shop": "mall",
            "amenity": "cinema",  # Has cinema inside
            "opening_hours": "10:00-22:00",
            "website": "https://expressavenue.in",
        }
    ),
]


def get_places_by_category(category: str) -> list[Place]:
    """Filter sample places by category."""
    return [p for p in SAMPLE_PLACES if p.category == category]


def get_all_places() -> list[Place]:
    """Get all sample places."""
    return SAMPLE_PLACES.copy()


if __name__ == "__main__":
    print(f"Total places: {len(SAMPLE_PLACES)}")
    print(f"  Food: {len(get_places_by_category('food'))}")
    print(f"  Scenic: {len(get_places_by_category('scenic'))}")
    print(f"  Indoor: {len(get_places_by_category('indoor'))}")
    
    print("\nPlaces:")
    for p in SAMPLE_PLACES:
        print(f"  [{p.category}] {p.name}")
