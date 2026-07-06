import type { TaskDefinition } from './manager';
import type { TaskManager } from './manager';

export interface BatchOptions {
  concurrency?: number;
  priority?: number;
  delayBetweenTasks?: number;
}

export class BatchProcessor {
  private taskManager: TaskManager;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  async process(urls: string[], options?: BatchOptions): Promise<string[]> {
    const taskIds: string[] = [];
    const concurrency = options?.concurrency ?? 1;
    const delay = options?.delayBetweenTasks ?? 0;

    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);

      const batchPromises = batch.map(async (url) => {
        const definition: TaskDefinition = {
          id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url,
          adapterId: '',
          priority: options?.priority ?? 0,
        };

        const taskId = await this.taskManager.createTask(definition);
        taskIds.push(taskId);
        return taskId;
      });

      await Promise.all(batchPromises);

      if (delay > 0 && i + concurrency < urls.length) {
        await this.sleep(delay);
      }
    }

    return taskIds;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
