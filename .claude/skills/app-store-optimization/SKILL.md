---
name: app-store-optimization
description: "Complete App Store Optimization (ASO) toolkit for researching, optimizing, and tracking mobile app performance on Apple App Store and Google Play Store"
risk: unknown
source: custom
date_added: "2026-04-03"
---

# App Store Optimization (ASO) Skill

ASO toolkit powered by the `appstore` MCP server. Uses real App Store data to analyze keywords, score competition, discover opportunities, and optimize app metadata.

## When to Use

Trigger this skill when the user asks about:
- Keyword research, keyword difficulty, keyword popularity
- ASO analysis, app store optimization
- Competitor analysis for app stores
- App store keyword suggestions or opportunities
- App metadata optimization (title, subtitle, description, keywords)
- Review analysis or sentiment for an app
- App store category analysis

## Available MCP Tools

The `appstore` MCP server provides these tools. **Always use the appropriate tool** instead of guessing or making up data.

### Keyword Analysis

**`get_keyword_scores`** — Score a keyword for difficulty (1-100) and popularity (5-100).
- Platform: iOS only
- Returns: difficulty score + breakdown, popularity score, targeting advice, brand detection
- Use when: User wants to know how hard/popular a keyword is

```
get_keyword_scores({ keyword: "meditation", platform: "ios", country: "us" })
```

**`suggest_and_score_keywords`** — Discover keyword opportunities from App Store autocomplete.
- Fetches autocomplete suggestions for a seed keyword
- Scores each suggestion for difficulty, popularity, and KEI
- Returns results sorted by KEI (best opportunities first)
- Use when: User wants keyword ideas or long-tail opportunities

```
suggest_and_score_keywords({ keyword: "fitness", country: "us", maxSuggestions: 10 })
```

**`analyze_top_keywords`** — Analyze top apps ranking for a keyword with full metrics.
- Returns: top apps list, brand presence, category distribution, keyword scoring (iOS)
- Use when: User wants to see who ranks for a keyword and market overview

```
analyze_top_keywords({ keyword: "meditation", platform: "ios", num: 25, country: "us" })
```

### App Research

**`search_app`** — Search for apps by name.
```
search_app({ term: "spotify", platform: "ios", num: 10 })
```

**`get_app_details`** — Get full app metadata, ratings, description.
```
get_app_details({ appId: "com.spotify.music", platform: "android" })
```

**`get_similar_apps`** — Find similar/related apps.
```
get_similar_apps({ appId: "com.spotify.music", platform: "android" })
```

**`get_developer_info`** — Get developer portfolio and metrics.
```
get_developer_info({ devId: "Spotify AB", platform: "android" })
```

### Reviews

**`fetch_reviews`** — Fetch user reviews for an app.
```
fetch_reviews({ appId: "com.spotify.music", platform: "android", num: 50 })
```

**`analyze_reviews`** — Analyze review sentiment and extract insights.
```
analyze_reviews({ appId: "com.spotify.music", platform: "android" })
```

### Other

**`get_pricing_details`** — App pricing, subscriptions, in-app purchases.
**`get_version_history`** — App version history and changelogs.
**`get_android_categories`** — List Google Play categories.

## CRITICAL: Rate Limit & Parallel Agent Rules

Apple aggressively rate limits API requests. Follow these rules to avoid 403/429 errors:

### Never call these tools in parallel (they all hit Apple's API):
- `get_keyword_scores`
- `suggest_and_score_keywords`
- `analyze_top_keywords`

If you need to score multiple keywords, use `suggest_and_score_keywords` which handles them sequentially with built-in throttling. Do NOT dispatch parallel agents that each call `get_keyword_scores` for different keywords — this will trigger rate limiting and all requests will fail.

### Safe to call in parallel (different endpoints or local processing):
- `get_app_details` + `analyze_reviews` (for the same app)
- `fetch_reviews` + `get_similar_apps`
- `get_developer_info` + `get_pricing_details`
- Any non-Apple-search tools together

### If rate limited:
- The tool will automatically retry with exponential backoff (5s → 15s → 45s)
- If all retries fail, wait a few minutes and try again
- Reduce the number of keywords being scored in a single session

