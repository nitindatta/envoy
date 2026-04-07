const state = {
  provider: "upwork",
  providers: [],
  jobs: [],
  selectedJob: null,
  review: null,
  jobFilter: "active",
  queueSelected: [],
  queuePrepared: [],
  localActivity: [],
  serverActivity: [],
  activityPollId: null
};

const els = {
  providerTabs: document.getElementById("provider-tabs"),
  providerName: document.getElementById("provider-name"),
  providerRoadmap: document.getElementById("provider-roadmap"),
  searchQuery: document.getElementById("search-query"),
  runSearch: document.getElementById("run-search"),
  sessionStatus: document.getElementById("session-status"),
  jobsCount: document.getElementById("jobs-count"),
  jobsList: document.getElementById("jobs-list"),
  statusLog: document.getElementById("status-log"),
  reviewSummaryCard: document.getElementById("review-summary-card"),
  jobTitle: document.getElementById("job-title"),
  jobUrl: document.getElementById("job-url"),
  fitRecommendation: document.getElementById("fit-recommendation"),
  fitScore: document.getElementById("fit-score"),
  fitSkills: document.getElementById("fit-skills"),
  connectsRequired: document.getElementById("connects-required"),
  jobAvailability: document.getElementById("job-availability"),
  reasonsList: document.getElementById("reasons-list"),
  concernsList: document.getElementById("concerns-list"),
  jobText: document.getElementById("job-text"),
  proposalText: document.getElementById("proposal-text"),
  screeningText: document.getElementById("screening-text"),
  approvalInput: document.getElementById("approval-input"),
  launchBrowser: document.getElementById("launch-browser"),
  refreshJobs: document.getElementById("refresh-jobs"),
  loadLatestReview: document.getElementById("load-latest-review"),
  openJob: document.getElementById("open-job"),
  generateReview: document.getElementById("generate-review"),
  prefillProposal: document.getElementById("prefill-proposal"),
  generateCodex: document.getElementById("generate-codex"),
  submitProposal: document.getElementById("submit-proposal"),
  jobFilters: document.getElementById("job-filters"),
  queueCount: document.getElementById("queue-count"),
  queueList: document.getElementById("queue-list"),
  prepareSelected: document.getElementById("prepare-selected"),
  submitSelected: document.getElementById("submit-selected")
};

function currentProvider() {
  return state.providers.find((provider) => provider.id === state.provider) || null;
}

function currentCapabilities() {
  return new Set(currentProvider()?.capabilities || []);
}

function activityKey(prefix, entry) {
  return [
    prefix,
    entry.timestamp || "",
    entry.level || "info",
    entry.source || "",
    entry.message || "",
    entry.detail || ""
  ].join("|");
}

function activityDetail(entry) {
  const detail = [];
  if (entry.provider) detail.push(`provider=${entry.provider}`);
  if (entry.path) detail.push(`path=${entry.path}`);
  if (entry.method) detail.push(`method=${entry.method}`);
  if (entry.query && Object.keys(entry.query).length > 0) detail.push(`query=${JSON.stringify(entry.query)}`);
  if (entry.label) detail.push(`label=${entry.label}`);
  if (entry.title) detail.push(`title=${entry.title}`);
  if (entry.url) detail.push(`url=${entry.url}`);
  if (entry.pageUrl) detail.push(`pageUrl=${entry.pageUrl}`);
  if (entry.jobCount !== undefined && entry.jobCount !== null) detail.push(`jobCount=${entry.jobCount}`);
  if (entry.fitScore !== undefined && entry.fitScore !== null) detail.push(`fit=${entry.fitScore}`);
  if (entry.recommendation) detail.push(`recommendation=${entry.recommendation}`);
  if (entry.reason) detail.push(`reason=${entry.reason}`);
  if (entry.proposalLength) detail.push(`proposalChars=${entry.proposalLength}`);
  if (entry.count !== undefined && entry.count !== null) detail.push(`count=${entry.count}`);
  if (Array.isArray(entry.statuses) && entry.statuses.length > 0) {
    detail.push(`statuses=${entry.statuses.map((item) => `${item.title}:${item.status}`).join(", ")}`);
  }
  return detail.join(" | ");
}

