import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';

export interface SsmExecResult {
  status: string;
  stdout: string;
  stderr: string;
}

export class SsmManager {
  private client: SSMClient;

  constructor(region?: string) {
    this.client = new SSMClient({ region: region ?? process.env.AWS_REGION ?? 'us-east-1' });
  }

  async exec(instanceId: string, command: string, timeoutSec = 60): Promise<SsmExecResult> {
    const sendRes = await this.client.send(
      new SendCommandCommand({
        InstanceIds: [instanceId],
        DocumentName: 'AWS-RunShellScript',
        Parameters: { commands: [command] },
        TimeoutSeconds: timeoutSec,
      }),
    );

    const commandId = sendRes.Command?.CommandId;
    if (!commandId) throw new Error('SSM SendCommand returned no CommandId');

    // Poll for completion
    const maxWait = timeoutSec * 1000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const inv = await this.client.send(
          new GetCommandInvocationCommand({
            CommandId: commandId,
            InstanceId: instanceId,
          }),
        );
        if (inv.Status === 'InProgress' || inv.Status === 'Pending') continue;
        return {
          status: inv.Status ?? 'Unknown',
          stdout: inv.StandardOutputContent ?? '',
          stderr: inv.StandardErrorContent ?? '',
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'InvocationDoesNotExist') continue;
        throw err;
      }
    }
    throw new Error(`SSM command timed out after ${timeoutSec}s`);
  }
}
