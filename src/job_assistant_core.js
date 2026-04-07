const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROFILE = path.join(ROOT, "profile", "nitin_datta_profile.json");
const JOBS_DIR = path.join(ROOT, "jobs");
const APPLICATIONS_DIR = path.join(ROOT, "applications");
const AUTOMATION_DIR = path.join(ROOT, "automation");
const REVIEWS_DIR = path.join(AUTOMATION_DIR, "reviews");

const ROLE_KEYWORDS = {
  ai: ["llm", "rag", "embedding", "embeddings", "semantic search", "agent", "agents", "ai", "genai", "openai", "prompt", "vector"],
  data: ["databricks", "spark", "pyspark", "delta lake", "dbt", "dagster", "airflow", "etl", "elt", "data pipeline", "ingestion", "warehouse", "lakehouse"],
  cloud: ["aws", "azure", "lambda", "glue", "s3", "kinesis", "redshift", "data factory", "serverless"],
  architecture: ["microservices", "distributed systems", "system design", "integration", "api", "backend", "scalable", "reliable", "architecture"]
};

const NEGATIVE_KEYWORDS = {
  frontend_only: ["figma", "shopify", "wordpress", "webflow", "landing page", "ui designer"],
  mobile_only: ["swift", "kotlin", "react native", "flutter", "ios", "android"],
  mismatch: ["logo design", "video editing", "seo backlink", "virtual assistant", "bookkeeping"]
};

const PROPOSAL_STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "this", "that", "from", "have", "will", "are", "job",
  "project", "work", "need", "looking", "developer", "engineer", "experience", "team", "build", "data",
  "into", "than", "then", "they", "them", "their", "there", "here", "what", "when", "where", "which",
  "while", "about", "across", "through", "would", "could", "should", "more", "less", "very", "only",
  "also", "used", "using", "based", "already", "phase", "summary", "posted", "worldwide", "hourly",
  "duration", "expert", "client", "proposal", "connects", "apply", "save", "rating"
]);

const REQUIREMENT_SIGNAL_TERMS = [
  "build", "design", "implement", "integrate", "orchestrate", "workflow", "pipeline", "system",
  "automation", "decision", "delegation", "reports", "reporting", "portal", "authentication", "security",
  "iam", "service account", "api", "mapping", "delivery", "scale", "scalable", "internal systems",
  "founder", "operator", "structured", "routing", "gcp", "vertex", "suitedash", "fillout", "gemini",
  "magic link", "json", "cloud", "architecture"
];

const HEADER_LINES = new Set([
  "summary", "project overview", "scope", "scope of responsibilities", "your mission",
  "desired qualifications", "you", "inputs", "outputs", "success", "mandatory skills",
  "preferred qualifications", "the technical stack", "constraints", "trial", "apply",
  "job details", "about", "final", "mission"
]);

const UPWORK_UNAVAILABLE_PATTERNS = [
  "this job is no longer available",
  "job is no longer available",
  "job posting has expired",
  "this posting is no longer available",
  "this job is currently unavailable",
  "job not found",
  "just a moment",
  "cloudflare ray id"
];

const SEEK_HARD_BLOCKERS = [
  {
    pattern: /\bnegative vetting level 1\b|\bnv1\b/i,
    reason: "Requires NV1 security clearance"
  },
  {
    pattern: /\baustralian citizenship required\b|\brequire(?:s|d)? australian citizenship\b|\bmust be an australian citizen\b|\bmust hold australian citizenship\b|\bonly australian citizens\b|\bcitizenship is mandatory\b/i,
    reason: "Requires Australian citizenship"
  }
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function uniquePreserveOrder(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(key);
  }
  return output;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "application";
}

