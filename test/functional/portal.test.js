"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { test, describe, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..", "..");
const PORTAL_DIR = path.join(ROOT, "portal");
const TEST_TIMEOUT_MS = 20000;

function resolveChromeExecutable() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];

  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) {
    throw new Error("Chrome executable not found for portal functional tests.");
  }
  return executablePath;
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function createPortalMockServer() {
  const review = {
    id: "sample-review",
    sourceTitle: "Senior Solutions Architect: End-to-End AI Automation",
    jobName: "sample-review",
    jobUrl: "https://www.upwork.com/jobs/sample-review",
    connectsRequired: 22,
    isAvailable: true,
    fit: {
      recommendation: "Worth applying",
      score: 78,
      matchedSkills: ["Python", "SuiteDash", "Gemini"],
      reasons: ["Strong overlap with workflow automation and integration work."],
      concerns: ["Needs concrete auth and orchestration examples in the final proposal."]
    },
    jobText: "Build a Fillout to Gemini to SuiteDash workflow with strong auth and structured report delivery.",
    proposal: "Draft proposal text.",
    screeningAnswers: ["Answer one", "Answer two"]
  };

  const state = {
    providers: [
      {
        id: "upwork",
        name: "Upwork",
        capabilities: ["launch-browser", "list-jobs", "open-job", "generate-review", "prefill-application", "submit-application"]
      },
      {
        id: "seek",
        name: "SEEK Australia",
        capabilities: ["launch-browser", "list-jobs", "open-job", "generate-review", "batch-prepare-applications", "batch-submit-applications"]
      }
    ],
    review,
    jobs: [
      {
        id: "job-1",
        title: "Senior Solutions Architect: End-to-End AI Automation",
        url: "https://www.upwork.com/jobs/sample-review",
        summary: "Fillout to Gemini to SuiteDash automation.",
        connectsRequired: 22,
        isAvailable: true
      },
      {
        id: "job-2",
        title: "OpenClaw Automation Expert",
        url: "https://www.upwork.com/jobs/openclaw",
        summary: "Construction workflow automation.",
        connectsRequired: 16,
        isAvailable: true
      }
    ],
    generatedCodex: {
      review: {
        ...review,
        proposal: "Codex-generated proposal text.",
        screeningAnswers: ["Codex answer one", "Codex answer two"]
      },
      generator: {
        summary: "Grounded proposal regenerated from Codex."
      }
    },
    queue: {
      selected: [],
      prepared: []
    },
    requests: []
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
    state.requests.push({
      method: request.method,
      path: url.pathname,
      body
    });

    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fs.readFileSync(path.join(PORTAL_DIR, "index.html"), "utf8"));
      return;
    }

    if (url.pathname === "/app.js" || url.pathname === "/styles.css") {
      const filePath = path.join(PORTAL_DIR, url.pathname.slice(1));
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(fs.readFileSync(filePath, "utf8"));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/providers") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ providers: state.providers }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/session") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: { available: true } }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/reviews/latest") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ review: null }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ jobs: state.jobs }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/queue") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(state.queue));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/jobs/label") {
      const payload = JSON.parse(body || "{}");
      if (payload.label === "apply") {
        state.queue.selected = [{
          provider: payload.provider,
          url: payload.url,
          title: payload.title,
          summary: payload.summary,
          lifecycle: "apply"
        }];
      } else if (payload.label === "reject") {
        state.queue.selected = [];
      }
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ label: payload }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reviews/generate") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ review: state.review }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/proposal/generate-codex") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(state.generatedCodex));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/jobs/open") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/application/prefill") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ filled: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/application/submit") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ submitted: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/applications/prepare-selected") {
      state.queue.prepared = [{
        provider: "seek",
        url: "https://www.seek.com.au/job/123",
        title: "Senior Data Engineer",
        status: "prepared",
        proposal: "Prepared proposal"
      }];
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ items: state.queue.prepared }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/applications/submit-selected") {
      state.queue.prepared = [{
        provider: "seek",
        url: "https://www.seek.com.au/job/123",
        title: "Senior Data Engineer",
        status: "submitted"
      }];
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ items: state.queue.prepared }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found" }));
  });

  return {
    state,
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      return `http://127.0.0.1:${address.port}`;
    },
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

describe("portal UI", { timeout: TEST_TIMEOUT_MS }, () => {
  let browser;
  let page;
  let baseUrl;
  let mockServer;

  before(async () => {
    mockServer = createPortalMockServer();
    baseUrl = await mockServer.start();
    browser = await chromium.launch({
      executablePath: resolveChromeExecutable(),
      headless: true,
      timeout: 10000
    });
  });

  after(async () => {
    await browser.close();
    await mockServer.stop();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    page.on("dialog", async (dialog) => dialog.dismiss());
  });

  afterEach(async () => {
    await page.close();
  });

  test("loads jobs and lets the user select one", { timeout: TEST_TIMEOUT_MS }, async () => {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });

    await page.waitForSelector("#jobs-list .job-item", { timeout: 10000 });
    await page.click("#jobs-list .job-item");

    assert.equal(await page.textContent("#jobs-count"), "2 jobs");
    assert.match(await page.textContent("#job-title"), /Senior Solutions Architect/);
    assert.match(await page.textContent("#connects-required"), /22/);
    assert.match(await page.textContent("#job-availability"), /Available/);
  });

test("generate review and codex flow updates the proposal desk", { timeout: TEST_TIMEOUT_MS }, async () => {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector("#jobs-list .job-item", { timeout: 10000 });
    await page.click("#jobs-list .job-item");

    await page.click("#generate-review");
    await page.waitForFunction(() => {
      const recommendation = document.getElementById("fit-recommendation");
      return recommendation && recommendation.textContent.includes("Worth applying");
    }, { timeout: 10000 });

    assert.match(await page.inputValue("#proposal-text"), /Draft proposal text/);
    assert.match(await page.textContent("#fit-score"), /78\/100/);

    const codexPromise = page.waitForResponse((response) =>
      response.url().includes("/api/proposal/generate-codex") && response.status() === 200
    , { timeout: 10000 });
    await page.click("#generate-codex");

    assert.equal(await page.getAttribute("#generate-codex", "data-busy"), "true");
    assert.match(await page.textContent("#generate-codex"), /Generating/);

    await codexPromise;
    await page.waitForFunction(() => {
      const proposal = document.getElementById("proposal-text");
      return proposal && proposal.value.includes("Codex-generated proposal text.");
    }, { timeout: 10000 });

    assert.match(await page.inputValue("#proposal-text"), /Codex-generated proposal text/);
    assert.match(await page.inputValue("#screening-text"), /Codex answer one/);
    assert.equal(await page.getAttribute("#generate-codex", "data-busy"), "false");
    assert.match(await page.textContent("#status-log"), /Codex draft loaded/);
  });

  test("apply labels add jobs to the queue and batch buttons react", { timeout: TEST_TIMEOUT_MS }, async () => {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector("#jobs-list .job-item", { timeout: 10000 });
    await page.click("#jobs-list .job-item button");
    await page.waitForFunction(() => document.getElementById("queue-count")?.textContent.includes("1 selected"), { timeout: 10000 });

    assert.match(await page.textContent("#queue-count"), /1 selected/);
    assert.match(await page.textContent("#queue-list"), /Senior Solutions Architect/);
  });
});
