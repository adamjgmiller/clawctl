import { enforcePolicy } from '../../policy/index.js';
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { SecretVault } from '../../secrets/index.js';
import { JsonAgentStore } from '../../registry/index.js';
import type { AgentStore } from '../../registry/index.js';
import { SshClient } from '../../ssh/index.js';

function createStore(): AgentStore {
  return new JsonAgentStore();
}

const REMOTE_OPENCLAW_DIR = '~/.openclaw';

async function promptPassword(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Session cache for the master password so we only prompt once. */
let cachedPassword: string | undefined;

async function openVault(): Promise<SecretVault> {
  if (!cachedPassword) {
    cachedPassword = await promptPassword('Master password: ');
  }
  try {
    return await SecretVault.open(cachedPassword);
  } catch (err) {
    // Clear cache on bad password
    cachedPassword = undefined;
    throw err;
  }
}

export function createSecretsCommand(): Command {
  const secrets = new Command('secrets').description('Manage encrypted secrets vault');

  secrets
    .command('set')
    .description('Store a secret, optionally scoped to an agent')
    .argument('<key>', 'Secret key')
    .argument('<value>', 'Secret value')
    .option('--agent <id>', 'Scope secret to a specific agent')
    .action(async (key: string, value: string, opts: { agent?: string }) => {
      try {
        const vault = await openVault();
        await vault.set(key, value, opts.agent);
        const scope = opts.agent ? ` (agent: ${opts.agent})` : ' (global)';
        console.log(`Secret ${chalk.bold(key)} stored${scope}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  secrets
    .command('get')
    .description('Retrieve a secret value')
    .argument('<key>', 'Secret key')
    .option('--agent <id>', 'Filter by agent scope')
    .action(async (key: string, opts: { agent?: string }) => {
      try {
        const vault = await openVault();
        const entry = await vault.get(key, opts.agent);
        if (!entry) {
          console.error(`Secret ${key} not found.`);
          process.exitCode = 1;
          return;
        }
        console.log(entry.value);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  secrets
    .command('list')
    .description('List secret keys (not values)')
    .option('--agent <id>', 'Filter by agent scope')
    .action(async (opts: { agent?: string }) => {
      try {
        const vault = await openVault();
        const entries = await vault.list(opts.agent);
        if (entries.length === 0) {
          console.log('No secrets stored.');
          return;
        }

        const header = ['KEY', 'SCOPE'];
        const rows = entries.map((e) => [e.key, e.agentId ?? 'global']);
        const allRows = [header, ...rows];
        const widths = header.map((_, i) => Math.max(...allRows.map((r) => r[i].length)));
        const fmt = (row: string[]) => row.map((c, i) => c.padEnd(widths[i])).join('  ');
        const sep = widths.map((w) => '-'.repeat(w)).join('  ');

        console.log([fmt(header), sep, ...rows.map(fmt)].join('\n'));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  secrets
    .command('delete')
    .description('Delete a secret')
    .argument('<key>', 'Secret key')
    .action(async (key: string) => {
      try {
        const vault = await openVault();
        const removed = await vault.delete(key);
        if (removed) {
          console.log(`Secret ${key} deleted.`);
        } else {
          console.error(`Secret ${key} not found.`);
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  secrets
    .command('push')
    .description("Push scoped secrets to an agent's .env file")
    .argument('<agent-id>', 'Agent ID')
    .option('--merge', 'Merge with existing .env instead of replacing secrets section')
    .action(async (agentId: string, opts: { merge?: boolean }) => {
      const store = createStore();
      const agent = await store.get(agentId);
      if (!agent) {
        console.error(`Agent ${agentId} not found.`);
        process.exitCode = 1;
        return;
      }

      try {
        const vault = await openVault();
        const entries = await vault.getAgentEnvEntries(agentId);
        const keys = Object.keys(entries);

        if (keys.length === 0) {
          console.log(`No secrets to push for agent ${agent.name}.`);
          return;
        }

        // Policy check
        const policyResult = await enforcePolicy('secrets.push', agent);
        if (!policyResult.allowed) {
          process.exitCode = 1;
          return;
        }

        const ssh = new SshClient(agent.sshKeyPath);
        try {
          await ssh.connect(agent);

          let envContent: string;

          if (opts.merge) {
            // Read existing .env and merge
            const existing = await ssh.exec(`cat ${REMOTE_OPENCLAW_DIR}/.env 2>/dev/null`);
            const existingLines = existing.code === 0 ? existing.stdout.split('\n') : [];

            // Parse existing into map, preserving order and comments
            const lines: string[] = [];
            const existingKeys = new Set<string>();

            for (const line of existingLines) {
              const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
              if (match && match[1] in entries) {
                // Replace with vault value
                lines.push(`${match[1]}=${entries[match[1]]}`);
                existingKeys.add(match[1]);
              } else {
                lines.push(line);
              }
            }

            // Append new keys not already in the file
            for (const [key, value] of Object.entries(entries)) {
              if (!existingKeys.has(key)) {
                lines.push(`${key}=${value}`);
              }
            }

            envContent = lines.join('\n');
          } else {
            // Build .env from secrets only
            envContent =
              Object.entries(entries)
                .map(([k, v]) => `${k}=${v}`)
                .join('\n') + '\n';
          }

          await ssh.exec(`mkdir -p ${REMOTE_OPENCLAW_DIR}`);
          await ssh.putContent(envContent, `${REMOTE_OPENCLAW_DIR}/.env`);

          console.log(`Pushed ${keys.length} secret(s) to ${chalk.bold(agent.name)}:`);
          for (const key of keys) {
            console.log(`  ${key}`);
          }

          // Restart gateway
          console.log('Restarting gateway...');
          const restart = await ssh.exec(
            'source ~/.nvm/nvm.sh 2>/dev/null; systemctl --user restart openclaw.service 2>/dev/null || openclaw gateway restart',
          );
          if (restart.code !== 0) {
            console.error(chalk.yellow('Warning: restart returned non-zero exit code'));
          } else {
            console.log(chalk.green('Gateway restarted'));
          }
        } finally {
          ssh.disconnect();
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  return secrets;
}