function loadProfile(profilePath = DEFAULT_PROFILE) {
  return readJson(profilePath);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skillMatchesText(skill, text) {
  const normalizedSkill = skill.toLowerCase();
  const escaped = escapeRegex(normalizedSkill);
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return pattern.test(text);
}

function collectSkillMatches(jobText, profile) {
  const text = normalize(jobText);
  const matchedSkills = profile.core_strengths.filter((skill) => skillMatchesText(skill, text));
  const matchedDomains = Object.entries(ROLE_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([domain]) => domain);

  return {
    matchedSkills: uniqueSorted(matchedSkills),
    matchedDomains: uniqueSorted(matchedDomains)
  };
}

function scoreJob(jobText, profile) {
  const text = normalize(jobText);
  const { matchedSkills, matchedDomains } = collectSkillMatches(jobText, profile);
  let score = 45;
  const reasons = [];
  const concerns = [];

  score += Math.min(matchedSkills.length * 4, 28);
  score += matchedDomains.length * 6;

  if (/\b(senior|architect|lead|principal)\b/.test(text)) {
    score += 5;
    reasons.push("The role signals senior ownership, which aligns with your background.");
  }
  if (/\b(databricks|spark|dbt|azure|aws)\b/.test(text)) {
    reasons.push("The stack overlaps strongly with your recent data platform work.");
  }
  if (/\b(llm|rag|agent|embedding|semantic search)\b/.test(text)) {
    reasons.push("The brief includes AI system patterns that match your current positioning.");
  }

  for (const [category, keywords] of Object.entries(NEGATIVE_KEYWORDS)) {
    if (!keywords.some((keyword) => text.includes(keyword))) continue;
    if (category === "frontend_only") {
      score -= 18;
      concerns.push("The brief leans toward frontend or site-builder work rather than backend/data/AI delivery.");
    } else if (category === "mobile_only") {
      score -= 14;
      concerns.push("The brief looks mobile-app heavy, which is weaker overlap with your stated focus.");
    } else {
      score -= 25;
      concerns.push("The brief appears outside your target service mix.");
    }
  }

  if (text.includes("commission only") || text.includes("equity only")) {
    score -= 20;
    concerns.push("Compensation terms look weak for the level of work requested.");
  }
  if (matchedSkills.length === 0 && matchedDomains.length === 0) {
    score -= 18;
    concerns.push("There are very few direct keyword overlaps with your current profile.");
  }

  score = Math.max(0, Math.min(100, score));
  let recommendation = "Skip";
  if (score >= 80) recommendation = "Strong fit";
  else if (score >= 65) recommendation = "Worth applying";
  else if (score >= 50) recommendation = "Borderline";

  if (reasons.length === 0) {
    reasons.push("You have broad architecture and data-platform experience that may still translate well if the client values end-to-end delivery.");
  }

  return { score, recommendation, matchedSkills, matchedDomains, reasons, concerns };
}

function extractFocusTerms(jobText, profile, limit = 8) {
  const text = normalize(jobText);
  const candidates = profile.core_strengths.filter((skill) => skillMatchesText(skill, text));
  if (candidates.length >= limit) return candidates.slice(0, limit);

  const stopwords = new Set([...PROPOSAL_STOPWORDS, "rating", "posted", "worldwide", "client", "skills", "expertise"]);
  const candidateSet = new Set(candidates.map((item) => item.toLowerCase()));
  const counts = new Map();
  const matches = jobText.toLowerCase().match(/[a-zA-Z][a-zA-Z+#.\-/]{2,}/g) || [];
  for (const token of matches) {
    if (stopwords.has(token) || candidateSet.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const extras = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token);

  return [...candidates, ...extras].slice(0, limit);
}

function proposalTokens(text) {
  return (text.toLowerCase().match(/[a-zA-Z][a-zA-Z+#.\-/]{2,}/g) || [])
    .filter((token) => !PROPOSAL_STOPWORDS.has(token));
}

function cleanLine(line) {
  return line
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-:*>\s]+/, "")
    .trim();
}

function isNoiseLine(line) {
  const text = line.toLowerCase();
  if (!text) return true;
  if (text.length < 3) return true;
  const bannedFragments = [
    "find work", "saved jobs", "proposals and offers", "reach more clients", "deliver work", "manage finances",
    "financial overview", "transactions", "certificate of earnings", "withdraw earnings", "payment method verified",
    "member since", "jobs posted", "hire rate", "avg hourly rate paid", "upgrade your membership", "apply now",
    "save job", "flag as inappropriate", "send a proposal for", "available connects", "other open jobs by this client",
    "client's recent history", "view more", "last viewed by client", "interviewing:", "invites sent:", "unanswered invites:",
    "rating is", "hours", "billed:", "to freelancer:", "key points:", "copy link", "job link", "about the client",
    "activity on this job", "project type:", "hourly range", "hourly", "duration", "expert", "worldwide"
  ];
  return bannedFragments.some((fragment) => text.includes(fragment));
}

function cleanJobLines(jobText) {
  return uniquePreserveOrder(
    jobText
      .split(/\r?\n/)
      .map((line) => cleanLine(line))
      .filter((line) => !isNoiseLine(line))
  );
}

function looksLikeHeading(line) {
  const lower = line.toLowerCase();
  if (HEADER_LINES.has(lower)) return true;
  if (line.length <= 40 && /^[A-Z][A-Za-z0-9/&():' -]+$/.test(line) && !/[.?!]$/.test(line)) return true;
  if (/^(phase \d+|inputs|outputs|scope|summary|project overview|desired qualifications|mandatory skills|preferred qualifications|the technical stack|your mission|job details)\b/i.test(line)) return true;
  return false;
}

function extractRequirementLines(jobText, limit = 6) {
  const lines = cleanJobLines(jobText);
  const results = [];
  let currentHeader = "";
  const excludedFirstLines = new Set(lines.slice(0, 3).map((line) => line.toLowerCase()));
  const candidates = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (HEADER_LINES.has(lower)) {
      currentHeader = lower;
      continue;
    }

    if (excludedFirstLines.has(lower) && !currentHeader) continue;
    if (looksLikeHeading(line)) continue;

    const signaled = REQUIREMENT_SIGNAL_TERMS.some((term) => lower.includes(term));
    const contextBoost = Boolean(currentHeader) && line.length >= 18;
    const looksUseful = signaled || contextBoost;
    if (!looksUseful) continue;
    if (line.length < 18) continue;
    if (line.length > 180) continue;
    let score = 0;
    score += REQUIREMENT_SIGNAL_TERMS.filter((term) => lower.includes(term)).length * 3;
    score += currentHeader ? 2 : 0;
    score += line.length > 50 ? 2 : 0;
    if (/^not\b/i.test(line)) score -= 2;
    if (/^(ai systems lead|build the ai system layer|senior solutions architect)/i.test(lower)) score -= 3;
    candidates.push({ line, score });
  }

  if (candidates.length > 0) {
    return uniquePreserveOrder(
      candidates
        .sort((a, b) => b.score - a.score || a.line.localeCompare(b.line))
        .map((entry) => entry.line)
    ).slice(0, limit);
  }

  return lines.filter((line) => line.length <= 180).slice(0, limit);
}

function extractJobAnchors(jobText, limit = 6) {
  const normalized = normalize(jobText);
  const phraseCatalog = [
    { match: "vertex ai", display: "Vertex AI" },
    { match: "google cloud platform", display: "Google Cloud Platform" },
    { match: "gcp", display: "GCP" },
    { match: "fillout", display: "Fillout" },
    { match: "gemini", display: "Gemini" },
    { match: "suitedash", display: "SuiteDash" },
    { match: "magic link", display: "Magic Link" },
    { match: "service account", display: "service-account auth" },
    { match: "iam", display: "IAM" },
    { match: "api orchestration", display: "API orchestration" },
    { match: "json", display: "JSON mapping" },
    { match: "decision engine", display: "decision engine" },
    { match: "delegation engine", display: "delegation engine" },
    { match: "founder os", display: "Founder OS" },
    { match: "team os", display: "Team OS" },
    { match: "company operating system", display: "company operating system" },
    { match: "internal systems", display: "internal systems" },
    { match: "workflow automation", display: "workflow automation" },
    { match: "scalable", display: "scalable architecture" },
    { match: "system design", display: "system design" },
    { match: "reports", display: "report delivery" },
    { match: "structured reporting", display: "structured reporting" },
    { match: "messy workflows", display: "messy workflow cleanup" },
    { match: "portal", display: "portal delivery" },
    { match: "authentication", display: "authentication" },
    { match: "security", display: "security" },
    { match: "routing work", display: "work routing" }
  ];
  const anchors = phraseCatalog.filter((phrase) => normalized.includes(phrase.match)).map((phrase) => phrase.display);
  return uniquePreserveOrder(anchors).slice(0, limit);
}

function summarizeRequirementFragments(jobText, limit = 3) {
  const lines = extractRequirementLines(jobText, limit);
  return lines
    .map((line) => line.replace(/^(phase \d+|inputs|outputs|scope|summary|project overview|desired qualifications|your mission|scope of responsibilities)\s*[-:]?\s*/i, "").trim())
    .map((line) => line.replace(/^(we are|we're|the objective is to|build a system that|goal:)\s*/i, "").trim())
    .map((line) => line.replace(/[.]+$/, "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function joinNaturalLanguage(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function extractSectionLines(jobText, headers, limit = 8) {
  const lines = cleanJobLines(jobText);
  const headerMatchers = headers.map((header) => header.toLowerCase());
  const results = [];
  let active = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (headerMatchers.includes(lower)) {
      active = true;
      continue;
    }
    if (active && looksLikeHeading(line)) {
      break;
    }
    if (active) {
      results.push(line);
      if (results.length >= limit) break;
    }
  }

  return uniquePreserveOrder(results);
}

function rankRelevantHighlights(jobText, profile, limit = 3) {
  const keywordSet = new Set([
    ...proposalTokens(jobText),
    ...extractJobAnchors(jobText).flatMap((phrase) => proposalTokens(phrase))
  ]);

  const scored = [];
  for (const role of profile.experience) {
    for (const highlight of role.highlights) {
      const tokens = proposalTokens(highlight);
      const overlap = tokens.filter((token) => keywordSet.has(token));
      const score = overlap.length + (highlight.toLowerCase().includes("built") ? 0.5 : 0);
      scored.push({ highlight, score });
    }
  }

  const selected = scored
    .sort((a, b) => b.score - a.score || a.highlight.localeCompare(b.highlight))
    .map((entry) => entry.highlight);

  return uniquePreserveOrder(selected).slice(0, limit);
}

function extractRequiredSkills(jobText, profile, limit = 6) {
  const lines = [
    ...extractSectionLines(jobText, ["mandatory skills", "preferred qualifications", "desired qualifications", "the technical stack"], 14),
    ...extractJobAnchors(jobText, limit)
  ];

  const fromProfile = profile.core_strengths.filter((skill) => skillMatchesText(skill, normalize(lines.join(" "))));
  const lineTokens = uniquePreserveOrder(
    lines
      .flatMap((line) => line.split(/[,:]/))
      .map((part) => cleanLine(part))
      .filter((part) => part.length >= 3 && part.length <= 60)
  );

  return uniquePreserveOrder([...fromProfile, ...lineTokens]).slice(0, limit);
}

function extractStackHighlights(jobText, limit = 5) {
  const lines = extractSectionLines(jobText, ["the technical stack", "mandatory skills"], 16);
  const results = [];

  for (const line of lines) {
    if (line.includes(":")) {
      const [label, ...rest] = line.split(":");
      const rhs = rest.join(":").trim();
      if (/^intake$/i.test(label.trim()) && rhs) {
        results.push(rhs.replace(/[.]+$/, ""));
        continue;
      }
      if (/^ai engine$/i.test(label.trim()) && rhs) {
        results.push(rhs.replace(/[.]+$/, ""));
        continue;
      }
      if (/automation middleware/i.test(label.trim()) && rhs) {
        results.push(rhs.replace(/[.]+$/, ""));
        continue;
      }
      if (/mandatory skills/i.test(label.trim())) {
        results.push(...rhs.split(",").map((item) => cleanLine(item)));
        continue;
      }
    }

    if (line.length <= 60) {
      results.push(line.replace(/[.]+$/, ""));
    }
  }

  return uniquePreserveOrder(results).slice(0, limit);
}

function extractClientPriorities(jobText, limit = 4) {
  return summarizeRequirementFragments(jobText, limit)
    .filter((line) => !/^not\b/i.test(line))
    .slice(0, limit);
}

function extractClientConstraints(jobText, limit = 3) {
  const text = normalize(jobText);
  const lines = cleanJobLines(jobText);
  const constraints = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("speed over perfection") ||
      lower.includes("weeks, not months") ||
      lower.includes("simple over complex") ||
      lower.includes("leverage over features") ||
      lower.includes("high ownership") ||
      lower.includes("service account") ||
      lower.includes("iam") ||
      lower.includes("magic link") ||
      lower.includes("scalable")
    ) {
      constraints.push(line);
    }
  }

  if (constraints.length > 0) {
    return uniquePreserveOrder(constraints).slice(0, limit);
  }

  if (/weeks, not months/.test(text)) constraints.push("move quickly without over-engineering");
  if (/speed over perfection/.test(text)) constraints.push("prioritize speed and practical delivery");
  if (/scalable|future logic updates/.test(text)) constraints.push("keep the architecture maintainable as the workflow evolves");

  return uniquePreserveOrder(constraints).slice(0, limit);
}

function buildExecutionPlan(jobText) {
  const text = normalize(jobText);
  const steps = [];

  if (/fillout|mapping|json|pipeline|api|orchestrat|workflow/.test(text)) {
    steps.push("validating the intake-to-output mapping end to end with a thin working slice before expanding scope");
  }
  if (/authentication|security|service account|iam|credential|rs256|access/.test(text)) {
    steps.push("locking down authentication and permissions early so delivery is reliable in production");
  }
  if (/report|portal|magic link|delivery|suitedash|folder|file/.test(text)) {
    steps.push("wiring the final delivery path into the target portal and confirming the report handoff with real data");
  }
  if (/decision|delegate|delegation|founder|operator|flow|noise|structured/.test(text)) {
    steps.push("modelling the decision and delegation flow on real operating inputs instead of starting from generic features");
  }
  if (/scale|scalable|future|prompt id|trackable|company/.test(text)) {
    steps.push("keeping the architecture simple now but structured so later logic changes do not require a rewrite");
  }

  if (steps.length === 0) {
    steps.push("confirming the target architecture and de-risking the highest-friction integration points first");
    steps.push("delivering an end-to-end slice early so we can harden the right parts instead of guessing");
  }

  return uniquePreserveOrder(steps).slice(0, 3);
}

function sentenceCase(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function humanizePriority(line) {
  let text = line.replace(/^[A-Za-z][A-Za-z &/()'-]{1,40}:\s*/, "").trim();
  text = text.replace(/^so we re building/i, "building");
  text = text.replace(/^built internal systems, not tools$/i, "operating at the internal-systems level rather than shipping surface-level tools");
  text = text.replace(/^build a system that/i, "building a system that");
  text = text.replace(/\bwe re\b/gi, "we're");
  text = text.replace(/[:.]+$/, "");
  return sentenceCase(text);
}

function humanizeConstraint(line) {
  let text = line.replace(/^[A-Za-z][A-Za-z &/()'-]{1,40}:\s*/, "").trim();
  text = text.replace(/[.]+$/, "");
  return text.toLowerCase();
}

function buildGenericProposal(jobText, profile, fit) {
  const fragments = summarizeRequirementFragments(jobText, 3);
  const anchors = extractJobAnchors(jobText, 4);
  const relevantHighlights = rankRelevantHighlights(jobText, profile, 3);
  const executionPlan = buildExecutionPlan(jobText);
  const matchedTools = uniquePreserveOrder([...fit.matchedSkills, ...anchors]).slice(0, 4);

  const introParts = [];
  if (fragments.length > 0) {
    introParts.push(`The brief is centered on ${joinNaturalLanguage(fragments)}.`);
  }
  if (matchedTools.length > 0) {
    introParts.push(`My overlap is strongest around ${joinNaturalLanguage(matchedTools)} and the system-integration work needed to make those pieces hold together.`);
  }

  const intro = `Hi, I'm ${profile.name}. ${introParts.join(" ")}`.trim();

  const evidence = relevantHighlights.length > 0
    ? `Relevant work from my background includes ${relevantHighlights.map((item) => item.replace(/[.]+$/, "")).join("; ")}.`
    : `Relevant work from my background includes building production-ready data and platform systems with strong emphasis on integration, reliability, and scale.`;

  const plan = executionPlan.length > 0
    ? `If we work together, I would start by ${executionPlan.join(", then ")}.`
    : "If we work together, I would start by confirming the target architecture, delivering an end-to-end slice quickly, and then hardening the parts that matter most in production.";

  let closing = "If helpful, I can outline the first milestone and the fastest path to a production-safe v1 after reviewing any existing system context.";
  if (/not a chatbot role/.test(normalize(jobText))) {
    closing = "I understand this is not a generic chatbot brief, and I would approach it as an operating system and workflow design problem first, with AI supporting the decision flow rather than driving the whole pitch.";
  }

  return [intro, evidence, plan, closing].join("\n\n");
}

function buildSeekProposal(jobText, profile, fit) {
  const generic = buildGenericProposal(jobText, profile, fit);
  return generic
    .replace(/^Hi, I'm /, "Hello, I'm ")
    .replace(
      "If helpful, I can outline the first milestone and the fastest path to a production-safe v1 after reviewing any existing system context.",
      "If helpful, I can also tailor this into a more direct cover letter version for the application portal and highlight the most relevant delivery examples."
    );
}

function buildUpworkProposal(jobText, profile, fit) {
  const priorities = extractClientPriorities(jobText, 3).map(humanizePriority);
  const requiredSkills = uniquePreserveOrder([
    ...extractJobAnchors(jobText, 5),
    ...extractStackHighlights(jobText, 4),
    ...fit.matchedSkills
  ]).slice(0, 5);
  const relevantHighlights = rankRelevantHighlights(jobText, profile, 3);
  const executionPlan = buildExecutionPlan(jobText);
  const constraints = extractClientConstraints(jobText, 2).map(humanizeConstraint);
  const text = normalize(jobText);

  const opening = priorities.length > 0
    ? `Hi, I'm ${profile.name}. What stood out in your brief is that you need someone who can solve a very specific set of problems: ${joinNaturalLanguage(priorities)}.`
    : `Hi, I'm ${profile.name}. Your brief reads like a hands-on delivery problem where the value is in making the workflow actually work in production, not just stitching together tools.`;

  const fitLine = requiredSkills.length > 0
    ? `The strongest overlap from my side is ${joinNaturalLanguage(requiredSkills.slice(0, 4))}, plus the integration and system-design work required to make those pieces behave reliably together.`
    : `The strongest overlap from my side is production-grade system integration, workflow design, and reliable backend delivery.`;

  const evidence = relevantHighlights.length > 0
    ? `Relevant proof points from my background: ${relevantHighlights.map((item) => item.replace(/[.]+$/, "")).join("; ")}.`
    : `Relevant proof points from my background include delivering production-ready platform and integration work with a strong bias toward reliability and clean handoff between systems.`;

  const planSentence = executionPlan.length > 0
    ? `If I took this on, my first phase would be ${executionPlan.join(", then ")}.`
    : `If I took this on, my first phase would be to confirm the target workflow, ship an end-to-end slice quickly, and then harden the integration points that matter most.`;

  let constraintSentence = "";
  if (constraints.length > 0) {
    constraintSentence = `I'm also aligned with the constraints in the brief: ${joinNaturalLanguage(constraints)}.`;
  }

  let close = "If useful, I can map this into a practical milestone plan and call out the main implementation risks before we commit to a longer build.";
  if (/not a chatbot role/.test(text)) {
    close = "I understand this is not a chatbot brief. I'd approach it as an operations and decision-flow system first, with AI used where it increases leverage rather than where it simply adds surface area.";
  } else if (/service account|iam|rs256|magic link|suitedash|vertex/.test(text)) {
    close = "If helpful, I can also outline exactly how I would de-risk the auth, orchestration, and delivery path before touching the later polish work.";
  }

  return [opening, fitLine, evidence, planSentence, constraintSentence, close].filter(Boolean).join("\n\n");
}

function buildProposal(jobText, profile, fit, provider = "generic") {
  if (provider === "upwork") {
    return buildUpworkProposal(jobText, profile, fit);
  }
  if (provider === "seek") {
    return buildSeekProposal(jobText, profile, fit);
  }
  return buildGenericProposal(jobText, profile, fit);
}

function extractConnectsRequired(jobText) {
  const match = jobText.match(/(?:this proposal requires|send a proposal for:?|requires)\s*(\d+)\s*connects/i);
  return match ? Number(match[1]) : null;
}

function isJobAvailable(jobText) {
  const text = normalize(jobText);
  return !UPWORK_UNAVAILABLE_PATTERNS.some((pattern) => text.includes(pattern));
}

function detectEligibilityBlockers(jobText, provider = "generic") {
  if (provider !== "seek") return [];
  const text = String(jobText || "");
  return SEEK_HARD_BLOCKERS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.reason);
}

function buildScreeningAnswers(fit) {
  const answers = [
    "I've delivered production-facing data and AI systems across Databricks, Spark, AWS, and Azure, and more recently focused on LLM pipelines, embeddings, RAG, and agent-style workflows.",
    "My approach is to de-risk early: clarify the desired outcome, confirm the target architecture, build a thin but working end-to-end slice first, and then harden for scale, monitoring, and maintainability."
  ];
  if (fit.concerns.length > 0) {
    answers.push("One thing I'd want to confirm up front is the exact scope, so I can align the implementation plan to the parts where my background adds the most value.");
  }
  return answers;
}

function buildApplicationPacket(jobName, jobText, profile, fit, proposal, screeningAnswers, focusTerms, connectsRequiredOverride = null) {
  const connectsRequired = connectsRequiredOverride ?? extractConnectsRequired(jobText);
  return [
    `# Application Packet: ${jobName}`,
    "",
    "## Fit Summary",
    `- Recommendation: ${fit.recommendation}`,
    `- Fit score: ${fit.score}/100`,
    `- Connects required: ${connectsRequired ?? "Unknown"}`,
    `- Matched domains: ${fit.matchedDomains.length ? fit.matchedDomains.join(", ") : "None detected"}`,
    `- Matched skills: ${fit.matchedSkills.length ? fit.matchedSkills.join(", ") : "None detected"}`,
    "",
    "## Reasons To Apply",
    ...fit.reasons.map((reason) => `- ${reason}`),
    "",
    "## Risks / Questions",
    ...(fit.concerns.length ? fit.concerns.map((concern) => `- ${concern}`) : ["- No major fit risks detected from the text alone."]),
    "",
    "## Focus Terms",
    `- ${focusTerms.length ? focusTerms.join(", ") : "None extracted"}`,
    "",
    "## Draft Proposal",
    proposal,
    "",
    "## Suggested Screening Answers",
    ...screeningAnswers.map((answer) => `1. ${answer}`),
    "",
    "## Final Review Checklist",
    "- Confirm the proposal language matches the exact client brief.",
    "- Adjust any claims that need stronger proof or portfolio links.",
    "- Verify hourly rate, milestones, and availability before submission.",
    "- Manually review and submit through Upwork unless you intentionally use the gated submit command."
  ].join("\n") + "\n";
}

function buildDraft(jobName, jobText, profile, metadata = {}) {
  const fit = scoreJob(jobText, profile);
  const focusTerms = extractFocusTerms(jobText, profile);
  const proposal = buildProposal(jobText, profile, fit, metadata.provider || "generic");
  const screeningAnswers = buildScreeningAnswers(fit);
  const connectsRequired = metadata.connectsRequired ?? extractConnectsRequired(jobText);
  const eligibilityBlockers = detectEligibilityBlockers(jobText, metadata.provider || "generic");
  const packet = buildApplicationPacket(jobName, jobText, profile, fit, proposal, screeningAnswers, focusTerms, connectsRequired);

  return {
    fit,
    focusTerms,
    proposal,
    screeningAnswers,
    packet,
    connectsRequired,
    isAvailable: metadata.isAvailable ?? isJobAvailable(jobText),
    eligibility: {
      allowed: eligibilityBlockers.length === 0,
      blockers: eligibilityBlockers
    }
  };
}

function persistReview(review, profile) {
  const packet = buildApplicationPacket(
    review.jobName,
    review.jobText,
    profile,
    review.fit,
    review.proposal,
    review.screeningAnswers || [],
    review.focusTerms || [],
    review.connectsRequired ?? null
  );

  const updated = {
    ...review,
    packet,
    updatedAt: new Date().toISOString()
  };

  if (updated.packetPath) {
    writeText(updated.packetPath, packet);
  }
  if (updated.reviewPath) {
    writeJson(updated.reviewPath, updated);
  }

  return updated;
}

function draftFromText(jobName, jobText, profile, metadata = {}) {
  ensureDir(JOBS_DIR);
  ensureDir(APPLICATIONS_DIR);
  ensureDir(REVIEWS_DIR);

  if (metadata.provider === "upwork" && metadata.allowUnavailable !== true && !isJobAvailable(jobText)) {
    throw new Error("This Upwork job is unavailable or still on a temporary interstitial page, so I skipped generating a draft.");
  }

  const slug = slugify(jobName);
  const built = buildDraft(slug, jobText, profile, metadata);
  const jobPath = path.join(JOBS_DIR, `${slug}.txt`);
  const packetPath = path.join(APPLICATIONS_DIR, `${slug}.md`);
  const reviewPath = path.join(REVIEWS_DIR, `${slug}.json`);

  writeText(jobPath, jobText);
  writeText(packetPath, built.packet);

  const review = {
    id: slug,
    createdAt: new Date().toISOString(),
    jobName: slug,
    jobText,
    jobPath,
    packetPath,
    reviewPath,
    provider: metadata.provider || "upwork",
    jobUrl: metadata.jobUrl || "",
    sourceTitle: metadata.sourceTitle || jobName,
    connectsRequired: built.connectsRequired,
    isAvailable: built.isAvailable,
    eligibility: built.eligibility,
    fit: built.fit,
    focusTerms: built.focusTerms,
    proposal: built.proposal,
    screeningAnswers: built.screeningAnswers,
    packet: built.packet
  };

  writeJson(reviewPath, review);
  return review;
}

function latestPacketPath() {
  ensureDir(APPLICATIONS_DIR);
  const files = fs.readdirSync(APPLICATIONS_DIR)
    .filter((item) => item.endsWith(".md"))
    .map((item) => path.join(APPLICATIONS_DIR, item))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (files.length === 0) {
    throw new Error(`No application packets exist in ${APPLICATIONS_DIR}. Generate one first.`);
  }

  return files[0];
}

function proposalFromPacket(packetPath) {
  const content = fs.readFileSync(packetPath, "utf8");
  const match = content.match(/## Draft Proposal\s*([\s\S]*?)\s*## Suggested Screening Answers/);
  if (!match) {
    throw new Error(`Could not locate the draft proposal section inside ${packetPath}.`);
  }
  return match[1].trim();
}

function latestReview(provider) {
  ensureDir(REVIEWS_DIR);
  const files = fs.readdirSync(REVIEWS_DIR)
    .filter((item) => item.endsWith(".json"))
    .map((item) => path.join(REVIEWS_DIR, item))
    .filter((filePath) => {
      if (!provider) return true;
      try {
        return readJson(filePath).provider === provider;
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (files.length === 0) {
    return null;
  }

  return readJson(files[0]);
}

module.exports = {
  ROOT,
  DEFAULT_PROFILE,
  JOBS_DIR,
  APPLICATIONS_DIR,
  AUTOMATION_DIR,
  REVIEWS_DIR,
  ensureDir,
  readJson,
  writeJson,
  writeText,
  normalize,
  uniqueSorted,
  uniquePreserveOrder,
  slugify,
  loadProfile,
  collectSkillMatches,
  scoreJob,
  extractFocusTerms,
  extractRequirementLines,
  extractJobAnchors,
  extractRequiredSkills,
  extractStackHighlights,
  extractClientPriorities,
  extractClientConstraints,
  rankRelevantHighlights,
  buildExecutionPlan,
  buildGenericProposal,
  buildUpworkProposal,
  buildProposal,
  buildScreeningAnswers,
  buildApplicationPacket,
  buildDraft,
  persistReview,
  extractConnectsRequired,
  detectEligibilityBlockers,
  isJobAvailable,
  draftFromText,
  latestPacketPath,
  proposalFromPacket,
  latestReview
};
