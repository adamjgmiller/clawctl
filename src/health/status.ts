import chalk from 'chalk';
import { SshClient } from '../ssh/index.js';
import type { Agent } from '../types/index.js';

export interface AgentStatusResult {
  agent: Agent;
  reachable: boolean;
  openclawStatus?: Record<string, unknown>;
  raw?: string;
  error?: string;
}

export async function getAgentStatus(agent: Agent): Promise<AgentStatusResult> {
  const ssh = new SshClient(agent.sshKeyPath);
  try {
    const result = await ssh.execOnAgent(
      agent,
      'source ~/.nvm/nvm.sh 2>/dev/null; openclaw status --json',
    );

    if (result.code !== 0) {
      return {
        agent,
        reachable: true,
        raw: result.stdout || result.stderr,
        error: `Exit code ${result.code}`,
      };
    }

    // Try JSON parse first, fall back to raw text
    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      return { agent, reachable: true, openclawStatus: parsed };
    } catch {
      return { agent, reachable: true, raw: result.stdout };
    }
  } catch (err) {
    return {
      agent,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function formatVerboseStatus(status: Record<string, unknown>): string[] {
  const lines: string[] = [];

  // Extract the most useful top-level fields from openclaw status JSON
  const gateway = status.gateway as Record<string, unknown> | undefined;
  const sessions = status.sessions as Record<string, unknown> | undefined;
  const os = status.os as Record<string, unknown> | undefined;

  // Version — could be top-level or nested in gateway
  const version = status.version ?? gateway?.version;
  if (version) lines.push(`  Version:      ${version}`);

  // Uptime — top-level or gateway
  const uptime = status.uptime ?? gateway?.uptime;
  if (uptime) lines.push(`  Uptime:       ${uptime}`);

  // Model
  const model = status.model ?? gateway?.model;
  if (model) lines.push(`  Model:        ${model}`);

  // Active channels
  const channels = status.channels ?? gateway?.channels;
  if (channels) {
    if (Array.isArray(channels)) {
      lines.push(`  Channels:     ${channels.join(', ')}`);
    } else {
      lines.push(`  Channels:     ${channels}`);
    }
  }

  // Active sessions count
  if (sessions) {
    const active = sessions.active ?? sessions.count;
    if (active !== undefined) {
      lines.push(`  Sessions:     ${active}`);
    }
  }

  // OS info
  if (os) {
    const osInfo = [os.platform, os.arch, os.release].filter(Boolean).join(' ');
    if (osInfo) lines.push(`  OS:           ${osInfo}`);
  }

  // Print remaining top-level fields not already handled
  const handled = new Set(['version', 'uptime', 'model', 'channels', 'gateway', 'sessions', 'os']);
  for (const [k, v] of Object.entries(status)) {
    if (handled.has(k)) continue;
    if (v !== null && typeof v === 'object') {
      lines.push(`  ${k}:`);
      for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
        if (subV !== null && typeof subV === 'object') {
          lines.push(`    ${subK}: ${JSON.stringify(subV)}`);
        } else {
          lines.push(`    ${subK}: ${String(subV)}`);
        }
      }
    } else {
      lines.push(`  ${k.padEnd(12)}  ${String(v)}`);
    }
  }

  return lines;
}

export function formatLogLine(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const time = obj.time ? new Date(obj.time as string | number).toISOString() : '???';
    const level =
      typeof obj.level === 'string'
        ? obj.level.toUpperCase()
        : typeof obj.level === 'number'
          ? levelNumberToName(obj.level)
          : 'INFO';
    // OpenClaw logs store the human-readable message in field '1' or 'msg'
    const message = obj['1'] ?? obj.msg ?? obj.message ?? '';
    return `[${time}] [${level}] ${message}`;
  } catch {
    return raw;
  }
}

function levelNumberToName(level: number): string {
  if (level <= 10) return 'TRACE';
  if (level <= 20) return 'DEBUG';
  if (level <= 30) return 'INFO';
  if (level <= 40) return 'WARN';
  if (level <= 50) return 'ERROR';
  return 'FATAL';
}

export function formatLogOutput(output: string): string {
  return output
    .split('\n')
    .map((line) => (line.trim() ? formatLogLine(line) : line))
    .join('\n');
}

export function formatStatusTable(results: AgentStatusResult[]): string {
  const header = ['NAME', 'ROLE', 'HOST', 'TAILSCALE IP', 'REACHABLE', 'STATUS'];
  const rows = results.map((r) => {
    const reachableStr = r.reachable ? chalk.green('yes') : chalk.red('no');
    const statusStr = r.reachable
      ? r.error
        ? chalk.yellow(r.error)
        : chalk.green('ok')
      : chalk.red(r.error ?? 'unreachable');
    return [r.agent.name, r.agent.role, r.agent.host, r.agent.tailscaleIp, reachableStr, statusStr];
  });
  // Plain versions for column width calculation (chalk adds invisible ANSI codes)
  const plainRows = results.map((r) => [
    r.agent.name,
    r.agent.role,
    r.agent.host,
    r.agent.tailscaleIp,
    r.reachable ? 'yes' : 'no',
    r.reachable ? (r.error ?? 'ok') : (r.error ?? 'unreachable'),
  ]);

  const allPlainRows = [header, ...plainRows];
  const colWidths = header.map((_, i) => Math.max(...allPlainRows.map((row) => row[i].length)));

  const formatRow = (row: string[], plainRow: string[]) =>
    row
      .map((cell, i) => {
        const pad = colWidths[i] - plainRow[i].length;
        return cell + ' '.repeat(Math.max(0, pad));
      })
      .join('  ');

  const formatPlainRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join('  ');

  const separator = colWidths.map((w) => '-'.repeat(w)).join('  ');

  return [
    formatPlainRow(header),
    separator,
    ...rows.map((row, i) => formatRow(row, plainRows[i])),
  ].join('\n');
}
