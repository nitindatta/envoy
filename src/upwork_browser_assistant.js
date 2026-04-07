#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./job_assistant_core");
const upwork = require("./providers/upwork");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    browser: "chrome",
    url: upwork.defaultUrl,
    port: 9222,
    targetUrlPattern: "upwork.com",
    profile: core.DEFAULT_PROFILE,
    printPacket: false,
    submit: false,
    approval: "",
    jobFile: "",
    packetFile: ""
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--print-packet") {
      options.printPacket = true;
      continue;
    }
    if (arg === "--submit") {
      options.submit = true;
      continue;
    }
    const value = rest[i + 1];
    switch (arg) {
      case "--browser":
        options.browser = value;
        i += 1;
        break;
      case "--url":
        options.url = value;
        i += 1;
        break;
      case "--port":
        options.port = Number(value);
        i += 1;
        break;
      case "--target-url-pattern":
        options.targetUrlPattern = value;
        i += 1;
        break;
      case "--profile":
        options.profile = path.resolve(value);
        i += 1;
        break;
      case "--approval":
        options.approval = value;
        i += 1;
        break;
      case "--job-file":
        options.jobFile = path.resolve(value);
        i += 1;
        break;
      case "--packet-file":
        options.packetFile = path.resolve(value);
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function showHelp() {
  console.log("Commands:");
  console.log("  launch-browser");
  console.log("  list-jobs");
  console.log("  capture-current-job");
  console.log("  draft-current-job [--print-packet]");
  console.log("  draft-file --job-file <path> [--print-packet]");
  console.log("  prefill-current-application [--packet-file <path>]");
  console.log("  submit-current-application [--packet-file <path>] --approval I_APPROVE_SUBMIT");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command) {
    showHelp();
    return;
  }

  const profile = core.loadProfile(options.profile);

  switch (options.command) {
    case "launch-browser": {
      const session = await upwork.launchBrowserSession(options);
      console.log("Browser ready.");
      console.log(`Browser: ${session.browser}`);
      console.log(`Port: ${session.port}`);
      console.log(`Profile dir: ${session.profileDir}`);
      console.log("Next step: log in to Upwork in the opened browser window.");
      return;
    }

    case "list-jobs": {
      const jobs = await upwork.listJobs(options);
      console.log(`Saved visible jobs to: ${path.join(core.AUTOMATION_DIR, "visible-jobs.json")}`);
      jobs.forEach((job, index) => {
        console.log(`[${index + 1}] ${job.title}`);
        console.log(`    ${job.url}`);
      });
      return;
    }

    case "capture-current-job": {
      const captured = await upwork.captureCurrentJob(options);
      const jobPath = path.join(core.JOBS_DIR, `${core.slugify(captured.title)}.txt`);
      core.writeText(jobPath, captured.text);
      console.log(`Saved current job to: ${jobPath}`);
      console.log(`URL: ${captured.url}`);
      return;
    }

    case "draft-current-job": {
      const review = await upwork.generateReview(profile, options);
      console.log(`Saved job text to: ${review.jobPath}`);
      console.log(`Saved application packet to: ${review.packetPath}`);
      console.log(`Recommendation: ${review.fit.recommendation}`);
      console.log(`Fit score: ${review.fit.score}/100`);
      if (options.printPacket) console.log(`\n${review.packet}`);
      return;
    }

    case "draft-file": {
      if (!options.jobFile) throw new Error("Provide --job-file for draft-file.");
      const jobText = fs.readFileSync(options.jobFile, "utf8").trim();
      const review = core.draftFromText(path.basename(options.jobFile, path.extname(options.jobFile)), jobText, profile, {
        provider: "upwork",
        jobUrl: ""
      });
      console.log(`Saved application packet to: ${review.packetPath}`);
      console.log(`Recommendation: ${review.fit.recommendation}`);
      console.log(`Fit score: ${review.fit.score}/100`);
      if (options.printPacket) console.log(`\n${review.packet}`);
      return;
    }

    case "prefill-current-application":
    case "submit-current-application": {
      const shouldSubmit = options.command === "submit-current-application" || options.submit;
      if (shouldSubmit && options.approval !== "I_APPROVE_SUBMIT") {
        throw new Error("Submission is gated. Re-run with --approval I_APPROVE_SUBMIT only after you have reviewed the proposal in the browser.");
      }

      const packetPath = options.packetFile || core.latestPacketPath();
      const proposalText = core.proposalFromPacket(packetPath);
      const result = await upwork.fillProposal(proposalText, {
        ...options,
        submit: shouldSubmit
      });
      console.log("Proposal filled in current page.");
      console.log(`Target field: ${result.field}`);
      console.log(`Submit clicked: ${result.submitted}`);
      console.log(`Packet used: ${packetPath}`);
      return;
    }

    default:
      throw new Error(`Unsupported command: ${options.command}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
