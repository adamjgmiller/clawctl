import type { TailscaleDevice } from './types.js';

export interface DeviceConnectivity {
  device: TailscaleDevice;
  tailscaleIp: string | undefined;
  online: boolean;
  authorized: boolean;
  lastSeen: string;
}

export function assessConnectivity(device: TailscaleDevice): DeviceConnectivity {
  const tailscaleIp = device.addresses.find(
    (addr) => addr.startsWith('100.') || addr.startsWith('fd7a:'),
  );

  return {
    device,
    tailscaleIp,
    online: device.online,
    authorized: device.authorized,
    lastSeen: device.lastSeen,
  };
}

export function formatDeviceTable(entries: DeviceConnectivity[]): string {
  const header = ['HOSTNAME', 'TAILSCALE IP', 'OS', 'ONLINE', 'AUTHORIZED', 'LAST SEEN'];
  const rows = entries.map((e) => [
    e.device.hostname,
    e.tailscaleIp ?? 'n/a',
    e.device.os,
    e.online ? 'yes' : 'no',
    e.authorized ? 'yes' : 'no',
    formatLastSeen(e.lastSeen),
  ]);

  const allRows = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...allRows.map((r) => r[i].length)));
  const fmt = (row: string[]) => row.map((c, i) => c.padEnd(widths[i])).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  return [fmt(header), sep, ...rows.map(fmt)].join('\n');
}

function formatLastSeen(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;

  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}
