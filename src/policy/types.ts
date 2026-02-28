/**
 * Policy engine types.
 *
 * A policy file declares rules that gate fleet operations.
 * Each rule matches an action pattern and specifies allow/deny + conditions.
 */

export type PolicyEffect = 'allow' | 'deny';

export interface PolicyCondition {
  /** Agent field to check (e.g. "role", "name", "tags") */
  field: string;
  /** Operator */
  op: 'eq' | 'neq' | 'in' | 'notIn' | 'contains';
  /** Value(s) to compare against */
  value: string | string[];
}

export interface PolicyRule {
  /** Human-readable rule ID */
  id: string;
  /** Description of what this rule does */
  description?: string;
  /** Action pattern to match (glob-style: "agent.*", "config.push", "secrets.push", "*") */
  action: string;
  /** Effect when matched */
  effect: PolicyEffect;
  /** Conditions that must ALL be true for this rule to apply (AND logic) */
  conditions?: PolicyCondition[];
  /** If true, require explicit human confirmation even if allowed */
  requireConfirmation?: boolean;
}

export interface PolicyFile {
  /** Schema version */
  version: 1;
  /** Default effect when no rules match */
  defaultEffect: PolicyEffect;
  /** Ordered list of rules (first match wins) */
  rules: PolicyRule[];
}

export interface PolicyDecision {
  /** Whether the action is allowed */
  allowed: boolean;
  /** The rule that matched, or null if default was used */
  matchedRule: PolicyRule | null;
  /** Whether human confirmation is required */
  requireConfirmation: boolean;
  /** Human-readable reason */
  reason: string;
}
