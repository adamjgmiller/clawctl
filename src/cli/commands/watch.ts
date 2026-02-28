import { Command } from 'commander';
import chalk from 'chalk';
import { JsonAgentStore } from '../../registry/index.js';
import { getAgentStatus, formatStatusTable } from '../../health/index.js';
import { alert } from '../../alerting/index.js';
import { audit } from '../../audit/index.js';

export function createWatchCommand(): Command {
  const watch = new Command('watch')
    .description('Continuously monitor fleet health and alert on changes')
    .option('--interval <seconds>', 'Poll interval in seconds', '60')
    .option('--ssh-key <path>', 'SSH private key path')
    .action(async (opts: { interval: string; sshKey?: string }) => {
      const intervalMs = parseInt(opts.interval, 10) * 1000;
      const store = new JsonAgentStore();

      console.log(chalk.bold('🔍 clawctl watch'));
      console.log(chalk.dim(`Polling every ${opts.interval}s. Ctrl+C to stop.\n`));

      const poll = async () => {
        let agentsList = await store.list();
        if (agentsList.length === 0) {
          console.log(chalk.dim('[watch] No agents registered.'));
          return;
        }
        if (opts.sshKey) {
          agentsList = agentsList.map((a) => ({ ...a, sshKeyPath: opts.sshKey }));
        }

        const results = await Promise.allSettled(agentsList.map((a) => getAgentStatus(a)));
        const statuses = results.map((r, i) =>
          r.status === 'fulfilled'
            ? r.value
            : { agent: agentsList[i], reachable: false as const, error: String(r.reason) },
        );

        for (const s of statuses) {
          const newStatus = !s.reachable ? 'offline' : s.error ? 'degraded' : 'online';
          const prevStatus = s.agent.status;
          await store.update(s.agent.id, { status: newStatus });
          if (newStatus !== prevStatus && prevStatus !== 'unknown') {
            const ts = new Date().toLocaleTimeString();
            if (newStatus === 'offline') {
              console.log(`${ts} ${chalk.red('OFFLINE')} ${s.agent.name}`);
              await alert('critical', `Agent offline: ${s.agent.name}`, `${s.agent.name} (${s.agent.tailscaleIp}) is unreachable.`, s.agent.id, s.agent.name);
            } else if (newStatus === 'degraded') {
              console.log(`${ts} ${chalk.yellow('DEGRADED')} ${s.agent.name}: ${s.error}`);
              await alert('warning', `Agent degraded: ${s.agent.name}`, `${s.error ?? 'unknown error'}`, s.agent.id, s.agent.name);
            } else if (newStatus === 'online') {
              console.log(`${ts} ${chalk.green('RECOVERED')} ${s.agent.name}`);
              await alert('info', `Agent recovered: ${s.agent.name}`, `${s.agent.name} is back online.`, s.agent.id, s.agent.name);
            }
          }
          await audit('agent.status', { agentId: s.agent.id, agentName: s.agent.name, success: s.reachable });
        }

        process.stdout.write('\x1b[2K\r');
        const ts = new Date().toLocaleTimeString();
        console.log(chalk.dim(`[${ts}] Fleet status:`));
        console.log(formatStatusTable(statuses));
        console.log('');
      };

      await poll();
      setInterval(poll, intervalMs);
    });

  return watch;
}
