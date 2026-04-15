# Adding a New Job Provider

This document explains how to wire up a new job board (e.g. LinkedIn, Indeed) across all three services.

## Architecture overview

```
portal  →  agent (FastAPI + LangGraph)  →  tools (Fastify + Playwright)
```

- **agent/** owns all decisions, LLM calls, and workflow state.
- **tools/** executes browser operations and returns raw results. It knows nothing about the candidate or the job beyond the URL.
- **portal/** is a React UI — it drives the agent via HTTP and displays state.

Provider-specific code lives in **two** places only:

| Layer | Location | What goes there |
|-------|----------|-----------------|
| tools | `tools/src/providers/<name>/` | Page detection, navigation sequences, portal type detection |
| agent | `agent/app/policy/<name>.py` | Job filtering rules (block lists, keyword filters) |

Everything else — field filling, session management, queue workers, LangGraph nodes — is generic and must not contain provider strings.

---

## Step-by-step: adding a provider

### 1. tools/ — create the provider module

Create `tools/src/providers/<name>/apply.ts` with these exports:

```typescript
// Required exports — routes.ts will import these

/**
 * Return true if the page body text indicates a successful submission.
 * Called after every fill_and_continue to detect the confirmation page.
 */
export function isConfirmationPage(pageText: string): boolean { ... }

/**
 * Return true if the URL is an external ATS portal (not the provider's own form).
 * Used by inspectStep to set is_external_portal on StepInfo.
 */
export function isExternalPortalUrl(url: string): boolean { ... }

/**
 * Return a string identifier for the ATS vendor, or 'unknown'.
 * Examples: 'workday', 'greenhouse', 'lever'.
 */
export function detectPortalType(url: string): string { ... }

/**
 * Return true if the URL is a login/auth page.
 * Called before and after clicking Apply to detect auth walls.
 */
export function isLoginUrl(url: string): boolean { ... }

/**
 * Navigate to jobUrl, click Apply, handle redirects.
 * Returns StartApplyResult (see seek/apply.ts for the shape).
 */
export async function startApply(page: Page, jobUrl: string): Promise<StartApplyResult> { ... }
```

Use `tools/src/providers/seek/apply.ts` as the reference implementation.

### 2. tools/ — wire into routes.ts

In `tools/src/browser/routes.ts`, import your provider and add a branch in two places:

**`inspectOptsFor`** — provides hooks so `inspectStep` detects your provider's confirmation page and external portals:

```typescript
import {
  isConfirmationPage as myProviderIsConfirmation,
  isExternalPortalUrl as myProviderIsExternal,
  detectPortalType as myProviderDetectPortal,
} from '../providers/myprovider/apply.js';

function inspectOptsFor(provider: string): InspectOptions {
  if (provider === 'seek') { ... }          // existing
  if (provider === 'myprovider') {
    return {
      isConfirmation: (text) => myProviderIsConfirmation(text),
      isExternalPortal: (url) => myProviderIsExternal(url),
      detectPortalType: (url) => myProviderDetectPortal(url),
    };
  }
  return {};
}
```

**`start_apply` route** — dispatch to your provider's `startApply`:

```typescript
if (parsed.data.provider === 'myprovider') {
  const result = await myProviderStartApply(session.page, parsed.data.job_url);
  // ... same response shape as seek branch
}
```

### 3. tools/ — add search support (if applicable)

Create `tools/src/providers/<name>/search.ts` and `parseListing.ts`.
Register a search route (see `seek/search.ts` for the pattern).

### 4. agent/ — add a policy module

Create `agent/app/policy/<name>.py`:

```python
from app.state.jobs import SeekJob  # or your provider's job type

def is_blocked(job) -> BlockReason | None:
    """Return a BlockReason if this job should be filtered, None to keep it."""
    ...
```

Reference: `agent/app/policy/seek.py`.

### 5. agent/ — add to the search workflow

In `agent/app/workflows/search.py`, the `run_search` function receives `provider` from `SearchState`. The `search_seek` tool call needs a parallel call for your provider. The simplest approach is a provider dispatch in `search_jobs`:

```python
async def search_jobs(state: SearchState) -> dict:
    if state.provider == "seek":
        jobs = await search_seek(tool_client, ...)
    elif state.provider == "myprovider":
        jobs = await search_myprovider(tool_client, ...)
    return {"discovered": jobs}
```

### 6. agent/ — add to the API and portal

In `agent/app/api/jobs.py`, `SearchRequest` already accepts any `provider` string. Add your provider name to the portal's search form dropdown in `portal/src/pages/JobsPage.tsx`.

---

## Contract between agent/ and tools/

### Standard tool envelope

Every tools/ response uses this shape:

```typescript
{ status: 'ok',         data: { ... } }   // success
{ status: 'error',      error: { type, message } }  // hard failure
{ status: 'drift',      drift: { ... } }  // page didn't match expectations
{ status: 'needs_human', data: { reason, login_url } }  // auth wall
```

On the agent side, `browser_client.py` wraps these:
- `ok` → returns `env.data`
- `error` → raises `BrowserToolError`
- `needs_human` → raises `NeedsHumanError(reason, login_url)`
- `drift` → returns `(None, env)` so callers can handle it

### StepInfo contract

`fill_and_continue` and `inspect_apply_step` return `new_page_state` / step data in this shape:

```typescript
{
  page_url: string,
  page_type: 'form' | 'confirmation' | 'external_redirect' | 'unknown',
  step_index: number | null,
  total_steps_estimate: number | null,
  is_external_portal: boolean,
  portal_type: string | null,
  fields: FieldInfo[],
  visible_actions: string[],
}
```

The agent's `StepInfo` Pydantic model mirrors this exactly (`agent/app/state/apply.py`). If you add a field here, add it there too.

### FieldInfo contract

```typescript
{
  id: string,           // stable identifier — native id/name, data-testid, or __lbl_label__
  label: string,        // human-readable label shown to the user
  field_type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'unknown',
  required: boolean,
  current_value: string | null,
  options: string[] | null,   // for select/radio
  max_length: number | null,
}
```

---

## What must stay generic (do not add provider strings here)

| File | Why |
|------|-----|
| `tools/src/browser/inspector.ts` | Field extraction works on any HTML page |
| `tools/src/browser/routes.ts` | Routes are provider-agnostic; dispatch via `inspectOptsFor` |
| `tools/src/browser/sessions.ts` | Session store — provider is metadata only |
| `agent/app/workflows/apply.py` | LangGraph nodes operate on `StepInfo` — provider-agnostic |
| `agent/app/services/answer_field.py` | Field resolution uses profile + cache + LLM — provider-agnostic |
| `agent/app/worker/queue_worker.py` | Queue processing is provider-agnostic |

The only provider string that is allowed to flow through the generic layer is `session.provider` (used purely for dispatch) and `app.source_provider` (stored on the application record).

---

## Provider file checklist

```
tools/src/providers/<name>/
  apply.ts          isConfirmationPage, isExternalPortalUrl, detectPortalType,
                    isLoginUrl, startApply
  search.ts         searchProvider(client, keywords, location, maxPages)
  parseListing.ts   parseListingFromDOM or equivalent

agent/app/policy/<name>.py
  is_blocked(job) -> BlockReason | None
```
