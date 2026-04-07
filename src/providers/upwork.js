const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright-core");
const core = require("../job_assistant_core");
const logger = require("../logger");

const BROWSER_PROFILE_DIR = path.join(core.AUTOMATION_DIR, "browser-profile");
const SESSION_FILE = path.join(core.AUTOMATION_DIR, "browser-session.json");
const DEFAULT_LISTING_URL = "https://www.upwork.com/nx/find-work/best-matches";
const TARGET_URL_PATTERN = "upwork.com";
const PAGE_MODE_PREDICATES = {
  listing: (url) => /find-work|search\/jobs|saved/.test(url || ""),
  detail: (url) => /\/jobs\/|\/job\//.test(url || "") && !/proposal|apply/.test(url || ""),
  apply: (url) => /proposal|apply/.test(url || "")
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

async function launchBrowserSession(options = {}) {
  const browser = options.browser || "chrome";
  const port = Number(options.port || 9222);
  const url = resolveListingUrl(options);

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

    core.writeJson(SESSION_FILE, {
      provider: "upwork",
      browser,
      executablePath,
      profileDir: BROWSER_PROFILE_DIR,
      port,
      savedAt: new Date().toISOString()
    });
  }

  return loadSession();
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

function pickCandidate(candidates, getUrl, pattern = "upwork.com", mode = "job-or-apply") {
  const matchingCandidates = candidates.filter((candidate) => getUrl(candidate).includes(pattern));
  if (matchingCandidates.length === 0) {
    throw new Error(`No open tab matched "${pattern}". Open the relevant Upwork page in the launched browser session first.`);
  }

  const pickByMode = (targetMode) =>
    matchingCandidates.find((candidate) => PAGE_MODE_PREDICATES[targetMode](getUrl(candidate)));

  if (mode === "listing") {
    return pickByMode("listing") || matchingCandidates[matchingCandidates.length - 1];
  }
  if (mode === "detail") {
    return pickByMode("detail") || matchingCandidates[matchingCandidates.length - 1];
  }
  if (mode === "apply") {
    return pickByMode("apply") || matchingCandidates[matchingCandidates.length - 1];
  }

  return pickByMode("detail") || pickByMode("apply") || matchingCandidates[matchingCandidates.length - 1];
}

function pickTarget(targets, pattern = "upwork.com", mode = "job-or-apply") {
  const candidates = targets.filter((target) => target.type === "page");
  return pickCandidate(candidates, (target) => target.url || "", pattern, mode);
}

function pickPage(pages, pattern = "upwork.com", mode = "job-or-apply") {
  return pickCandidate(pages, (page) => page.url(), pattern, mode);
}

function isListingPageUrl(url) {
  return PAGE_MODE_PREDICATES.listing(url);
}

function isTransientInterstitialText(text) {
  return /just a moment|cloudflare ray id|checking your browser|security check|verify you are human/i.test(text || "");
}

function resolveListingUrl(options = {}) {
  const searchQuery = String(options.searchQuery || "").trim();
  if (searchQuery) {
    return `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(searchQuery)}`;
  }
  const requested = options.url || "";
  return isListingPageUrl(requested)
    ? requested
    : DEFAULT_LISTING_URL;
}

function buildWaitOptions(options = {}, fallbackTimeoutMs) {
  return {
    timeoutMs: Number(options.waitForPageTimeoutMs || fallbackTimeoutMs),
    intervalMs: Number(options.waitForPagePollMs || 2000)
  };
}

async function waitForResolvedSnapshot(getSnapshot, pause, options = {}) {
  const { timeoutMs, intervalMs } = buildWaitOptions(options, 30000);
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getSnapshot();
    lastSnapshot = snapshot;
    const combined = `${snapshot.title}\n${snapshot.bodyText}`;
    if ((snapshot.readyState || "complete") === "complete" && !isTransientInterstitialText(combined)) {
      return snapshot;
    }
    await pause(intervalMs);
  }

  const finalSnapshot = lastSnapshot || await getSnapshot();
  const combined = `${finalSnapshot.title}\n${finalSnapshot.bodyText}`;
  if (isTransientInterstitialText(combined)) {
    throw new Error("Upwork is still showing a temporary Cloudflare/check page. Wait for the Chrome tab to finish loading, then try again.");
  }

  return finalSnapshot;
}

