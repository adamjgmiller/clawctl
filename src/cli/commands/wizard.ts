import { Command } from 'commander';
import chalk from 'chalk';
import { input, select, confirm } from '@inquirer/prompts';
import { JsonAgentStore } from '../../registry/index.js';
import { SshClient } from '../../ssh/index.js';
import { bootstrapOrchestrator } from '../../deploy/orchestrator.js';
import { audit } from '../../audit/index.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createWizardCommand(): Command {
  const wizard = new Command('wizard')
    .description('Interactive setup wizard')
    .action(async () => {
      console.log('');
      console.log(chalk.bold('🦞 clawctl Setup Wizard'));
      console.log(chalk.dim('Let\'s get your fleet up and running.\n'));

      const action = await select({
        message: 'What would you like to do?',
        choices: [
          { name: 'Deploy a new orchestrator', value: 'orchestrator' },
          { name: 'Add an existing agent to the fleet', value: 'add-agent' },
          { name: 'Configure alerting (Telegram)', value: 'alerts' },
          { name: 'Run initial fleet health check', value: 'health' },
        ],
      });

      if (action === 'orchestrator') await orchestratorWizard();
      else if (action === 'add-agent') await addAgentWizard();
      else if (action === 'alerts') await alertsWizard();
      else if (action === 'health') await healthWizard();
    });

  return wizard;
}

