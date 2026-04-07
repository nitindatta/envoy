const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright-core");
const core = require("../job_assistant_core");
const logger = require("../logger");

const BROWSER_PROFILE_DIR = path.join(core.AUTOMATION_DIR, "browser-profile");
const SESSION_FILE = path.join(core.AUTOMATION_DIR, "browser-session.json");
const DEFAULT_LISTING_URL = "https://www.seek.com.au/jobs";
const TARGET_URL_PATTERN = "seek.com.au";
const PAGE_MODE_PREDICATES = {
  listing: (url) => /seek\.com\.au\/jobs/.test(url || ""),
  detail: (url) => /seek\.com\.au\/job\//.test(url || ""),
  apply: (url) => /seek\.com\.au\/job\/.*\/apply/.test(url || "")
};

function resolveBrowserExecutable(browser) {
  const candidates = browser === "edge"
    ? [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
      ]
    : [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      ];

  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) {
    throw new Error(`Could not find a ${browser} executable in the standard install locations.`);
  }
  return executablePath;
}

async function isDebugEndpointAvailable(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDebugEndpoint(port, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isDebugEndpointAvailable(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Browser launched, but the remote debugging endpoint on port ${port} never became available.`);
}

async function fetchDebugTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`Could not read Chrome debug targets from port ${port}.`);
  }
  return response.json();
}

async function createDebugTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(`Could not open a new Chrome debug target for ${url}.`);
  }
  return response.json();
}

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  return core.readJson(SESSION_FILE);
}

function slugifySearchQuery(searchQuery) {
  const slug = String(searchQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-jobs` : "jobs";
}

function resolveListingUrl(options = {}) {
  const searchQuery = String(options.searchQuery || "").trim();
  if (searchQuery) {
    return `https://www.seek.com.au/${slugifySearchQuery(searchQuery)}?keywords=${encodeURIComponent(searchQuery)}`;
  }
  const requested = options.url || "";
  return PAGE_MODE_PREDICATES.listing(requested) ? requested : DEFAULT_LISTING_URL;
}

function extractSeekJobId(url) {
  const match = String(url || "").match(/\/job\/(\d+)/i);
  return match ? match[1] : "";
}

function findSeekTargetForJob(targets, jobUrl, preferredMode = "apply") {
  const jobId = extractSeekJobId(jobUrl);
  const pages = targets.filter((target) => target.type === "page" && (target.url || "").includes(TARGET_URL_PATTERN));
  if (pages.length === 0) return null;

  const sameJobPages = jobId
    ? pages.filter((target) => extractSeekJobId(target.url || "") === jobId)
    : pages;
  if (sameJobPages.length === 0) return null;

  const pick = (mode) => sameJobPages.find((target) => PAGE_MODE_PREDICATES[mode](target.url || ""));
  if (preferredMode === "apply") {
    return pick("apply") || pick("detail") || sameJobPages[sameJobPages.length - 1];
  }
  if (preferredMode === "detail") {
    return pick("detail") || pick("apply") || sameJobPages[sameJobPages.length - 1];
  }
  return sameJobPages[sameJobPages.length - 1];
}

async function launchBrowserSession(options = {}) {
  const browser = options.browser || "chrome";
  const port = Number(options.port || 9222);
  const url = options.url || DEFAULT_LISTING_URL;

  core.ensureDir(core.AUTOMATION_DIR);
  core.ensureDir(BROWSER_PROFILE_DIR);

  if (!(await isDebugEndpointAvailable(port))) {
    const executablePath = resolveBrowserExecutable(browser);
    const child = spawn(
      executablePath,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${BROWSER_PROFILE_DIR}`,
        "--no-first-run",
        "--no-default-browser-check",
        url
      ],
      {
        detached: true,
        stdio: "ignore"
      }
    );
    child.unref();
    await waitForDebugEndpoint(port);
  }

  const session = {
    provider: "seek",
    browser,
    executablePath: resolveBrowserExecutable(browser),
    profileDir: BROWSER_PROFILE_DIR,
    port,
    savedAt: new Date().toISOString()
  };
  core.writeJson(SESSION_FILE, session);
  return session;
}

async function connectBrowser(options = {}) {
  const session = loadSession();
  const port = Number(session?.port || options.port || 9222);
  if (!(await isDebugEndpointAvailable(port))) {
    throw new Error(`No browser debug session is available on port ${port}. Run launch-browser first.`);
  }
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: Number(options.connectTimeoutMs || 60000)
  });
}

function collectPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

function pickPage(pages, mode = "detail") {
  return pickCandidate(pages, (page) => page.url(), TARGET_URL_PATTERN, mode);
}

function pickCandidate(candidates, getUrl, pattern, mode) {
  const matchingCandidates = candidates.filter((candidate) => getUrl(candidate).includes(pattern));
  if (matchingCandidates.length === 0) {
    throw new Error("No open SEEK tab matched the current browser session. Open the relevant SEEK page first.");
  }

  const pickByMode = (targetMode) =>
    matchingCandidates.find((candidate) => PAGE_MODE_PREDICATES[targetMode](getUrl(candidate)));

  if (mode === "listing") return pickByMode("listing") || matchingCandidates[matchingCandidates.length - 1];
  if (mode === "detail") return pickByMode("detail") || matchingCandidates[matchingCandidates.length - 1];
  return pickByMode("detail") || pickByMode("listing") || matchingCandidates[matchingCandidates.length - 1];
}

function pickTarget(targets, mode = "detail") {
  const candidates = targets.filter((target) => target.type === "page");
  return pickCandidate(candidates, (target) => target.url || "", TARGET_URL_PATTERN, mode);
}

function isTransientInterstitialText(text) {
  return /just a moment|cloudflare ray id|checking your browser|security check|verify you are human/i.test(text || "");
}

async function connectTargetClient(webSocketDebuggerUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 1;
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {}
        reject(new Error("Timed out while connecting to the Chrome page debug socket."));
      }
    }, timeoutMs);

    const cleanup = () => clearTimeout(timeout);

    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend, method });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          for (const entry of pending.values()) {
            entry.reject(new Error("Chrome page debug socket closed before the command completed."));
          }
          pending.clear();
          ws.close();
        }
      });
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data || "{}"));
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(`CDP ${entry.method} failed: ${message.error.message || "unknown error"}`));
        return;
      }
      entry.resolve(message.result || {});
    });

    ws.addEventListener("error", (event) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Chrome page debug socket error: ${event.message || "connection failed"}`));
      }
    });

    ws.addEventListener("close", () => {
      cleanup();
      for (const entry of pending.values()) {
        entry.reject(new Error("Chrome page debug socket closed before the command completed."));
      }
      pending.clear();
      if (!settled) {
        settled = true;
        reject(new Error("Chrome page debug socket closed before it was ready."));
      }
    });
  });
}

