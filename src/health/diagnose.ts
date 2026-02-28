import chalk from 'chalk';
import { SshClient } from '../ssh/index.js';
import type { Agent } from '../types/index.js';

export interface DiagnosticFinding {
  check: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  detail?: string;
}

export interface DiagnosticReport {
  agent: Agent;
  reachable: boolean;
  timestamp: string;
  findings: DiagnosticFinding[];
  recommendations: string[];
  gatewayRunning: boolean;
}

export async function diagnoseAgent(agent: Agent): Promise<DiagnosticReport> {
  const report: DiagnosticReport = {
    agent,
    reachable: false,
    timestamp: new Date().toISOString(),
    findings: [],
    recommendations: [],
    gatewayRunning: false,
  };

  const ssh = new SshClient(agent.sshKeyPath);
  try {
    await ssh.connect(agent);
    report.reachable = true;
    report.findings.push({
      check: 'ssh',
      status: 'ok',
      message: 'SSH connection successful',
    });
  } catch (err) {
    report.findings.push({
      check: 'ssh',
      status: 'error',
      message: 'SSH connection failed',
      detail: err instanceof Error ? err.message : String(err),
    });
    report.recommendations.push('Check Tailscale connectivity: clawctl network status');
    report.recommendations.push('Verify the host is running and SSH is accepting connections');
    return report;
  }

  try {
    // 1. Systemd service status
    const systemd = await ssh.exec('systemctl --user status openclaw-gateway 2>&1');
    const systemdOutput = systemd.stdout || systemd.stderr;
    const isActive = systemdOutput.includes('Active: active (running)');
    const isFailed = systemdOutput.includes('Active: failed') || systemdOutput.includes('Active: inactive');

    if (isActive) {
      report.gatewayRunning = true;
      report.findings.push({
        check: 'systemd',
        status: 'ok',
        message: 'openclaw-gateway is active and running',
      });
    } else if (isFailed) {
      report.findings.push({
        check: 'systemd',
        status: 'error',
        message: 'openclaw-gateway is not running',
        detail: systemdOutput.split('\n').slice(0, 5).join('\n'),
      });
      report.recommendations.push('Restart the gateway: use --fix flag or run manually via SSH');
    } else {
      report.findings.push({
        check: 'systemd',
        status: 'warning',
        message: 'openclaw-gateway status unclear',
        detail: systemdOutput.split('\n').slice(0, 5).join('\n'),
      });
      report.recommendations.push('Inspect systemd status manually on the host');
    }

    // 2. Recent log lines
    const logs = await ssh.exec('tail -n 50 /tmp/openclaw/*.log 2>/dev/null || echo "NO_LOGS"');
    const logOutput = logs.stdout.trim();
    if (logOutput === 'NO_LOGS' || !logOutput) {
      report.findings.push({
        check: 'logs',
        status: 'warning',
        message: 'No log files found in /tmp/openclaw/',
      });
      report.recommendations.push('Check if OpenClaw is configured to write logs to /tmp/openclaw/');
    } else {
      const lines = logOutput.split('\n');
      const errorLines = lines.filter((l) => /error|fatal|panic/i.test(l));
      const warnLines = lines.filter((l) => /warn/i.test(l));

      if (errorLines.length > 0) {
        report.findings.push({
          check: 'logs',
          status: 'error',
          message: `Found ${errorLines.length} error lines in last 50 log lines`,
          detail: errorLines.slice(-5).join('\n'),
        });
        report.recommendations.push('Review full logs: clawctl agents logs ' + agent.id);
      } else if (warnLines.length > 0) {
        report.findings.push({
          check: 'logs',
          status: 'warning',
          message: `Found ${warnLines.length} warning lines in last 50 log lines`,
          detail: warnLines.slice(-3).join('\n'),
        });
      } else {
        report.findings.push({
          check: 'logs',
          status: 'ok',
          message: 'No errors or warnings in last 50 log lines',
        });
      }
    }

    // 3. Disk space
    const disk = await ssh.exec("df -h / | tail -1 | awk '{print $5, $4}'");
    const diskParts = disk.stdout.trim().split(/\s+/);
    if (diskParts.length >= 2) {
      const usagePct = parseInt(diskParts[0], 10);
      const available = diskParts[1];
      if (usagePct >= 95) {
        report.findings.push({
          check: 'disk',
          status: 'error',
          message: `Disk usage critical: ${usagePct}% used, ${available} available`,
        });
        report.recommendations.push('Free disk space immediately — agent may fail to write logs or configs');
      } else if (usagePct >= 85) {
        report.findings.push({
          check: 'disk',
          status: 'warning',
          message: `Disk usage high: ${usagePct}% used, ${available} available`,
        });
        report.recommendations.push('Consider cleaning up old logs or expanding disk');
      } else {
        report.findings.push({
          check: 'disk',
          status: 'ok',
          message: `Disk usage: ${usagePct}% used, ${available} available`,
        });
      }
    }

    // 4. Memory
    const mem = await ssh.exec("free -m | awk '/^Mem:/ {printf \"%d %d %d\", $2, $3, $7}'");
    const memParts = mem.stdout.trim().split(/\s+/);
    if (memParts.length >= 3) {
      const totalMb = parseInt(memParts[0], 10);
      const usedMb = parseInt(memParts[1], 10);
      const availableMb = parseInt(memParts[2], 10);
      const usagePct = Math.round((usedMb / totalMb) * 100);

      if (availableMb < 256) {
        report.findings.push({
          check: 'memory',
          status: 'error',
          message: `Memory critical: ${availableMb}MB available of ${totalMb}MB (${usagePct}% used)`,
        });
        report.recommendations.push('Agent may OOM — consider upgrading instance or reducing workload');
      } else if (usagePct >= 85) {
        report.findings.push({
          check: 'memory',
          status: 'warning',
          message: `Memory high: ${availableMb}MB available of ${totalMb}MB (${usagePct}% used)`,
        });
      } else {
        report.findings.push({
          check: 'memory',
          status: 'ok',
          message: `Memory: ${availableMb}MB available of ${totalMb}MB (${usagePct}% used)`,
        });
      }
    }
  } finally {
    ssh.disconnect();
  }

  return report;
}

