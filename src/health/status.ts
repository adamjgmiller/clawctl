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
    const result = await ssh.execOnAgent(agent, 'source ~/.nvm/nvm.sh 2>/dev/null; openclaw status --json');

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

export function formatStatusTable(results: AgentStatusResult[]): string {
  const header = ['NAME', 'ROLE', 'HOST', 'TAILSCALE IP', 'REACHABLE', 'STATUS'];
  const rows = results.map((r) => {
    const reachableStr = r.reachable ? chalk.green('yes') : chalk.red('no');
    const statusStr = r.reachable
      ? r.error
        ? chalk.yellow(r.error)
        : chalk.green('ok')
      : chalk.red(r.error ?? 'unreachable');
    return [
      r.agent.name,
      r.agent.role,
      r.agent.host,
      r.agent.tailscaleIp,
      reachableStr,
      statusStr,
    ];
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
  const colWidths = header.map((_, i) =>
    Math.max(...allPlainRows.map((row) => row[i].length)),
  );

  const formatRow = (row: string[], plainRow: string[]) =>
    row.map((cell, i) => {
      const pad = colWidths[i] - plainRow[i].length;
      return cell + ' '.repeat(Math.max(0, pad));
    }).join('  ');

  const formatPlainRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join('  ');

  const separator = colWidths.map((w) => '-'.repeat(w)).join('  ');

  return [
    formatPlainRow(header),
    separator,
    ...rows.map((row, i) => formatRow(row, plainRows[i])),
  ].join('\n');
}
