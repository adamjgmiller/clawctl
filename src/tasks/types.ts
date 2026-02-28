export type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  /** Human-readable title */
  title: string;
  /** Full task description/instructions for the worker */
  description: string;
  /** Who requested this task */
  requestedBy: string;
  /** Agent ID this task is assigned to */
  assignedTo?: string;
  /** Agent name (for display) */
  assignedToName?: string;
  /** How the agent was selected */
  routingReason?: string;
  /** Current status */
  status: TaskStatus;
  /** Result from the worker */
  result?: string;
  /** Error message if failed */
  error?: string;
  /** Required capabilities for routing */
  requiredCapabilities?: string[];
  /** Timeout in seconds */
  timeoutSeconds?: number;
  /** Timestamps */
  createdAt: string;
  assignedAt?: string;
  completedAt?: string;
}
