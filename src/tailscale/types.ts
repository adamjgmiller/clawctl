import { z } from 'zod';

export const TailscaleDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string(),
  addresses: z.array(z.string()),
  tags: z.array(z.string()).default([]),
  os: z.string(),
  clientVersion: z.string(),
  lastSeen: z.string(),
  online: z.boolean().default(false),
  authorized: z.boolean().default(false),
});

export type TailscaleDevice = z.infer<typeof TailscaleDeviceSchema>;

export const TailscaleDeviceListSchema = z.object({
  devices: z.array(TailscaleDeviceSchema),
});

export interface TailscaleConfig {
  apiKey: string;
  tailnet: string;
}
