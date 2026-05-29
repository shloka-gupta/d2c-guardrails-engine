import fs from "fs";
const SKU_TO_NAME = {
  "ME-ONION-OIL-200":    "Onion Hair Oil 200ml",
  "ME-VITC-WASH-100":    "Vitamin C Face Wash 100ml",
  "ME-ROSEMARY-SHM-250": "Rosemary Anti-Hairfall Shampoo",
  "ME-RICE-WASH-100":    "Rice Water Glass Face Wash",
  "DC-10-NIACIN-30":     "10% Niacinamide Serum 30ml",
  "DC-2-SALYCIL-100":    "2% Salicylic Acid Face Wash",
  "DC-1-HYALU-SUN-50":   "1% Hyaluronic Tinted Sunscreen Gel",
  "AQ-DEW-SUN-50":       "Radiance+ Dewy Sunscreen SPF 50",
  "AQ-HYDRA-GEL-50":     "Hydrate+ Gel Moisturizer",
  "BB-INT-SHAMP-300":    "Intense Moisture Shampoo 300ml",
  "BB-ACT-SPRAY-150":    "Blown Away Volumizing Spray",
};

console.log("Preparing Mamaearth data...\n");

// ── Sales ──────────────────────────────────────────────────────────────────
const rawSales = JSON.parse(fs.readFileSync("./datasets/honasa_sales.json", "utf8"));
const sales = {
  brand: "Mamaearth",
  layer: "sales",
  period: "2023-2026",
  data: rawSales.data.slice(0, 2000).map(r => ({
    date:         r.date,
    sku:          r.product_name,
    units_sold:   r.units_sold,
    revenue_inr:  r.gross_revenue_inr,
    channel:      r.distribution_channel,
    refunds:      r.rto_units,
    new_customers: Math.floor(r.units_sold * 0.3)
  }))
};
fs.writeFileSync("./data/mamaearth/sales.json", JSON.stringify(sales, null, 2));
console.log(`✅ sales.json — ${sales.data.length} rows`);

// ── Ads ────────────────────────────────────────────────────────────────────
const rawAds = JSON.parse(fs.readFileSync("./datasets/honasa_marketing.json", "utf8"));
const ads = {
  brand: "Mamaearth",
  layer: "ads",
  period: "2023-2026",
  data: rawAds.data.slice(0, 2000).map(r => ({
    date:          r.date,
    sku: SKU_TO_NAME[r.sku] ?? r.sku,
    spend_inr:     r.spend_inr,
    clicks:        r.clicks,
    impressions:   r.impressions,
    roas:          r.roas,
    ctr:           r.ctr,
    campaign_type: r.campaign_type,
    status:        "active"
  }))
};
fs.writeFileSync("./data/mamaearth/ads.json", JSON.stringify(ads, null, 2));
console.log(`✅ ads.json — ${ads.data.length} rows`);

// ── Customers ──────────────────────────────────────────────────────────────
const rawCustomers = JSON.parse(fs.readFileSync("./datasets/honasa_customers.json", "utf8"));
const customers = {
  brand: "Mamaearth",
  layer: "customers",
  period: "2023-2026",
  data: rawCustomers.data.slice(0, 2000).map(r => ({
    date:             r.date,
    sku:              SKU_TO_NAME[r.sku] ?? r.sku,
    support_tickets:  r.support_tickets_logged,
    avg_rating:       r.avg_star_rating,
    nps:              Math.floor(r.avg_star_rating * 14),
    top_complaint:    r.top_complaint_reason,
    review_sentiment: r.blended_sentiment
  }))
};
fs.writeFileSync("./data/mamaearth/customers.json", JSON.stringify(customers, null, 2));
console.log(`✅ customers.json — ${customers.data.length} rows`);

// ── Social ─────────────────────────────────────────────────────────────────
const rawSocial = JSON.parse(fs.readFileSync("./datasets/honasa_social.json", "utf8"));
const social = {
  brand: "Mamaearth",
  layer: "social",
  period: "2023-2026",
  data: rawSocial.data.slice(0, 2000).map(r => ({
    date:      r.date,
    platform:  r.platform,
    post_type: r.content_format,
    topic:     r.primary_hashtag,
    likes:     r.metrics.likes,
    comments:  r.metrics.comments,
    shares:    r.metrics.shares,
    reach:     r.metrics.views,
    sentiment: r.audience_sentiment_split
  }))
};
fs.writeFileSync("./data/mamaearth/social.json", JSON.stringify(social, null, 2));
console.log(`✅ social.json — ${social.data.length} rows`);

console.log("\nDone. Ready to run ingest.js");