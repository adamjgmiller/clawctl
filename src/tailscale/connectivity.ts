import chalk from 'chalk';
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
  const plainRows = entries.map((e) => [
    e.device.hostname,
    e.tailscaleIp ?? 'n/a',
    e.device.os,
    e.online ? 'yes' : 'no',
    e.authorized ? 'yes' : 'no',
    formatLastSeen(e.lastSeen),
  ]);
  const coloredRows = entries.map((e) => [
    e.device.hostname,
    e.tailscaleIp ?? 'n/a',
    e.device.os,
    e.online ? chalk.green('yes') : chalk.red('no'),
    e.authorized ? chalk.green('yes') : chalk.yellow('no'),
    formatLastSeen(e.lastSeen),
  ]);

  const allPlain = [header, ...plainRows];
  const widths = header.map((_, i) => Math.max(...allPlain.map((r) => r[i].length)));
  const fmtPlain = (row: string[]) => row.map((c, i) => c.padEnd(widths[i])).join('  ');
  const fmtColored = (row: string[], plain: string[]) =>
    row.map((c, i) => c + ' '.repeat(Math.max(0, widths[i] - plain[i].length))).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  return [fmtPlain(header), sep, ...coloredRows.map((r, i) => fmtColored(r, plainRows[i]))].join('\n');
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
