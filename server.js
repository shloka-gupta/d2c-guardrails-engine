import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
dotenv.config();

import { callLLM } from "./llm.js";
import { brandMemoryExists, layersChanged, getBrandMemory } from "./memory.js";
import { jobs, runPipeline } from "./pipeline.js";

const app = express();
app.use(cors());
app.use(express.json());

// ─── INTENT DETECTION ─────────────────────────────────────────────────────────

async function detectIntent(message, currentBrand) {
  const reply = await callLLM(200, [
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
  ]);

  try {
    return JSON.parse(reply);
  } catch {
    return { intent: "conversational", reply: "I didn't quite get that. Try typing a brand name to get started!" };
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
        reply:  `I already have analysis for ${brand}!\n\n🔴 ${summary.block} blocks  🟡 ${summary.warn} warnings  🟢 ${summary.pass} passes\n\nYou can now:\n→ Ask "what worked?" or "what didn't work?"\n→ Ask "should I launch ads for [product]?"\n→ Type another brand name to switch`,
        action: "loaded",
        brand,
      });
    }

    const jobId = randomUUID();
    jobs[jobId] = { brand, status: "pending", steps: [`🚀 Starting analysis for ${brand}...`], done: false };
    runPipeline(brand, jobId);
    return res.json({
      reply:  `Got it! Analyzing ${brand}. I'll update you as each step completes.`,
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

    const reply = await callLLM(400, [
      {
        role: "system",
        content: `You are a friendly D2C brand advisor for ${currentBrand}.
Use these guardrail rules to evaluate the campaign idea:
${JSON.stringify(rules, null, 2)}

Reply with PASS, WARN, or BLOCK.
Explain in simple plain English — no jargon, no metric names.
Write like you're talking to a brand manager, not an engineer.
Always end with 2-3 bullet points on exactly what to do next.
Keep it under 150 words.`
      },
      ...history,
      { role: "user", content: message }
    ]);

    return res.json({ reply, action: "campaign_result", brand: currentBrand });
  }

  if (intent.intent === "analysis_question") {
    if (!currentBrand) {
      return res.json({ reply: "Which brand are we talking about? Type a brand name first.", action: "ask_brand" });
    }

    const memory = getBrandMemory(currentBrand);

    const reply = await callLLM(400, [
      {
        role: "system",
        content: `You are a D2C brand strategist for ${currentBrand}.
Here is the brand analysis:
${memory.analysis}

Answer the user's question conversationally. Keep it under 150 words. Be specific.`
      },
      ...history,
      { role: "user", content: message }
    ]);

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