import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const LLM_PROVIDER = process.env.LLM_PROVIDER ?? "openai";

const LLM_CONFIG = {
  openai: {
    url:   "https://api.openai.com/v1/chat/completions",
    key:   process.env.OPENAI_API_KEY,
    model: "gpt-4o",
    getHeaders: (key) => ({
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${key}`,
    }),
    getBody: (model, max_tokens, messages) => ({
      model, max_tokens, messages,
    }),
    getReply: (data) => data.choices[0].message.content,
  },
  anthropic: {
    url:   "https://api.anthropic.com/v1/messages",
    key:   process.env.ANTHROPIC_API_KEY,
    model: "claude-sonnet-4-20250514",
    getHeaders: (key) => ({
      "Content-Type":      "application/json",
      "x-api-key":         key,
      "anthropic-version": "2023-06-01",
    }),
    getBody: (model, max_tokens, messages) => ({
      model,
      max_tokens,
      system:   messages.find(m => m.role === "system")?.content ?? "",
      messages: messages.filter(m => m.role !== "system"),
    }),
    getReply: (data) => data.content[0].text,
  },
};

const llm = LLM_CONFIG[LLM_PROVIDER] ?? LLM_CONFIG.openai;
console.log(`[llm] Provider: ${LLM_PROVIDER} | Model: ${llm.model}`);

export async function callLLM(max_tokens, messages) {
  const response = await fetch(llm.url, {
    method:  "POST",
    headers: llm.getHeaders(llm.key),
    body:    JSON.stringify(llm.getBody(llm.model, max_tokens, messages)),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return llm.getReply(data);
}