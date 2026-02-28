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

### Initialize

```bash
clawctl init
```

Interactively sets up `~/.clawctl/` with config and templates directory. Prompts for AWS region, SSH key path, default SSH user, and AWS profile. If already initialized, shows current config and offers to update.

### Configure

Configuration lives at `~/.clawctl/config.json` and is auto-created on first run (or via `clawctl init`):

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
clawctl agents status              # SSH health check on all agents
clawctl agents status <id>         # Check a specific agent
clawctl agents status --verbose    # Detailed output (version, uptime, model, channels)
clawctl agents status --json       # JSON output
```

## CLI Reference

### init

```
clawctl init    Interactive setup of ~/.clawctl/ directory and config
```

### agents

```
clawctl agents list [--json]                                       List registered agents
clawctl agents add --name --host --tailscale-ip --role [options]   Register an agent
clawctl agents remove <id>                                         Remove an agent
clawctl agents info <id> [--json]                                  Show detailed agent info
clawctl agents update <id> [--name] [--host] [--role] [...]        Update agent fields
clawctl agents status [id] [--json] [--verbose] [--ssh-key]        Check agent health via SSH
clawctl agents logs <id> [--lines N] [--follow]                    Tail openclaw gateway logs
```

#### agents add options

| Flag | Required | Description |
|------|----------|-------------|
| `--name` | yes | Agent name |
| `--host` | yes | Hostname (display) |
| `--tailscale-ip` | yes | Tailscale IPv4 address |
| `--role` | yes | `orchestrator`, `worker`, `monitor`, or `gateway` |
| `--user` | no | SSH user (default: `openclaw`) |
| `--tags` | no | Comma-separated tags |
| `--ssh-key` | no | SSH private key path for this agent |
| `--aws-instance-id` | no | EC2 instance ID |
| `--aws-region` | no | AWS region |

#### agents info

Show all stored fields for an agent:

```bash
clawctl agents info <id>          # Human-readable output
clawctl agents info <id> --json   # JSON output
```

#### agents update

Update one or more fields on an existing agent:

```bash
clawctl agents update <id> --name new-name --role gateway --tags "prod,us-east"
```

Supported flags: `--name`, `--host`, `--tailscale-ip`, `--role`, `--user`, `--tags`.

#### agents status

Health checks persist the result (online/offline/degraded) back to the registry, so `agents list` reflects last known state.

```bash
clawctl agents status                  # Check all agents
clawctl agents status <id>             # Check one agent
clawctl agents status --verbose        # Detailed: version, uptime, model, channels
clawctl agents status --ssh-key ~/.ssh/other_key   # Override SSH key
```

#### agents logs

Tail the openclaw gateway log from `/tmp/openclaw/` on the agent's host:

```bash
clawctl agents logs <id>               # Last 50 lines
clawctl agents logs <id> --lines 100   # Last 100 lines
clawctl agents logs <id> --follow      # Live tail (Ctrl+C to stop)
```

### network

Requires `TAILSCALE_API_KEY` and `TAILSCALE_TAILNET` environment variables.

```
clawctl network status [--json] [--tag <tag>]    List tag:clawctl devices (default)
clawctl network list [--json]                    List ALL tailnet devices
clawctl network tag <device-id> <tag>            Add a tag to a device
```

#### network list

List every device on your tailnet:

```bash
clawctl network list           # Table output
clawctl network list --json    # JSON output
```

#### network tag

Add a Tailscale tag to a device (e.g., to bring it into the clawctl fleet):

```bash
clawctl network tag <device-id> clawctl
```

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

- **Phase 1** (current): Foundation — registry, CLI, SSH, health checks, AWS setup, Tailscale integration
- **Phase 2**: Config & Secrets — vault, config sync, drift detection
- **Phase 3**: Intelligence Layer — reasoning agent, policy engine, audit log
- **Phase 4**: Web Dashboard — fleet overview, agent detail, audit viewer
- **Phase 5**: Fleet Operations — EC2 provisioning, SSM, rolling updates, alerting

## License

AGPL-3.0 — see [LICENSE](./LICENSE).
