# clawctl — Project Plan

## What It Is
Agent-native control plane for managing OpenClaw fleets. Not just infra tooling (like claworc/openclaw-fleet) — an OpenClaw agent that reasons about managing other OpenClaw agents, with a structured safety layer for secrets, policy enforcement, and audit.

## Architecture Vision

### Core Components
1. **Agent Registry** — catalog of managed agents (name, host, role, status, capabilities)
2. **Secrets Vault** — encrypted store for API keys, tokens, credentials; agents request access by policy, never see raw keys they don't need
3. **Policy Engine** — rules for what agents can/can't do (spending limits, approved channels, escalation paths, allowed tools)
4. **Command Layer** — CLI + agent interface to deploy, configure, update, restart, and monitor agents
5. **Audit Log** — immutable record of every action, config change, secret access, and policy decision
6. **Health Monitor** — heartbeat tracking, log aggregation, alerting on failures/drift

### Key Differentiator
Existing tools are declarative config management (YAML → deploy). clawctl adds an **intelligence layer**: an agent that can reason about fleet state, diagnose issues, enforce policy, and take corrective action — with human-in-the-loop for sensitive operations.

### Integration Points
- SSH/Tailscale for remote agent management
- OpenClaw CLI (`openclaw status`, `openclaw gateway restart`, etc.)
- OpenClaw config files (`openclaw.json`, `.env`, `cron/jobs.json`)
- Systemd for service management
- GitHub for agent workspace repos
- AWS (EC2 for agent hosts, SSM for remote commands, Secrets Manager for vault, DynamoDB for registry/audit, CloudWatch for monitoring)

## Tech Stack
- TypeScript (Node) — matches OpenClaw ecosystem
- AWS SDK v3 — infrastructure and services layer
- AGPL-3.0 — open core, dual-license for hosted version

## Network Architecture
clawctl fleet machines live on a Tailscale network with tag-based isolation:
- **`tag:clawctl`** — fleet machines managed by clawctl. Can only reach each other and admin devices.
- **`tag:claw`** — existing agents (separate network, no cross-access with clawctl).
- **Admin devices** — can reach everything.

Provisioning flow: spin up EC2 → install Tailscale → assign `tag:clawctl` via API → install OpenClaw → register in fleet.

All inter-agent communication goes over Tailscale (encrypted, no public ports needed). SSH for management uses Tailscale IPs only.

### Tailscale Integration
- Use Tailscale API v2 for: tagging devices, listing fleet nodes, verifying connectivity
- API key passed via env var `TAILSCALE_API_KEY` (short-lived, rotated regularly)
- Tailnet name via env var `TAILSCALE_TAILNET`
- Store in `.env` (gitignored), never in code or config files checked into repo

## Phase 1: Foundation
- [x] Project scaffold (package.json, tsconfig, eslint, structure)
- [x] Agent registry data model (local JSON initially, DynamoDB later)
- [x] CLI skeleton (`clawctl agents list`, `clawctl agents add`, `clawctl agents status`)
- [x] SSH connection manager (Tailscale-aware)
- [x] Basic health check (ping agent, get openclaw status)
- [x] AWS SDK v3 setup + credential config
- [x] Agent provisioning: `clawctl agents deploy` — SSH into a fresh host (EC2 or existing), install OpenClaw via official install script (`curl -fsSL https://docs.openclaw.ai/install.sh | bash` or equivalent), configure openclaw.json + .env, set up systemd service, and register in the fleet. Should support both fresh EC2 spin-up and "adopt" an existing server.
- [x] Tailscale integration — `network status`, `network list`, `network tag` commands via Tailscale API v2
- [x] `clawctl init` — interactive setup of ~/.clawctl/ with config and templates directory
- [x] `agents info` — detailed agent view, `agents update` — field-level updates
- [x] Status persistence — `agents status` writes online/offline/degraded back to registry
- [x] `agents status --verbose` — detailed openclaw status output (version, uptime, model, channels)
- [x] `agents logs <id>` — SSH log tailing with --lines and --follow support
- [x] Colored CLI output via chalk (green/red/yellow for status indicators)
- [x] Gitleaks pre-commit hook
- [x] Deploy templates — bundled openclaw.json / .env / systemd unit in src/deploy/default-templates.ts, seeded by `clawctl init`
- [x] Verbose status bug fix — nested objects now formatted as key-value tree instead of [object Object]
- [x] Log formatting — JSON log lines parsed and displayed as `[timestamp] [LEVEL] message`

## Phase 2: Config & Secrets
- [x] Config sync — `config push <agent-id>` SCPs openclaw.json + .env and restarts gateway; `config pull <agent-id>` fetches remote config locally
- [x] Drift detection — `config diff <agent-id>` shows unified diff of local vs remote config; `--all` for fleet-wide check
- [x] Secrets vault (local-first) — AES-256-GCM encrypted store at ~/.clawctl/secrets.json with master password; `secrets set/get/list/delete/push` commands with per-agent scoping
- [ ] Secrets vault (AWS) — migrate to AWS Secrets Manager backend

## Phase 3: Intelligence Layer
- [x] OpenClaw skill/agent that uses clawctl as a tool
- [ ] Diagnostic reasoning (agent down → check systemd → check logs → diagnose)
- [ ] Policy engine (rules file, enforcement on operations)
- [ ] Audit log (DynamoDB append-only table)

## Phase 4: Web Dashboard
The dashboard is a first-class feature, not an afterthought. The model is: **interact via agent, visualize via web**. Both surfaces read/write the same data layer.
- [ ] Lightweight web UI (Next.js or plain React + Vite)
- [ ] Fleet overview: all agents, status, last heartbeat, host, role
- [ ] Agent detail view: config, recent logs, health history, secrets access log
- [ ] Audit log viewer with filtering
- [ ] Policy violations / alerts panel
- [ ] Real-time updates (WebSocket or polling)
- [ ] Read-only by default, with optional action buttons (restart, sync config) behind confirmation

## Phase 5: Fleet Operations
- [x] EC2 instance provisioning for new agents (done in Phase 1 via `agents deploy fresh`)
- [ ] SSM integration (remote commands without SSH)
- [ ] Rolling updates across fleet
- [ ] CloudWatch log aggregation + alerting
- [ ] Alerting (Telegram/email on failures)

## Existing Landscape
- **claworc** (gluk-w/claworc) — reverse proxy + auth + web dashboard. Infra focused.
- **openclaw-fleet** (vibewrk) — declarative YAML manifests, drift detection. Ops focused.
- **openclaw-mission-control** (abhi1693) — orchestration dashboard. UI focused.
- **Gap**: None have agent intelligence + secrets vault + policy enforcement.