import { Command } from 'commander';
import chalk from 'chalk';
import { TaskStore, bestRoute } from '../../tasks/index.js';
import { JsonAgentStore } from '../../registry/index.js';
import { audit } from '../../audit/index.js';

function statusColor(s: string): string {
  switch (s) {
    case 'completed': return chalk.green(s);
    case 'failed': return chalk.red(s);
    case 'running': case 'assigned': return chalk.yellow(s);
    case 'cancelled': return chalk.dim(s);
    default: return chalk.cyan(s);
  }
}

export function createTasksCommand(): Command {
  const tasks = new Command('tasks').description('Manage delegated tasks');

  tasks
    .command('create')
    .description('Create a new task and route it to the best agent')
    .requiredOption('--title <title>', 'Task title')
    .requiredOption('--description <desc>', 'Task instructions for the worker')
    .option('--capabilities <caps>', 'Required capabilities (comma-separated)')
    .option('--assign <agent>', 'Force assign to specific agent (name or ID)')
    .option('--timeout <seconds>', 'Timeout in seconds')
    .action(async (opts: {
      title: string;
      description: string;
      capabilities?: string;
      assign?: string;
      timeout?: string;
    }) => {
      const store = new TaskStore();
      const agentStore = new JsonAgentStore();

      const task = await store.create({
        title: opts.title,
        description: opts.description,
        requestedBy: 'cli',
        requiredCapabilities: opts.capabilities?.split(',').map((c) => c.trim()),
        timeoutSeconds: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
      });

      console.log(chalk.bold('Task created: ') + task.id);

      // Route to agent
      const agents = await agentStore.list();
      let assigned = false;

      if (opts.assign) {
        const agent = await agentStore.get(opts.assign);
        if (agent) {
          await store.assign(task.id, agent.id, agent.name, 'manually assigned');
          console.log(`Assigned to: ${chalk.bold(agent.name)} (manual)`);
          assigned = true;
        } else {
          console.log(chalk.yellow(`Agent "${opts.assign}" not found, auto-routing...`));
        }
      }

      if (!assigned) {
        const route = bestRoute(task, agents);
        if (route) {
          await store.assign(task.id, route.agent.id, route.agent.name, route.reason);
          console.log(`Routed to: ${chalk.bold(route.agent.name)} (score: ${route.score})`);
          console.log(chalk.dim(`  Reason: ${route.reason}`));
        } else {
          console.log(chalk.yellow('No suitable agent found. Task is pending.'));
          console.log(chalk.dim('  Tip: add capabilities to agents with --capabilities'));
        }
      }

      await audit('task.create' as any, {
        detail: { taskId: task.id, title: opts.title, assignedTo: task.assignedToName } as Record<string, unknown>,
      });
    });

  tasks
    .command('list')
    .description('List tasks')
    .option('--status <status>', 'Filter by status')
    .option('--agent <agent>', 'Filter by assigned agent')
    .option('--json', 'Output as JSON')
    .action(async (opts: { status?: string; agent?: string; json?: boolean }) => {
      const store = new TaskStore();
      const taskList = await store.list({
        status: opts.status as any,
        assignedTo: opts.agent,
      });

      if (opts.json) {
        console.log(JSON.stringify(taskList, null, 2));
        return;
      }

      if (taskList.length === 0) {
        console.log('No tasks found.');
        return;
      }

      for (const t of taskList) {
        console.log(`${chalk.bold(t.title)} ${statusColor(t.status)}`);
        console.log(chalk.dim(`  ID: ${t.id}`));
        if (t.assignedToName) console.log(`  Agent: ${t.assignedToName}`);
        if (t.routingReason) console.log(chalk.dim(`  Route: ${t.routingReason}`));
        if (t.result) console.log(`  Result: ${t.result.slice(0, 100)}${t.result.length > 100 ? '...' : ''}`);
        if (t.error) console.log(chalk.red(`  Error: ${t.error}`));
        console.log(chalk.dim(`  Created: ${t.createdAt}`));
        console.log('');
      }
    });

  tasks
    .command('info')
    .description('Show task details')
    .argument('<id>', 'Task ID')
    .action(async (id: string) => {
      const store = new TaskStore();
      const task = await store.get(id);
      if (!task) {
        console.error('Task not found.');
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(task, null, 2));
    });

  tasks
    .command('route')
    .description('Show which agent would handle a task (dry run)')
    .requiredOption('--title <title>', 'Task title')
    .option('--capabilities <caps>', 'Required capabilities')
    .option('--description <desc>', 'Task description', '')
    .action(async (opts: { title: string; capabilities?: string; description: string }) => {
      const agentStore = new JsonAgentStore();
      const agents = await agentStore.list();

      const { routeTask } = await import('../../tasks/index.js');
      const fakeTask = {
        id: '', title: opts.title, description: opts.description,
        requestedBy: 'cli', status: 'pending' as const, createdAt: '',
        requiredCapabilities: opts.capabilities?.split(',').map((c) => c.trim()),
      };

      const results = routeTask(fakeTask, agents);
      if (results.length === 0) {
        console.log(chalk.yellow('No agents match. Add capabilities to your agents.'));
        return;
      }

      console.log(chalk.bold('Routing candidates:\n'));
      for (const r of results) {
        console.log(`  ${chalk.bold(r.agent.name)} — score: ${r.score}`);
        console.log(chalk.dim(`    ${r.reason}`));
      }
    });

  tasks
    .command('complete')
    .description('Mark a task as completed with a result')
    .argument('<id>', 'Task ID')
    .requiredOption('--result <result>', 'Task result')
    .action(async (id: string, opts: { result: string }) => {
      const store = new TaskStore();
      const task = await store.complete(id, opts.result);
      if (task) console.log(chalk.green('Task completed.'));
      else { console.error('Task not found.'); process.exitCode = 1; }
    });

  tasks
    .command('fail')
    .description('Mark a task as failed')
    .argument('<id>', 'Task ID')
    .requiredOption('--error <error>', 'Error message')
    .action(async (id: string, opts: { error: string }) => {
      const store = new TaskStore();
      const task = await store.fail(id, opts.error);
      if (task) console.log(chalk.red('Task marked as failed.'));
      else { console.error('Task not found.'); process.exitCode = 1; }
    });

  tasks
    .command('cancel')
    .description('Cancel a pending or assigned task')
    .argument('<id>', 'Task ID')
    .action(async (id: string) => {
      const store = new TaskStore();
      const task = await store.update(id, { status: 'cancelled', completedAt: new Date().toISOString() });
      if (task) console.log(chalk.dim('Task cancelled.'));
      else { console.error('Task not found.'); process.exitCode = 1; }
    });

  return tasks;
}
