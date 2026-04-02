# Keyword Scoring Design

Replace mock `get_keyword_scores` tool with real heuristic-based scoring ported from RespectASO.

## Scope

- Port RespectASO's DifficultyCalculator and PopularityEstimator to JavaScript
- iOS only (Android deferred)
- No download estimation (deferred)
- No changes to other tools

## Architecture

### Files

| File | Action | Purpose |
|------|--------|---------|
| `scoring.js` | Create | All scoring logic |
| `server.js` | Modify | Update `get_keyword_scores` tool |
| `package.json` | Modify | Remove `aso` dependency |

### scoring.js Exports

```js
export function calculateDifficulty(competitors, keyword)
// Returns: { score: 1-100, breakdown: {...}, overrideReason, isBrandKeyword, brandName, interpretation }

export function estimatePopularity(competitors, keyword)
// Returns: integer 5-100
```

### Internal Helpers (not exported)

- `tokenize(text)` — lowercase alphanumeric tokens with normalization
- `keywordTitleEvidence(keyword, title, genre)` — match hierarchy: exact > all words > partial
- `isBrandKeyword(keyword, leader, competitors)` — seller name + review disparity signals
- `logInterpolate(value, bands)` — log-scale band interpolation
- `linearInterpolate(value, bands)` — linear band interpolation
- `median(arr)` — standard median calculation

## Scoring Algorithm (from RespectASO)

### Difficulty (1-100)

7 weighted sub-scores, each normalized to 0-100:

| Component | Weight | Data Source | Interpolation |
|-----------|--------|-------------|---------------|
| Rating Volume | 30% | Median userRatingCount | Log bands: (50,5) (200,15) (500,30) (2K,50) (5K,65) (10K,78) (25K,88) (100K,95) |
| Review Velocity | 10% | Median reviews/year | Log bands: (10,5) (50,15) (200,30) (1K,50) (5K,70) (20K,85) (50K,95) |
| Dominant Players | 20% | log10(reviews)/log10(10M), top-half 2x weighted | Direct calculation |
| Rating Quality | 10% | log1p-weighted avg rating | Linear bands: (0,0) (3.0,20) (3.5,35) (4.0,50) (4.3,70) (4.5,85) (5.0,100) |
| Market Age | 10% | Avg years since release | Linear bands: (0.5,10) (1,20) (2,35) (3,50) (5,70) (8,85) (10,100) |
| Publisher Diversity | 10% | Unique sellers / total | Direct ratio * 100 |
| Title Relevance | 10% | Title keyword match count / total | Direct ratio * 100 |

**Dampening:**
- Small sample: `factor = min(1.0, n/10)` on publisher_diversity, title_relevance, dominant_players, rating_quality
- Backfill-aware: `relevance = max(0.3, min(1.0, relevance_ratio * 2.6))` on publisher_diversity, rating_quality, market_age

**Post-processing overrides (applied in order):**
1. Small Result Set Cap: n<=4 caps at {1:10, 2:20, 3:31, 4:40}
2. Weak Leader Cap: leader <1000 reviews (skip if brand keyword). Cap = `15 + 35 * log10(reviews+1) / log10(1001)`. Blend with match_ratio if >0.2.
3. Backfill Discount: match_ratio <0.2 AND leader <1000. `discount = max(0.6, ratio_factor + (1-ratio_factor) * leader_factor)`

**Interpretation:**
- <=15: Very Easy, <=35: Easy, <=55: Moderate, <=75: Hard, <=90: Very Hard, >90: Extreme

### Popularity (5-100)

6 signals summed:

| Signal | Points | Formula |
|--------|--------|---------|
| Result count | 0-25 | `min(25, n * 2.5)` |
| Leader strength | 0-30 | Max reviews in top-half, log bands: (10,1) (100,5) (1K,10) (10K,17) (100K,24) (1M,30) |
| Title match density | 0-20 | `min(20, match_ratio * 40)` |
| Market depth | 0-10 | Median reviews, log bands: (10,0.5) (100,3) (1K,5) (10K,8) (50K,10) |
| Specificity penalty | -0 to -28 | By word count: 1->0, 2->-3, 3->-8, 4->-15, 5->-22, 6->-28 (linear interp) |
| Exact phrase bonus | 0-15 | `min(15, exact_ratio * 50)` |

**Dampening:**
- Small sample: on title_score, exact_bonus
- Backfill-aware: on result_score, leader_score, depth_score

**Final:** `max(5, min(100, total))`

## Data Flow

```
get_keyword_scores("meditation", "ios", "us")
  1. memoizedAppStore.search({ term: "meditation", num: 10, country: "us" })
  2. Normalize results to: { trackName, userRatingCount, averageUserRating,
     releaseDate, sellerName, primaryGenreName }
  3. calculateDifficulty(competitors, "meditation") -> { score: 72, ... }
  4. estimatePopularity(competitors, "meditation") -> 58
  5. Return JSON
```

## Output Format

```json
{
  "keyword": "meditation",
  "platform": "ios",
  "country": "us",
  "difficulty": {
    "score": 72,
    "interpretation": "Hard",
    "breakdown": {
      "ratingVolume": 78.5,
      "reviewVelocity": 45.2,
      "dominantPlayers": 65.0,
      "ratingQuality": 85.0,
      "marketAge": 70.0,
      "publisherDiversity": 60.0,
      "titleRelevance": 40.0
    },
    "overrideReason": null,
    "isBrandKeyword": false,
    "brandName": null
  },
  "popularity": {
    "score": 58,
    "interpretation": "Moderate"
  },
  "competitors": {
    "total": 10,
    "medianReviews": 15000,
    "avgRating": 4.3
  }
}
```

## Deferred Work

- Android keyword scoring (requires recalibrated bands for minInstalls)
- Download estimation (popularity -> daily searches -> position TTR -> installs)
- Enhance `analyze_top_keywords` with scoring integration
