import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const MEMORY_DIR = "./memory";
fs.mkdirSync(MEMORY_DIR, { recursive: true });

const jobs = {};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function brandMemoryPath(brand) {
  return path.join(MEMORY_DIR, brand.toLowerCase());
}

function brandMemoryExists(brand) {
  const dir = brandMemoryPath(brand);
  return (
    fs.existsSync(path.join(dir, "unified_data.json")) &&
    fs.existsSync(path.join(dir, "findings.json")) &&
    fs.existsSync(path.join(dir, "rules.json"))
  );
}

function getLayersForBrand(brand) {
  const dataDir = `./data/${brand.toLowerCase()}`;
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
    .filter(f => f.endsWith(".json") &&
                 f !== "unified_data.json" &&
                 f !== "data_provenance.md")
    .map(f => f.replace(".json", ""));
}

function layersChanged(brand) {
  const metaPath = path.join(brandMemoryPath(brand), "meta.json");
  if (!fs.existsSync(metaPath)) return true;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const currentLayers = getLayersForBrand(brand).sort().join(",");
  const savedLayers   = (meta.layers_included ?? []).sort().join(",");
  return currentLayers !== savedLayers;
}

function getBrandMemory(brand) {
  const dir = brandMemoryPath(brand);
  return {
    findings: JSON.parse(fs.readFileSync(path.join(dir, "findings.json"), "utf8")),
    rules:    JSON.parse(fs.readFileSync(path.join(dir, "rules.json"),    "utf8")),
    analysis: fs.readFileSync(path.join(dir, "brand_analysis.md"), "utf8"),
    meta:     JSON.parse(fs.readFileSync(path.join(dir, "meta.json"),     "utf8")),
  };
}

// ─── INTENT DETECTION ─────────────────────────────────────────────────────────

async function detectIntent(message, currentBrand) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:      "gpt-4o",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are an intent detector for a D2C brand analysis engine.
Classify the user message into exactly one of these intents:
- brand_request: user mentions ANY company or brand name, even just a single word like "Mamaearth", "Nykaa", "Nike". If it looks like a brand or company name, always classify as brand_request.
- campaign_question: user wants to validate a campaign or launch idea (extract sku if mentioned)
- analysis_question: user asks about brand performance, what worked, findings
- conversational: ONLY for greetings, off-topic messages, nonsense, or abuse. NOT for brand names.

When in doubt between brand_request and conversational, always pick brand_request.

Return ONLY valid JSON. No explanation. No markdown.
Schema:
{
  "intent": "brand_request" | "campaign_question" | "analysis_question" | "conversational",
  "brand": string | null,
  "sku": string | null,
  "reply": string | null
}