async function orchestratorWizard(): Promise<void> {
  console.log('');
  console.log(chalk.bold('Deploy a Fleet Orchestrator'));
  console.log(chalk.dim('I\'ll walk you through setting up an orchestrator that manages your agents.\n'));

  // Operator info
  const operatorName = await input({ message: 'Your name (the human operator):' });
  const operatorTimezone = await input({
    message: 'Your timezone:',
    default: 'America/Los_Angeles',
  });
  const operatorTelegram = await input({
    message: 'Your Telegram chat ID (for alerts, leave blank to skip):',
    default: '',
  });
  const operatorEmail = await input({
    message: 'Your email (for reports, leave blank to skip):',
    default: '',
  });

  console.log('');

  // Target server
  const tailscaleIp = await input({
    message: 'Tailscale IP of the server to deploy on:',
    validate: (v: string) => /^\d+\.\d+\.\d+\.\d+$/.test(v) || 'Enter a valid IP address',
  });
  const sshUser = await input({ message: 'SSH username on that server:', default: 'openclaw' });
  const sshKey = await input({
    message: 'Path to your SSH private key:',
    default: '~/.ssh/id_ed25519',
  });
  const agentName = await input({ message: 'Name for this orchestrator:', default: 'orchestrator' });

  console.log('');

  // Model
  const model = await select({
    message: 'Which model should the orchestrator use?',
    choices: [
      { name: 'Claude Sonnet 4 (good balance of speed/cost)', value: 'anthropic/claude-sonnet-4-6' },
      { name: 'Claude Opus 4 (most capable, higher cost)', value: 'anthropic/claude-opus-4-6' },
      { name: 'GPT-5 Mini (fast, affordable)', value: 'openai/gpt-5-mini' },
      { name: 'Custom (enter manually)', value: 'custom' },
    ],
  });
  const modelId = model === 'custom' ? await input({ message: 'Model ID:' }) : model;

  // Channel
  const setupTelegram = await confirm({
    message: 'Set up Telegram as a communication channel?',
    default: true,
  });
  let telegramToken = '';
  if (setupTelegram) {
    telegramToken = await input({
      message: 'Telegram bot token (from @BotFather):',
      validate: (v: string) => v.includes(':') || 'Should look like 123456:ABC...',
    });
  }

  // API key
  const apiProvider = await select({
    message: 'Which API provider for the model?',
    choices: [
      { name: 'Anthropic', value: 'anthropic' },
      { name: 'OpenAI', value: 'openai' },
    ],
  });
  const apiKey = await input({
    message: `${apiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key:`,
    validate: (v: string) => v.length > 10 || 'Enter a valid API key',
  });

  // Heartbeat
  const heartbeatInterval = await select({
    message: 'How often should the orchestrator check fleet health?',
    choices: [
      { name: 'Every 15 minutes (recommended)', value: '15m' },
      { name: 'Every 30 minutes', value: '30m' },
      { name: 'Every hour', value: '1h' },
    ],
  });

  console.log('');
  console.log(chalk.bold('Summary:'));
  console.log(`  Operator:    ${operatorName} (${operatorTimezone})`);
  console.log(`  Server:      ${sshUser}@${tailscaleIp}`);
  console.log(`  Agent name:  ${agentName}`);
  console.log(`  Model:       ${modelId}`);
  console.log(`  Telegram:    ${setupTelegram ? 'yes' : 'no'}`);
  console.log(`  Heartbeat:   ${heartbeatInterval}`);
  console.log('');

  const proceed = await confirm({ message: 'Deploy this orchestrator?', default: true });
  if (!proceed) {
    console.log(chalk.yellow('Cancelled.'));
    return;
  }

  console.log('');
  const store = new JsonAgentStore();
  const fleet = await store.list();
  const resolvedKey = sshKey.replace('~', process.env.HOME ?? '');

  const ssh = new SshClient(resolvedKey);
  try {
    console.log(chalk.dim('Connecting to ' + tailscaleIp + '...'));
    await ssh.connectTo(tailscaleIp, sshUser);

    // Check if OpenClaw is installed
    const check = await ssh.exec('source ~/.nvm/nvm.sh 2>/dev/null; which openclaw 2>/dev/null');
    if (!check.stdout.trim()) {
      console.log('Installing OpenClaw...');
      await ssh.exec('curl -fsSL https://docs.openclaw.ai/install.sh | bash');
      console.log(chalk.green('  OpenClaw installed'));
    } else {
      console.log(chalk.dim('  OpenClaw already installed'));
    }

    // Bootstrap workspace
    await bootstrapOrchestrator(ssh, {
      operatorName,
      operatorTimezone,
      operatorEmail: operatorEmail || undefined,
      operatorTelegram: operatorTelegram || undefined,
      model: modelId,
    }, fleet, (msg) => console.log('  ' + msg));

    // Generate and push openclaw.json
    console.log('  Writing openclaw.json...');
    const openclawConfig: Record<string, unknown> = {
      meta: { name: agentName, role: 'orchestrator' },
      auth: {
        [apiProvider]: { apiKey },
      },
      agents: {
        default: 'main',
        entries: [{
          id: 'main',
          model: modelId,
        }],
      },
      messages: {
        defaultModel: modelId,
        contextTokens: 200000,
      },
      heartbeat: {
        agents: [{
          agentId: 'main',
          enabled: true,
          every: heartbeatInterval,
        }],
      },
    } as Record<string, unknown>;

    if (setupTelegram) {
      (openclawConfig as any).channels = {
        telegram: {
          enabled: true,
          token: telegramToken,
        },
      };
    }

    await ssh.putContent(
      JSON.stringify(openclawConfig, null, 2) + '\n',
      '~/.openclaw/openclaw.json',
    );

    // Write .env with API key
    console.log('  Writing .env...');
    const envLines = [];
    if (apiProvider === 'anthropic') envLines.push(`ANTHROPIC_API_KEY=${apiKey}`);
    else envLines.push(`OPENAI_API_KEY=${apiKey}`);
    await ssh.putContent(envLines.join('\n') + '\n', '~/.openclaw/.env');

    // Register in fleet
    const agent = await store.add({
      name: agentName,
      host: tailscaleIp,
      tailscaleIp,
      role: 'orchestrator',
      user: sshUser,
      tags: ['orchestrator'],
      sshKeyPath: resolvedKey,
    });

    console.log('');
    console.log(chalk.green('✓ Orchestrator deployed!'));
    console.log('');
    console.log('  Agent ID:  ' + agent.id);
    console.log('  Name:      ' + agent.name);
    console.log('  Server:    ' + sshUser + '@' + tailscaleIp);
    console.log('');
    
    const startNow = await confirm({ message: 'Start the gateway now?', default: true });
    if (startNow) {
      console.log(chalk.dim('Starting gateway...'));
      await ssh.exec('source ~/.nvm/nvm.sh 2>/dev/null; openclaw gateway install 2>/dev/null; systemctl --user start openclaw-gateway.service 2>/dev/null || openclaw gateway start &');
      // Wait a moment then check
      await new Promise(r => setTimeout(r, 3000));
      const status = await ssh.exec('systemctl --user is-active openclaw-gateway.service 2>/dev/null || echo "starting"');
      const s = status.stdout.trim();
      if (s === 'active') {
        console.log(chalk.green('  ✓ Gateway running'));
      } else {
        console.log(chalk.yellow('  Gateway status: ' + s + ' (may still be starting)'));
        console.log('  Check with: clawctl agents status ' + agentName);
      }
    } else {
      console.log('');
      console.log('To start later:');
      console.log(`  ssh ${sshUser}@${tailscaleIp} "openclaw gateway start"`);
    }

    console.log('');
    console.log(chalk.bold('Next steps:'));
    console.log('  • clawctl agents status          — verify all agents');
    console.log('  • clawctl dashboard start         — view the fleet');
    console.log('  • clawctl watch                   — monitor in real-time');

    await audit('agent.deploy.orchestrator' as any, {
      agentId: agent.id,
      agentName: agent.name,
      detail: { fleet: fleet.length, operator: operatorName } as Record<string, unknown>,
    });
  } catch (err) {
    console.error(chalk.red('\nDeploy failed: ' + (err instanceof Error ? err.message : String(err))));
    process.exitCode = 1;
  } finally {
    ssh.disconnect();
  }
}

