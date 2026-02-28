import { Command } from 'commander';
import chalk from 'chalk';
import { JsonAgentStore } from '../../registry/index.js';
import type { AgentStore } from '../../registry/index.js';
import type { Agent } from '../../types/index.js';
import { SshClient } from '../../ssh/index.js';
import { loadDeployTemplates, getTemplatesDir } from '../../deploy/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function createStore(): AgentStore {
  return new JsonAgentStore();
}

const REMOTE_OPENCLAW_DIR = '~/.openclaw';

export function createConfigCommand(): Command {
  const config = new Command('config').description('Manage agent configuration');

  config
    .command('push')
    .description('Push local config files to a remote agent and restart the gateway')
    .argument('<agent-id>', 'Agent ID')
    .option('--config <path>', 'Path to openclaw.json (overrides template)')
    .option('--env <path>', 'Path to .env file (overrides template)')
    .action(async (agentId: string, opts: { config?: string; env?: string }) => {
      const store = createStore();
      const agent = await store.get(agentId);
      if (!agent) {
        console.error(`Agent ${agentId} not found.`);
        process.exitCode = 1;
        return;
      }

      let templates;
      try {
        templates = await loadDeployTemplates({
          configPath: opts.config,
          envPath: opts.env,
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }

      const ssh = new SshClient(agent.sshKeyPath);
      try {
        await ssh.connect(agent);

        console.log(`Pushing config to ${chalk.bold(agent.name)} (${agent.tailscaleIp})...`);

        await ssh.exec(`mkdir -p ${REMOTE_OPENCLAW_DIR}`);
        await ssh.putContent(templates.openclawJson, `${REMOTE_OPENCLAW_DIR}/openclaw.json`);
        console.log('  openclaw.json pushed');

        await ssh.putContent(templates.envFile, `${REMOTE_OPENCLAW_DIR}/.env`);
        console.log('  .env pushed');

        // Restart the gateway
        console.log('  Restarting gateway...');
        const restart = await ssh.exec(
          'source ~/.nvm/nvm.sh 2>/dev/null; systemctl --user restart openclaw.service 2>/dev/null || openclaw gateway restart',
        );
        if (restart.code !== 0) {
          console.error(`  ${chalk.yellow('Warning: restart returned non-zero exit code')}`);
          if (restart.stderr) console.error(`  ${restart.stderr}`);
        } else {
          console.log(`  ${chalk.green('Gateway restarted')}`);
        }
      } catch (err) {
        console.error(
          `Failed to push config to ${agent.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      } finally {
        ssh.disconnect();
      }
    });

  config
    .command('pull')
    .description('Pull running config from a remote agent to local for inspection')
    .argument('<agent-id>', 'Agent ID')
    .option('--output <dir>', 'Output directory (defaults to ~/.clawctl/pulled/<agent-name>)')
    .action(async (agentId: string, opts: { output?: string }) => {
      const store = createStore();
      const agent = await store.get(agentId);
      if (!agent) {
        console.error(`Agent ${agentId} not found.`);
        process.exitCode = 1;
        return;
      }

      const ssh = new SshClient(agent.sshKeyPath);
      try {
        await ssh.connect(agent);

        console.log(`Pulling config from ${chalk.bold(agent.name)} (${agent.tailscaleIp})...`);

        const configResult = await ssh.exec(`cat ${REMOTE_OPENCLAW_DIR}/openclaw.json 2>/dev/null`);
        const envResult = await ssh.exec(`cat ${REMOTE_OPENCLAW_DIR}/.env 2>/dev/null`);

        if (configResult.code !== 0 && envResult.code !== 0) {
          console.error('  No config files found on remote agent.');
          process.exitCode = 1;
          return;
        }

        const outDir = opts.output ?? join(getTemplatesDir(), '..', 'pulled', agent.name);
        await mkdir(outDir, { recursive: true });

        if (configResult.code === 0 && configResult.stdout) {
          const path = join(outDir, 'openclaw.json');
          await writeFile(path, configResult.stdout, 'utf-8');
          console.log(`  openclaw.json -> ${path}`);
        }

        if (envResult.code === 0 && envResult.stdout) {
          const path = join(outDir, '.env');
          await writeFile(path, envResult.stdout, 'utf-8');
          console.log(`  .env -> ${path}`);
        }

        console.log(chalk.green('\nConfig pulled successfully.'));
      } catch (err) {
        console.error(
          `Failed to pull config from ${agent.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      } finally {
        ssh.disconnect();
      }
    });

  config
    .command('diff')
    .description('Compare local template config vs running config on remote agent(s)')
    .argument('[agent-id]', 'Agent ID (omit with --all to check all agents)')
    .option('--all', 'Check all registered agents')
    .option('--config <path>', 'Path to local openclaw.json (overrides template)')
    .option('--env <path>', 'Path to local .env (overrides template)')
    .action(
      async (
        agentId: string | undefined,
        opts: { all?: boolean; config?: string; env?: string },
      ) => {
        if (!agentId && !opts.all) {
          console.error('Provide an agent ID or use --all to check all agents.');
          process.exitCode = 1;
          return;
        }

        const store = createStore();
        let agents: Agent[];

        if (opts.all) {
          agents = await store.list();
          if (agents.length === 0) {
            console.log('No agents registered.');
            return;
          }
        } else {
          const agent = await store.get(agentId!);
          if (!agent) {
            console.error(`Agent ${agentId} not found.`);
            process.exitCode = 1;
            return;
          }
          agents = [agent];
        }

        let templates;
        try {
          templates = await loadDeployTemplates({
            configPath: opts.config,
            envPath: opts.env,
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
          return;
        }

        let hasDrift = false;
        for (const agent of agents) {
          const drifted = await diffAgent(agent, templates.openclawJson, templates.envFile);
          if (drifted) hasDrift = true;
        }

        if (!hasDrift) {
          console.log(chalk.green('No config drift detected.'));
        }
      },
    );

  return config;
}

function unifiedDiff(localContent: string, remoteContent: string, filename: string): string {
  const localLines = localContent.trimEnd().split('\n');
  const remoteLines = remoteContent.trimEnd().split('\n');

  const lines: string[] = [];
  lines.push(chalk.bold(`--- local/${filename}`));
  lines.push(chalk.bold(`+++ remote/${filename}`));

  // Simple line-by-line diff
  const maxLen = Math.max(localLines.length, remoteLines.length);
  let chunkStart = -1;
  let chunkLocal: string[] = [];
  let chunkRemote: string[] = [];

  const flushChunk = () => {
    if (chunkLocal.length === 0 && chunkRemote.length === 0) return;
    lines.push(
      chalk.cyan(
        `@@ -${chunkStart + 1},${chunkLocal.length} +${chunkStart + 1},${chunkRemote.length} @@`,
      ),
    );
    for (const l of chunkLocal) lines.push(chalk.red(`-${l}`));
    for (const l of chunkRemote) lines.push(chalk.green(`+${l}`));
    chunkLocal = [];
    chunkRemote = [];
    chunkStart = -1;
  };

  for (let i = 0; i < maxLen; i++) {
    const localLine = i < localLines.length ? localLines[i] : undefined;
    const remoteLine = i < remoteLines.length ? remoteLines[i] : undefined;

    if (localLine === remoteLine) {
      flushChunk();
      lines.push(` ${localLine}`);
    } else {
      if (chunkStart === -1) chunkStart = i;
      if (localLine !== undefined) chunkLocal.push(localLine);
      if (remoteLine !== undefined) chunkRemote.push(remoteLine);
    }
  }
  flushChunk();

  return lines.join('\n');
}

async function diffAgent(
  agent: Agent,
  localConfig: string,
  localEnv: string,
): Promise<boolean> {
  const ssh = new SshClient(agent.sshKeyPath);
  let hasDrift = false;

  try {
    await ssh.connect(agent);

    const remoteConfig = await ssh.exec(`cat ${REMOTE_OPENCLAW_DIR}/openclaw.json 2>/dev/null`);
    const remoteEnv = await ssh.exec(`cat ${REMOTE_OPENCLAW_DIR}/.env 2>/dev/null`);

    console.log(chalk.bold(`\n--- ${agent.name} (${agent.tailscaleIp}) ---`));

    if (remoteConfig.code === 0 && remoteConfig.stdout) {
      // Normalize JSON for fair comparison
      let normalizedLocal = localConfig;
      let normalizedRemote = remoteConfig.stdout;
      try {
        normalizedLocal = JSON.stringify(JSON.parse(localConfig), null, 2);
        normalizedRemote = JSON.stringify(JSON.parse(remoteConfig.stdout), null, 2);
      } catch {
        // If JSON parse fails, compare raw strings
      }

      if (normalizedLocal.trimEnd() !== normalizedRemote.trimEnd()) {
        hasDrift = true;
        console.log(unifiedDiff(normalizedLocal, normalizedRemote, 'openclaw.json'));
      } else {
        console.log(chalk.green('  openclaw.json: in sync'));
      }
    } else {
      hasDrift = true;
      console.log(chalk.yellow('  openclaw.json: not found on remote'));
    }

    if (remoteEnv.code === 0 && remoteEnv.stdout) {
      if (localEnv.trimEnd() !== remoteEnv.stdout.trimEnd()) {
        hasDrift = true;
        console.log(unifiedDiff(localEnv, remoteEnv.stdout, '.env'));
      } else {
        console.log(chalk.green('  .env: in sync'));
      }
    } else {
      hasDrift = true;
      console.log(chalk.yellow('  .env: not found on remote'));
    }
  } catch (err) {
    console.error(
      `  ${chalk.red('Error')}: ${err instanceof Error ? err.message : String(err)}`,
    );
    hasDrift = true;
  } finally {
    ssh.disconnect();
  }

  return hasDrift;
}
