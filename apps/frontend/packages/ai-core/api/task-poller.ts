// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * TaskPoller - Async task status polling with dynamic timeout
 * Used for polling image/video generation APIs that return task IDs
 */

import type { AsyncTaskResult } from '../types';

export interface PollOptions {
  /** Function to fetch current task status */
  fetchStatus: () => Promise<AsyncTaskResult>;
  /** Progress callback */
  onProgress?: (progress: number, status: string) => void;
  /** Check if operation was cancelled */
  isCancelled?: () => boolean;
  /** Custom polling interval in ms (default: 3000) */
  interval?: number;
  /** Custom timeout in ms (default: 600000 = 10 min) */
  timeout?: number;
}

export class TaskPoller {
  private defaultInterval = 3000;   // 3 seconds
  private defaultTimeout = 600000;  // 10 minutes
  private maxTimeout = 1800000;     // 30 minutes cap

  /**
   * Poll an async task until completion or failure
   * Automatically extends timeout based on server's estimated_time
   */
  async poll(
    taskId: string,
    type: 'image' | 'video',
    options: PollOptions
  ): Promise<AsyncTaskResult> {
    const {
      fetchStatus,
      onProgress,
      isCancelled,
      interval = this.defaultInterval,
      timeout = this.defaultTimeout,
    } = options;

    const startTime = Date.now();
    let effectiveTimeout = timeout;
    let pollCount = 0;

    console.log(`[TaskPoller] Starting poll for ${type} task: ${taskId}`);

    while (true) {
      pollCount++;

      // Check cancellation
      if (isCancelled?.()) {
        console.log(`[TaskPoller] Task ${taskId} cancelled by user`);
        throw new Error('Task cancelled');
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > effectiveTimeout) {
        const minutes = Math.floor(effectiveTimeout / 60000);
        console.error(`[TaskPoller] Task ${taskId} timed out after ${minutes} minutes`);
        throw new Error(`${type} generation timeout after ${minutes} minutes`);
      }

      try {
        const result = await fetchStatus();
        
        // Report progress
        onProgress?.(result.progress ?? 0, result.status);

        // Dynamic timeout adjustment based on server estimate
        if (result.estimatedTime && result.estimatedTime > 0) {
          // Give 2x buffer + 2 minutes, capped at maxTimeout
          const buffered = (result.estimatedTime * 2 + 120) * 1000;
          const newTimeout = Math.min(buffered, this.maxTimeout);
          if (newTimeout > effectiveTimeout) {
            effectiveTimeout = newTimeout;
            console.log(`[TaskPoller] Extended timeout to ${Math.floor(effectiveTimeout / 60000)} minutes based on server estimate`);
          }
        }

        // Check completion
        if (result.status === 'completed') {
          console.log(`[TaskPoller] Task ${taskId} completed after ${pollCount} polls`);
          return result;
        }

        // Check failure
        if (result.status === 'failed') {
          console.error(`[TaskPoller] Task ${taskId} failed: ${result.error}`);
          throw new Error(result.error || 'Task failed');
        }

        // Log progress periodically
        if (pollCount % 10 === 0) {
          console.log(`[TaskPoller] Task ${taskId} still ${result.status}, progress: ${result.progress ?? 'unknown'}%, poll #${pollCount}`);
        }

      } catch (e) {
        const error = e as Error;
        
        // Re-throw user cancellation and timeout errors
        if (error.message.includes('cancelled') || 
            error.message.includes('timeout') ||
            error.message.includes('Task failed')) {
          throw error;
        }

        // Network errors: log and continue polling
        console.warn(`[TaskPoller] Network error on poll #${pollCount}, will retry:`, error.message);
      }

      // Wait before next poll
      await this.sleep(interval);
    }
  }

  /**
   * Poll with a simple timeout (no dynamic adjustment)
   */
  async pollSimple(
    fetchStatus: () => Promise<AsyncTaskResult>,
    options: { timeout?: number; interval?: number } = {}
  ): Promise<AsyncTaskResult> {
    return this.poll('simple', 'image', {
      fetchStatus,
      timeout: options.timeout,
      interval: options.interval,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
