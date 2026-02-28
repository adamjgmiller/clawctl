export function installTailscaleScript(authKey: string): string {
  return [
    'curl -fsSL https://tailscale.com/install.sh | sh',
    `sudo tailscale up --authkey=${authKey} --advertise-tags=tag:clawctl`,
  ].join(' && ');
}

export function getTailscaleIpScript(): string {
  return 'tailscale ip -4';
}

export function installOpenClawScript(): string {
  return 'curl -fsSL https://openclaw.ai/install.sh | bash';
}

const SYSTEMD_UNIT = `[Unit]
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
WantedBy=default.target`;

export function setupSystemdScript(user: string): string {
  const unitPath = `/home/${user}/.config/systemd/user/openclaw.service`;
  const escaped = SYSTEMD_UNIT.replace(/'/g, "'\\''");
  return [
    `mkdir -p /home/${user}/.config/systemd/user`,
    `cat > ${unitPath} << 'UNIT_EOF'\n${escaped}\nUNIT_EOF`,
    'systemctl --user daemon-reload',
    'systemctl --user enable openclaw.service',
    `sudo loginctl enable-linger ${user}`,
  ].join(' && ');
}

export function startServiceScript(): string {
  return 'systemctl --user start openclaw.service';
}
