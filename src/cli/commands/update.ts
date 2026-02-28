import { Command } from 'commander';
import chalk from 'chalk';
import { JsonAgentStore } from '../../registry/index.js';
import { SshClient } from '../../ssh/index.js';
import { audit } from '../../audit/index.js';
import { alert } from '../../alerting/index.js';
import { enforcePolicy } from '../../policy/index.js';

interface UpdateResult {
  agentId: string;
  agentName: string;
  success: boolean;
  previousVersion?: string;
  newVersion?: string;
  error?: string;
}

async function getOpenClawVersion(ssh: SshClient): Promise<string> {
  const res = await ssh.exec(
    'source ~/.nvm/nvm.sh 2>/dev/null; openclaw --version 2>/dev/null || echo unknown',
  );
  return (res.stdout || 'unknown').trim();
}

async function updateAgent(
  ssh: SshClient,
  channel: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  // Use pnpm global update (matches OpenClaw install method)
  const cmd = [
    'source ~/.nvm/nvm.sh 2>/dev/null',
    `pnpm add -g openclaw@${channel === 'latest' ? 'latest' : channel} 2>&1`,
  ].join('; ');
  return ssh.exec(cmd);
}

export function createUpdateCommand(): Command {
  const update = new Command('update').description('Rolling update OpenClaw across the fleet');

  update
    .command('fleet')
    .description('Update OpenClaw on all (or filtered) agents with rolling strategy')
    .option('--role <role>', 'Only update agents with this role')
    .option('--tag <tag>', 'Only update agents with this tag')
    .option('--agent <id>', 'Update a single agent by ID')
    .option('--channel <channel>', 'Update channel (latest, beta, or specific version)', 'latest')
    .option('--concurrency <n>', 'Max agents updated at once', '1')
    .option('--pause <seconds>', 'Pause between batches for health check', '10')
    .option('--dry-run', 'Show what would be updated without doing it')
    .option('--no-restart', 'Update package but skip gateway restart')
    .option('--ssh-key <path>', 'SSH private key path')
    .action(
      async (opts: {
        role?: string;
        tag?: string;
        agent?: string;
        channel: string;
        concurrency: string;
        pause: string;
        dryRun?: boolean;
        restart?: boolean;
        sshKey?: string;
      }) => {
        const store = new JsonAgentStore();
        let agents = await store.list();

        // Filter
        if (opts.agent) {
          agents = agents.filter((a) => a.id === opts.agent || a.name === opts.agent);
        }
        if (opts.role) {
          agents = agents.filter((a) => a.role === opts.role);
        }
        if (opts.tag) {
          agents = agents.filter((a) => a.tags.includes(opts.tag!));
        }

        if (agents.length === 0) {
          console.log('No agents match the filter.');
          return;
        }

        const concurrency = parseInt(opts.concurrency, 10) || 1;
        const pauseMs = parseInt(opts.pause, 10) * 1000;

        console.log(
          chalk.bold(
            `Rolling update: ${agents.length} agent(s), channel=${opts.channel}, concurrency=${concurrency}`,
          ),
        );
        if (opts.dryRun) {
          console.log(chalk.yellow('\n[DRY RUN] Would update:'));
          for (const a of agents) console.log(`  - ${a.name} (${a.role}) @ ${a.tailscaleIp}`);
          return;
        }
        console.log('');

        const results: UpdateResult[] = [];

        // Process in batches
        for (let i = 0; i < agents.length; i += concurrency) {
          const batch = agents.slice(i, i + concurrency);

          const batchResults = await Promise.allSettled(
            batch.map(async (agent) => {
              // Policy check
              const policy = await enforcePolicy('agent.update', agent);
              if (!policy.allowed) {
                return {
                  agentId: agent.id,
                  agentName: agent.name,
                  success: false,
                  error: 'Denied by policy',
                } as UpdateResult;
              }

              const ssh = new SshClient(opts.sshKey ?? agent.sshKeyPath);
              try {
                await ssh.connect(agent);
                const prevVersion = await getOpenClawVersion(ssh);
                console.log(`  ${chalk.bold(agent.name)}: ${prevVersion} → updating...`);

                const updateRes = await updateAgent(ssh, opts.channel);
                if (updateRes.code !== 0) {
                  const err =
                    `Update failed (exit ${updateRes.code}): ${updateRes.stderr || updateRes.stdout}`.slice(
                      0,
                      200,
                    );
                  console.log(`  ${chalk.bold(agent.name)}: ${chalk.red('FAILED')} — ${err}`);
                  return {
                    agentId: agent.id,
                    agentName: agent.name,
                    success: false,
                    previousVersion: prevVersion,
                    error: err,
                  } as UpdateResult;
                }

                // Restart gateway if not --no-restart
                if (opts.restart !== false) {
                  console.log(`  ${chalk.bold(agent.name)}: restarting gateway...`);
                  await ssh.exec(
                    'systemctl --user restart openclaw-gateway.service 2>/dev/null || (source ~/.nvm/nvm.sh 2>/dev/null; openclaw gateway restart)',
                  );
                  // Brief pause for gateway to come up
                  await new Promise((r) => setTimeout(r, 3000));
                }

                const newVersion = await getOpenClawVersion(ssh);
                console.log(
                  `  ${chalk.bold(agent.name)}: ${chalk.green('OK')} ${prevVersion} → ${newVersion}`,
                );

                return {
                  agentId: agent.id,
                  agentName: agent.name,
                  success: true,
                  previousVersion: prevVersion,
                  newVersion,
                } as UpdateResult;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`  ${chalk.bold(agent.name)}: ${chalk.red('ERROR')} — ${msg}`);
                return {
                  agentId: agent.id,
                  agentName: agent.name,
                  success: false,
                  error: msg,
                } as UpdateResult;
              } finally {
                ssh.disconnect();
              }
            }),
          );

          for (const r of batchResults) {
            const result =
              r.status === 'fulfilled'
                ? r.value
                : ({
                    agentId: '?',
                    agentName: '?',
                    success: false,
                    error: String(r.reason),
                  } as UpdateResult);
            results.push(result);
            await audit('agent.update', {
              agentId: result.agentId,
              agentName: result.agentName,
              success: result.success,
              error: result.error,
              detail: {
                previousVersion: result.previousVersion,
                newVersion: result.newVersion,
                channel: opts.channel,
              } as Record<string, unknown>,
            });
          }

          // Pause between batches (skip after last batch)
          if (i + concurrency < agents.length && pauseMs > 0) {
            console.log(chalk.dim(`  Pausing ${opts.pause}s before next batch...`));
            await new Promise((r) => setTimeout(r, pauseMs));
          }
        }

        // Summary
        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        console.log('');
        console.log(chalk.bold('Summary:'));
        console.log(
          `  ${chalk.green(`${succeeded} succeeded`)}, ${failed > 0 ? chalk.red(`${failed} failed`) : '0 failed'}`,
        );

        if (failed > 0) {
          await alert(
            'warning',
            'Rolling update had failures',
            `${failed} of ${results.length} agents failed to update to ${opts.channel}.`,
          );
          process.exitCode = 1;
        } else {
          await alert(
            'info',
            'Rolling update complete',
            `${succeeded} agents updated to ${opts.channel}.`,
          );
        }
      },
    );

  update
    .command('check')
    .description('Check current OpenClaw version on all agents')
    .option('--ssh-key <path>', 'SSH private key path')
    .action(async (opts: { sshKey?: string }) => {
      const store = new JsonAgentStore();
      const agents = await store.list();
      if (agents.length === 0) {
        console.log('No agents registered.');
        return;
      }

      console.log(chalk.bold('Agent versions:\n'));
      for (const agent of agents) {
        const ssh = new SshClient(opts.sshKey ?? agent.sshKeyPath);
        try {
          await ssh.connect(agent);
          const version = await getOpenClawVersion(ssh);
          console.log(`  ${agent.name.padEnd(20)} ${version}`);
        } catch {
          console.log(`  ${agent.name.padEnd(20)} ${chalk.red('unreachable')}`);
        } finally {
          ssh.disconnect();
        }
      }
    });

  return update;
}