async function evaluateTarget(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails) {
    const details = response.exceptionDetails;
    const pieces = [];
    if (details.text) pieces.push(details.text);
    if (details.exception?.description) pieces.push(details.exception.description);
    else if (details.exception?.value) pieces.push(String(details.exception.value));
    if (details.lineNumber !== undefined && details.columnNumber !== undefined) {
      pieces.push(`line ${Number(details.lineNumber) + 1}, column ${Number(details.columnNumber) + 1}`);
    }
    throw new Error(pieces.join(" | ") || "Chrome page evaluation failed.");
  }
  return response.result ? response.result.value : undefined;
}

async function snapshotTargetState(client) {
  return evaluateTarget(
    client,
    `(() => ({
      url: location.href,
      title: document.title || "",
      bodyText: document.body ? (document.body.innerText || "") : "",
      readyState: document.readyState || ""
    }))()`
  );
}

async function waitForResolvedTarget(client, options = {}) {
  const timeoutMs = Number(options.waitForPageTimeoutMs || 30000);
  const intervalMs = Number(options.waitForPagePollMs || 2000);
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await snapshotTargetState(client);
    lastSnapshot = snapshot;
    const combined = `${snapshot.title}\n${snapshot.bodyText}`;
    if ((snapshot.readyState || "complete") === "complete" && !isTransientInterstitialText(combined)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const finalSnapshot = lastSnapshot || await snapshotTargetState(client);
  const combined = `${finalSnapshot.title}\n${finalSnapshot.bodyText}`;
  if (isTransientInterstitialText(combined)) {
    throw new Error("SEEK is still showing a temporary interstitial page. Wait for the tab to finish loading, then try again.");
  }
  return finalSnapshot;
}

async function waitForTargetUrl(client, pattern, options = {}) {
  const timeoutMs = Number(options.waitForPageTimeoutMs || 30000);
  const intervalMs = Number(options.waitForPagePollMs || 1000);
  const startedAt = Date.now();
  let lastUrl = "";

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await snapshotTargetState(client);
    lastUrl = snapshot.url || "";
    if (pattern.test(lastUrl)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    url: lastUrl
  };
}

async function waitForSeekApplyUi(client, options = {}) {
  const timeoutMs = Number(options.waitForApplyUiTimeoutMs || 20000);
  const intervalMs = Number(options.waitForApplyUiPollMs || 750);
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await evaluateTarget(client, `(() => {
      const buttonCount = document.querySelectorAll("button, input[type='submit'], a[role='button'], [role='button'], a").length;
      const fieldCount = document.querySelectorAll("textarea, input, select").length;
      const text = document.body ? (document.body.innerText || "") : "";
      return {
        url: location.href,
        readyState: document.readyState || "",
        buttonCount,
        fieldCount,
        textSample: text.slice(0, 4000)
      };
    })()`);

    const text = String(lastState.textSample || "");
    const looksLikeApplyUi = lastState.buttonCount > 0
      || lastState.fieldCount > 0
      || /resume|cover letter|employer questions|review and submit|continue/i.test(text);

    if ((lastState.readyState || "complete") === "complete" && looksLikeApplyUi) {
      return lastState;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return lastState || {
    url: "",
    readyState: "",
    buttonCount: 0,
    fieldCount: 0,
    textSample: ""
  };
}

async function withTargetClient(target, fn, options = {}) {
  const client = await connectTargetClient(
    target.webSocketDebuggerUrl,
    Number(options.pageSocketTimeoutMs || 15000)
  );
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function withBrowser(options, fn) {
  const browser = await connectBrowser(options);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function getSessionPort(options = {}) {
  const session = loadSession();
  const port = Number(session?.port || options.port || 9222);
  if (!(await isDebugEndpointAvailable(port))) {
    throw new Error(`No browser debug session is available on port ${port}. Run launch-browser first.`);
  }
  return port;
}

async function ensureListingTarget(port, options = {}) {
  const listingUrl = resolveListingUrl(options);
  const listingWaitOptions = {
    ...options,
    waitForPageTimeoutMs: Number(options.listingWaitForPageTimeoutMs || options.waitForPageTimeoutMs || 60000)
  };
  const targets = await fetchDebugTargets(port);
  const candidates = targets.filter((target) => target.type === "page" && (target.url || "").includes(TARGET_URL_PATTERN));
  const reusable = !options.searchQuery;
  const existing = reusable ? candidates.find((target) => PAGE_MODE_PREDICATES.listing(target.url || "")) : null;

  if (existing) {
    const snapshot = await withTargetClient(existing, (client) => waitForResolvedTarget(client, listingWaitOptions), listingWaitOptions);
    return { target: existing, recovered: false, snapshot };
  }

  const created = await createDebugTarget(port, listingUrl);
  const snapshot = await withTargetClient(created, async (client) => {
    await client.send("Page.enable");
    await client.send("Page.bringToFront");
    await client.send("Page.navigate", { url: listingUrl });
    return waitForResolvedTarget(client, listingWaitOptions);
  }, listingWaitOptions);
  return { target: created, recovered: true, snapshot };
}

async function listJobs(options = {}) {
  const port = await getSessionPort(options);
  const { target, recovered, snapshot } = await ensureListingTarget(port, options);
  const jobs = await withTargetClient(target, async (client) => {
    await client.send("Page.bringToFront");
    return evaluateTarget(client, `(() => {
      const normalizeText = (value) =>
        (value || "").replace(/\\s+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
      const anchors = [...document.querySelectorAll('a[href*="/job/"]')];
      const seen = new Set();
      const items = [];

      for (const anchor of anchors) {
        const href = anchor.href;
        if (!/^https:\\/\\/www\\.seek\\.com\\.au\\/job\\//.test(href)) continue;
        if (!href || seen.has(href)) continue;
        const title = normalizeText(anchor.innerText).split("\\n")[0];
        const card = anchor.closest("article, section, div[data-automation], div");
        const summary = normalizeText(card ? card.innerText : anchor.innerText);
        if (!title || summary.length < 20) continue;
        if (/expired|no longer available|job has closed/i.test(summary)) continue;
        seen.add(href);
        items.push({
          id: href,
          title,
          url: href,
          summary: summary.slice(0, 1600),
          provider: "seek",
          connectsRequired: null,
          isAvailable: true
        });
      }

      return items.slice(0, 25);
    })()`);
  }, options);

  const normalizedJobs = jobs.map((job) => {
    const eligibilityBlockers = core.detectEligibilityBlockers(`${job.title}\n${job.summary}`, "seek");
    return {
      ...job,
      isEligible: eligibilityBlockers.length === 0,
      eligibilityBlockers
    };
  });
  const visibleJobs = normalizedJobs.filter((job) => job.isEligible !== false);

  logger.writeDebugSnapshot("seek-refresh-page.json", {
    pageUrl: snapshot.url,
    title: snapshot.title,
    bodyPreview: snapshot.bodyText.slice(0, 2000),
    recoveredListingPage: recovered
  });
  logger.writeDebugSnapshot("seek-refresh-results.json", {
    pageUrl: snapshot.url,
    title: snapshot.title,
    recoveredListingPage: recovered,
    jobCount: visibleJobs.length,
    filteredOutCount: normalizedJobs.length - visibleJobs.length,
    jobs: visibleJobs
  });

  const cachePath = path.join(core.AUTOMATION_DIR, "visible-jobs-seek.json");
  core.writeJson(cachePath, visibleJobs);
  return visibleJobs;
}

async function openJob(url, options = {}) {
  const port = await getSessionPort(options);
  const targets = await fetchDebugTargets(port);
  const existing = targets.filter((target) => target.type === "page" && (target.url || "").includes(TARGET_URL_PATTERN));
  const target = existing.length ? pickTarget(existing, "detail") : await createDebugTarget(port, url);

  return withTargetClient(target, async (client) => {
    await client.send("Page.enable");
    await client.send("Page.bringToFront");
    await client.send("Page.navigate", { url });
    const snapshot = await waitForResolvedTarget(client, {
      ...options,
      waitForPageTimeoutMs: Number(options.waitForPageTimeoutMs || 90000)
    });
    return { ok: true, url: snapshot.url };
  }, options);
}

async function captureCurrentJob(options = {}) {
  const port = await getSessionPort(options);
  const targets = await fetchDebugTargets(port);
  const target = pickTarget(targets, "detail");

  return withTargetClient(target, async (client) => {
    await client.send("Page.bringToFront");
    await waitForResolvedTarget(client, options);
    return evaluateTarget(client, String.raw`(() => {
      const normalizeText = (value) => (value || "").replace(/\r/g, "").replace(/\t/g, " ").replace(/[ ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      const lines = (value) => normalizeText(value).split("\n").map((line) => line.trim()).filter(Boolean);
      const isAvailable = (text) => !/job has closed|no longer available|expired|page not found/i.test(text);
      const bodyText = normalizeText(document.body ? document.body.innerText : "");
      const article = document.querySelector("main") || document.body;
      let title = normalizeText(document.querySelector("h1")?.innerText || "");
      let body = normalizeText(article ? article.innerText : bodyText);

      const stopMarkers = ["similar jobs", "recommended jobs", "more jobs", "company reviews", "explore careers"];
      let endIndex = -1;
      for (const marker of stopMarkers) {
        const idx = body.toLowerCase().indexOf(marker);
        if (idx !== -1 && (endIndex === -1 || idx < endIndex)) endIndex = idx;
      }
      if (endIndex > 0) body = body.slice(0, endIndex).trim();

      if (!title) {
        title = normalizeText(document.title).replace(/\s*-\s*SEEK.*$/i, "").trim() || "Untitled job";
      }

      return {
        title,
        url: location.href,
        text: [title, body].filter(Boolean).join("\n\n").trim(),
        summary: lines(body).slice(0, 14).join("\n"),
        pageType: "job",
        connectsRequired: null,
        isAvailable: isAvailable(bodyText),
        capturedAt: new Date().toISOString()
      };
    })()`);
  }, options);
}

async function generateReview(profile, options = {}) {
  if (options.url) {
    await openJob(options.url, options);
  }

  const captured = await captureCurrentJob(options);
  if (!captured.isAvailable) {
    throw new Error("This SEEK job is no longer available, so I skipped generating a draft.");
  }
  const review = core.draftFromText(captured.title, captured.text, profile, {
    provider: "seek",
    jobUrl: captured.url,
    sourceTitle: captured.title,
    connectsRequired: null,
    isAvailable: captured.isAvailable
  });
  if (review.eligibility?.allowed === false) {
    review.fit.recommendation = "Skip";
    review.fit.concerns = core.uniquePreserveOrder([
      ...review.fit.concerns,
      ...review.eligibility.blockers
    ]);
  }
  return core.persistReview(review, profile);
}

function computeRelevantYears(profile) {
  const periods = (profile.experience || []).map((item) => String(item.period || ""));
  if (periods.some((period) => /2020-present|2020 - present|2020–present/i.test(period))) {
    return 5;
  }
  return 5;
}

function computeRelevantYears(profile) {
  const periods = (profile.experience || []).map((item) => String(item.period || ""));
  if (periods.some((period) => /2020.*present/i.test(period))) {
    return 5;
  }
  return 5;
}

function heuristicAnswer(question, review, profile) {
  const label = String(question.label || "").toLowerCase();
  const choices = (question.options || []).map((option) => String(option.label || option.value || ""));
  const yesChoice = choices.find((choice) => /\byes\b/i.test(choice)) || "Yes";
  const noChoice = choices.find((choice) => /\bno\b/i.test(choice)) || "No";

  if (/right to work|work rights|work in australia|legal right to work|authori[sz]ed to work|eligible to work/i.test(label)) {
    if (question.type === "radio" || question.type === "select") {
      return { answer: yesChoice, confidence: "high", source: "heuristic" };
    }
    return { answer: "I am a permanent resident in Australia.", confidence: "high", source: "heuristic" };
  }

  if (/permanent resident|australian citizen|visa status|work visa/i.test(label)) {
    return { answer: "I am a permanent resident in Australia.", confidence: "high", source: "heuristic" };
  }

  if (/sponsor|sponsorship/i.test(label)) {
    if (question.type === "radio" || question.type === "select") {
      return { answer: noChoice, confidence: "high", source: "heuristic" };
    }
    return { answer: "No, I do not require sponsorship to work in Australia.", confidence: "high", source: "heuristic" };
  }

  if (/relevant experience|years of experience|how many years/i.test(label)) {
    const years = computeRelevantYears(profile);
    if (question.type === "number") {
      return { answer: String(years), confidence: "medium", source: "heuristic" };
    }
    if (question.type === "select") {
      const matching = choices.find((choice) => new RegExp(`\\b${years}\\b`).test(choice)) || choices.find((choice) => /\b5\b|\b6\b/.test(choice));
      if (matching) {
        return { answer: matching, confidence: "medium", source: "heuristic" };
      }
    }
    return {
      answer: `I have around ${years}+ years of relevant experience across data engineering, distributed platforms, and AI/data system delivery.`,
      confidence: "medium",
      source: "heuristic"
    };
  }

  if (/current location|where are you located|located in australia/i.test(label)) {
    return { answer: profile.location || "Adelaide, South Australia", confidence: "high", source: "heuristic" };
  }

  if (/full name|name/i.test(label) && question.type === "text") {
    return { answer: profile.name, confidence: "high", source: "heuristic" };
  }

  return null;
}

async function openSeekApplyPage(page, review) {
  await page.goto(review.jobUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("domcontentloaded").catch(() => {});

  const currentUrl = page.url();
  if (/\/apply/.test(currentUrl)) return currentUrl;

  const applyHref = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const candidates = [
      ...document.querySelectorAll('[data-automation="job-detail-apply"], a[href*="/apply"], button, a')
    ].filter(isVisible);
    const matched = candidates.find((element) => {
      const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || "").toLowerCase();
      return text.includes("quick apply") || text.includes("apply");
    });
    if (!matched) return "";
    if (matched.tagName === "A" && matched.href) return matched.href;
    matched.click();
    return "";
  });

  if (applyHref) {
    await page.goto(applyHref, { waitUntil: "domcontentloaded", timeout: 90000 });
  } else {
    await page.waitForTimeout(1500);
  }

  await page.waitForFunction(() => /\/apply/.test(location.href), { timeout: 30000 }).catch(() => {});
  return page.url();
}

async function inspectSeekApplication(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const labelText = (element) => {
      if (!element) return "";
      const aria = element.getAttribute("aria-label");
      if (aria) return aria.trim();
      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label && label.innerText) return label.innerText.trim();
      }
      const wrappingLabel = element.closest("label");
      if (wrappingLabel && wrappingLabel.innerText) return wrappingLabel.innerText.trim();
      const fieldset = element.closest("fieldset");
      const legend = fieldset ? fieldset.querySelector("legend") : null;
      if (legend && legend.innerText) return legend.innerText.trim();
      const container = element.closest('[data-automation], .question, .questionnaire, .field') || element.parentElement;
      return container ? (container.innerText || "").split("\n").slice(0, 4).join(" ").trim() : "";
    };

    const normalizeOption = (element) => ({
      value: element.value || "",
      label: (element.innerText || element.textContent || element.value || "").trim()
    });

    const fields = [];
    const seen = new Set();
    const formFields = [...document.querySelectorAll("textarea, input, select")].filter(isVisible);
    for (const field of formFields) {
      const type = (field.type || field.tagName || "text").toLowerCase();
      const key = `${field.tagName.toLowerCase()}:${field.name || field.id || fields.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = labelText(field);
      if (!label) continue;
      if ((field.tagName || "").toLowerCase() === "textarea" && /cover|letter|message|application/i.test(label)) {
        fields.push({
          key,
          label,
          type: "proposal",
          tagName: "textarea",
          name: field.name || "",
          id: field.id || "",
          required: field.required
        });
        continue;
      }
      if (type === "hidden" || type === "submit" || type === "button" || type === "file") continue;
      if (type === "radio" || type === "checkbox") {
        const groupKey = `${type}:${field.name || field.id || key}`;
        if (seen.has(groupKey)) continue;
        seen.add(groupKey);
        const group = formFields.filter((candidate) => (candidate.type || "").toLowerCase() === type && (candidate.name || candidate.id) === (field.name || field.id));
        fields.push({
          key: groupKey,
          label,
          type,
          name: field.name || "",
          id: field.id || "",
          required: group.some((candidate) => candidate.required),
          options: group.map((candidate) => ({
            value: candidate.value || "",
            label: labelText(candidate).replace(label, "").trim() || candidate.value || ""
          }))
        });
        continue;
      }
      fields.push({
        key,
        label,
        type: type === "textarea" ? "textarea" : type === "select-one" ? "select" : type,
        tagName: field.tagName.toLowerCase(),
        name: field.name || "",
        id: field.id || "",
        required: field.required,
        options: field.tagName.toLowerCase() === "select" ? [...field.options].map(normalizeOption) : []
      });
    }

    return {
      url: location.href,
      fields
    };
  });
}

async function fillSeekApplication(page, review, answers, shouldSubmit) {
  return page.evaluate(({ proposal, fieldAnswers, submitNow }) => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const byKey = new Map(fieldAnswers.map((entry) => [entry.key, entry.answer]));
    const result = { filledProposal: false, answeredKeys: [] };

    const findField = (entry) => {
      const selectorParts = [];
      if (entry.id) selectorParts.push(`#${CSS.escape(entry.id)}`);
      if (entry.name) selectorParts.push(`[name="${CSS.escape(entry.name)}"]`);
      if (selectorParts.length === 0) return null;
      return document.querySelector(selectorParts.join(","));
    };

    for (const entry of fieldAnswers) {
      if (entry.type === "proposal") {
        const proposalField = findField(entry);
        if (!proposalField) continue;
        proposalField.focus();
        proposalField.value = proposal;
        proposalField.dispatchEvent(new Event("input", { bubbles: true }));
        proposalField.dispatchEvent(new Event("change", { bubbles: true }));
        result.filledProposal = true;
        result.answeredKeys.push(entry.key);
        continue;
      }

      const target = findField(entry);
      if (!target || !isVisible(target)) continue;

      if (entry.type === "radio" || entry.type === "checkbox") {
        const options = [...document.querySelectorAll(`[name="${CSS.escape(entry.name)}"]`)].filter(isVisible);
        const matched = options.find((option) => {
          const label = option.closest("label");
          const text = ((label && label.innerText) || option.value || "").trim().toLowerCase();
          return text === String(byKey.get(entry.key) || "").trim().toLowerCase();
        }) || options.find((option) => String(option.value || "").trim().toLowerCase() === String(byKey.get(entry.key) || "").trim().toLowerCase());
        if (matched) {
          matched.click();
          result.answeredKeys.push(entry.key);
        }
        continue;
      }

      if (entry.type === "select") {
        const desired = String(byKey.get(entry.key) || "").trim().toLowerCase();
        const option = [...target.options].find((item) => (item.textContent || item.innerText || item.value || "").trim().toLowerCase() === desired)
          || [...target.options].find((item) => String(item.value || "").trim().toLowerCase() === desired);
        if (option) {
          target.value = option.value;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
          result.answeredKeys.push(entry.key);
        }
        continue;
      }

      target.focus();
      target.value = String(byKey.get(entry.key) || "");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      result.answeredKeys.push(entry.key);
    }

    if (submitNow) {
      const buttons = [...document.querySelectorAll("button, input[type='submit']")].filter(isVisible);
      const submitButton = buttons.find((button) => {
        const text = (button.innerText || button.textContent || button.value || "").toLowerCase();
        return text.includes("submit") || text.includes("send application") || text.includes("apply now");
      });
      if (!submitButton) {
        throw new Error("The SEEK application was filled, but no visible submit button was found.");
      }
      submitButton.click();
    }

    return result;
  }, {
    proposal: review.proposal,
    fieldAnswers: answers,
    submitNow: shouldSubmit
  });
}

