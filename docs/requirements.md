# Autonomous Job Agent — Requirements

Status: Draft for review
Last updated: 2026-04-07
Owner: Nitin

## 1. Purpose

A personal, fully automated job hunting and application assistant. The system searches jobs across multiple providers using logged-in browser sessions, ranks and filters them against a user profile, prepares grounded applications (cover letters, proposals, screening answers), and submits them with a human approval gate.

This is a single-user personal tool, not a multi-tenant product.

## 2. Goals

1. Reduce manual effort of discovering relevant jobs across SEEK, LinkedIn, and Upwork.
2. Produce grounded, tailored applications (no generic templates, no hallucinated experience).
3. Handle provider-hosted apply flows and external employer portals (Workday, Greenhouse, Lever, custom).
4. Maintain full history of discovered, prepared, submitted, and blocked applications.
5. Keep the user in control through approval gates and visible activity logs.
6. Learn from approvals, edits, and outcomes over time.

## 3. Non-Goals

- Multi-user, multi-tenant, or SaaS operation.
- Resume tailoring as a first-class feature (secondary for MVP; cover letters and form answering come first).
- Fully unattended submission without any approval (approval gate is required for MVP).
- Replacing LinkedIn / SEEK search engines; the system uses them, not replaces them.
- Scraping jobs from unauthenticated public pages where a logged-in session is not used.

## 4. User Profile

- Single user: the owner of the machine.
- Provides a structured profile (experience, skills, certifications, work rights, contact info).
- Uses their own authenticated browser sessions for SEEK, LinkedIn, and Upwork.
- Reviews prepared applications and approves submissions.

## 5. Functional Requirements

### 5.1 Job Discovery

- FR-1: Search jobs on SEEK, LinkedIn, and Upwork using the user's logged-in browser session.
- FR-2: Support search by keyword, location, and provider-specific filters (remote, salary, etc.).
- FR-3: Extract structured job data (title, company, location, summary, URL, posted date, provider-specific fields such as Upwork Connects cost).
- FR-4: Deduplicate jobs that appear across multiple providers for the same role at the same company.
- FR-5: Run discovery as a scheduled background workflow, not only on user demand.

### 5.2 Filtering and Ranking

- FR-6: Apply provider-specific hard blockers (e.g. SEEK jobs requiring Australian citizenship or NV1 clearance are auto-blocked).
- FR-7: Rank jobs by fit against the user profile using deterministic scoring plus learned preferences.
- FR-8: Filter out jobs already labeled as rejected, removed, or previously applied.
- FR-9: Surface ranked results in the portal for user review.

### 5.3 Application Preparation

- FR-10: Generate grounded cover letters and proposals using profile evidence, not templates.
- FR-11: Never invent experience, certifications, clients, or outcomes not present in the profile.
- FR-12: Generate provider-appropriate wording (SEEK cover letter voice, Upwork freelancer voice, LinkedIn cover letter voice).
- FR-13: Produce per-application screening answers when the job description implies likely questions.
- FR-14: Store all generated content with version history.

### 5.4 Apply Flow Execution

- FR-15: Open the apply flow in the live browser session.
- FR-16: Detect whether the apply flow is provider-hosted or redirects to an external employer portal.
- FR-17: For provider-hosted flows, fill fields step-by-step through multi-step forms.
- FR-18: For external portals, classify the portal type (Workday, Greenhouse, Lever, generic) and use the matching adapter.
- FR-19: Answer screening questions using the profile and grounded reasoning.
- FR-20: Pause and surface to the user any field or question the system cannot answer with sufficient confidence.
- FR-21: Handle multi-step forms with persistent state across steps.

### 5.5 Submission and Approval

- FR-22: Final submission is gated. The system must pause before the final submit action.
- FR-23: User approves or rejects each prepared application through the portal.
- FR-24: Approved applications are submitted; rejected applications are marked and their reasoning is recorded for learning.
- FR-25: Support bulk approval of multiple prepared applications.
- FR-26: Record submission result (success, failure, confirmation page state).

### 5.6 Application State Tracking

- FR-27: Track every job through a state machine: discovered, shortlisted, selected, prepared, awaiting_approval, in_progress, paused, blocked, submitted, failed.
- FR-28: Record every state transition as an append-only event with timestamp and reason.
- FR-29: Store both the source provider URL and the final application portal URL for each application.
- FR-30: Store all generated content, answers, and browser artifacts (screenshots, page snapshots).

### 5.7 Learning and Memory

- FR-31: Learn from user approvals and rejections to update ranking preferences.
- FR-32: Learn from user edits to generated content (what the user changes is a signal).
- FR-33: Remember answers to repeated screening questions and suggest them in future applications.
- FR-34: Remember employer portal patterns to improve future navigation.
- FR-35: Memory updates require passing through a defined write path; no ad-hoc writes from multiple services.

### 5.8 Portal (Frontend)

- FR-36: Show discovered jobs per provider, with filters and ranking.
- FR-37: Show the selected job queue and prepared application queue.
- FR-38: Provide a review desk for each prepared application: cover letter editor, answer editor, job context.
- FR-39: Show live activity logs of workflow execution.
- FR-40: Provide approval controls: approve single, approve batch, reject, edit.
- FR-41: Show submitted and rejected history.
- FR-42: Provide a separate management/settings area for prompts, policies, memory inspection, and provider controls.
- FR-43: Show drift alerts when a provider parser stops matching expected structure.

### 5.9 Provider Support

