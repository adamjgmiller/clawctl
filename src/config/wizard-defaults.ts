import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULTS_PATH = join(homedir(), '.clawctl', 'wizard-defaults.json');

export interface WizardDefaults {
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  instanceType?: string;
  keyPair?: string;
  sshKeyPath?: string;
  tailscaleAuthKey?: string;
  tailscaleApiKey?: string;
  operatorName?: string;
  operatorEmail?: string;
  operatorTimezone?: string;
  operatorTelegram?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export async function loadWizardDefaults(): Promise<WizardDefaults> {
  if (!existsSync(DEFAULTS_PATH)) return {};
  try {
    const raw = await readFile(DEFAULTS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveWizardDefaults(updates: Partial<WizardDefaults>): Promise<void> {
  const existing = await loadWizardDefaults();
  const merged = { ...existing, ...updates };
  await mkdir(join(homedir(), '.clawctl'), { recursive: true });
  await writeFile(DEFAULTS_PATH, JSON.stringify(merged, null, 2) + '\n');
}
