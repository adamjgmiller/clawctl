import { TaskStore } from './store.js';
import { audit } from '../audit/index.js';

/**
 * Check all running/assigned tasks for timeouts.
 * Marks overdue tasks as failed.
 * Returns the number of tasks timed out.
 */
export async function enforceTimeouts(): Promise<number> {
  const store = new TaskStore();
  const tasks = await store.list();
  const now = Date.now();
  let count = 0;

  for (const task of tasks) {
    if (task.status !== 'running' && task.status !== 'assigned') continue;
    if (!task.timeoutSeconds) continue;

    const startTime = task.assignedAt ?? task.createdAt;
    const elapsed = (now - new Date(startTime).getTime()) / 1000;

    if (elapsed > task.timeoutSeconds) {
      await store.fail(task.id, `Timed out after ${task.timeoutSeconds}s (elapsed: ${Math.round(elapsed)}s)`);
      await audit('task.fail' as any, {
        agentId: task.assignedTo,
        agentName: task.assignedToName,
        detail: { taskId: task.id, reason: 'timeout', elapsed: Math.round(elapsed) } as Record<string, unknown>,
      });
      count++;
    }
  }

  return count;
}
