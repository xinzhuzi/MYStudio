// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 错开启动的并发控制执行器
 *
 * 行为：
 * - 每个新任务在前一个任务启动后至少等待 staggerMs 才启动
 * - 同时最多运行 maxConcurrent 个任务
 * - 当活跃任务数达到上限时，等待有任务完成后才启动下一个（仍保持 staggerMs 间隔）
 *
 * 例如 maxConcurrent=3, staggerMs=5000, 每个任务耗时20秒：
 *   t=0s:  启动任务1
 *   t=5s:  启动任务2
 *   t=10s: 启动任务3（达到并发上限）
 *   t=15s: 任务4的 stagger 到期，但并发已满，排队等待
 *   t=20s: 任务1完成 → 任务4立即启动
 *   t=25s: 任务2完成 → 任务5立即启动
 *
 * 例如 maxConcurrent=1, staggerMs=5000, 每个任务耗时2秒：
 *   t=0s:  启动任务1
 *   t=2s:  任务1完成
 *   t=5s:  stagger 到期 → 启动任务2（严格保持5秒间隔）
 *   t=7s:  任务2完成
 *   t=10s: 启动任务3
 */
export async function runStaggered<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
  staggerMs: number = 5000
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];

  const results: PromiseSettledResult<T>[] = new Array(tasks.length);

  // 信号量：控制最大并发数
  let activeCount = 0;
  const waiters: (() => void)[] = [];

  const acquire = async (): Promise<void> => {
    if (activeCount < maxConcurrent) {
      activeCount++;
      return;
    }
    // 并发已满，排队等待
    await new Promise<void>((resolve) => waiters.push(resolve));
  };

  const release = (): void => {
    activeCount--;
    if (waiters.length > 0) {
      // 唤醒队列中的下一个等待者
      activeCount++;
      const next = waiters.shift()!;
      next();
    }
  };

  // 逐个启动任务，每个间隔 staggerMs
  // 第N个任务在 N * staggerMs 后才被允许启动（stagger 保底间隔）
  // 同时受信号量限制（并发保底）
  const taskPromises = tasks.map(async (task, idx) => {
    // 错开启动：第N个任务至少在 N * staggerMs 后才启动
    if (idx > 0) {
      await new Promise<void>((r) => setTimeout(r, idx * staggerMs));
    }

    // 获取并发槽位（如果已满则等待有任务完成）
    await acquire();

    try {
      const value = await task();
      results[idx] = { status: 'fulfilled', value };
    } catch (reason) {
      results[idx] = { status: 'rejected', reason: reason as any };
    } finally {
      release();
    }
  });

  await Promise.all(taskPromises);
  return results;
}
