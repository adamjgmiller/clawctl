import type { Agent, CreateAgentInput, UpdateAgentInput } from '../types/index.js';

export interface AgentStore {
  list(): Promise<Agent[]>;
  get(id: string): Promise<Agent | undefined>;
  add(input: CreateAgentInput): Promise<Agent>;
  remove(id: string): Promise<boolean>;
  update(id: string, input: UpdateAgentInput): Promise<Agent | undefined>;
}
