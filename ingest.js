/**
 * ingest.js — Generic D2C Data Unification Layer
 *
 * Join strategy:
 *   Primary key  : date (ISO string, all four layers share it)
 *   Secondary key: sku  (sales, ads, customer share it; social does NOT)
 *
 * Output: unified_data.json  — one record per (date × sku) with all four
 *         layers merged, plus a provenance block on every record.
 *
 * Run:  node ingest.js                        (uses brand.config.json)
 *       node ingest.js --brand=./nykaa.config.json
 */

import fs   from "fs";
import path from "path";

// ─── 1. CONFIG ────────────────────────────────────────────────────────────────

// Priority: --brand= CLI arg → BRAND_CONFIG env var → brand.config.json
const brandArg   = process.argv.find(a => a.startsWith("--brand="));
const configPath = brandArg
  ? brandArg.split("=")[1]
  : (process.env.BRAND_CONFIG ?? "./brand.config.json");
const BRAND      = JSON.parse(fs.readFileSync(configPath, "utf8"));

console.log(`[config] Brand: ${BRAND.brand_name} (${BRAND.ticker}) | Currency: ${BRAND.currency_symbol}`);

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const OUT_FILE  = path.join(DATA_DIR, "unified_data.json");
const PROV_FILE = path.join(DATA_DIR, "data_provenance.md");

const FILES = {
  social  : path.join(DATA_DIR, "social.json"),
  sales   : path.join(DATA_DIR, "sales.json"),
  customer: path.join(DATA_DIR, "customers.json"),
  ads     : path.join(DATA_DIR, "ads.json"),
};

// ─── 2. LOAD ──────────────────────────────────────────────────────────────────

function load(layer) {
  const raw  = fs.readFileSync(FILES[layer], "utf8");
  const json = JSON.parse(raw);
  // Support both bare arrays and { data: [...] } wrappers
  const rows = Array.isArray(json) ? json : (json.data ?? json.records ?? []);
  console.log(`  [${layer}] loaded ${rows.length} rows`);
  return rows;
}

// ─── 3. NORMALISE ─────────────────────────────────────────────────────────────

/**
 * Coerce every date to a clean YYYY-MM-DD string so joins are deterministic
 * even if some rows use "2023-7-8" or a timestamp.
 */
function normaliseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d)) return String(raw).slice(0, 10);   // best-effort
  return d.toISOString().slice(0, 10);
}

function normaliseSku(raw) {
  return raw ? String(raw).trim().toLowerCase() : "__no_sku__";
}

// ─── 4. INDEX HELPERS ─────────────────────────────────────────────────────────

/**
 * Build a Map keyed by "date|sku" for layers that have both.
 * For social (no sku) build a Map keyed by "date" that holds an *array*
 * of posts — a single date often has multiple posts across platforms.
 */
function indexByDateSku(rows, layer) {
  const idx = new Map();
  for (const row of rows) {
    const date = normaliseDate(row.date);
    const sku  = normaliseSku(row.sku);
    const key  = `${date}|${sku}`;
    if (idx.has(key)) {
      // Merge duplicate (date, sku) pairs by averaging numeric fields
      idx.set(key, mergeRows(idx.get(key), row, layer));
    } else {
      idx.set(key, { ...row, date, sku, _layer: layer });
    }
  }
  return idx;
}

function indexSocialByDate(rows) {
  const idx = new Map();
  for (const row of rows) {
    const date = normaliseDate(row.date);
    if (!idx.has(date)) idx.set(date, []);
    idx.get(date).push({ ...row, date });
  }
  return idx;
}

/** Naive merge: keep first row's identity fields, average numeric fields. */
function mergeRows(existing, incoming, layer) {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "number" && typeof merged[k] === "number") {
      merged[k] = (merged[k] + v) / 2;   // average on collision
    }
  }
  return merged;
}

// ─── 5. AGGREGATE SOCIAL FOR A GIVEN DATE ────────────────────────────────────

/**
 * Takes the array of social posts for a date and returns a single summary
 * object so we can embed it cleanly into the unified record.
 */
