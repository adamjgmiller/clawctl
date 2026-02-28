import { Command } from 'commander';
import chalk from 'chalk';
import { PolicyEngine } from '../../policy/index.js';
import type { PolicyRule, PolicyCondition, PolicyEffect } from '../../policy/index.js';
import { JsonAgentStore } from '../../registry/index.js';
import { audit } from '../../audit/index.js';

export function createPolicyCommand(): Command {
  const policy = new Command('policy').description('Manage fleet policy rules');

  policy
    .command('list')
    .description('List all policy rules')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const engine = await PolicyEngine.load();
      const pol = engine.getPolicy();

      if (opts.json) {
        console.log(JSON.stringify(pol, null, 2));
        return;
      }

      console.log(chalk.bold(`Policy (default: ${pol.defaultEffect})`));
      console.log('');

      if (pol.rules.length === 0) {
        console.log('No rules defined. All actions follow the default effect.');
        return;
      }

      for (const rule of pol.rules) {
        const effectColor = rule.effect === 'allow' ? chalk.green : chalk.red;
        const confirm = rule.requireConfirmation ? chalk.yellow(' [confirm required]') : '';
        console.log(
          `  ${chalk.bold(rule.id)}: ${effectColor(rule.effect)}${confirm} on ${chalk.cyan(rule.action)}`,
        );
        if (rule.description) console.log(`    ${chalk.dim(rule.description)}`);
        if (rule.conditions?.length) {
          for (const c of rule.conditions) {
            const val = Array.isArray(c.value) ? c.value.join(', ') : c.value;
            console.log(`    ${chalk.dim('when')} ${c.field} ${c.op} ${val}`);
          }
        }
      }
      console.log('');
    });

  policy
    .command('check')
    .description('Check if an action would be allowed for an agent')
    .argument('<action>', 'Action to check (e.g. config.push, agent.remove, secrets.push)')
    .argument('[agent-id]', 'Agent ID to check against')
    .action(async (action: string, agentId?: string) => {
      const engine = await PolicyEngine.load();
      let agent;
      if (agentId) {
        const store = new JsonAgentStore();
        agent = await store.get(agentId);
        if (!agent) {
          console.error(`Agent ${agentId} not found.`);
          process.exitCode = 1;
          return;
        }
      }

      const decision = engine.evaluate(action, agent);
      const icon = decision.allowed ? chalk.green('✓ ALLOWED') : chalk.red('✗ DENIED');
      const confirm = decision.requireConfirmation ? chalk.yellow(' (confirmation required)') : '';
      console.log(`${icon}${confirm}`);
      console.log(`  Action: ${action}`);
      if (agent) console.log(`  Agent:  ${agent.name} (${agent.role})`);
      console.log(`  Reason: ${decision.reason}`);
      if (decision.matchedRule) {
        console.log(`  Rule:   ${decision.matchedRule.id}`);
      } else {
        console.log(`  Rule:   (default policy)`);
      }
    });

  policy
    .command('init')
    .description('Initialize default policy file at ~/.clawctl/policy.json')
    .action(async () => {
      const engine = await PolicyEngine.load();
      await engine.init();
      await engine.save();
      console.log('Policy file written to ~/.clawctl/policy.json');
      await audit('policy.init', {});
    });

  policy
    .command('add')
    .description('Add a policy rule')
    .requiredOption('--id <id>', 'Rule ID')
    .requiredOption('--action <action>', 'Action pattern (e.g. agent.*, config.push)')
    .requiredOption('--effect <effect>', 'allow or deny')
    .option('--description <desc>', 'Rule description')
    .option('--condition <cond...>', 'Conditions as field:op:value (e.g. role:eq:worker)')
    .option('--require-confirmation', 'Require human confirmation')
    .action(
      async (opts: {
        id: string;
        action: string;
        effect: string;
        description?: string;
        condition?: string[];
        requireConfirmation?: boolean;
      }) => {
        if (opts.effect !== 'allow' && opts.effect !== 'deny') {
          console.error('Effect must be "allow" or "deny".');
          process.exitCode = 1;
          return;
        }

        const conditions: PolicyCondition[] = (opts.condition ?? []).map((c) => {
          const parts = c.split(':');
          if (parts.length < 3) {
            throw new Error(`Invalid condition format: ${c}. Expected field:op:value`);
          }
          const [field, op, ...rest] = parts;
          const value = rest.join(':');
          return {
            field,
            op: op as PolicyCondition['op'],
            value: value.includes(',') ? value.split(',') : value,
          };
        });

        const rule: PolicyRule = {
          id: opts.id,
          description: opts.description,
          action: opts.action,
          effect: opts.effect as PolicyEffect,
          conditions: conditions.length > 0 ? conditions : undefined,
          requireConfirmation: opts.requireConfirmation,
        };

        const engine = await PolicyEngine.load();
        engine.addRule(rule);
        await engine.save();
        console.log(`Rule "${opts.id}" added.`);
        await audit('policy.add', { detail: { ruleId: opts.id, rule } as Record<string, unknown> });
      },
    );

  policy
    .command('remove')
    .description('Remove a policy rule by ID')
    .argument('<id>', 'Rule ID')
    .action(async (id: string) => {
      const engine = await PolicyEngine.load();
      const removed = engine.removeRule(id);
      if (removed) {
        await engine.save();
        console.log(`Rule "${id}" removed.`);
        await audit('policy.remove', { detail: { ruleId: id } });
      } else {
        console.error(`Rule "${id}" not found.`);
        process.exitCode = 1;
      }
    });

  return policy;
}
