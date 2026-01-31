#!/usr/bin/env python3
"""
Test script for Bayesian Ranking Engine.

Runs locally and prints top 10 venues with:
- Mean probability
- 10th and 90th percentile credible intervals
- Confidence scores

Usage:
    python test_bayes.py

Or with API server test:
    python test_bayes.py --api
"""

import sys
import json
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from bayes_ranker import (
    get_default_model,
    fit_model,
    predict_with_uncertainty,
    rank,
    rank_venues,
    prepare_features,
    create_proxy_labels,
    VIBE_CATEGORY_AFFINITY,
)


def create_sample_venues(n: int = 100) -> pd.DataFrame:
    """
    Create realistic sample venue data for testing.
    
    Includes a mix of:
    - High-quality popular places
    - Hidden gems (good rating, few reviews)
    - Average places
    - Poor places
    """
    np.random.seed(42)
    
    categories = ['restaurant', 'cafe', 'grocery', 'scenic', 'indoor']
    
    # Generate different quality tiers
    venues = []
    
    # Tier 1: High quality, popular (20%)
    for i in range(int(n * 0.2)):
        venues.append({
            'id': f'hq_{i}',
            'name': f'Premium Place {i}',
            'category': np.random.choice(categories[:2]),  # Mostly restaurants/cafes
            'distance_meters': np.random.uniform(100, 1500),
            'rating': np.random.uniform(8.5, 9.8),  # High rating
            'review_count': np.random.randint(200, 1000),  # Many reviews
            'openNow': np.random.choice([True, False], p=[0.7, 0.3]),
            'vegFriendly': np.random.choice([True, False], p=[0.4, 0.6]),
            'hasAddress': True,
            'hasPhone': True,
            'hasWebsite': np.random.choice([True, False], p=[0.8, 0.2]),
            'hasHours': True,
        })
    
    # Tier 2: Hidden gems (15%)
    for i in range(int(n * 0.15)):
        venues.append({
            'id': f'gem_{i}',
            'name': f'Hidden Gem {i}',
            'category': np.random.choice(categories),
            'distance_meters': np.random.uniform(500, 2500),
            'rating': np.random.uniform(8.0, 9.5),  # Good rating
            'review_count': np.random.randint(20, 80),  # Few reviews
            'openNow': np.random.choice([True, False]),
            'vegFriendly': np.random.choice([True, False], p=[0.3, 0.7]),
            'hasAddress': True,
            'hasPhone': np.random.choice([True, False]),
            'hasWebsite': np.random.choice([True, False], p=[0.4, 0.6]),
            'hasHours': np.random.choice([True, False]),
        })
    
    # Tier 3: Average places (45%)
    for i in range(int(n * 0.45)):
        venues.append({
            'id': f'avg_{i}',
            'name': f'Average Place {i}',
            'category': np.random.choice(categories),
            'distance_meters': np.random.uniform(300, 2800),
            'rating': np.random.uniform(6.0, 8.0),  # Average rating
            'review_count': np.random.randint(30, 200),
            'openNow': np.random.choice([True, False]),
            'vegFriendly': np.random.choice([True, False], p=[0.2, 0.8]),
            'hasAddress': True,
            'hasPhone': np.random.choice([True, False], p=[0.6, 0.4]),
            'hasWebsite': np.random.choice([True, False], p=[0.3, 0.7]),
            'hasHours': np.random.choice([True, False], p=[0.5, 0.5]),
        })
    
    # Tier 4: Below average (20%)
    for i in range(int(n * 0.2)):
        venues.append({
            'id': f'low_{i}',
            'name': f'Basic Place {i}',
            'category': np.random.choice(categories),
            'distance_meters': np.random.uniform(1000, 3000),
            'rating': np.random.uniform(4.0, 6.5),  # Low rating
            'review_count': np.random.randint(5, 50),
            'openNow': np.random.choice([True, False], p=[0.4, 0.6]),
            'vegFriendly': np.random.choice([True, False], p=[0.1, 0.9]),
            'hasAddress': np.random.choice([True, False]),
            'hasPhone': np.random.choice([True, False], p=[0.3, 0.7]),
            'hasWebsite': False,
            'hasHours': np.random.choice([True, False], p=[0.3, 0.7]),
        })
    
    return pd.DataFrame(venues)


