/** Bundled default templates for new OpenClaw deployments. */

export const DEFAULT_OPENCLAW_JSON = `{
  "name": "my-agent",
  "gateway": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "channels": ["discord"],
  "model": "claude-sonnet-4-20250514",
  "tools": [],
  "cron": {
    "enabled": false,
    "jobsFile": "cron/jobs.json"
  }
}
`;

export const DEFAULT_ENV_TEMPLATE = `# OpenClaw environment variables
# Copy this to .env and fill in your values

# Required: Anthropic API key for the model
ANTHROPIC_API_KEY=

# Discord bot token (if using discord channel)
DISCORD_TOKEN=

# Slack bot token (if using slack channel)
SLACK_BOT_TOKEN=

# Optional: override gateway port (default 3000)
# PORT=3000

# Optional: log level (debug, info, warn, error)
# LOG_LEVEL=info
`;

export const DEFAULT_SYSTEMD_UNIT = `[Unit]
Description=OpenClaw Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/.openclaw
ExecStart=/bin/bash -lc 'source %h/.nvm/nvm.sh 2>/dev/null; openclaw gateway start'
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
