import { Command } from 'commander';
import chalk from 'chalk';
import {
  CreateAgentInputSchema,
  UpdateAgentInputSchema,
  FreshDeployInputSchema,
  AdoptDeployInputSchema,
} from '../../types/index.js';
import { JsonAgentStore } from '../../registry/index.js';
import type { AgentStore } from '../../registry/index.js';
import {
  getAgentStatus,
  formatStatusTable,
  formatVerboseStatus,
  formatLogOutput,
} from '../../health/index.js';
import { SshClient } from '../../ssh/index.js';
import { loadConfig } from '../../config/index.js';
import { freshDeploy, adoptDeploy } from '../../deploy/index.js';
import { audit } from '../../audit/index.js';
import { bootstrapOrchestrator } from '../../deploy/orchestrator.js';
import { alert } from '../../alerting/index.js';

function createStore(): AgentStore {
  return new JsonAgentStore();
}

function formatZodError(err: unknown): string[] {
  if (err instanceof Error && 'issues' in err) {
    const issues = (err as { issues: Array<{ path: string[]; message: string }> }).issues;
    return issues.map((issue) => `Error: ${issue.path.join('.')}: ${issue.message}`);
  }
  return [`Error: ${err instanceof Error ? err.message : String(err)}`];
}

export function createAgentsCommand(): Command {
  const agents = new Command('agents').description('Manage OpenClaw agents');

  agents
    .command('list')
    .description('List all registered agents')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const store = createStore();
      const list = await store.list();

      if (opts.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }

      if (list.length === 0) {
        console.log('No agents registered. Use "clawctl agents add" to register one.');
        return;
      }

      const header = ['ID', 'NAME', 'HOST', 'ROLE', 'STATUS'];
      const plainRows = list.map((a) => [a.id, a.name, a.host, a.role, a.status]);
      const coloredRows = list.map((a) => {
        const statusColor =
          a.status === 'online'
            ? chalk.green
            : a.status === 'offline'
              ? chalk.red
              : a.status === 'degraded'
                ? chalk.yellow
                : chalk.dim;
        return [a.id, a.name, a.host, a.role, statusColor(a.status)];
      });
      const allPlain = [header, ...plainRows];
      const widths = header.map((_, i) => Math.max(...allPlain.map((r) => r[i].length)));
      const fmtPlain = (row: string[]) => row.map((c, i) => c.padEnd(widths[i])).join('  ');
      const fmtColored = (row: string[], plain: string[]) =>
        row.map((c, i) => c + ' '.repeat(Math.max(0, widths[i] - plain[i].length))).join('  ');
      const sep = widths.map((w) => '-'.repeat(w)).join('  ');
      console.log(
        [fmtPlain(header), sep, ...coloredRows.map((r, i) => fmtColored(r, plainRows[i]))].join(
          '\n',
        ),
      );
    });

  agents
    .command('add')
    .description('Register a new agent')
    .requiredOption('--name <name>', 'Agent name')
    .requiredOption('--host <host>', 'Agent hostname (display)')
    .requiredOption('--tailscale-ip <ip>', 'Tailscale IP address')
    .requiredOption('--role <role>', 'Agent role (orchestrator, worker, monitor, gateway)')
    .option('--user <user>', 'SSH user', 'openclaw')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--ssh-key <path>', 'SSH private key path for this agent')
    .option('--capabilities <caps>', 'Comma-separated capabilities (e.g. research,customer-support,coding)')
    .option('--description <desc>', 'What this agent does')
    .option('--session-key <key>', 'OpenClaw session key for messaging this agent')
    .option('--aws-instance-id <id>', 'AWS EC2 instance ID')
    .option('--aws-region <region>', 'AWS region')
    .action(
      async (opts: {
        name: string;
        host: string;
        tailscaleIp: string;
        role: string;
        user: string;
        tags?: string;
        sshKey?: string;
        awsInstanceId?: string;
        awsRegion?: string;
        capabilities?: string;
        description?: string;
        sessionKey?: string;
      }) => {
        let input;
        try {
          input = CreateAgentInputSchema.parse({
            name: opts.name,
            host: opts.host,
            tailscaleIp: opts.tailscaleIp,
            role: opts.role,
            user: opts.user,
            tags: opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [],
            sshKeyPath: opts.sshKey,
            awsInstanceId: opts.awsInstanceId,
            awsRegion: opts.awsRegion,
            capabilities: opts.capabilities ? opts.capabilities.split(',').map(c => c.trim()) : [],
            description: opts.description,
            sessionKey: opts.sessionKey,
          });
        } catch (err) {
          for (const line of formatZodError(err)) console.error(line);
          process.exitCode = 1;
          return;
        }

        const store = createStore();
        const agent = await store.add(input);
        console.log(`Agent registered: ${agent.name} (${agent.id})`);
        await audit('agent.add', { agentId: agent.id, agentName: agent.name });
      },
    );

  agents
    .command('info')
    .description('Show detailed info about an agent')
    .argument('<id>', 'Agent ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const store = createStore();
      const agent = await store.get(id);
      if (!agent) {
        console.error(`Agent ${id} not found.`);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(agent, null, 2));
        return;
      }

      const labelWidth = 16;
      const fmt = (label: string, value: string) => `${(label + ':').padEnd(labelWidth)} ${value}`;

      const lines = [
        fmt('ID', agent.id),
        fmt('Name', agent.name),
        fmt('Host', agent.host),
        fmt('Tailscale IP', agent.tailscaleIp),
        fmt('User', agent.user),
        fmt('Role', agent.role),
        fmt('Status', agent.status),
        fmt('Tags', agent.tags.length > 0 ? agent.tags.join(', ') : '(none)'),
        fmt('Capabilities', (agent as any).capabilities?.length > 0 ? (agent as any).capabilities.join(', ') : '(none)'),
        fmt('Description', (agent as any).description || '(none)'),
        fmt('Session Key', (agent as any).sessionKey || '(none)'),
      ];

      if (agent.sshKeyPath) lines.push(fmt('SSH Key', agent.sshKeyPath));
      if (agent.awsInstanceId) lines.push(fmt('AWS Instance', agent.awsInstanceId));
      if (agent.awsRegion) lines.push(fmt('AWS Region', agent.awsRegion));

      lines.push(fmt('Created', agent.createdAt));
      lines.push(fmt('Updated', agent.updatedAt));

      console.log(lines.join('\n'));
    });

  agents
    .command('remove')
    .description('Remove an agent by ID')
    .argument('<id>', 'Agent ID')
    .action(async (id: string) => {
      const store = createStore();
      const removed = await store.remove(id);
      if (removed) {
        console.log(`Agent ${id} removed.`);
        await audit('agent.remove', { agentId: id });
      } else {
        console.error(`Agent ${id} not found.`);
        process.exitCode = 1;
      }
    });

  agents
    .command('update')
    .description("Update an agent's fields")
    .argument('<id>', 'Agent ID')
    .option('--name <name>', 'New agent name')
    .option('--host <host>', 'New hostname')
    .option('--tailscale-ip <ip>', 'New Tailscale IP')
    .option('--role <role>', 'New role (orchestrator, worker, monitor, gateway)')
    .option('--user <user>', 'New SSH user')
    .option('--tags <tags>', 'Comma-separated tags (replaces existing)')
    .option('--ssh-key <path>', 'SSH private key path')
    .option('--capabilities <caps>', 'Comma-separated capabilities')
    .option('--description <desc>', 'Agent description')
    .option('--session-key <key>', 'OpenClaw session key')
    .action(
      async (
        id: string,
        opts: {
          name?: string;
          host?: string;
          tailscaleIp?: string;
          role?: string;
          user?: string;
          tags?: string;
          sshKey?: string;
          capabilities?: string;
          description?: string;
          sessionKey?: string;
        },
      ) => {
        const store = createStore();
        const existing = await store.get(id);
        if (!existing) {
          console.error(`Agent ${id} not found.`);
          process.exitCode = 1;
          return;
        }

        const raw: Record<string, unknown> = {};
        if (opts.name !== undefined) raw.name = opts.name;
        if (opts.host !== undefined) raw.host = opts.host;
        if (opts.tailscaleIp !== undefined) raw.tailscaleIp = opts.tailscaleIp;
        if (opts.role !== undefined) raw.role = opts.role;
        if (opts.user !== undefined) raw.user = opts.user;
        if (opts.tags !== undefined) raw.tags = opts.tags.split(',').map((t) => t.trim());
        if (opts.sshKey !== undefined) raw.sshKeyPath = opts.sshKey;
        if (opts.capabilities !== undefined) raw.capabilities = opts.capabilities.split(',').map((c: string) => c.trim());
        if (opts.description !== undefined) raw.description = opts.description;
        if (opts.sessionKey !== undefined) raw.sessionKey = opts.sessionKey;

        if (Object.keys(raw).length === 0) {
          console.error('No fields to update. Pass at least one --flag.');
          process.exitCode = 1;
          return;
        }

        let input;
        try {
          input = UpdateAgentInputSchema.parse(raw);
        } catch (err) {
          for (const line of formatZodError(err)) console.error(line);
          process.exitCode = 1;
          return;
        }

        const updated = await store.update(id, input);
        if (updated) {
          console.log(`Agent ${updated.name} (${updated.id}) updated.`);
          await audit('agent.update', {
            agentId: updated.id,
            agentName: updated.name,
            detail: raw,
          });
        }
      },
    );

  agents
    .command('status')
    .description('Check agent health via SSH')
    .argument('[id]', 'Agent ID (omit for all)')
    .option('--json', 'Output as JSON')
    .option('--ssh-key <path>', 'SSH private key path (overrides agent/config default)')
    .option('--verbose', 'Show detailed openclaw status (version, uptime, model, channels)')
    .action(
      async (
        id: string | undefined,
        opts: { json?: boolean; sshKey?: string; verbose?: boolean },
      ) => {
        const store = createStore();
        let agentsList;

        if (id) {
          const agent = await store.get(id);
          if (!agent) {
            console.error(`Agent ${id} not found.`);
            process.exitCode = 1;
            return;
          }
          agentsList = [agent];
        } else {
          agentsList = await store.list();
          if (agentsList.length === 0) {
            console.log('No agents registered.');
            return;
          }
        }

        // If --ssh-key is passed, override per-agent sshKeyPath for this check
        if (opts.sshKey) {
          agentsList = agentsList.map((a) => ({ ...a, sshKeyPath: opts.sshKey }));
        }

        const results = await Promise.allSettled(agentsList.map((a) => getAgentStatus(a)));
        const statuses = results.map((r, i) =>
          r.status === 'fulfilled'
            ? r.value
            : { agent: agentsList[i], reachable: false as const, error: String(r.reason) },
        );

        // Persist status back to the registry
        for (const s of statuses) {
          let newStatus: 'online' | 'offline' | 'degraded';
          if (!s.reachable) {
            newStatus = 'offline';
          } else if (s.error) {
            newStatus = 'degraded';
          } else {
            newStatus = 'online';
          }
          const prevStatus = s.agent.status;
          await store.update(s.agent.id, { status: newStatus });
          // Alert on status change to offline or degraded
          if (newStatus !== prevStatus) {
            if (newStatus === 'offline') {
              await alert(
                'critical',
                `Agent offline: ${s.agent.name}`,
                `Agent ${s.agent.name} (${s.agent.tailscaleIp}) is unreachable.`,
                s.agent.id,
                s.agent.name,
              );
            } else if (newStatus === 'degraded') {
              await alert(
                'warning',
                `Agent degraded: ${s.agent.name}`,
                `Agent ${s.agent.name} has errors: ${s.error ?? 'unknown'}`,
                s.agent.id,
                s.agent.name,
              );
            } else if (newStatus === 'online' && prevStatus !== 'unknown') {
              await alert(
                'info',
                `Agent recovered: ${s.agent.name}`,
                `Agent ${s.agent.name} is back online.`,
                s.agent.id,
                s.agent.name,
              );
            }
          }
          await audit('agent.status', {
            agentId: s.agent.id,
            agentName: s.agent.name,
            success: s.reachable,
            error: s.error,
          });
        }

        if (opts.json) {
          console.log(JSON.stringify(statuses, null, 2));
        } else if (opts.verbose) {
          for (const s of statuses) {
            console.log(chalk.bold(`--- ${s.agent.name} (${s.agent.role}) ---`));
            console.log(`  Host:         ${s.agent.host}`);
            console.log(`  Tailscale IP: ${s.agent.tailscaleIp}`);
            console.log(`  Reachable:    ${s.reachable ? chalk.green('yes') : chalk.red('no')}`);
            if (s.openclawStatus) {
              for (const line of formatVerboseStatus(s.openclawStatus)) {
                console.log(line);
              }
            } else if (s.raw) {
              console.log(`  Output:       ${s.raw}`);
            } else if (s.error) {
              console.log(`  Error:        ${chalk.red(s.error)}`);
            }
            console.log('');
          }
        } else {
          console.log(formatStatusTable(statuses));
        }
      },
    );

  agents
    .command('logs')
    .description('Tail openclaw gateway logs from an agent')
    .argument('<id>', 'Agent ID')
    .option('--lines <n>', 'Number of lines to show', '50')
    .option('--follow', 'Follow log output (live tail)')
    .action(async (id: string, opts: { lines: string; follow?: boolean }) => {
      const store = createStore();
      const agent = await store.get(id);
      if (!agent) {
        console.error(`Agent ${id} not found.`);
        process.exitCode = 1;
        return;
      }

      const logDir = '/tmp/openclaw';
      const lines = parseInt(opts.lines, 10) || 50;
      const tailFlag = opts.follow ? '-f' : '';
      const cmd = `tail ${tailFlag} -n ${lines} ${logDir}/*.log 2>/dev/null || echo "No log files found in ${logDir}/"`;

      const ssh = new SshClient(agent.sshKeyPath);
      try {
        await ssh.connect(agent);
        if (opts.follow) {
          // For --follow, stream output directly to stdout
          console.log(
            chalk.dim(`Tailing logs on ${agent.name} (${agent.tailscaleIp})... Ctrl+C to stop\n`),
          );
          const result = await ssh.exec(cmd);
          process.stdout.write(formatLogOutput(result.stdout));
          if (result.stderr) process.stderr.write(result.stderr);
        } else {
          const result = await ssh.exec(cmd);
          if (result.stdout) process.stdout.write(formatLogOutput(result.stdout));
          if (result.stderr) process.stderr.write(result.stderr);
          if (result.code !== 0) process.exitCode = 1;
        }
      } catch (err) {
        console.error(
          `Failed to connect to ${agent.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      } finally {
        ssh.disconnect();
      }
    });

  agents
    .command('diagnose')
    .description('Diagnose an agent (systemd, logs, disk, memory)')
    .argument('<id>', 'Agent ID')
    .option('--fix', 'Attempt safe auto-fix actions (restart gateway if stopped)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { fix?: boolean; json?: boolean }) => {
      const store = createStore();
      const agent = await store.get(id);
      if (!agent) {
        console.error(`Agent ${id} not found.`);
        process.exitCode = 1;
        return;
      }

      const ssh = new SshClient(agent.sshKeyPath);
      const checks: Array<{
        name: string;
        cmd: string;
        stdout: string;
        stderr: string;
        code: number | null;
      }> = [];

      const pushCheck = async (name: string, cmd: string) => {
        const res = await ssh.exec(cmd);
        checks.push({ name, cmd, stdout: res.stdout, stderr: res.stderr, code: res.code });
        return res;
      };

      const recommended: string[] = [];
      const fixAttempted: string[] = [];

      try {
        await ssh.connect(agent);

        // Core service checks
        const isActiveRes = await pushCheck(
          'systemd.is-active',
          'systemctl --user is-active openclaw-gateway.service 2>/dev/null || echo unknown',
        );
        const active = (isActiveRes.stdout || '').trim().toLowerCase();

        await pushCheck(
          'systemd.status',
          'systemctl --user status openclaw-gateway.service --no-pager -l 2>&1 | tail -n 120',
        );

        // OpenClaw status (best-effort)
        await pushCheck(
          'openclaw.status',
          'source ~/.nvm/nvm.sh 2>/dev/null; openclaw status --json 2>/dev/null || openclaw status 2>&1 || echo "openclaw not available"',
        );

        // Basic host health
        await pushCheck('host.df', 'df -h / 2>&1');
        await pushCheck(
          'host.free',
          'free -h 2>&1 || vm_stat 2>&1 || echo "free/vm_stat unavailable"',
        );
        await pushCheck('host.uptime', 'uptime 2>&1');

        // Recent gateway logs
        await pushCheck(
          'gateway.logs',
          'tail -n 80 /tmp/openclaw/*.log 2>/dev/null || journalctl --user -u openclaw-gateway.service -n 80 --no-pager 2>/dev/null || echo "No logs found"',
        );

        // Recommendations
        if (active !== 'active') {
          recommended.push(`Gateway service is not active (systemd says: ${active}).`);
          recommended.push('Try: clawctl config push <id> (to re-sync config)');
          recommended.push('Try: clawctl agents logs <id> --lines 200');

          if (opts.fix) {
            const restartRes = await pushCheck(
              'systemd.restart',
              'systemctl --user restart openclaw-gateway.service 2>&1 || echo "restart failed"',
            );
            fixAttempted.push('restart openclaw-gateway.service');
            // re-check
            await pushCheck(
              'systemd.is-active.after',
              'systemctl --user is-active openclaw-gateway.service 2>/dev/null || echo unknown',
            );
            if ((restartRes.code ?? 0) != 0) {
              recommended.push(
                'Restart attempt returned non-zero. Check systemd status output above.',
              );
            }
          } else {
            recommended.push('Re-run with --fix to attempt a restart if appropriate.');
          }
        } else {
          recommended.push(
            'Gateway service appears active. If messages are still failing, inspect recent logs and OpenClaw status output.',
          );
        }
      } catch (err) {
        recommended.push(
          `SSH/diagnose failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      } finally {
        ssh.disconnect();
      }

      const report = {
        agent: {
          id: agent.id,
          name: agent.name,
          host: agent.host,
          tailscaleIp: agent.tailscaleIp,
          user: agent.user,
          role: agent.role,
        },
        checks,
        fixAttempted,
        recommendedActions: recommended,
      };

      await audit('agent.diagnose', {
        agentId: agent.id,
        agentName: agent.name,
        detail: { fix: Boolean(opts.fix), fixAttempted, recommendedCount: recommended.length },
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(chalk.bold(`--- Diagnose: ${agent.name} (${agent.role}) ---`));
      console.log(`Host:         ${agent.host}`);
      console.log(`Tailscale IP: ${agent.tailscaleIp}`);
      console.log(`User:         ${agent.user}`);
      console.log('');

      for (const c of checks) {
        console.log(chalk.dim(`$ ${c.cmd}`));
        if (c.stdout) process.stdout.write(String(c.stdout).trimEnd() + '\n');
        if (c.stderr) process.stderr.write(String(c.stderr).trimEnd() + '\n');
        console.log('');
      }

      if (recommended.length) {
        console.log(chalk.bold('Recommended actions:'));
        for (const a of recommended) console.log(`- ${a}`);
        console.log('');
      }
    });

  agents
    .command('exec')
    .description('Run a command on an agent via SSH (or SSM with --ssm)')
    .argument('<id>', 'Agent ID')
    .argument('<command...>', 'Command to run')
    .option('--ssm', 'Use AWS SSM instead of SSH')
    .option('--ssh-key <path>', 'SSH private key path')
    .action(async (id: string, command: string[], opts: { ssm?: boolean; sshKey?: string }) => {
      const store = createStore();
      const agent = await store.get(id);
      if (!agent) {
        console.error(`Agent ${id} not found.`);
        process.exitCode = 1;
        return;
      }

      const cmd = command.join(' ');

      if (opts.ssm) {
        if (!agent.awsInstanceId) {
          console.error(
            `Agent ${agent.name} has no AWS instance ID. Use --ssm only for EC2 agents.`,
          );
          process.exitCode = 1;
          return;
        }
        const { SsmManager } = await import('../../ssm/index.js');
        const ssm = new SsmManager(agent.awsRegion);
        console.log(chalk.dim(`[SSM] ${agent.name} (${agent.awsInstanceId}): ${cmd}`));
        try {
          const result = await ssm.exec(agent.awsInstanceId, cmd);
          if (result.stdout) process.stdout.write(result.stdout);
          if (result.stderr) process.stderr.write(result.stderr);
          if (result.status !== 'Success') process.exitCode = 1;
        } catch (err) {
          console.error(`SSM error: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
        await audit('agent.exec', {
          agentId: agent.id,
          agentName: agent.name,
          detail: { method: 'ssm', cmd },
        });
      } else {
        const ssh = new SshClient(opts.sshKey ?? agent.sshKeyPath);
        try {
          await ssh.connect(agent);
          const result = await ssh.exec(cmd);
          if (result.stdout) process.stdout.write(result.stdout);
          if (result.stderr) process.stderr.write(result.stderr);
          if (result.code !== 0) process.exitCode = 1;
        } catch (err) {
          console.error(`SSH error: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        } finally {
          ssh.disconnect();
        }
        await audit('agent.exec', {
          agentId: agent.id,
          agentName: agent.name,
          detail: { method: 'ssh', cmd },
        });
      }
    });

  const deploy = new Command('deploy').description('Deploy a new agent');

  deploy
    .command('fresh')
    .description('Provision a new EC2 instance and deploy OpenClaw')
    .requiredOption('--name <name>', 'Agent name')
    .requiredOption('--role <role>', 'Agent role (orchestrator, worker, monitor, gateway)')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--ami <ami>', 'EC2 AMI ID (overrides config)')
    .option('--instance-type <type>', 'EC2 instance type (overrides config)')
    .option('--key-pair <name>', 'EC2 key pair name (overrides config)')
    .option('--security-group <id>', 'EC2 security group ID (overrides config)')
    .option('--subnet-id <id>', 'EC2 subnet ID (overrides config)')
    .option(
      '--tailscale-auth-key <key>',
      'Tailscale auth key (overrides TAILSCALE_AUTH_KEY env var)',
    )
    .option('--ssh-user <user>', 'SSH user for bootstrap', 'ubuntu')
    .option('--ssh-key-path <path>', 'SSH private key path')
    .option('--config <path>', 'Path to openclaw.json (overrides template)')
    .option('--env <path>', 'Path to .env file (overrides template)')
    .action(
      async (opts: {
        name: string;
        role: string;
        tags?: string;
        ami?: string;
        instanceType?: string;
        keyPair?: string;
        securityGroup?: string;
        subnetId?: string;
        tailscaleAuthKey?: string;
        sshUser: string;
        sshKeyPath?: string;
        config?: string;
        env?: string;
      }) => {
        const cfg = await loadConfig();
        const tailscaleAuthKey = opts.tailscaleAuthKey ?? process.env.TAILSCALE_AUTH_KEY;

        if (!tailscaleAuthKey) {
          console.error(
            'Tailscale auth key required: pass --tailscale-auth-key or set TAILSCALE_AUTH_KEY',
          );
          process.exitCode = 1;
          return;
        }

        const ami = opts.ami ?? cfg.ec2Ami;
        if (!ami) {
          console.error('EC2 AMI required: pass --ami or set ec2Ami in config');
          process.exitCode = 1;
          return;
        }

        const keyPair = opts.keyPair ?? cfg.ec2KeyPair;
        if (!keyPair) {
          console.error('EC2 key pair required: pass --key-pair or set ec2KeyPair in config');
          process.exitCode = 1;
          return;
        }

        const securityGroup = opts.securityGroup ?? cfg.ec2SecurityGroup;
        if (!securityGroup) {
          console.error(
            'EC2 security group required: pass --security-group or set ec2SecurityGroup in config',
          );
          process.exitCode = 1;
          return;
        }

        let input;
        try {
          input = FreshDeployInputSchema.parse({
            name: opts.name,
            role: opts.role,
            tags: opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [],
            ami,
            instanceType: opts.instanceType ?? cfg.ec2InstanceType,
            keyPair,
            securityGroup,
            subnetId: opts.subnetId ?? cfg.ec2SubnetId,
            tailscaleAuthKey,
            sshUser: opts.sshUser,
            sshKeyPath: opts.sshKeyPath,
            configPath: opts.config,
            envPath: opts.env,
          });
        } catch (err) {
          for (const line of formatZodError(err)) console.error(line);
          process.exitCode = 1;
          return;
        }

        const store = createStore();
        try {
          await freshDeploy(input, store, {
            onStep: (msg) => console.log(`  → ${msg}`),
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        }
      },
    );

  deploy
    .command('adopt')
    .description('Adopt an existing Tailscale-reachable server into the fleet')
    .requiredOption('--name <name>', 'Agent name')
    .requiredOption('--tailscale-ip <ip>', 'Tailscale IP address')
    .requiredOption('--role <role>', 'Agent role (orchestrator, worker, monitor, gateway)')
    .option('--host <host>', 'Display hostname (defaults to tailscale-ip)')
    .option('--user <user>', 'SSH user', 'openclaw')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--aws-instance-id <id>', 'AWS EC2 instance ID')
    .option('--aws-region <region>', 'AWS region')
    .action(
      async (opts: {
        name: string;
        tailscaleIp: string;
        role: string;
        host?: string;
        user: string;
        tags?: string;
        awsInstanceId?: string;
        awsRegion?: string;
      }) => {
        let input;
        try {
          input = AdoptDeployInputSchema.parse({
            name: opts.name,
            tailscaleIp: opts.tailscaleIp,
            host: opts.host,
            role: opts.role,
            user: opts.user,
            tags: opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [],
            awsInstanceId: opts.awsInstanceId,
            awsRegion: opts.awsRegion,
          });
        } catch (err) {
          for (const line of formatZodError(err)) console.error(line);
          process.exitCode = 1;
          return;
        }

        const store = createStore();
        try {
          await adoptDeploy(input, store, {
            onStep: (msg) => console.log(`  → ${msg}`),
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        }
      },
    );


  deploy
    .command('orchestrator')
    .description('Deploy and bootstrap a new fleet orchestrator')
    .requiredOption('--name <name>', 'Orchestrator agent name')
    .requiredOption('--tailscale-ip <ip>', 'Tailscale IP of target server')
    .requiredOption('--operator-name <name>', 'Human operator name')
    .option('--operator-timezone <tz>', 'Operator timezone', 'America/Los_Angeles')
    .option('--operator-email <email>', 'Operator email for reports')
    .option('--operator-telegram <id>', 'Operator Telegram chat ID')
    .option('--user <user>', 'SSH user', 'openclaw')
    .option('--ssh-key <path>', 'SSH private key path')
    .option('--host <host>', 'Display hostname')
    .option('--model <model>', 'Default model for the orchestrator')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--skip-install', 'Skip OpenClaw installation (already installed)')
    .action(async (opts: {
      name: string;
      tailscaleIp: string;
      operatorName: string;
      operatorTimezone: string;
      operatorEmail?: string;
      operatorTelegram?: string;
      user: string;
      sshKey?: string;
      host?: string;
      model?: string;
      tags?: string;
      skipInstall?: boolean;
    }) => {
      const store = createStore();
      const fleet = await store.list();

      console.log(chalk.bold('Deploying fleet orchestrator: ' + opts.name));
      console.log('');

      const ssh = new SshClient(opts.sshKey);
      try {
        console.log('Connecting to ' + opts.tailscaleIp + '...');
        await ssh.connectTo(opts.tailscaleIp, opts.user);

        if (!opts.skipInstall) {
          console.log('Installing OpenClaw...');
          const install = await ssh.exec('source ~/.nvm/nvm.sh 2>/dev/null; which openclaw >/dev/null 2>&1 && echo "already installed" || (curl -fsSL https://docs.openclaw.ai/install.sh | bash)');
          console.log('  ' + (install.stdout.includes('already installed') ? 'OpenClaw already installed' : 'OpenClaw installed'));
        }

        // Bootstrap orchestrator workspace
        await bootstrapOrchestrator(ssh, {
          operatorName: opts.operatorName,
          operatorTimezone: opts.operatorTimezone,
          operatorEmail: opts.operatorEmail,
          operatorTelegram: opts.operatorTelegram,
          model: opts.model,
        }, fleet, (msg) => console.log('  ' + msg));

        // Register in fleet
        const agent = await store.add({
          name: opts.name,
          host: opts.host ?? opts.tailscaleIp,
          tailscaleIp: opts.tailscaleIp,
          role: 'orchestrator',
          user: opts.user,
          tags: opts.tags ? opts.tags.split(',').map(t => t.trim()) : ['orchestrator'],
          sshKeyPath: opts.sshKey,
          capabilities: [],
        });

        console.log('');
        console.log(chalk.green('Orchestrator deployed and registered: ' + agent.name + ' (' + agent.id + ')'));
        console.log('');
        console.log('Next steps:');
        console.log('  1. Configure openclaw.json on the orchestrator (model, channels, etc.)');
        console.log('  2. Start the gateway: ssh ' + opts.user + '@' + opts.tailscaleIp + ' "openclaw gateway start"');
        console.log('  3. The orchestrator will pick up fleet management on its first heartbeat');

        await audit('agent.deploy.orchestrator' as any, {
          agentId: agent.id,
          agentName: agent.name,
          detail: { fleet: fleet.length, operator: opts.operatorName } as Record<string, unknown>,
        });
      } catch (err) {
        console.error(chalk.red('Deploy failed: ' + (err instanceof Error ? err.message : String(err))));
        process.exitCode = 1;
      } finally {
        ssh.disconnect();
      }
    });

  agents.addCommand(deploy);

  return agents;
}
