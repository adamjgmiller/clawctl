import { Command } from 'commander';
import { startDashboard } from '../../dashboard/server.js';

export function createDashboardCommand(): Command {
  const dashboard = new Command('dashboard').description('Start the fleet web dashboard');

  dashboard
    .command('start')
    .description('Start the dashboard API server')
    .option('--port <port>', 'Port to listen on', '3100')
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      await startDashboard(port);
    });

  return dashboard;
}
