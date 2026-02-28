import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { getClawctlDir } from '../config/index.js';

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
