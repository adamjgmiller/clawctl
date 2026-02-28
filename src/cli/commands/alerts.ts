import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import type { AlertConfig } from '../../alerting/index.js';
import { loadAlertConfig, alert } from '../../alerting/index.js';

const CONFIG_PATH = join(homedir(), '.clawctl', 'alerts.json');

async function saveConfig(config: AlertConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

export function createAlertsCommand(): Command {
  const alerts = new Command('alerts').description('Configure and test alerting');

  alerts
    .command('status')
    .description('Show current alert configuration')
    .action(async () => {
      const config = await loadAlertConfig();
      console.log(`Alerts: ${config.enabled ? chalk.green('enabled') : chalk.dim('disabled')}`);
      if (config.channels.telegram) {
        console.log(`  Telegram: chat ${config.channels.telegram.chatId}`);
      } else {
        console.log(`  Telegram: ${chalk.dim('not configured')}`);
      }
    });

  alerts
    .command('enable')
    .description('Enable alerting')
    .action(async () => {
      const config = await loadAlertConfig();
      config.enabled = true;
      await saveConfig(config);
      console.log(chalk.green('Alerting enabled.'));
    });

  alerts
    .command('disable')
    .description('Disable alerting')
    .action(async () => {
      const config = await loadAlertConfig();
      config.enabled = false;
      await saveConfig(config);
      console.log(chalk.yellow('Alerting disabled.'));
    });

  alerts
    .command('set-telegram')
    .description('Configure Telegram alerting')
    .requiredOption('--bot-token <token>', 'Telegram bot token')
    .requiredOption('--chat-id <id>', 'Telegram chat ID')
    .action(async (opts: { botToken: string; chatId: string }) => {
      const config = await loadAlertConfig();
      config.channels.telegram = { botToken: opts.botToken, chatId: opts.chatId };
      config.enabled = true;
      await saveConfig(config);
      console.log(chalk.green('Telegram alerting configured and enabled.'));
    });

  alerts
    .command('test')
    .description('Send a test alert')
    .option('--severity <s>', 'info, warning, or critical', 'info')
    .action(async (opts: { severity: string }) => {
      const s = opts.severity as 'info' | 'warning' | 'critical';
      console.log('Sending test alert...');
      await alert(
        s,
        'clawctl Test Alert',
        `This is a test ${s} alert from clawctl. If you see this, alerting is working!`,
      );
      console.log(chalk.green('Done. Check your configured channels.'));
    });

  return alerts;
}
