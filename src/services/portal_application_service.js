"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../job_assistant_core");
const { getProvider } = require("../providers");
const logger = require("../logger");
const preferenceAgent = require("../job_preference_agent");
const queue = require("../application_queue");
const applicationAiService = require("./application_ai_service");

const DEFAULT_PROVIDER_ID = "upwork";

function providerOptionsFrom(providerId, input = {}) {
  const provider = getProvider(providerId || DEFAULT_PROVIDER_ID);
  return {
    browser: input.browser || "chrome",
    url: input.url || provider.defaultUrl,
    port: Number(input.port || 9222),
    targetUrlPattern: input.targetUrlPattern || provider.defaultTargetUrlPattern || "upwork.com",
    searchQuery: input.searchQuery || input.q || ""
  };
}

function selectedJobsFromRequest(providerId, input = {}) {
  const selected = preferenceAgent.selectedJobs(providerId);
  if (!input.urls || input.urls.length === 0) {
    return selected;
  }
  const urlSet = new Set(input.urls);
  return selected.filter((job) => urlSet.has(job.url));
}

async function withTimeout(task, timeoutMs, message) {
  let timeoutId = null;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function fallbackReviewFromSelection(job, profile, providerId) {
  const fallbackText = [job.title, job.summary].filter(Boolean).join("\n\n").trim();
  return core.draftFromText(job.title || "selected-job", fallbackText, profile, {
    provider: providerId,
    jobUrl: job.url,
    sourceTitle: job.title || "Selected job",
    connectsRequired: job.connectsRequired || null,
    isAvailable: true
  });
}

function draftSourceFrom(review, generator, error = null) {
  if (generator?.type) {
    return {
      draftSource: generator.type,
      generatorSummary: generator.summary || "Prepared with the local ChatGPT API."
    };
  }

  if (review?.generator?.type) {
    return {
      draftSource: review.generator.type,
      generatorSummary: review.generator.summary || "Prepared from a provider-specific fallback draft."
    };
  }

  if (error) {
    return {
      draftSource: "heuristic-fallback",
      generatorSummary: `Prepared with the local fallback draft because the local ChatGPT API was unavailable: ${error.message}`
    };
  }

  return {
    draftSource: "heuristic",
    generatorSummary: "Prepared with the local heuristic draft."
  };
}

async function prepareSelectedApplications(providerId, profile, input = {}) {
  const provider = getProvider(providerId);
  const selected = selectedJobsFromRequest(providerId, input);
  if (selected.length === 0) {
    throw new Error(`No selected ${provider.name} jobs are queued yet. Mark jobs with Apply first.`);
  }

  const prepared = [];
  for (const job of selected) {
    logger.appendLog("info", "Prepare selected started", {
      provider: providerId,
      url: job.url,
      title: job.title
    });

    let review = null;
    try {
      review = await withTimeout(
        () => provider.generateReview(profile, {
          ...providerOptionsFrom(providerId, input),
          url: job.url
        }),
        Number(input.prepareReviewTimeoutMs || 25000),
        `Timed out while capturing the ${provider.name} job page.`
      );
    } catch (error) {
      if (providerId !== "upwork") {
        throw error;
      }
      logger.appendLog("warn", "Upwork review capture timed out; using selected-card fallback", {
        provider: providerId,
        url: job.url,
        title: job.title,
        message: error.message
      });
      review = fallbackReviewFromSelection(job, profile, providerId);
      review.generator = {
        type: "fallback-card-summary",
        summary: "Prepared from the selected Upwork card summary because full page capture timed out."
      };
    }

    if (review.eligibility?.allowed === false) {
      const blockedDraft = draftSourceFrom(review, null);
      const blockedItem = queue.upsertItem({
        provider: providerId,
        url: job.url,
        title: review.sourceTitle || job.title,
        status: "blocked",
        reviewId: review.id,
        proposal: review.proposal,
        screeningAnswers: review.screeningAnswers || [],
        draftSource: blockedDraft.draftSource,
        generatorSummary: blockedDraft.generatorSummary,
        lastError: review.eligibility.blockers.join("; ")
      });
      preferenceAgent.labelJob({
        provider: providerId,
        url: job.url,
        title: review.sourceTitle || job.title,
        summary: job.summary || "",
        label: "reject",
        reason: review.eligibility.blockers.join("; ")
      });
      prepared.push({
        ...blockedItem,
        review
      });
      continue;
    }

    let finalReview = review;
    let generator = null;
    let aiError = null;
    try {
      const generated = await withTimeout(
        () => applicationAiService.generateFromReview(review, profile),
        Number(input.prepareAiTimeoutMs || input.prepareCodexTimeoutMs || 45000),
        "Timed out while the local ChatGPT API was generating the proposal draft."
      );
      finalReview = generated.review;
      generator = generated.generator;
    } catch (error) {
      aiError = error;
      logger.appendLog("warn", "AI prepare step failed; falling back to heuristic proposal", {
        provider: providerId,
        url: job.url,
        message: error.message
      });
    }

    const draftMeta = draftSourceFrom(finalReview, generator, aiError);
    const item = queue.upsertItem({
      provider: providerId,
      url: job.url,
      title: finalReview.sourceTitle || job.title,
      status: "prepared",
      reviewId: finalReview.id,
      proposal: finalReview.proposal,
      screeningAnswers: finalReview.screeningAnswers || [],
      draftSource: draftMeta.draftSource,
      generatorSummary: draftMeta.generatorSummary
    });
    prepared.push({
      ...item,
      generator,
      review: finalReview
    });
  }

  return prepared;
}

async function submitSelectedApplications(providerId, profile, input = {}) {
  const provider = getProvider(providerId);
  const selected = selectedJobsFromRequest(providerId, input);
  if (selected.length === 0) {
    throw new Error(`No selected ${provider.name} jobs are queued yet. Mark jobs with Apply first.`);
  }

  const preparedItems = [];
  for (const job of selected) {
    let queueItem = queue.listItems(providerId).find((item) => item.url === job.url && item.status === "prepared");
    let review = null;

    if (queueItem?.reviewId) {
      const reviewPath = path.join(core.REVIEWS_DIR, `${queueItem.reviewId}.json`);
      if (fs.existsSync(reviewPath)) {
        review = core.readJson(reviewPath);
      }
    }

    if (!review) {
      const [prepared] = await prepareSelectedApplications(providerId, profile, {
        ...input,
        urls: [job.url]
      });
      queueItem = prepared;
      review = prepared.review;
    }

    preparedItems.push({
      ...queueItem,
      review
    });
  }

  const results = await provider.submitPreparedApplications(preparedItems, profile, {
    ...providerOptionsFrom(providerId, input),
    submit: true,
    answerQuestion: (question, review, currentProfile) =>
      applicationAiService.answerSeekQuestion(question, review, currentProfile)
  });

  for (const result of results) {
    queue.upsertItem({
      provider: providerId,
      url: result.url,
      title: result.title,
      status: result.status,
      lastError: result.message || ""
    });
    if (result.status === "submitted") {
      preferenceAgent.labelJob({
        provider: providerId,
        url: result.url,
        title: result.title,
        label: "submitted",
        reason: "Submitted from portal"
      });
    }
  }

  return results;
}

module.exports = {
  providerOptionsFrom,
  selectedJobsFromRequest,
  prepareSelectedApplications,
  submitSelectedApplications
};
