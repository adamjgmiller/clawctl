import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getClawctlDir, ensureClawctlDir } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const SECRETS_FILE = 'secrets.json';

interface EncryptedPayload {
  /** hex-encoded ciphertext */
  data: string;
  /** hex-encoded IV */
  iv: string;
  /** hex-encoded auth tag */
  tag: string;
}

interface SecretsFile {
  /** hex-encoded salt for key derivation */
  salt: string;
  /** Encrypted secrets payload */
  payload: EncryptedPayload;
  /** Hash to verify master password without decrypting */
  check: EncryptedPayload;
}

export interface SecretEntry {
  value: string;
  agentId?: string;
}

export type SecretsMap = Record<string, SecretEntry>;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}

function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    data: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf-8');
}

function getSecretsPath(): string {
  return join(getClawctlDir(), SECRETS_FILE);
}

const CHECK_PLAINTEXT = 'clawctl-vault-check';

export class SecretVault {
  private key: Buffer;
  private salt: Buffer;
  private secretsPath: string;

  private constructor(key: Buffer, salt: Buffer, secretsPath: string) {
    this.key = key;
    this.salt = salt;
    this.secretsPath = secretsPath;
  }

  /**
   * Open the vault with a master password. If the vault file doesn't exist,
   * a new one is created. If it does, the password is verified.
   */
  static async open(password: string): Promise<SecretVault> {
    await ensureClawctlDir();
    const secretsPath = getSecretsPath();

    if (existsSync(secretsPath)) {
      const raw = await readFile(secretsPath, 'utf-8');
      const file = JSON.parse(raw) as SecretsFile;
      const salt = Buffer.from(file.salt, 'hex');
      const key = deriveKey(password, salt);

      // Verify password by decrypting the check value
      try {
        const checkValue = decrypt(file.check, key);
        if (checkValue !== CHECK_PLAINTEXT) {
          throw new Error('Invalid master password.');
        }
      } catch {
        throw new Error('Invalid master password.');
      }

      return new SecretVault(key, salt, secretsPath);
    } else {
      // New vault
      const salt = randomBytes(SALT_LENGTH);
      const key = deriveKey(password, salt);
      const vault = new SecretVault(key, salt, secretsPath);

      // Write initial empty vault
      await vault.save({});
      return vault;
    }
  }

  private async load(): Promise<SecretsMap> {
    const raw = await readFile(this.secretsPath, 'utf-8');
    const file = JSON.parse(raw) as SecretsFile;
    const plaintext = decrypt(file.payload, this.key);
    return JSON.parse(plaintext) as SecretsMap;
  }

  private async save(secrets: SecretsMap): Promise<void> {
    const plaintext = JSON.stringify(secrets, null, 2);
    const payload = encrypt(plaintext, this.key);
    const check = encrypt(CHECK_PLAINTEXT, this.key);
    const file: SecretsFile = {
      salt: this.salt.toString('hex'),
      payload,
      check,
    };
    await writeFile(this.secretsPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
  }

  async set(key: string, value: string, agentId?: string): Promise<void> {
    const secrets = await this.load();
    secrets[key] = { value, agentId };
    await this.save(secrets);
  }

  async get(key: string, agentId?: string): Promise<SecretEntry | undefined> {
    const secrets = await this.load();
    const entry = secrets[key];
    if (!entry) return undefined;
    // If agentId filter is specified, only return if it matches
    if (agentId && entry.agentId && entry.agentId !== agentId) return undefined;
    return entry;
  }

  async list(agentId?: string): Promise<Array<{ key: string; agentId?: string }>> {
    const secrets = await this.load();
    return Object.entries(secrets)
      .filter(([, entry]) => !agentId || !entry.agentId || entry.agentId === agentId)
      .map(([key, entry]) => ({ key, agentId: entry.agentId }));
  }

  async delete(key: string): Promise<boolean> {
    const secrets = await this.load();
    if (!(key in secrets)) return false;
    delete secrets[key];
    await this.save(secrets);
    return true;
  }

  /**
   * Get all secrets scoped to a specific agent (or global secrets without an agentId).
   * Returns key=value pairs suitable for writing to a .env file.
   */
  async getAgentEnvEntries(agentId: string): Promise<Record<string, string>> {
    const secrets = await this.load();
    const entries: Record<string, string> = {};
    for (const [key, entry] of Object.entries(secrets)) {
      if (!entry.agentId || entry.agentId === agentId) {
        entries[key] = entry.value;
      }
    }
    return entries;
  }
}