export async function restartGateway(agent: Agent): Promise<{ success: boolean; output: string }> {
  const ssh = new SshClient(agent.sshKeyPath);
  try {
    await ssh.connect(agent);
    const result = await ssh.exec('systemctl --user restart openclaw-gateway 2>&1');
    const success = result.code === 0;
    return { success, output: result.stdout || result.stderr };
  } finally {
    ssh.disconnect();
  }
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`Diagnostic Report: ${report.agent.name} (${report.agent.id})`));
  lines.push(chalk.dim(`Timestamp: ${report.timestamp}`));
  lines.push(chalk.dim(`Host: ${report.agent.host} (${report.agent.tailscaleIp})`));
  lines.push('');

  // Findings
  lines.push(chalk.bold('Checks:'));
  for (const f of report.findings) {
    const icon =
      f.status === 'ok' ? chalk.green('PASS')
      : f.status === 'warning' ? chalk.yellow('WARN')
      : chalk.red('FAIL');
    lines.push(`  [${icon}] ${chalk.bold(f.check)}: ${f.message}`);
    if (f.detail) {
      for (const d of f.detail.split('\n')) {
        lines.push(chalk.dim(`         ${d}`));
      }
    }
  }

  // Summary
  const errors = report.findings.filter((f) => f.status === 'error').length;
  const warnings = report.findings.filter((f) => f.status === 'warning').length;
  lines.push('');
  if (errors > 0) {
    lines.push(chalk.red(`${errors} error(s), ${warnings} warning(s)`));
  } else if (warnings > 0) {
    lines.push(chalk.yellow(`${warnings} warning(s), no errors`));
  } else {
    lines.push(chalk.green('All checks passed'));
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Recommended actions:'));
    for (const r of report.recommendations) {
      lines.push(`  → ${r}`);
    }
  }

  return lines.join('\n');
}
