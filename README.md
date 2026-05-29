# D2C Guardrails Engine

A cross-layer brand intelligence engine that unifies social, sales, customer, and ads data to surface actionable insights and validate campaign decisions in real time.

## Brand Picked: Mamaearth (HONASA Consumer, NSE: HONASA)

**Why Mamaearth:**
- Publicly listed D2C brand with audited financials (FY23 revenue ₹1,492 Cr)
- Active across all 4 data layers (Instagram, Amazon, own site, Meta Ads)
- Known public controversies (Shade Correction Cream Q3 2023) make cross-layer analysis meaningful
- Indian market context matches the D2C brief

---

## Architecture
User types brand name in chat
↓
React UI → POST /chat → server.js (Express)
↓
Intent Detection (OpenAI) → brand_request / campaign_question / analysis_question / conversational
↓
Pipeline (if brand not in memory):
→ data/mamaearth/ (real grounded data) or generateBrandData() (synthesized)
→ ingest.js (joins 4 layers by date + SKU)
→ correlate.js (6 cross-layer checks)
→ generateRules() (12+ guardrail rules from findings)
→ memory/{brand}/ (saved per brand)
↓
Validator checks campaign ideas against rules → PASS / WARN / BLOCK
↓
Chat responds with reasoning

---

## How to run from a fresh clone

```bash
# 1. Clone the repo
git clone https://github.com/shloka-gupta/d2c-guardrails-engine.git
cd d2c-guardrails-engine

# 2. Install dependencies
npm install

# 3. Add your API key
echo OPENAI_API_KEY=your_key_here > .env

# 4. Start the backend
node server.js

# 5. In a new terminal, start the frontend
cd ui
npm install
npm run dev

# 6. Open http://localhost:5173 and type "Mamaearth"
```

---

## Data Layers

| Layer | Source | Status |
|---|---|---|
| Social | Instagram + YouTube (Mamaearth) | Synthesized, grounded in public follower counts |
| Sales | Amazon India + Own Site | Synthesized, grounded in HONASA FY23 ₹1,492 Cr revenue |
| Customers | Amazon Reviews + Support | Synthesized, grounded in public complaint patterns |
| Ads | Meta Ads + Google Ads | Synthesized, grounded in ~32% marketing spend ratio |

Full provenance documented in `data_provenance.md`.

---

## The 6 Correlation Checks

1. **Crisis Blindspot** — Ads running while cx_risk is high
2. **Sentiment Mismatch** — Creator content vs real buyer experience
3. **Refund Spike** — SKU refund rate vs its own historical average
4. **ROAS Divergence** — Platform reported vs true ROAS (revenue ÷ spend)
5. **Social Lift** — Did high reach actually drive new customers?
6. **Healthy SKU Signal** — All 4 layers positive — the winning template

---

## Guardrails

12+ rules auto-generated from correlation findings. Each rule traces back to a specific finding with metric, operator, threshold and reason.

Validator accepts natural language campaign ideas and returns:
- 🟢 PASS — cleared for launch
- 🟡 WARN — proceed with caution
- 🔴 BLOCK — do not launch, here's why

---

## AI Tools Used

| Tool | Used for |
|---|---|
| OpenAI GPT-4o | Intent detection, data synthesis, brand analysis, rule generation, campaign validation |
| Claude | Architecture thinking, code review, debugging strategy |

---

## What I'd build in days 3-7

1. **Aggregated findings** — group findings by SKU before sending to AI (reduces tokens by 99%)
2. **Vector DB** — store findings as embeddings for semantic search across brands
3. **LLM provider switch** — env variable to swap between LLMs
4. **Real API ingestion** — YouTube Data API for social layer, Amazon reviews scraper
5. **Persistent memory** — Redis or Supabase instead of in-process memory
6. **Two-layer validator** — code checks core metrics, AI checks brand-specific metrics