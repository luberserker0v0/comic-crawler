export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'waiting_for_browser_worker'
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

export interface TaskSchedulerOptions {
  concurrency: number;
  autoStart?: boolean;
}

export interface TaskSchedulerStats {
  total: number;
  pending: number;
  running: number;
  waitingVerification: number;
  waitingForBrowserWorker: number;
  interrupted: number;
  completed: number;
  failed: number;
  cancelled: number;
}
