# Autonomous Job Agent — Design

Status: Draft for review
Last updated: 2026-04-07
Owner: Nitin

Related: [`requirements.md`](./requirements.md)

## 1. Architectural Principles

These are the rules the design adheres to. When in doubt, return to these.

1. **Two runtimes, two reasons.**
   - **Python** owns orchestration and reasoning. Justified by the LangGraph / Pydantic / agent ecosystem being Python-first.
   - **Node** owns browser control and deterministic provider parsing. Justified by Playwright being Node-native.

2. **One-way dependency.** Python calls Node. Node never calls Python.

3. **Node is deterministic. Python reasons.**
   - Node never calls an LLM, never reads the user profile, never decides what an answer should be.
   - Python never parses provider DOMs, never drives Chrome directly.

4. **Parsing is build-time. Reasoning is runtime.**
   - Provider page parsers are version-controlled deterministic code.
   - Parser failure is a loud signal, not a runtime problem to reason around.
   - LLM extraction is reserved for genuinely unknown external portals, and only as a fallback that captures traces for future codification.

5. **State is explicit.** Every workflow run has a serializable state. State transitions are append-only events. Workflows survive restarts via checkpoints.

6. **Human-in-the-loop is structural.** Approval gates are first-class graph nodes with persistent interrupt/resume, not ad-hoc API tokens.

## 2. Runtime Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Frontend Portal                        │
│              (HTML/JS, served by Python FastAPI)             │
└────────────────────────────┬─────────────────────────────────┘
                             │ HTTP + WebSocket (live updates)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                     Python FastAPI Server                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Portal API  (REST + WebSocket)                        │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  LangGraph Orchestrator  (in-process)                  │  │
│  │   - workflows: search, prepare, apply, approval        │  │
│  │   - state, checkpoints, interrupt/resume               │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  AI Services  (cover letter, answer, classification)   │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Provider Policy  (filters, blockers, ranking, budget) │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Persistence  (SQLite via repository pattern)          │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────────┬─────────────────────────────────┘
                             │ HTTP (one-way tool calls)
                             │ shared-secret auth
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                    Node Browser Service                      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Tool API  (HTTP, deterministic responses)             │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Browser Module  (Playwright, session lifecycle)       │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Provider Parsers  (SEEK, LinkedIn, Upwork)            │  │
│  │   - deterministic, version-controlled                  │  │
│  │   - schema-guarded, drift-signaling                    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  External Portal Adapters  (Workday, Greenhouse, ...)  │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────────┬─────────────────────────────────┘
                             ▼
                    Chrome / Chromium
```

### 2.1 Why this shape

- **Portal calls Python directly.** No Node gateway in the middle. The portal is a thin client over FastAPI.
- **LangGraph runs in-process inside Python.** Tool calls, interrupts, and resumes are Python function calls or async HTTP to Node — never cross-language workflow management.
- **Node is a pure tool service.** It exposes a stable HTTP tool API. It owns browser session lifecycle. It never originates calls.
- **The arrow only points down.** Python imports nothing from Node and never expects Node to call back. Node has no concept of workflows, state, or approvals.

### 2.2 Component responsibilities

| Component | Owns | Does NOT own |
|---|---|---|
| Portal | UI rendering, user actions | Workflow logic, provider logic, browser logic |
| FastAPI Portal API | HTTP/WS endpoints, auth, request validation | Reasoning |
| LangGraph Orchestrator | Workflow graphs, state, interrupts, retries | Browser actions, parsing |
| AI Services | LLM prompts and grounded generation | State, persistence |
| Provider Policy | Ranking, filters, blockers, budgets | Page parsing, browser actions |
| Persistence | SQLite repositories | Domain logic |
| Node Tool API | HTTP endpoints, request validation, auth | Reasoning, profile, persistence |
| Browser Module | Playwright sessions, navigation, clicks, fills | Field semantics, value decisions |
| Provider Parsers | DOM extraction, schema guards, drift signals | Field semantics, value decisions |
| External Portal Adapters | Portal-specific extraction and step handling | Field semantics, value decisions |

## 3. Data Model

### 3.1 Persistence — SQLite

Single SQLite database. LangGraph checkpoints live in the same file under a separate table namespace (using `SqliteSaver`).

```
jobs
  id (pk)
  provider                    -- seek | linkedin | upwork
  source_url
  canonical_key               -- cross-provider dedup key (see 3.2)
  title
  company
  location
  summary
  payload_json                -- full provider payload
  discovered_at
  last_seen_at

