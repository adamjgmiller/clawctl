import type { Agent } from '../types/index.js';
import type { Task } from './types.js';

export interface RouteResult {
  agent: Agent;
  reason: string;
  score: number;
}

/**
 * Score agents by how well their capabilities match the task requirements.
 * Returns sorted list (best match first).
 */
export function routeTask(task: Task, agents: Agent[]): RouteResult[] {
  const required = task.requiredCapabilities ?? [];
  const candidates = agents
    .filter((a) => a.status !== 'offline' && a.role !== 'orchestrator')
    .map((agent) => {
      let score = 0;
      const reasons: string[] = [];
      const caps = (agent as any).capabilities ?? [];

      // Exact capability matches
      for (const req of required) {
        if (caps.includes(req)) {
          score += 10;
          reasons.push(`has capability: ${req}`);
        }
      }

      // Fuzzy: check if task title/description mentions agent capabilities
      const taskText = (task.title + ' ' + task.description).toLowerCase();
      for (const cap of caps) {
        if (taskText.includes(cap.toLowerCase())) {
          score += 5;
          reasons.push(`task mentions: ${cap}`);
        }
      }

      // Bonus for agents with descriptions that match
      const desc = ((agent as any).description ?? '').toLowerCase();
      for (const word of taskText.split(/\s+/).filter((w: string) => w.length > 4)) {
        if (desc.includes(word)) {
          score += 1;
        }
      }

      // Bonus for online agents
      if (agent.status === 'online') {
        score += 3;
        reasons.push('agent is online');
      }

      // Bonus for agents with session keys (can be messaged directly)
      if ((agent as any).sessionKey) {
        score += 2;
        reasons.push('has session key (direct messaging)');
      }

      const reason = reasons.length > 0 ? reasons.join(', ') : 'no specific match';
      return { agent, reason, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates;
}

/**
 * Pick the best agent for a task, or return null if no good match.
 */
export function bestRoute(task: Task, agents: Agent[]): RouteResult | null {
  const candidates = routeTask(task, agents);
  return candidates.length > 0 ? candidates[0] : null;
}
