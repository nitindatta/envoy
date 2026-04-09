# portal

React + Vite + TypeScript + Tailwind frontend for the autonomous job agent.

## Role

- UI for jobs, queue, review, history, drift alerts, and settings
- Talks **only** to the Python FastAPI backend at `http://127.0.0.1:8005/api/...`
- Contains no business logic, no provider parsing, no workflow code
- Never calls the Node tool service directly

## Setup

```bash
cd portal
pnpm install
```

## Run

```bash
pnpm dev          # vite dev server on http://127.0.0.1:5173
pnpm build        # production build
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
```

The dev server proxies `/api/*` to `http://127.0.0.1:8005`.

## Folder layout

```
src/
  main.tsx        Entry
  App.tsx         Router shell
  index.css       Tailwind entry
  api/            Typed client, zod schemas, WebSocket stream
  pages/          Route components
  components/     Shared components (incl. shadcn/ui)
  hooks/          Custom hooks
  lib/            cn() and other helpers
```

## Rules

See `.claude/agents/frontend-builder.md` for the full conventions enforced
by the `frontend-builder` and `principle-reviewer` sub-agents.
