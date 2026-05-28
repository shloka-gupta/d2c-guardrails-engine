/**
 * validator.js — Guardrails Validator
 *
 * Reads rules.json, takes a hypothetical campaign/launch as input,
 * checks every rule, returns pass / warn / block with reasoning.
 *
 * Run:  node guardrails/validator.js
 *       node guardrails/validator.js --campaign=./my_campaign.json
 */

import fs from "fs";

const RULES_FILE = "./guardrails/rules.json";

// ─── LOAD RULES ───────────────────────────────────────────────────────────────

const { rules } = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));

// ─── SAMPLE CAMPAIGNS ─────────────────────────────────────────────────────────
// If no --campaign flag, we run three built-in hypotheticals to demo the engine.
// Format mirrors what the UI will POST to the validator.

const SAMPLE_CAMPAIGNS = [

  {
    _name: "Shade Correction Cream relaunch (should BLOCK)",
    sku: "Shade Correction Cream",
    type: "campaign_launch",
    cx_risk_score       : 0.96,
    "customer.support_tickets": 218,
    "customer.avg_rating"     : 2.8,
    "customer.nps"            : 21,
    "customer.review_sentiment": "negative",
    "ads.status"              : "active",
    "ads.roas"                : 0.8,
    refund_rate               : 26.0,
    sentiment_mismatch        : false,
    health_score              : 1,
    "social.reach"            : 310000,
    inventory_confirmed       : false,
    platform_roas_to_true_roas_ratio: 0.08,
    social_to_acq_rate        : 2.6,
  },

  {
    _name: "Onion Hair Oil scale-up (should PASS with warnings)",
    sku: "Onion Hair Oil",
    type: "campaign_launch",
    cx_risk_score       : 0.12,
    "customer.support_tickets": 84,
    "customer.avg_rating"     : 4.3,
    "customer.nps"            : 61,
    "customer.review_sentiment": "positive",
    "ads.status"              : "active",
    "ads.roas"                : 3.8,
    refund_rate               : 1.88,
    sentiment_mismatch        : false,
    health_score              : 5,
    "social.reach"            : 310000,
    inventory_confirmed       : true,
    platform_roas_to_true_roas_ratio: 0.07,
    social_to_acq_rate        : 10.3,
  },

  {
    _name: "New Vitamin C Night Cream launch (mixed signals)",
    sku: "Vitamin C Night Cream",
    type: "product_launch",
    cx_risk_score       : 0.4,
    "customer.support_tickets": 120,
    "customer.avg_rating"     : 3.8,
    "customer.nps"            : 47,
    "customer.review_sentiment": "mixed",
    "ads.status"              : "active",
    "ads.roas"                : 2.1,
    refund_rate               : 4.2,
    sentiment_mismatch        : true,
    health_score              : 2,
    "social.reach"            : 85000,
    inventory_confirmed       : true,
    platform_roas_to_true_roas_ratio: 0.15,
    social_to_acq_rate        : 7.0,
  },

];

// ─── EVALUATOR ────────────────────────────────────────────────────────────────

/**
 * Evaluates a single rule against a campaign object.
 * Returns { fired: bool, result: "block"|"warn"|"pass", reason }
 */
