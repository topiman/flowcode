# FlowCode

Visual AI-driven development tool built on local Claude Code CLI.

[中文文档](./README.zh-CN.md)

## What is FlowCode

FlowCode provides a visual interface for orchestrating AI-driven development workflows using your local Claude Code CLI. You define your own workflow by configuring **Agents** and **Skills** — there is no fixed pipeline. Every team can customize their workflow to match their development process.

### Core Concepts

- **Agent** — A specialized AI role (e.g., architect, developer, reviewer). Each agent has a prompt, model, input/output files, and linked skills.
- **Skill** — Reusable knowledge blocks attached to agents: coding standards, gate checks, document templates, reference materials.
- **Workflow Template** — A sequence of agents that defines a development pipeline. Create as many as you need.
## Architecture

```
┌─────────────────────────────────────────┐
│           FlowCode (Web UI)             │
│        React 19 + Vite + Tailwind       │
├─────────────────────────────────────────┤
│          Express 5 API Server           │
│         SQLite (better-sqlite3)         │
├─────────────────────────────────────────┤
│        Claude Code CLI Processes        │
│    Persistent pool (max 5, stream JSON) │
└─────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **Claude Code CLI** installed and authenticated

### Install

```bash
git clone <repo-url> && cd flowcode
npm install
npm run seed    # Initialize database with default agents & skills
npm run dev     # Start server (http://localhost:4800)
```

## Usage

### New Project

1. Click **"New Project"** to start a requirement conversation
2. AI analyst gathers requirements through Q&A
3. Confirm to create project directory, git repo, and workflow
4. Steps execute automatically with real-time streaming

### Iteration

1. Select existing project → Choose template → Enter description
2. System creates a git worktree branch
3. Workflow executes directly (skips conversation)

### Customization

**Create your own workflow:**

1. **Agents** page — Add/edit agents with custom prompts, models, and I/O files
2. **Skills** page — Create standards, templates, gate checks, or any reusable prompt blocks
3. **Link skills to agents** — Each agent can have multiple skills attached (standards, gates, templates)
4. **Workflow Templates** page — Define step sequences using your agents
5. **Skill Types** — Organize skills with custom categories and instructions

## Features

- **Fully customizable** — Define your own agents, skills, and workflow pipelines
- **Real-time streaming** — See AI thinking, tool calls, and output as they happen
- **File upload** — Attach images or text files (.md, .json, etc.) in conversations
- **Auto mode** — Run steps sequentially without manual confirmation
- **Session persistence** — Resume interrupted workflows
- **LAN access** — Server binds to `0.0.0.0`, accessible from other machines

## Project Structure

```
flowcode/
├── server/
│   ├── index.js            # Express server entry
│   ├── schema.sql          # Database schema
│   ├── seed.js             # Database initialization
│   ├── seed-data.sql       # Default skills & agent-skill mappings
│   ├── config.js           # Paths & port config
│   ├── routes/             # REST API endpoints
│   └── services/
│       ├── claude-process.js    # Claude CLI process pool
│       ├── workflow-executor.js # Step execution engine
│       ├── prompt-builder.js    # Dynamic prompt assembly
│       ├── conversation.js      # Requirement gathering
│       └── sse.js               # Server-Sent Events
├── client/
│   └── src/
│       ├── pages/          # ProjectList, ConversationChat, Dashboard
│       ├── components/     # Pipeline, ChatPanel, LogViewer
│       └── hooks/          # useSSE for real-time streaming
├── projects/               # Generated project repos
└── workflow.db             # SQLite database (auto-created)
```

## How It Works

1. **Prompt Assembly** — Agent prompts are built dynamically: base prompt + inlined input files + output paths + linked skills (grouped by skill type).
2. **Process Pool** — Up to 5 persistent Claude CLI processes. Idle processes reclaimed after 10 minutes.
3. **Session Continuity** — Each step stores a Claude CLI session ID. Sessions persist on disk for resume after interruption.
## License

Private - Internal use only
