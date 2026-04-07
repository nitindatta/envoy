"use strict";

const DEFAULT_BASE_URL = process.env.OPENAI_COMPAT_BASE_URL || process.env.OPENAI_BASE_URL || "http://127.0.0.1:8123/v1";
const DEFAULT_API_KEY = process.env.OPENAI_COMPAT_API_KEY || process.env.OPENAI_API_KEY || "local-dev-key";
const DEFAULT_MODEL = process.env.OPENAI_COMPAT_MODEL || process.env.OPENAI_MODEL || "gpt-5.4";

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveConfig(overrides = {}) {
  return {
    baseUrl: stripTrailingSlash(overrides.baseUrl || DEFAULT_BASE_URL),
    apiKey: overrides.apiKey || DEFAULT_API_KEY,
    model: overrides.model || DEFAULT_MODEL
  };
}

function buildResponseFormat(name, schema) {
  return {
    type: "json_schema",
    json_schema: {
      name,
      schema,
      strict: true
    }
  };
}

async function requestStructuredJson({
  prompt,
  schema,
  schemaName,
  systemPrompt = "Return only valid JSON that matches the provided response schema.",
  temperature = 0.2,
  config = {}
}) {
  const resolved = resolveConfig(config);
  const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolved.apiKey}`
    },
    body: JSON.stringify({
      model: resolved.model,
      temperature,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: buildResponseFormat(schemaName, schema)
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage = payload?.error?.message || payload?.message || `ChatGPT API request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("ChatGPT API completed without returning assistant JSON content.");
  }

  return {
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    raw: payload,
    text: content,
    parsed: JSON.parse(content)
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_API_KEY,
  DEFAULT_MODEL,
  resolveConfig,
  buildResponseFormat,
  requestStructuredJson
};
