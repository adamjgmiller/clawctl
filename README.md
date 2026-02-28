# clawctl

Agent-native control plane for managing OpenClaw fleets. Not just infra tooling — an intelligence layer that reasons about fleet state, diagnoses issues, enforces policy, and takes corrective action with human-in-the-loop for sensitive operations.

## Architecture

Six core components:

1. **Agent Registry** — catalog of managed agents (local JSON initially, DynamoDB later)
2. **Secrets Vault** — encrypted store via AWS Secrets Manager with per-agent scoping
3. **Policy Engine** — rules for agent permissions (spending limits, channels, escalation, tools)
4. **Command Layer** — CLI + agent interface (deploy, configure, update, restart, monitor)
5. **Audit Log** — immutable record of actions (DynamoDB append-only)
6. **Health Monitor** — heartbeat tracking, log aggregation, alerting

## Getting Started

### Prerequisites

- Node.js >= 20
- SSH key at `~/.ssh/id_ed25519` (configurable)
- Tailscale for agent connectivity
- AWS credentials (for Phases 2+)

### Install

```bash
npm install
npm run build
npm link  # makes `clawctl` available globally
```

### Configure

Configuration lives at `~/.clawctl/config.json` and is auto-created on first run:

```json
{
  "awsProfile": "default",
  "awsRegion": "us-east-1",
  "sshKeyPath": "~/.ssh/id_ed25519",
  "sshUser": "openclaw",
  "agentsFilename": "agents.json"
}
```

### Add an Agent

```bash
clawctl agents add \
  --name my-worker \
  --host worker-1.example.com \
  --tailscale-ip 100.64.0.1 \
  --role worker
```

### Check Status

```bash
clawctl agents list
clawctl agents status          # SSH health check on all agents
clawctl agents status <id>     # Check a specific agent
clawctl agents status --json   # JSON output
```

## CLI Reference

```
clawctl agents list [--json]                    List registered agents
clawctl agents add --name --host --tailscale-ip --role [options]   Register an agent
clawctl agents remove <id>                      Remove an agent
clawctl agents status [id] [--json]             Check agent health via SSH
```

### agents add options

| Flag | Required | Description |
|------|----------|-------------|
| `--name` | yes | Agent name |
| `--host` | yes | Hostname (display) |
| `--tailscale-ip` | yes | Tailscale IPv4 address |
| `--role` | yes | `orchestrator`, `worker`, `monitor`, or `gateway` |
| `--user` | no | SSH user (default: `openclaw`) |
| `--tags` | no | Comma-separated tags |
| `--aws-instance-id` | no | EC2 instance ID |
| `--aws-region` | no | AWS region |

## Development

```bash
npm run dev -- agents list       # Run CLI via tsx (no build step)
npm run build                    # Compile TypeScript to dist/
npm run typecheck                # Type-check without emitting
npm run lint                     # ESLint
npm run format                   # Prettier (write)
npm run format:check             # Prettier (check)
```

## Roadmap

See [PLAN.md](./PLAN.md) for the full roadmap:

- **Phase 1** (current): Foundation — registry, CLI, SSH, health checks, AWS setup
- **Phase 2**: Config & Secrets — vault, config sync, drift detection
- **Phase 3**: Intelligence Layer — reasoning agent, policy engine, audit log
- **Phase 4**: Web Dashboard — fleet overview, agent detail, audit viewer
- **Phase 5**: Fleet Operations — EC2 provisioning, SSM, rolling updates, alerting

## License

AGPL-3.0 — see [LICENSE](./LICENSE).
