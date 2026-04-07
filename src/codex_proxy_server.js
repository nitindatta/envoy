#!/usr/bin/env node
"use strict";

const http = require("http");
const path = require("path");
const core = require("./job_assistant_core");
const codexCli = require("./generators/codex_cli");

const DEFAULT_PORT = 4313;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
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

function loadReviewFromBody(body) {
  if (body.review) {
    return body.review;
  }
  if (!body.reviewId) {
    throw new Error("A review or reviewId is required.");
  }
  const reviewPath = path.join(core.REVIEWS_DIR, `${body.reviewId}.json`);
  if (!require("fs").existsSync(reviewPath)) {
    throw new Error(`Review not found for id ${body.reviewId}.`);
  }
  return core.readJson(reviewPath);
}

function loadProfileFromBody(body) {
  if (body.profile) {
    return body.profile;
  }
  return core.loadProfile(body.profilePath || core.DEFAULT_PROFILE);
}

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/generate-from-review") {
    const body = await readBody(request);
    const review = loadReviewFromBody(body);
    const profile = loadProfileFromBody(body);
    const generated = await codexCli.generateFromReview(review, profile);
    sendJson(response, 200, generated);
    return;
  }

  if (request.method === "POST" && url.pathname === "/answer-seek-question") {
    const body = await readBody(request);
    if (!body.question) {
      throw new Error("A SEEK question payload is required.");
    }
    const review = loadReviewFromBody(body);
    const profile = loadProfileFromBody(body);
    const answer = await codexCli.answerSeekQuestion(body.question, review, profile);
    sendJson(response, 200, answer);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: error.message || "Unexpected server error"
      });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.CODEX_PROXY_PORT || DEFAULT_PORT);
  createServer().listen(port, () => {
    console.log(`AI proxy running at http://127.0.0.1:${port}`);
  });
}

module.exports = {
  createServer,
  DEFAULT_PORT
};
