import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SSMClient } from '@aws-sdk/client-ssm';
import { EC2Client } from '@aws-sdk/client-ec2';
import { fromIni, fromEnv } from '@aws-sdk/credential-providers';
import { loadConfig } from '../config/index.js';

interface ClientOptions {
  profile?: string;
  region?: string;
}

async function resolveOptions(overrides?: ClientOptions) {
  const config = await loadConfig();
  const region = overrides?.region ?? config.awsRegion ?? process.env.AWS_REGION ?? 'us-east-1';

  // Prefer env vars if set, fall back to INI profile
  const hasEnvCreds = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
  const credentials = hasEnvCreds
    ? fromEnv()
    : fromIni({ profile: overrides?.profile ?? config.awsProfile });

  return { region, credentials };
}

export async function createDynamoDBClient(overrides?: ClientOptions): Promise<DynamoDBClient> {
  return new DynamoDBClient(await resolveOptions(overrides));
}

export async function createSecretsManagerClient(
  overrides?: ClientOptions,
): Promise<SecretsManagerClient> {
  return new SecretsManagerClient(await resolveOptions(overrides));
}

export async function createSSMClient(overrides?: ClientOptions): Promise<SSMClient> {
  return new SSMClient(await resolveOptions(overrides));
}

export async function createEC2Client(overrides?: ClientOptions): Promise<EC2Client> {
  return new EC2Client(await resolveOptions(overrides));
}