async function submitPreparedApplications(applications, profile, options = {}) {
  const results = [];
  for (const application of applications) {
    const review = application.review;
    if (review.eligibility?.allowed === false) {
      results.push({
        provider: "seek",
        url: review.jobUrl,
        title: review.sourceTitle,
        status: "blocked",
        blockedQuestions: review.eligibility.blockers,
        message: `Blocked by SEEK hard gate: ${review.eligibility.blockers.join("; ")}`
      });
      continue;
    }
    const port = await getSessionPort(options);
    const targets = await fetchDebugTargets(port);
    const openSeekPages = targets.filter((entry) => entry.type === "page" && (entry.url || "").includes(TARGET_URL_PATTERN));
    const target = findSeekTargetForJob(targets, review.jobUrl, "apply")
      || findSeekTargetForJob(targets, review.jobUrl, "detail")
      || (openSeekPages.length > 0 ? pickTarget(openSeekPages, "detail") : null)
      || await createDebugTarget(port, review.jobUrl);

    const result = await withTargetClient(target, async (client) => {
      await client.send("Page.enable");
      await client.send("Page.bringToFront");
      const initialSnapshot = await snapshotTargetState(client);
      const currentJobId = extractSeekJobId(initialSnapshot.url || "");
      const reviewJobId = extractSeekJobId(review.jobUrl);
      const alreadyOnApplyPage = PAGE_MODE_PREDICATES.apply(initialSnapshot.url || "") && currentJobId && currentJobId === reviewJobId;
      const alreadyOnDetailPage = PAGE_MODE_PREDICATES.detail(initialSnapshot.url || "") && currentJobId && currentJobId === reviewJobId;

      if (!alreadyOnApplyPage && !alreadyOnDetailPage) {
        await client.send("Page.navigate", { url: review.jobUrl });
        await waitForResolvedTarget(client, {
          ...options,
          waitForPageTimeoutMs: Number(options.waitForPageTimeoutMs || 90000)
        });
      } else if (!alreadyOnApplyPage) {
        await waitForResolvedTarget(client, {
          ...options,
          waitForPageTimeoutMs: Number(options.waitForPageTimeoutMs || 90000)
        });
      }

      const applyHref = await evaluateTarget(client, String.raw`(() => {
        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        if (/\/apply/.test(location.href)) return location.href;
        const candidates = [
          ...document.querySelectorAll('[data-automation="job-detail-apply"], a[href*="/apply"], button, a')
        ].filter(isVisible);
        const matched = candidates.find((element) => {
          const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || "").toLowerCase();
          return text.includes("quick apply") || text.includes("apply");
        });
        if (!matched) return "";
        if (matched.tagName === "A" && matched.href) return matched.href;
        matched.click();
        return "";
      })()`);

      if (applyHref && !/\/apply/.test(initialSnapshot.url || "") && applyHref !== review.jobUrl) {
        await client.send("Page.navigate", { url: applyHref });
      }

      const applySnapshot = await waitForTargetUrl(client, /\/apply/, {
        ...options,
        waitForPageTimeoutMs: Number(options.waitForApplyTimeoutMs || 45000),
        waitForPagePollMs: Number(options.waitForApplyPollMs || 1000)
      });
      const applyUrl = applySnapshot.url || review.jobUrl;
      if (!/\/apply/.test(applyUrl)) {
        return {
          provider: "seek",
          url: review.jobUrl,
          title: review.sourceTitle,
          status: "paused",
          applyUrl,
          blockedQuestions: [],
          message: "Paused because SEEK did not reach the apply form from the current job page."
        };
      }

      const applyUiState = await waitForSeekApplyUi(client, options);
      logger.appendLog("info", "SEEK apply UI readiness", {
        title: review.sourceTitle,
        applyUrl,
        pageUrl: applyUiState?.url || applyUrl,
        readyState: applyUiState?.readyState || "",
        buttonCount: Number(applyUiState?.buttonCount || 0),
        fieldCount: Number(applyUiState?.fieldCount || 0)
      });

      const maxSeekSteps = Math.max(1, Number(options.maxSeekSteps || 5));
      const answeredQuestionKeys = new Set();
      let currentApplyUrl = applyUrl;
      let lastActionLabel = "";
      let lastVisibleButtons = [];

      for (let stepIndex = 0; stepIndex < maxSeekSteps; stepIndex += 1) {
        await waitForSeekApplyUi(client, options);
        const inspection = await evaluateTarget(client, String.raw`(() => {
          const isVisible = (element) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
          };
          const labelText = (element) => {
            if (!element) return "";
            const aria = element.getAttribute("aria-label");
            if (aria) return aria.trim();
            if (element.id) {
              const label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
              if (label && label.innerText) return label.innerText.trim();
            }
            const wrappingLabel = element.closest("label");
            if (wrappingLabel && wrappingLabel.innerText) return wrappingLabel.innerText.trim();
            const fieldset = element.closest("fieldset");
            const legend = fieldset ? fieldset.querySelector("legend") : null;
            if (legend && legend.innerText) return legend.innerText.trim();
            const container = element.closest('[data-automation], .question, .questionnaire, .field') || element.parentElement;
            return container ? (container.innerText || "").split("\n").slice(0, 4).join(" ").trim() : "";
          };

          const normalizeOption = (element) => ({
            value: element.value || "",
            label: (element.innerText || element.textContent || element.value || "").trim()
          });

          const fields = [];
          const seen = new Set();
          const formFields = [...document.querySelectorAll("textarea, input, select")].filter(isVisible);
          for (const field of formFields) {
            const type = (field.type || field.tagName || "text").toLowerCase();
            const key = field.tagName.toLowerCase() + ":" + (field.name || field.id || fields.length);
            if (seen.has(key)) continue;
            seen.add(key);
            const label = labelText(field);
            if (!label) continue;
            if ((field.tagName || "").toLowerCase() === "textarea" && /cover|letter|message|application/i.test(label)) {
              fields.push({
                key,
                label,
                type: "proposal",
                tagName: "textarea",
                name: field.name || "",
                id: field.id || "",
                required: field.required
              });
              continue;
            }
            if (type === "hidden" || type === "submit" || type === "button" || type === "file") continue;
            if (type === "radio" || type === "checkbox") {
              const groupKey = type + ":" + (field.name || field.id || key);
              if (seen.has(groupKey)) continue;
              seen.add(groupKey);
              const group = formFields.filter((candidate) => (candidate.type || "").toLowerCase() === type && (candidate.name || candidate.id) === (field.name || field.id));
              fields.push({
                key: groupKey,
                label,
                type,
                name: field.name || "",
                id: field.id || "",
                required: group.some((candidate) => candidate.required),
                options: group.map((candidate) => ({
                  value: candidate.value || "",
                  label: labelText(candidate).replace(label, "").trim() || candidate.value || ""
                }))
              });
              continue;
            }
            fields.push({
              key,
              label,
              type: type === "textarea" ? "textarea" : type === "select-one" ? "select" : type,
              tagName: field.tagName.toLowerCase(),
              name: field.name || "",
              id: field.id || "",
              required: field.required,
              options: field.tagName.toLowerCase() === "select" ? [...field.options].map(normalizeOption) : []
            });
          }

          return {
            url: location.href,
            fields
          };
        })()`);
        currentApplyUrl = inspection.url || currentApplyUrl;

        const answers = [];
        const blockedQuestions = [];

        for (const field of inspection.fields) {
          if (field.type === "proposal") {
            answers.push({ ...field, answer: review.proposal });
            continue;
          }

          const heuristic = heuristicAnswer(field, review, profile);
          if (heuristic && heuristic.confidence === "high") {
            answers.push({ ...field, answer: heuristic.answer, source: heuristic.source });
            continue;
          }

          if (heuristic && heuristic.confidence === "medium" && field.required !== true) {
            answers.push({ ...field, answer: heuristic.answer, source: heuristic.source });
            continue;
          }

          if (typeof options.answerQuestion === "function") {
            const llmAnswer = await options.answerQuestion(field, review, profile);
            if (llmAnswer && llmAnswer.confidence === "high") {
              answers.push({ ...field, answer: llmAnswer.answer, source: "codex-cli" });
              continue;
            }
            if (llmAnswer && llmAnswer.confidence === "medium" && field.required !== true) {
              answers.push({ ...field, answer: llmAnswer.answer, source: "codex-cli" });
              continue;
            }
          }

          if (field.required) {
            blockedQuestions.push(field.label);
          }
        }

        if (blockedQuestions.length > 0) {
          return {
            provider: "seek",
            url: review.jobUrl,
            title: review.sourceTitle,
            status: "paused",
            applyUrl: currentApplyUrl,
            blockedQuestions,
            message: `Paused on SEEK application step ${stepIndex + 1} because these questions need review: ${blockedQuestions.join("; ")}`
          };
        }

        for (const answer of answers) {
          if (answer.type !== "proposal") {
            answeredQuestionKeys.add(answer.key);
          }
        }

        const payload = JSON.stringify({
          proposal: review.proposal,
          fieldAnswers: answers,
          submitNow: Boolean(options.submit)
        });
        const fillResult = await evaluateTarget(client, `(() => {
          const input = ${payload};
          const isVisible = (element) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
          };
          const normalizeText = (value) => String(value || "")
            .replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, "")
            .replace(/\\s+/g, " ")
            .trim()
            .toLowerCase();
          const clickElement = (element) => {
            if (!element) return;
            try {
              element.scrollIntoView({ block: "center", inline: "center" });
            } catch {}
            try { element.focus(); } catch {}
            for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
              try {
                element.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
              } catch {}
            }
            try { element.click(); } catch {}
          };

          const findField = (entry) => {
            const selectorParts = [];
            if (entry.id) selectorParts.push("#" + CSS.escape(entry.id));
            if (entry.name) selectorParts.push('[name="' + CSS.escape(entry.name) + '"]');
            if (selectorParts.length === 0) return null;
            return document.querySelector(selectorParts.join(","));
          };

          for (const entry of input.fieldAnswers) {
            if (entry.type === "proposal") {
              const proposalField = findField(entry);
              if (!proposalField) continue;
              proposalField.focus();
              proposalField.value = input.proposal;
              proposalField.dispatchEvent(new Event("input", { bubbles: true }));
              proposalField.dispatchEvent(new Event("change", { bubbles: true }));
              continue;
            }

            const target = findField(entry);
            if (!target || !isVisible(target)) continue;

            if (entry.type === "radio" || entry.type === "checkbox") {
              const options = [...document.querySelectorAll('[name="' + CSS.escape(entry.name) + '"]')].filter(isVisible);
              const desired = String(entry.answer || "").trim().toLowerCase();
              const matched = options.find((option) => {
                const label = option.closest("label");
                const text = ((label && label.innerText) || option.value || "").trim().toLowerCase();
                return text === desired;
              }) || options.find((option) => String(option.value || "").trim().toLowerCase() === desired);
              if (matched) matched.click();
              continue;
            }

            if (entry.type === "select") {
              const desired = String(entry.answer || "").trim().toLowerCase();
              const option = [...target.options].find((item) => (item.textContent || item.innerText || item.value || "").trim().toLowerCase() === desired)
                || [...target.options].find((item) => String(item.value || "").trim().toLowerCase() === desired);
              if (option) {
                target.value = option.value;
                target.dispatchEvent(new Event("input", { bubbles: true }));
                target.dispatchEvent(new Event("change", { bubbles: true }));
              }
              continue;
            }

            target.focus();
            target.value = String(entry.answer || "");
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
          }

          const result = {
            filled: true,
            actionAttempted: false,
            actionType: "",
            actionLabel: "",
            visibleButtons: [],
            allButtons: [],
            pageUrl: location.href
          };

          if (!input.submitNow) {
            return result;
          }

          const allCandidateButtons = [...document.querySelectorAll("button, input[type='submit'], a[role='button'], [role='button'], a")]
            .filter((button) => button.getAttribute("aria-disabled") !== "true" && button.disabled !== true);
          result.allButtons = allCandidateButtons
            .map((button) => (button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "").trim())
            .filter(Boolean)
            .slice(0, 16);

          let buttons = allCandidateButtons.filter(isVisible);
          let buttonTexts = buttons
            .map((button) => (button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "").trim())
            .filter(Boolean);
          result.visibleButtons = buttonTexts.slice(0, 12);

          const isFinalSubmitLabel = (text) =>
            text === "submit"
            || text.startsWith("submit ")
            || text.includes("submit application")
            || text.includes("submit your application")
            || text.includes("send application")
            || text.includes("apply now");

          const scoreAction = (button) => {
            const text = normalizeText(button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "");
            if (!text) return -1;
            if (text === "continue") return 100;
            if (text === "next") return 99;
            if (text.includes("continue application")) return 96;
            if (text.includes("continue")) return 95;
            if (text.includes("next")) return 94;
            if (text.includes("finish application")) return 90;
            if (text.includes("complete application")) return 88;
            if (text.includes("review and submit")) return 86;
            if (text.includes("review application")) return 84;
            if (text.includes("review")) return 80;
            if (isFinalSubmitLabel(text)) return 70;
            return -1;
          };

          let scoredButtons = buttons
            .map((button) => ({
              button,
              score: scoreAction(button),
              label: (button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "").trim()
            }))
            .filter((entry) => entry.score >= 0)
            .sort((left, right) => right.score - left.score);

          if (scoredButtons.length === 0) {
            try {
              window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
            } catch {
              try {
                window.scrollTo(0, document.body.scrollHeight);
              } catch {}
            }
            buttons = allCandidateButtons.filter(isVisible);
            buttonTexts = buttons
              .map((button) => (button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "").trim())
              .filter(Boolean);
            result.visibleButtons = buttonTexts.slice(0, 12);
            scoredButtons = buttons
              .map((button) => ({
                button,
                score: scoreAction(button),
                label: (button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "").trim()
              }))
              .filter((entry) => entry.score >= 0)
              .sort((left, right) => right.score - left.score);
          }

          if (scoredButtons.length === 0) {
            scoredButtons = allCandidateButtons
              .map((button) => ({
                button,
                score: scoreAction(button),
                label: (button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "").trim()
              }))
              .filter((entry) => entry.score >= 0)
              .sort((left, right) => right.score - left.score);
          }

          const actionButton = scoredButtons.length > 0 ? scoredButtons[0].button : null;

          if (!actionButton) {
            return result;
          }

          const label = (actionButton.innerText || actionButton.textContent || actionButton.value || actionButton.getAttribute("aria-label") || "").trim();
          const normalized = normalizeText(label);
          result.actionAttempted = true;
          result.actionLabel = label;
          result.actionType = isFinalSubmitLabel(normalized)
            ? "submit"
            : "progress";
          clickElement(actionButton);
          return result;
        })()`);

        logger.appendLog("info", "SEEK submit step evaluated", {
          title: review.sourceTitle,
          step: stepIndex + 1,
          applyUrl: currentApplyUrl,
          pageUrl: fillResult?.pageUrl || currentApplyUrl,
          actionLabel: fillResult?.actionLabel || "",
          actionType: fillResult?.actionType || "",
          actionAttempted: Boolean(fillResult?.actionAttempted),
          visibleButtons: (fillResult?.visibleButtons || []).slice(0, 8),
          allButtons: (fillResult?.allButtons || []).slice(0, 8)
        });

        if (options.submit && !fillResult?.actionAttempted) {
          await new Promise((resolve) => setTimeout(resolve, Number(options.seekActionRetryDelayMs || 1250)));
          const retryResult = await evaluateTarget(client, `(() => {
            const isVisible = (element) => {
              if (!element) return false;
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
            };
            const normalizeText = (value) => String(value || "")
              .replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, "")
              .replace(/\\s+/g, " ")
              .trim()
              .toLowerCase();
            const clickElement = (element) => {
              if (!element) return;
              try { element.scrollIntoView({ block: "center", inline: "center" }); } catch {}
              try { element.focus(); } catch {}
              for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
                try {
                  element.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
                } catch {}
              }
              try { element.click(); } catch {}
            };
            const isFinalSubmitLabel = (text) =>
              text === "submit"
              || text.startsWith("submit ")
              || text.includes("submit application")
              || text.includes("submit your application")
              || text.includes("send application")
              || text.includes("apply now");

            const scoreAction = (button) => {
              const text = normalizeText(button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "");
              if (!text) return -1;
              if (text === "continue") return 100;
              if (text === "next") return 99;
              if (text.includes("continue application")) return 96;
              if (text.includes("continue")) return 95;
              if (text.includes("next")) return 94;
              if (text.includes("finish application")) return 90;
              if (text.includes("complete application")) return 88;
              if (text.includes("review and submit")) return 86;
              if (text.includes("review application")) return 84;
              if (text.includes("review")) return 80;
              if (isFinalSubmitLabel(text)) return 70;
              return -1;
            };

            const buttons = [...document.querySelectorAll("button, input[type='submit'], a[role='button'], [role='button'], a")]
              .filter((button) => button.getAttribute("aria-disabled") !== "true" && button.disabled !== true);
            const candidates = buttons
              .map((button) => ({
                button,
                label: (button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || "").trim(),
                score: scoreAction(button),
                visible: isVisible(button)
              }))
              .filter((entry) => entry.score >= 0)
              .sort((left, right) => right.score - left.score);

            const picked = candidates[0];
            if (!picked) {
              return {
                actionAttempted: false,
                pageUrl: location.href,
                candidates: candidates.slice(0, 5).map((entry) => ({ label: entry.label, score: entry.score, visible: entry.visible }))
              };
            }

            clickElement(picked.button);
            const normalized = normalizeText(picked.label);
            return {
              actionAttempted: true,
              pageUrl: location.href,
              actionLabel: picked.label,
              actionType: isFinalSubmitLabel(normalized)
                ? "submit"
                : "progress",
              candidates: candidates.slice(0, 5).map((entry) => ({ label: entry.label, score: entry.score, visible: entry.visible }))
            };
          })()`);

          logger.appendLog("info", "SEEK submit retry evaluated", {
            title: review.sourceTitle,
            step: stepIndex + 1,
            applyUrl: currentApplyUrl,
            pageUrl: retryResult?.pageUrl || currentApplyUrl,
            actionLabel: retryResult?.actionLabel || "",
            actionType: retryResult?.actionType || "",
            actionAttempted: Boolean(retryResult?.actionAttempted),
            candidates: (retryResult?.candidates || []).slice(0, 5)
          });

          if (retryResult?.actionAttempted) {
            fillResult.actionAttempted = true;
            fillResult.actionLabel = retryResult.actionLabel || fillResult.actionLabel;
            fillResult.actionType = retryResult.actionType || fillResult.actionType;
          }
        }

        lastActionLabel = fillResult?.actionLabel || lastActionLabel;
        lastVisibleButtons = (fillResult?.visibleButtons || []).filter(Boolean);

        if (!options.submit) {
          return {
            provider: "seek",
            url: review.jobUrl,
            title: review.sourceTitle,
            status: "filled",
            applyUrl: currentApplyUrl,
            answeredQuestions: answeredQuestionKeys.size
          };
        }

        if (!fillResult?.actionAttempted) {
          return {
            provider: "seek",
            url: review.jobUrl,
            title: review.sourceTitle,
            status: "paused",
            applyUrl: currentApplyUrl,
            blockedQuestions: [],
            message: lastVisibleButtons.length > 0
              ? `Paused because the SEEK form was filled but no action button matched. Visible buttons: ${lastVisibleButtons.join("; ")}`
              : "Paused because the SEEK form was filled but no visible action button was found."
          };
        }

        if (fillResult.actionType === "submit") {
          return {
            provider: "seek",
            url: review.jobUrl,
            title: review.sourceTitle,
            status: "submitted",
            applyUrl: currentApplyUrl,
            answeredQuestions: answeredQuestionKeys.size,
            message: fillResult.actionLabel
              ? `Submitted after clicking "${fillResult.actionLabel}".`
              : "Submitted from the SEEK application flow."
          };
        }

        await waitForResolvedTarget(client, {
          ...options,
          waitForPageTimeoutMs: Number(options.waitForSeekStepTimeoutMs || 15000),
          waitForPagePollMs: Number(options.waitForSeekStepPollMs || 750)
        });
      }

      return {
        provider: "seek",
        url: review.jobUrl,
        title: review.sourceTitle,
        status: "paused",
        applyUrl: currentApplyUrl,
        blockedQuestions: [],
        answeredQuestions: answeredQuestionKeys.size,
        message: lastActionLabel
          ? `Paused after clicking "${lastActionLabel}" because the SEEK application still has more steps than the current automation limit of ${maxSeekSteps}.`
          : `Paused because the SEEK application still has more steps than the current automation limit of ${maxSeekSteps}.`
      };
    });

    results.push(result);
  }
  return results;
}

async function fillProposal() {
  throw new Error("Use the SEEK batch apply flow from the portal. Single-job prefill is not the supported path for SEEK.");
}

function getStatus() {
  const session = loadSession();
  return {
    provider: "seek",
    available: Boolean(session),
    session
  };
}

module.exports = {
  id: "seek",
  name: "SEEK Australia",
  defaultUrl: DEFAULT_LISTING_URL,
  defaultTargetUrlPattern: TARGET_URL_PATTERN,
  capabilities: ["launch-browser", "list-jobs", "open-job", "generate-review", "batch-prepare-applications", "batch-submit-applications"],
  loadSession,
  launchBrowserSession,
  connectBrowser,
  listJobs,
  openJob,
  captureCurrentJob,
  generateReview,
  submitPreparedApplications,
  fillProposal,
  getStatus
};