function aggregateSocial(posts) {
  if (!posts || posts.length === 0) return null;

  const totals = posts.reduce(
    (acc, p) => ({
      likes    : acc.likes     + (p.likes     ?? 0),
      comments : acc.comments  + (p.comments  ?? 0),
      shares   : acc.shares    + (p.shares    ?? 0),
      reach    : acc.reach     + (p.reach     ?? 0),
      posts    : acc.posts + 1,
    }),
    { likes: 0, comments: 0, shares: 0, reach: 0, posts: 0 }
  );

  // Dominant sentiment: majority vote
  const sentimentCounts = {};
  for (const p of posts) {
    const s = p.sentiment ?? "neutral";
    sentimentCounts[s] = (sentimentCounts[s] ?? 0) + 1;
  }
  const dominantSentiment = Object.entries(sentimentCounts)
    .sort((a, b) => b[1] - a[1])[0][0];

  // Platform list
  const platforms = [...new Set(posts.map(p => p.platform).filter(Boolean))];

  return {
    ...totals,
    dominant_sentiment: dominantSentiment,
    platforms,
    engagement_rate: totals.reach > 0
      ? +((totals.likes + totals.comments + totals.shares) / totals.reach * 100).toFixed(2)
      : null,
    raw_posts: posts,   // keep originals for the agent to query
  };
}

// ─── 6. DERIVED / COMPUTED SIGNALS ───────────────────────────────────────────

/**
 * After all four layers are joined we compute cross-layer signals.
 * These are the numbers the correlation agent will actually reason over.
 */
function computeSignals(record) {
  const signals = {};

  // FIX #1: resolve currency fields from brand config, not hardcoded names
  const spend   = record.ads?.[BRAND.spend_field]   ?? record.ads?.spend;
  const revenue = record.sales?.[BRAND.revenue_field] ?? record.sales?.revenue;

  // Revenue efficiency
  if (spend && revenue) {
    signals.true_roas = +(revenue / spend).toFixed(2);
  }

  // FIX #3: rating scale from brand config, not hardcoded 5
  const maxRating = BRAND.rating_scale ?? 5;
  if (record.customer?.support_tickets && record.customer?.avg_rating != null) {
    signals.cx_risk_score = +(
      (record.customer.support_tickets / 100) *
      ((maxRating - record.customer.avg_rating) / maxRating)
    ).toFixed(2);
  }

  // Social → sales conversion proxy
  if (record.social?.reach && record.sales?.new_customers) {
    signals.social_to_acq_rate = +(
      (record.sales.new_customers / record.social.reach) * 1000
    ).toFixed(3);   // new customers per 1 000 social reach
  }

  // Sentiment alignment: ad sentiment vs customer sentiment
  const adSentiment      = record.social?.dominant_sentiment;
  const customerSentiment = record.customer?.review_sentiment;
  if (adSentiment && customerSentiment) {
    signals.sentiment_mismatch = adSentiment !== customerSentiment;
  }

  // Refund pressure
  if (record.sales?.units_sold && record.sales?.refunds) {
    signals.refund_rate = +(record.sales.refunds / record.sales.units_sold * 100).toFixed(2);
  }

  return signals;
}

// ─── 7. UNIFY ─────────────────────────────────────────────────────────────────

function unify(social, sales, customer, ads) {
  console.log("\n[unify] Building indexes …");
  const salesIdx    = indexByDateSku(sales,    "sales");
  const customerIdx = indexByDateSku(customer, "customer");
  const adsIdx      = indexByDateSku(ads,      "ads");
  const socialIdx   = indexSocialByDate(social);

  // The canonical key space = union of all (date, sku) pairs from sales + ads + customer
  const allKeys = new Set([
    ...salesIdx.keys(),
    ...customerIdx.keys(),
    ...adsIdx.keys(),
  ]);

  console.log(`[unify] ${allKeys.size} unique (date × sku) combinations`);

  const unified = [];

  for (const key of allKeys) {
    const [date, sku] = key.split("|");

    const salesRow    = salesIdx.get(key)    ?? null;
    const customerRow = customerIdx.get(key) ?? null;
    const adsRow      = adsIdx.get(key)      ?? null;
    const socialPosts = socialIdx.get(date)  ?? [];   // date-only join for social

    const socialSummary = aggregateSocial(socialPosts);

    const record = {
      _id        : key,
      date,
      sku        : sku === "__no_sku__" ? null : sku,
      // ── Four layers ──────────────────────────────────────────────────────
      social   : socialSummary,
      sales    : salesRow    ? omit(salesRow,    ["date","sku","_layer"]) : null,
      customer : customerRow ? omit(customerRow, ["date","sku","_layer"]) : null,
      ads      : adsRow      ? omit(adsRow,      ["date","sku","_layer"]) : null,
      // ── Provenance ───────────────────────────────────────────────────────
      _provenance: {
        social_real   : false,   // synthesised
        sales_real    : false,
        customer_real : false,
        ads_real      : false,
        social_posts_count : socialPosts.length,
        layers_present: [
          socialSummary ? "social"   : null,
          salesRow      ? "sales"    : null,
          customerRow   ? "customer" : null,
          adsRow        ? "ads"      : null,
        ].filter(Boolean),
      },
    };

    // ── Derived signals ───────────────────────────────────────────────────
    record._signals = computeSignals(record);

    unified.push(record);
  }

  // Sort chronologically
  unified.sort((a, b) => a.date.localeCompare(b.date));
  return unified;
}

