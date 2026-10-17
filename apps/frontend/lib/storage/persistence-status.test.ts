import { expect, it, vi } from 'vitest';
import { getPersistenceFailures, persistWithStatus } from './persistence-status';

it('retains failures until a confirmed retry and never retries an older edit over a new save', async () => {
  const action = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
  await expect(persistWithStatus('status-retry', action)).rejects.toThrow('disk full');
  const retry = getPersistenceFailures().find(f => f.key === 'status-retry')!.retry!;
  await retry();
  expect(action).toHaveBeenCalledTimes(2);
  expect(getPersistenceFailures().some(f => f.key === 'status-retry')).toBe(false);
  const stale = vi.fn(async () => { throw new Error('old'); });
  await expect(persistWithStatus('status-stale', stale)).rejects.toThrow();
  const staleRetry = getPersistenceFailures().find(f => f.key === 'status-stale')!.retry!;
  const newer = vi.fn(async () => undefined);
  await persistWithStatus('status-stale', newer);
  await staleRetry();
  expect(stale).toHaveBeenCalledTimes(1);
  expect(newer).toHaveBeenCalledOnce();
});

it('serializes pending mutations and permits saves after a failed predecessor', async () => {
  let release!: () => void;
  const first = persistWithStatus('status-order', async () => { await new Promise<void>(r => { release = r; }); throw new Error('first'); });
  await Promise.resolve();
  const secondAction = vi.fn(async () => undefined);
  const second = persistWithStatus('status-order', secondAction);
  expect(secondAction).not.toHaveBeenCalled();
  release();
  await expect(first).rejects.toThrow('first');
  await second;
  expect(secondAction).toHaveBeenCalledOnce();
  expect(getPersistenceFailures().some(f => f.key === 'status-order')).toBe(false);
});
