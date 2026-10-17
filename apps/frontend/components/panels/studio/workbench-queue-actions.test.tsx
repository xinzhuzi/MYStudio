// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkbenchTab } from './WorkbenchTab';
import { useProjectStore } from '@/stores/project/project-store';
import { useStudioStore } from '@/stores/studio/studio-store';
import type { RemotionRenderJobV1 } from '@/types/remotion-workspace';

vi.mock('./useEditingWorkbenchActions', () => ({ useEditingWorkbenchActions: () => ({ hyperFramesState: 'blocked' }) }));
vi.mock('./useSceneSegmentExport', () => ({ useSceneSegmentExport: () => ({ scenes: [], pendingJobStatuses: [] }) }));
vi.mock('./VisualContinuityReviewPanel', () => ({ VisualContinuityReviewPanel: () => null }));
vi.mock('./VideoWorkflowReviewPanel', () => ({ VideoWorkflowReviewPanel: () => null }));
vi.mock('./ShotProductionOverview', () => ({ ShotProductionOverview: () => null }));
vi.mock('./SfxGenerateDialog', () => ({ SfxGenerateDialog: () => null }));
vi.mock('./NativeRemotionStudioHost', () => ({ NativeRemotionStudioHost: () => null }));
vi.mock('abcjs', () => ({ renderAbc: vi.fn() }));

const storyboard = { id: 'shot-001', episodeId: 'chapter-a', index: 0, outputVersion: 1 } as Parameters<typeof WorkbenchTab>[0]['storyboards'][number];
const cancel = vi.fn();
const retry = vi.fn();
const get = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  useProjectStore.setState({ activeProjectId: 'project-a' });
  useStudioStore.setState({ activeChapterId: 'chapter-a', continuityAssetVersions: [] });
  window.remotionQueue = { get, cancel, retry, onJob: () => () => undefined } as unknown as NonNullable<Window['remotionQueue']>;
});
afterEach(() => { cleanup(); delete window.remotionQueue; });
function prepare(status: RemotionRenderJobV1['status'], persistenceError?: string) {
  const job = { jobId: 'job-1', status, projectId: 'project-a', target: { kind: 'shot', chapterId: 'chapter-a', shotId: 'shot-001', shotRevision: 1 }, createdAt: 100 } as RemotionRenderJobV1;
  get.mockResolvedValue({ jobs: [job], currentShotSlots: [], persistenceError });
  return render(<WorkbenchTab projectId="project-a" episodeId="chapter-a" storyboards={[storyboard]} />);
}
it.each(['blocked', 'ready', 'queued', 'running'] as const)('shows %s cancel and exposes rejected cancellation without claiming success', async status => {
  cancel.mockResolvedValue({ success: false, canceled: false, jobId: 'job-1', error: '磁盘不可写，取消未保存' });
  const view = prepare(status);
  const button = await view.findByRole('button', { name: '取消分镜' });
  fireEvent.click(button);
  await waitFor(() => expect(cancel).toHaveBeenCalledWith('job-1'));
  expect(await view.findByText('磁盘不可写，取消未保存')).toBeTruthy();
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(retry).not.toHaveBeenCalled();
});
it('keeps canceled jobs stopped until the explicit retry button and shows rejected retries', async () => {
  retry.mockResolvedValue({ accepted: false, reason: 'blocked', message: '重试被阻止' });
  const view = prepare('canceled');
  const button = await view.findByRole('button', { name: '重试分镜' });
  expect(retry).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: '取消分镜' })).toBeNull();
  fireEvent.click(button);
  expect(await view.findByText('重试被阻止')).toBeTruthy();
});
it('renders a durable journal snapshot warning alongside loaded jobs', async () => {
  const view = prepare('blocked', '事件日志已保存，队列快照保存失败');
  expect(await view.findByRole('alert')).toHaveProperty('textContent', '事件日志已保存，队列快照保存失败');
  expect(view.getByRole('button', { name: '取消分镜' })).toBeTruthy();
});
