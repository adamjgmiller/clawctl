import {
  RunInstancesCommand,
  DescribeInstancesCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeVpcsCommand,
  waitUntilInstanceRunning,
  type EC2Client,
  type _InstanceType,
} from '@aws-sdk/client-ec2';

export interface Ec2ProvisionInput {
  ami: string;
  instanceType: string;
  keyPair: string;
  securityGroup?: string;
  subnetId?: string;
  name: string;
  userData?: string;
}

export interface Ec2ProvisionResult {
  instanceId: string;
  publicIp: string;
  securityGroupId?: string;
}

/**
 * Create a security group for clawctl agents.
 * Allows SSH inbound (port 22) and all outbound (default).
 */
export async function ensureSecurityGroup(
  client: EC2Client,
  name: string = 'clawctl-agents',
): Promise<string> {
  // Get default VPC
  const vpcs = await client.send(new DescribeVpcsCommand({ Filters: [{ Name: 'is-default', Values: ['true'] }] }));
  const vpcId = vpcs.Vpcs?.[0]?.VpcId;
  if (!vpcId) throw new Error('No default VPC found. Specify a security group manually.');

  try {
    const result = await client.send(new CreateSecurityGroupCommand({
      GroupName: name,
      Description: 'clawctl managed agents — SSH inbound, all outbound',
      VpcId: vpcId,
      TagSpecifications: [{
        ResourceType: 'security-group',
        Tags: [
          { Key: 'ManagedBy', Value: 'clawctl' },
          { Key: 'Project', Value: 'clawctl' },
        ],
      }],
    }));

    const groupId = result.GroupId!;

    // Allow SSH from anywhere (needed for initial setup; Tailscale takes over after)
    await client.send(new AuthorizeSecurityGroupIngressCommand({
      GroupId: groupId,
      IpPermissions: [{
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH for initial clawctl setup' }],
      }],
    }));

    return groupId;
  } catch (err: any) {
    // If group already exists, find and return it
    if (err.Code === 'InvalidGroup.Duplicate') {
      const { DescribeSecurityGroupsCommand } = await import('@aws-sdk/client-ec2');
      const existing = await client.send(new DescribeSecurityGroupsCommand({
        Filters: [{ Name: 'group-name', Values: [name] }],
      }));
      const id = existing.SecurityGroups?.[0]?.GroupId;
      if (id) return id;
    }
    throw err;
  }
}

export async function provisionEc2Instance(
  client: EC2Client,
  input: Ec2ProvisionInput,
): Promise<Ec2ProvisionResult> {
  // Auto-create security group if none provided
  let sgId = input.securityGroup;
  if (!sgId) {
    sgId = await ensureSecurityGroup(client);
  }

  const params: any = {
    ImageId: input.ami,
    InstanceType: input.instanceType as _InstanceType,
    KeyName: input.keyPair,
    SecurityGroupIds: [sgId],
    MinCount: 1,
    MaxCount: 1,
    TagSpecifications: [
      {
        ResourceType: 'instance',
        Tags: [
          { Key: 'Name', Value: input.name },
          { Key: 'ManagedBy', Value: 'clawctl' },
          { Key: 'Project', Value: 'clawctl' },
        ],
      },
    ],
  };

  if (input.subnetId) params.SubnetId = input.subnetId;
  if (input.userData) params.UserData = Buffer.from(input.userData).toString('base64');

  const runResult = await client.send(new RunInstancesCommand(params));

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

  return { instanceId, publicIp, securityGroupId: sgId };
}
