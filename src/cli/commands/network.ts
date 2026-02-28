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

  return network;
}
