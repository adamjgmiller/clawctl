# clawctl Skill — Example Conversations

## 1. "Is the fleet healthy?"

**User:** Are all my agents running okay?

**Agent thinks:** I need to check fleet-wide status.

```bash
clawctl agents status
```

**Output:**
```
  agent-1 (web-support)    online   100.64.0.1
  agent-2 (sales-bot)      online   100.64.0.2
  agent-3 (ops-monitor)    offline  100.64.0.3
```

**Agent responds:** 2 of 3 agents are online and healthy. agent-3 (ops-monitor) is offline. Want me to diagnose it?

**User:** Yes, check what's wrong.

```bash
clawctl network status
```

**Output:**
```
  100.64.0.1  online   agent-1
  100.64.0.2  online   agent-2
  100.64.0.3  offline  agent-3
```

**Agent responds:** agent-3 is unreachable on Tailscale, so this is a host-level issue — not just the OpenClaw gateway. The machine may be down or Tailscale disconnected. You'll need to check the EC2 instance directly (via AWS console or SSH from another path) to bring it back.

---

## 2. "Push my updated config to all agents"

**User:** I updated my openclaw.json template. Push it to everyone.

**Agent thinks:** I should check for drift first before blindly pushing.

```bash
clawctl config diff --all
```

**Output:**
```
--- agent-1 remote
+++ local
@@ -3,2 +3,2 @@
-  "model": "claude-sonnet-4-5-20250514"
+  "model": "claude-sonnet-4-6-20260220"

--- agent-2 remote
+++ local
@@ -3,2 +3,2 @@
-  "model": "claude-sonnet-4-5-20250514"
+  "model": "claude-sonnet-4-6-20260220"

agent-3: no drift detected
```

**Agent responds:** agent-1 and agent-2 have config drift — the model needs updating from claude-sonnet-4-5-20250514 to claude-sonnet-4-6-20260220. agent-3 is already in sync. I'll push to the two that need it. This will restart their gateways briefly.

**User:** Go ahead.

```bash
clawctl config push agent-1
clawctl config push agent-2
```

```bash
clawctl agents status
```

**Output:**
```
  agent-1 (web-support)    online   100.64.0.1
  agent-2 (sales-bot)      online   100.64.0.2
  agent-3 (ops-monitor)    online   100.64.0.3
```

**Agent responds:** Done. Config pushed to agent-1 and agent-2, both are back online with the updated model. All 3 agents healthy.

---

## 3. "One of my agents is down, diagnose it"

**User:** agent-2 seems to not be responding to users. Can you figure out what's going on?

**Agent thinks:** I'll start with detailed status, then check logs.

```bash
clawctl agents status --verbose
```

**Output:**
```
  agent-1 (web-support)    online     100.64.0.1
    version: 0.9.2  uptime: 4d 12h  model: claude-sonnet-4-6-20260220  channels: slack, web
  agent-2 (sales-bot)      degraded   100.64.0.2
    version: 0.9.2  uptime: 0h 3m   model: claude-sonnet-4-6-20260220  channels: none
  agent-3 (ops-monitor)    online     100.64.0.3
    version: 0.9.2  uptime: 2d 8h   model: claude-sonnet-4-6-20260220  channels: slack
```

**Agent thinks:** agent-2 is degraded — it's reachable and running, but has 0 channels connected and only 3 minutes of uptime (recently restarted). Let me check logs.

```bash
clawctl agents logs agent-2 --lines 30
```

**Output:**
```
[2026-02-28 14:22:01] [ERROR] Slack connection failed: invalid_auth
[2026-02-28 14:22:01] [ERROR] Web channel failed to bind: port 3000 already in use
[2026-02-28 14:22:02] [WARN]  No active channels. Gateway running but not serving.
[2026-02-28 14:22:05] [INFO]  Retrying Slack connection in 60s...
```

**Agent responds:** Found the issues with agent-2:

1. **Slack auth is failing** — "invalid_auth" means the Slack bot token is expired or revoked. Needs a new token.
2. **Web channel can't start** — port 3000 is in use by another process on that host.

For the Slack token, I can push a new one via secrets if you have it. For the port conflict, someone will need to SSH in and kill whatever is holding port 3000, or change the web channel port in the config.

**User:** The Slack token was rotated yesterday. New one is xoxb-new-token-here. Fix it.

```bash
clawctl secrets set SLACK_BOT_TOKEN xoxb-new-token-here
clawctl secrets push agent-2
```

```bash
clawctl agents status agent-2
```

**Agent responds:** Updated the Slack token and pushed to agent-2. The gateway restarted. Checking status now... agent-2 is online with Slack channel connected. The web channel port conflict will still need manual attention on the host.

---

## 4. "Rotate the OPENAI_API_KEY secret"

**User:** I need to rotate my OpenAI API key across the fleet. New key is sk-proj-abc123.

**Agent thinks:** I need to update the vault, then push to all agents that use this key.

```bash
clawctl secrets set OPENAI_API_KEY sk-proj-abc123
```

**Agent thinks:** Now I need to know which agents use this key. Let me check who's in the fleet.

```bash
clawctl agents list
```

**Output:**
```
  agent-1  web-support   100.64.0.1
  agent-2  sales-bot     100.64.0.2
  agent-3  ops-monitor   100.64.0.3
```

**Agent responds:** Secret updated in the vault. I'll push it to all 3 agents now. Each push will restart the gateway — expect a few seconds of downtime per agent.

**User:** Do it.

```bash
clawctl secrets push agent-1
clawctl secrets push agent-2
clawctl secrets push agent-3
```

```bash
clawctl agents status
```

**Output:**
```
  agent-1 (web-support)    online   100.64.0.1
  agent-2 (sales-bot)      online   100.64.0.2
  agent-3 (ops-monitor)    online   100.64.0.3
```

**Agent responds:** OPENAI_API_KEY rotated and pushed to all 3 agents. Everyone is back online. Remember to revoke the old key in your OpenAI dashboard.
