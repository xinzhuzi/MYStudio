/**
 * Simple memory-only mutex for single-user/single-project editing.
 *
 * Design rationale:
 * - Single-process lock (no cross-process needed per user requirement)
 * - Memory-only state (simple, no IPC overhead)
 * - FIFO queue for fairness (first acquire wins)
 * - No deadlock risk (single thread, no nested locking)
 */

export class ProjectDeletionMutex {
  /** Set of currently held project IDs (only one holder per project) */
  private heldProjects: Set<string> = new Set();

  /** Queue of waiting release functions per project (FIFO) */
  private waitingQueues: Map<string, Array<() => void>> = new Map();

  /**
   * Attempts to acquire the lock for a project.
   * Returns a release function that must be called to release the lock.
   *
   * @param projectId - The ID of the project to lock
   * @returns Promise resolving to a release function
   */
  async acquire(projectId: string): Promise<() => Promise<void>> {
    // While loop ensures we wait until project is free
    // This pattern works because:
    // 1. Single process = no race conditions on heldProjects.has()
    // 2. Event loop guarantees atomic check-and-acquire within callback
    while (this.heldProjects.has(projectId)) {
      await this._waitForRelease(projectId);
    }

    // Mark as held before returning
    this.heldProjects.add(projectId);

    // Return release function that will:
    // 1. Remove from heldProjects
    // 2. Notify next waiter in FIFO order
    const release = async (): Promise<void> => {
      this.heldProjects.delete(projectId);
      this._notifyWaiters(projectId);
    };

    return release;
  }

  /**
   * Creates a Promise that resolves when the project is released.
   * This is used internally by acquire() to wait for contention.
   */
  private _waitForRelease(projectId: string): Promise<void> {
    // Create queue if not exists (first time someone waits)
    if (!this.waitingQueues.has(projectId)) {
      this.waitingQueues.set(projectId, []);
    }

    const queue = this.waitingQueues.get(projectId)!;

    // Add current callback to queue (FIFO ordering)
    return new Promise((resolve) => {
      queue.push(resolve as () => void);
    });
  }

  /**
   * Notifies the next waiter in the queue for a given project.
   * Called after releasing a lock.
   */
  private _notifyWaiters(projectId: string): void {
    const queue = this.waitingQueues.get(projectId);

    // No waiters, nothing to do
    if (!queue || queue.length === 0) {
      return;
    }

    // Take first waiter from queue (FIFO) and resolve their promise
    // This allows the waiting acquire() to proceed
    const nextWaiter = queue.shift();
    if (nextWaiter) {
      nextWaiter();
    }

    // Clean up empty queues to prevent memory leaks
    if (queue.length === 0) {
      this.waitingQueues.delete(projectId);
    }
  }
}
