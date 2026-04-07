"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../src/job_assistant_core");
const codexCli = require("../../src/generators/codex_cli");

const profile = core.loadProfile(core.DEFAULT_PROFILE);

function sampleReview() {
  return {
    id: "sample-review",
    provider: "upwork",
    sourceTitle: "Senior Solutions Architect: End-to-End AI Automation",
    jobUrl: "https://www.upwork.com/jobs/example",
    connectsRequired: 22,
    fit: core.scoreJob(
      "Build a Fillout to Gemini to SuiteDash automation workflow with auth and report delivery.",
      profile
    ),
    focusTerms: ["Fillout", "Gemini", "SuiteDash"],
    proposal: "Existing heuristic proposal",
    jobText: `
Build a Fillout -> Gemini -> SuiteDash workflow.
Need strong authentication, service account handling, and scalable report delivery.
    `.trim()
  };
}

test("buildPromptPayload includes structured grounding context", () => {
  const payload = codexCli.buildPromptPayload(sampleReview(), profile);

  assert.equal(payload.provider, "upwork");
  assert.equal(payload.connectsRequired, 22);
  assert.ok(Array.isArray(payload.extractedRequirements));
  assert.ok(Array.isArray(payload.extractedSkills));
  assert.ok(Array.isArray(payload.extractedConstraints));
  assert.equal(payload.profile.name, profile.name);
});

test("buildPrompt includes instruction block and input JSON", () => {
  const prompt = codexCli.buildPrompt(sampleReview(), profile);

  assert.match(prompt, /grounded Upwork proposal/i);
  assert.match(prompt, /Return JSON matching the provided schema/i);
  assert.match(prompt, /Do not invent skills, clients, employers, or project outcomes/i);
  assert.match(prompt, /INPUT JSON:/);
  assert.match(prompt, /SuiteDash/);
});

test("buildSeekQuestionPrompt includes confidence guidance and australia work-rights context", () => {
  const seekReview = {
    ...sampleReview(),
    provider: "seek",
    id: "seek-review",
    sourceTitle: "Senior Data Engineer",
    jobUrl: "https://www.seek.com.au/job/123",
    proposal: "Cover letter draft"
  };

  const { prompt, payload } = codexCli.buildSeekQuestionPrompt({
    label: "Do you have the right to work in Australia?",
    type: "radio"
  }, seekReview, profile);

  assert.equal(payload.provider, "seek");
  assert.match(prompt, /SEEK application question/i);
  assert.match(prompt, /confidence as high only/i);
  assert.match(prompt, /permanent residency/i);
});
