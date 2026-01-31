"""
Bayesian Ranking Engine for Travel Recommendations.

This module implements Bayesian logistic regression to estimate P(user_likes_venue)
with uncertainty quantification. It provides:
- Probabilistic predictions (not arbitrary scores)
- Credible intervals (10th and 90th percentiles)
- Confidence scores based on interval width
- Multiple ranking strategies (mean vs lower bound)

Model:
    y ~ Bernoulli(p)
    logit(p) = b0 + b1*distance + b2*rating + b3*log(1+reviews) 
             + b4*vibe_match + b5*is_veg + b6*is_open + b7*completeness

Author: Data Science Team
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple, Literal, Any
from dataclasses import dataclass, field
import logging
import pickle
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try importing PyMC, fall back to approximate inference if not available
try:
    import pymc as pm
    import arviz as az
    PYMC_AVAILABLE = True
    logger.info("PyMC loaded successfully - using full Bayesian inference")
except ImportError:
    PYMC_AVAILABLE = False
    logger.warning("PyMC not available - using Laplace approximation")

from scipy import optimize
from scipy.special import expit, logit
from scipy.stats import norm


# =============================================================================
# CONSTANTS & CONFIGURATION
# =============================================================================

# Feature normalization constants
MAX_DISTANCE_M = 3000  # 3km cap for distance normalization
MAX_RATING = 10.0      # Foursquare rating scale
LOG_REVIEW_SCALE = np.log(1000)  # Scale factor for log(reviews)

# Vibe-to-category affinity scores (from existing TypeScript implementation)
VIBE_CATEGORY_AFFINITY: Dict[str, Dict[str, float]] = {
    "insta": {"cafe": 0.95, "restaurant": 0.8, "scenic": 0.9, "indoor": 0.7, "grocery": 0.3},
    "work": {"cafe": 0.95, "restaurant": 0.5, "indoor": 0.7, "scenic": 0.3, "grocery": 0.2},
    "romantic": {"restaurant": 0.95, "scenic": 0.85, "cafe": 0.7, "indoor": 0.6, "grocery": 0.1},
    "budget": {"grocery": 0.9, "cafe": 0.7, "restaurant": 0.6, "indoor": 0.5, "scenic": 0.8},
    "lively": {"restaurant": 0.85, "cafe": 0.6, "indoor": 0.8, "scenic": 0.5, "grocery": 0.2},
}

# Informative priors (mean, std) - reflecting domain knowledge
PRIOR_CONFIG = {
    "intercept": (0.0, 2.0),      # Weak prior
    "distance": (-1.5, 0.5),      # Strong negative effect
    "rating": (1.0, 0.5),         # Positive effect
    "log_reviews": (0.5, 0.3),    # Moderate positive
    "vibe_match": (1.2, 0.5),     # Strong positive
    "is_veg": (0.5, 0.5),         # Moderate positive (when user wants veg)
    "is_open": (0.3, 0.3),        # Weak positive
    "completeness": (0.3, 0.3),   # Weak positive
}

# Proxy label thresholds (until real feedback is available)
PROXY_RATING_THRESHOLD = 4.2  # Out of 10 for FSQ
PROXY_REVIEW_THRESHOLD = 100


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class ModelArtifacts:
    """Container for trained model artifacts."""
    coefficients: Dict[str, float]  # Posterior means
    covariance: np.ndarray          # Posterior covariance matrix
    feature_names: List[str]
    n_samples: int
    trace: Optional[Any] = None     # PyMC trace if available
    
    def save(self, path: str) -> None:
        """Save model artifacts to disk."""
        with open(path, 'wb') as f:
            pickle.dump({
                'coefficients': self.coefficients,
                'covariance': self.covariance,
                'feature_names': self.feature_names,
                'n_samples': self.n_samples,
            }, f)
    
    @classmethod
    def load(cls, path: str) -> 'ModelArtifacts':
        """Load model artifacts from disk."""
        with open(path, 'rb') as f:
            data = pickle.load(f)
        return cls(**data)


@dataclass
class PredictionResult:
    """Result for a single venue prediction."""
    venue_id: str
    probability: float      # Posterior mean P(like)
    p10: float             # 10th percentile
    p90: float             # 90th percentile
    confidence: float      # 1 - (p90 - p10)
    features: Dict[str, float] = field(default_factory=dict)


# =============================================================================
# FEATURE ENGINEERING
# =============================================================================

def prepare_features(df: pd.DataFrame, vibe: str = "insta", 
                     user_wants_veg: bool = False) -> pd.DataFrame:
    """
    Transform raw venue data into model features.
    
    Args:
        df: DataFrame with raw venue data
        vibe: User's selected vibe preference
        user_wants_veg: Whether user wants vegetarian options
        
    Returns:
        DataFrame with normalized features ready for model
    """
    features = pd.DataFrame(index=df.index)
    
    # 1. Distance (normalized, capped at 1)
    if 'distance_meters' in df.columns:
        features['distance_norm'] = np.clip(df['distance_meters'] / MAX_DISTANCE_M, 0, 1)
    elif 'distanceMeters' in df.columns:
        features['distance_norm'] = np.clip(df['distanceMeters'] / MAX_DISTANCE_M, 0, 1)
    else:
        features['distance_norm'] = 0.5  # Default if missing
    
    # 2. Rating (normalized to 0-1)
    if 'rating' in df.columns:
        features['rating_norm'] = df['rating'].fillna(5.0) / MAX_RATING
    else:
        features['rating_norm'] = 0.5
    
    # 3. Log reviews (normalized)
    if 'review_count' in df.columns:
        features['log_reviews'] = np.log1p(df['review_count'].fillna(0)) / LOG_REVIEW_SCALE
    elif 'ratingCount' in df.columns:
        features['log_reviews'] = np.log1p(df['ratingCount'].fillna(0)) / LOG_REVIEW_SCALE
    else:
        features['log_reviews'] = 0.0
    
    # 4. Vibe match (using affinity scores)
    if 'category' in df.columns:
        vibe_affinities = VIBE_CATEGORY_AFFINITY.get(vibe, {})
        features['vibe_match'] = df['category'].map(
            lambda c: vibe_affinities.get(c, 0.5)
        )
    else:
        features['vibe_match'] = 0.5
    
    # 5. Vegetarian friendly (binary, weighted by user preference)
    if 'is_veg' in df.columns:
        features['is_veg'] = df['is_veg'].astype(float)
    elif 'vegFriendly' in df.columns:
        features['is_veg'] = df['vegFriendly'].astype(float)
    else:
        features['is_veg'] = 0.0
    
    # Weight veg feature by user preference
    if not user_wants_veg:
        features['is_veg'] = features['is_veg'] * 0.3  # Reduce importance
    
    # 6. Open status (binary)
    if 'is_open' in df.columns:
        features['is_open'] = df['is_open'].fillna(False).astype(float)
    elif 'openNow' in df.columns:
        features['is_open'] = df['openNow'].fillna(False).astype(float)
    else:
        features['is_open'] = 0.5  # Unknown
    
    # 7. Completeness score (0-1)
    completeness_cols = ['hasAddress', 'hasPhone', 'hasWebsite', 'hasHours']
    available_cols = [c for c in completeness_cols if c in df.columns]
    if available_cols:
        features['completeness'] = df[available_cols].fillna(False).astype(float).mean(axis=1)
    else:
        features['completeness'] = 0.5
    
    # Add intercept
    features['intercept'] = 1.0
    
    return features


def create_proxy_labels(df: pd.DataFrame) -> pd.Series:
    """
    Create proxy labels for training when real feedback is unavailable.
    
    A venue is considered "liked" (y=1) if:
    - rating >= 4.2 (out of 10) AND
    - review_count >= 100
    
    Args:
        df: DataFrame with rating and review_count columns
        
    Returns:
        Series of binary labels (0 or 1)
    """
    rating_col = 'rating' if 'rating' in df.columns else None
    review_col = 'review_count' if 'review_count' in df.columns else 'ratingCount'
    
    if rating_col is None:
        logger.warning("No rating column found, using random labels")
        return pd.Series(np.random.binomial(1, 0.3, len(df)), index=df.index)
    
    rating_ok = df[rating_col].fillna(0) >= PROXY_RATING_THRESHOLD
    reviews_ok = df[review_col].fillna(0) >= PROXY_REVIEW_THRESHOLD
    
    labels = (rating_ok & reviews_ok).astype(int)
    
    logger.info(f"Proxy labels: {labels.sum()} positive out of {len(labels)} "
                f"({100*labels.mean():.1f}%)")
    
    return labels


# =============================================================================
# MODEL FITTING
# =============================================================================

def _fit_with_pymc(X: np.ndarray, y: np.ndarray, 
                   feature_names: List[str]) -> ModelArtifacts:
    """
    Fit Bayesian logistic regression using PyMC.
    
    Uses MCMC sampling for full posterior inference.
    """
    with pm.Model() as model:
        # Priors for coefficients
        betas = []
        for i, name in enumerate(feature_names):
            prior_mean, prior_std = PRIOR_CONFIG.get(name, (0.0, 1.0))
            beta = pm.Normal(f"beta_{name}", mu=prior_mean, sigma=prior_std)
            betas.append(beta)
        
        # Linear predictor
        eta = sum(betas[i] * X[:, i] for i in range(len(betas)))
        
        # Likelihood
        p = pm.math.sigmoid(eta)
        pm.Bernoulli("y", p=p, observed=y)
        
        # Sample from posterior
        trace = pm.sample(1000, tune=500, cores=1, random_seed=42,
                         progressbar=True, return_inferencedata=True)
    
    # Extract posterior statistics
    coefficients = {}
    for i, name in enumerate(feature_names):
        coefficients[name] = float(trace.posterior[f"beta_{name}"].mean())
    
    # Estimate covariance from posterior samples
    samples = np.column_stack([
        trace.posterior[f"beta_{name}"].values.flatten()
        for name in feature_names
    ])
    covariance = np.cov(samples.T)
    
    return ModelArtifacts(
        coefficients=coefficients,
        covariance=covariance,
        feature_names=feature_names,
        n_samples=len(y),
        trace=trace
    )


def _fit_with_laplace(X: np.ndarray, y: np.ndarray,
                      feature_names: List[str]) -> ModelArtifacts:
    """
    Fit Bayesian logistic regression using Laplace approximation.
    
    This is a faster alternative when PyMC is not available.
    Uses MAP estimation + Hessian for posterior approximation.
    """
    n_features = X.shape[1]
    
    # Prior means and precisions
    prior_means = np.array([PRIOR_CONFIG.get(name, (0.0, 1.0))[0] 
                           for name in feature_names])
    prior_stds = np.array([PRIOR_CONFIG.get(name, (0.0, 1.0))[1] 
                          for name in feature_names])
    prior_precisions = 1 / (prior_stds ** 2)
    
    def neg_log_posterior(beta):
        """Negative log posterior (for minimization)."""
        # Log likelihood
        eta = X @ beta
        ll = np.sum(y * eta - np.logaddexp(0, eta))
        
        # Log prior (Gaussian)
        lp = -0.5 * np.sum(prior_precisions * (beta - prior_means) ** 2)
        
        return -(ll + lp)
    
    def gradient(beta):
        """Gradient of negative log posterior."""
        eta = X @ beta
        p = expit(eta)
        
        # Likelihood gradient
        grad_ll = X.T @ (y - p)
        
        # Prior gradient
        grad_lp = -prior_precisions * (beta - prior_means)
        
        return -(grad_ll + grad_lp)
    
    def hessian(beta):
        """Hessian of negative log posterior."""
        eta = X @ beta
        p = expit(eta)
        W = np.diag(p * (1 - p))
        
        # Likelihood Hessian
        H_ll = -X.T @ W @ X
        
        # Prior Hessian
        H_lp = -np.diag(prior_precisions)
        
        return -(H_ll + H_lp)
    
    # Find MAP estimate
    result = optimize.minimize(
        neg_log_posterior,
        x0=prior_means,
        method='BFGS',
        jac=gradient,
        options={'maxiter': 1000}
    )
    
    if not result.success:
        logger.warning(f"Optimization did not converge: {result.message}")
    
    beta_map = result.x
    
    # Laplace approximation: posterior covariance = inverse Hessian at MAP
    H = hessian(beta_map)
    try:
        covariance = np.linalg.inv(H)
    except np.linalg.LinAlgError:
        logger.warning("Singular Hessian, using regularized inverse")
        covariance = np.linalg.inv(H + 0.01 * np.eye(n_features))
    
    # Ensure positive definite
    covariance = (covariance + covariance.T) / 2
    min_eig = np.min(np.linalg.eigvalsh(covariance))
    if min_eig < 0:
        covariance += (-min_eig + 0.01) * np.eye(n_features)
    
    coefficients = {name: float(beta_map[i]) 
                   for i, name in enumerate(feature_names)}
    
    return ModelArtifacts(
        coefficients=coefficients,
        covariance=covariance,
        feature_names=feature_names,
        n_samples=len(y)
    )


def fit_model(df: pd.DataFrame, vibe: str = "insta",
              user_wants_veg: bool = False,
              use_pymc: bool = True) -> ModelArtifacts:
    """
    Fit Bayesian logistic regression model.
    
    Args:
        df: DataFrame with venue data
        vibe: User's vibe preference for feature engineering
        user_wants_veg: Whether user wants vegetarian options
        use_pymc: Whether to use PyMC (True) or Laplace approximation (False)
        
    Returns:
        ModelArtifacts containing posterior estimates
    """
    logger.info(f"Fitting model on {len(df)} venues...")
    
    # Prepare features
    features = prepare_features(df, vibe=vibe, user_wants_veg=user_wants_veg)
    
    # Create proxy labels
    y = create_proxy_labels(df)
    
    # Feature matrix (order matters for coefficient interpretation)
    feature_names = ['intercept', 'distance_norm', 'rating_norm', 'log_reviews',
                     'vibe_match', 'is_veg', 'is_open', 'completeness']
    
    # Ensure all features exist
    for name in feature_names:
        if name not in features.columns:
            features[name] = 0.0
    
    X = features[feature_names].values
    y_arr = y.values
    
    # Fit model
    if use_pymc and PYMC_AVAILABLE:
        artifacts = _fit_with_pymc(X, y_arr, feature_names)
    else:
        artifacts = _fit_with_laplace(X, y_arr, feature_names)
    
    logger.info(f"Model fitted. Coefficients: {artifacts.coefficients}")
    
    return artifacts


# =============================================================================
# PREDICTION
# =============================================================================

def predict_with_uncertainty(model: ModelArtifacts, df: pd.DataFrame,
                             vibe: str = "insta",
                             user_wants_veg: bool = False,
                             n_samples: int = 1000) -> List[PredictionResult]:
    """
    Generate predictions with uncertainty estimates.
    
    Uses Monte Carlo sampling from the posterior to estimate
    prediction distribution for each venue.
    
    Args:
        model: Fitted model artifacts
        df: DataFrame with venue data
        vibe: User's vibe preference
        user_wants_veg: Whether user wants veg
        n_samples: Number of posterior samples for uncertainty estimation
        
    Returns:
        List of PredictionResult objects
    """
    # Prepare features
    features = prepare_features(df, vibe=vibe, user_wants_veg=user_wants_veg)
    
    # Ensure feature order matches model
    for name in model.feature_names:
        if name not in features.columns:
            features[name] = 0.0
    
    X = features[model.feature_names].values
    
    # Get posterior mean and covariance
    beta_mean = np.array([model.coefficients[name] for name in model.feature_names])
    
    # Sample from posterior (multivariate normal approximation)
    try:
        beta_samples = np.random.multivariate_normal(
            beta_mean, model.covariance, size=n_samples
        )
    except np.linalg.LinAlgError:
        # Fallback to diagonal covariance
        stds = np.sqrt(np.diag(model.covariance))
        beta_samples = np.random.normal(
            beta_mean, stds, size=(n_samples, len(beta_mean))
        )
    
    # Compute probability samples for each venue
    results = []
    
    for idx in range(len(df)):
        x_i = X[idx]
        
        # Linear predictor samples
        eta_samples = beta_samples @ x_i
        
        # Probability samples
        p_samples = expit(eta_samples)
        
        # Summary statistics
        p_mean = float(np.mean(p_samples))
        p_10 = float(np.percentile(p_samples, 10))
        p_90 = float(np.percentile(p_samples, 90))
        
        # Confidence: inverse of interval width
        confidence = float(1.0 - (p_90 - p_10))
        
        # Get venue ID
        if 'id' in df.columns:
            venue_id = str(df.iloc[idx]['id'])
        elif 'fsq_id' in df.columns:
            venue_id = str(df.iloc[idx]['fsq_id'])
        else:
            venue_id = str(idx)
        
        # Feature values for debugging
        feature_dict = {name: float(X[idx, i]) 
                       for i, name in enumerate(model.feature_names)}
        
        results.append(PredictionResult(
            venue_id=venue_id,
            probability=p_mean,
            p10=p_10,
            p90=p_90,
            confidence=confidence,
            features=feature_dict
        ))
    
    return results


def compute_confidence(p10: float, p90: float) -> float:
    """
    Compute confidence score from credible interval.
    
    Confidence = 1 - interval_width
    Higher confidence means narrower interval (more certain prediction).
    """
    return 1.0 - (p90 - p10)


# =============================================================================
# RANKING
# =============================================================================

def rank(predictions: List[PredictionResult],
         strategy: Literal["mean", "lower_bound"] = "mean") -> List[PredictionResult]:
    """
    Rank predictions using specified strategy.
    
    Args:
        predictions: List of prediction results
        strategy: Ranking strategy
            - "mean": Rank by posterior mean probability (default)
            - "lower_bound": Rank by 10th percentile (risk-averse)
            
    Returns:
        Sorted list of predictions (highest first)
    """
    if strategy == "mean":
        key_func = lambda p: p.probability
    elif strategy == "lower_bound":
        key_func = lambda p: p.p10
    else:
        raise ValueError(f"Unknown strategy: {strategy}")
    
    return sorted(predictions, key=key_func, reverse=True)


def rank_venues(model: ModelArtifacts, df: pd.DataFrame,
                vibe: str = "insta", user_wants_veg: bool = False,
                strategy: Literal["mean", "lower_bound"] = "mean") -> pd.DataFrame:
    """
    Full ranking pipeline: predict + rank + return DataFrame.
    
    Args:
        model: Fitted model artifacts
        df: DataFrame with venue data
        vibe: User's vibe preference
        user_wants_veg: Whether user wants veg
        strategy: Ranking strategy
        
    Returns:
        DataFrame with original data plus prediction columns, sorted by rank
    """
    # Get predictions
    predictions = predict_with_uncertainty(model, df, vibe=vibe, 
                                          user_wants_veg=user_wants_veg)
    
    # Rank
    ranked = rank(predictions, strategy=strategy)
    
    # Build result DataFrame
    result_rows = []
    for i, pred in enumerate(ranked):
        # Find original row
        if 'id' in df.columns:
            orig_row = df[df['id'] == pred.venue_id].iloc[0].to_dict()
        elif 'fsq_id' in df.columns:
            orig_row = df[df['fsq_id'] == pred.venue_id].iloc[0].to_dict()
        else:
            orig_row = df.iloc[int(pred.venue_id)].to_dict()
        
        # Add prediction columns
        orig_row['probability'] = pred.probability
        orig_row['p10'] = pred.p10
        orig_row['p90'] = pred.p90
        orig_row['confidence'] = pred.confidence
        orig_row['rank'] = i + 1
        
        result_rows.append(orig_row)
    
    return pd.DataFrame(result_rows)


# =============================================================================
# DEFAULT MODEL (PRE-FITTED ON SAMPLE DATA)
# =============================================================================

def get_default_model() -> ModelArtifacts:
    """
    Return a default model with prior-based coefficients.
    
    Used when no training data is available. Coefficients are set
    to prior means, covariance is set to prior variances.
    """
    feature_names = ['intercept', 'distance_norm', 'rating_norm', 'log_reviews',
                     'vibe_match', 'is_veg', 'is_open', 'completeness']
    
    # Use prior means as coefficients
    coefficients = {
        'intercept': PRIOR_CONFIG['intercept'][0],
        'distance_norm': PRIOR_CONFIG['distance'][0],
        'rating_norm': PRIOR_CONFIG['rating'][0],
        'log_reviews': PRIOR_CONFIG['log_reviews'][0],
        'vibe_match': PRIOR_CONFIG['vibe_match'][0],
        'is_veg': PRIOR_CONFIG['is_veg'][0],
        'is_open': PRIOR_CONFIG['is_open'][0],
        'completeness': PRIOR_CONFIG['completeness'][0],
    }
    
    # Use prior variances for covariance (diagonal)
    variances = [
        PRIOR_CONFIG['intercept'][1] ** 2,
        PRIOR_CONFIG['distance'][1] ** 2,
        PRIOR_CONFIG['rating'][1] ** 2,
        PRIOR_CONFIG['log_reviews'][1] ** 2,
        PRIOR_CONFIG['vibe_match'][1] ** 2,
        PRIOR_CONFIG['is_veg'][1] ** 2,
        PRIOR_CONFIG['is_open'][1] ** 2,
        PRIOR_CONFIG['completeness'][1] ** 2,
    ]
    covariance = np.diag(variances)
    
    return ModelArtifacts(
        coefficients=coefficients,
        covariance=covariance,
        feature_names=feature_names,
        n_samples=0  # No training data
    )


# =============================================================================
# MAIN (for testing)
# =============================================================================

if __name__ == "__main__":
    # Quick test with synthetic data
    print("Testing Bayesian Ranker...")
    
    # Create sample data
    np.random.seed(42)
    n = 50
    
    sample_data = pd.DataFrame({
        'id': [f'venue_{i}' for i in range(n)],
        'name': [f'Restaurant {i}' for i in range(n)],
        'category': np.random.choice(['restaurant', 'cafe', 'grocery'], n),
        'distance_meters': np.random.uniform(100, 3000, n),
        'rating': np.random.uniform(3, 5, n) * 2,  # Scale to 0-10
        'review_count': np.random.exponential(100, n).astype(int),
        'openNow': np.random.choice([True, False], n),
        'vegFriendly': np.random.choice([True, False], n, p=[0.3, 0.7]),
        'hasAddress': np.random.choice([True, False], n, p=[0.9, 0.1]),
        'hasPhone': np.random.choice([True, False], n, p=[0.7, 0.3]),
        'hasWebsite': np.random.choice([True, False], n, p=[0.5, 0.5]),
        'hasHours': np.random.choice([True, False], n, p=[0.6, 0.4]),
    })
    
    # Use default model (prior-based)
    model = get_default_model()
    print(f"\nDefault model coefficients: {model.coefficients}")
    
    # Rank venues
    ranked_df = rank_venues(model, sample_data, vibe='insta', strategy='mean')
    
    print("\nTop 10 venues (ranked by mean probability):")
    print("-" * 80)
    for _, row in ranked_df.head(10).iterrows():
        print(f"#{int(row['rank']):2d} | {row['name']:15s} | "
              f"P={row['probability']:.2f} ({row['p10']:.2f}-{row['p90']:.2f}) | "
              f"Conf={row['confidence']:.2f}")
    
    # Test lower bound ranking
    ranked_lb = rank_venues(model, sample_data, vibe='insta', strategy='lower_bound')
    print("\nTop 5 venues (ranked by lower bound - risk averse):")
    for _, row in ranked_lb.head(5).iterrows():
        print(f"#{int(row['rank']):2d} | {row['name']:15s} | "
              f"P={row['probability']:.2f} (p10={row['p10']:.2f})")
    
    print("\nTest complete!")
