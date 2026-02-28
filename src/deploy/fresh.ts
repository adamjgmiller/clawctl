import type { FreshDeployInput } from '../types/index.js';
import type { AgentStore } from '../registry/index.js';
import { SshClient } from '../ssh/index.js';
import { createEC2Client } from '../aws/index.js';
import { getAgentStatus } from '../health/index.js';
import { provisionEc2Instance } from './ec2.js';
import { loadDeployTemplates } from './templates.js';
import {
  installTailscaleScript,
  getTailscaleIpScript,
  installOpenClawScript,
  setupSystemdScript,
  startServiceScript,
} from './scripts.js';

export interface DeployCallbacks {
  onStep: (message: string) => void;
}

const SSH_RETRY_COUNT = 10;
const SSH_RETRY_DELAY_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function freshDeploy(
  input: FreshDeployInput,
  store: AgentStore,
  callbacks: DeployCallbacks,
): Promise<void> {
  // 1. Provision EC2
  callbacks.onStep('Provisioning EC2 instance...');
  const ec2 = await createEC2Client();
  const { instanceId, publicIp } = await provisionEc2Instance(ec2, {
    ami: input.ami,
    instanceType: input.instanceType,
    keyPair: input.keyPair,
    securityGroup: input.securityGroup,
    subnetId: input.subnetId,
    name: input.name,
  });
  callbacks.onStep(`EC2 instance ${instanceId} running at ${publicIp}`);

  // 2. SSH retry loop — sshd takes time after EC2 reports "running"
  const ssh = new SshClient(input.sshKeyPath);
  callbacks.onStep('Waiting for SSH to become available...');
  for (let attempt = 1; attempt <= SSH_RETRY_COUNT; attempt++) {
    try {
      await ssh.connectTo(publicIp, input.sshUser);
      callbacks.onStep('SSH connection established');
      break;
    } catch (err) {
      if (attempt === SSH_RETRY_COUNT) {
        throw new Error(
          `Failed to SSH to ${publicIp} after ${SSH_RETRY_COUNT} attempts: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await sleep(SSH_RETRY_DELAY_MS);
    }
  }

  try {
    // 3. Install Tailscale
    callbacks.onStep('Installing Tailscale...');
    const tsInstall = await ssh.exec(installTailscaleScript(input.tailscaleAuthKey));
    if (tsInstall.code !== 0) {
      throw new Error(`Tailscale install failed: ${tsInstall.stderr}`);
    }

    // Get Tailscale IP
    callbacks.onStep('Retrieving Tailscale IP...');
    const tsIpResult = await ssh.exec(getTailscaleIpScript());
    const tailscaleIp = tsIpResult.stdout.trim();
    if (!tailscaleIp) {
      throw new Error('Failed to retrieve Tailscale IP');
    }
    callbacks.onStep(`Tailscale IP: ${tailscaleIp}`);

    // 4. Install OpenClaw
    callbacks.onStep('Installing OpenClaw...');
    const ocInstall = await ssh.exec(installOpenClawScript());
    if (ocInstall.code !== 0) {
      throw new Error(`OpenClaw install failed: ${ocInstall.stderr}`);
    }

    // 5. Push config files
    callbacks.onStep('Pushing config files...');
    const templates = await loadDeployTemplates({
      configPath: input.configPath,
      envPath: input.envPath,
    });
    await ssh.exec('mkdir -p ~/.openclaw');
    await ssh.putContent(
      templates.openclawJson,
      '/home/' + input.sshUser + '/.openclaw/openclaw.json',
    );
    await ssh.putContent(templates.envFile, '/home/' + input.sshUser + '/.openclaw/.env');

    // 6. Set up systemd + start service
    callbacks.onStep('Setting up systemd service...');
    const sysdResult = await ssh.exec(setupSystemdScript(input.sshUser));
    if (sysdResult.code !== 0) {
      throw new Error(`Systemd setup failed: ${sysdResult.stderr}`);
    }

    callbacks.onStep('Starting OpenClaw service...');
    const startResult = await ssh.exec(startServiceScript());
    if (startResult.code !== 0) {
      throw new Error(`Service start failed: ${startResult.stderr}`);
    }

    // 7. Register agent
    callbacks.onStep('Registering agent...');
    const agent = await store.add({
      name: input.name,
      host: input.name,
      tailscaleIp,
      role: input.role,
      user: input.sshUser,
      tags: input.tags,
      awsInstanceId: instanceId,
      awsRegion: ec2.config.region as string,
      capabilities: [],
    });

    // 8. Health check
    callbacks.onStep('Running health check...');
    const status = await getAgentStatus(agent);
    const newStatus = status.reachable ? 'online' : 'unknown';
    await store.update(agent.id, { status: newStatus });

    callbacks.onStep(`Agent ${agent.name} (${agent.id}) deployed — status: ${newStatus}`);
  } finally {
    ssh.disconnect();
  }
}