async function snapshotPageState(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title || "",
    bodyText: document.body ? document.body.innerText || "" : "",
    readyState: document.readyState || ""
  }));
}

async function waitForResolvedUpworkPage(page, options = {}) {
  return waitForResolvedSnapshot(
    async () => {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return snapshotPageState(page);
    },
    (intervalMs) => page.waitForTimeout(intervalMs),
    options
  );
}

async function withBrowser(options, fn) {
  const browser = await connectBrowser(options);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
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
    throw new Error("Chrome page evaluation failed.");
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
  return waitForResolvedSnapshot(
    () => snapshotTargetState(client),
    (intervalMs) => new Promise((resolve) => setTimeout(resolve, intervalMs)),
    options
  );
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

async function ensureListingTarget(port, options = {}) {
  const targetUrlPattern = options.targetUrlPattern || TARGET_URL_PATTERN;
  const listingUrl = resolveListingUrl(options);
  const listingWaitOptions = { ...options, waitForPageTimeoutMs: Number(options.listingWaitForPageTimeoutMs || options.waitForPageTimeoutMs || 90000) };

  const targets = await fetchDebugTargets(port);
  const candidates = targets.filter((target) => target.type === "page" && (target.url || "").includes(targetUrlPattern));
  const existing = options.searchQuery ? null : candidates.find((target) => isListingPageUrl(target.url || ""));

  if (existing) {
    const snapshot = await withTargetClient(existing, (client) => waitForResolvedTarget(client, listingWaitOptions), listingWaitOptions);
    return {
      target: existing,
      recovered: false,
      snapshot
    };
  }

  const fallbackTarget = candidates[candidates.length - 1] || null;
  logger.appendLog("info", "No Upwork listing tab found, opening a fresh listing page", {
    currentUrl: fallbackTarget ? fallbackTarget.url : "",
    listingUrl
  });

  const created = await createDebugTarget(port, listingUrl);
  const snapshot = await withTargetClient(created, async (client) => {
    await client.send("Page.bringToFront");
    return waitForResolvedTarget(client, listingWaitOptions);
  }, listingWaitOptions);

  return {
    target: created,
    recovered: true,
    snapshot
  };
}

async function getSessionPort(options = {}) {
  const session = loadSession();
  const port = Number(session?.port || options.port || 9222);
  if (!(await isDebugEndpointAvailable(port))) {
    throw new Error(`No browser debug session is available on port ${port}. Run launch-browser first.`);
  }
  return port;
}

async function findOrCreateWorkingTarget(port, options = {}, preferredMode = "job-or-apply") {
  const targetUrlPattern = options.targetUrlPattern || TARGET_URL_PATTERN;
  const targets = await fetchDebugTargets(port);
  const candidates = targets.filter((target) => target.type === "page" && (target.url || "").includes(targetUrlPattern));

  if (candidates.length > 0) {
    try {
      return pickTarget(candidates, targetUrlPattern, preferredMode);
    } catch {
      return candidates[candidates.length - 1];
    }
  }

  const created = await createDebugTarget(port, resolveListingUrl(options));
  return created;
}

async function listJobs(options = {}) {
  const port = await getSessionPort(options);
  const { target, recovered, snapshot } = await ensureListingTarget(port, options);
  const pageState = snapshot;
  const jobs = await withTargetClient(target, async (client) => {
    await client.send("Page.bringToFront");
    return evaluateTarget(client, `(() => {
      const normalizeText = (value) =>
        (value || "").replace(/\\s+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
      const parseConnects = (text) => {
        const match = text.match(/(\\d+)\\s*connects/i);
        return match ? Number(match[1]) : null;
      };
      const unavailable = (text) => /no longer available|posting has expired|currently unavailable|job not found/i.test(text);

      const anchors = [...document.querySelectorAll('a[href*="/jobs/"], a[href*="/nx/search/jobs/details/"]')];
      const seen = new Set();
      const items = [];

      for (const anchor of anchors) {
        const href = anchor.href;
        const isRealJobLink =
          /^https:\\/\\/www\\.upwork\\.com\\/jobs\\//.test(href) ||
          /^https:\\/\\/www\\.upwork\\.com\\/nx\\/search\\/jobs\\/details\\//.test(href);
        if (!isRealJobLink) continue;
        if (!href || seen.has(href)) continue;
        const title = normalizeText(anchor.innerText).split("\\n")[0];
        const card = anchor.closest("article, section, [data-test], div");
        const summary = normalizeText(card ? card.innerText : anchor.innerText);
        if (!title || summary.length < 20) continue;
        if (unavailable(summary)) continue;
        seen.add(href);
        items.push({
          id: href,
          title,
          url: href,
          summary: summary.slice(0, 1600),
          provider: "upwork",
          connectsRequired: parseConnects(summary),
          isAvailable: true
        });
      }

      return items.slice(0, 25);
    })()`);
  }, options);

    logger.writeDebugSnapshot("upwork-refresh-page.json", {
      pageUrl: pageState.url,
      title: pageState.title,
      bodyPreview: pageState.bodyText.slice(0, 2000),
      recoveredListingPage: recovered
    });

    logger.writeDebugSnapshot("upwork-refresh-results.json", {
      pageUrl: pageState.url,
      title: pageState.title,
      recoveredListingPage: recovered,
      jobCount: jobs.length,
      jobs
    });
    logger.appendLog("info", "Refresh Jobs completed", {
      pageUrl: pageState.url,
      title: pageState.title,
      recoveredListingPage: recovered,
      jobCount: jobs.length
    });

    const cachePath = path.join(core.AUTOMATION_DIR, "visible-jobs.json");
    core.writeJson(cachePath, jobs);
    return jobs;
}

async function openJob(url, options = {}) {
  const port = await getSessionPort(options);
  const target = await findOrCreateWorkingTarget(port, options, "job-or-apply");

  return withTargetClient(target, async (client) => {
    await client.send("Page.enable");
    await client.send("Page.bringToFront");
    await client.send("Page.navigate", { url });
    await waitForResolvedTarget(client, {
      ...options,
      waitForPageTimeoutMs: Number(options.waitForPageTimeoutMs || 90000)
    });
    const snapshot = await snapshotTargetState(client);
    return { ok: true, url: snapshot.url };
  }, options);
}

async function captureCurrentJob(options = {}) {
  const port = await getSessionPort(options);
  const targetUrlPattern = options.targetUrlPattern || TARGET_URL_PATTERN;
  const targets = await fetchDebugTargets(port);
  const target = pickTarget(targets, targetUrlPattern, "job-or-apply");

  return withTargetClient(target, async (client) => {
    await client.send("Page.bringToFront");
    await waitForResolvedTarget(client, options);
    return evaluateTarget(client, String.raw`(() => {
      const normalizeText = (value) => (value || "").replace(/\r/g, "").replace(/\t/g, " ").replace(/[ ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      const lines = (value) => normalizeText(value).split("\n").map((line) => line.trim()).filter(Boolean);
      const parseConnects = (text) => {
        const match = text.match(/(?:this proposal requires|send a proposal for:?|requires)\s*(\d+)\s*connects/i);
        return match ? Number(match[1]) : null;
      };
      const isAvailable = (text) => !/this job is no longer available|job is no longer available|job posting has expired|currently unavailable|job not found/i.test(text);
      const sliceByMarkers = (text, startMarkers, endMarkers) => {
        const source = normalizeText(text);
        let startIndex = -1;
        for (const marker of startMarkers) {
          const idx = source.toLowerCase().indexOf(marker.toLowerCase());
          if (idx !== -1 && (startIndex === -1 || idx < startIndex)) startIndex = idx;
        }
        let sliced = startIndex >= 0 ? source.slice(startIndex) : source;
        let endIndex = -1;
        for (const marker of endMarkers) {
          const idx = sliced.toLowerCase().indexOf(marker.toLowerCase());
          if (idx !== -1 && (endIndex === -1 || idx < endIndex)) endIndex = idx;
        }
        if (endIndex > 0) sliced = sliced.slice(0, endIndex);
        return normalizeText(sliced);
      };

      const bodyText = normalizeText(document.body.innerText);
      const pageType = /proposal|apply/.test(location.href) ? "apply" : "job";
      const connectsRequired = parseConnects(bodyText);
      const available = isAvailable(bodyText);

      let title = normalizeText(document.querySelector("h1")?.innerText);
      let body = "";

      if (pageType === "apply") {
        const allLines = lines(bodyText);
        const detailsIndex = allLines.findIndex((line) => line.toLowerCase() === "job details");
        const titleIndex = detailsIndex >= 0 ? detailsIndex + 1 : -1;
        if (titleIndex > 0 && allLines[titleIndex]) {
          title = allLines[titleIndex];
        }
        body = sliceByMarkers(
          bodyText,
          ["Job details", title || "Submit a proposal"],
          ["About the client", "Profile highlights", "Boost your proposal", "Summary", "Key points:"]
        );
      } else {
        const descriptionNode = document.querySelector('[data-test="JobDescription"]');
        if (descriptionNode) {
          body = normalizeText(descriptionNode.innerText);
        } else {
          body = sliceByMarkers(
            bodyText,
            [title || document.title, "Summary", "Project Overview"],
            ["About the client", "Activity on this job", "Client's recent history", "Other open jobs by this Client", "Key points:"]
          );
        }
      }

      if (!title) {
        title = normalizeText(document.title).replace(/\s*-\s*Upwork.*$/i, "").trim() || "Untitled job";
      }

      body = body
        .replace(/^Job details\s*/i, "")
        .replace(/^Summary\s*/i, "")
        .replace(/^Project Overview\s*/i, "")
        .trim();

      const combined = [title, body].filter(Boolean).join("\n\n").trim();

      return {
        title,
        url: location.href,
        text: combined,
        summary: body.slice(0, 1200),
        pageType,
        connectsRequired,
        isAvailable: available,
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
    throw new Error("This Upwork job is no longer available, so I skipped generating a proposal for it.");
  }
  return core.draftFromText(captured.title, captured.text, profile, {
    provider: "upwork",
    jobUrl: captured.url,
    sourceTitle: captured.title,
    connectsRequired: captured.connectsRequired,
    isAvailable: captured.isAvailable
  });
}

async function fillProposal(proposalText, options = {}) {
  const targetUrlPattern = options.targetUrlPattern || "upwork.com";
  const submit = Boolean(options.submit);

  return withBrowser(options, async (browser) => {
    const page = pickPage(collectPages(browser), targetUrlPattern, "apply");
    return page.evaluate(
      ({ proposal, shouldSubmitNow }) => {
        const normalizeText = (value) => (value || "").toLowerCase();
        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };

        const textareas = [...document.querySelectorAll("textarea")].filter(isVisible);
        const target = textareas.find((item) => {
          const label = normalizeText(item.getAttribute("aria-label") || item.name || item.id || "");
          return label.includes("cover") || label.includes("proposal") || label.includes("letter");
        }) || [...textareas].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];

        if (!target) {
          throw new Error("No visible proposal textarea was found on the current page.");
        }

        target.focus();
        target.value = proposal;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));

        let submitted = false;
        if (shouldSubmitNow) {
          const buttons = [...document.querySelectorAll("button")].filter(isVisible);
          const submitButton = buttons.find((button) => {
            const text = normalizeText(button.innerText || button.textContent || "");
            return text.includes("submit proposal") || text === "submit" || text.includes("send proposal");
          });
          if (!submitButton) {
            throw new Error("Proposal text was filled, but no visible submit button was found.");
          }
          submitButton.click();
          submitted = true;
        }

        return {
          filled: true,
          submitted,
          field: target.name || target.getAttribute("aria-label") || target.id || "unknown"
        };
      },
      { proposal: proposalText, shouldSubmitNow: submit }
    );
  });
}

async function openUpworkApplyPage(page, review, options = {}) {
  await page.goto(review.jobUrl, { waitUntil: "domcontentloaded", timeout: Number(options.waitForPageTimeoutMs || 90000) });
  await waitForResolvedUpworkPage(page, options);

  if (PAGE_MODE_PREDICATES.apply(page.url())) {
    return page.url();
  }

  const applyHref = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const candidates = [...document.querySelectorAll("a[href], button")].filter(isVisible);
    const matched = candidates.find((element) => {
      const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || "").toLowerCase();
      return text.includes("apply now") || text.includes("submit a proposal") || text.includes("apply");
    });
    if (!matched) return "";
    if (matched.tagName === "A" && matched.href) return matched.href;
    matched.click();
    return "";
  });

  if (applyHref) {
    await page.goto(applyHref, { waitUntil: "domcontentloaded", timeout: Number(options.waitForPageTimeoutMs || 90000) });
  } else {
    await page.waitForTimeout(2000);
  }

  await page.waitForFunction(() => /proposal|apply/.test(location.href), { timeout: Number(options.waitForPageTimeoutMs || 30000) }).catch(() => {});
  await page.waitForTimeout(1000);
  return page.url();
}

async function inspectUpworkApplication(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const normalize = (value) => (value || "").toLowerCase();
    const controls = [...document.querySelectorAll("textarea, input, select")].filter(isVisible);
    const entries = controls.map((field, index) => {
      const label = normalize(field.getAttribute("aria-label") || field.name || field.id || "");
      return {
        key: `${field.tagName.toLowerCase()}:${field.name || field.id || index}`,
        label,
        tagName: field.tagName.toLowerCase(),
        type: normalize(field.type || field.tagName),
        required: Boolean(field.required)
      };
    });

    const proposal = entries.find((entry) => entry.tagName === "textarea" && (
      entry.label.includes("cover") ||
      entry.label.includes("proposal") ||
      entry.label.includes("letter")
    )) || entries.filter((entry) => entry.tagName === "textarea")[0] || null;

    const ignored = ["hourly", "rate", "boost", "milestone", "duration", "terms", "bid", "attachment"];
    const blockers = entries.filter((entry) => {
      if (!entry.required) return false;
      if (proposal && entry.key === proposal.key) return false;
      if (ignored.some((token) => entry.label.includes(token))) return false;
      return entry.tagName === "textarea" || entry.tagName === "select" || entry.type === "text" || entry.type === "radio" || entry.type === "checkbox";
    });

    return {
      proposalField: proposal,
      blockers
    };
  });
}

async function submitPreparedApplications(applications, profile, options = {}) {
  const results = [];
  for (const application of applications) {
    const review = application.review;
    const result = await withBrowser(options, async (browser) => {
      const page = pickPage(collectPages(browser), TARGET_URL_PATTERN, "job-or-apply");
      const applyUrl = await openUpworkApplyPage(page, review, options);
      const inspection = await inspectUpworkApplication(page);

      if (!inspection.proposalField) {
        return {
          provider: "upwork",
          url: review.jobUrl,
          title: review.sourceTitle,
          status: "paused",
          applyUrl,
          blockedQuestions: ["Proposal field was not found on the Upwork form."],
          message: "Paused because the Upwork proposal field was not available."
        };
      }

      if (inspection.blockers.length > 0) {
        return {
          provider: "upwork",
          url: review.jobUrl,
          title: review.sourceTitle,
          status: "paused",
          applyUrl,
          blockedQuestions: inspection.blockers.map((entry) => entry.label || entry.key),
          message: "Paused because the Upwork form has additional required fields beyond the proposal."
        };
      }

      const filled = await fillProposal(review.proposal, {
        ...options,
        submit: Boolean(options.submit)
      });

      return {
        provider: "upwork",
        url: review.jobUrl,
        title: review.sourceTitle,
        status: options.submit ? "submitted" : "filled",
        applyUrl,
        field: filled.field
      };
    });

    results.push(result);
  }
  return results;
}

function getStatus() {
  const session = loadSession();
  return {
    provider: "upwork",
    available: Boolean(session),
    session
  };
}

module.exports = {
  id: "upwork",
  name: "Upwork",
  defaultUrl: DEFAULT_LISTING_URL,
  defaultTargetUrlPattern: TARGET_URL_PATTERN,
  capabilities: ["launch-browser", "list-jobs", "open-job", "generate-review", "prefill-application", "submit-application", "batch-prepare-applications", "batch-submit-applications"],
  loadSession,
  launchBrowserSession,
  connectBrowser,
  listJobs,
  openJob,
  captureCurrentJob,
  generateReview,
  submitPreparedApplications,
  fillProposal,
  getStatus,
  waitForResolvedUpworkPage
};
