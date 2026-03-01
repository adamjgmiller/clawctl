import { Command } from 'commander';
import chalk from 'chalk';
import { input, select, confirm } from '@inquirer/prompts';
import { JsonAgentStore } from '../../registry/index.js';
import { SshClient } from '../../ssh/index.js';
import { ensureSecurityGroup } from '../../deploy/ec2.js';
import { bootstrapOrchestrator } from '../../deploy/orchestrator.js';
import { audit } from '../../audit/index.js';
import { writeFile } from 'node:fs/promises';
import { loadWizardDefaults, saveWizardDefaults } from '../../config/wizard-defaults.js';
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
          { name: 'Deploy a new worker', value: 'worker' },
          { name: 'Add an existing agent to the fleet', value: 'add-agent' },
          { name: 'Configure alerting (Telegram)', value: 'alerts' },
          { name: 'Run initial fleet health check', value: 'health' },
        ],
      });

      if (action === 'orchestrator') await orchestratorWizard();
      else if (action === 'worker') await workerWizard();
      else if (action === 'add-agent') await addAgentWizard();
      else if (action === 'alerts') await alertsWizard();
      else if (action === 'health') await healthWizard();
    });

  return wizard;
}

async function orchestratorWizard(): Promise<void> {
  const defaults = await loadWizardDefaults();
  console.log('');
  console.log(chalk.bold('Deploy a Fleet Orchestrator'));
  console.log(chalk.dim('I\'ll walk you through setting up an orchestrator that manages your agents.\n'));

  // Operator info
  const operatorName = await input({ message: 'Your name (the human operator):', default: defaults.operatorName || '' });
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
    default: defaults.operatorEmail,
  });

  console.log('');

  // Target server
  const serverSource = await select({
    message: 'Where should the orchestrator run?',
    choices: [
      { name: 'I have a server ready (Tailscale IP)', value: 'existing' },
      { name: 'Create a new EC2 instance on AWS', value: 'aws' },
    ],
  });

  let tailscaleIp: string;
  let sshUser: string;
  let sshKey: string;
  let awsInstanceId: string | undefined;
  let awsRegion: string | undefined;
  let tailscaleApiKey: string | undefined;

  if (serverSource === 'aws') {
    console.log('');
    console.log(chalk.bold('AWS EC2 Setup'));
    console.log(chalk.dim('I\'ll create a new instance and install Tailscale + OpenClaw on it.\n'));

    const awsKeyId = await input({
      message: 'AWS Access Key ID:' + (defaults.awsAccessKeyId ? ' (saved: ...' + defaults.awsAccessKeyId.slice(-4) + ')' : ''),
      default: defaults.awsAccessKeyId,
      validate: (v: string) => v.startsWith('AKIA') || v.startsWith('ASIA') || 'Should start with AKIA... or ASIA...',
    });
    const awsSecret = await input({
      message: 'AWS Secret Access Key:' + (defaults.awsSecretAccessKey ? ' (saved)' : ''),
      default: defaults.awsSecretAccessKey,
      validate: (v: string) => v.length > 20 || 'Enter a valid secret key',
    });
    awsRegion = await select({
      message: 'AWS Region:',
      choices: [
        { name: 'US East (N. Virginia) — us-east-1', value: 'us-east-1' },
        { name: 'US West (Oregon) — us-west-2', value: 'us-west-2' },
        { name: 'EU West (Ireland) — eu-west-1', value: 'eu-west-1' },
        { name: 'EU Central (Frankfurt) — eu-central-1', value: 'eu-central-1' },
        { name: 'AP Southeast (Singapore) — ap-southeast-1', value: 'ap-southeast-1' },
        { name: 'Other (enter manually)', value: 'custom' },
      ],
    });
    if (awsRegion === 'custom') {
      awsRegion = await input({ message: 'AWS Region (e.g. us-east-2):' });
    }

    const instanceType = await select({
      message: 'Instance size:',
      choices: [
        { name: 't3.micro — 2 vCPU, 1 GB (free tier eligible, light use)', value: 't3.micro' },
        { name: 't3.small — 2 vCPU, 2 GB (recommended for orchestrator)', value: 't3.small' },
        { name: 't3.medium — 2 vCPU, 4 GB (heavier workloads)', value: 't3.medium' },
        { name: 'Other (enter manually)', value: 'custom' },
      ],
    });
    const instanceTypeId = instanceType === 'custom' ? await input({ message: 'Instance type:' }) : instanceType;

    const keyPair = await input({
      message: 'EC2 Key Pair name (for SSH access):',
      default: defaults.keyPair,
      validate: (v: string) => v.length > 0 || 'Required',
    });

    sshKey = await input({
      message: 'Local path to the matching SSH private key:',
      default: '~/.ssh/' + keyPair + '.pem',
    });

    const tailscaleAuthKey = await input({
      message: 'Tailscale auth key (from admin.tailscale.com/keys):',
      default: defaults.tailscaleAuthKey,
      validate: (v: string) => v.startsWith('tskey-') || 'Should start with tskey-...',
    });

    const tailscaleApiKey = await input({
      message: 'Tailscale API key (for network commands, from admin.tailscale.com/keys):',
      default: defaults.tailscaleApiKey,
      validate: (v: string) => v.startsWith('tskey-api-') || 'Should start with tskey-api-...',
    });

    console.log('');
    console.log(chalk.dim('Provisioning EC2 instance...'));

    // Set AWS credentials for this process
    process.env.AWS_ACCESS_KEY_ID = awsKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = awsSecret;
    process.env.AWS_REGION = awsRegion;

    const { EC2Client, RunInstancesCommand, DescribeInstancesCommand, waitUntilInstanceRunning } = await import('@aws-sdk/client-ec2');
    const ec2 = new EC2Client({ region: awsRegion });

    // Find latest Ubuntu 24.04 AMI
    const { DescribeImagesCommand } = await import('@aws-sdk/client-ec2');
    console.log(chalk.dim('  Finding latest Ubuntu 24.04 AMI...'));
    const amiRes = await ec2.send(new DescribeImagesCommand({
      Owners: ['099720109477'],
      Filters: [
        { Name: 'name', Values: ['ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*'] },
        { Name: 'state', Values: ['available'] },
      ],
    }));
    const amis = (amiRes.Images || []).sort((a, b) => (b.CreationDate || '').localeCompare(a.CreationDate || ''));
    if (amis.length === 0) throw new Error('No Ubuntu 24.04 AMI found in ' + awsRegion);
    const ami = amis[0].ImageId!;
    console.log(chalk.dim('  Using AMI: ' + ami));

    // User data script to install Tailscale + OpenClaw
    const userData = Buffer.from([
      '#!/bin/bash',
      'set -e',
      '# Install Tailscale',
      'curl -fsSL https://tailscale.com/install.sh | sh',
      'tailscale up --auth-key=' + tailscaleAuthKey + ' --hostname=orchestrator',
      '# Create user',
      'useradd -m -s /bin/bash openclaw || true',
      '# Install NVM + Node for openclaw user',
      'su - openclaw -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"',
      'su - openclaw -c "source ~/.nvm/nvm.sh && nvm install 22 && npm i -g openclaw@latest"',
      '# Enable linger for systemd user services',
      'loginctl enable-linger openclaw',
    ].join('\n')).toString('base64');

    console.log(chalk.dim('  Ensuring security group...'));
    const sgId = await ensureSecurityGroup(ec2);
    console.log(chalk.dim('  Security group: ' + sgId));
    console.log(chalk.dim('  Launching instance (' + instanceTypeId + ')...'));
    const runRes = await ec2.send(new RunInstancesCommand({
      ImageId: ami,
      InstanceType: instanceTypeId as any,
      KeyName: keyPair,
      SecurityGroupIds: [sgId],
      MinCount: 1,
      MaxCount: 1,
      UserData: userData,
      TagSpecifications: [{
        ResourceType: 'instance',
        Tags: [
          { Key: 'Name', Value: 'clawctl-orchestrator' },
          { Key: 'ManagedBy', Value: 'clawctl' },
          { Key: 'Project', Value: 'clawctl' },
        ],
      }],
    }));

    awsInstanceId = runRes.Instances?.[0]?.InstanceId;
    if (!awsInstanceId) throw new Error('Failed to get instance ID');
    console.log(chalk.dim('  Instance ID: ' + awsInstanceId));

    console.log(chalk.dim('  Waiting for instance to be running...'));
    await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [awsInstanceId] });

    // Get public IP for initial SSH (before Tailscale is up)
    const descRes = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [awsInstanceId] }));
    const publicIp = descRes.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;
    console.log(chalk.dim('  Public IP: ' + (publicIp || 'none')));

    console.log(chalk.yellow('  Waiting 60s for user-data to install Tailscale + OpenClaw...'));
    await new Promise(r => setTimeout(r, 60000));

    // Try to find the Tailscale IP
    console.log(chalk.dim('  Looking for Tailscale IP...'));
    const resolvedKey = sshKey.replace('~', process.env.HOME ?? '');
    const tmpSsh = new SshClient(resolvedKey);
    let attempts = 0;
    tailscaleIp = '';
    while (attempts < 10 && !tailscaleIp) {
      attempts++;
      try {
        await tmpSsh.connectTo(publicIp!, 'ubuntu');
        const tsIp = await tmpSsh.exec('tailscale ip -4 2>/dev/null || echo ""');
        tailscaleIp = tsIp.stdout.trim();
        tmpSsh.disconnect();
      } catch {
        tmpSsh.disconnect();
        if (attempts < 10) {
          console.log(chalk.dim('  Attempt ' + attempts + '/10, retrying in 15s...'));
          await new Promise(r => setTimeout(r, 15000));
        }
      }
    }

    if (!tailscaleIp) {
      console.log(chalk.yellow('  Could not detect Tailscale IP automatically.'));
      tailscaleIp = await input({
        message: 'Enter the Tailscale IP manually (check admin.tailscale.com):',
        validate: (v: string) => /^\d+\.\d+\.\d+\.\d+$/.test(v) || 'Enter a valid IP',
      });
    } else {
      console.log(chalk.green('  Tailscale IP: ' + tailscaleIp));
    }

    sshUser = 'openclaw';
    console.log(chalk.green('  ✓ EC2 instance provisioned'));
    console.log('');
  } else {
    tailscaleIp = await input({
      message: 'Tailscale IP of the server:',
      validate: (v: string) => /^\d+\.\d+\.\d+\.\d+$/.test(v) || 'Enter a valid IP address',
    });
    sshUser = await input({ message: 'SSH username:', default: 'openclaw' });
    sshKey = await input({
      message: 'Path to your SSH private key:',
      default: '~/.ssh/id_ed25519',
    });

    tailscaleApiKey = await input({
      message: 'Tailscale API key (for network commands, optional):',
      default: defaults.tailscaleApiKey || '',
    });
  }

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
    if (tailscaleApiKey) envLines.push(`TAILSCALE_API_KEY=${tailscaleApiKey}`);
    await ssh.putContent(envLines.join('\n') + '\n', '~/.openclaw/.env');

    // Register in fleet
    const agent = await store.add({
      name: agentName,
      host: tailscaleIp,
      tailscaleIp,
      role: 'orchestrator',
      user: sshUser,
      capabilities: [],
      tags: ['orchestrator'],
      sshKeyPath: resolvedKey,
    });

    console.log('');
    console.log(chalk.green('✓ Orchestrator deployed!'));

    // Save wizard defaults for next run
    await saveWizardDefaults({
      operatorName,
      operatorEmail: operatorEmail || undefined,
      operatorTimezone,
      awsAccessKeyId: serverSource === 'aws' ? process.env.AWS_ACCESS_KEY_ID : defaults.awsAccessKeyId,
      awsSecretAccessKey: serverSource === 'aws' ? process.env.AWS_SECRET_ACCESS_KEY : defaults.awsSecretAccessKey,
      awsRegion: awsRegion || defaults.awsRegion,
      tailscaleApiKey: tailscaleApiKey || defaults.tailscaleApiKey,
    });
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

