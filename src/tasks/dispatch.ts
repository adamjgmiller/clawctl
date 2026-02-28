import { SshClient } from '../ssh/index.js';
import type { Agent } from '../types/index.js';
import type { Task } from './types.js';
import { TaskStore } from './store.js';
import { audit } from '../audit/index.js';

/**
 * Dispatch a task to a worker agent via SSH.
 *
 * Writes the task to a pickup file in the agent's workspace
 * (`memory/tasks/<taskId>.md`), which the agent processes on its
 * next heartbeat or when prompted.
 *
 * For real-time dispatch, the orchestrator AGENT (not CLI) uses
 * `sessions_send` to message the worker directly. This SSH path
 * is the CLI fallback that works without an active orchestrator session.
 */
export async function dispatchViaSsh(task: Task, agent: Agent): Promise<void> {
  const store = new TaskStore();
  const ssh = new SshClient();

  try {
    await ssh.connect(agent);

    const taskContent = buildTaskFile(task);

    await ssh.exec('mkdir -p ~/.openclaw/workspace/memory/tasks');
    await ssh.putContent(taskContent, `~/.openclaw/workspace/memory/tasks/${task.id}.md`);

    await store.update(task.id, { status: 'running' });

    await audit('task.dispatch' as any, {
      agentId: agent.id,
      agentName: agent.name,
      detail: { taskId: task.id, title: task.title, method: 'ssh' } as Record<string, unknown>,
    });
  } finally {
    await ssh.disconnect();
  }
}

function buildTaskFile(task: Task): string {
  const lines = [
    `# Task: ${task.title}`,
    '',
    `**ID:** ${task.id}`,
    `**Status:** ${task.status}`,
    `**Requested by:** ${task.requestedBy}`,
    `**Created:** ${task.createdAt}`,
  ];

  if (task.timeoutSeconds) {
    lines.push(`**Timeout:** ${task.timeoutSeconds}s`);
  }
  if (task.requiredCapabilities?.length) {
    lines.push(`**Required capabilities:** ${task.requiredCapabilities.join(', ')}`);
  }

  lines.push('', '## Instructions', '', task.description);

  lines.push(
    '',
    '## How to Respond',
    '',
    'When you complete this task, write your result to:',
    `\`memory/tasks/${task.id}.result.md\``,
    '',
    'If you cannot complete it, write the error to:',
    `\`memory/tasks/${task.id}.error.md\``,
    '',
    'The orchestrator will pick up your response on its next check.',
  );

  return lines.join('\n') + '\n';
}

/**
 * Check if a dispatched task has been completed by polling the worker via SSH.
 */
export async function pollTaskResult(task: Task, agent: Agent): Promise<{
  status: 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}> {
  const ssh = new SshClient();

  try {
    await ssh.connect(agent);

    const resultCheck = await ssh.exec(
      `cat ~/.openclaw/workspace/memory/tasks/${task.id}.result.md 2>/dev/null || echo "__NOT_FOUND__"`,
    );
    if (resultCheck.stdout.trim() !== '__NOT_FOUND__') {
      return { status: 'completed', result: resultCheck.stdout.trim() };
    }

    const errorCheck = await ssh.exec(
      `cat ~/.openclaw/workspace/memory/tasks/${task.id}.error.md 2>/dev/null || echo "__NOT_FOUND__"`,
    );
    if (errorCheck.stdout.trim() !== '__NOT_FOUND__') {
      return { status: 'failed', error: errorCheck.stdout.trim() };
    }

    return { status: 'running' };
  } finally {
    await ssh.disconnect();
  }
}
