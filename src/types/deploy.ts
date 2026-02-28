import { z } from 'zod';
import { AgentRole } from './agent.js';

const tailscaleIp = z
  .string()
  .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Must be a valid IPv4 address');

export const FreshDeployInputSchema = z.object({
  name: z.string().min(1),
  role: AgentRole,
  tags: z.array(z.string()).default([]),
  ami: z.string().min(1),
  instanceType: z.string().default('t3.small'),
  keyPair: z.string().min(1),
  securityGroup: z.string().min(1),
  subnetId: z.string().optional(),
  tailscaleAuthKey: z.string().min(1),
  sshUser: z.string().default('ubuntu'),
  sshKeyPath: z.string().optional(),
  configPath: z.string().optional(),
  envPath: z.string().optional(),
});

export type FreshDeployInput = z.infer<typeof FreshDeployInputSchema>;

export const AdoptDeployInputSchema = z.object({
  name: z.string().min(1),
  tailscaleIp,
  host: z.string().optional(),
  role: AgentRole,
  user: z.string().default('openclaw'),
  tags: z.array(z.string()).default([]),
  awsInstanceId: z.string().optional(),
  awsRegion: z.string().optional(),
});

export type AdoptDeployInput = z.infer<typeof AdoptDeployInputSchema>;
