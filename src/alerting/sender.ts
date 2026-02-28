import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Alert, AlertConfig } from './types.js';

const CONFIG_PATH = join(homedir(), '.clawctl', 'alerts.json');

const DEFAULT_CONFIG: AlertConfig = {
  enabled: false,
  channels: {},
};

export async function loadAlertConfig(): Promise<AlertConfig> {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as AlertConfig;
}

function severityEmoji(s: string): string {
  switch (s) {
    case 'critical':
      return '🔴';
    case 'warning':
      return '🟡';
    default:
      return 'ℹ️';
  }
}

async function sendTelegram(
  alert: Alert,
  config: { botToken: string; chatId: string },
): Promise<void> {
  const text = [
    `${severityEmoji(alert.severity)} *${escapeMarkdown(alert.title)}*`,
    '',
    escapeMarkdown(alert.message),
    alert.agentName ? `Agent: ${escapeMarkdown(alert.agentName)}` : '',
    `_${escapeMarkdown(alert.timestamp)}_`,
  ]
    .filter(Boolean)
    .join('\n');

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: 'MarkdownV2',
    }),
  });
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export async function sendAlert(alert: Alert): Promise<void> {
  const config = await loadAlertConfig();
  if (!config.enabled) return;

  if (config.channels.telegram) {
    try {
      await sendTelegram(alert, config.channels.telegram);
    } catch (err) {
      console.error(
        `Failed to send Telegram alert: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export async function alert(
  severity: Alert['severity'],
  title: string,
  message: string,
  agentId?: string,
  agentName?: string,
): Promise<void> {
  await sendAlert({
    severity,
    title,
    message,
    agentId,
    agentName,
    timestamp: new Date().toISOString(),
  });
}
