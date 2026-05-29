// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Rate limiting utilities for batch operations
 * Based on CineGen-AI batch operation patterns
 */

export interface RateLimitConfig {
  /** Delay between operations in milliseconds (default: 3000ms) */
  delayMs?: number;
  /** Whether to add delay before the first operation (default: false) */
  delayFirst?: boolean;
}

export interface BatchProgress {
  current: number;
  total: number;
  message?: string;
}

/**
 * Execute operations with rate limiting
 * Adds delay between operations to avoid hitting API rate limits
 * 
 * @param items - Array of items to process
 * @param operation - Async operation to perform on each item
 * @param config - Rate limit configuration
 * @param onProgress - Callback for progress updates
 */
export async function rateLimitedBatch<T, R>(
  items: T[],
  operation: (item: T, index: number) => Promise<R>,
  config: RateLimitConfig = {},
  onProgress?: (progress: BatchProgress) => void
): Promise<R[]> {
  const { delayMs = 3000, delayFirst = false } = config;
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i++) {
    // Add delay (before first if configured, otherwise between items)
    if (delayFirst ? true : i > 0) {
      await delay(delayMs);
    }
    
    // Execute operation
    const result = await operation(items[i], i);
    results.push(result);
    
    // Report progress
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: items.length,
        message: `Processing ${i + 1} of ${items.length}`,
      });
    }
  }
  
  return results;
}

/**
 * Simple delay function
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a rate-limited version of an async function
 * Ensures minimum time between calls
 */
export function createRateLimitedFn<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  minDelayMs: number = 3000
): T {
  let lastCallTime = 0;
  
  return (async (...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    
    if (timeSinceLastCall < minDelayMs) {
      await delay(minDelayMs - timeSinceLastCall);
    }
    
    lastCallTime = Date.now();
    return fn(...args);
  }) as T;
}

/**
 * Process items in batches with delays between batches
 */
export async function batchProcess<T, R>(
  items: T[],
  operation: (item: T, index: number) => Promise<R>,
  options: {
    batchSize?: number;
    batchDelayMs?: number;
    itemDelayMs?: number;
    onBatchProgress?: (batchIndex: number, totalBatches: number) => void;
    onItemProgress?: (progress: BatchProgress) => void;
  } = {}
): Promise<R[]> {
  const {
    batchSize = 1,
    batchDelayMs = 1500,
    itemDelayMs = 0,
    onBatchProgress,
    onItemProgress,
  } = options;
  
  const results: R[] = [];
  const totalBatches = Math.ceil(items.length / batchSize);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    // Delay between batches
    if (batchIndex > 0) {
      await delay(batchDelayMs);
    }
    
    if (onBatchProgress) {
      onBatchProgress(batchIndex + 1, totalBatches);
    }
    
    // Process items in this batch
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, items.length);
    const batchItems = items.slice(batchStart, batchEnd);
    
    // Process items in parallel within batch, or sequentially with delay
    if (itemDelayMs > 0) {
      for (let i = 0; i < batchItems.length; i++) {
        if (i > 0) await delay(itemDelayMs);
        
        const globalIndex = batchStart + i;
        const result = await operation(batchItems[i], globalIndex);
        results.push(result);
        
        if (onItemProgress) {
          onItemProgress({
            current: globalIndex + 1,
            total: items.length,
          });
        }
      }
    } else {
      const batchResults = await Promise.all(
        batchItems.map((item, i) => operation(item, batchStart + i))
      );
      results.push(...batchResults);
      
      if (onItemProgress) {
        onItemProgress({
          current: batchEnd,
          total: items.length,
        });
      }
    }
  }
  
  return results;
}

/**
 * Default delays used in CineGen-AI
 */
export const RATE_LIMITS = {
  /** Delay between batch items (e.g., character/scene generation) */
  BATCH_ITEM_DELAY: 3000,
  /** Delay between scenes when generating shots */
  SCENE_DELAY: 1500,
  /** Delay for API polling */
  POLL_DELAY: 5000,
} as const;