def print_separator(char: str = "=", length: int = 80):
    """Print a separator line."""
    print(char * length)


def test_default_model():
    """Test ranking with the default (prior-based) model."""
    print("\n" + "=" * 80)
    print("TEST 1: Default Model (Prior-Based)")
    print("=" * 80)
    
    # Get default model
    model = get_default_model()
    print("\nModel Coefficients (Prior Means):")
    for name, coef in model.coefficients.items():
        print(f"  {name:15s}: {coef:+.3f}")
    
    # Create sample data
    df = create_sample_venues(50)
    print(f"\nSample venues created: {len(df)}")
    
    # Test different vibes
    for vibe in ['insta', 'work', 'romantic']:
        print(f"\n--- Vibe: {vibe} ---")
        
        ranked_df = rank_venues(model, df, vibe=vibe, strategy='mean')
        
        print(f"\nTop 10 venues (ranked by mean probability):")
        print("-" * 75)
        print(f"{'Rank':<5} {'Name':<20} {'Category':<12} {'P(like)':<10} {'CI (10-90)':<15} {'Conf':<6}")
        print("-" * 75)
        
        for _, row in ranked_df.head(10).iterrows():
            print(f"{int(row['rank']):<5} {row['name'][:20]:<20} {row['category']:<12} "
                  f"{row['probability']:.3f}      ({row['p10']:.2f}-{row['p90']:.2f})      "
                  f"{row['confidence']:.2f}")


def test_fitted_model():
    """Test model fitting and prediction."""
    print("\n" + "=" * 80)
    print("TEST 2: Fitted Model (Laplace Approximation)")
    print("=" * 80)
    
    # Create larger sample for fitting
    df = create_sample_venues(200)
    print(f"\nTraining venues: {len(df)}")
    
    # Show proxy label distribution
    labels = create_proxy_labels(df)
    print(f"Proxy labels: {labels.sum()} positive ({100*labels.mean():.1f}%)")
    
    # Fit model
    print("\nFitting model with Laplace approximation...")
    model = fit_model(df, vibe='insta', use_pymc=False)
    
    print("\nFitted Coefficients:")
    for name, coef in model.coefficients.items():
        print(f"  {name:15s}: {coef:+.3f}")
    
    # Create new test data
    test_df = create_sample_venues(30)
    
    # Rank with fitted model
    ranked_df = rank_venues(model, test_df, vibe='insta', strategy='mean')
    
    print(f"\nTop 10 test venues (with fitted model):")
    print("-" * 75)
    for _, row in ranked_df.head(10).iterrows():
        print(f"#{int(row['rank']):<3} {row['name'][:18]:<18} | "
              f"P={row['probability']:.3f} ({row['p10']:.2f}-{row['p90']:.2f}) | "
              f"Rating={row['rating']:.1f} Reviews={row['review_count']}")


def test_ranking_strategies():
    """Compare mean vs lower_bound ranking strategies."""
    print("\n" + "=" * 80)
    print("TEST 3: Ranking Strategies Comparison")
    print("=" * 80)
    
    model = get_default_model()
    df = create_sample_venues(50)
    
    # Rank by mean
    ranked_mean = rank_venues(model, df, vibe='insta', strategy='mean')
    
    # Rank by lower bound (risk-averse)
    ranked_lb = rank_venues(model, df, vibe='insta', strategy='lower_bound')
    
    print("\nComparison: Mean vs Lower Bound Ranking")
    print("-" * 70)
    print(f"{'Rank':<5} {'By Mean':<25} {'By Lower Bound (p10)':<25}")
    print("-" * 70)
    
    for i in range(10):
        mean_row = ranked_mean.iloc[i]
        lb_row = ranked_lb.iloc[i]
        
        mean_str = f"{mean_row['name'][:15]} (P={mean_row['probability']:.2f})"
        lb_str = f"{lb_row['name'][:15]} (p10={lb_row['p10']:.2f})"
        
        print(f"{i+1:<5} {mean_str:<25} {lb_str:<25}")
    
    print("\nNote: Lower bound ranking is more conservative/risk-averse")


