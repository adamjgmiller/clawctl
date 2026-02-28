import {
  RunInstancesCommand,
  DescribeInstancesCommand,
  waitUntilInstanceRunning,
  type EC2Client,
  type _InstanceType,
} from '@aws-sdk/client-ec2';

export interface Ec2ProvisionInput {
  ami: string;
  instanceType: string;
  keyPair: string;
  securityGroup: string;
  subnetId?: string;
  name: string;
}

export interface Ec2ProvisionResult {
  instanceId: string;
  publicIp: string;
}

export async function provisionEc2Instance(
  client: EC2Client,
  input: Ec2ProvisionInput,
): Promise<Ec2ProvisionResult> {
  const runResult = await client.send(
    new RunInstancesCommand({
      ImageId: input.ami,
      InstanceType: input.instanceType as _InstanceType,
      KeyName: input.keyPair,
      SecurityGroupIds: [input.securityGroup],
      SubnetId: input.subnetId,
      MinCount: 1,
      MaxCount: 1,
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [
            { Key: 'Name', Value: input.name },
            { Key: 'ManagedBy', Value: 'clawctl' },
          ],
        },
      ],
    }),
  );

  const instanceId = runResult.Instances?.[0]?.InstanceId;
  if (!instanceId) {
    throw new Error('EC2 RunInstances did not return an instance ID');
  }

  await waitUntilInstanceRunning({ client, maxWaitTime: 300 }, { InstanceIds: [instanceId] });

  const describeResult = await client.send(
    new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
  );

  const publicIp = describeResult.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;
  if (!publicIp) {
    throw new Error(`EC2 instance ${instanceId} has no public IP address`);
  }

  return { instanceId, publicIp };
}
