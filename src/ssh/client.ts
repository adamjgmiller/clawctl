import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeSSH } from 'node-ssh';
import type { Agent } from '../types/index.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export class SshClient {
  private ssh: NodeSSH;
  private keyPath: string;

  constructor(keyPath?: string) {
    this.ssh = new NodeSSH();
    this.keyPath = keyPath ?? join(homedir(), '.ssh', 'id_ed25519');
  }

  async connectTo(host: string, username: string): Promise<void> {
    await this.ssh.connect({
      host,
      username,
      privateKeyPath: this.keyPath,
    });
  }

  async connect(agent: Agent): Promise<void> {
    if (agent.sshKeyPath) {
      this.keyPath = agent.sshKeyPath;
    }
    await this.connectTo(agent.tailscaleIp, agent.user);
  }

  async exec(command: string): Promise<ExecResult> {
    const result = await this.ssh.execCommand(command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    };
  }

  disconnect(): void {
    this.ssh.dispose();
  }

  async execOnAgent(agent: Agent, command: string): Promise<ExecResult> {
    try {
      await this.connect(agent);
      return await this.exec(command);
    } finally {
      this.disconnect();
    }
  }

  async execOnHost(host: string, username: string, command: string): Promise<ExecResult> {
    try {
      await this.connectTo(host, username);
      return await this.exec(command);
    } finally {
      this.disconnect();
    }
  }

  async putContent(content: string, remotePath: string): Promise<void> {
    const sftp = await this.ssh.requestSFTP();
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(remotePath, content, (err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
