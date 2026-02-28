import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent } from '../types/index.js';
import { SshClient } from '../ssh/index.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'worker-templates');

interface WorkerConfig {
  name: string;
  capabilities: string[];
  description: string;
  operatorName: string;
  operatorTimezone: string;
  orchestratorName?: string;
  orchestratorSessionKey?: string;
}

async function loadTemplate(name: string): Promise<string> {
  return readFile(join(TEMPLATES_DIR, name), 'utf-8');
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function buildFleetOverview(agents: Agent[]): string {
  if (agents.length === 0) return '_No other agents in the fleet._';
  return agents.map((a) => {
    const caps = (a as any).capabilities?.length > 0 ? ` (${(a as any).capabilities.join(', ')})` : '';
    return `- **${a.name}** (${a.role})${caps} — ${a.tailscaleIp}`;
  }).join('\n');
}

export async function bootstrapWorker(
  ssh: SshClient,
  config: WorkerConfig,
  fleet: Agent[],
  onStep?: (msg: string) => void,
): Promise<void> {
  const log = onStep ?? (() => {});
  const workspace = '~/.openclaw/workspace';

  log('Creating workspace directories...');
  await ssh.exec(`mkdir -p ${workspace}/memory ${workspace}/skills ${workspace}/knowledge-base`);

  const vars: Record<string, string> = {
    WORKER_NAME: config.name,
    WORKER_ROLE: config.capabilities.join(', ') || 'general',
    WORKER_CAPABILITIES: config.capabilities.join(', ') || 'general purpose',
    WORKER_DESCRIPTION: config.description,
    OPERATOR_NAME: config.operatorName,
    OPERATOR_TIMEZONE: config.operatorTimezone,
    ORCHESTRATOR_NAME: config.orchestratorName ?? 'orchestrator',
    ORCHESTRATOR_SESSION_KEY: config.orchestratorSessionKey ?? '(not configured)',
    FLEET_OVERVIEW: buildFleetOverview(fleet),
  };

  const templates = ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md'];
  for (const name of templates) {
    log(`Writing ${name}...`);
    const raw = await loadTemplate(name);
    const rendered = renderTemplate(raw, vars);
    await ssh.putContent(rendered, `${workspace}/${name}`);
  }

  // Write initial files
  await ssh.putContent('[]', `${workspace}/memory/pending-followups.json`);
  const today = new Date().toISOString().split('T')[0];
  const dayNote = `# ${today}\n\n## Deployment\n- Worker "${config.name}" bootstrapped at ${new Date().toISOString()}\n- Capabilities: ${config.capabilities.join(', ')}\n- Description: ${config.description}\n`;
  await ssh.putContent(dayNote, `${workspace}/memory/${today}.md`);

  log('Worker workspace bootstrapped successfully');
}
