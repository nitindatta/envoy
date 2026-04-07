"use strict";

const path = require("path");
const core = require("./job_assistant_core");

const QUEUE_FILE = path.join(core.AUTOMATION_DIR, "application-queue.json");

function loadQueue() {
  if (!require("fs").existsSync(QUEUE_FILE)) {
    return { items: [] };
  }
  return core.readJson(QUEUE_FILE);
}

function saveQueue(queue) {
  core.writeJson(QUEUE_FILE, queue);
  return queue;
}

function upsertItem(item) {
  const queue = loadQueue();
  const index = queue.items.findIndex((entry) => entry.provider === item.provider && entry.url === item.url);
  const next = {
    provider: item.provider,
    url: item.url,
    title: item.title || "",
    status: item.status || "selected",
    reviewId: item.reviewId || "",
    proposal: item.proposal || "",
    screeningAnswers: item.screeningAnswers || [],
    draftSource: item.draftSource || "",
    generatorSummary: item.generatorSummary || "",
    lastError: item.lastError || "",
    updatedAt: new Date().toISOString()
  };
  if (index >= 0) {
    queue.items[index] = { ...queue.items[index], ...next };
  } else {
    queue.items.push(next);
  }
  saveQueue(queue);
  return next;
}

function listItems(provider) {
  return loadQueue().items
    .filter((item) => !provider || item.provider === provider)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function removeItem(provider, url) {
  const queue = loadQueue();
  queue.items = queue.items.filter((item) => !(item.provider === provider && item.url === url));
  saveQueue(queue);
  return true;
}

module.exports = {
  QUEUE_FILE,
  loadQueue,
  saveQueue,
  upsertItem,
  listItems,
  removeItem
};
