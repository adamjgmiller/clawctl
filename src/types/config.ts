import { z } from 'zod';

export const ConfigSchema = z.object({
  awsProfile: z.string().default('default'),
  awsRegion: z.string().default('us-east-1'),
  sshKeyPath: z.string().default('~/.ssh/id_ed25519'),
  sshUser: z.string().default('openclaw'),
  agentsFilename: z.string().default('agents.json'),
  ec2Ami: z.string().optional(),
  ec2InstanceType: z.string().default('t3.small'),
  ec2KeyPair: z.string().optional(),
  ec2SecurityGroup: z.string().optional(),
  ec2SubnetId: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});
