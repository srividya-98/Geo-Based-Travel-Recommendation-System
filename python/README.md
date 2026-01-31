# Python Ranking Logic

This folder contains a **standalone Python implementation** of the decision-making and ranking logic used in the Local Travel Agent web application, including a **Bayesian ranking engine** for probabilistic venue recommendations.

## Purpose

This Python code exists for:

1. **Prototyping** - Rapidly iterate on ranking algorithms before implementing in TypeScript
2. **Validation** - Verify that the production TypeScript implementation matches expected behavior
3. **Experimentation** - Test new scoring formulas, weights, and features
4. **Documentation** - Serve as a clear, readable reference for the ranking algorithm
5. **Data Science Credibility** - Demonstrate analytical thinking separate from UI code
6. **Bayesian Inference** - Provide probabilistic rankings with uncertainty estimates

> **Note**: The basic ranking code runs standalone. To use the Bayesian API service, install dependencies from `requirements.txt`.

## Files

| File | Description |
|------|-------------|
| `ranking_logic.py` | Core deterministic ranking algorithm with scoring functions |
| `bayes_ranker.py` | **Bayesian logistic regression** for probabilistic ranking |
| `api_server.py` | FastAPI service exposing Bayesian ranking endpoints |
| `test_bayes.py` | Test script for Bayesian ranking engine |
| `sample_data.py` | Sample place data for testing (Chennai locations) |
| `run_demo.py` | Interactive demo showing rankings for different preferences |
| `requirements.txt` | Python dependencies for Bayesian ranking |

## Quick Start

### Basic Demo (No Dependencies)

```bash
cd python

# Run the basic demo
python run_demo.py

# Or run individual modules
python ranking_logic.py  # Quick self-test
python sample_data.py    # List sample data
```

### Bayesian Ranking (Requires Dependencies)

```bash
cd python

# Install dependencies
pip install -r requirements.txt

# Run Bayesian test script
python test_bayes.py

# Start API server
uvicorn api_server:app --port 8000

# Test API (in another terminal)
python test_bayes.py --api
```

## Scoring Formula

The ranking algorithm scores each place on a 0-100 scale:

| Component | Points | Description |
|-----------|--------|-------------|
| Distance Score | 0-50 | Closer = higher (0km=50pts, 3km+=0pts) |
| Category Match | 0-20 | Always 20 (pre-filtered by category) |
| Vibe Bonus | 0-10 | Matches calm/lively preference |
| Veg Bonus | 0-10 | Veg-friendly signals in tags/name |
| Completeness | 0-10 | Has hours (4), website (3), phone (3) |
| Open Bonus | 0-5 | Open 24/7 |

### Distance Score Formula

```python
distance_score = max(0, 50 - (distance_km / 3) * 50)
```

- 0 km → 50 points
- 1.5 km → 25 points  
- 3+ km → 0 points

## How It Mirrors TypeScript

The Python implementation mirrors the TypeScript code in:

```
app/api/places/route.ts  →  python/ranking_logic.py
```

Key functions that match:

| TypeScript | Python |
|------------|--------|
| `calculateDistance()` | `haversine_km()` |
| `getOpenStatus()` | `get_open_status()` |
| `isVegFriendly()` | `is_veg_friendly()` |
| `getVibeMatch()` | `get_vibe_match()` |
| `scorePlace()` | `score_place()` |

Both implementations use the same:
- Haversine formula for distance
- Walking speed of 4.5 km/h
- Vibe keywords per category
- Veg-friendly detection patterns
- Scoring weights and caps

## Example Output

```
🏆 Top 2 Recommendations:

  #1 Saravana Bhavan
     Score: 82/100
     Distance: 2.89 km (~39 min walk)
     Score breakdown:
       - Distance: 1.8/50
       - Category: 20/20
       - Vibe: 0/10
       - Veg: 10/10
       - Completeness: 10/10
       - Open bonus: 0/5
     Why this place?
       ✓ Close by: 2.9 km (~39 min walk)
       ✓ Veg-friendly
       ✓ Has: hours, website, phone
```

## Extending

To experiment with new features:

1. Modify `score_place()` in `ranking_logic.py`
2. Add new scoring components
3. Run `python run_demo.py` to see effects
4. Once validated, port changes to TypeScript

Example: Adding a "popularity bonus" based on review count:

```python
# In score_place()
review_count = tags.get("review_count", 0)
popularity_bonus = min(10, review_count / 100)  # Max 10 pts
```

---

## Bayesian Ranking Engine

The `bayes_ranker.py` module implements **Bayesian logistic regression** to estimate the probability that a user will like a venue, with full uncertainty quantification.

### Why Bayesian?

Traditional ranking systems return arbitrary scores (e.g., 78/100). Bayesian ranking provides:

1. **Probabilistic Output** - P(user likes venue) between 0 and 1
2. **Uncertainty Estimates** - Credible intervals (10th-90th percentile)
3. **Confidence Scores** - How certain the model is about each prediction
4. **Risk-Aware Ranking** - Option to rank by lower bound (conservative)
5. **Interpretable Priors** - Domain knowledge encoded in model

### Model Specification

```
y ~ Bernoulli(p)
logit(p) = b0 + b1*distance + b2*rating + b3*log(1+reviews) 
         + b4*vibe_match + b5*is_veg + b6*is_open + b7*completeness
```

### Informative Priors

Priors encode domain knowledge about feature importance:

| Coefficient | Prior | Interpretation |
|-------------|-------|----------------|
| b0 (intercept) | Normal(0, 2) | Weak prior - let data decide |
| b1 (distance) | Normal(-1.5, 0.5) | **Negative effect** - closer is better |
| b2 (rating) | Normal(1.0, 0.5) | **Positive effect** - higher rating is better |
| b3 (log_reviews) | Normal(0.5, 0.3) | Moderate positive - more reviews = more reliable |
| b4 (vibe_match) | Normal(1.2, 0.5) | **Strong positive** - vibe fit matters |
| b5 (is_veg) | Normal(0.5, 0.5) | Moderate positive - when user wants veg |
| b6 (is_open) | Normal(0.3, 0.3) | Weak positive - open is better |
| b7 (completeness) | Normal(0.3, 0.3) | Weak positive - complete data is trustworthy |

### Feature Engineering

| Feature | Source | Transform |
|---------|--------|-----------|
| distance_norm | distanceMeters | `min(d/3000, 1)` - cap at 3km |
| rating_norm | rating | `rating/10` - FSQ is 0-10 scale |
| log_reviews | ratingCount | `log(1+count)/log(1000)` - log transform |
| vibe_match | categories | Use vibe-category affinity table |
| is_veg | categories/name | Binary flag |
| is_open | openNow | Binary flag |
| completeness | has* fields | Average of 4 completeness flags |

### Proxy Labels (Until Real Feedback)

Since we don't have real user feedback yet, we create proxy labels:

```python
y = 1 if (rating >= 4.2) AND (review_count >= 100) else 0
```

**Future migration path:**
1. Add user feedback collection (clicks, saves, likes)
2. Store in database with venue_id + user_id + action
3. Replace proxy labels with real feedback
4. Re-fit model periodically (daily/weekly)

### Ranking Strategies

**Mean Ranking (default):** Sort by posterior mean probability
- Best for: Most users, exploratory discovery

**Lower Bound Ranking:** Sort by 10th percentile (p10)
- Best for: Risk-averse users, important decisions
- Penalizes venues with high uncertainty

### API Endpoints

```bash
# Start server
uvicorn api_server:app --port 8000

# Health check
GET http://localhost:8000/health

# Rank venues
POST http://localhost:8000/rank
{
  "places": [...],
  "prefs": {"vibe": "insta", "category": "cafe", "vegOnly": false},
  "strategy": "mean"
}

# Re-fit model (future)
POST http://localhost:8000/fit
```

### Example Output

```
Top 10 venues (ranked by mean probability):
-------------------------------------------------------------------------------
Rank  Name                 Category     P(like)    CI (10-90)      Conf
-------------------------------------------------------------------------------
1     Premium Place 5      restaurant   0.742      (0.58-0.87)     0.71
2     Premium Place 12     cafe         0.728      (0.61-0.83)     0.78
3     Hidden Gem 3         cafe         0.695      (0.42-0.89)     0.53
4     Premium Place 8      restaurant   0.683      (0.55-0.80)     0.75
5     Average Place 21     cafe         0.612      (0.44-0.77)     0.67
```

### Integration with Next.js

To enable Bayesian ranking in the web app:

1. Start the Python API server:
   ```bash
   cd python && uvicorn api_server:app --port 8000
   ```

2. Set environment variable:
   ```bash
   USE_BAYESIAN_RANKING=true
   BAYESIAN_API_URL=http://localhost:8000
   ```

3. The API will automatically use Bayesian ranking when available, falling back to deterministic scoring if the service is unavailable.

### Inference Methods

The module supports two inference methods:

1. **PyMC (MCMC)** - Full Bayesian inference, more accurate, slower
   - Used when PyMC is installed and `use_pymc=True`
   
2. **Laplace Approximation** - Faster, approximate
   - Uses MAP estimation + Hessian for posterior
   - Default for API calls (faster response time)

```python
# Full Bayesian (if PyMC available)
model = fit_model(df, use_pymc=True)

# Fast approximation (always available)
model = fit_model(df, use_pymc=False)
```
