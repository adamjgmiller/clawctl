import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SSMClient } from '@aws-sdk/client-ssm';
import { EC2Client } from '@aws-sdk/client-ec2';
import { fromIni } from '@aws-sdk/credential-providers';
import { loadConfig } from '../config/index.js';

interface ClientOptions {
  profile?: string;
  region?: string;
}

async function resolveOptions(overrides?: ClientOptions) {
  const config = await loadConfig();
  return {
    region: overrides?.region ?? config.awsRegion,
    credentials: fromIni({ profile: overrides?.profile ?? config.awsProfile }),
  };
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
