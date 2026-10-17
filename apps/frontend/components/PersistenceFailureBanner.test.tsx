// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PersistenceFailureBanner } from './PersistenceFailureBanner';
import { clearPersistenceFailure, getPersistenceFailures, persistWithStatus, reportPersistenceFailure } from '@/lib/storage/persistence-status';
afterEach(() => { cleanup(); for (const failure of getPersistenceFailures()) clearPersistenceFailure(failure.key); });
it('keeps the unsaved alert after a failed retry, clears only on successful save', async () => {
  const action = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('磁盘已满')).mockRejectedValueOnce(new Error('仍不可写')).mockResolvedValue(undefined);
  await expect(persistWithStatus('ui-save', action)).rejects.toThrow();
  render(<PersistenceFailureBanner />);
  expect(screen.getByRole('alert').textContent).toContain('磁盘已满');
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('仍不可写'));
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
it('shows protected read failure without a misleading write retry', () => {
  render(<PersistenceFailureBanner />);
  act(() => reportPersistenceFailure({ key: 'read:ui', operation: 'read', message: '读取失败' }));
  expect(screen.getByRole('alert').textContent).toContain('原数据已受保护');
  expect(screen.queryByRole('button')).toBeNull();
});
