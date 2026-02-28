# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

clawctl is an agent-native control plane for managing OpenClaw fleets. It adds an intelligence layer on top of infrastructure tooling: an OpenClaw agent that reasons about fleet state, diagnoses issues, enforces policy, and takes corrective action — with human-in-the-loop for sensitive operations. Licensed under AGPL-3.0.

## Development Commands

```bash
npm run build        # tsc → dist/
npm run dev          # tsx src/cli/index.ts (no build needed)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/
npm run format       # prettier --write 'src/**/*.ts'
npm run format:check # prettier --check 'src/**/*.ts'
```

Run any CLI command in dev mode: `npm run dev -- <command> [flags]` (e.g. `npm run dev -- agents list --json`).

No test framework is configured yet.

## Code Style

- ESM throughout — `.js` extensions on all TypeScript imports, `"type": "module"` in package.json.
- Prettier: single quotes, semicolons, trailing commas, 100 char width.
- Strict TypeScript (ES2022 target, Node16 module resolution).
- Chalk for terminal colors (ESM import, v5).

## Architecture

### Core Patterns

**Zod as single source of truth** — All data models are Zod schemas in `src/types/`. TypeScript types derived via `z.infer<>`. Validation at every boundary (CLI input, file I/O, API responses).

**Pluggable store interfaces** — Abstract interfaces allow swapping backends:
- `AgentStore` (`src/registry/store.ts`) → `JsonAgentStore` (current), DynamoDB planned
- `AuditStore` (`src/audit/store.ts`) → `JsonAuditStore` (current), `DynamoAuditStore` (skeleton)

Store instantiation happens via `createStore()` factory in CLI commands.

**Config at `~/.clawctl/`** — All persistent state lives here, auto-created by `clawctl init`:
- `config.json` — AWS region, SSH key path, EC2 defaults
- `agents.json` — Agent registry
- `secrets.json` — AES-256-GCM encrypted vault (scrypt-derived key)
- `policy.json` — Policy rules
- `alerts.json` — Alert channel config (Telegram)
- `audit.json` — Local audit log
- `templates/` — Deploy templates (openclaw.json, .env, systemd unit)

**Fire-and-forget audit** — `audit()` from `src/audit/logger.ts` logs every action asynchronously. Failures never block the main operation.

**Policy enforcement** — `enforcePolicy(action, agent?)` in `src/policy/enforce.ts` checks rules, logs to audit, returns allow/deny/confirm. Called before sensitive operations.

### Module Dependency Flow

```
cli/commands/* → types/ (Zod schemas)
               → registry/ (AgentStore)
               → config/ (loadConfig)
               → ssh/ (SshClient)
               → health/ (getAgentStatus, diagnoseAgent)
               → deploy/ (freshDeploy, adoptDeploy)
               → tailscale/ (TailscaleClient)
               → secrets/ (SecretVault)
               → policy/ (PolicyEngine, enforcePolicy)
               → audit/ (audit logger)
               → alerting/ (alert sender)
               → ssm/ (SsmManager)
               → aws/ (SDK client factories)
               → dashboard/ (HTTP server + WebSocket)
```

### Key Modules

- **`src/ssh/client.ts`** — `SshClient` wraps node-ssh. `connect(agent)` uses agent's Tailscale IP. `connectTo(host, user)` for pre-registration SSH. `putContent()` writes strings to remote files via SFTP.
- **`src/deploy/`** — Two flows: `freshDeploy()` provisions EC2 → installs Tailscale (tag:clawctl) → installs OpenClaw → pushes config → sets up systemd → registers. `adoptDeploy()` verifies existing OpenClaw → registers.
- **`src/secrets/vault.ts`** — `SecretVault` encrypts with AES-256-GCM + scrypt. Per-agent scoping via optional `agentId` on each secret. Master password prompted at runtime.
- **`src/dashboard/`** — Raw `http.createServer()` serves `dashboard/index.html` SPA + JSON API endpoints. WebSocket polls every 3s for real-time updates.
- **`src/health/`** — `getAgentStatus()` SSHs to agent, runs `openclaw status --json`. `diagnoseAgent()` checks systemd, disk, memory, logs.

### Environment Variables

- `TAILSCALE_API_KEY` / `TAILSCALE_TAILNET` — Required for `clawctl network` commands
- `TAILSCALE_AUTH_KEY` — Fresh deploy provisioning (short-lived, not stored)
- AWS credentials — Via `~/.aws/credentials` profiles (configured in `config.json` as `awsProfile`)

### Pre-commit Hook

Gitleaks runs on staged files via `.githooks/pre-commit`. Configured automatically by `npm install` (the `prepare` script sets `core.hooksPath`).