async function addAgentWizard(): Promise<void> {
  console.log('');
  console.log(chalk.bold('Add an Agent to the Fleet\n'));

  const name = await input({ message: 'Agent name:' });
  const tailscaleIp = await input({
    message: 'Tailscale IP:',
    validate: (v: string) => /^\d+\.\d+\.\d+\.\d+$/.test(v) || 'Enter a valid IP',
  });
  const user = await input({ message: 'SSH username:', default: 'openclaw' });
  const role = await select({
    message: 'Agent role:',
    choices: [
      { name: 'Worker (handles tasks)', value: 'worker' },
      { name: 'Orchestrator (manages other agents)', value: 'orchestrator' },
      { name: 'Monitor (observes and reports)', value: 'monitor' },
      { name: 'Gateway (API/routing)', value: 'gateway' },
    ],
  });
  const sshKey = await input({
    message: 'SSH private key path:',
    default: '~/.ssh/id_ed25519',
  });

  const store = new JsonAgentStore();
  const agent = await store.add({
    name,
    host: tailscaleIp,
    tailscaleIp,
    role: role as any,
    user,
    tags: [],
    sshKeyPath: sshKey.replace('~', process.env.HOME ?? ''),
  });

  console.log('');
  console.log(chalk.green('✓ Agent registered: ' + agent.name + ' (' + agent.id + ')'));

  const check = await confirm({ message: 'Test connection now?', default: true });
  if (check) {
    const ssh = new SshClient(sshKey.replace('~', process.env.HOME ?? ''));
    try {
      await ssh.connectTo(tailscaleIp, user);
      const uptime = await ssh.exec('uptime');
      console.log(chalk.green('  ✓ Connected: ' + uptime.stdout.trim()));
    } catch (err) {
      console.log(chalk.red('  ✗ Connection failed: ' + (err instanceof Error ? err.message : String(err))));
    } finally {
      ssh.disconnect();
    }
  }
}

async function alertsWizard(): Promise<void> {
  console.log('');
  console.log(chalk.bold('Configure Telegram Alerting\n'));

  const botToken = await input({
    message: 'Telegram bot token:',
    validate: (v: string) => v.includes(':') || 'Should look like 123456:ABC...',
  });
  const chatId = await input({
    message: 'Telegram chat ID to send alerts to:',
    validate: (v: string) => /^-?\d+$/.test(v) || 'Should be a number',
  });

  const { homedir } = await import('node:os');
  const config = { enabled: true, channels: { telegram: { botToken, chatId } } };
  await writeFile(join(homedir(), '.clawctl', 'alerts.json'), JSON.stringify(config, null, 2) + '\n');

  console.log(chalk.green('\n✓ Alerting configured and enabled.'));

  const test = await confirm({ message: 'Send a test alert?', default: true });
  if (test) {
    const { alert } = await import('../../alerting/index.js');
    await alert('info', 'clawctl Test Alert', 'Alerting is configured and working!');
    console.log(chalk.green('  ✓ Test alert sent. Check Telegram.'));
  }
}

async function healthWizard(): Promise<void> {
  console.log('');
  console.log(chalk.bold('Fleet Health Check\n'));

  const store = new JsonAgentStore();
  const agents = await store.list();

  if (agents.length === 0) {
    console.log(chalk.yellow('No agents registered. Run the wizard again to add agents first.'));
    return;
  }

  console.log(chalk.dim(`Checking ${agents.length} agents...\n`));

  const { getAgentStatus, formatVerboseStatus } = await import('../../health/index.js');

  for (const agent of agents) {
    process.stdout.write(`  ${agent.name}... `);
    try {
      const status = await getAgentStatus(agent);
      if (status.reachable) {
        console.log(chalk.green('online'));
      } else {
        console.log(chalk.red('offline — ' + (status.error || 'unreachable')));
      }
      await store.update(agent.id, { status: status.reachable ? 'online' : 'offline' });
    } catch (err) {
      console.log(chalk.red('error — ' + (err instanceof Error ? err.message : String(err))));
    }
  }
  console.log('');
}
