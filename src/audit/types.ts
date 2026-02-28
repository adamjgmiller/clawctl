import { z } from 'zod';

export const AuditAction = z.enum([
  'agent.add',
  'agent.remove',
  'agent.update',
  'agent.status',
  'agent.deploy.fresh',
  'agent.deploy.adopt',
  'agent.logs',
  'config.push',
  'config.pull',
  'config.diff',
  'secrets.set',
  'secrets.get',
  'secrets.delete',
  'secrets.push',
  'network.tag',
  'agent.diagnose',
  'policy.init',
  'policy.add',
  'policy.remove',
  'policy.check',
  'agent.exec',
  'agent.restart',
  'task.create',
  'task.dispatch',
  'task.complete',
  'task.fail',
]);

export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  action: AuditAction,
  actor: z.string().default('cli'),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  detail: z.record(z.unknown()).optional(),
  success: z.boolean(),
  error: z.string().optional(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = z.object({
  action: AuditAction.optional(),
  agentId: z.string().optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().positive().default(50),
});

export type AuditQuery = z.infer<typeof AuditQuerySchema>;