job_labels
  id (pk)
  job_id (fk)
  label                       -- shortlisted | rejected | removed | applied | blocked
  reason
  actor                       -- user | agent | policy
  metadata_json
  created_at

applications
  id (pk)
  job_id (fk)
  source_provider
  target_portal               -- seek | workday | greenhouse | ... | unknown
  source_url
  target_application_url
  state                       -- see state machine in §6
  approval_required
  created_at
  updated_at
  submitted_at

application_events            -- append-only
  id (pk)
  application_id (fk)
  event_type                  -- state_change | tool_call | drift | error | approval
  from_state
  to_state
  payload_json
  created_at

drafts
  id (pk)
  application_id (fk)
  draft_type                  -- cover_letter | proposal | answer
  question_fingerprint        -- only for answers
  generator                   -- llm:claude | llm:gpt | template | user_edit
  content
  version
  created_at

question_answers              -- learned answers, reusable across applications
  id (pk)
  question_fingerprint        -- normalized question for matching
  question_text
  answer_text
  confidence
  source                      -- profile | llm | user
  approved_by_user
  last_used_at
  created_at

workflow_runs
  id (pk)
  application_id (fk, nullable)
  workflow_type               -- search | prepare | apply | approval
  status                      -- running | paused | completed | failed
  current_node
  state_json                  -- references IDs, not embedded objects
  started_at
  updated_at
  finished_at

browser_sessions
  id (pk)
  provider
  session_key                 -- token Python passes to Node
  status                      -- active | stale | closed
  metadata_json
  created_at
  last_used_at

memory_entries
  id (pk)
  memory_type                 -- preference | answer_pattern | portal_pattern | rule
  scope                       -- global | provider:seek | employer:acme
  key
  value_json                  -- shape depends on memory_type
  confidence
  source
  created_at

artifacts
  id (pk)
  owner_type                  -- application | workflow_run | drift
  owner_id
  artifact_type               -- screenshot | dom_snapshot | trace | log
  path                        -- filesystem path; Node writes, Python records
  metadata_json
  created_at

settings
  id (pk)
  scope
  key
  value_json
  updated_at

drift_signals
  id (pk)
  provider                    -- or portal type
  parser_id
  expected_schema
  observed_summary
  page_snapshot_path
  workflow_run_id (fk)
  resolved
  created_at
```

### 3.2 `canonical_key` definition

Cross-provider dedup key. Computed deterministically as:

```
canonical_key = sha256(
  normalize(company_name) + "|" +
  normalize(job_title) + "|" +
  normalize(location_city)
)
```

Where `normalize` lowercases, strips punctuation, and collapses whitespace. This is good enough for the "same role posted on multiple sites" case. Embedding-based similarity is a future enhancement, not required for v1.

## 4. State Machine

### 4.1 States

| State | Meaning |
|---|---|
| `discovered` | Found in a search result, not yet evaluated |
| `shortlisted` | Passed filters and ranking, surfaced to user |
| `selected` | User has marked it for application |
| `prepared` | Cover letter / proposal / answers generated |
| `awaiting_approval` | All preparation complete, waiting on user to approve submission |
| `in_progress` | Apply flow running in browser |
| `paused` | Apply flow stopped because the system needs human input mid-flow |
| `blocked` | Cannot proceed (policy blocker, parser drift, persistent error) |
| `submitted` | Final submission action completed successfully |
| `failed` | Submission attempted but failed |

### 4.2 Valid transitions

```
discovered    → shortlisted | blocked
shortlisted   → selected | discovered (deselected)
selected      → prepared | blocked
prepared      → awaiting_approval | blocked
awaiting_approval → in_progress (on approve) | shortlisted (on reject)
in_progress   → submitted | paused | failed | blocked
paused        → in_progress (on user input) | blocked
blocked       → shortlisted (manual unblock) | (terminal otherwise)
submitted     → (terminal)
failed        → in_progress (retry) | (terminal)
```

Every transition is recorded as an `application_events` row with `from_state`, `to_state`, actor, and reason. Illegal transitions raise an error and are logged but do not corrupt state.

## 5. Workflows

There are **three distinct workflow types**, each with its own LangGraph definition. They are not one big linear graph.

### 5.1 Search workflow

Periodic, stateless per run, fast. Surfaces ranked jobs to the portal.

```
┌────────────────┐
│  search_jobs   │  ──→ Node: provider listing extraction
└────────┬───────┘
         ▼
┌────────────────┐
│ deduplicate    │  ──→ Python: canonical_key match
└────────┬───────┘
         ▼