### Example: Correct multi-agent workflow
```
Agent 1: analyze_reviews("com.app") → OK (reviews endpoint)
Agent 2: get_similar_apps("com.app") → OK (different endpoint)
Main: suggest_and_score_keywords("meditation") → OK (sequential, one at a time)
```

### Example: WRONG multi-agent workflow
```
Agent 1: get_keyword_scores("meditation") → Apple API
Agent 2: get_keyword_scores("yoga") → Apple API ← RATE LIMITED
Agent 3: suggest_and_score_keywords("fitness") → 10x Apple API ← RATE LIMITED
```

## Scoring Guide

### Difficulty (1-100)

| Score | Label | Action |
|-------|-------|--------|
| 0-15 | Very Easy | Go for it |
| 16-35 | Easy | Good chance |
| 36-55 | Moderate | Achievable |
| 56-75 | Hard | Tough |
| 76-90 | Very Hard | Risky |
| 91-100 | Extreme | Avoid |

### Popularity (5-100)

| Score | Label |
|-------|-------|
| 50+ | High demand |
| 30-49 | Good search volume |
| 15-29 | Moderate volume |
| 5-14 | Low volume |

### KEI (Keyword Effectiveness Index)

`KEI = popularity x (100 - difficulty) / 100`

Higher KEI = better opportunity. Look for keywords with KEI > 30.

### Targeting Advice

| Label | Meaning | What to do |
|-------|---------|------------|
| Sweet Spot | High pop + low diff | Target immediately |
| Good Target | High pop + moderate diff | Strong candidate |
| Worth Competing | High pop + high diff | Consider long-tail variants |
| Hidden Gem | Mid pop + low diff | Good for niche apps |
| Decent Option | Mid pop + mid diff | Supporting keyword |
| Low Volume | Low pop + easy | Only as secondary keyword |
| Avoid | Low pop + high diff | Skip this keyword |
| Challenging | Strong competition | Use long-tail variants |

## Workflow Examples

### Full Keyword Research

1. Start with seed keyword: `get_keyword_scores({ keyword: "meditation", platform: "ios" })`
2. Discover opportunities: `suggest_and_score_keywords({ keyword: "meditation" })`
3. Analyze top competitors: `analyze_top_keywords({ keyword: "meditation timer", platform: "ios" })`
4. Check competitor apps: `get_app_details` for top-ranking apps
5. Read competitor reviews: `analyze_reviews` to find gaps

### Competitor Analysis

1. Search competitor: `search_app({ term: "Headspace", platform: "ios" })`
2. Get details: `get_app_details` with the app ID
3. Find similar apps: `get_similar_apps` to map the market
4. Analyze reviews: `analyze_reviews` to find weaknesses
5. Score their keywords: `get_keyword_scores` for keywords from their title/subtitle

### Metadata Optimization

1. Score current keywords: `get_keyword_scores` for each keyword in your title/subtitle
2. Find alternatives: `suggest_and_score_keywords` for better options
3. Check competitors: `analyze_top_keywords` to see what works
4. Optimize title: Use highest-KEI keywords in title (30 chars iOS, 50 chars Android)
5. Fill keyword field: Use remaining keywords in Apple's 100-char field

## Platform-Specific Limits

### Apple App Store
- Title: 30 characters
- Subtitle: 30 characters
- Keyword field: 100 characters (comma-separated, no spaces)
- Description: 4,000 characters
- Promotional Text: 170 characters

### Google Play Store
- Title: 50 characters
- Short Description: 80 characters
- Full Description: 4,000 characters
- No separate keyword field

## CRITICAL: Keyword Relevancy Rules

**ALWAYS follow these rules before recommending any keyword for an app's metadata (title, subtitle, keyword field, description).**

### 1. Feature-First Approach

Before doing ANY keyword research, you MUST first understand the app's actual features. Ask the user or analyze the app's description/screenshots to extract what the app truly does. **Never recommend keywords for features the app doesn't have.**

Bad example: Recommending "tarot" or "horoscope" keywords for a meditation app that has no tarot/horoscope features — even if those keywords have great KEI scores.

### 2. Apple's Keyword Relevancy Policy

