"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const client = require("../../src/clients/chatgpt_api_client");

test("resolveConfig prefers explicit overrides", () => {
  const config = client.resolveConfig({
    baseUrl: "http://127.0.0.1:8123/v1/",
    apiKey: "override-key",
    model: "gpt-5.4-mini"
  });

  assert.equal(config.baseUrl, "http://127.0.0.1:8123/v1");
  assert.equal(config.apiKey, "override-key");
  assert.equal(config.model, "gpt-5.4-mini");
});

test("buildResponseFormat produces strict json_schema payload", () => {
  const format = client.buildResponseFormat("sample_schema", {
    type: "object",
    properties: {
      answer: { type: "string" }
    },
    required: ["answer"],
    additionalProperties: false
  });

  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.name, "sample_schema");
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.schema.required[0], "answer");
});