┌────────────────┐
│ apply_blockers │  ──→ Python: provider policy (NV1, citizenship, budget)
└────────┬───────┘
         ▼
┌────────────────┐
│   rank_jobs    │  ──→ Python: scoring + learned preferences
└────────┬───────┘
         ▼
┌────────────────┐
│  persist_jobs  │  ──→ Python: write to jobs + job_labels
└────────────────┘
```

Triggered by: scheduled cron, or user "Refresh jobs" action.

### 5.2 Prepare workflow

Per-job. Generates the application content. Does not touch the apply form yet.

```
┌────────────────────┐
│ load_job + profile │
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ generate_review    │  ──→ AI Service: fit + summary
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ generate_content   │  ──→ AI Service: cover letter / proposal
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ predict_questions  │  ──→ AI Service: likely screening questions
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ draft_answers      │  ──→ AI Service: grounded answers
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ persist_drafts     │  ──→ Python: write to drafts table
└────────────────────┘
```

Triggered by: user selects job(s), clicks "Prepare". State: `selected → prepared`.

### 5.3 Apply workflow

Per-application. Stateful, long-running, can pause for human input. This is the workflow that uses LangGraph checkpoints heavily.

```
┌────────────────────┐
│   open_apply_url   │  ──→ Node: browser open
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ classify_apply     │  ──→ Python: hosted vs external
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ ensure_approval    │  ──→ INTERRUPT until user approves
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ inspect_step       │  ◀── loop entry
│  (Node: inspect)   │
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ decide_field_values│  ──→ Python: profile lookup + AI for unknowns
└──────┬─────────────┘
       │
       ├── all known ──→ ┌──────────────┐
       │                 │  fill_step   │ ──→ Node: fill_fields
       │                 └──────┬───────┘
       │                        ▼
       │                 ┌──────────────┐
       │                 │ continue_step│ ──→ Node: click continue
       │                 └──────┬───────┘
       │                        ▼
       │                 ┌──────────────┐
       │                 │ check_done   │
       │                 └──┬───────────┘
       │                    │
       │                    ├── more steps ──→ inspect_step (loop)
       │                    │
       │                    └── final step ──→ ┌──────────────┐
       │                                       │ final_submit │ ──→ Node: submit
       │                                       └──────┬───────┘
       │                                              ▼
       │                                       ┌──────────────┐
       │                                       │record_outcome│
       │                                       └──────────────┘
       │
       └── unknown field ──→ INTERRUPT (state: paused, ask user)
```

Triggered by: user approves a prepared application. State: `awaiting_approval → in_progress → submitted | paused | failed`.

### 5.4 Approval mechanics (LangGraph interrupt/resume)

The `ensure_approval` and `unknown field` interrupts use LangGraph's native `interrupt()` mechanism with `SqliteSaver` checkpointing.

```
1. Workflow runs to ensure_approval node.
2. Node calls interrupt() with the prepared application summary.
3. LangGraph persists checkpoint to SQLite, returns control to caller.
4. FastAPI returns to portal: "awaiting approval, run_id=X".
5. User reviews in portal, clicks Approve.
6. Portal POSTs /api/applications/{id}/approve.
7. FastAPI calls workflow.resume(run_id, approval=True).
8. LangGraph loads checkpoint from SQLite, continues from interrupt point.
9. Workflow proceeds.
```

The same pattern applies to mid-flow `paused` interrupts when the system needs user input on a specific field.

## 6. Tool Contracts (Python → Node)

All tool calls are HTTP POST, JSON in/out. Node always returns HTTP 200; the response body has a `status` field. HTTP 5xx is reserved for Node itself being broken.

Authentication: shared secret in `X-Internal-Auth` header. Localhost-only bind.

### 6.1 Tool call response envelope

```json
{
  "status": "ok | error | drift | needs_human",
  "data": { ... },
  "error": { "type": "...", "message": "..." },
  "drift": { "parser_id": "...", "expected": "...", "observed": "..." },
  "artifacts": [{"type": "screenshot", "path": "..."}]
}
```

### 6.2 Browser tools

```
POST /tools/browser/launch_session
  in:  { provider }
  out: { session_key, status }

POST /tools/browser/open_url
  in:  { session_key, url }
  out: { page_url, status }

POST /tools/browser/inspect_apply_step
  in:  { session_key }
  out: {
    page_url, page_type, step_index, total_steps_estimate,
    is_external_portal, portal_type,
    fields: [{ id, label, type, options, required, max_length }],
    visible_actions: ["Continue", "Save"]
  }