function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

// ─── 8. STATS SUMMARY ────────────────────────────────────────────────────────

function printStats(unified) {
  const total     = unified.length;
  const fullyCov  = unified.filter(r => r._provenance.layers_present.length === 4).length;
  const skus      = [...new Set(unified.map(r => r.sku).filter(Boolean))];
  const dateRange = [unified[0]?.date, unified[unified.length - 1]?.date];

  console.log("\n── Unified dataset stats ──────────────────────────────");
  console.log(`  Total records   : ${total}`);
  console.log(`  Fully-joined (4 layers) : ${fullyCov} (${(fullyCov/total*100).toFixed(1)}%)`);
  console.log(`  Unique SKUs     : ${skus.length}`);
  console.log(`  Date range      : ${dateRange[0]} → ${dateRange[1]}`);
  console.log(`  SKUs found      : ${skus.join(", ")}`);
  console.log("───────────────────────────────────────────────────────\n");
}

// ─── 9. PROVENANCE DOC ───────────────────────────────────────────────────────

function writeProvenance(unified) {
  const layers = {
    social   : unified.filter(r => r.social).length,
    sales    : unified.filter(r => r.sales).length,
    customer : unified.filter(r => r.customer).length,
    ads      : unified.filter(r => r.ads).length,
  };

  const md = `# Data Provenance — ${BRAND.brand_name} Unified Dataset

Generated: ${new Date().toISOString()}
Brand config: ${configPath}

## Source files

| Layer    | File                  | Rows (raw) | Real / Synthesised |
|----------|-----------------------|------------|--------------------|
| Social   | social_data.json      | —          | **Synthesised** — ${BRAND.provenance_notes} |
| Sales    | sales_data.json       | —          | **Synthesised** — ${BRAND.provenance_notes} |
| Customer | customer_data.json    | —          | **Synthesised** — ${BRAND.provenance_notes} |
| Ads      | ads_data.json         | —          | **Synthesised** — ${BRAND.provenance_notes} |

## What "synthesised" means here

All records were generated to be internally consistent:
- Revenue × ROAS → implied spend checks out against disclosed marketing budget.
- Negative-sentiment spikes in customer layer correspond to known public controversies
  (Shade Correction Cream backlash, Q3 2023).
- Social reach numbers scaled against Mamaearth's disclosed follower counts
  (Instagram ~600 K, YouTube ~300 K as of FY23).

## Unified output

| Metric                    | Value                  |
|---------------------------|------------------------|
| Total unified records     | ${unified.length}      |
| Records with all 4 layers | ${unified.filter(r=>r._provenance.layers_present.length===4).length} |
| Records with social layer | ${layers.social}       |
| Records with sales layer  | ${layers.sales}        |
| Records with customer layer | ${layers.customer}   |
| Records with ads layer    | ${layers.ads}          |

## Join strategy

- **Primary key**: \`date\` (ISO YYYY-MM-DD) — all four layers
- **Secondary key**: \`sku\` — sales, ads, customer layers
- Social has no SKU → joined on date only; multiple posts per date are
  aggregated into a single summary (total reach/engagement, dominant sentiment).
- Duplicate (date, sku) within a layer → numeric fields averaged.

## Known gaps

- Social data does not carry SKU attribution — we cannot say "this Reel
  drove Onion Hair Oil sales" without creator brief metadata (not public).
- Ads data uses campaign-level spend, not ad-set level; CTR may be averaged
  across creatives.
`;

  fs.writeFileSync(PROV_FILE, md, "utf8");
  console.log(`[provenance] Written → ${PROV_FILE}`);
}

// ─── 10. MAIN ─────────────────────────────────────────────────────────────────

console.log(`=== ${BRAND.brand_name} ingest.js ===\n`);
console.log("[load] Reading source files …");
const social   = load("social");
const sales    = load("sales");
const customer = load("customer");
const ads      = load("ads");

const unified = unify(social, sales, customer, ads);

printStats(unified);

fs.writeFileSync(OUT_FILE, JSON.stringify(unified, null, 2), "utf8");
console.log(`[output] Written → ${OUT_FILE}  (${unified.length} records)`);

writeProvenance(unified);
console.log("\nDone. ✓");