For conversational intent, fill "reply" with a friendly redirect message.
Current active brand: ${currentBrand ?? "none"}`
        },
        { role: "user", content: message }
      ],
    }),
  });

  const data = await response.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { intent: "conversational", reply: "I didn't quite get that. Try typing a brand name to get started!" };
  }
}

// ─── PIPELINE ─────────────────────────────────────────────────────────────────

async function generateBrandData(brand, jobId, missingFiles = ["social.json", "sales.json", "customers.json", "ads.json"]) {
  jobs[jobId].steps.push(`⏳ Generating missing data: ${missingFiles.join(", ")}...`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:      "gpt-4o",
      max_tokens: 4000,
      messages: [
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
      ],
    }),
  });

  const data    = await response.json();
  if (data.error) throw new Error(data.error.message);
  const content = data.choices[0].message.content;
  const parsed  = JSON.parse(content);

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
      fs.writeFileSync(
        path.join(dataDir, fileName),
        JSON.stringify(fileMap[fileName], null, 2)
      );
    }
  }

  jobs[jobId].steps[jobs[jobId].steps.length - 1] = `✅ Generated: ${missingFiles.join(", ")}`;
}

function runScript(script, jobId, label, extraEnv = {}) {
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

async function generateRules(brand, jobId, findingsPath) {
  jobs[jobId].steps.push("⏳ Generating guardrails...");

  const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8"));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:      "gpt-4o",
      max_tokens: 3000,
      messages: [
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
      ],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  if (!data.choices?.[0]) throw new Error(`OpenAI returned no choices: ${JSON.stringify(data)}`);

  const rules     = JSON.parse(data.choices[0].message.content);
  const rulesPath = path.join(brandMemoryPath(brand), "rules.json");
  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));

  jobs[jobId].steps[jobs[jobId].steps.length - 1] = "✅ Guardrails generated";
  return rules;
}

async function saveBrandMemory(brand, jobId, rules, brandDataDir, findingsPath, analysisPath) {
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

async function runPipeline(brand, jobId) {
  try {
    jobs[jobId].status = "running";

    const brandDir     = brandMemoryPath(brand);
    const brandDataDir = `./data/${brand.toLowerCase()}`;
    fs.mkdirSync(brandDir,     { recursive: true });
    fs.mkdirSync(brandDataDir, { recursive: true });

    // Per-brand config — no more shared brand.config.json
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

    // Check what files exist on disk
    const coreFiles      = ["social.json", "sales.json", "customers.json", "ads.json"];
    const allFilesOnDisk = fs.readdirSync(brandDataDir)
      .filter(f => f.endsWith(".json") && f !== "unified_data.json");

    const missingFiles = coreFiles.filter(f =>
      !fs.existsSync(path.join(brandDataDir, f))
    );

    // Check for new layers since last memory save
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

    // Pass brand-specific paths to all scripts
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

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.post("/chat", async (req, res) => {
  const { message, brand: currentBrand, history = [] } = req.body;

  const intent = await detectIntent(message, currentBrand);

  if (intent.intent === "conversational") {
    return res.json({
      reply:  intent.reply ?? "I'm a D2C brand analysis engine. Type a brand name to get started!",
      action: "conversational",
    });
  }

  if (intent.intent === "brand_request") {
    const brand = intent.brand;

    if (brandMemoryExists(brand) && !layersChanged(brand)) {
      const memory  = getBrandMemory(brand);
      const summary = memory.findings.summary;
      return res.json({
        reply:  `I already have analysis for **${brand}**!\n\n🔴 ${summary.block} blocks  🟡 ${summary.warn} warnings  🟢 ${summary.pass} passes\n\nAsk me anything about this brand or test a campaign idea.`,
        action: "loaded",
        brand,
      });
    }

    const jobId = randomUUID();
    jobs[jobId] = { brand, status: "pending", steps: [`🚀 Starting analysis for ${brand}...`], done: false };
    runPipeline(brand, jobId);
    return res.json({
      reply:  `Got it! Analyzing **${brand}**. I'll update you as each step completes.`,
      action: "pipeline_started",
      jobId,
      brand,
    });
  }

  if (intent.intent === "campaign_question") {
    if (!currentBrand) {
      return res.json({ reply: "Which brand are we talking about? Type a brand name first.", action: "ask_brand" });
    }

    const memory = getBrandMemory(currentBrand);
    const rules  = memory.rules.rules ?? [];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:      "gpt-4o",
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content: `You are a D2C brand strategist for ${currentBrand}.
Use these guardrail rules to evaluate the campaign idea:
${JSON.stringify(rules, null, 2)}

Reply with PASS, WARN, or BLOCK and clear reasoning.
Reference specific rule IDs. Keep it under 150 words. Be direct.`
          },
          ...history,
          { role: "user", content: message }
        ],
      }),
    });

    const data  = await response.json();
    const reply = data.choices[0].message.content;
    return res.json({ reply, action: "campaign_result", brand: currentBrand });
  }

  if (intent.intent === "analysis_question") {
    if (!currentBrand) {
      return res.json({ reply: "Which brand are we talking about? Type a brand name first.", action: "ask_brand" });
    }

    const memory = getBrandMemory(currentBrand);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:      "gpt-4o",
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content: `You are a D2C brand strategist for ${currentBrand}.
Here is the brand analysis:
${memory.analysis}

Answer the user's question conversationally. Keep it under 150 words. Be specific.`
          },
          ...history,
          { role: "user", content: message }
        ],
      }),
    });

    const data  = await response.json();
    const reply = data.choices[0].message.content;
    return res.json({ reply, action: "analysis_result", brand: currentBrand });
  }
});

app.get("/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });

  let summary = null;
  if (job.done && job.status === "done") {
    try {
      const memory = getBrandMemory(job.brand);
      summary = memory.findings.summary;
    } catch {
      summary = null;
    }
  }

  res.json({
    jobId:  req.params.jobId,
    brand:  job.brand,
    status: job.status,
    steps:  job.steps,
    done:   job.done,
    error:  job.error ?? null,
    summary,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
 console.log(`\n🚀 Server running on port ${PORT}`);
  console.log("POST /chat       — main chat route");
  console.log("GET  /status/:id — poll pipeline progress\n");
});