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
  const ssh = new SshClient();
  try {
    const result = await ssh.execOnAgent(agent, 'openclaw status --json');

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
  const rows = results.map((r) => [
    r.agent.name,
    r.agent.role,
    r.agent.host,
    r.agent.tailscaleIp,
    r.reachable ? 'yes' : 'no',
    r.reachable ? (r.error ?? 'ok') : (r.error ?? 'unreachable'),
  ]);

  const allRows = [header, ...rows];
  const colWidths = header.map((_, i) =>
    Math.max(...allRows.map((row) => row[i].length)),
  );

  const formatRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join('  ');

  const separator = colWidths.map((w) => '-'.repeat(w)).join('  ');

  return [formatRow(header), separator, ...rows.map(formatRow)].join('\n');
}
