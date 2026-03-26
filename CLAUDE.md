# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A web dashboard for orchestrating AI-driven development workflows. It manages projects through multi-step agent pipelines (requirement gathering → BRD → PRD → tech design → TDD → code review → E2E testing → deploy), where each step spawns a Claude Code CLI subprocess to execute agent tasks.

## Commands

```bash
npm run dev          # Start both server (port 3210) and Vite dev server (port 4800) via concurrently
npm run build        # Build frontend (Vite, outputs to client/dist/)
npm run seed         # Seed database with default agents/skills/templates
npm start            # Start server only (production, serves built frontend from client/dist/)
```

No test framework is configured.

## Architecture

**Monorepo with two halves:**

- **`server/`** — Express 5 API server (ESM, port 3210)
  - `db.js` — SQLite via better-sqlite3 (WAL mode), auto-runs `schema.sql` + inline migrations on import
  - `schema.sql` — All table definitions (skills, agents, workflow_templates, projects, workflows, workflow_steps, chat_messages, step_logs, config)
  - `services/claude-process.js` — Spawns `claude` CLI as child processes with `--output-format stream-json`, parses streaming JSON events, manages concurrency (max 3), handles subagent depth tracking
  - `services/workflow-executor.js` — Step execution engine: runs agent steps, manages session resumption, advances workflow through step sequence, auto-mode loop
  - `services/conversation.js` — Pre-project conversation flow (requirement gathering before a workflow exists)
  - `services/prompt-builder.js` — Assembles agent prompts from DB (agent prompt + attached skills)
  - `services/sse.js` — Server-Sent Events broadcast to connected clients
  - `routes/` — REST endpoints for projects, workflows, agents, templates, skills, conversations, messages

- **`client/`** — React 19 + Vite + Tailwind CSS v4 SPA
  - `src/App.jsx` — Routes: `/` (projects), `/workflow/:id` (dashboard), `/conversations/:id` (chat), `/agents`, `/workflows`, `/skills`
  - `src/pages/Dashboard.jsx` — Main workflow view with pipeline, chat, context panel, log viewer
  - `src/hooks/useSSE.js` — SSE hook for real-time streaming from server
  - `src/components/` — Pipeline (step visualization), ChatPanel, LogViewer, ContextPanel, Sidebar, StatusBar

**Key data flow:** User creates conversation → gathers requirements → creates project + workflow → workflow steps execute sequentially via Claude CLI subprocesses → results stream back via SSE to the dashboard UI.

**Database:** Single `workflow.db` SQLite file at project root. Schema auto-applies on server start. Migrations are inline in `db.js` using `addColumnIfNotExists()`.

## Key Patterns

- All server code uses ESM (`"type": "module"` in package.json)
- Claude CLI is invoked with `--dangerously-skip-permissions` and `--output-format stream-json`
- Session continuity: `session_id` is stored per workflow and per workflow_step for `--resume`
- The Vite dev server proxies `/api` requests to the Express server
- UI is in Chinese (Chinese labels, prompts, agent instructions)
- Uploaded files go to `/tmp/workflow-uploads`
