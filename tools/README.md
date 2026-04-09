# tools

Deterministic browser and provider tool service for the autonomous job agent.

## Role

Pure tool service. Called by the `agent/` service via HTTP, never calls back.
Owns browser session lifecycle, provider parsers, and external portal adapters.

**This service does not reason.** It never calls an LLM, never reads the user profile,
never writes to SQLite, and never decides what an answer should be.

## Setup

```bash
pnpm install
```

## Run

```bash
# Required
export INTERNAL_AUTH_SECRET="<shared secret with agent/>"

# Optional overrides
export NODE_TOOL_HOST=127.0.0.1
export NODE_TOOL_PORT=4320
export CHROME_DEBUG_PORT=9222
export BROWSER_PROFILE_DIR=../automation/browser-profile
export ARTIFACT_DIR=../automation/artifacts

pnpm dev
```

## Chrome

The service attaches to a real Chrome instance via the DevTools Protocol.
Launch Chrome with:

```bash
"/path/to/chrome.exe" \
  --remote-debugging-port=9222 \
  --user-data-dir="<repo>/automation/browser-profile" \
  --no-first-run \
  --no-default-browser-check
```

Log in to SEEK, LinkedIn, and Upwork once in this Chrome instance.
Sessions persist in the profile directory across runs.

## Scripts

- `pnpm dev` — run with hot reload
- `pnpm test` — run vitest
- `pnpm typecheck` — tsc --noEmit
- `pnpm lint` — eslint
- `pnpm format` — prettier

## Rules

See `.claude/agents/tools-builder.md` for the full conventions enforced by the
`tools-builder` sub-agent and `principle-reviewer` sub-agent.
