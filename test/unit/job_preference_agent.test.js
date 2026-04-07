"use strict";

const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const preferenceAgent = require("../../src/job_preference_agent");

const originalLabels = fs.existsSync(preferenceAgent.LABELS_FILE)
  ? fs.readFileSync(preferenceAgent.LABELS_FILE, "utf8")
  : null;

test.after(() => {
  if (originalLabels === null) {
    if (fs.existsSync(preferenceAgent.LABELS_FILE)) {
      fs.writeFileSync(preferenceAgent.LABELS_FILE, "", "utf8");
    }
    return;
  }
  fs.writeFileSync(preferenceAgent.LABELS_FILE, originalLabels, "utf8");
});

test.beforeEach(() => {
  fs.writeFileSync(preferenceAgent.LABELS_FILE, "", "utf8");
});

test("annotateJobs boosts applied jobs and filters rejected ones from active view", () => {
  preferenceAgent.labelJob({
    provider: "seek",
    url: "https://www.seek.com.au/job/1",
    title: "Senior Data Engineer",
    summary: "Databricks, Azure, and data platform delivery",
    label: "apply"
  });
  preferenceAgent.labelJob({
    provider: "upwork",
    url: "https://www.upwork.com/jobs/2",
    title: "WordPress Site Tweaks",
    summary: "Basic WordPress and landing page cleanup",
    label: "reject",
    reason: "Too frontend"
  });

  const jobs = preferenceAgent.annotateJobs([
    {
      provider: "seek",
      url: "https://www.seek.com.au/job/1",
      title: "Senior Data Engineer",
      summary: "Azure data platform role"
    },
    {
      provider: "upwork",
      url: "https://www.upwork.com/jobs/2",
      title: "WordPress Site Tweaks",
      summary: "Basic WordPress role"
    }
  ]);

  assert.equal(jobs[0].url, "https://www.seek.com.au/job/1");
  assert.equal(jobs[0].lifecycle, "apply");
  assert.equal(jobs[1].lifecycle, "reject");
  assert.equal(preferenceAgent.filterJobs(jobs, "active").length, 1);
  assert.equal(preferenceAgent.filterJobs(jobs, "rejected").length, 1);
});

test("selectedJobs returns latest apply labels per provider", () => {
  preferenceAgent.labelJob({
    provider: "seek",
    url: "https://www.seek.com.au/job/123",
    title: "Lead Data Engineer",
    summary: "Fabric and Databricks",
    label: "apply"
  });
  preferenceAgent.labelJob({
    provider: "seek",
    url: "https://www.seek.com.au/job/123",
    title: "Lead Data Engineer",
    summary: "Fabric and Databricks",
    label: "submitted"
  });
  preferenceAgent.labelJob({
    provider: "seek",
    url: "https://www.seek.com.au/job/456",
    title: "Principal Platform Engineer",
    summary: "Azure and architecture",
    label: "apply"
  });

  const selected = preferenceAgent.selectedJobs("seek");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].url, "https://www.seek.com.au/job/456");
});