function normalizeServerActivity(entry) {
  return {
    timestamp: entry.timestamp || new Date().toISOString(),
    level: entry.level || "info",
    source: "server",
    message: entry.message || "Server event",
    detail: activityDetail(entry),
    key: activityKey("server", {
      timestamp: entry.timestamp || "",
      level: entry.level || "info",
      source: "server",
      message: entry.message || "Server event",
      detail: activityDetail(entry)
    })
  };
}

function formatActivityTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString();
}

function renderActivity() {
  const merged = [...state.serverActivity, ...state.localActivity]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());

  const seen = new Set();
  const lines = [];
  for (const entry of merged) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    const prefix = `[${formatActivityTime(entry.timestamp)}] ${String(entry.level || "info").toUpperCase()} ${entry.source.toUpperCase()}`;
    lines.push(entry.detail ? `${prefix} ${entry.message} | ${entry.detail}` : `${prefix} ${entry.message}`);
    if (lines.length >= 120) break;
  }

  els.statusLog.textContent = lines.length > 0 ? lines.join("\n") : "Portal ready.";
  els.statusLog.scrollTop = 0;
}

function logStatus(message, level = "info", detail = "") {
  state.localActivity.unshift({
    timestamp: new Date().toISOString(),
    level,
    source: "portal",
    message,
    detail,
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`
  });
  state.localActivity = state.localActivity.slice(0, 80);
  renderActivity();
}

function setButtonBusy(element, busy, busyText = "Processing...") {
  if (!element) return;
  if (!element.dataset.label) {
    element.dataset.label = element.textContent.trim();
  }
  element.disabled = busy;
  element.dataset.busy = busy ? "true" : "false";
  element.textContent = busy ? busyText : element.dataset.label;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const payload = await response.json();
  if (!path.startsWith("/api/activity")) {
    queueActivityRefresh();
  }
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

async function loadActivity({ silent = true } = {}) {
  try {
    const data = await api("/api/activity?limit=120");
    state.serverActivity = (data.entries || []).map(normalizeServerActivity);
    renderActivity();
  } catch (error) {
    if (!silent) {
      logStatus(error.message, "error");
    }
  }
}

function queueActivityRefresh(delayMs = 250) {
  window.clearTimeout(state.activityPollId);
  state.activityPollId = window.setTimeout(() => {
    loadActivity({ silent: true });
  }, delayMs);
}

function lifecycleLabel(job) {
  if (job.isEligible === false) return "Blocked";
  if (job.lifecycle === "apply") return "Selected";
  if (job.lifecycle === "reject") return "Rejected";
  if (job.lifecycle === "submitted") return "Submitted";
  return "Active";
}

function renderJobFilters() {
  [...els.jobFilters.querySelectorAll("[data-filter]")].forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.jobFilter);
  });
}

function updateCapabilityState() {
  const capabilities = currentCapabilities();
  const supportsApply = capabilities.has("prefill-application");
  const supportsSubmit = capabilities.has("submit-application");
  const supportsBatchPrepare = capabilities.has("batch-prepare-applications");
  const supportsBatchSubmit = capabilities.has("batch-submit-applications");
  els.prefillProposal.disabled = !supportsApply;
  els.submitProposal.disabled = !supportsSubmit;
  els.approvalInput.disabled = !supportsSubmit && !supportsBatchSubmit;
  els.prepareSelected.disabled = !supportsBatchPrepare || state.queueSelected.length === 0;
  els.submitSelected.disabled = !supportsBatchSubmit || state.queueSelected.length === 0;
}

function renderProviderTabs() {
  els.providerTabs.innerHTML = "";
  state.providers.forEach((provider) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `provider-tab${provider.id === state.provider ? " active" : ""}`;
    button.textContent = provider.name;
    button.addEventListener("click", async () => {
      if (provider.id === state.provider) return;
      state.provider = provider.id;
      state.jobs = [];
      state.selectedJob = null;
      state.review = null;
      state.queueSelected = [];
      state.queuePrepared = [];
      renderProviderTabs();
      renderProviderMeta();
      renderJobFilters();
      renderReview(null);
      renderJobs();
      renderQueue();
      updateCapabilityState();
      await loadSession();
      await loadLatestReview();
      await loadQueue();
      logStatus(`Switched to ${provider.name}.`);
    });
    els.providerTabs.appendChild(button);
  });
}

function renderProviderMeta() {
  const provider = currentProvider();
  els.providerName.textContent = provider?.name || state.provider;
  els.launchBrowser.textContent = `Launch ${provider?.name || "Session"}`;
  els.providerRoadmap.textContent = state.providers
    .filter((item) => item.id !== state.provider)
    .map((item) => item.name)
    .join(", ") || "More providers later";
  els.searchQuery.placeholder = `Search ${provider?.name || "jobs"}`;
}

function selectJob(job) {
  state.selectedJob = job;
  if (!state.review || state.review.jobUrl !== job.url) {
    renderReview(null);
  }
  renderJobs();
  els.jobTitle.textContent = job.title;
  els.jobUrl.textContent = `${job.url}${job.connectsRequired ? ` | ${job.connectsRequired} Connects` : ""}`;
  els.connectsRequired.textContent = job.connectsRequired ? `${job.connectsRequired}` : (job.provider === "seek" ? "N/A" : "Unknown");
  els.jobAvailability.textContent = job.isAvailable === false ? "Unavailable" : "Available";
  logStatus(`Selected ${job.provider} job: ${job.title}`);
}

function renderJobs() {
  els.jobsCount.textContent = `${state.jobs.length} jobs`;
  els.jobsList.innerHTML = "";

  if (state.jobs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = `No ${state.jobFilter} jobs loaded yet.`;
    els.jobsList.appendChild(empty);
    return;
  }

  state.jobs.forEach((job) => {
    const item = document.createElement("div");
    item.className = `job-item${state.selectedJob?.url === job.url ? " active" : ""}`;
    item.tabIndex = 0;

    const header = document.createElement("div");
    header.className = "job-item-header";

    const textBlock = document.createElement("div");
    textBlock.innerHTML = `<h3>${job.title}</h3><p>${job.summary || job.url}</p>`;
    header.appendChild(textBlock);

    const pill = document.createElement("span");
    pill.className = `status-pill ${job.lifecycle || "active"}`;
    pill.textContent = lifecycleLabel(job);
    header.appendChild(pill);

    const meta = document.createElement("p");
    const providerCost = job.provider === "upwork"
      ? (job.connectsRequired ? `${job.connectsRequired} Connects` : "Connects unknown")
      : "No platform cost";
    const learning = job.whyShown || job.whyHidden || "";
    const blockers = job.isEligible === false && job.eligibilityBlockers?.length
      ? `Blocked: ${job.eligibilityBlockers.join(", ")}`
      : "";
    const detail = blockers || learning;
    meta.textContent = detail ? `${providerCost} | ${detail}` : providerCost;

    const actions = document.createElement("div");
    actions.className = "job-item-actions";

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.textContent = "Select";
    applyButton.disabled = job.isEligible === false;
    applyButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await labelJob(job, "apply");
      } catch (error) {
        logStatus(error.message);
        window.alert(error.message);
      }
    });

    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.textContent = "Reject";
    rejectButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      const reason = window.prompt("Why reject this job?", job.labelReason || "") || "";
      try {
        await labelJob(job, "reject", reason.trim());
      } catch (error) {
        logStatus(error.message);
        window.alert(error.message);
      }
    });

    actions.append(applyButton, rejectButton);
    item.append(header, meta, actions);
    item.addEventListener("click", () => selectJob(job));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectJob(job);
      }
    });
    els.jobsList.appendChild(item);
  });
}

function renderQueue() {
  const preparedByUrl = new Map(state.queuePrepared.map((item) => [item.url, item]));
  els.queueCount.textContent = `${state.queueSelected.length} selected`;
  els.queueList.innerHTML = "";

  if (state.queueSelected.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Mark jobs with Apply to build your active queue.";
    els.queueList.appendChild(empty);
    updateCapabilityState();
    return;
  }

  state.queueSelected.forEach((job) => {
    const prepared = preparedByUrl.get(job.url);
    const item = document.createElement("div");
    item.className = "queue-item";
    const title = document.createElement("h3");
    title.textContent = job.title;
    const status = document.createElement("p");
    const draftSource = prepared?.draftSource ? ` | Draft: ${prepared.draftSource}` : "";
    status.textContent = prepared?.status ? `Status: ${prepared.status}${draftSource}` : "Status: selected";
    const detail = document.createElement("p");
    detail.textContent = prepared?.lastError || prepared?.generatorSummary || (prepared?.proposal ? "Draft ready in queue." : "Awaiting prepare step.");
    const actions = document.createElement("div");
    actions.className = "queue-item-actions";

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.textContent = "Select";
    selectButton.addEventListener("click", async () => {
      try {
        await selectQueuedJob(job, prepared);
      } catch (error) {
        logStatus(error.message, "error");
        window.alert(error.message);
      }
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      try {
        await removeQueuedJob(job);
      } catch (error) {
        logStatus(error.message);
        window.alert(error.message);
      }
    });

    actions.append(selectButton, removeButton);
    item.append(title, status, detail, actions);
    els.queueList.appendChild(item);
  });
  updateCapabilityState();
}

async function loadReviewById(reviewId) {
  const data = await api(`/api/reviews/by-id?reviewId=${encodeURIComponent(reviewId)}`);
  return data.review || null;
}

function promoteReviewToDesk(job, review, prepared) {
  state.selectedJob = {
    ...job,
    provider: state.provider,
    url: review.jobUrl || job.url,
    title: review.sourceTitle || job.title,
    isAvailable: review.isAvailable !== false,
    connectsRequired: review.connectsRequired || null
  };
  renderJobs();
  renderReview(review);
  if (els.reviewSummaryCard && typeof els.reviewSummaryCard.scrollIntoView === "function") {
    els.reviewSummaryCard.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  logStatus(`Selected queued job: ${job.title}`, "info", `status=${prepared?.status || "prepared"} | review desk updated`);
}

async function selectQueuedJob(job, prepared) {
  const matchingJob = state.jobs.find((entry) => entry.url === job.url) || {
    ...job,
    provider: state.provider,
    connectsRequired: null,
    isAvailable: true
  };

  selectJob(matchingJob);

  if (prepared?.review) {
    promoteReviewToDesk(matchingJob, prepared.review, prepared);
    return;
  }

  if (prepared?.reviewId) {
    const review = await loadReviewById(prepared.reviewId);
    if (review) {
      promoteReviewToDesk(matchingJob, review, prepared);
      return;
    }
  }

  logStatus(`Selected queued job: ${job.title}`, "info", `status=${prepared?.status || "selected"} | no saved review restored`);
}

function renderList(listEl, items, emptyText) {
  listEl.innerHTML = "";
  const values = items && items.length ? items : [emptyText];
  values.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = entry;
    listEl.appendChild(li);
  });
}

function renderReview(review) {
  state.review = review;
  if (!review) {
    els.fitRecommendation.textContent = "Pending";
    els.fitScore.textContent = "-";
    els.fitSkills.textContent = "-";
    els.connectsRequired.textContent = "-";
    els.jobAvailability.textContent = "-";
    renderList(els.reasonsList, [], "Generate a review to see fit reasons.");
    renderList(els.concernsList, [], "No risks loaded.");
    els.jobText.value = "";
    els.proposalText.value = "";
    els.screeningText.value = "";
    return;
  }

  els.jobTitle.textContent = review.sourceTitle || review.jobName;
  els.jobUrl.textContent = review.jobUrl || "Captured from current provider page";
  els.fitRecommendation.textContent = review.fit.recommendation;
  els.fitScore.textContent = `${review.fit.score}/100`;
  els.fitSkills.textContent = review.fit.matchedSkills.length ? review.fit.matchedSkills.join(", ") : "None detected";
  els.connectsRequired.textContent = review.connectsRequired ? `${review.connectsRequired}` : (review.provider === "seek" ? "N/A" : "Unknown");
  els.jobAvailability.textContent = review.isAvailable === false ? "Unavailable" : "Available";
  renderList(els.reasonsList, review.fit.reasons, "No fit reasons detected.");
  renderList(els.concernsList, review.fit.concerns, "No major fit concerns detected.");
  els.jobText.value = review.jobText || "";
  els.proposalText.value = review.proposal || "";
  els.screeningText.value = (review.screeningAnswers || []).join("\n\n");
}

async function loadProviders() {
  const data = await api("/api/providers");
  state.providers = data.providers;
  if (!state.providers.some((provider) => provider.id === state.provider) && state.providers.length > 0) {
    state.provider = state.providers[0].id;
  }
  renderProviderTabs();
  renderProviderMeta();
  renderJobFilters();
  updateCapabilityState();
}

async function loadSession() {
  const data = await api(`/api/session?provider=${state.provider}`);
  els.sessionStatus.textContent = data.status.available ? "Connected" : "Not launched";
}

async function loadQueue() {
  const data = await api(`/api/queue?provider=${state.provider}`);
  state.queueSelected = data.selected || [];
  state.queuePrepared = data.prepared || [];
  renderQueue();
}

async function refreshJobs() {
  const searchQuery = els.searchQuery.value.trim();
  const provider = currentProvider();
  const queryString = new URLSearchParams({
    provider: state.provider,
    filter: state.jobFilter,
    ...(searchQuery ? { searchQuery } : {})
  });
  logStatus(`Refreshing ${provider?.name || state.provider} ${state.jobFilter} jobs${searchQuery ? ` for "${searchQuery}"` : ""}.`);
  const data = await api(`/api/jobs?${queryString.toString()}`);
  state.jobs = data.jobs;
  if (state.selectedJob) {
    state.selectedJob = state.jobs.find((job) => job.url === state.selectedJob.url) || null;
  }
  renderJobs();
  await loadQueue();
  logStatus(`Loaded ${state.jobs.length} visible jobs.`);
}

async function loadLatestReview() {
  const data = await api(`/api/reviews/latest?provider=${state.provider}`);
  if (!data.review) {
    renderReview(null);
    logStatus(`No saved ${state.provider} review found yet.`);
    return;
  }
  renderReview(data.review);
  logStatus(`Loaded latest review: ${data.review.sourceTitle || data.review.jobName}`);
}

async function launchBrowser() {
  const provider = currentProvider();
  const payload = {
    provider: state.provider,
    ...(els.searchQuery.value.trim() ? { searchQuery: els.searchQuery.value.trim() } : {})
  };
  logStatus(`Launching dedicated ${provider?.name || state.provider} automation session.`);
  await api("/api/providers/launch", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await loadSession();
  logStatus(`${provider?.name || state.provider} browser session ready. Log in if needed.`);
}

async function openSelectedJob() {
  if (!state.selectedJob) {
    throw new Error("Select a job first.");
  }
  logStatus("Opening selected job in the live provider session.");
  await api("/api/jobs/open", {
    method: "POST",
    body: JSON.stringify({
      provider: state.provider,
      url: state.selectedJob.url
    })
  });
  logStatus("Selected job opened in the automation browser.");
}

async function generateReview() {
  logStatus("Generating a fresh review packet from the selected or current provider page.");
  const data = await api("/api/reviews/generate", {
    method: "POST",
    body: JSON.stringify({
      provider: state.provider,
      url: state.selectedJob?.url || ""
    })
  });
  renderReview(data.review);
  logStatus(`Review generated for ${data.review.sourceTitle || data.review.jobName}.`);
}

async function prefillProposal() {
  const proposalText = els.proposalText.value.trim();
  if (!proposalText) {
    throw new Error("Proposal text is empty.");
  }
  logStatus("Prefilling the current provider application form.");
  await api("/api/application/prefill", {
    method: "POST",
    body: JSON.stringify({
      provider: state.provider,
      proposalText
    })
  });
  logStatus("Proposal text pushed to the current provider form.");
}

async function generateViaCodex() {
  if (!state.review) {
    throw new Error("Generate a review first so Codex has grounded job context.");
  }
  logStatus("Sending the current review to Codex CLI for grounded proposal generation.");
  setButtonBusy(els.generateCodex, true, "Generating...");
  try {
    const data = await api("/api/proposal/generate-codex", {
      method: "POST",
      body: JSON.stringify({
        provider: state.provider,
        reviewId: state.review.id
      })
    });
    renderReview(data.review);
    const summary = data.generator?.summary ? ` ${data.generator.summary}` : "";
    logStatus(`Codex draft loaded.${summary}`);
  } finally {
    setButtonBusy(els.generateCodex, false);
    updateCapabilityState();
  }
}

async function submitProposal() {
  const proposalText = els.proposalText.value.trim();
  if (!proposalText) {
    throw new Error("Proposal text is empty.");
  }
  logStatus("Submitting through the portal into the live provider session.");
  await api("/api/application/submit", {
    method: "POST",
    body: JSON.stringify({
      provider: state.provider,
      proposalText,
      approval: els.approvalInput.value.trim()
    })
  });
  logStatus("Submit action sent to the provider session.");
}

async function labelJob(job, label, reason = "") {
  await api("/api/jobs/label", {
    method: "POST",
    body: JSON.stringify({
      provider: state.provider,
      url: job.url,
      title: job.title,
      summary: job.summary,
      label,
      reason
    })
  });

  state.jobs = state.jobs
    .map((entry) => entry.url === job.url ? {
      ...entry,
      lifecycle: label,
      labelReason: reason || entry.labelReason || ""
    } : entry)
    .filter((entry) => {
      if (state.jobFilter === "active") {
        return entry.lifecycle !== "apply" &&
          entry.lifecycle !== "reject" &&
          entry.lifecycle !== "submitted";
      }
      if (state.jobFilter === "selected") {
        return entry.lifecycle === "apply";
      }
      if (state.jobFilter === "rejected") {
        return entry.lifecycle === "reject";
      }
      return true;
    });

  logStatus(`${label === "reject" ? "Rejected" : "Selected"} ${job.title}.`);
  renderJobs();
  await loadQueue();
}

async function prepareSelected() {
  if (state.queueSelected.length === 0) {
    throw new Error("No selected jobs are queued yet.");
  }
  logStatus(`Preparing ${state.queueSelected.length} selected ${currentProvider()?.name || state.provider} jobs for application.`);
  setButtonBusy(els.prepareSelected, true, "Preparing...");
  try {
    const data = await api("/api/applications/prepare-selected", {
      method: "POST",
      body: JSON.stringify({
        provider: state.provider,
        urls: state.queueSelected.map((job) => job.url)
      })
    });
    state.queuePrepared = data.items || [];
    renderQueue();
    logStatus(`Prepared ${state.queuePrepared.length} selected applications.`);

    const nextPrepared = state.queuePrepared.find((item) => item.review) || state.queuePrepared[0] || null;
    if (nextPrepared) {
      const matchingJob = state.queueSelected.find((job) => job.url === nextPrepared.url) || {
        url: nextPrepared.url,
        title: nextPrepared.title,
        provider: state.provider,
        summary: "",
        connectsRequired: null,
        isAvailable: true
      };
      await selectQueuedJob(matchingJob, nextPrepared);
      logStatus(`Prepared job promoted to the review desk: ${nextPrepared.title}.`);
    }
  } finally {
    setButtonBusy(els.prepareSelected, false);
    updateCapabilityState();
  }
}

async function removeQueuedJob(job) {
  await api("/api/queue/remove", {
    method: "POST",
    body: JSON.stringify({
      provider: state.provider,
      url: job.url,
      title: job.title,
      summary: job.summary || ""
    })
  });

  state.queueSelected = state.queueSelected.filter((entry) => entry.url !== job.url);
  state.queuePrepared = state.queuePrepared.filter((entry) => entry.url !== job.url);

  if (state.jobFilter === "active") {
    const exists = state.jobs.some((entry) => entry.url === job.url);
    if (!exists) {
      state.jobs.unshift({
        ...job,
        provider: state.provider,
        lifecycle: "removed",
        connectsRequired: null,
        isAvailable: true
      });
    }
  }

  renderJobs();
  renderQueue();
  logStatus(`Removed ${job.title} from the selected queue.`);
}

async function submitSelected() {
  if (state.queueSelected.length === 0) {
    throw new Error("No selected jobs are queued yet.");
  }
  logStatus(`Submitting ${state.queueSelected.length} selected ${currentProvider()?.name || state.provider} jobs through the portal.`);
  setButtonBusy(els.submitSelected, true, "Submitting...");
  try {
    const data = await api("/api/applications/submit-selected", {
      method: "POST",
      body: JSON.stringify({
        provider: state.provider,
        urls: state.queueSelected.map((job) => job.url),
        approval: els.approvalInput.value.trim()
      })
    });
    state.queuePrepared = data.items || [];
    renderQueue();
    const summary = state.queuePrepared.map((item) => `${item.title}: ${item.status}`).join(" | ");
    await loadQueue();
    const pausedItem = state.queuePrepared.find((item) => item.status === "paused" || item.status === "blocked");
    if (pausedItem) {
      const matchingJob = state.queueSelected.find((job) => job.url === pausedItem.url) || {
        url: pausedItem.url,
        title: pausedItem.title,
        provider: state.provider,
        summary: "",
        connectsRequired: null,
        isAvailable: true
      };
      await selectQueuedJob(matchingJob, pausedItem);
    }
    logStatus(`Batch result: ${summary}`);
  } finally {
    setButtonBusy(els.submitSelected, false);
    updateCapabilityState();
  }
}

function wireButton(element, action) {
  element.addEventListener("click", async () => {
    try {
      await action();
    } catch (error) {
      logStatus(error.message);
      window.alert(error.message);
    }
  });
}

wireButton(els.launchBrowser, launchBrowser);
wireButton(els.refreshJobs, refreshJobs);
wireButton(els.runSearch, refreshJobs);
wireButton(els.loadLatestReview, loadLatestReview);
wireButton(els.openJob, openSelectedJob);
wireButton(els.generateReview, generateReview);
wireButton(els.prefillProposal, prefillProposal);
wireButton(els.generateCodex, generateViaCodex);
wireButton(els.submitProposal, submitProposal);
wireButton(els.prepareSelected, prepareSelected);
wireButton(els.submitSelected, submitSelected);
els.jobFilters.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.jobFilter = button.dataset.filter;
  renderJobFilters();
  try {
    await refreshJobs();
  } catch (error) {
    logStatus(error.message);
    window.alert(error.message);
  }
});
els.searchQuery.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  try {
    await refreshJobs();
  } catch (error) {
    logStatus(error.message);
    window.alert(error.message);
  }
});

(async () => {
  try {
    await loadProviders();
    await loadActivity();
    await loadSession();
    await loadLatestReview();
    await loadQueue();
    await refreshJobs();
    window.setInterval(() => {
      loadActivity({ silent: true });
    }, 3000);
  } catch (error) {
    logStatus(error.message, "error");
  }
})();
