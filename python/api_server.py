"""
FastAPI Server for Bayesian Ranking Engine.

Provides REST API endpoints for the Bayesian venue ranking system.
Run with: uvicorn api_server:app --port 8000

Endpoints:
- POST /rank: Rank venues with Bayesian model
- POST /fit: Re-fit model with new data
- GET /health: Health check
"""

import logging
from typing import Dict, List, Literal, Optional, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import pandas as pd
import numpy as np

from bayes_ranker import (
    ModelArtifacts,
    PredictionResult,
    get_default_model,
    fit_model,
    predict_with_uncertainty,
    rank,
    VIBE_CATEGORY_AFFINITY,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global model instance
_model: Optional[ModelArtifacts] = None


# =============================================================================
# PYDANTIC MODELS (Request/Response schemas)
# =============================================================================

class VenueInput(BaseModel):
    """Input schema for a single venue."""
    id: str
    name: str
    category: str = "restaurant"
    distance_meters: Optional[float] = Field(None, alias="distanceMeters")
    rating: Optional[float] = None
    review_count: Optional[int] = Field(None, alias="ratingCount")
    open_now: Optional[bool] = Field(None, alias="openNow")
    veg_friendly: Optional[bool] = Field(None, alias="vegFriendly")
    has_address: Optional[bool] = Field(None, alias="hasAddress")
    has_phone: Optional[bool] = Field(None, alias="hasPhone")
    has_website: Optional[bool] = Field(None, alias="hasWebsite")
    has_hours: Optional[bool] = Field(None, alias="hasHours")
    
    # Allow extra fields to pass through
    class Config:
        extra = "allow"
        populate_by_name = True


class PreferencesInput(BaseModel):
    """Input schema for user preferences."""
    vibe: Literal["insta", "work", "romantic", "budget", "lively"] = "insta"
    category: str = "restaurant"
    veg_only: bool = Field(False, alias="vegOnly")
    max_walk_minutes: int = Field(15, alias="maxWalkMinutes")
    
    class Config:
        populate_by_name = True


class RankRequest(BaseModel):
    """Request schema for ranking endpoint."""
    places: List[VenueInput]
    prefs: PreferencesInput = PreferencesInput()
    strategy: Literal["mean", "lower_bound"] = "mean"


class RankedVenue(BaseModel):
    """Output schema for a ranked venue."""
    id: str
    name: str
    category: str
    probability: float = Field(..., description="Posterior mean P(user likes venue)")
    p10: float = Field(..., description="10th percentile of probability")
    p90: float = Field(..., description="90th percentile of probability")
    confidence: float = Field(..., description="Confidence score (1 - interval width)")
    rank: int
    
    # Pass through original fields
    distance_meters: Optional[float] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    open_now: Optional[bool] = None
    veg_friendly: Optional[bool] = None
    
    class Config:
        extra = "allow"


class RankResponse(BaseModel):
    """Response schema for ranking endpoint."""
    ranked_places: List[RankedVenue]
    model_info: Dict[str, Any]
    debug: Dict[str, Any]


class FitRequest(BaseModel):
    """Request schema for model fitting endpoint."""
    places: List[VenueInput]
    labels: Optional[List[int]] = None  # If provided, use instead of proxy
    vibe: str = "insta"
    veg_only: bool = False


class FitResponse(BaseModel):
    """Response schema for model fitting endpoint."""
    success: bool
    coefficients: Dict[str, float]
    n_samples: int
    message: str


class HealthResponse(BaseModel):
    """Response schema for health check."""
    status: str
    model_loaded: bool
    model_n_samples: int
    pymc_available: bool


# =============================================================================
# FASTAPI APP
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize model on startup."""
    global _model
    logger.info("Loading default Bayesian model...")
    _model = get_default_model()
    logger.info(f"Model loaded with coefficients: {_model.coefficients}")
    yield
    logger.info("Shutting down...")


app = FastAPI(
    title="Bayesian Ranking API",
    description="Bayesian logistic regression for venue recommendations",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3003", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# ENDPOINTS
# =============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    from bayes_ranker import PYMC_AVAILABLE
    
    return HealthResponse(
        status="healthy",
        model_loaded=_model is not None,
        model_n_samples=_model.n_samples if _model else 0,
        pymc_available=PYMC_AVAILABLE
    )


@app.post("/rank", response_model=RankResponse)
async def rank_venues(request: RankRequest):
    """
    Rank venues using Bayesian model.
    
    Returns venues sorted by probability of user liking them,
    along with uncertainty estimates (credible intervals).
    """
    global _model
    
    if _model is None:
        _model = get_default_model()
    
    if not request.places:
        raise HTTPException(status_code=400, detail="No places provided")
    
    logger.info(f"Ranking {len(request.places)} venues with strategy={request.strategy}")
    
    # Convert to DataFrame
    places_data = []
    for p in request.places:
        row = {
            'id': p.id,
            'name': p.name,
            'category': p.category,
            'distance_meters': p.distance_meters or 1000,
            'rating': p.rating,
            'review_count': p.review_count or 0,
            'openNow': p.open_now,
            'vegFriendly': p.veg_friendly or False,
            'hasAddress': p.has_address or False,
            'hasPhone': p.has_phone or False,
            'hasWebsite': p.has_website or False,
            'hasHours': p.has_hours or False,
        }
        # Include any extra fields
        if hasattr(p, '__pydantic_extra__') and p.__pydantic_extra__:
            row.update(p.__pydantic_extra__)
        places_data.append(row)
    
    df = pd.DataFrame(places_data)
    
    # Get predictions with uncertainty
    predictions = predict_with_uncertainty(
        _model, df,
        vibe=request.prefs.vibe,
        user_wants_veg=request.prefs.veg_only
    )
    
    # Rank predictions
    ranked_predictions = rank(predictions, strategy=request.strategy)
    
    # Build response
    ranked_venues = []
    for i, pred in enumerate(ranked_predictions):
        # Find original venue data
        orig = next((p for p in request.places if p.id == pred.venue_id), None)
        
        ranked_venues.append(RankedVenue(
            id=pred.venue_id,
            name=orig.name if orig else f"Venue {pred.venue_id}",
            category=orig.category if orig else "unknown",
            probability=round(pred.probability, 4),
            p10=round(pred.p10, 4),
            p90=round(pred.p90, 4),
            confidence=round(pred.confidence, 4),
            rank=i + 1,
            distance_meters=orig.distance_meters if orig else None,
            rating=orig.rating if orig else None,
            review_count=orig.review_count if orig else None,
            open_now=orig.open_now if orig else None,
            veg_friendly=orig.veg_friendly if orig else None,
        ))
    
    # Model info
    model_info = {
        "n_training_samples": _model.n_samples,
        "coefficients": {k: round(v, 4) for k, v in _model.coefficients.items()},
        "strategy": request.strategy,
    }
    
    # Debug info
    debug = {
        "n_input": len(request.places),
        "n_output": len(ranked_venues),
        "vibe": request.prefs.vibe,
        "top_3_ids": [v.id for v in ranked_venues[:3]],
    }
    
    logger.info(f"Ranked {len(ranked_venues)} venues. Top: {debug['top_3_ids']}")
    
    return RankResponse(
        ranked_places=ranked_venues,
        model_info=model_info,
        debug=debug
    )


@app.post("/fit", response_model=FitResponse)
async def fit_model_endpoint(request: FitRequest):
    """
    Re-fit the Bayesian model with new data.
    
    If labels are provided, use them. Otherwise, generate proxy labels
    from rating/review_count.
    """
    global _model
    
    if not request.places:
        raise HTTPException(status_code=400, detail="No places provided")
    
    logger.info(f"Fitting model on {len(request.places)} venues...")
    
    # Convert to DataFrame
    places_data = []
    for p in request.places:
        places_data.append({
            'id': p.id,
            'name': p.name,
            'category': p.category,
            'distance_meters': p.distance_meters or 1000,
            'rating': p.rating,
            'review_count': p.review_count or 0,
            'openNow': p.open_now,
            'vegFriendly': p.veg_friendly or False,
            'hasAddress': p.has_address or False,
            'hasPhone': p.has_phone or False,
            'hasWebsite': p.has_website or False,
            'hasHours': p.has_hours or False,
        })
    
    df = pd.DataFrame(places_data)
    
    # Add labels if provided
    if request.labels:
        if len(request.labels) != len(df):
            raise HTTPException(
                status_code=400, 
                detail=f"Labels length ({len(request.labels)}) != places length ({len(df)})"
            )
        df['_label'] = request.labels
    
    try:
        # Fit model (uses Laplace approximation by default for speed)
        _model = fit_model(
            df, 
            vibe=request.vibe,
            user_wants_veg=request.veg_only,
            use_pymc=False  # Use Laplace for API calls (faster)
        )
        
        return FitResponse(
            success=True,
            coefficients={k: round(v, 4) for k, v in _model.coefficients.items()},
            n_samples=_model.n_samples,
            message=f"Model fitted on {_model.n_samples} samples"
        )
    except Exception as e:
        logger.error(f"Model fitting failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vibes")
async def list_vibes():
    """List available vibes and their category affinities."""
    return {
        "vibes": list(VIBE_CATEGORY_AFFINITY.keys()),
        "affinities": VIBE_CATEGORY_AFFINITY
    }


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
