import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Task, TaskStatus } from './types.js';

const TASKS_PATH = join(homedir(), '.clawctl', 'tasks.json');

export class TaskStore {
  private async readAll(): Promise<Task[]> {
    if (!existsSync(TASKS_PATH)) return [];
    const raw = await readFile(TASKS_PATH, 'utf-8');
    return JSON.parse(raw) as Task[];
  }

  private async writeAll(tasks: Task[]): Promise<void> {
    await mkdir(join(homedir(), '.clawctl'), { recursive: true });
    await writeFile(TASKS_PATH, JSON.stringify(tasks, null, 2) + '\n');
  }

  async create(input: {
    title: string;
    description: string;
    requestedBy: string;
    requiredCapabilities?: string[];
    timeoutSeconds?: number;
  }): Promise<Task> {
    const tasks = await this.readAll();
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      requestedBy: input.requestedBy,
      requiredCapabilities: input.requiredCapabilities,
      timeoutSeconds: input.timeoutSeconds,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    await this.writeAll(tasks);
    return task;
  }

  async get(id: string): Promise<Task | undefined> {
    const tasks = await this.readAll();
    return tasks.find((t) => t.id === id);
  }

  async list(filter?: { status?: TaskStatus; assignedTo?: string }): Promise<Task[]> {
    let tasks = await this.readAll();
    if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
    if (filter?.assignedTo) tasks = tasks.filter((t) => t.assignedTo === filter.assignedTo);
    return tasks;
  }

  async update(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const tasks = await this.readAll();
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) return undefined;
    tasks[index] = { ...tasks[index], ...updates };
    await this.writeAll(tasks);
    return tasks[index];
  }

  async assign(id: string, agentId: string, agentName: string, reason?: string): Promise<Task | undefined> {
    return this.update(id, {
      assignedTo: agentId,
      assignedToName: agentName,
      routingReason: reason,
      status: 'assigned',
      assignedAt: new Date().toISOString(),
    });
  }

  async complete(id: string, result: string): Promise<Task | undefined> {
    return this.update(id, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    });
  }

  async fail(id: string, error: string): Promise<Task | undefined> {
    return this.update(id, {
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
    });
  }
}
