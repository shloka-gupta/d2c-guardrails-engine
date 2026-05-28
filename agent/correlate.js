/**
 * correlate.js — Cross-layer Correlation Agent + AI Brand Analysis
 */
import dotenv from "dotenv";
dotenv.config();
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const DATA_DIR      = process.env.DATA_DIR ?? "./data";
const DATA_FILE     = `${DATA_DIR}/unified_data.json`;
const FINDINGS_FILE = process.env.FINDINGS_FILE ?? "./agent/findings.json";
const ANALYSIS_FILE = process.env.ANALYSIS_FILE ?? "./analysis/brand_analysis.md";

fs.mkdirSync("./analysis", { recursive: true });

// ─── LOAD ─────────────────────────────────────────────────────────────────────

const allRecords = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const records    = allRecords.slice(0, 500);
const configPath = process.env.BRAND_CONFIG ?? "./brand.config.json";
const BRAND      = JSON.parse(fs.readFileSync(configPath, "utf8"));

console.log(`\n=== Correlation Agent — ${BRAND.brand_name} ===`);
console.log(`Loaded ${allRecords.length} unified records (sampling 500)\n`);

// ─── BASELINES ────────────────────────────────────────────────────────────────

function avg(arr, getter) {
  const vals = arr.map(getter).filter(v => v != null && !isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

const baselines = {
  cx_risk    : avg(records, r => r._signals?.cx_risk_score),
  refund_rate: avg(records, r => r._signals?.refund_rate),
  true_roas  : avg(records, r => r._signals?.true_roas),
  reach      : avg(records, r => r.social?.reach),
  new_cust   : avg(records, r => r.sales?.new_customers),
};

const skuGroups = {};
for (const r of records) {
  if (!r.sku || r._signals?.refund_rate == null) continue;
  if (!skuGroups[r.sku]) skuGroups[r.sku] = [];
  skuGroups[r.sku].push(r._signals.refund_rate);
}
const skuRefundAvg = {};
for (const [sku, rates] of Object.entries(skuGroups)) {
  skuRefundAvg[sku] = rates.reduce((a, b) => a + b, 0) / rates.length;
}

console.log("── Baselines ────────────────────────────────────────────");
Object.entries(baselines).forEach(([k, v]) =>
  console.log(`  ${k.padEnd(12)}: ${v?.toFixed(2) ?? "n/a"}`)
);
console.log("─────────────────────────────────────────────────────────\n");

// ─── THE 6 CHECKS ─────────────────────────────────────────────────────────────

const findings = [];
const icons    = { block: "🔴", warn: "🟡", pass: "🟢" };

// Check 1: Crisis Blindspot
for (const r of records) {
  const cxRisk    = r._signals?.cx_risk_score;
  const adActive  = r.ads?.status?.toLowerCase() === "active";
  const spend     = r.ads?.spend_inr ?? r.ads?.spend_usd ?? r.ads?.spend;
  const threshold = baselines.cx_risk * 2;

  if (cxRisk != null && cxRisk > threshold && adActive) {
    findings.push({
      check   : "Crisis Blindspot",
      severity: cxRisk > threshold * 2 ? "block" : "warn",
      date    : r.date,
      sku     : r.sku,
      detail  : `cx_risk_score is ${cxRisk} (baseline: ${baselines.cx_risk?.toFixed(2)}, threshold: ${threshold?.toFixed(2)}). Ad spend was ${spend?.toLocaleString()} with status "active". Support tickets: ${r.customer?.support_tickets}. Rating: ${r.customer?.avg_rating}.`,
      layers  : ["customer", "ads"],
      numbers : { cx_risk: cxRisk, baseline: baselines.cx_risk, spend },
    });
  }
}

// Check 2: Sentiment Mismatch
for (const r of records) {
  if (r._signals?.sentiment_mismatch === true) {
    findings.push({
      check   : "Sentiment Mismatch",
      severity: "warn",
      date    : r.date,
      sku     : r.sku,
      detail  : `Social sentiment is ${r.social?.dominant_sentiment} but customer review sentiment is ${r.customer?.review_sentiment}. Creator content and real buyer experience are misaligned. Top complaint: "${r.customer?.top_complaint}". NPS: ${r.customer?.nps}.`,
      layers  : ["social", "customer"],
      numbers : { social_sentiment: r.social?.dominant_sentiment, customer_sentiment: r.customer?.review_sentiment, nps: r.customer?.nps },
    });
  }
}

// Check 3: Refund Spike
for (const r of records) {
  const rate      = r._signals?.refund_rate;
  const skuAvg    = skuRefundAvg[r.sku];
  const globalAvg = baselines.refund_rate;

  if (rate != null && skuAvg != null && rate > skuAvg * 2 && rate > globalAvg * 1.5) {
    findings.push({
      check   : "Refund Spike",
      severity: rate > 20 ? "block" : "warn",
      date    : r.date,
      sku     : r.sku,
      detail  : `Refund rate is ${rate}% vs SKU average of ${skuAvg.toFixed(2)}% and global average of ${globalAvg?.toFixed(2)}%. ${r.sales?.refunds} refunds on ${r.sales?.units_sold} units. Top complaint: "${r.customer?.top_complaint ?? "unknown"}".`,
      layers  : ["sales", "customer"],
      numbers : { refund_rate: rate, sku_avg: skuAvg, global_avg: globalAvg, refunds: r.sales?.refunds },
    });
  }
}

// Check 4: ROAS Divergence
for (const r of records) {
  const platformRoas = r.ads?.roas;
  const trueRoas     = r._signals?.true_roas;
  if (platformRoas == null || trueRoas == null) continue;

  const gap   = Math.abs(platformRoas - trueRoas);
  const ratio = trueRoas / platformRoas;

  if (gap > 1.5) {
    findings.push({
      check   : ratio > 1 ? "ROAS Underclaim" : "ROAS Overclaim",
      severity: ratio < 0.5 ? "block" : "warn",
      date    : r.date,
      sku     : r.sku,
      detail  : `Platform reports ROAS of ${platformRoas}x but true ROAS (revenue ÷ spend) is ${trueRoas}x. Gap of ${gap.toFixed(2)}x. ${ratio > 1 ? "Platform is underclaiming — attribution window may be too narrow." : "Platform is overclaiming — scaling on this number would destroy margin."}`,
      layers  : ["ads", "sales"],
      numbers : { platform_roas: platformRoas, true_roas: trueRoas, gap: +gap.toFixed(2), ratio: +ratio.toFixed(2) },
    });
  }
}

// Check 5: Social Lift
for (const r of records) {
  const reach    = r.social?.reach;
  const newCust  = r.sales?.new_customers;
  const liftRate = r._signals?.social_to_acq_rate;

  if (reach == null || newCust == null) continue;

  const highReach = reach > baselines.reach * 1.5;
  const lowAcq    = newCust < baselines.new_cust * 0.7;

  if (highReach && lowAcq) {
    findings.push({
      check   : "Social Lift Failure",
      severity: "warn",
      date    : r.date,
      sku     : r.sku,
      detail  : `High social reach (${reach?.toLocaleString()}) but only ${liftRate} new customers per 1000 reach. Viral content not converting to buyers.`,
      layers  : ["social", "sales"],
      numbers : { reach, new_customers: newCust, social_to_acq_rate: liftRate },
    });
  } else if (reach > baselines.reach && liftRate > 10) {
    findings.push({
      check   : "Social Lift Success",
      severity: "pass",
      date    : r.date,
      sku     : r.sku,
      detail  : `High social reach (${reach?.toLocaleString()}) converted well — ${liftRate} new customers per 1000 reach. Above average acquisition efficiency.`,
      layers  : ["social", "sales"],
      numbers : { reach, new_customers: newCust, social_to_acq_rate: liftRate },
    });
  }
}

// Check 6: Healthy SKU Signal
for (const r of records) {
  const socialOk = r.social?.dominant_sentiment === "positive";
  const cxOk     = r.customer?.review_sentiment === "positive";
  const npsOk    = (r.customer?.nps ?? 0) > 50;
  const roasOk   = (r.ads?.roas ?? 0) > 2.5;
  const unitsOk  = (r.sales?.units_sold ?? 0) > baselines.new_cust * 1.5;
  const score    = [socialOk, cxOk, npsOk, roasOk, unitsOk].filter(Boolean).length;

  if (score >= 4) {
    findings.push({
      check   : "Healthy SKU Signal",
      severity: "pass",
      date    : r.date,
      sku     : r.sku,
      detail  : `All 4 layers positive (${score}/5 signals). Reach: ${r.social?.reach?.toLocaleString()}, Units: ${r.sales?.units_sold?.toLocaleString()}, NPS: ${r.customer?.nps}, Platform ROAS: ${r.ads?.roas}x, True ROAS: ${r._signals?.true_roas}x. This is the winning template to replicate.`,
      layers  : ["social", "sales", "customer", "ads"],
      numbers : { nps: r.customer?.nps, units: r.sales?.units_sold, roas: r.ads?.roas, true_roas: r._signals?.true_roas, health_score: `${score}/5` },
    });
  }
}

// ─── SAVE findings.json ───────────────────────────────────────────────────────

console.log(`── Findings (${findings.length} total) ──────────────────────────────\n`);
findings.slice(0, 10).forEach(f => {
  console.log(`${icons[f.severity] ?? "⚪"} [${f.severity.toUpperCase()}] ${f.check}`);
  console.log(`   ${f.date} | ${f.sku}`);
  console.log(`   ${f.detail}\n`);
});

const output = {
  generated_at: new Date().toISOString(),
  brand       : BRAND.brand_name,
  record_count: allRecords.length,
  sampled     : records.length,
  baselines,
  summary: {
    total: findings.length,
    block: findings.filter(f => f.severity === "block").length,
    warn : findings.filter(f => f.severity === "warn").length,
    pass : findings.filter(f => f.severity === "pass").length,
  },
  findings,
};

fs.writeFileSync(FINDINGS_FILE, JSON.stringify(output, null, 2), "utf8");
console.log(`── Written → ${FINDINGS_FILE}`);
console.log(`   🔴 block: ${output.summary.block}  🟡 warn: ${output.summary.warn}  🟢 pass: ${output.summary.pass}\n`);

// ─── SEND TO AI ───────────────────────────────────────────────────────────────

console.log("[agent] Sending findings to OpenAI for brand analysis...\n");

const sampledFindings = {
  blocks: findings.filter(f => f.severity === "block").slice(0, 5),
  warns : findings.filter(f => f.severity === "warn").slice(0, 10),
  passes: findings.filter(f => f.severity === "pass").slice(0, 5),
};

const prompt = `You are a D2C brand strategist analyzing ${BRAND.brand_name} (${BRAND.ticker}).

Here are representative cross-layer signals (sampled from ${findings.length} total findings across ${allRecords.length} records):

${JSON.stringify(sampledFindings, null, 2)}

Total findings: ${output.summary.block} blocks, ${output.summary.warn} warns, ${output.summary.pass} passes.

Write a concise brand analysis covering:
1. What worked this period (with evidence from the signals)
2. What did not work (with evidence)
3. One non-obvious finding that only becomes visible because all 4 layers are joined
4. Three specific recommendations

Keep it under 500 words. Be direct. Use the signal data as evidence. No fluff.`;

let analysis = "";

try {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method : "POST",
    headers: {
      "Content-Type" : "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model     : "gpt-4o",
      max_tokens: 1000,
      messages  : [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  analysis = data.choices[0].message.content;
  console.log("[agent] Analysis received\n");
  console.log("─".repeat(60));
  console.log(analysis);
  console.log("─".repeat(60));

} catch (err) {
  console.warn(`[agent] AI call failed: ${err.message}`);
  analysis = "_AI analysis unavailable._";
}

// ─── SAVE brand_analysis.md ───────────────────────────────────────────────────

const markdownFindings = [
  ...sampledFindings.blocks,
  ...sampledFindings.warns,
  ...sampledFindings.passes,
];

const markdown = `# ${BRAND.brand_name} Brand Analysis

Generated: ${new Date().toISOString()}
Records analyzed: ${allRecords.length} (sampled ${records.length} for pattern detection)

## Cross-Layer Signals (${markdownFindings.length} representative findings from ${findings.length} total)

${markdownFindings.map(f =>
  `### ${icons[f.severity]} ${f.check}\n- **Date:** ${f.date}\n- **SKU:** ${f.sku}\n- **Severity:** ${f.severity}\n- **Layers:** ${f.layers.join(" + ")}\n- **Detail:** ${f.detail}`
).join("\n\n")}

## AI Analysis

${analysis}
`;

fs.writeFileSync(ANALYSIS_FILE, markdown, "utf8");
console.log(`\n[agent] Saved → ${ANALYSIS_FILE}`);
console.log("\nDone. ✓");