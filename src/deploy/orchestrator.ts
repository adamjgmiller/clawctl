import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent } from '../types/index.js';
import type { AgentStore } from '../registry/index.js';
import { SshClient } from '../ssh/index.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'orchestrator-templates');

interface OrchestratorConfig {
  operatorName: string;
  operatorTimezone: string;
  operatorTelegram?: string;
  operatorEmail?: string;
  model?: string;
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
  if (agents.length === 0) return '_No agents registered yet._';
  const lines = agents.map((a) => {
    const tags = a.tags.length > 0 ? ` [${a.tags.join(', ')}]` : '';
    return `- **${a.name}** (${a.role}) — ${a.tailscaleIp} / ${a.user}${tags}`;
  });
  return lines.join('\n');
}

export async function bootstrapOrchestrator(
  ssh: SshClient,
  config: OrchestratorConfig,
  fleet: Agent[],
  onStep?: (msg: string) => void,
): Promise<void> {
  const log = onStep ?? (() => {});
  const workspace = '~/.openclaw/workspace';

  log('Creating workspace directories...');
  await ssh.exec(`mkdir -p ${workspace}/memory ${workspace}/skills ${workspace}/projects`);

  // Load and render templates
  const fleetOverview = buildFleetOverview(fleet);
  const vars: Record<string, string> = {
    OPERATOR_NAME: config.operatorName,
    OPERATOR_TIMEZONE: config.operatorTimezone,
    FLEET_OVERVIEW: fleetOverview,
  };

  const templates = ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md'];
  for (const name of templates) {
    log(`Writing ${name}...`);
    const raw = await loadTemplate(name);
    const rendered = renderTemplate(raw, vars);
    await ssh.putContent(rendered, `${workspace}/${name}`);
  }

  // Write fleet-status.md
  log('Writing fleet-status.md...');
  const statusLines = fleet.map((a) => `| ${a.name} | ${a.role} | ${a.tailscaleIp} | ${a.status} |`);
  const statusMd = [
    '# Fleet Status',
    '',
    '_Last updated: ' + new Date().toISOString() + '_',
    '',
    '| Agent | Role | IP | Status |',
    '|-------|------|----|--------|',
    ...statusLines,
    '',
  ].join('\n');
  await ssh.putContent(statusMd, `${workspace}/fleet-status.md`);

  // Copy clawctl agents registry
  log('Syncing fleet registry...');
  await ssh.exec('mkdir -p ~/.clawctl');
  const { readFile: readLocalFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  try {
    const agentsJson = await readLocalFile(join(homedir(), '.clawctl', 'agents.json'), 'utf-8');
    await ssh.putContent(agentsJson, '~/.clawctl/agents.json');
  } catch {
    log('  (no local agents.json to sync)');
  }

  // Copy policy if it exists
  try {
    const { homedir: hd } = await import('node:os');
    const policyJson = await readLocalFile(join(hd(), '.clawctl', 'policy.json'), 'utf-8');
    await ssh.putContent(policyJson, '~/.clawctl/policy.json');
    log('Synced policy rules');
  } catch {
    log('  (no policy.json to sync)');
  }

  // Install clawctl skill
  log('Installing clawctl skill...');
  const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skill');
  try {
    const skillFiles = await readdir(skillDir);
    await ssh.exec('mkdir -p ~/.openclaw/workspace/skills/clawctl');
    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), 'utf-8');
      await ssh.putContent(content, `~/.openclaw/workspace/skills/clawctl/${file}`);
    }
    log('  Installed clawctl skill files');
  } catch {
    log('  (clawctl skill not found locally, skipping)');
  }

  // Write initial pending-followups.json
  await ssh.putContent('[]', `${workspace}/memory/pending-followups.json`);

  // Write initial daily note
  const today = new Date().toISOString().split('T')[0];
  const dayNote = `# ${today}\n\n## Deployment\n- Orchestrator bootstrapped at ${new Date().toISOString()}\n- Fleet: ${fleet.length} agents registered\n- Operator: ${config.operatorName}\n`;
  await ssh.putContent(dayNote, `${workspace}/memory/${today}.md`);

  log('Orchestrator workspace bootstrapped successfully');
}