function evaluateRule(rule, campaign) {
  const { condition, severity, reason, name, id } = rule;

  // Get the value from the campaign using the metric path
  const value = campaign[condition.metric];

  // If the metric isn't present in the campaign, skip this rule
  if (value === undefined || value === null) {
    return { fired: false, result: "pass", ruleId: id, ruleName: name };
  }

  // Check primary condition
  let primaryFired = false;
  switch (condition.operator) {
    case "gt" : primaryFired = value >  condition.threshold; break;
    case "lt" : primaryFired = value <  condition.threshold; break;
    case "eq" : primaryFired = value === condition.threshold; break;
    case "gte": primaryFired = value >= condition.threshold; break;
    case "lte": primaryFired = value <= condition.threshold; break;
    default   : primaryFired = false;
  }

  // Check secondary condition if present (also_requires)
  let secondaryFired = true;
  if (condition.also_requires && primaryFired) {
    const secVal = campaign[condition.also_requires.metric];
    if (secVal !== undefined) {
      if (condition.also_requires.equals !== undefined) {
        secondaryFired = secVal === condition.also_requires.equals;
      } else if (condition.also_requires.operator === "gt") {
        secondaryFired = secVal > condition.also_requires.value;
      }
    } else {
      secondaryFired = false; // metric not present, don't fire
    }
  }

  const fired = primaryFired && secondaryFired;

  return {
    fired,
    result  : fired ? severity : "pass",
    ruleId  : id,
    ruleName: name,
    metric  : condition.metric,
    value,
    threshold: condition.threshold,
    reason  : fired ? reason : null,
  };
}

/**
 * Validates a full campaign against all rules.
 * Returns overall verdict + per-rule breakdown.
 */
function validate(campaign) {
  const results = rules
    .filter(r => r.category === campaign.type || r.category === "campaign_launch") // always include campaign rules
    .map(r => evaluateRule(r, campaign));

  const fired   = results.filter(r => r.fired);
  const blocks  = fired.filter(r => r.result === "block");
  const warns   = fired.filter(r => r.result === "warn");

  // Overall verdict: worst severity wins
  let verdict = "pass";
  if (warns.length  > 0) verdict = "warn";
  if (blocks.length > 0) verdict = "block";

  return { verdict, blocks, warns, all: results, campaign };
}

// ─── PRINT RESULT ─────────────────────────────────────────────────────────────

const icons    = { block: "🔴 BLOCK", warn: "🟡 WARN", pass: "🟢 PASS" };
const divider  = "─".repeat(60);

function printResult(result) {
  const { verdict, blocks, warns, campaign } = result;

  console.log(`\n${divider}`);
  console.log(`Campaign : ${campaign._name}`);
  console.log(`SKU      : ${campaign.sku}`);
  console.log(`Type     : ${campaign.type}`);
  console.log(`Verdict  : ${icons[verdict]}`);
  console.log(divider);

  if (blocks.length > 0) {
    console.log("\n🔴 BLOCKING RULES FIRED:");
    blocks.forEach(r => {
      console.log(`\n  [${r.ruleId}] ${r.ruleName}`);
      console.log(`  Metric: ${r.metric} = ${r.value} (threshold: ${r.threshold})`);
      console.log(`  Reason: ${r.reason}`);
    });
  }

  if (warns.length > 0) {
    console.log("\n🟡 WARNINGS:");
    warns.forEach(r => {
      console.log(`\n  [${r.ruleId}] ${r.ruleName}`);
      console.log(`  Metric: ${r.metric} = ${r.value} (threshold: ${r.threshold})`);
      console.log(`  Reason: ${r.reason}`);
    });
  }

  if (verdict === "pass") {
    console.log("\n  ✓ All rules passed. Campaign cleared for launch.");
  }

  console.log("");
}

// ─── LOAD CUSTOM CAMPAIGN OR RUN SAMPLES ─────────────────────────────────────

const campaignArg = process.argv.find(a => a.startsWith("--campaign="));

if (campaignArg) {
  const campaignPath = campaignArg.split("=")[1];
  const campaign     = JSON.parse(fs.readFileSync(campaignPath, "utf8"));
  console.log(`\n=== Guardrails Validator ===`);
  console.log(`Checking: ${campaignPath}`);
  printResult(validate(campaign));
} else {
  console.log(`\n=== Guardrails Validator — Running 3 sample campaigns ===`);
  SAMPLE_CAMPAIGNS.forEach(c => printResult(validate(c)));
}

// ─── EXPORT for UI ────────────────────────────────────────────────────────────
export { validate, rules };