async function workerWizard(): Promise<void> {
  const defaults = await loadWizardDefaults();
  console.log('');
  console.log(chalk.bold('Deploy a Fleet Worker'));
  console.log(chalk.dim('I\'ll set up a specialized worker agent.\n'));

  // Worker identity
  const name = await input({ message: 'Worker name (e.g. research-bot, content-writer):' });
  const description = await input({ message: 'What does this worker do?' });
  const capabilities = await input({
    message: 'Capabilities (comma-separated, e.g. research,writing,analysis):',
    validate: (v: string) => v.length > 0 || 'At least one capability required',
  });

  // Operator info
  const operatorName = await input({ message: 'Your name (the human operator):', default: defaults.operatorName || '' });
  const operatorTimezone = await input({ message: 'Your timezone:', default: 'America/Los_Angeles' });

  console.log('');

  // Find orchestrator in fleet
  const store = new JsonAgentStore();
  const fleet = await store.list();
  const orchestrators = fleet.filter(a => a.role === 'orchestrator');
  let orchestratorName = '';
  let orchestratorSessionKey = '';
  if (orchestrators.length > 0) {
    const orchChoice = orchestrators.length === 1
      ? orchestrators[0]
      : await select({
          message: 'Which orchestrator manages this worker?',
          choices: orchestrators.map(o => ({ name: o.name, value: o })),
        });
    const orch = orchestrators.length === 1 ? orchestrators[0] : orchChoice as any;
    orchestratorName = orch.name;
    orchestratorSessionKey = (orch as any).sessionKey || '';
    console.log(chalk.dim('  Orchestrator: ' + orchestratorName));
  }

  // Server
  const serverSource = await select({
    message: 'Where should the worker run?',
    choices: [
      { name: 'I have a server ready (Tailscale IP)', value: 'existing' },
      { name: 'Create a new EC2 instance on AWS', value: 'aws' },
    ],
  });

  let tailscaleIp: string;
  let sshUser: string;
  let sshKey: string;

  if (serverSource === 'aws') {
    // Reuse the same AWS flow — for now, keep it simple
    console.log(chalk.yellow('\nFor AWS provisioning, use: clawctl agents deploy fresh'));
    console.log('Then come back and run the wizard to bootstrap the worker workspace.');
    console.log('Or provide an existing server below.\n');
    tailscaleIp = await input({
      message: 'Tailscale IP of the server:',
      validate: (v: string) => /^\d+\.\d+\.\d+\.\d+$/.test(v) || 'Enter a valid IP',
    });
    sshUser = await input({ message: 'SSH username:', default: 'openclaw' });
    sshKey = await input({ message: 'SSH private key path:', default: '~/.ssh/id_ed25519' });
  } else {
    tailscaleIp = await input({
      message: 'Tailscale IP of the server:',
      validate: (v: string) => /^\d+\.\d+\.\d+\.\d+$/.test(v) || 'Enter a valid IP',
    });
    sshUser = await input({ message: 'SSH username:', default: 'openclaw' });
    sshKey = await input({ message: 'SSH private key path:', default: '~/.ssh/id_ed25519' });
  }

  console.log('');

  // Model
  const model = await select({
    message: 'Which model should this worker use?',
    choices: [
      { name: 'Claude Sonnet 4 (good balance)', value: 'anthropic/claude-sonnet-4-6' },
      { name: 'Claude Opus 4 (most capable)', value: 'anthropic/claude-opus-4-6' },
      { name: 'GPT-5 Mini (fast, affordable)', value: 'openai/gpt-5-mini' },
      { name: 'Custom', value: 'custom' },
    ],
  });
  const modelId = model === 'custom' ? await input({ message: 'Model ID:' }) : model;

  // API key
  const apiProvider = await select({
    message: 'API provider:',
    choices: [
      { name: 'Anthropic', value: 'anthropic' },
      { name: 'OpenAI', value: 'openai' },
    ],
  });
  const apiKey = await input({
    message: apiProvider + ' API key:',
    validate: (v: string) => v.length > 10 || 'Enter a valid API key',
  });

  // Telegram?
  const setupTelegram = await confirm({ message: 'Set up Telegram channel?', default: false });
  let telegramToken = '';
  if (setupTelegram) {
    telegramToken = await input({
      message: 'Telegram bot token:',
      validate: (v: string) => v.includes(':') || 'Should look like 123456:ABC...',
    });
  }

  // Summary
  console.log('');
  console.log(chalk.bold('Summary:'));
  console.log('  Name:          ' + name);
  console.log('  Capabilities:  ' + capabilities);
  console.log('  Description:   ' + description);
  console.log('  Server:        ' + sshUser + '@' + tailscaleIp);
  console.log('  Model:         ' + modelId);
  console.log('  Orchestrator:  ' + (orchestratorName || 'none'));
  console.log('');

  const proceed = await confirm({ message: 'Deploy this worker?', default: true });
  if (!proceed) { console.log(chalk.yellow('Cancelled.')); return; }

  console.log('');
  const resolvedKey = sshKey.replace('~', process.env.HOME ?? '');
  const ssh = new SshClient(resolvedKey);

  try {
    console.log(chalk.dim('Connecting to ' + tailscaleIp + '...'));
    await ssh.connectTo(tailscaleIp, sshUser);

    // Check OpenClaw
    const check = await ssh.exec('source ~/.nvm/nvm.sh 2>/dev/null; which openclaw 2>/dev/null');
    if (!check.stdout.trim()) {
      console.log('Installing OpenClaw...');
      await ssh.exec('curl -fsSL https://docs.openclaw.ai/install.sh | bash');
      console.log(chalk.green('  OpenClaw installed'));
    } else {
      console.log(chalk.dim('  OpenClaw already installed'));
    }

    // Bootstrap worker workspace
    const { bootstrapWorker } = await import('../../deploy/worker.js');
    await bootstrapWorker(ssh, {
      name,
      capabilities: capabilities.split(',').map(c => c.trim()),
      description,
      operatorName,
      operatorTimezone,
      orchestratorName,
      orchestratorSessionKey,
    }, fleet, (msg) => console.log('  ' + msg));

    // Generate openclaw.json
    console.log('  Writing openclaw.json...');
    const openclawConfig: Record<string, unknown> = {
      meta: { name, role: 'worker' },
      auth: { [apiProvider]: { apiKey } },
      agents: { default: 'main', entries: [{ id: 'main', model: modelId }] },
      messages: { defaultModel: modelId, contextTokens: 200000 },
      heartbeat: { agents: [{ agentId: 'main', enabled: true, every: '30m' }] },
    };
    if (setupTelegram) {
      (openclawConfig as any).channels = { telegram: { enabled: true, token: telegramToken } };
    }
    await ssh.putContent(JSON.stringify(openclawConfig, null, 2) + '\n', '~/.openclaw/openclaw.json');

    // Write .env
    console.log('  Writing .env...');
    const envKey = apiProvider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    await ssh.putContent(envKey + '=' + apiKey + '\n', '~/.openclaw/.env');

    // Register
    const capsArray = capabilities.split(',').map(c => c.trim());
    const agent = await store.add({
      name,
      host: tailscaleIp,
      tailscaleIp,
      role: 'worker',
      user: sshUser,
      tags: capsArray,
      sshKeyPath: resolvedKey,
      capabilities: capsArray,
      description,
    });

    console.log('');
    console.log(chalk.green('✓ Worker deployed!'));
    console.log('  Agent ID:      ' + agent.id);
    console.log('  Name:          ' + agent.name);
    console.log('  Capabilities:  ' + capsArray.join(', '));
    console.log('');

    const startNow = await confirm({ message: 'Start the gateway now?', default: true });
    if (startNow) {
      console.log(chalk.dim('Starting gateway...'));
      await ssh.exec('source ~/.nvm/nvm.sh 2>/dev/null; openclaw gateway install 2>/dev/null; systemctl --user start openclaw-gateway.service 2>/dev/null || openclaw gateway start &');
      await new Promise(r => setTimeout(r, 3000));
      const status = await ssh.exec('systemctl --user is-active openclaw-gateway.service 2>/dev/null || echo "starting"');
      console.log(status.stdout.trim() === 'active' ? chalk.green('  ✓ Gateway running') : chalk.yellow('  Status: ' + status.stdout.trim()));
    }

    console.log('');
    console.log(chalk.bold('The orchestrator can now delegate tasks to this worker:'));
    console.log('  clawctl tasks create --title "..." --capabilities ' + capsArray[0]);
    console.log('');

    await audit('agent.deploy.worker' as any, {
      agentId: agent.id,
      agentName: agent.name,
      detail: { capabilities: capsArray, description } as Record<string, unknown>,
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
    capabilities: [],
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
