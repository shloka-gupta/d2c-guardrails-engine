import fs   from "fs";
import path from "path";
import { spawn } from "child_process";
import { callLLM } from "./llm.js";
import { brandMemoryPath, getLayersForBrand } from "./memory.js";

export const jobs = {};

// ─── GENERATE BRAND DATA ──────────────────────────────────────────────────────

export async function generateBrandData(brand, jobId, missingFiles = ["social.json", "sales.json", "customers.json", "ads.json"]) {
  jobs[jobId].steps.push(`⏳ Generating missing data: ${missingFiles.join(", ")}...`);

  const reply = await callLLM(4000, [
    {
      role: "system",
      content: `You are a D2C data synthesizer. Generate realistic data for a brand.
Return ONLY a valid JSON object with this exact structure. No markdown. No explanation.
{
  "social": { "brand": string, "layer": "social", "period": "2023-Q3", "data": [...8 rows] },
  "sales":  { "brand": string, "layer": "sales",  "period": "2023-Q3", "data": [...8 rows] },
  "customers": { "brand": string, "layer": "customers", "period": "2023-Q3", "data": [...8 rows] },
  "ads": { "brand": string, "layer": "ads", "period": "2023-Q3", "data": [...8 rows] }
}

Each social row: { date, platform, post_type, topic, likes, comments, shares, reach, sentiment }
Each sales row: { date, sku, units_sold, revenue_inr, channel, refunds, new_customers }
Each customers row: { date, sku, support_tickets, avg_rating, nps, top_complaint, review_sentiment }
Each ads row: { date, sku, spend_inr, clicks, impressions, roas, ctr, campaign_type, status }

Make the data internally consistent and realistic for the brand.
Include at least one crisis scenario (high tickets, low rating, ads still running).
Dates should be in 2023-Q3 (July-September 2023).
CRITICAL: ads status must be lowercase "active" or "paused".
CRITICAL: review_sentiment must be lowercase "positive", "negative", or "neutral".
CRITICAL DATE RULE: Each SKU must appear on the SAME dates across all 4 layers.`
    },
    {
      role: "user",
      content: `Generate realistic synthesized data for: ${brand}.
Use real product names, actual known controversies, and realistic metrics specific to this brand.
Do NOT use generic placeholder names.`
    }
  ]);

  const parsed  = JSON.parse(reply);
  const dataDir = `./data/${brand.toLowerCase()}`;
  fs.mkdirSync(dataDir, { recursive: true });

  const fileMap = {
    "social.json":    parsed.social,
    "sales.json":     parsed.sales,
    "customers.json": parsed.customers,
    "ads.json":       parsed.ads,
  };

  for (const fileName of missingFiles) {
    if (fileMap[fileName]) {
      fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(fileMap[fileName], null, 2));
    }
  }

  jobs[jobId].steps[jobs[jobId].steps.length - 1] = `✅ Generated: ${missingFiles.join(", ")}`;
}

// ─── RUN SCRIPT ───────────────────────────────────────────────────────────────

export function runScript(script, jobId, label, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    jobs[jobId].steps.push(`⏳ ${label}...`);
    const idx  = jobs[jobId].steps.length - 1;
    const proc = spawn("node", [script], {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
    });

    proc.stderr.on("data", d => process.stderr.write(d));

    proc.on("close", code => {
      if (code === 0) {
        jobs[jobId].steps[idx] = `✅ ${label}`;
        resolve();
      } else {
        jobs[jobId].steps[idx] = `❌ ${label} failed`;
        reject(new Error(`${script} exited with code ${code}`));
      }
    });
  });
}

// ─── GENERATE RULES ───────────────────────────────────────────────────────────

export async function generateRules(brand, jobId, findingsPath) {
  jobs[jobId].steps.push("⏳ Generating guardrails...");

  const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8"));

  const reply = await callLLM(3000, [
    {
      role: "system",
      content: `You are a guardrails rule generator for D2C brands.
Given correlation findings, generate 12+ guardrail rules.
Return ONLY valid JSON. No markdown. No explanation.
Schema:
{
  "schema_version": "1.0",
  "brand": string,
  "rules": [
    {
      "id": "GR-001",
      "name": string,
      "category": "campaign_launch" | "product_launch" | "customer_interaction",
      "severity": "block" | "warn",
      "derived_from": string,
      "condition": {
        "metric": string,
        "operator": "gt" | "lt" | "eq",
        "threshold": number | string | boolean
      },
      "reason": string
    }
  ]
}
CRITICAL: Only use these metrics in conditions:
cx_risk_score, customer.support_tickets, customer.avg_rating, customer.nps,
customer.review_sentiment, ads.roas, ads.status, refund_rate, sentiment_mismatch,
health_score, social.reach, social_to_acq_rate, platform_roas_to_true_roas_ratio,
inventory_confirmed`
    },
    {
      role: "user",
      content: `Brand: ${brand}\n\nIMPORTANT: The "brand" field must be exactly "${brand}".\n\nHere are representative findings (sampled):\n${JSON.stringify({
        blocks: findings.findings.filter(f => f.severity === "block").slice(0, 3),
        warns:  findings.findings.filter(f => f.severity === "warn").slice(0, 5),
        passes: findings.findings.filter(f => f.severity === "pass").slice(0, 3),
      }, null, 2)}`
    }
  ]);

  const rules     = JSON.parse(reply);
  const rulesPath = path.join(brandMemoryPath(brand), "rules.json");
  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));

  jobs[jobId].steps[jobs[jobId].steps.length - 1] = "✅ Guardrails generated";
  return rules;
}

