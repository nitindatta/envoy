"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../job_assistant_core");
const logger = require("../logger");
const chatGptApiClient = require("../clients/chatgpt_api_client");

const AI_WORK_DIR = path.join(core.AUTOMATION_DIR, "codex-cli");
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    proposal: { type: "string" },
    screeningAnswers: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 4
    },
    summary: { type: "string" }
  },
  required: ["proposal", "screeningAnswers", "summary"],
  additionalProperties: false
};
const SEEK_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    summary: { type: "string" }
  },
  required: ["answer", "confidence", "summary"],
  additionalProperties: false
};

function ensureAiWorkingFiles() {
  core.ensureDir(AI_WORK_DIR);
}

function writeJsonNoBom(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function buildPromptPayload(review, profile) {
  return {
    provider: review.provider,
    sourceTitle: review.sourceTitle,
    jobUrl: review.jobUrl,
    connectsRequired: review.connectsRequired,
    fit: review.fit,
    focusTerms: review.focusTerms,
    extractedRequirements: core.extractRequirementLines(review.jobText, 8),
    extractedSkills: core.extractRequiredSkills(review.jobText, profile, 8),
    extractedConstraints: core.extractClientConstraints(review.jobText, 5),
    extractedPriorities: core.extractClientPriorities(review.jobText, 5),
    profile: {
      name: profile.name,
      headline: profile.headline,
      summary: profile.summary,
      core_strengths: profile.core_strengths,
      proposal_preferences: profile.proposal_preferences,
      experience: profile.experience,
      selected_projects: profile.selected_projects,
      certifications: profile.certifications
    },
    currentHeuristicProposal: review.proposal,
    jobText: review.jobText
  };
}

function buildPrompt(review, profile) {
  const promptPayload = buildPromptPayload(review, profile);
  const isSeek = review.provider === "seek";
  const providerName = isSeek ? "SEEK Australia cover letter" : "Upwork proposal";
  return [
    isSeek
      ? `You are generating a grounded ${providerName} for a direct job applicant.`
      : `You are generating a grounded ${providerName} for a freelancer.`,
    "Return JSON matching the provided schema.",
    isSeek
      ? "Write in a credible, senior job applicant voice."
      : "Write in a credible, senior freelancer voice.",
    "The proposal must be tailored to the job, not generic.",
    "Reference concrete needs from the brief and connect them to the provided profile evidence.",
    "Do not invent skills, clients, employers, or project outcomes that are not in the profile.",
    "Do not mention being an AI, language model, template, or assistant.",
    "Avoid markdown bullets in the proposal body; use short paragraphs.",
    "Make the proposal persuasive and specific, showing you understood the job in depth.",
    isSeek
      ? "For SEEK, make it sound like a real cover letter for an Australian employer."
      : "For Upwork, make it sound like a real cover letter from the freelancer.",
    "Keep the proposal concise but substantial, around 180-320 words.",
    "Provide 2-3 screening answers tailored to the job.",
    "",
    "INPUT JSON:",
    JSON.stringify(promptPayload, null, 2)
  ].join("\n");
}

function buildSeekQuestionPrompt(question, review, profile) {
  const payload = {
    provider: "seek",
    question,
    review: {
      id: review.id,
      sourceTitle: review.sourceTitle,
      jobUrl: review.jobUrl,
      fit: review.fit,
      proposal: review.proposal,
      jobText: review.jobText
    },
    profile: {
      name: profile.name,
      location: profile.location,
      summary: profile.summary,
      core_strengths: profile.core_strengths,
      experience: profile.experience,
      certifications: profile.certifications
    }
  };

  return {
    payload,
    prompt: [
      "You are answering one SEEK application question for a real candidate in Australia.",
      "Return JSON matching the provided schema.",
      "Answer only with information grounded in the supplied profile and job review.",
      "Use concise, credible wording suitable for an application form.",
      "Mark confidence as high only when the answer is directly supported by the profile or explicit user facts.",
      "If the question asks about legal right to work in Australia, permanent residency, or sponsorship, use the provided user fact when relevant.",
      "",
      "INPUT JSON:",
      JSON.stringify(payload, null, 2)
    ].join("\n")
  };
}

async function generateFromReview(review, profile) {
  ensureAiWorkingFiles();
  const id = `${review.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const schemaPath = path.join(AI_WORK_DIR, `${id}.schema.json`);
  const outputPath = path.join(AI_WORK_DIR, `${id}.output.json`);
  const promptPath = path.join(AI_WORK_DIR, `${id}.prompt.txt`);
  const contextPath = path.join(AI_WORK_DIR, `${id}.context.json`);
  const runLogPath = path.join(AI_WORK_DIR, `${id}.run.json`);
  writeJsonNoBom(schemaPath, RESPONSE_SCHEMA);

  const promptPayload = buildPromptPayload(review, profile);
  const prompt = buildPrompt(review, profile);
  fs.writeFileSync(promptPath, prompt, "utf8");
  writeJsonNoBom(contextPath, promptPayload);
  logger.appendLog("info", "Local ChatGPT API proposal generation started", {
    reviewId: review.id,
    promptPath,
    contextPath,
    schemaPath,
    outputPath
  });

  const result = await chatGptApiClient.requestStructuredJson({
    prompt,
    schema: RESPONSE_SCHEMA,
    schemaName: "job_application_output"
  });
  writeJsonNoBom(outputPath, result.parsed);
  writeJsonNoBom(runLogPath, {
    reviewId: review.id,
    apiBaseUrl: result.baseUrl,
    model: result.model,
    promptPath,
    contextPath,
    schemaPath,
    outputPath,
    response: result.raw
  });
  const parsed = result.parsed;

  const updatedReview = core.persistReview(
    {
      ...review,
      proposal: parsed.proposal.trim(),
      screeningAnswers: parsed.screeningAnswers.map((item) => item.trim()).filter(Boolean),
      generator: {
        type: "chatgpt-api",
        summary: parsed.summary,
        generatedAt: new Date().toISOString()
      }
    },
    profile
  );

  return {
    review: updatedReview,
    generator: {
      ...updatedReview.generator,
      promptPath,
      contextPath,
      schemaPath,
      outputPath,
      runLogPath
    }
  };
}

async function answerSeekQuestion(question, review, profile) {
  ensureAiWorkingFiles();
  const id = `seek-question-${review.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const schemaPath = path.join(AI_WORK_DIR, `${id}.schema.json`);
  const outputPath = path.join(AI_WORK_DIR, `${id}.output.json`);
  const promptPath = path.join(AI_WORK_DIR, `${id}.prompt.txt`);
  const contextPath = path.join(AI_WORK_DIR, `${id}.context.json`);
  const runLogPath = path.join(AI_WORK_DIR, `${id}.run.json`);
  const { payload, prompt } = buildSeekQuestionPrompt(question, review, profile);

  writeJsonNoBom(schemaPath, SEEK_QUESTION_SCHEMA);
  fs.writeFileSync(promptPath, prompt, "utf8");
  writeJsonNoBom(contextPath, payload);
  logger.appendLog("info", "Local ChatGPT API SEEK question answering started", {
    reviewId: review.id,
    question,
    promptPath,
    contextPath,
    schemaPath,
    outputPath
  });

  const result = await chatGptApiClient.requestStructuredJson({
    prompt,
    schema: SEEK_QUESTION_SCHEMA,
    schemaName: "seek_question_output"
  });
  writeJsonNoBom(outputPath, result.parsed);
  writeJsonNoBom(runLogPath, {
    reviewId: review.id,
    question,
    apiBaseUrl: result.baseUrl,
    model: result.model,
    promptPath,
    contextPath,
    schemaPath,
    outputPath,
    response: result.raw
  });
  const parsed = result.parsed;
  return {
    answer: String(parsed.answer || "").trim(),
    confidence: parsed.confidence,
    summary: parsed.summary,
    promptPath,
    contextPath,
    schemaPath,
    outputPath,
    runLogPath
  };
}

module.exports = {
  buildPromptPayload,
  buildPrompt,
  buildSeekQuestionPrompt,
  generateFromReview,
  answerSeekQuestion
};
