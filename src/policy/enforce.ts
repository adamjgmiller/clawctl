import chalk from 'chalk';
import { PolicyEngine } from './engine.js';
import type { Agent } from '../types/index.js';
import { audit } from '../audit/index.js';

/**
 * Check policy for an action. If denied, prints error and returns false.
 * If requireConfirmation, prints warning and returns true (caller decides).
 */
export async function enforcePolicy(
  action: string,
  agent?: Agent,
): Promise<{ allowed: boolean; requireConfirmation: boolean }> {
  const engine = await PolicyEngine.load();
  const decision = engine.evaluate(action, agent);

  if (!decision.allowed) {
    console.error(
      chalk.red(`Policy denied: ${action}`) +
        (agent ? ` on ${agent.name}` : '') +
        ` — ${decision.reason}`,
    );
    if (decision.matchedRule) {
      console.error(chalk.dim(`  Rule: ${decision.matchedRule.id}`));
    }
    await audit('policy.check', {
      agentId: agent?.id,
      agentName: agent?.name,
      detail: { action, allowed: false, rule: decision.matchedRule?.id },
    });
    return { allowed: false, requireConfirmation: false };
  }

  if (decision.requireConfirmation) {
    console.log(
      chalk.yellow(`⚠ Policy requires confirmation for ${action}`) +
        (agent ? ` on ${agent.name}` : '') +
        ` — ${decision.reason}`,
    );
  }

  return { allowed: true, requireConfirmation: decision.requireConfirmation };
}