// ─── SAVE BRAND MEMORY ────────────────────────────────────────────────────────

export async function saveBrandMemory(brand, jobId, rules, brandDataDir, findingsPath, analysisPath) {
  jobs[jobId].steps.push("⏳ Saving to memory...");

  const brandDir = brandMemoryPath(brand);
  fs.mkdirSync(brandDir, { recursive: true });

  const filesToSave = [
    { src: path.join(brandDataDir, "unified_data.json"), dst: "unified_data.json" },
    { src: findingsPath,                                  dst: "findings.json"     },
    { src: analysisPath,                                  dst: "brand_analysis.md" },
  ];

  for (const f of filesToSave) {
    if (fs.existsSync(f.src)) {
      fs.copyFileSync(f.src, path.join(brandDir, f.dst));
    } else {
      console.warn(`[memory] Missing file: ${f.src}`);
    }
  }

  const meta = {
    brand,
    analyzed_at:     new Date().toISOString(),
    layers_included: getLayersForBrand(brand),
  };
  fs.writeFileSync(path.join(brandDir, "meta.json"), JSON.stringify(meta, null, 2));

  jobs[jobId].steps[jobs[jobId].steps.length - 1] = "✅ Saved to memory";
}

// ─── RUN PIPELINE ─────────────────────────────────────────────────────────────

export async function runPipeline(brand, jobId) {
  try {
    jobs[jobId].status = "running";

    const brandDir     = brandMemoryPath(brand);
    const brandDataDir = `./data/${brand.toLowerCase()}`;
    fs.mkdirSync(brandDir,     { recursive: true });
    fs.mkdirSync(brandDataDir, { recursive: true });

    const brandConfig = {
      brand_name:       brand,
      ticker:           brand.toUpperCase().slice(0, 6),
      currency:         "INR",
      currency_symbol:  "₹",
      rating_scale:     5,
      revenue_field:    "revenue_inr",
      spend_field:      "spend_inr",
      provenance_notes: `Data for ${brand}. Generated/loaded by pipeline on ${new Date().toISOString()}.`
    };

    const configPath   = path.join(brandDir, "brand.config.json");
    const findingsPath = path.join(brandDir, "findings.json");
    const analysisPath = path.join(brandDir, "brand_analysis.md");

    fs.writeFileSync(configPath, JSON.stringify(brandConfig, null, 2));

    const coreFiles      = ["social.json", "sales.json", "customers.json", "ads.json"];
    const allFilesOnDisk = fs.readdirSync(brandDataDir)
      .filter(f => f.endsWith(".json") && f !== "unified_data.json");

    const missingFiles = coreFiles.filter(f =>
      !fs.existsSync(path.join(brandDataDir, f))
    );

    const metaPath    = path.join(brandDir, "meta.json");
    const savedLayers = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, "utf8")).layers_included ?? []
      : [];
    const currentLayers = allFilesOnDisk.map(f => f.replace(".json", ""));
    const newLayers     = currentLayers.filter(l => !savedLayers.includes(l));

    if (missingFiles.length > 0) {
      await generateBrandData(brand, jobId, missingFiles);
    } else {
      jobs[jobId].steps.push(`✅ All data files found for ${brand}`);
    }

    if (newLayers.length > 0) {
      jobs[jobId].steps.push(`🆕 New layers detected: ${newLayers.join(", ")} — including in pipeline`);
    }

    const brandEnv = {
      DATA_DIR:      brandDataDir,
      BRAND_CONFIG:  configPath,
      FINDINGS_FILE: findingsPath,
      ANALYSIS_FILE: analysisPath,
    };

    await runScript("ingest.js",          jobId, "Unifying data layers",      brandEnv);
    await runScript("agent/correlate.js", jobId, "Running correlation agent", brandEnv);
    const rules = await generateRules(brand, jobId, findingsPath);
    await saveBrandMemory(brand, jobId, rules, brandDataDir, findingsPath, analysisPath);

    jobs[jobId].status = "done";
    jobs[jobId].done   = true;
    jobs[jobId].steps.push("🎉 Pipeline complete!");

  } catch (err) {
    console.error("[pipeline] FULL ERROR:", err);
    jobs[jobId].status = "error";
    jobs[jobId].error  = err.message;
    jobs[jobId].done   = true;
  }
}