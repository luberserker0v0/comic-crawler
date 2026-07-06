export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'waiting_verification'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface TaskItem<T = unknown> {
  id: string;
  data: T;
  status: TaskStatus;
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface TaskQueueOptions {
  concurrency: number;
  autoStart?: boolean;
}

export interface TaskQueueStats {
  total: number;
  pending: number;
  running: number;
  waitingVerification: number;
  interrupted: number;
  completed: number;
  failed: number;
  cancelled: number;
}