POST /tools/browser/fill_fields
  in:  { session_key, fields: [{ id, value }] }
  out: { filled_ids, failed_ids }

POST /tools/browser/click_action
  in:  { session_key, action_label }
  out: { navigated, new_page_url }

POST /tools/browser/take_snapshot
  in:  { session_key, kind: "screenshot" | "dom" }
  out: { artifact_path }

POST /tools/browser/close_session
  in:  { session_key }
  out: { closed }
```

### 6.3 Provider tools

```
POST /tools/providers/search
  in:  { provider, query, filters }
  out: { jobs: [ ... ] }

POST /tools/providers/extract_job_detail
  in:  { provider, url, session_key }
  out: { job: { ... } }

POST /tools/providers/start_apply
  in:  { provider, job_url, session_key }
  out: { apply_url, is_external_portal, portal_type }
```

### 6.4 Compound tools (preferred over primitives)

To minimize HTTP round trips, prefer compound tools where the LangGraph node would otherwise issue many sequential calls:

```
POST /tools/apply/fill_and_continue
  in:  { session_key, fields: [{id, value}], action_label }
  out: { filled_ids, navigated, new_page_state }
```

Primitive tools remain available for cases where the agent needs finer control.

### 6.5 Drift signal in responses

When a parser's schema guard fails:

```json
{
  "status": "drift",
  "drift": {
    "parser_id": "seek_listing_v3",
    "expected": "10 job cards with .job-title",
    "observed": "0 job cards matched",
    "page_snapshot": "automation/artifacts/drift/seek-2026-04-07-1234.html"
  }
}
```

Python receives this, marks the workflow as `blocked`, persists the drift signal, and surfaces it in the portal. No automatic retries with LLM extraction for known providers.

## 7. Form Filling: Detailed Flow

This is the part that touches the user's actual application content, so it gets its own section.

### 7.1 The dialogue

For each form step:

1. **Inspect** — Python calls `inspect_apply_step`. Node returns structured fields.
2. **Decide** — Python iterates fields:
   - Profile lookup first (email, name, work rights, phone, etc.)
   - Memory lookup second (`question_answers` table by `question_fingerprint`)
   - LLM call third, only for fields not resolved by lookup
   - Confidence threshold: if LLM confidence is low, pause and ask user
3. **Fill** — Python calls `fill_and_continue` with all resolved fields and the next action.
4. **Loop** — back to inspect for the next step, until `check_done` says final.

### 7.2 What Node does

- Reads the DOM
- Returns fields as structured data (id, label, type, options, required, max_length)
- Fills fields when told
- Clicks actions when told
- Reports per-field success/failure
- Captures artifacts on request
- Raises drift signals when schema guards fail

Node has no concept of profile, no concept of "the right answer", no LLM access.

### 7.3 What Python does

- Maps fields to values (profile, memory, LLM)
- Decides whether each value meets confidence threshold
- Decides when to pause and ask user
- Persists all field values, answers, and screenshots as artifacts
- Updates state machine
- Records each tool call as an application event

## 8. Drift Detection and Build-Time Repair Loop

```
runtime detects drift
       │
       ▼
Node returns status=drift with snapshot
       │
       ▼
Python persists drift_signal row, marks workflow blocked
       │
       ▼
Portal shows drift alert
       │
       ▼
Drift signals accumulate over time
       │
       ▼
Offline build process runs (manual or scheduled)
       │
       ▼
Build process reads drift signals + snapshots
       │
       ▼
Generates parser code patches
       │
       ▼
Opens PR / review queue
       │
       ▼
Human reviews and merges
       │
       ▼
Node redeployed with new parsers
       │
       ▼
