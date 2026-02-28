# clawctl — Fleet Management Skill

You have access to `clawctl`, a control plane CLI for managing your OpenClaw fleet. Use it to check agent health, push configuration, manage secrets, and diagnose issues across all agents you manage.

clawctl operates on a registry of agents stored at `~/.clawctl/agents.json`. Each agent has an ID, hostname (Tailscale IP), role, and status. All management happens over SSH via Tailscale.

## Commands

### Fleet Overview

```bash
clawctl agents list                    # List all registered agents
clawctl agents status                  # Check online/offline/degraded for all agents
clawctl agents status --verbose        # Detailed status: version, uptime, model, channels
clawctl agents info <id>               # Full detail for one agent
clawctl agents logs <id>               # Tail recent logs (--lines N, --follow)
```

### Agent Management

```bash
clawctl agents add --name <n> --host <ip> --role <r>   # Register a new agent
clawctl agents update <id> --role <r> --host <ip>      # Update agent fields
clawctl agents deploy fresh --name <n> --role <r>      # Provision new EC2 + install OpenClaw
clawctl agents deploy adopt --name <n> --host <ip>     # Adopt existing server into fleet
```

### Configuration

```bash
clawctl config push <agent-id>         # Push local openclaw.json + .env to agent, restart
clawctl config pull <agent-id>         # Fetch remote config to local for inspection
clawctl config diff <agent-id>         # Unified diff of local vs remote config
clawctl config diff --all              # Drift check across entire fleet
```

### Secrets

```bash
clawctl secrets set <key> <value>      # Store encrypted secret in vault
clawctl secrets get <key>              # Retrieve a secret (prompts for master password)
clawctl secrets list                   # List all stored secret keys
clawctl secrets push <agent-id>        # Push scoped secrets to agent's .env
```

### Network

```bash
clawctl network list                   # List Tailscale devices in the tailnet
clawctl network status                 # Connectivity status for fleet nodes
```

### Setup

```bash
clawctl init                           # Interactive setup of ~/.clawctl/ directory
```

## Interpreting Status Output

| Status     | Meaning                            | Action                                        |
|------------|------------------------------------|-----------------------------------------------|
| `online`   | Agent responding, gateway healthy  | No action needed                              |
| `offline`  | Agent unreachable via SSH          | Check Tailscale connectivity, then systemd    |
| `degraded` | Agent reachable but gateway error  | Check logs, restart gateway, check config     |

When `--verbose` is used, status includes OpenClaw version, uptime, active model, and connected channels. Use this to spot version drift or misconfigured agents.

## Workflows

**Check fleet health:** Run `clawctl agents status`. If any agent is offline or degraded, run `clawctl agents status --verbose` for detail, then `clawctl agents logs <id>` to inspect logs.

**Push config to all agents:** Run `clawctl config diff --all` first to preview changes. Then run `clawctl config push <id>` for each agent that has drift. Verify with `clawctl agents status` after.

**Diagnose a failing agent:** Start with `clawctl agents info <id>` for agent details. Run `clawctl agents status --verbose` to see gateway state. Check `clawctl agents logs <id> --lines 50` for errors. If the gateway is down, config push will restart it. If the host is unreachable, check `clawctl network status`.

**Rotate a secret:** Run `clawctl secrets set <KEY> <new-value>` to update the vault. Then `clawctl secrets push <id>` for each agent that uses that key. The push updates the agent's `.env` and restarts the gateway.

## Important Notes

- All commands require `~/.clawctl/` to be initialized. Run `clawctl init` first if needed.
- Secret operations prompt for the vault master password.
- Config push restarts the agent's OpenClaw gateway. Plan for brief downtime.
- Always diff before pushing config to avoid overwriting remote-only changes.
- Use `agents status` after any change to confirm the fleet is healthy.
