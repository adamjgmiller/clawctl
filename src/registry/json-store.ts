import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentSchema } from '../types/index.js';
import type { Agent, CreateAgentInput, UpdateAgentInput } from '../types/index.js';
import { ensureClawctlDir } from '../config/index.js';
import type { AgentStore } from './store.js';

const AgentsFileSchema = z.array(AgentSchema);

export class JsonAgentStore implements AgentStore {
  private filePath: string | undefined;

  private async getFilePath(): Promise<string> {
    if (!this.filePath) {
      const dir = await ensureClawctlDir();
      this.filePath = join(dir, 'agents.json');
    }
    return this.filePath;
  }

  private async readAgents(): Promise<Agent[]> {
    const filePath = await this.getFilePath();
    try {
      const raw = await readFile(filePath, 'utf-8');
      return AgentsFileSchema.parse(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  private async writeAgents(agents: Agent[]): Promise<void> {
    const filePath = await this.getFilePath();
    const validated = AgentsFileSchema.parse(agents);
    await writeFile(filePath, JSON.stringify(validated, null, 2) + '\n', 'utf-8');
  }

  async list(): Promise<Agent[]> {
    return this.readAgents();
  }

  async get(id: string): Promise<Agent | undefined> {
    const agents = await this.readAgents();
    return agents.find((a) => a.id === id || a.name === id);
  }

  async add(input: CreateAgentInput): Promise<Agent> {
    const agents = await this.readAgents();
    const now = new Date().toISOString();
    const agent = AgentSchema.parse({
      ...input,
      id: randomUUID(),
      status: 'unknown',
      createdAt: now,
      updatedAt: now,
    });
    agents.push(agent);
    await this.writeAgents(agents);
    return agent;
  }

  async remove(id: string): Promise<boolean> {
    const agents = await this.readAgents();
    const index = agents.findIndex((a) => a.id === id);
    if (index === -1) return false;
    agents.splice(index, 1);
    await this.writeAgents(agents);
    return true;
  }

  async update(id: string, input: UpdateAgentInput): Promise<Agent | undefined> {
    const agents = await this.readAgents();
    const index = agents.findIndex((a) => a.id === id);
    if (index === -1) return undefined;
    const updated = AgentSchema.parse({
      ...agents[index],
      ...input,
      updatedAt: new Date().toISOString(),
    });
    agents[index] = updated;
    await this.writeAgents(agents);
    return updated;
  }
}
