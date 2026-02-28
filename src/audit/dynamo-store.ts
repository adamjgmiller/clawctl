import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { AuditEntry, AuditQuery } from './types.js';
import type { AuditStore } from './store.js';

const TABLE_NAME = 'clawctl-audit';
const PK = 'pk';     // partition key: "AUDIT"
const SK = 'sk';     // sort key: "<timestamp>#<id>"

export class DynamoAuditStore implements AuditStore {
  constructor(private client: DynamoDBClient) {}

  async ensureTable(): Promise<void> {
    try {
      await this.client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'ResourceNotFoundException') {
        await this.client.send(
          new CreateTableCommand({
            TableName: TABLE_NAME,
            KeySchema: [
              { AttributeName: PK, KeyType: 'HASH' },
              { AttributeName: SK, KeyType: 'RANGE' },
            ],
            AttributeDefinitions: [
              { AttributeName: PK, AttributeType: 'S' },
              { AttributeName: SK, AttributeType: 'S' },
            ],
            BillingMode: 'PAY_PER_REQUEST',
          }),
        );
      } else {
        throw err;
      }
    }
  }

  async append(entry: AuditEntry): Promise<void> {
    const sk = `${entry.timestamp}#${entry.id}`;
    const item: Record<string, AttributeValue> = {
      [PK]: { S: 'AUDIT' },
      [SK]: { S: sk },
      id: { S: entry.id },
      timestamp: { S: entry.timestamp },
      action: { S: entry.action },
      actor: { S: entry.actor },
      success: { BOOL: entry.success },
    };

    if (entry.agentId) item.agentId = { S: entry.agentId };
    if (entry.agentName) item.agentName = { S: entry.agentName };
    if (entry.error) item.error = { S: entry.error };
    if (entry.detail) item.detail = { S: JSON.stringify(entry.detail) };

    await this.client.send(new PutItemCommand({ TableName: TABLE_NAME, Item: item }));
  }

  async query(query: AuditQuery): Promise<AuditEntry[]> {
    const params: {
      TableName: string;
      KeyConditionExpression: string;
      ExpressionAttributeValues: Record<string, { S: string }>;
      ScanIndexForward: boolean;
      Limit: number;
      FilterExpression?: string;
    } = {
      TableName: TABLE_NAME,
      KeyConditionExpression: `${PK} = :pk`,
      ExpressionAttributeValues: {
        ':pk': { S: 'AUDIT' },
      },
      ScanIndexForward: false, // newest first
      Limit: query.limit,
    };

    if (query.since) {
      params.KeyConditionExpression += ` AND ${SK} >= :since`;
      params.ExpressionAttributeValues[':since'] = { S: query.since };
    }

    const filters: string[] = [];
    if (query.action) {
      filters.push('#act = :action');
      params.ExpressionAttributeValues[':action'] = { S: query.action };
    }
    if (query.agentId) {
      filters.push('agentId = :agentId');
      params.ExpressionAttributeValues[':agentId'] = { S: query.agentId };
    }
    if (filters.length > 0) {
      params.FilterExpression = filters.join(' AND ');
    }

    const result = await this.client.send(
      new QueryCommand({
        ...params,
        ...(query.action ? { ExpressionAttributeNames: { '#act': 'action' } } : {}),
      }),
    );

    return (result.Items ?? []).map((item) => ({
      id: item.id?.S ?? '',
      timestamp: item.timestamp?.S ?? '',
      action: item.action?.S as AuditEntry['action'],
      actor: item.actor?.S ?? 'cli',
      agentId: item.agentId?.S,
      agentName: item.agentName?.S,
      detail: item.detail?.S ? JSON.parse(item.detail.S) : undefined,
      success: item.success?.BOOL ?? true,
      error: item.error?.S,
    }));
  }

  async get(id: string): Promise<AuditEntry | undefined> {
    // Since we don't know the sort key, query with a filter
    const result = await this.client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: `${PK} = :pk`,
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: {
          ':pk': { S: 'AUDIT' },
          ':id': { S: id },
        },
        Limit: 1,
      }),
    );

    const item = result.Items?.[0];
    if (!item) return undefined;

    return {
      id: item.id?.S ?? '',
      timestamp: item.timestamp?.S ?? '',
      action: item.action?.S as AuditEntry['action'],
      actor: item.actor?.S ?? 'cli',
      agentId: item.agentId?.S,
      agentName: item.agentName?.S,
      detail: item.detail?.S ? JSON.parse(item.detail.S) : undefined,
      success: item.success?.BOOL ?? true,
      error: item.error?.S,
    };
  }
}