def test_feature_engineering():
    """Test feature preparation."""
    print("\n" + "=" * 80)
    print("TEST 4: Feature Engineering")
    print("=" * 80)
    
    df = create_sample_venues(5)
    
    print("\nRaw venue data:")
    print(df[['name', 'distance_meters', 'rating', 'review_count', 'category']].to_string())
    
    features = prepare_features(df, vibe='work', user_wants_veg=True)
    
    print("\nPrepared features:")
    print(features.round(3).to_string())


def test_api_integration():
    """Test API integration (requires server to be running)."""
    print("\n" + "=" * 80)
    print("TEST 5: API Integration Test")
    print("=" * 80)
    
    try:
        import requests
    except ImportError:
        print("requests library not installed. Skipping API test.")
        return
    
    base_url = "http://localhost:8000"
    
    # Health check
    print("\nChecking API health...")
    try:
        resp = requests.get(f"{base_url}/health", timeout=5)
        if resp.status_code == 200:
            health = resp.json()
            print(f"  Status: {health['status']}")
            print(f"  Model loaded: {health['model_loaded']}")
            print(f"  PyMC available: {health['pymc_available']}")
        else:
            print(f"  Health check failed: {resp.status_code}")
            return
    except requests.exceptions.ConnectionError:
        print("  API server not running. Start with: uvicorn api_server:app --port 8000")
        return
    
    # Test ranking
    print("\nTesting /rank endpoint...")
    
    test_places = [
        {"id": "1", "name": "Great Cafe", "category": "cafe", 
         "distanceMeters": 500, "rating": 8.5, "ratingCount": 200, "openNow": True},
        {"id": "2", "name": "Average Restaurant", "category": "restaurant",
         "distanceMeters": 1000, "rating": 6.0, "ratingCount": 50, "openNow": False},
        {"id": "3", "name": "Hidden Gem", "category": "cafe",
         "distanceMeters": 800, "rating": 9.0, "ratingCount": 30, "openNow": True},
    ]
    
    request_data = {
        "places": test_places,
        "prefs": {"vibe": "work", "vegOnly": False},
        "strategy": "mean"
    }
    
    resp = requests.post(f"{base_url}/rank", json=request_data)
    
    if resp.status_code == 200:
        result = resp.json()
        print("\nRanked venues from API:")
        for v in result['ranked_places']:
            print(f"  #{v['rank']} {v['name']}: P={v['probability']:.3f} "
                  f"({v['p10']:.2f}-{v['p90']:.2f})")
        print(f"\nModel info: {result['model_info']}")
    else:
        print(f"  Ranking failed: {resp.status_code}")
        print(f"  Response: {resp.text}")


def main():
    """Run all tests."""
    parser = argparse.ArgumentParser(description="Test Bayesian Ranking Engine")
    parser.add_argument("--api", action="store_true", 
                       help="Include API integration test")
    args = parser.parse_args()
    
    print("=" * 80)
    print("BAYESIAN RANKING ENGINE - TEST SUITE")
    print("=" * 80)
    
    # Run tests
    test_default_model()
    test_fitted_model()
    test_ranking_strategies()
    test_feature_engineering()
    
    if args.api:
        test_api_integration()
    
    print("\n" + "=" * 80)
    print("ALL TESTS COMPLETED")
    print("=" * 80)
    print("\nTo run with API test: python test_bayes.py --api")
    print("(Requires: uvicorn api_server:app --port 8000)")


if __name__ == "__main__":
    main()
