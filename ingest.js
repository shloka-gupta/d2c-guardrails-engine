/* "ingest.js dynamically loads multiple business datasets, classifies them into SKU-level and
date-level data, indexes them for efficient lookup,
joins them into a unified date+SKU record, computes business KPIs, and outputs an analytics-ready dataset." */

import fs   from "fs";
import path from "path";



// ─── CONFIG ───────────────────────────────────────────────────────────────────

const brandArg   = process.argv.find(a => a.startsWith("--brand="));
const configPath = brandArg
  ? brandArg.split("=")[1]
  : (process.env.BRAND_CONFIG ?? "./brand.config.json");
const BRAND = JSON.parse(fs.readFileSync(configPath, "utf8"));

console.log(`[config] Brand: ${BRAND.brand_name} | Currency: ${BRAND.currency_symbol}`);

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const OUT_FILE  = path.join(DATA_DIR, "unified_data.json");
const PROV_FILE = path.join(DATA_DIR, "data_provenance.md");

// ─── DISCOVER LAYERS DYNAMICALLY ─────────────────────────────────────────────
// Instead of hardcoding social/sales/customer/ads
// we just read whatever JSON files exist in the folder

const SKIP_FILES = ["unified_data.json", "data_provenance.md"];

const layerFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith(".json") && !SKIP_FILES.includes(f));

console.log(`[config] Layers found: ${layerFiles.map(f => f.replace(".json","")).join(", ")}`);

// ─── LOAD ─────────────────────────────────────────────────────────────────────

function loadLayer(filename) {
  const raw  = fs.readFileSync(path.join(DATA_DIR, filename), "utf8");
  const json = JSON.parse(raw);
  const rows = Array.isArray(json) ? json : (json.data ?? json.records ?? []);
  console.log(`  [${filename}] loaded ${rows.length} rows`);
  return rows;
}

// ─── NORMALISE ────────────────────────────────────────────────────────────────

function normaliseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d)) return String(raw).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/*Converts all SKUs to lowercase */
function normaliseSku(raw) {
  return raw ? String(raw).trim().toLowerCase() : null;
}

// ─── DETECT LAYER TYPE ────────────────────────────────────────────────────────
// Does this layer have SKUs? If yes → join by date+sku
// If no → join by date only (like social, reddit)
function hasSku(rows) {
  return rows.some(r => r.sku != null && r.sku !== "");
} 

// ─── INDEX HELPERS ────────────────────────────────────────────────────────────
// For layers WITH sku: key = "date|sku"
function indexByDateSku(rows, layerName) {
  const idx = new Map();
  for (const row of rows) {
    const date = normaliseDate(row.date);
    const sku  = normaliseSku(row.sku);
    const key  = `${date}|${sku}`;
    if (idx.has(key)) {
      idx.set(key, mergeRows(idx.get(key), row));
    } else {
      idx.set(key, { ...row, date, sku });
    }
  }
  return idx;
}

// For layers WITHOUT sku: key = "date", value = array of rows
function indexByDate(rows) {
  const idx = new Map();
  for (const row of rows) {
    const date = normaliseDate(row.date);
    if (!idx.has(date)) idx.set(date, []);
    idx.get(date).push({ ...row, date });
  }
  return idx;
}

// Merge two rows — average numeric fields
function mergeRows(existing, incoming) {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "number" && typeof merged[k] === "number") {
      merged[k] = (merged[k] + v) / 2;
    }
  }
  return merged;
}

// Aggregate date-only rows into a single summary
function aggregateDateLayer(rows) {
  if (!rows || rows.length === 0) return null;

  // Count sentiments
  const sentimentCounts = {};
  for (const r of rows) {
    const s = r.sentiment ?? r.audience_sentiment_split ?? "neutral";
    sentimentCounts[s] = (sentimentCounts[s] ?? 0) + 1;
  }
  const dominantSentiment = Object.entries(sentimentCounts)
    .sort((a, b) => b[1] - a[1])[0][0];

  // Sum numeric fields
  const totals = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "number") {
        totals[k] = (totals[k] ?? 0) + v;
      }
    }
  }

  return {
    ...totals,
    dominant_sentiment: dominantSentiment,
    post_count: rows.length,
    raw_posts: rows,
  };
}

// ─── COMPUTED SIGNALS ─────────────────────────────────────────────────────────

function computeSignals(record) {
  const signals = {};

  const spend   = record.ads?.[BRAND.spend_field]    ?? record.ads?.spend;
  const revenue = record.sales?.[BRAND.revenue_field] ?? record.sales?.revenue;

  if (spend && revenue) {
    signals.true_roas = +(revenue / spend).toFixed(2);
  }

  const maxRating = BRAND.rating_scale ?? 5;
  if (record.customer?.support_tickets && record.customer?.avg_rating != null) {
    signals.cx_risk_score = +(
      (record.customer.support_tickets / 100) *
      ((maxRating - record.customer.avg_rating) / maxRating)
    ).toFixed(2);
  }

  if (record.social?.reach && record.sales?.new_customers) {
    signals.social_to_acq_rate = +(
      (record.sales.new_customers / record.social.reach) * 1000
    ).toFixed(3);
  }

  const socialSentiment   = record.social?.dominant_sentiment;
  const customerSentiment = record.customer?.review_sentiment;
  if (socialSentiment && customerSentiment) {
    signals.sentiment_mismatch = socialSentiment !== customerSentiment;
  }

  if (record.sales?.units_sold && record.sales?.refunds) {
    signals.refund_rate = +(record.sales.refunds / record.sales.units_sold * 100).toFixed(2);
  }

  return signals;
}

// ─── UNIFY ────────────────────────────────────────────────────────────────────

