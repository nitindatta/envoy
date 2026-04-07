"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./job_assistant_core");

const LABELS_FILE = path.join(core.AUTOMATION_DIR, "job-labels.jsonl");
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "have", "will", "your", "jobs", "job", "role",
  "work", "team", "using", "into", "about", "more", "than", "need", "looking", "engineer", "developer",
  "senior", "lead", "principal", "platform", "solution", "solutions", "remote", "full", "time", "part",
  "contract", "fixed", "hourly", "apply", "application", "experience"
]);

function ensureStorage() {
  core.ensureDir(core.AUTOMATION_DIR);
}

function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[a-z][a-z0-9+#./-]{2,}/g) || [])
    .filter((token) => !STOPWORDS.has(token));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function loadLabels() {
  ensureStorage();
  if (!fs.existsSync(LABELS_FILE)) return [];
  return fs.readFileSync(LABELS_FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);
}

function appendLabel(entry) {
  ensureStorage();
  fs.appendFileSync(LABELS_FILE, `${JSON.stringify(entry)}\n`, "utf8");
}

function latestLabelsByUrl(provider) {
  const latest = new Map();
  for (const label of loadLabels()) {
    if (provider && label.provider !== provider) continue;
    if (!label.url) continue;
    latest.set(label.url, label);
  }
  return latest;
}

function buildWeights(labels) {
  const weights = new Map();
  for (const label of labels) {
    const direction = label.label === "reject"
      ? -1
      : label.label === "submitted"
        ? 1.5
        : label.label === "apply"
          ? 1
          : 0;
    if (!direction) continue;
    const tokens = tokenize([label.title, label.summary, label.reason].filter(Boolean).join(" "));
    for (const token of tokens) {
      weights.set(token, (weights.get(token) || 0) + direction);
    }
  }
  return weights;
}

function scoreJob(job, weights) {
  const tokens = core.uniquePreserveOrder(tokenize([job.title, job.summary].filter(Boolean).join(" ")));
  let score = 0;
  const drivers = [];
  for (const token of tokens) {
    const weight = weights.get(token) || 0;
    if (!weight) continue;
    score += weight;
    drivers.push({ token, weight });
  }
  drivers.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.token.localeCompare(b.token));
  const positives = drivers.filter((item) => item.weight > 0).slice(0, 3).map((item) => item.token);
  const negatives = drivers.filter((item) => item.weight < 0).slice(0, 3).map((item) => item.token);
  return {
    score: Number(score.toFixed(2)),
    whyShown: positives.length ? `Boosted by prior applies around ${positives.join(", ")}.` : "",
    whyHidden: negatives.length ? `Downranked by prior rejects around ${negatives.join(", ")}.` : ""
  };
}

function annotateJobs(jobs, options = {}) {
  const labels = loadLabels();
  const latest = latestLabelsByUrl();
  const weights = buildWeights(labels);
  const provider = options.provider || "";

  const annotated = jobs.map((job, index) => {
    const label = latest.get(job.url) || null;
    const preference = scoreJob(job, weights);
    const lifecycle = label?.label || "unseen";
    return {
      ...job,
      lifecycle,
      labelReason: label?.reason || "",
      preferenceScore: preference.score,
      whyShown: preference.whyShown,
      whyHidden: preference.whyHidden,
      labeledAt: label?.createdAt || "",
      rankHint: index,
      provider: job.provider || provider || label?.provider || ""
    };
  });

  annotated.sort((a, b) =>
    b.preferenceScore - a.preferenceScore ||
    (a.lifecycle === "apply" ? -1 : 0) - (b.lifecycle === "apply" ? -1 : 0) ||
    a.rankHint - b.rankHint
  );

  return annotated;
}

function filterJobs(jobs, filter = "active") {
  if (filter === "all") return jobs;
  if (filter === "selected") return jobs.filter((job) => job.lifecycle === "apply");
  if (filter === "rejected") return jobs.filter((job) => job.lifecycle === "reject");
  if (filter === "submitted") return jobs.filter((job) => job.lifecycle === "submitted");
  return jobs.filter((job) =>
    job.lifecycle !== "apply" &&
    job.lifecycle !== "reject" &&
    job.lifecycle !== "submitted" &&
    job.isEligible !== false
  );
}

function labelJob(input = {}) {
  const entry = {
    provider: input.provider || "upwork",
    url: input.url || "",
    title: input.title || "",
    summary: input.summary || "",
    label: input.label || "apply",
    reason: input.reason || "",
    metadata: input.metadata || {},
    createdAt: new Date().toISOString()
  };
  if (!entry.url) {
    throw new Error("A job URL is required to store a label.");
  }
  appendLabel(entry);
  return entry;
}

function selectedJobs(provider) {
  const latest = latestLabelsByUrl(provider);
  return [...latest.values()]
    .filter((label) => label.label === "apply")
    .map((label) => ({
      provider: label.provider,
      url: label.url,
      title: label.title,
      summary: label.summary,
      lifecycle: label.label,
      labelReason: label.reason || "",
      labeledAt: label.createdAt
    }))
    .sort((a, b) => String(b.labeledAt).localeCompare(String(a.labeledAt)));
}

module.exports = {
  LABELS_FILE,
  tokenize,
  loadLabels,
  annotateJobs,
  filterJobs,
  labelJob,
  selectedJobs
};
