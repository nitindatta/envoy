# agent

FastAPI + LangGraph orchestration service for the autonomous job agent.

## Role

- Portal API (REST + WebSocket) for the React frontend
- LangGraph workflow host (search, prepare, apply)
- AI services (all LLM calls live here)
- Provider policy (SEEK blockers, Upwork Connects budget, ranking)
- SQLite persistence via repository pattern
- Tool client that calls the `tools/` service

**This service does not drive Chrome or parse provider DOMs.** Those belong to
`tools/`. The agent calls `tools/` over HTTP; `tools/` never calls back.

## Setup

Install `uv` first: https://docs.astral.sh/uv/

```bash
cd agent
uv sync
```

## Run

```bash
export INTERNAL_AUTH_SECRET="<shared secret with tools/>"

# Optional: override the OpenAI-compatible LLM endpoint
export OPENAI_COMPAT_BASE_URL="http://127.0.0.1:8123/v1"
export OPENAI_COMPAT_MODEL="gpt-5.4"
export OPENAI_COMPAT_API_KEY="local-dev-key"

uv run uvicorn app.main:app --host 127.0.0.1 --port 8005 --reload
```

## Scripts

```bash
uv run pytest              # tests
uv run ruff check .        # lint
uv run ruff format .       # format
uv run mypy app            # typecheck
```

## Folder layout

```
app/
  main.py            FastAPI entry
  settings.py        Pydantic Settings
  api/               Route handlers (thin)
  workflows/         LangGraph definitions
  services/          AI services (all LLM calls)
  policy/            Provider-specific rules
  persistence/
    repositories.py  Abstract interfaces
    sqlite/          SQLite implementations + migrations
  tools/             Client wrappers for the tools/ service
  state/             Pydantic state models
tests/
```

## Rules

See `.claude/agents/agent-builder.md` for the full conventions enforced by
the `agent-builder` and `principle-reviewer` sub-agents.
