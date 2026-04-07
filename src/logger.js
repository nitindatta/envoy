"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./job_assistant_core");

const LOG_DIR = path.join(core.AUTOMATION_DIR, "logs");
const PORTAL_LOG = path.join(LOG_DIR, "portal.log");

function ensureLogDir() {
  core.ensureDir(LOG_DIR);
}

function formatEntry(level, message, data = {}) {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data
  };
}

function appendLog(level, message, data = {}) {
  ensureLogDir();
  const entry = formatEntry(level, message, data);
  fs.appendFileSync(PORTAL_LOG, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

function writeDebugSnapshot(name, data) {
  ensureLogDir();
  const filePath = path.join(LOG_DIR, name);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

function parseLogLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readRecentEntries(limit = 100) {
  ensureLogDir();
  if (!fs.existsSync(PORTAL_LOG)) {
    return [];
  }

  const entries = fs.readFileSync(PORTAL_LOG, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLogLine)
    .filter(Boolean)
    .filter((entry) => entry.path !== "/api/activity");

  const size = Number(limit) > 0 ? Number(limit) : 100;
  return entries.slice(-size);
}

module.exports = {
  LOG_DIR,
  PORTAL_LOG,
  appendLog,
  readRecentEntries,
  writeDebugSnapshot
};
