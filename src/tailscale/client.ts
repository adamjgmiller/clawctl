import { TailscaleDeviceListSchema, TailscaleDeviceSchema } from './types.js';
import type { TailscaleConfig, TailscaleDevice } from './types.js';

const BASE_URL = 'https://api.tailscale.com/api/v2';

export class TailscaleClient {
  private apiKey: string;
  private tailnet: string;

  constructor(config: TailscaleConfig) {
    this.apiKey = config.apiKey;
    this.tailnet = config.tailnet;
  }

  static fromEnv(): TailscaleClient {
    const apiKey = process.env.TAILSCALE_API_KEY;
    if (!apiKey) {
      throw new Error('TAILSCALE_API_KEY environment variable is required');
    }

    const tailnet = process.env.TAILSCALE_TAILNET;
    if (!tailnet) {
      throw new Error('TAILSCALE_TAILNET environment variable is required');
    }

    return new TailscaleClient({ apiKey, tailnet });
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tailscale API ${res.status}: ${body}`);
    }

    return res;
  }

  async listDevices(): Promise<TailscaleDevice[]> {
    const res = await this.request(`/tailnet/${this.tailnet}/devices`);
    const json = await res.json();
    const parsed = TailscaleDeviceListSchema.parse(json);
    return parsed.devices;
  }

  async listDevicesByTag(tag: string): Promise<TailscaleDevice[]> {
    const devices = await this.listDevices();
    const prefixed = tag.startsWith('tag:') ? tag : `tag:${tag}`;
    return devices.filter((d) => d.tags.includes(prefixed));
  }

  async tagDevice(deviceId: string, tags: string[]): Promise<void> {
    const prefixed = tags.map((t) => (t.startsWith('tag:') ? t : `tag:${t}`));
    await this.request(`/device/${deviceId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags: prefixed }),
    });
  }

  async getDevice(deviceId: string): Promise<TailscaleDevice> {
    const res = await this.request(`/device/${deviceId}`);
    const json = await res.json();
    return TailscaleDeviceSchema.parse(json);
  }
}
