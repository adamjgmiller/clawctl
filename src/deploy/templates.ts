import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getClawctlDir } from '../config/index.js';
import {
  DEFAULT_OPENCLAW_JSON,
  DEFAULT_ENV_TEMPLATE,
  DEFAULT_SYSTEMD_UNIT,
} from './default-templates.js';

export interface DeployTemplates {
  openclawJson: string;
  envFile: string;
}

export function getTemplatesDir(): string {
  return join(getClawctlDir(), 'templates');
}

export async function ensureTemplatesDir(): Promise<string> {
  const dir = getTemplatesDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Seed default templates into ~/.clawctl/templates/ if they don't already exist.
 * Returns the list of files that were written.
 */
export async function seedDefaultTemplates(): Promise<string[]> {
  const dir = await ensureTemplatesDir();
  const written: string[] = [];

  const files: Array<[string, string]> = [
    ['openclaw.json', DEFAULT_OPENCLAW_JSON],
    ['.env.template', DEFAULT_ENV_TEMPLATE],
    ['openclaw.service', DEFAULT_SYSTEMD_UNIT],
  ];

  for (const [name, content] of files) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      await writeFile(path, content, 'utf-8');
      written.push(path);
    }
  }

  return written;
}

export async function loadDeployTemplates(overrides?: {
  configPath?: string;
  envPath?: string;
}): Promise<DeployTemplates> {
  const templatesDir = getTemplatesDir();

  const openclawJsonPath = overrides?.configPath ?? join(templatesDir, 'openclaw.json');
  const envFilePath = overrides?.envPath ?? join(templatesDir, '.env');

  let openclawJson: string;
  try {
    openclawJson = await readFile(openclawJsonPath, 'utf-8');
  } catch {
    throw new Error(
      `Config template not found at ${openclawJsonPath}. ` +
        `Create it at ~/.clawctl/templates/openclaw.json or pass --config.`,
    );
  }

  let envFile: string;
  try {
    envFile = await readFile(envFilePath, 'utf-8');
  } catch {
    throw new Error(
      `Env template not found at ${envFilePath}. ` +
        `Create it at ~/.clawctl/templates/.env or pass --env.`,
    );
  }

  return { openclawJson, envFile };
}
