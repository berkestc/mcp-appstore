/**
 * Keyword Scoring Module
 *
 * Ported from RespectASO (https://github.com/respectlytics/respectaso)
 * Calculates keyword difficulty (1-100) and popularity (5-100) scores
 * using heuristic analysis of App Store search results.
 *
 * iOS only. Uses userRatingCount as the primary signal.
 */

// --------------------------------------------------------------------------- //
// Constants
// --------------------------------------------------------------------------- //

const FINANCE_INTENT_TOKENS = new Set([
  'option', 'options', 'trading', 'trade', 'stock', 'stocks',
  'call', 'put', 'signal', 'signals', 'invest', 'investing',
]);

const FINANCE_STRONG_CONTEXT_TOKENS = new Set([
  'finance', 'financial', 'stock', 'stocks', 'trading', 'trade',
  'portfolio', 'broker', 'invest', 'investing', 'market', 'markets',
  'futures', 'derivative', 'derivatives', 'forex', 'etf',
]);

const TOKEN_NORMALIZATION = {
  options: 'option',
  stocks: 'stock',
  signals: 'signal',
  markets: 'market',
};

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

function tokenize(text) {
  const raw = (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return raw.map(tok => TOKEN_NORMALIZATION[tok] || tok);
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function logInterpolate(value, bands) {
  if (value <= 0) return 0;
  if (value >= bands[bands.length - 1][0]) return bands[bands.length - 1][1];

  for (let i = 0; i < bands.length; i++) {
    const [threshold, score] = bands[i];
    if (value < threshold) {
      if (i === 0) {
        return (value / threshold) * score;
      }
      const [prevT, prevS] = bands[i - 1];
      const ratio = Math.log(value / prevT) / Math.log(threshold / prevT);
      return prevS + ratio * (score - prevS);
    }
  }
  return bands[bands.length - 1][1];
}

function linearInterpolate(value, bands) {
  if (value <= 0) return 0;
  if (value >= bands[bands.length - 1][0]) return bands[bands.length - 1][1];

  for (let i = 0; i < bands.length; i++) {
    const [threshold, score] = bands[i];
    if (value < threshold) {
      if (i === 0) {
        return (value / threshold) * score;
      }
      const [prevT, prevS] = bands[i - 1];
      const ratio = (value - prevT) / (threshold - prevT);
      return prevS + ratio * (score - prevS);
    }
  }
  return bands[bands.length - 1][1];
}

// --------------------------------------------------------------------------- //
// Title Evidence Matching
// --------------------------------------------------------------------------- //

function keywordTitleEvidence(keyword, title, genre = '') {
  const kw = (keyword || '').toLowerCase().trim();
  const titleLower = (title || '').toLowerCase();
  const kwTokens = new Set(tokenize(kw));
  const titleTokensList = tokenize(titleLower);
  const titleTokens = new Set(titleTokensList);

  if (!kwTokens.size || !titleTokens.size) {
    return { exactPhrase: false, allWords: false, partialOverlap: 0, proximity: 0, evidence: 0 };
  }

  let exactPhrase = !!(kw && titleLower.includes(kw));
  let allWords = [...kwTokens].every(tok => titleTokens.has(tok));
  let overlap = [...kwTokens].filter(tok => titleTokens.has(tok)).length / kwTokens.size;

  // Proximity
  let proximity = 0;
  if (allWords && kwTokens.size > 1) {
    const positions = [];
    for (const token of kwTokens) {
      const idx = titleTokensList.indexOf(token);
      if (idx !== -1) positions.push(idx);
    }
    if (positions.length) {
      const span = Math.max(1, Math.max(...positions) - Math.min(...positions) + 1);
      proximity = Math.min(1.0, kwTokens.size / span);
    }
  }

  // Finance ambiguity guard
  const financeIntent = kwTokens.size > 0 && [...kwTokens].some(t => FINANCE_INTENT_TOKENS.has(t));
  const genreLower = (genre || '').toLowerCase();
  const financeContext = genreLower.includes('finance') ||
    [...titleTokens].some(t => FINANCE_STRONG_CONTEXT_TOKENS.has(t));

  if (financeIntent && !financeContext && (exactPhrase || allWords)) {
    exactPhrase = false;
    allWords = false;
    overlap = Math.min(overlap, 0.5);
  }
  if (financeIntent && !financeContext && !exactPhrase && !allWords) {
    overlap = 0;
  }

  let strongScore = 0;
  if (exactPhrase) {
    strongScore = 1.0;
  } else if (allWords) {
    strongScore = 0.85 + 0.15 * proximity;
  }

  let partialScore = 0;
  if (!exactPhrase && !allWords && overlap > 0) {
    partialScore = Math.min(0.5, overlap * 0.5);
  }

  return {
    exactPhrase,
    allWords,
    partialOverlap: overlap,
    proximity,
    evidence: Math.max(strongScore, partialScore),
  };
}

// --------------------------------------------------------------------------- //
// Brand Keyword Detection
// --------------------------------------------------------------------------- //

function isBrandKeyword(keyword, leader, competitors) {
  const kwTokens = new Set(tokenize(keyword));
  if (!kwTokens.size) return { isBrand: false, brandName: null };

  const seller = leader.sellerName || '';
  const sellerTokens = new Set(tokenize(seller));
  if (!sellerTokens.size) return { isBrand: false, brandName: null };

  // Signal A: every keyword token in seller name
  if (![...kwTokens].every(tok => sellerTokens.has(tok))) {
    return { isBrand: false, brandName: null };
  }

  // Strong leader: seller match alone is enough
  const leaderReviews = leader.userRatingCount || 0;
  if (leaderReviews >= 1000) {
    return { isBrand: true, brandName: seller };
  }

  // Weak leader — Signal B: strong independent competitors behind it
  const leaderSellerLower = seller.trim().toLowerCase();
  const independent = competitors
    .slice(1)
    .filter(c => (c.sellerName || '').trim().toLowerCase() !== leaderSellerLower)
    .slice(0, 4);

  if (!independent.length) return { isBrand: false, brandName: null };

  const runnerReviews = independent.map(c => c.userRatingCount || 0).sort((a, b) => a - b);
  const medianRu = median(runnerReviews);

  if (medianRu < 10000) return { isBrand: false, brandName: null };

  return { isBrand: true, brandName: seller };
}

// --------------------------------------------------------------------------- //
// Difficulty Sub-scores
// --------------------------------------------------------------------------- //

const RATING_VOLUME_BANDS = [
  [50, 5], [200, 15], [500, 30], [2000, 50],
  [5000, 65], [10000, 78], [25000, 88], [100000, 95],
];

function ratingVolumeScore(medianRatings) {
  if (medianRatings <= 0) return 0;
  if (medianRatings >= 100000) return 100;
  return logInterpolate(medianRatings, RATING_VOLUME_BANDS);
}

const REVIEW_VELOCITY_BANDS = [
  [10, 5], [50, 15], [200, 30], [1000, 50],
  [5000, 70], [20000, 85], [50000, 95],
];

function reviewVelocityScore(competitors) {
  const velocities = [];
  const now = Date.now();

  for (const c of competitors) {
    const reviews = c.userRatingCount || 0;
    const releaseDate = c.releaseDate;
    if (!releaseDate || reviews <= 0) continue;

    const released = new Date(releaseDate).getTime();
    const days = (now - released) / (1000 * 60 * 60 * 24);
    const years = Math.max(0.5, days / 365.25);
    velocities.push(reviews / years);
  }

  if (!velocities.length) return 50; // default mid-range
  const med = median(velocities);
  if (med <= 0) return 0;
  if (med >= 50000) return 100;
  return logInterpolate(med, REVIEW_VELOCITY_BANDS);
}

const RATING_QUALITY_BANDS = [
  [0, 0], [3.0, 20], [3.5, 35], [4.0, 50], [4.3, 70], [4.5, 85], [5.0, 100],
];

function ratingQualityScore(avgQuality) {
  if (avgQuality <= 0) return 0;
  if (avgQuality >= 5.0) return 100;
  return linearInterpolate(avgQuality, RATING_QUALITY_BANDS);
}

const MARKET_AGE_BANDS = [
  [0.5, 10], [1.0, 20], [2.0, 35], [3.0, 50], [5.0, 70], [8.0, 85], [10.0, 100],
];

function marketAgeScore(competitors) {
  const ages = [];
  const now = Date.now();

  for (const c of competitors) {
    const releaseDate = c.releaseDate;
    if (!releaseDate) continue;
    const released = new Date(releaseDate).getTime();
    const years = (now - released) / (1000 * 60 * 60 * 24 * 365.25);
    if (years > 0) ages.push(years);
  }

  if (!ages.length) return 50; // default mid-range
  const avg = ages.reduce((sum, a) => sum + a, 0) / ages.length;
  if (avg <= 0) return 0;
  if (avg >= 10) return 100;
  return linearInterpolate(avg, MARKET_AGE_BANDS);
}

// --------------------------------------------------------------------------- //
// Difficulty Calculator
// --------------------------------------------------------------------------- //

export function calculateDifficulty(competitors, keyword) {
  if (!competitors || !competitors.length) {
    return {
      score: 0,
      interpretation: 'No Data',
      breakdown: {
        ratingVolume: 0, reviewVelocity: 0, dominantPlayers: 0,
        ratingQuality: 0, marketAge: 0, publisherDiversity: 0, titleRelevance: 0,
      },
      overrideReason: null,
      isBrandKeyword: false,
      brandName: null,
      medianReviews: 0,
      avgReviews: 0,
      titleMatchCount: 0,
    };
  }

  const n = competitors.length;
  const kwLower = (keyword || '').toLowerCase().trim();

  // Rating counts
  const ratingCounts = competitors.map(c => c.userRatingCount || 0);
  const medianReviews = median(ratingCounts);
  const avgReviews = Math.round(ratingCounts.reduce((s, r) => s + r, 0) / n);

  // Sub-scores
  let rvScore = ratingVolumeScore(medianReviews);
  let velScore = reviewVelocityScore(competitors);

  // Dominant Players
  const LOG_CEILING = Math.log10(10000000); // 7.0
  const topHalfSize = Math.max(Math.floor(n / 2), 1);
  let dominanceTotal = 0;
  let weightSum = 0;
  for (let i = 0; i < n; i++) {
    const r = ratingCounts[i];
    const appDominance = r <= 0 ? 0 : Math.min(1.0, Math.log10(Math.max(r, 1)) / LOG_CEILING);
    const weight = i < topHalfSize ? 2.0 : 1.0;
    dominanceTotal += appDominance * weight;
    weightSum += weight;
  }
  let dpScore = Math.min(100, (dominanceTotal / Math.max(weightSum, 1)) * 100);

  // Rating Quality (review-weighted avg)
  let weightedSum = 0;
  let weightTotal = 0;
  for (const c of competitors) {
    const rating = c.averageUserRating || 0;
    const reviews = c.userRatingCount || 0;
    if (rating > 0 && reviews > 0) {
      const w = Math.log1p(reviews);
      weightedSum += rating * w;
      weightTotal += w;
    }
  }
  const avgQuality = weightTotal > 0 ? weightedSum / weightTotal : 0;
  let rqScore = ratingQualityScore(avgQuality);

  // Market Age
  let maScore = marketAgeScore(competitors);

  // Publisher Diversity
  const sellers = new Set(
    competitors.map(c => (c.sellerName || '').toLowerCase()).filter(s => s)
  );
  let pdScore = Math.min(100, (sellers.size / Math.max(n, 1)) * 100);

  // Title Relevance
  let titleMatchCount = 0;
  let relevanceSum = 0;
  for (const c of competitors) {
    const ev = keywordTitleEvidence(keyword, c.trackName, c.primaryGenreName);
    relevanceSum += ev.evidence;
    if (ev.exactPhrase || ev.allWords) titleMatchCount++;
  }
  let trScore = Math.min(100, (titleMatchCount / Math.max(n, 1)) * 100);
  const matchRatio = titleMatchCount / n;

  // Small sample dampening
  const sampleDampening = Math.min(1.0, n / 10);
  pdScore *= sampleDampening;
  trScore *= sampleDampening;
  dpScore *= sampleDampening;
  rqScore *= sampleDampening;

  // Backfill-aware dampening
  const relevanceRatio = relevanceSum / Math.max(n, 1);
  const relevance = Math.max(0.3, Math.min(1.0, relevanceRatio * 2.6));
  pdScore *= relevance;
  rqScore *= relevance;
  maScore *= relevance;

  // Weighted total
  let rawTotal = Math.round(
    rvScore * 0.30 +
    velScore * 0.10 +
    dpScore * 0.20 +
    rqScore * 0.10 +
    maScore * 0.10 +
    pdScore * 0.10 +
    trScore * 0.10
  );
  rawTotal = Math.max(1, Math.min(100, rawTotal));

  // Post-processing overrides
  let total = rawTotal;
  let overrideReason = null;

  // Brand detection
  const brand = isBrandKeyword(kwLower, competitors[0], competitors);

  // Signal 0: Small Result Set Cap
  const smallCaps = { 1: 10, 2: 20, 3: 31, 4: 40 };
  if (smallCaps[n] !== undefined && total > smallCaps[n]) {
    total = smallCaps[n];
    overrideReason = 'small_result_set';
  }

  // Signal 1: Weak Leader Cap
  const leaderReviews = ratingCounts[0] || 0;
  if (n >= 2 && kwLower && leaderReviews < 1000 && !brand.isBrand && !overrideReason) {
    const leaderCap = Math.round(15 + 35 * Math.log10(leaderReviews + 1) / Math.log10(1001));
    if (total > leaderCap) {
      if (matchRatio > 0.2) {
        total = Math.round(leaderCap + (total - leaderCap) * matchRatio);
      } else {
        total = leaderCap;
      }
      overrideReason = 'weak_leader';
    }
  }

  // Signal 2: Backfill Discount
  if (matchRatio < 0.2 && leaderReviews < 1000 && !brand.isBrand && !overrideReason) {
    const ratioFactor = Math.min(1.0, 0.6 + 2.0 * matchRatio);
    const leaderFactor = Math.log10(leaderReviews + 1) / Math.log10(1001);
    let discount = ratioFactor + (1.0 - ratioFactor) * leaderFactor;
    discount = Math.max(0.6, Math.min(1.0, discount));
    const discounted = Math.max(1, Math.round(total * discount));
    if (discounted < total) {
      total = discounted;
      overrideReason = 'backfill';
    }
  }

  total = Math.max(1, Math.min(100, total));

  return {
    score: total,
    interpretation: interpretDifficulty(total),
    breakdown: {
      ratingVolume: parseFloat(rvScore.toFixed(1)),
      reviewVelocity: parseFloat(velScore.toFixed(1)),
      dominantPlayers: parseFloat(dpScore.toFixed(1)),
      ratingQuality: parseFloat(rqScore.toFixed(1)),
      marketAge: parseFloat(maScore.toFixed(1)),
      publisherDiversity: parseFloat(pdScore.toFixed(1)),
      titleRelevance: parseFloat(trScore.toFixed(1)),
    },
    overrideReason,
    isBrandKeyword: brand.isBrand,
    brandName: brand.brandName,
    medianReviews,
    avgReviews,
    titleMatchCount,
  };
}

function interpretDifficulty(score) {
  if (score <= 15) return 'Very Easy';
  if (score <= 35) return 'Easy';
  if (score <= 55) return 'Moderate';
  if (score <= 75) return 'Hard';
  if (score <= 90) return 'Very Hard';
  return 'Extreme';
}

// --------------------------------------------------------------------------- //
// Popularity Estimator
// --------------------------------------------------------------------------- //

const LEADER_BANDS = [
  [10, 1], [100, 5], [1000, 10], [10000, 17], [100000, 24], [1000000, 30],
];

const DEPTH_BANDS = [
  [10, 0.5], [100, 3], [1000, 5], [10000, 8], [50000, 10],
];

const SPECIFICITY_POINTS = [
  [1, 0], [2, -3], [3, -8], [4, -15], [5, -22], [6, -28],
];

export function estimatePopularity(competitors, keyword) {
  if (!competitors || !competitors.length) return null;

  const n = competitors.length;
  const kwLower = (keyword || '').toLowerCase().trim();
  const wordCount = kwLower ? kwLower.split(/\s+/).length : 1;

  // Signal 1: Result count (0-25)
  let resultScore = Math.min(25, n * 2.5);

  // Signal 2: Leader strength (0-30)
  const topHalf = competitors.slice(0, Math.max(Math.floor(n / 2), 1));
  const maxReviews = Math.max(...topHalf.map(c => c.userRatingCount || 0));
  let leaderScore;
  if (maxReviews <= 0) {
    leaderScore = 0;
  } else if (maxReviews >= 1000000) {
    leaderScore = 30;
  } else {
    leaderScore = logInterpolate(maxReviews, LEADER_BANDS);
  }

  // Signal 3: Title match density (0-20) + collect evidence data
  let titleMatches = 0;
  let exactPhraseMatches = 0;
  let relevanceSum = 0;
  for (const c of competitors) {
    const ev = keywordTitleEvidence(keyword, c.trackName, c.primaryGenreName);
    relevanceSum += ev.evidence;
    if (ev.exactPhrase || ev.allWords) titleMatches++;
    if (ev.exactPhrase) exactPhraseMatches++;
  }
  const matchRatio = titleMatches / n;
  let titleScore = Math.min(20, matchRatio * 40);

  // Signal 4: Market depth (0-10)
  const medianReviews = median(competitors.map(c => c.userRatingCount || 0));
  let depthScore;
  if (medianReviews <= 0) {
    depthScore = 0;
  } else if (medianReviews >= 50000) {
    depthScore = 10;
  } else {
    depthScore = logInterpolate(medianReviews, DEPTH_BANDS);
  }

  // Signal 5: Specificity penalty (-0 to -28)
  let specificityPenalty = 0;
  if (wordCount <= 1) {
    specificityPenalty = 0;
  } else if (wordCount >= 6) {
    specificityPenalty = -28;
  } else {
    for (let i = 0; i < SPECIFICITY_POINTS.length; i++) {
      const [w, v] = SPECIFICITY_POINTS[i];
      if (wordCount <= w) {
        if (i === 0) {
          specificityPenalty = v;
        } else {
          const [prevW, prevV] = SPECIFICITY_POINTS[i - 1];
          const t = (wordCount - prevW) / (w - prevW);
          specificityPenalty = prevV + t * (v - prevV);
        }
        break;
      }
    }
  }

  // Signal 6: Exact phrase bonus (0-15)
  const exactRatio = exactPhraseMatches / n;
  let exactBonus = Math.min(15, exactRatio * 50);

  // Small sample dampening
  const sampleDampening = Math.min(1.0, n / 10);
  titleScore *= sampleDampening;
  exactBonus *= sampleDampening;

  // Backfill-aware dampening
  const relevanceRatio = relevanceSum / n;
  const relevanceFactor = Math.max(0.3, Math.min(1.0, relevanceRatio * 2.6));
  resultScore *= relevanceFactor;
  leaderScore *= relevanceFactor;
  depthScore *= relevanceFactor;

  // Final
  const total = Math.round(
    resultScore + leaderScore + titleScore + depthScore + specificityPenalty + exactBonus
  );
  return Math.max(5, Math.min(100, total));
}

function interpretPopularity(score) {
  if (score === null) return 'No Data';
  if (score < 20) return 'Very Low';
  if (score < 35) return 'Low';
  if (score < 50) return 'Moderate';
  if (score < 70) return 'High';
  return 'Very High';
}

// --------------------------------------------------------------------------- //
// Targeting Advice
// --------------------------------------------------------------------------- //

function getTargetingAdvice(popularityScore, difficultyScore) {
  const pop = popularityScore;
  const diff = difficultyScore;

  if (pop === null || pop === undefined) {
    // Fallback when no popularity data
    if (diff <= 25) return { label: 'Easy to Rank', description: 'Low competition — a well-optimized app can rank quickly.' };
    if (diff <= 50) return { label: 'Moderate', description: 'Achievable with strong ASO.' };
    if (diff <= 75) return { label: 'Competitive', description: 'Consider long-tail variants.' };
    return { label: 'Very Competitive', description: 'Dominated by established apps. Target easier keywords first.' };
  }

  if (pop >= 40 && diff <= 40) {
    return { label: 'Sweet Spot', description: 'High popularity + low difficulty — ideal keyword to target with good ASO.' };
  }
  if (pop >= 40 && diff <= 60) {
    return { label: 'Good Target', description: 'Solid popularity with manageable difficulty.' };
  }
  if (pop >= 40 && diff > 60) {
    return { label: 'Worth Competing', description: 'High demand but tough competition. Consider long-tail variants.' };
  }
  if (pop >= 30 && pop < 40 && diff <= 40) {
    return { label: 'Hidden Gem', description: 'Moderate volume with little competition. Good for niche apps.' };
  }
  if (pop >= 30 && pop < 40 && diff <= 60) {
    return { label: 'Decent Option', description: 'Moderate demand and competition. Can work as a supporting keyword.' };
  }
  if (pop >= 30 && pop < 40 && diff > 60) {
    return { label: 'Challenging', description: 'Strong competition. Focus on long-tail variants.' };
  }
  if (pop < 30 && diff <= 30) {
    return { label: 'Low Volume', description: 'Easy to rank but few people search for this. Best as a supporting keyword.' };
  }
  if (pop < 30 && diff > 30) {
    return { label: 'Avoid', description: 'Low search volume with notable competition.' };
  }

  return { label: 'Challenging', description: 'Strong competition. Focus on long-tail variants.' };
}

export { interpretPopularity, getTargetingAdvice };
