"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../src/job_assistant_core");

const profile = core.loadProfile(core.DEFAULT_PROFILE);

test("isJobAvailable ignores legitimate Cloudflare technology mentions", () => {
  const jobText = `
Senior platform engineer needed to own our Cloudflare API gateway,
Workers routing, caching, and observability stack.
  `.trim();

  assert.equal(core.isJobAvailable(jobText), true);
});

test("isJobAvailable flags real interstitial text", () => {
  const jobText = `
Just a moment...
Cloudflare Ray ID: 123abc
Verify you are human
  `.trim();

  assert.equal(core.isJobAvailable(jobText), false);
});

test("buildDraft preserves provided connectsRequired metadata", () => {
  const jobText = `
Senior Solutions Architect
Build an end-to-end AI automation workflow using Fillout, Gemini, and SuiteDash.
This proposal requires 16 Connects.
  `.trim();

  const draft = core.buildDraft("solutions-architect", jobText, profile, {
    provider: "upwork",
    connectsRequired: 27
  });

  assert.equal(draft.connectsRequired, 27);
  assert.match(draft.packet, /Connects required: 27/);
});

test("buildUpworkProposal stays grounded in the job brief", () => {
  const jobText = `
Senior Solutions Architect
Build an end-to-end AI automation workflow using Fillout, Gemini 3, and SuiteDash.
You will design authentication, service account access, and a scalable report delivery workflow.
  `.trim();

  const fit = core.scoreJob(jobText, profile);
  const proposal = core.buildUpworkProposal(jobText, profile, fit);

  assert.match(proposal, /Fillout|Gemini 3|SuiteDash/);
  assert.match(proposal, /authentication|service account|report delivery/i);
});