- FR-44: SEEK — hosted apply, external redirect handling, NV1 and citizenship blockers.
- FR-45: LinkedIn — listing extraction, Easy Apply detection, external apply routing.
- FR-46: Upwork — listing extraction, Connects cost capture, proposal-based apply.
- FR-47: External portals — Workday, Greenhouse, Lever, and generic fallback.

### 5.10 Drift Detection and Repair

- FR-48: Provider parsers must fail loudly when the observed DOM no longer matches expected structure.
- FR-49: Parser failures raise a structured drift signal with captured page snapshot.
- FR-50: Drift signals are surfaced to the user and accumulated for offline parser regeneration.
- FR-51: An offline build-time process regenerates parser code from accumulated drift signals. The output is a code change that requires human review before merge.

## 6. Non-Functional Requirements

### 6.1 Reliability

- NFR-1: A browser crash or page failure during an apply flow must not lose workflow state. The workflow must resume from the last checkpoint.
- NFR-2: Tool call failures return structured error responses, not HTTP 500s.
- NFR-3: Long-running apply flows must survive server restarts via persistent checkpoints.
- NFR-4: Parser drift fails loudly rather than degrading silently.

### 6.2 Security and Privacy

- NFR-5: All data stays local on the user's machine. No user data leaves the machine except through LLM API calls that the user has explicitly configured.
- NFR-6: Credentials for SEEK, LinkedIn, Upwork are never handled by the system; only the user's pre-authenticated browser session is used.
- NFR-7: Internal tool APIs are not exposed to the portal or external callers (localhost-only, shared secret).
- NFR-8: The profile file and all persistence are stored under the user's local project directory.

### 6.3 Performance

- NFR-9: Search workflow completes within a reasonable time per provider (goal: under 2 minutes for a typical search).
- NFR-10: Apply workflow tool calls (browser inspect, fill, click) must be async; no event loop blocking during browser operations.
- NFR-11: LLM usage is bounded per workflow run; runaway prompting is prevented by explicit retry and token budgets.

### 6.4 Cost Control

- NFR-12: Upwork Connects are tracked against a configurable daily and weekly budget. The agent stops bidding when the budget is exhausted.
- NFR-13: Per-application LLM token cost is logged. A configurable ceiling pauses the workflow if exceeded.

### 6.5 Maintainability

- NFR-14: Clear separation of runtimes: Python for orchestration and reasoning, Node for browser control and deterministic parsing.
- NFR-15: One-way dependency: Python calls Node. Node never calls Python.
- NFR-16: Repository and adapter patterns for persistence; no SQL scattered through the codebase.
- NFR-17: Every cross-runtime contract is versioned and documented.
- NFR-18: Unit tests for new behavior and meaningful bug fixes.

### 6.6 Observability

- NFR-19: Every workflow run is traceable end-to-end through structured logs.
- NFR-20: Every browser action produces a captured artifact (screenshot or DOM snapshot) on request.
- NFR-21: LLM calls are logged with prompt, response, and token usage.
- NFR-22: The portal shows live activity logs in near-real-time (sub-second for status changes).

### 6.7 Operability

- NFR-23: Single-command startup for development (both runtimes).
- NFR-24: SQLite as the only persistence dependency for the first version.
- NFR-25: No cloud services required for the core loop; LLM API is the only external dependency.

## 7. Constraints

### 7.1 Runtime Constraints (hard)

- C-1: Browser automation must run in Node.js with Playwright. Playwright is Node-native and Playwright Python is a subprocess wrapper. Direct Node control is required for reliable CDP access, timing, and page evaluation.
- C-2: Agent orchestration must run in Python with LangGraph. LangGraph, Pydantic, Anthropic/OpenAI SDKs, and the agent ecosystem are Python-first. This is also the learning platform for LangGraph.
- C-3: Python calls Node. Node never calls Python back. The dependency is strictly one-way.

### 7.2 Policy Constraints

- C-4: Final submission is gated by human approval for the MVP.
- C-5: SEEK jobs requiring Australian citizenship or NV1 clearance are automatically blocked.
- C-6: Upwork Connects spending is bounded by user-defined budgets.
- C-7: The system must never invent profile content. All generated claims must trace to profile evidence.

### 7.3 Scope Constraints

- C-8: First provider for end-to-end automation is SEEK.
- C-9: External portal handling starts with a generic adapter, specialized into named adapters as patterns are observed.
- C-10: Resume tailoring is out of scope for MVP.

## 8. Open Questions

1. What is the data model for learned preferences? (Preference weights? Rule deltas? Embeddings over accepted/rejected jobs?)
2. What is the cross-provider deduplication key? (URL-based fails. Title + company fingerprint? Embedding similarity?)
3. Should external portal handling start fully generic, or should Workday be the first named adapter from day one?
4. How should the system prompt the user to register a new external portal as a named provider?
5. What is the threshold for "the parser has drifted enough, raise a signal" — one failure, or a rate over time?
6. Should LLM cost ceilings pause the workflow or degrade to cheaper models?

## 9. Glossary

- **Provider**: A job platform the user has an authenticated session with (SEEK, LinkedIn, Upwork).
- **External portal**: An employer-hosted application site reached by redirect from a provider (Workday, Greenhouse, Lever, custom).
- **Hosted apply flow**: An apply flow that stays on the provider's domain.
- **Parser drift**: A situation where a provider's DOM no longer matches the code written to parse it.
- **Approval gate**: The mandatory pause before final submission.
- **Checkpoint**: A persisted snapshot of workflow state that allows resume after restart.
- **Tool call**: A Python-to-Node HTTP request to perform a browser or provider operation.