function unify(allLayers) {
  console.log("\n[unify] Building indexes...");

  const skuLayers  = {};   // layers with SKU → join by date+sku
  const dateLayers = {};   // layers without SKU → join by date only

  // Sorts layers into skuLayers vs dateLayers based on presence of SKU field.
  for (const [layerName, rows] of Object.entries(allLayers)) {
    if (hasSku(rows)) {
      skuLayers[layerName]  = indexByDateSku(rows, layerName);
    } else {
      dateLayers[layerName] = indexByDate(rows);
    }
  }
  /*
  SKU Layers
-----------
sales
ads
eg: Map(
  "2024-01-01|onion-100" => {
    date: "2024-01-01",
    sku: "onion-100",
    revenue: 10000
  }
)

Date-only Layers
----------------
social

eg: Map(
  "2024-01-01" => [
    {
      date: "2024-01-01",
      reach: 50000
    }
  ]
)
   */

  console.log(`[unify] SKU layers: ${Object.keys(skuLayers).join(", ")}`);
  console.log(`[unify] Date-only layers: ${Object.keys(dateLayers).join(", ")}`);

  // Canonical key space = union of all date|sku keys from sku layers
  const allKeys = new Set();
  for (const idx of Object.values(skuLayers)) {
    for (const key of idx.keys()) allKeys.add(key);
  }

  console.log(`[unify] ${allKeys.size} unique (date × sku) combinations`);

  const unified = [];

  for (const key of allKeys) {
    const [date, sku] = key.split("|");

    const record = { _id: key, date, sku };

    // Add SKU layers
    for (const [layerName, idx] of Object.entries(skuLayers)) {
      const row = idx.get(key) ?? null;
      record[layerName] = row ? omit(row, ["date", "sku", "_layer"]) : null;
    }

    // Add date-only layers
    for (const [layerName, idx] of Object.entries(dateLayers)) {
      const rows = idx.get(date) ?? [];
      record[layerName] = aggregateDateLayer(rows);
    }

    // Track which layers are present
    const layersPresent = Object.keys(allLayers).filter(l => record[l] != null);
    record._provenance = { layers_present: layersPresent };

    // Compute signals
    record._signals = computeSignals(record);

    unified.push(record);
  }

  unified.sort((a, b) => a.date.localeCompare(b.date));
  return unified;
}

function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

// ─── STATS ────────────────────────────────────────────────────────────────────

function printStats(unified, allLayers) {
  console.log("\n── Unified dataset stats ──────────────────────────────");
  console.log(`  Total records : ${unified.length}`);
  console.log(`  Layers found  : ${Object.keys(allLayers).join(", ")}`);
  const skus = [...new Set(unified.map(r => r.sku).filter(Boolean))];
  console.log(`  Unique SKUs   : ${skus.length}`);
  console.log(`  Date range    : ${unified[0]?.date} → ${unified[unified.length-1]?.date}`);
  console.log("───────────────────────────────────────────────────────\n");
}

// ─── PROVENANCE ───────────────────────────────────────────────────────────────

function writeProvenance(unified, allLayers) {
  const md = `# Data Provenance — ${BRAND.brand_name}

Generated: ${new Date().toISOString()}

## Layers ingested
${Object.keys(allLayers).map(l => `- ${l}`).join("\n")}

## Join strategy
- SKU layers (${Object.keys(allLayers).filter(l => hasSku(allLayers[l])).join(", ")}): joined by date + SKU
- Date-only layers (${Object.keys(allLayers).filter(l => !hasSku(allLayers[l])).join(", ")}): joined by date only

## Output
- Total unified records: ${unified.length}
- Fully joined records: ${unified.filter(r => r._provenance.layers_present.length === Object.keys(allLayers).length).length}
`;
  fs.writeFileSync(PROV_FILE, md, "utf8");
  console.log(`[provenance] Written → ${PROV_FILE}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

console.log(`\n=== ${BRAND.brand_name} ingest.js ===\n`); 
console.log("[load] Reading source files...");

// Load all layers dynamically
const allLayers = {};
for (const filename of layerFiles) {
  const layerName = filename.replace(".json", "");
  allLayers[layerName] = loadLayer(filename);
}

/* 
allLayers = {
  sales: [
    {
      date: "2024-01-01",
      sku: "ONION-100",
      revenue: 10000
    }
  ],
  ads: [
    {
      date: "2024-01-01",
      sku: "ONION-100",
      spend: 2000
    }
  ],
  social: [
    {
      date: "2024-01-01",
      reach: 50000
    }
  ]
}

*/

const unified = unify(allLayers);

printStats(unified, allLayers);

fs.writeFileSync(OUT_FILE, JSON.stringify(unified, null, 2), "utf8");
console.log(`[output] Written → ${OUT_FILE} (${unified.length} records)`);

writeProvenance(unified, allLayers);
console.log("\nDone. ✓");


/*
FLOW:

START
 │
 ▼
Read brand.config.json
 │
 ▼
Find all JSON files
 │
 ▼
Load every JSON file
 │
 ▼
Store in allLayers
 │
 ▼
unify(allLayers)
 │
 ├─ Detect SKU layers
 │
 ├─ Detect date-only layers
 │
 ├─ Build SKU indexes
 │
 ├─ Build date indexes
 │
 ├─ Build master key list
 │
 ├─ For each key:
 │      │
 │      ├─ Create empty record
 │      │
 │      ├─ Attach sales
 │      │
 │      ├─ Attach ads
 │      │
 │      ├─ Attach customer
 │      │
 │      ├─ Attach social
 │      │
 │      ├─ Compute signals
 │      │
 │      └─ Add provenance
 │
 └─ Return unified array
 │
 ▼
printStats()
 │
 ▼
Write unified_data.json
 │
 ▼
writeProvenance()
 │
 ▼
Write data_provenance.md
 │
 ▼
DONE
*/