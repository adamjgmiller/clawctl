import { z } from 'zod';

export const AgentRole = z.enum(['orchestrator', 'worker', 'monitor', 'gateway']);
export type AgentRole = z.infer<typeof AgentRole>;

export const AgentStatus = z.enum(['online', 'offline', 'degraded', 'unknown', 'provisioning']);
export type AgentStatus = z.infer<typeof AgentStatus>;

const tailscaleIp = z
  .string()
  .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Must be a valid IPv4 address');

export const AgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  host: z.string().min(1),
  tailscaleIp,
  user: z.string().default('openclaw'),
  role: AgentRole,
  status: AgentStatus.default('unknown'),
  tags: z.array(z.string()).default([]),
  awsInstanceId: z.string().optional(),
  awsRegion: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Agent = z.infer<typeof AgentSchema>;

export const CreateAgentInputSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  tailscaleIp,
  user: z.string().default('openclaw'),
  role: AgentRole,
  tags: z.array(z.string()).default([]),
  awsInstanceId: z.string().optional(),
  awsRegion: z.string().optional(),
});

export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

export const UpdateAgentInputSchema = z.object({
  name: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  tailscaleIp: tailscaleIp.optional(),
  user: z.string().optional(),
  role: AgentRole.optional(),
  status: AgentStatus.optional(),
  tags: z.array(z.string()).optional(),
  awsInstanceId: z.string().optional(),
  awsRegion: z.string().optional(),
});

export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;
