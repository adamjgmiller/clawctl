import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ConfigSchema, DEFAULT_CONFIG } from '../types/index.js';
import type { Config } from '../types/index.js';

const CLAWCTL_DIR_NAME = '.clawctl';
const CONFIG_FILE_NAME = 'config.json';

export function getClawctlDir(): string {
  return join(homedir(), CLAWCTL_DIR_NAME);
}

export async function ensureClawctlDir(): Promise<string> {
  const dir = getClawctlDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function loadConfig(): Promise<Config> {
  const dir = await ensureClawctlDir();
  const configPath = join(dir, CONFIG_FILE_NAME);

  try {
    const raw = await readFile(configPath, 'utf-8');
    return ConfigSchema.parse(JSON.parse(raw));
  } catch {
    // Config doesn't exist or is invalid — write defaults and return them
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = await ensureClawctlDir();
  const configPath = join(dir, CONFIG_FILE_NAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