Workflows previously blocked are unblocked
```

The build-time agent is not part of the runtime. It is an offline tool that produces code changes. Code changes are reviewed by a human before merge. There is no self-modifying runtime.

## 9. AI Services

Python module hosting LLM-backed generation. Each service has a strict input/output contract enforced by Pydantic.

| Service | Input | Output |
|---|---|---|
| `generate_review` | job text, profile | fit score, fit summary, focus terms |
| `generate_cover_letter` | job, profile, review | cover letter text |
| `generate_proposal` | job, profile, review (Upwork) | proposal text |
| `predict_questions` | job text | list of likely screening questions |
| `answer_question` | question, profile, job context | answer text, confidence |
| `classify_portal` | page snapshot, URL | portal type, confidence |

All prompts are version-controlled. Token usage is logged per call. A budget ceiling per workflow run causes the workflow to pause and surface to the user.

## 10. Provider Policy

Python module containing provider-specific rules. Pure functions, no I/O, easily testable.

- `seek.is_blocked(job)` — returns blocker reasons (NV1, citizenship)
- `upwork.connects_budget_check(job, current_spend)` — returns allow / deny / pause
- `linkedin.is_easy_apply(job)` — returns boolean
- `score_fit(job, profile, learned_preferences)` — returns numeric score per provider

Policy changes are code changes, version-controlled, unit-tested.

## 11. Persistence Layer

Repository pattern. Domain code never sees SQL. Repository implementations for SQLite live in one module; swapping to PostgreSQL means writing a new implementation, not changing domain code.

```
JobRepository
JobLabelRepository
ApplicationRepository
ApplicationEventRepository
DraftRepository
QuestionAnswerRepository
WorkflowRunRepository
BrowserSessionRepository
MemoryRepository
ArtifactRepository
SettingsRepository
DriftSignalRepository
```

LangGraph checkpoints use `SqliteSaver` against the same database file under separate tables. No cross-table joins between LangGraph internal tables and domain tables.

## 12. Portal API Surface

Python FastAPI. Single base path `/api/`. Internal tool API on Node uses different port and `X-Internal-Auth` header.

```
GET    /api/jobs                          ?provider=&filter=
POST   /api/jobs/{id}/label               { label, reason }
GET    /api/queue                         ?provider=
POST   /api/queue/select                  { job_ids: [...] }
POST   /api/queue/remove                  { job_id }

POST   /api/workflows/search              { provider, query, filters }
POST   /api/workflows/prepare             { application_ids: [...] }
POST   /api/workflows/apply               { application_id }
POST   /api/applications/{id}/approve
POST   /api/applications/{id}/reject      { reason }
POST   /api/applications/{id}/resume      { user_input }   -- for paused mid-flow

GET    /api/applications/{id}
GET    /api/applications/{id}/events
GET    /api/applications/{id}/drafts
PUT    /api/applications/{id}/drafts/{draft_id}            -- user edits

GET    /api/workflows/runs/{run_id}
GET    /api/activity                      ?limit=
WS     /api/stream                        -- live activity push

GET    /api/drift                         -- list parser drift signals
GET    /api/settings
PUT    /api/settings

GET    /api/memory                        ?type=
```

## 13. Folder Structure

```
docs/
portal/                              # static frontend assets
python/
  app/
    main.py                          # FastAPI entry
    api/                             # route handlers
    workflows/                       # LangGraph definitions
      search.py
      prepare.py
      apply.py
    services/                        # AI services
    policy/                          # provider policy
      seek.py
      linkedin.py
      upwork.py
    persistence/                     # repository implementations
      sqlite/
    tools/                           # Node tool client wrappers
    state/                           # Pydantic state models
    settings.py
  tests/
node/
  src/
    server.ts                        # tool API entry
    browser/                         # Playwright session module
    providers/                       # SEEK, LinkedIn, Upwork parsers
    portals/                         # external portal adapters
    drift/                           # schema guards and signal generation
  test/
build_tools/
  drift_to_parser/                   # offline parser regeneration
```

## 14. Open Design Decisions

1. **Memory typed schema.** Each `memory_type` needs a Pydantic schema. Drafted as part of the AI services design but not finalized.
2. **Compound vs primitive tool granularity.** Start with one compound tool (`fill_and_continue`) and add more as patterns emerge.
3. **External portal first adapter.** Generic adapter on day one, Workday as the first named adapter.
4. **Drift threshold.** Single failure raises a signal in v1; tune later if false positives are high.
5. **LangGraph streaming.** Use streaming mode for `apply` workflow so the portal WebSocket gets node-by-node progress.

## 15. Review Checklist

Before implementation starts, confirm:

- [ ] Two-runtime split is acceptable (Python orchestration, Node browser).
- [ ] One-way dependency (Python → Node) is acceptable.
- [ ] State machine and transitions are correct.
- [ ] Three workflow types (search, prepare, apply) are the right separation.
- [ ] LangGraph interrupt/resume model for approval is acceptable.
- [ ] Tool contract envelope (status field, no HTTP 5xx for tool failures) is acceptable.
- [ ] Drift detection as build-time repair (not runtime LLM repair) is acceptable.
- [ ] SQLite + repository pattern is acceptable for v1.
- [ ] Folder structure is acceptable.
