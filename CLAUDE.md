# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

clawctl is an agent-native control plane for managing OpenClaw fleets. It adds an intelligence layer on top of infrastructure tooling: an OpenClaw agent that reasons about fleet state, diagnoses issues, enforces policy, and takes corrective action — with human-in-the-loop for sensitive operations. Licensed under AGPL-3.0.

## Tech Stack

- TypeScript (Node.js) — matches OpenClaw ecosystem
- AWS SDK v3 — infrastructure and services layer (EC2, SSM, Secrets Manager, DynamoDB, CloudWatch)
- SSH/Tailscale for remote agent management

## Architecture (from PLAN.md)

Six core components:
1. **Agent Registry** — catalog of managed agents (local JSON initially, DynamoDB later)
2. **Secrets Vault** — encrypted store via AWS Secrets Manager with per-agent scoping
3. **Policy Engine** — rules for agent permissions (spending limits, channels, escalation, tools)
4. **Command Layer** — CLI + agent interface (deploy, configure, update, restart, monitor)
5. **Audit Log** — immutable record of actions (DynamoDB append-only)
6. **Health Monitor** — heartbeat tracking, log aggregation, alerting

Integration points: OpenClaw CLI, OpenClaw config files (`openclaw.json`, `.env`, `cron/jobs.json`), systemd, GitHub repos, AWS services.

## Key Architecture Patterns

- **ESM throughout** — `.js` extensions in all TypeScript imports. `"type": "module"` in package.json.
- **Zod as single source of truth** — TS types derived via `z.infer<>`. Validation at every boundary (file read/write, CLI input).
- **AgentStore interface** — pluggable store pattern (`src/registry/store.ts`). `JsonAgentStore` is the current impl; DynamoDB swap is a single factory change in `src/cli/commands/agents.ts`.
- **Config at `~/.clawctl/`** — `config.json` for settings, `agents.json` for registry data. Auto-created on first run.

## Development Commands

```bash
npm run build        # tsc → dist/
npm run dev          # tsx src/cli/index.ts (no build needed)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/
npm run format       # prettier --write
npm run format:check # prettier --check
```

## Source Layout

```
src/
├── types/       # Zod schemas + derived TS types (agent, config)
├── config/      # Config loader (~/.clawctl/config.json)
├── registry/    # AgentStore interface + JsonAgentStore
├── ssh/         # SshClient wrapper (node-ssh)
├── health/      # Agent status checks via SSH
├── aws/         # AWS SDK client factory functions
└── cli/
    ├── index.ts           # Entry point (Commander root command)
    └── commands/
        └── agents.ts      # agents list|add|remove|status
```