Apple Review Guidelines 2.3.7: Apps with irrelevant, misleading, or spammy metadata will be **rejected or removed from the store**. This includes:
- Keywords for features the app doesn't offer
- Competitor brand names in your keywords
- Misleading descriptions of app functionality
- Stuffing unrelated trending terms

### 3. User Retention Impact

Even if Apple doesn't catch irrelevant keywords, users who download expecting a feature that doesn't exist will:
- **Uninstall quickly** — high uninstall rate signals low quality to Apple's algorithm
- **Leave negative reviews** — damages your rating and conversion rate
- **Reduce your ranking** — Apple tracks install-to-uninstall ratio as a ranking signal

A keyword with KEI 50 that causes 80% uninstall rate is WORSE than a keyword with KEI 15 that retains users.

### 4. Workflow: Always Validate Keywords Against Features

```
1. Extract app's actual features (ask user or analyze app listing)
2. Research keywords with suggest_and_score_keywords
3. FILTER: Remove any keyword that doesn't match a real feature
4. Score remaining keywords
5. Recommend only relevant keywords with best KEI
```

### 5. Safe Keyword Categories

- **Direct features**: What the app actually does ("meditation timer", "sleep sounds")
- **User intent**: What problem users are solving ("reduce anxiety", "better sleep")
- **Category terms**: Legitimate category descriptions ("health app", "wellness")
- **Use case variants**: Different ways to describe the same feature ("mindfulness", "breathing exercise")

### 6. Unsafe Keyword Categories (AVOID)

- Features the app doesn't have
- Competitor app names or brand terms
- Trending terms unrelated to the app
- Generic popular terms with no app connection
- Misleading capability claims

## Algorithm & Ranking Factors (2025-2026)

- **Retention is a ranking signal.** Users installing and quickly uninstalling hurts rankings. Never optimize for installs alone.
- **Screenshot captions are now indexed** (Apple, 2025). Embed strategic keywords naturally in caption overlays.
- **In-app events are searchable assets.** Apple indexes them — treat events like mini-listings with their own keyword strategy.
- **Semantic search over keyword matching.** Apple uses synonym handling and intent. Optimize for meaning, not just exact strings.
- **Crash rates affect ranking.** Both stores penalize unstable apps in search placement.
- **Custom Product Pages (CPPs)**: Apple allows up to 70 per app. Each CPP can rank independently for assigned keywords — multiplies keyword surface area.

## Metadata Rules

- **Never duplicate keywords across title, subtitle, and keyword field.** Apple indexes all three — repeating wastes character space.
- **Never use "#1", "FREE", "best"** in metadata — Google bans these; Apple penalizes.
- **Never use competitor names** in keyword fields — Apple Guideline 2.3.7 explicitly prohibits.
- **Screenshot text must match actual app UI.** Misleading screenshots trigger rejection.
- **Cross-localization**: Apple indexes keywords from related locales (e.g., Spanish-Mexico in US store). Use this to expand keyword pool.
- **Never literally translate keywords** for localization. Research native search terms — intent differs across cultures.

## Conversion Tips

- **First 3 screenshots must communicate value within 7 seconds** — show what it does, not just how it looks.
- **90% of featured apps have 4.0+ rating.** Rating is a prerequisite for visibility.
- **Long-tail keywords convert better** — "remove background from photo" beats "photo editor" in both competition and conversion.
- **Dark mode screenshots are expected** in 2025+.
- **A/B test relentlessly**: Apple PPO allows 3 variants; Google has Store Listing Experiments.

## Seasonal Strategy

- Plan seasonal keyword changes **1 quarter in advance** — indexing takes time.
- Swap seasonal keywords in title/subtitle before the event.
- **Revert immediately after the season ends** — stale seasonal keywords waste slots and reduce conversion.
- Use **in-app events** for seasonal promotions — they appear on the Today tab and in search.

## Important Notes

- Keyword scoring is currently **iOS only** (Android support planned)
- Scores are heuristic-based — good for relative comparison, not absolute truth
- Always check multiple keywords before deciding on a strategy
- Autocomplete suggestions reflect real user searches
- Country matters — always specify the target market
- **High KEI alone is not enough** — relevancy to the app is the #1 filter
