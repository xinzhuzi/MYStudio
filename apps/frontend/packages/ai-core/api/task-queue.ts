// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * TaskQueue - Concurrent task execution with priority queue
 * Controls how many AI generation tasks run in parallel
 */

export interface TaskItem<T = unknown> {
  id: string;
  type: 'screenplay' | 'image' | 'video';
  sceneId?: number;
  priority: number;  // Higher = execute first
  payload: T;
  status: 'queued' | 'running' | 'completed' | 'failed';
  retryCount: number;
  maxRetries: number;
  onProgress?: (progress: number) => void;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

type TaskHandler<T = unknown> = (task: TaskItem<T>) => Promise<unknown>;

export class TaskQueue {
  private queue: TaskItem[] = [];
  private running = 0;
  private getMaxConcurrency: () => number;
  private handlers: Map<TaskItem['type'], TaskHandler> = new Map();
  private cancelled = false;

  constructor(getConcurrency: () => number) {
    this.getMaxConcurrency = getConcurrency;
  }

  /**
   * Register a handler for a specific task type
   */
  setHandler<T>(type: TaskItem['type'], handler: TaskHandler<T>): void {
    this.handlers.set(type, handler as TaskHandler);
  }

  /**
   * Add a task to the queue
   * Returns a promise that resolves when the task completes
   */
  enqueue<T, R>(
    task: Omit<TaskItem<T>, 'status' | 'resolve' | 'reject' | 'createdAt'>
  ): Promise<R> {
    return new Promise((resolve, reject) => {
      const fullTask: TaskItem<T> = {
        ...task,
        status: 'queued',
        createdAt: Date.now(),
        resolve: resolve as (result: unknown) => void,
        reject,
      };

      // Insert by priority (higher priority first)
      const idx = this.queue.findIndex(t => t.priority < fullTask.priority);
      if (idx === -1) {
        this.queue.push(fullTask as TaskItem);
      } else {
        this.queue.splice(idx, 0, fullTask as TaskItem);
      }

      this.tryExecuteNext();
    });
  }

  /**
   * Try to execute the next queued task if capacity allows
   */
  private async tryExecuteNext(): Promise<void> {
    if (this.cancelled) return;
    if (this.running >= this.getMaxConcurrency()) return;

    const task = this.queue.find(t => t.status === 'queued');
    if (!task) return;

    const handler = this.handlers.get(task.type);
    if (!handler) {
      task.status = 'failed';
      task.reject(new Error(`No handler registered for task type: ${task.type}`));
      this.tryExecuteNext();
      return;
    }

    this.running++;
    task.status = 'running';

    try {
      const result = await handler(task);
      task.status = 'completed';
      task.resolve(result);
    } catch (e) {
      const error = e as Error;
      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.status = 'queued';
        console.warn(`[TaskQueue] Task ${task.id} failed, retrying (${task.retryCount}/${task.maxRetries}):`, error.message);
      } else {
        task.status = 'failed';
        task.reject(error);
      }
    } finally {
      this.running--;
      // Remove completed/failed tasks from queue
      this.queue = this.queue.filter(t => t.status === 'queued' || t.status === 'running');
      this.tryExecuteNext();
    }
  }

  /**
   * Cancel all pending tasks
   */
  cancelAll(): void {
    this.cancelled = true;
    const pending = this.queue.filter(t => t.status === 'queued');
    for (const task of pending) {
      task.status = 'failed';
      task.reject(new Error('Task cancelled'));
    }
    this.queue = this.queue.filter(t => t.status === 'running');
  }

  /**
   * Resume after cancel
   */
  resume(): void {
    this.cancelled = false;
  }

  /**
   * Get queue statistics
   */
  getStats(): { queued: number; running: number; maxConcurrency: number } {
    return {
      queued: this.queue.filter(t => t.status === 'queued').length,
      running: this.running,
      maxConcurrency: this.getMaxConcurrency(),
    };
  }

  /**
   * Check if queue is idle (no running or queued tasks)
   */
  isIdle(): boolean {
    return this.running === 0 && this.queue.filter(t => t.status === 'queued').length === 0;
  }
}
