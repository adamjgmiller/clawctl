import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PolicyFile, PolicyRule, PolicyCondition, PolicyDecision } from './types.js';
import type { Agent } from '../types/index.js';

const DEFAULT_POLICY_PATH = join(homedir(), '.clawctl', 'policy.json');

const DEFAULT_POLICY: PolicyFile = {
  version: 1,
  defaultEffect: 'allow',
  rules: [
    {
      id: 'deny-remove-orchestrator',
      description: 'Prevent removing orchestrator agents without confirmation',
      action: 'agent.remove',
      effect: 'allow',
      conditions: [{ field: 'role', op: 'eq', value: 'orchestrator' }],
      requireConfirmation: true,
    },
    {
      id: 'deny-secrets-push-unknown',
      description: 'Block pushing secrets to agents with unknown status',
      action: 'secrets.push',
      effect: 'deny',
      conditions: [{ field: 'status', op: 'eq', value: 'unknown' }],
    },
  ],
};

function matchAction(pattern: string, action: string): boolean {
  if (pattern === '*') return true;
  if (pattern === action) return true;
  // Glob: "agent.*" matches "agent.remove", "agent.restart", etc.
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return action.startsWith(prefix + '.');
  }
  return false;
}

function evaluateCondition(cond: PolicyCondition, agent: Agent): boolean {
  const raw = (agent as Record<string, unknown>)[cond.field];
  const fieldVal = Array.isArray(raw) ? raw : [String(raw ?? '')];
  const compareVals = Array.isArray(cond.value) ? cond.value : [cond.value];

  switch (cond.op) {
    case 'eq':
      return fieldVal.length === 1 && fieldVal[0] === compareVals[0];
    case 'neq':
      return fieldVal.length === 1 && fieldVal[0] !== compareVals[0];
    case 'in':
      return fieldVal.length === 1 && compareVals.includes(fieldVal[0]);
    case 'notIn':
      return fieldVal.length === 1 && !compareVals.includes(fieldVal[0]);
    case 'contains':
      // For array fields (like tags): check if any compareVal is in the array
      return compareVals.some((v) => fieldVal.includes(v));
    default:
      return false;
  }
}

function evaluateRule(rule: PolicyRule, action: string, agent?: Agent): boolean {
  if (!matchAction(rule.action, action)) return false;
  if (!rule.conditions || rule.conditions.length === 0) return true;
  if (!agent) return false;
  return rule.conditions.every((cond) => evaluateCondition(cond, agent));
}

export class PolicyEngine {
  private policy: PolicyFile;
  private path: string;

  constructor(policy?: PolicyFile, path?: string) {
    this.policy = policy ?? DEFAULT_POLICY;
    this.path = path ?? DEFAULT_POLICY_PATH;
  }

  static async load(path?: string): Promise<PolicyEngine> {
    const p = path ?? DEFAULT_POLICY_PATH;
    if (!existsSync(p)) {
      return new PolicyEngine(DEFAULT_POLICY, p);
    }
    const raw = await readFile(p, 'utf-8');
    const parsed = JSON.parse(raw) as PolicyFile;
    return new PolicyEngine(parsed, p);
  }

  async save(): Promise<void> {
    await writeFile(this.path, JSON.stringify(this.policy, null, 2) + '\n');
  }

  async init(): Promise<void> {
    if (!existsSync(this.path)) {
      this.policy = DEFAULT_POLICY;
      await this.save();
    }
  }

  evaluate(action: string, agent?: Agent): PolicyDecision {
    for (const rule of this.policy.rules) {
      if (evaluateRule(rule, action, agent)) {
        return {
          allowed: rule.effect === 'allow',
          matchedRule: rule,
          requireConfirmation: rule.requireConfirmation ?? false,
          reason: rule.description ?? `Matched rule: ${rule.id}`,
        };
      }
    }
    // No rule matched — use default
    return {
      allowed: this.policy.defaultEffect === 'allow',
      matchedRule: null,
      requireConfirmation: false,
      reason: `Default policy: ${this.policy.defaultEffect}`,
    };
  }

  getRules(): PolicyRule[] {
    return [...this.policy.rules];
  }

  addRule(rule: PolicyRule): void {
    // Remove existing rule with same ID
    this.policy.rules = this.policy.rules.filter((r) => r.id !== rule.id);
    this.policy.rules.push(rule);
  }

  removeRule(id: string): boolean {
    const before = this.policy.rules.length;
    this.policy.rules = this.policy.rules.filter((r) => r.id !== id);
    return this.policy.rules.length < before;
  }

  getPolicy(): PolicyFile {
    return { ...this.policy };
  }
}
