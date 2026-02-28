import { Command } from 'commander';
import {
  CreateAgentInputSchema,
  UpdateAgentInputSchema,
  FreshDeployInputSchema,
  AdoptDeployInputSchema,
} from '../../types/index.js';
import { JsonAgentStore } from '../../registry/index.js';
import type { AgentStore } from '../../registry/index.js';
import { getAgentStatus, formatStatusTable } from '../../health/index.js';
import { loadConfig } from '../../config/index.js';
import { freshDeploy, adoptDeploy } from '../../deploy/index.js';

function createStore(): AgentStore {
  return new JsonAgentStore();
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
      const rows = list.map((a) => [a.id, a.name, a.host, a.role, a.status]);
      const allRows = [header, ...rows];
      const widths = header.map((_, i) => Math.max(...allRows.map((r) => r[i].length)));
      const fmt = (row: string[]) => row.map((c, i) => c.padEnd(widths[i])).join('  ');
      const sep = widths.map((w) => '-'.repeat(w)).join('  ');
      console.log([fmt(header), sep, ...rows.map(fmt)].join('\n'));
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
        awsInstanceId?: string;
        awsRegion?: string;
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
            awsInstanceId: opts.awsInstanceId,
            awsRegion: opts.awsRegion,
          });
        } catch (err) {
          if (err instanceof Error && 'issues' in err) {
            const issues = (err as any).issues as Array<{ path: string[]; message: string }>;
            for (const issue of issues) {
              console.error(`Error: ${issue.path.join('.')}: ${issue.message}`);
            }
          } else {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          }
          process.exitCode = 1;
          return;
        }

        const store = createStore();
        const agent = await store.add(input);
        console.log(`Agent registered: ${agent.name} (${agent.id})`);
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
      const fmt = (label: string, value: string) =>
        `${(label + ':').padEnd(labelWidth)} ${value}`;

      const lines = [
        fmt('ID', agent.id),
        fmt('Name', agent.name),
        fmt('Host', agent.host),
        fmt('Tailscale IP', agent.tailscaleIp),
        fmt('User', agent.user),
        fmt('Role', agent.role),
        fmt('Status', agent.status),
        fmt('Tags', agent.tags.length > 0 ? agent.tags.join(', ') : '(none)'),
      ];

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
      } else {
        console.error(`Agent ${id} not found.`);
        process.exitCode = 1;
      }
    });

  agents
    .command('update')
    .description('Update an agent\'s fields')
    .argument('<id>', 'Agent ID')
    .option('--name <name>', 'New agent name')
    .option('--host <host>', 'New hostname')
    .option('--tailscale-ip <ip>', 'New Tailscale IP')
    .option('--role <role>', 'New role (orchestrator, worker, monitor, gateway)')
    .option('--user <user>', 'New SSH user')
    .option('--tags <tags>', 'Comma-separated tags (replaces existing)')
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

        if (Object.keys(raw).length === 0) {
          console.error('No fields to update. Pass at least one --flag.');
          process.exitCode = 1;
          return;
        }

        let input;
        try {
          input = UpdateAgentInputSchema.parse(raw);
        } catch (err) {
          if (err instanceof Error && 'issues' in err) {
            const issues = (err as any).issues as Array<{ path: string[]; message: string }>;
            for (const issue of issues) {
              console.error(`Error: ${issue.path.join('.')}: ${issue.message}`);
            }
          } else {
            console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          }
          process.exitCode = 1;
          return;
        }

        const updated = await store.update(id, input);
        if (updated) {
          console.log(`Agent ${updated.name} (${updated.id}) updated.`);
        }
      },
    );

  agents
    .command('status')
    .description('Check agent health via SSH')
    .argument('[id]', 'Agent ID (omit for all)')
    .option('--json', 'Output as JSON')
    .action(async (id: string | undefined, opts: { json?: boolean }) => {
      const store = createStore();
      let agents;

      if (id) {
        const agent = await store.get(id);
        if (!agent) {
          console.error(`Agent ${id} not found.`);
          process.exitCode = 1;
          return;
        }
        agents = [agent];
      } else {
        agents = await store.list();
        if (agents.length === 0) {
          console.log('No agents registered.');
          return;
        }
      }

      const results = await Promise.allSettled(agents.map((a) => getAgentStatus(a)));
      const statuses = results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { agent: agents[i], reachable: false as const, error: String(r.reason) },
      );

      if (opts.json) {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        console.log(formatStatusTable(statuses));
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
        const tailscaleAuthKey =
          opts.tailscaleAuthKey ?? process.env.TAILSCALE_AUTH_KEY;

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

        const input = FreshDeployInputSchema.parse({
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

        const store = createStore();
        await freshDeploy(input, store, {
          onStep: (msg) => console.log(`  → ${msg}`),
        });
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
        const input = AdoptDeployInputSchema.parse({
          name: opts.name,
          tailscaleIp: opts.tailscaleIp,
          host: opts.host,
          role: opts.role,
          user: opts.user,
          tags: opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [],
          awsInstanceId: opts.awsInstanceId,
          awsRegion: opts.awsRegion,
        });

        const store = createStore();
        await adoptDeploy(input, store, {
          onStep: (msg) => console.log(`  → ${msg}`),
        });
      },
    );

  agents.addCommand(deploy);

  return agents;
}
