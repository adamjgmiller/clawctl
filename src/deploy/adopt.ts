import type { AdoptDeployInput } from '../types/index.js';
import type { AgentStore } from '../registry/index.js';
import { SshClient } from '../ssh/index.js';
import { getAgentStatus } from '../health/index.js';
import type { DeployCallbacks } from './fresh.js';

export async function adoptDeploy(
  input: AdoptDeployInput,
  store: AgentStore,
  callbacks: DeployCallbacks,
): Promise<void> {
  // 1. Verify OpenClaw running via SSH
  callbacks.onStep(`Connecting to ${input.tailscaleIp}...`);
  const ssh = new SshClient();
  const result = await ssh.execOnHost(
    input.tailscaleIp,
    input.user,
    'source ~/.nvm/nvm.sh 2>/dev/null; openclaw status --json',
  );

  if (result.code !== 0) {
    throw new Error(
      `OpenClaw is not running on ${input.tailscaleIp}: ${result.stderr || result.stdout}`,
    );
  }
  callbacks.onStep('OpenClaw verified running');

  // 2. Register agent
  callbacks.onStep('Registering agent...');
  const agent = await store.add({
    name: input.name,
    host: input.host ?? input.tailscaleIp,
    tailscaleIp: input.tailscaleIp,
    role: input.role,
    user: input.user,
    tags: input.tags,
    awsInstanceId: input.awsInstanceId,
    awsRegion: input.awsRegion,
  });

  // 3. Health check
  callbacks.onStep('Running health check...');
  const status = await getAgentStatus(agent);
  const newStatus = status.reachable ? 'online' : 'unknown';
  await store.update(agent.id, { status: newStatus });

  callbacks.onStep(`Agent ${agent.name} (${agent.id}) adopted — status: ${newStatus}`);
}
