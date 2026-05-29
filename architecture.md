# Architecture Writeup — D2C Guardrails Engine

## Overview

A pipeline that ingests, unifies, and correlates four D2C data layers to surface cross-layer insights and validate campaign decisions through a conversational interface.

---

## Components

### 1. Data Layer (`/data/{brand}/`)
Four JSON files per brand:
- `social.json` — platform, post type, reach, sentiment
- `sales.json` — SKU, revenue, refunds, new customers
- `customers.json` — support tickets, avg rating, NPS, complaints
- `ads.json` — spend, ROAS, CTR, campaign type

For Mamaearth: grounded in HONASA FY23 public filings (₹1,492 Cr revenue, ~32% marketing spend, 600K Instagram followers). For other brands: synthesized by GPT-4o with brand-specific product names and realistic patterns.

### 2. Ingest Layer (`ingest.js`)
- Joins all 4 layers by primary key: `date` + secondary key: `sku`
- Social has no SKU → joined on date only, aggregated by dominant sentiment
- Duplicate (date, sku) pairs → numeric fields averaged
- Computes cross-layer signals: `cx_risk_score`, `true_roas`, `sentiment_mismatch`, `refund_rate`, `social_to_acq_rate`
- Output: `unified_data.json` — one record per (date × sku)

### 3. Correlation Agent (`agent/correlate.js`)
Runs 6 checks on unified data. Every threshold is derived from the data (not hardcoded):

| Check | What it catches |
|---|---|
| Crisis Blindspot | cx_risk > 2x baseline while ads active |
| Sentiment Mismatch | Social positive, customer negative |
| Refund Spike | Refund rate > 2x SKU's own average |
| ROAS Divergence | Platform ROAS vs true ROAS gap > 1.5x |
| Social Lift | High reach day → did new customers go up? |
| Healthy SKU Signal | All 4 layers green — winning template |

Output: `findings.json` with severity (block/warn/pass) per finding.

### 4. Rule Generator (`server.js → generateRules()`)
- Samples representative findings (5 blocks, 10 warns, 5 passes)
- Sends to GPT-4o with strict JSON schema
- Forces metric names from allowed list so validator can parse them
- Output: `rules.json` — 12+ rules per brand, each traceable to a finding

### 5. Memory Layer (`/memory/{brand}/`)
Per-brand persistent store:
- `findings.json`, `rules.json`, `brand_analysis.md`, `meta.json`
- `meta.json` tracks `layers_included` — used to detect when new data sources are added
- On next request: if layers unchanged → load from memory instantly
- If new layer detected → rerun pipeline automatically

### 6. Validator (`guardrails/validator.js`)
- Reads campaign description in natural language
- OpenAI extracts intent and SKU
- Rules checked against campaign metrics
- Returns: PASS / WARN / BLOCK with rule ID and reason

### 7. Server (`server.js`)
Express backend with:
- `POST /chat` — intent detection → routes to pipeline, validator, or analysis
- `GET /status/:jobId` — polling endpoint for live pipeline progress
- Job queue (in-memory) — tracks pipeline steps per brand
- Progressive status reporting — frontend polls every 2 seconds

### 8. UI (`/ui` — React + Vite)
- Single chat interface
- Natural language input — no forms or dropdowns
- Live pipeline progress shown as steps update
- Polling stops when `done: true`

---

## Data Flow
User types brand name
↓
POST /chat → detectIntent() → brand_request
↓
Check memory/{brand}/ → exists + layers unchanged?
├── YES → load instantly, reply
└── NO  → start background pipeline (return jobId)
↓
generateBrandData() OR use existing files
↓
ingest.js (DATA_DIR env var per brand)
↓
correlate.js (FINDINGS_FILE env var per brand)
↓
generateRules() → rules.json
↓
saveBrandMemory() → memory/{brand}/
↓
job.done = true
↓
Frontend polls /status/:jobId every 2 seconds
↓
When done → show summary → chat ready

---

## Prompt and Agent Strategy

**Intent Detection:** Single GPT-4o call with strict JSON schema. Four intents: `brand_request`, `campaign_question`, `analysis_question`, `conversational`. Fallback to conversational for anything out of bounds.

**Data Synthesis:** GPT-4o prompted with brand name + known facts. Critical rules enforced: consistent dates across layers, lowercase sentiment values, realistic crisis scenario included.

**Correlation:** Pure JavaScript — no AI involved. Thresholds computed from data averages. AI only used for the written analysis after findings are collected.

**Rule Generation:** Sampled findings (20 max) sent to GPT-4o with strict metric allowlist. Prevents hallucinated metric names that validator can't parse.

**Campaign Validation:** Rules + campaign description sent to GPT-4o. Responds with PASS/WARN/BLOCK + rule ID references.

---

## Trade-offs Considered

| Decision | Why |
|---|---|
| In-process memory vs database | Simpler for 48hrs. Redis would be next step. |
| Sample 500 records for correlation | 14k records × 6 checks = 84k iterations, too slow. Sampling gives same signal. |
| Sample 20 findings for AI | 20k findings → 3M tokens. Stratified sample preserves signal diversity. |
| OpenAI only, not swappable | Would add LLM_PROVIDER env var with more time. |
| Synthesized data vs real APIs | YouTube API available but Instagram locked down since 2018. Synthesis grounded in public filings is defensible. |

---

## What I'd Build Next (Days 3-7)

1. **Aggregated findings** — group by SKU before AI call, reduce tokens 99%
2. **LLM provider switch** — `LLM_PROVIDER` env var to swap OpenAI ↔ Anthropic
3. **Vector DB** — store findings as embeddings for semantic search across brands
4. **Real API ingestion** — YouTube Data API for social, Amazon reviews scraper
5. **Persistent memory** — Redis or Supabase for cross-restart persistence
6. **Two-layer validator** — code checks core metrics, AI checks brand-specific ones
7. **Aggregation pipeline** — proper time-series aggregation before correlation