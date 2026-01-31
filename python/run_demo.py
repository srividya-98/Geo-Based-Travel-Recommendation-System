#!/usr/bin/env python3
"""
Demo script for the Local Travel Agent ranking logic.

This script demonstrates the ranking algorithm with sample data,
showing how places are scored and ranked based on user preferences.

Usage:
    python run_demo.py
"""

from ranking_logic import rank_places, Preferences, haversine_km
from sample_data import SAMPLE_PLACES, CHENNAI_CENTER


def print_separator(char: str = "=", length: int = 60):
    """Print a separator line."""
    print(char * length)


def run_demo():
    """Run the ranking demo with different preference combinations."""
    
    print_separator()
    print("🗺️  LOCAL TRAVEL AGENT - Ranking Demo")
    print_separator()
    print(f"\nSearch center: Chennai ({CHENNAI_CENTER[0]}, {CHENNAI_CENTER[1]})")
    print(f"Total places in sample data: {len(SAMPLE_PLACES)}")
    
    # Demo scenarios
    scenarios = [
        {
            "name": "Vegetarian Food, Calm Vibe",
            "prefs": Preferences(
                category="food",
                vibe="calm",
                max_walk_mins=30,
                veg_only=True,
            ),
        },
        {
            "name": "Any Food, Lively Vibe, Short Walk",
            "prefs": Preferences(
                category="food",
                vibe="lively",
                max_walk_mins=15,
                veg_only=False,
            ),
        },
        {
            "name": "Scenic Places, Calm Vibe",
            "prefs": Preferences(
                category="scenic",
                vibe="calm",
                max_walk_mins=45,
                veg_only=False,
            ),
        },
        {
            "name": "Indoor Activities, Any Vibe",
            "prefs": Preferences(
                category="indoor",
                vibe="calm",
                max_walk_mins=30,
                veg_only=False,
            ),
        },
    ]
    
    for scenario in scenarios:
        print("\n")
        print_separator("-")
        print(f"📋 Scenario: {scenario['name']}")
        print_separator("-")
        
        prefs = scenario["prefs"]
        print(f"\nPreferences:")
        print(f"  Category: {prefs['category']}")
        print(f"  Vibe: {prefs['vibe']}")
        print(f"  Max walk time: {prefs['max_walk_mins']} min")
        print(f"  Veg only: {prefs['veg_only']}")
        
        # Run ranking
        results = rank_places(
            SAMPLE_PLACES,
            CHENNAI_CENTER[0],
            CHENNAI_CENTER[1],
            prefs
        )
        
        if not results:
            print("\n⚠️  No places found matching criteria.")
            print("   Try increasing walk time or changing filters.")
            continue
        
        print(f"\n🏆 Top {len(results)} Recommendations:\n")
        
        for i, ranked in enumerate(results, 1):
            place = ranked.place
            
            print(f"  #{i} {place.name}")
            print(f"     Score: {ranked.score}/100")
            print(f"     Distance: {ranked.distance_km} km (~{ranked.walk_mins} min walk)")
            
            # Score breakdown
            m = ranked.metrics
            print(f"     Score breakdown:")
            print(f"       - Distance: {m['distance_score']}/50")
            print(f"       - Category: {m['category_score']}/20")
            print(f"       - Vibe: {m['vibe_score']}/10")
            print(f"       - Veg: {m['veg_score']}/10")
            print(f"       - Completeness: {m['completeness_score']}/10")
            print(f"       - Open bonus: {m['open_bonus']}/5")
            
            print(f"     Why this place?")
            for reason in ranked.reasons:
                print(f"       ✓ {reason}")
            
            print()
    
    print_separator()
    print("✅ Demo complete!")
    print_separator()
    
    # Show how results would differ with a different center
    print("\n📍 Bonus: Effect of search location")
    print("-" * 40)
    
    # T. Nagar center (different from Chennai center)
    t_nagar_center = (13.0418, 80.2341)
    
    prefs = Preferences(
        category="food",
        vibe="calm",
        max_walk_mins=20,
        veg_only=True,
    )
    
    # Compare distances from two centers
    print("\nSaravana Bhavan distance comparison:")
    sb = SAMPLE_PLACES[0]  # Saravana Bhavan
    
    dist_chennai = haversine_km(CHENNAI_CENTER[0], CHENNAI_CENTER[1], sb.lat, sb.lon)
    dist_tnagar = haversine_km(t_nagar_center[0], t_nagar_center[1], sb.lat, sb.lon)
    
    print(f"  From Chennai center: {dist_chennai:.2f} km")
    print(f"  From T. Nagar: {dist_tnagar:.2f} km")
    print(f"  → Location changes can significantly affect rankings!")


if __name__ == "__main__":
    run_demo()
