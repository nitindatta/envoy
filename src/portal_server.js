#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const core = require("./job_assistant_core");
const { getProvider, listProviders } = require("./providers");
const logger = require("./logger");
const preferenceAgent = require("./job_preference_agent");
const queue = require("./application_queue");
const applicationAiService = require("./services/application_ai_service");
const portalApplicationService = require("./services/portal_application_service");

const PORTAL_DIR = path.join(core.ROOT, "portal");
const DEFAULT_PORT = 4312;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, content, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(content);
}

function notFound(response) {
  sendJson(response, 404, { error: "Not found" });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function staticContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function serveStatic(requestPath, response) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const resolved = path.normalize(path.join(PORTAL_DIR, cleanPath));
  if (!resolved.startsWith(PORTAL_DIR)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    notFound(response);
    return;
  }
  sendText(response, 200, fs.readFileSync(resolved, "utf8"), staticContentType(resolved));
}

const providerOptionsFrom = portalApplicationService.providerOptionsFrom;

function providerSummary(providerId) {
  const provider = getProvider(providerId);
  return {
    id: provider.id,
    name: provider.name,
    capabilities: provider.capabilities,
    status: provider.getStatus ? provider.getStatus() : { available: false }
  };
}

async function handleApi(request, response, parsedUrl) {
  if (parsedUrl.pathname !== "/api/activity") {
    logger.appendLog("info", "API request", {
      method: request.method,
      path: parsedUrl.pathname,
      query: Object.fromEntries(parsedUrl.searchParams.entries())
    });
  }

  if (request.method === "GET" && parsedUrl.pathname === "/api/providers") {
    const providers = listProviders().map((item) => providerSummary(item.id));
    sendJson(response, 200, { providers });
    return;
  }

  if (request.method === "GET" && parsedUrl.pathname === "/api/activity") {
    const limit = Number(parsedUrl.searchParams.get("limit") || 120);
    sendJson(response, 200, {
      entries: logger.readRecentEntries(limit)
    });
    return;
  }

  if (request.method === "GET" && parsedUrl.pathname === "/api/reviews/latest") {
    const providerId = parsedUrl.searchParams.get("provider") || "";
    sendJson(response, 200, { review: core.latestReview(providerId || undefined) });
    return;
  }

  if (request.method === "GET" && parsedUrl.pathname === "/api/reviews/by-id") {
    const reviewId = parsedUrl.searchParams.get("reviewId") || "";
    if (!reviewId) {
      throw new Error("A reviewId is required.");
    }
    const reviewPath = path.join(core.REVIEWS_DIR, `${reviewId}.json`);
    if (!fs.existsSync(reviewPath)) {
      throw new Error(`Review not found for id ${reviewId}.`);
    }
    const review = core.readJson(reviewPath);
    sendJson(response, 200, { review });
    return;
  }

  if (request.method === "GET" && parsedUrl.pathname === "/api/session") {
    const providerId = parsedUrl.searchParams.get("provider") || "upwork";
    sendJson(response, 200, providerSummary(providerId));
    return;
  }

  if (request.method === "GET" && parsedUrl.pathname === "/api/jobs") {
    const providerId = parsedUrl.searchParams.get("provider") || "upwork";
    const provider = getProvider(providerId);
    const filter = parsedUrl.searchParams.get("filter") || "active";
    const jobs = await provider.listJobs(providerOptionsFrom(providerId, Object.fromEntries(parsedUrl.searchParams.entries())));
    const annotated = preferenceAgent.annotateJobs(jobs, { provider: providerId });
    const filtered = preferenceAgent.filterJobs(annotated, filter);
    sendJson(response, 200, { jobs: filtered });
    return;
  }

  if (request.method === "GET" && parsedUrl.pathname === "/api/queue") {
    const providerId = parsedUrl.searchParams.get("provider") || "upwork";
    const selected = preferenceAgent.selectedJobs(providerId);
    const prepared = queue.listItems(providerId);
    sendJson(response, 200, { selected, prepared });
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/jobs/label") {
    const body = await readBody(request);
    if ((body.provider || "") === "seek" && body.label === "apply") {
      const blockers = core.detectEligibilityBlockers(`${body.title || ""}\n${body.summary || ""}`, "seek");
      if (blockers.length > 0) {
        throw new Error(`This SEEK job is blocked from apply: ${blockers.join("; ")}`);
      }
    }
    const label = preferenceAgent.labelJob(body);
    logger.appendLog("info", "Job labeled", {
      provider: body.provider || "upwork",
      url: body.url || "",
      title: body.title || "",
      label: body.label || "",
      reason: body.reason || ""
    });
    sendJson(response, 200, { label });
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/queue/remove") {
    const body = await readBody(request);
    if (!body.url) {
      throw new Error("A job URL is required to remove a queued job.");
    }
    queue.removeItem(body.provider || "upwork", body.url);
    preferenceAgent.labelJob({
      provider: body.provider || "upwork",
      url: body.url,
      title: body.title || "",
      summary: body.summary || "",
      label: "removed",
      reason: "Removed from selected queue"
    });
    logger.appendLog("info", "Queued job removed", {
      provider: body.provider || "upwork",
      url: body.url,
      title: body.title || ""
    });
    sendJson(response, 200, { removed: true });
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/providers/launch") {
    const body = await readBody(request);
    const providerId = body.provider || "upwork";
    const provider = getProvider(providerId);
    const session = await provider.launchBrowserSession(providerOptionsFrom(providerId, body));
    logger.appendLog("info", "Provider session launched", {
      provider: providerId,
      url: session?.url || body.url || provider.defaultUrl
    });
    sendJson(response, 200, { provider: providerId, session });
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/jobs/open") {
    const body = await readBody(request);
    const providerId = body.provider || "upwork";
    if (!body.url) {
      throw new Error("A job URL is required.");
    }
    const provider = getProvider(providerId);
    const result = await provider.openJob(body.url, providerOptionsFrom(providerId, body));
    logger.appendLog("info", "Job opened in live session", {
      provider: providerId,
      url: body.url
    });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/reviews/generate") {
    const body = await readBody(request);
    const providerId = body.provider || "upwork";
    const provider = getProvider(providerId);
    const profile = core.loadProfile(body.profilePath || core.DEFAULT_PROFILE);
    const review = await provider.generateReview(profile, {
      ...providerOptionsFrom(providerId, body),
      url: body.url || ""
    });
    logger.appendLog("info", "Review generated", {
      provider: providerId,
      url: review.jobUrl || body.url || "",
      title: review.sourceTitle || review.jobName || "",
      recommendation: review.fit?.recommendation || "",
      fitScore: review.fit?.score ?? null
    });
    sendJson(response, 200, { review });
    return;
  }

  if (request.method === "POST" && (parsedUrl.pathname === "/api/proposal/generate-codex" || parsedUrl.pathname === "/api/proposal/generate-ai")) {
    const body = await readBody(request);
    let review = null;

    if (body.reviewId) {
      const reviewPath = path.join(core.REVIEWS_DIR, `${body.reviewId}.json`);
      if (!fs.existsSync(reviewPath)) {
        throw new Error(`Review not found for id ${body.reviewId}.`);
      }
      review = core.readJson(reviewPath);
    } else {
      review = core.latestReview();
    }

    if (!review) {
      throw new Error("No review is available yet. Generate a review first.");
    }

    const profile = core.loadProfile(body.profilePath || core.DEFAULT_PROFILE);
    const generated = await applicationAiService.generateFromReview(review, profile);
    logger.appendLog("info", "Local ChatGPT API proposal generated", {
      provider: review.provider || body.provider || "upwork",
      url: review.jobUrl || "",
      title: review.sourceTitle || review.jobName || "",
      reviewId: review.id
    });
    sendJson(response, 200, generated);
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/application/prefill") {
    const body = await readBody(request);
    const providerId = body.provider || "upwork";
    if (!body.proposalText || !body.proposalText.trim()) {
      throw new Error("Proposal text is required.");
    }
    const provider = getProvider(providerId);
    const result = await provider.fillProposal(body.proposalText, providerOptionsFrom(providerId, body));
    logger.appendLog("info", "Application prefilled", {
      provider: providerId,
      proposalLength: body.proposalText.trim().length
    });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/application/submit") {
    const body = await readBody(request);
    const providerId = body.provider || "upwork";
    if (body.approval !== "I_APPROVE_SUBMIT") {
      throw new Error("Submission is gated. Send approval exactly as I_APPROVE_SUBMIT.");
    }
    if (!body.proposalText || !body.proposalText.trim()) {
      throw new Error("Proposal text is required.");
    }
    const provider = getProvider(providerId);
    const result = await provider.fillProposal(body.proposalText, {
      ...providerOptionsFrom(providerId, body),
      submit: true
    });
    logger.appendLog("info", "Single application submitted", {
      provider: providerId,
      proposalLength: body.proposalText.trim().length
    });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/applications/prepare-selected") {
    const body = await readBody(request);
    const providerId = body.provider || "seek";
    const profile = core.loadProfile(body.profilePath || core.DEFAULT_PROFILE);
    const items = await portalApplicationService.prepareSelectedApplications(providerId, profile, body);
    logger.appendLog("info", "Batch prepare completed", {
      provider: providerId,
      count: items.length
    });
    sendJson(response, 200, { items });
    return;
  }

  if (request.method === "POST" && parsedUrl.pathname === "/api/applications/submit-selected") {
    const body = await readBody(request);
    const providerId = body.provider || "seek";
    if (body.approval !== "I_APPROVE_SUBMIT") {
      throw new Error("Batch submission is gated. Send approval exactly as I_APPROVE_SUBMIT.");
    }
    const profile = core.loadProfile(body.profilePath || core.DEFAULT_PROFILE);
    const items = await portalApplicationService.submitSelectedApplications(providerId, profile, body);
    logger.appendLog("info", "Batch submit completed", {
      provider: providerId,
      count: items.length,
      statuses: items.map((item) => ({
        title: item.title,
        status: item.status
      }))
    });
    sendJson(response, 200, { items });
    return;
  }

  notFound(response);
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const parsedUrl = new URL(request.url, "http://127.0.0.1");
      if (parsedUrl.pathname.startsWith("/api/")) {
        await handleApi(request, response, parsedUrl);
        return;
      }

      if (parsedUrl.pathname === "/") {
        serveStatic("/index.html", response);
        return;
      }

      serveStatic(parsedUrl.pathname, response);
    } catch (error) {
      logger.appendLog("error", "API failure", {
        path: request.url,
        message: error.message || "Unexpected server error"
      });
      sendJson(response, 500, {
        error: error.message || "Unexpected server error"
      });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  createServer().listen(port, () => {
    console.log(`Portal running at http://127.0.0.1:${port}`);
  });
}

module.exports = {
  createServer,
  DEFAULT_PORT
};
