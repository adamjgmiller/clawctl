import { Command } from 'commander';
import { TailscaleClient, assessConnectivity, formatDeviceTable } from '../../tailscale/index.js';

export function createNetworkCommand(): Command {
  const network = new Command('network').description('Tailscale network operations');

  network
    .command('status')
    .description('List all tag:clawctl devices and their connectivity')
    .option('--json', 'Output as JSON')
    .option('--tag <tag>', 'Filter by tag', 'clawctl')
    .action(async (opts: { json?: boolean; tag: string }) => {
      let client: TailscaleClient;
      try {
        client = TailscaleClient.fromEnv();
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }

      const devices = await client.listDevicesByTag(opts.tag);

      if (devices.length === 0) {
        console.log(`No devices found with tag:${opts.tag}.`);
        return;
      }

      const entries = devices.map(assessConnectivity);

      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        console.log(formatDeviceTable(entries));
      }
    });

  network
    .command('list')
    .description('List ALL devices on the tailnet')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      let client: TailscaleClient;
      try {
        client = TailscaleClient.fromEnv();
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }

      const devices = await client.listDevices();

      if (devices.length === 0) {
        console.log('No devices found on the tailnet.');
        return;
      }

      const entries = devices.map(assessConnectivity);

      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        console.log(formatDeviceTable(entries));
      }
    });

  network
    .command('tag')
    .description('Add a tag to a Tailscale device')
    .argument('<device-id>', 'Tailscale device ID')
    .argument('<tag>', 'Tag to add (e.g. "clawctl")')
    .action(async (deviceId: string, tag: string) => {
      let client: TailscaleClient;
      try {
        client = TailscaleClient.fromEnv();
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }

      // Get current device to preserve existing tags
      const device = await client.getDevice(deviceId);
      const prefixedTag = tag.startsWith('tag:') ? tag : `tag:${tag}`;

      if (device.tags.includes(prefixedTag)) {
        console.log(`Device ${deviceId} already has ${prefixedTag}.`);
        return;
      }

      const newTags = [...device.tags, prefixedTag];
      await client.tagDevice(deviceId, newTags);
      console.log(`Tagged device ${deviceId} with ${prefixedTag}.`);
    });

  return network;
}
