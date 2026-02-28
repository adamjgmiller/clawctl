import { Command } from 'commander';
import chalk from 'chalk';
import { JsonAgentStore } from '../../registry/index.js';
import type { AgentStore } from '../../registry/index.js';
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

  return config;
}
