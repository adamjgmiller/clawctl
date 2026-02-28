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

## Task Delegation

As an orchestrator, you can delegate tasks to worker agents.

### Creating and Routing Tasks

```bash
# Create a task and auto-route to best agent
clawctl tasks create --title "Research competitor pricing" \
  --description "Find pricing pages for top 5 DAO infrastructure competitors" \
  --capabilities research

# See which agent would handle a task (dry run)
clawctl tasks route --title "Answer customer question about RMI tax" --capabilities customer-support

# Force-assign to a specific agent
clawctl tasks create --title "Update knowledge base" \
  --description "Add new FAQ entries about token registration" \
  --assign cs-bot
```

### Communicating with Workers

Use OpenClaw's `sessions_send` to talk to workers directly:

```
sessions_send(sessionKey="agent:main:telegram:...", message="Research competitor pricing and report back")
```

The `sessionKey` for each agent is stored in the registry (`clawctl agents info <name>`).

### Monitoring Tasks

```bash
clawctl tasks list                    # all tasks
clawctl tasks list --status running   # in-progress tasks
clawctl tasks info <id>               # full task details
clawctl tasks complete <id> --result "Found 5 competitors..."
clawctl tasks fail <id> --error "Agent was unreachable"
```

### Routing Logic

Tasks are routed based on:
1. **Capability match** — agent capabilities vs required capabilities (10 pts each)
2. **Text match** — task description mentions agent capabilities (5 pts each)
3. **Agent status** — online agents preferred (3 pts)
4. **Session key** — agents with direct messaging get a bonus (2 pts)

### Task Delegation

```bash
clawctl tasks create --title "Title" --description "Instructions" --capabilities "cap1,cap2"
clawctl tasks create --title "Title" --description "Instructions" --dispatch  # Auto-dispatch via SSH
clawctl tasks create --title "Title" --description "Instructions" --assign cs-bot --dispatch
clawctl tasks list                     # List all tasks
clawctl tasks list --status running    # Filter by status
clawctl tasks info <id>                # Full task details
clawctl tasks route --title "Title" --capabilities "cap1"  # Dry run: who would get this?
clawctl tasks dispatch <id>            # Send assigned task to worker via SSH
clawctl tasks poll <id>                # Check if worker finished
clawctl tasks poll <id> --wait 120     # Poll every 10s for up to 2 min
clawctl tasks complete <id> --result "Done"   # Manually mark done
clawctl tasks fail <id> --error "Reason"      # Manually mark failed
clawctl tasks cancel <id>              # Cancel a task
```

#### Direct Messaging (sessions_send)

For real-time task delegation, use `sessions_send` to message workers directly instead of SSH file drops:

```
sessions_send(sessionKey: "<worker-session-key>", message: "Please do X and report back")
```

The worker's session key is stored in the agent registry (`clawctl agents info <name>` shows it). This is the preferred path when the orchestrator is running as an active agent, since the worker can respond conversationally and ask clarifying questions.

The SSH dispatch path (`tasks dispatch`) is for CLI use or when you need fire-and-forget delegation.
