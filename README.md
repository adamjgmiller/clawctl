# clawctl

> ⚠️ **Early development — not production-ready.** This project is actively being built. Commands may change, features are incomplete, and things will break. If you're here to explore or contribute, welcome. If you need something stable, check back later.

Agent-native control plane for managing [OpenClaw](https://openclaw.ai) fleets. Not just infra tooling — an intelligence layer that reasons about fleet state, diagnoses issues, enforces policy, and takes corrective action with human-in-the-loop for sensitive operations.

**License:** AGPL-3.0 — open core, dual-licensed for hosted deployments.

## What Makes It Different

| Tool | Focus |
|------|-------|
| claworc | Reverse proxy + auth |
| openclaw-fleet | Declarative YAML manifests |
| openclaw-mission-control | Dashboard UI |
| **clawctl** | **Agent intelligence + secrets + policy + alerting** |

## Architecture

- **Agent Registry** — catalog of managed agents (local JSON, DynamoDB-ready)
- **Secrets Vault** — AES-256-GCM encrypted, per-agent scoping, push to remote `.env`
- **Policy Engine** — rules file gates operations (deny/allow/confirm) with agent field conditions
- **Audit Log** — append-only JSON + DynamoDB store wired into every operation
- **Health Monitor** — SSH-based status checks, diagnose, watch with alerts
- **Dashboard** — REST API + dark-themed SPA at `clawctl dashboard start`
- **Alerting** — Telegram notifications on state changes (offline/degraded/recovered)

## Install

```bash
git clone https://github.com/adamjgmiller/clawctl
cd clawctl
npm install
npm run build
npm link   # or: alias clawctl="node /path/to/clawctl/dist/cli/index.js"
```

## Setup

```bash
clawctl init                    # create ~/.clawctl/ with config + templates
clawctl agents add \
  --name my-agent \
  --host myhost.ts.net \
  --tailscale-ip 100.x.y.z \
  --role worker \
  --user openclaw
```

## Commands

### Agents

```bash
clawctl agents list                         # list all agents
clawctl agents add --name ... --host ...    # register an agent
clawctl agents info <id>                    # detailed agent info
clawctl agents update <id> --role worker    # update fields
clawctl agents remove <id>                  # deregister
clawctl agents status [id]                  # SSH health check (all or one)
clawctl agents status [id] --verbose        # full openclaw status
clawctl agents logs <id>                    # tail gateway logs
clawctl agents logs <id> --follow           # live log tail
clawctl agents diagnose <id>                # systemd + logs + disk + memory report
clawctl agents diagnose <id> --fix          # diagnose + auto-restart if stopped
clawctl agents exec <id> uptime             # run command via SSH
clawctl agents exec <id> uptime --ssm       # run command via AWS SSM
```

### Config

```bash
clawctl config push <id>                    # SCP openclaw.json + .env → agent, restart gateway
clawctl config pull <id>                    # fetch remote config to ~/.clawctl/pulled/
clawctl config diff <id>                    # show drift vs local templates
clawctl config diff --all                   # diff all agents
```

### Secrets

```bash
clawctl secrets set <key> <value>           # store encrypted secret
clawctl secrets set <key> <value> --agent <id>  # per-agent secret
clawctl secrets get <key>                   # retrieve secret
clawctl secrets list                        # list all secrets
clawctl secrets delete <key>                # remove secret
clawctl secrets push <id>                   # write agent's secrets to remote .env
```

### Policy

```bash
clawctl policy list                         # show all rules
clawctl policy check <action> [agent-id]    # test if action would be allowed
clawctl policy init                         # write default policy to ~/.clawctl/policy.json
clawctl policy add --id <id> \
  --action "config.push" --effect deny \
  --condition "role:eq:worker"              # add a rule
clawctl policy remove <id>                  # remove a rule
```

Policy rules use action patterns (`agent.*`, `config.push`, `*`) and conditions on agent fields (`role`, `status`, `tags`, `name`). Enforcement is automatic on `config push` and `secrets push`.

### Dashboard

```bash
clawctl dashboard start                     # start API + UI on port 3100
clawctl dashboard start --port 8080
```

Open `http://localhost:3100` for the fleet dashboard (dark theme, agent cards, audit log, policy rules, auto-refresh 15s).

API endpoints:
- `GET /api/agents` — fleet list
- `GET /api/agents/:id` — single agent
- `GET /api/audit?limit=50` — recent audit log
- `GET /api/policy` — current policy
- `GET /api/health` — server health check

### Alerting

```bash
clawctl alerts status                       # show alert config
clawctl alerts set-telegram \
  --bot-token <token> \
  --chat-id <chat-id>                       # configure Telegram alerts
clawctl alerts enable / disable             # toggle alerting
clawctl alerts test --severity critical     # send test alert
```

### Fleet Watch

```bash
clawctl watch                               # poll every 60s, print status table, alert on changes
clawctl watch --interval 30                 # poll every 30s
```

### Rolling Updates

```bash
clawctl update check                        # show OpenClaw versions across fleet
clawctl update fleet                        # update all agents to latest (rolling, 1 at a time)
clawctl update fleet --role worker          # filter by role
clawctl update fleet --concurrency 2        # 2 agents at once
clawctl update fleet --dry-run              # preview without updating
clawctl update fleet --channel beta         # update to beta channel
clawctl update fleet --no-restart           # update package only, skip gateway restart
```

### Network (Tailscale)

```bash
clawctl network status                      # tailnet overview
clawctl network list                        # list devices
clawctl network tag <device-id> <tags...>   # tag a device
```

### Deploy

```bash
# Adopt an existing Tailscale-reachable server
clawctl agents deploy adopt \
  --name my-agent \
  --tailscale-ip 100.x.y.z \
  --role worker

# Provision a fresh EC2 instance (requires AWS creds + Tailscale auth key)
clawctl agents deploy fresh \
  --name my-agent \
  --role worker \
  --ami ami-xxx \
  --key-pair my-key \
  --security-group sg-xxx
```

## Configuration

All config lives in `~/.clawctl/`:

| File | Purpose |
|------|---------|
| `config.json` | clawctl settings (EC2 defaults, SSH key, tailnet) |
| `agents.json` | Agent registry |
| `secrets.json` | AES-256-GCM encrypted secrets vault |
| `policy.json` | Policy rules |
| `alerts.json` | Alert channel config |
| `audit.json` | Local audit log |
| `templates/` | Deploy templates (openclaw.json, .env) |

Environment variables: `TAILSCALE_API_KEY`, `TAILSCALE_TAILNET`, `TAILSCALE_AUTH_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.

## OpenClaw Skill

Install the clawctl skill into any OpenClaw agent so it can manage the fleet conversationally:

```bash
bash skill/install.sh
```

Then your agent can handle requests like:
- "Check the status of all fleet agents"
- "Diagnose the cs-bot agent"
- "Push config to the worker agents"
- "Show me the audit log"

See `skill/SKILL.md` and `skill/examples.md` for full documentation.

## Roadmap

- [x] Agent registry + CLI
- [x] SSH health checks, log tailing, diagnose
- [x] Config sync + drift detection
- [x] Secrets vault (local AES-256-GCM, push to agents)
- [x] Policy engine with enforcement
- [x] Audit log (local JSON + DynamoDB)
- [x] Web dashboard (REST API + SPA)
- [x] Alerting (Telegram) + fleet watch
- [x] SSM integration + agents exec
- [x] Rolling updates across fleet
- [ ] CloudWatch log aggregation
- [ ] DynamoDB registry + secrets (production mode)
- [x] Dashboard action buttons (restart, diagnose)
