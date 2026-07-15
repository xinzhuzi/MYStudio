// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiManager } from '@/lib/ai/ai-manager';
import { calibrateEpisodeTitles, getMissingTitleEpisodes } from '@/lib/script/full-script-service';
import { toast } from 'sonner';

import { useScriptTitleCalibration } from './use-script-title-calibration';

vi.mock('@/lib/ai/ai-manager', () => ({
  aiManager: { featureConfig: vi.fn(), featureNotConfiguredMessage: vi.fn(() => '未配置') },
}));
vi.mock('@/lib/script/full-script-service', () => ({
  calibrateEpisodeTitles: vi.fn(),
  getMissingTitleEpisodes: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

describe('useScriptTitleCalibration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves missing-config and already-complete exits', async () => {
    const setStatus = vi.fn();
    const setMissingTitleCount = vi.fn();
    const { result, rerender } = renderHook(() => useScriptTitleCalibration({ projectId: 'p1', setStatus, setMissingTitleCount }));

    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    await result.current();
    expect(toast.error).toHaveBeenCalledWith('未配置');

    vi.mocked(aiManager.featureConfig).mockReturnValue({ allApiKeys: ['k'], platform: 'openai' } as never);
    vi.mocked(getMissingTitleEpisodes).mockReturnValue([]);
    rerender();
    await result.current();
    expect(toast.info).toHaveBeenCalledWith('所有集数都已有标题');
    expect(calibrateEpisodeTitles).not.toHaveBeenCalled();
  });

  it('passes provider options and updates completed state', async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({
      allApiKeys: ['k1', 'k2'], platform: 'zhipu', baseUrl: 'https://api.example', models: ['m1'],
    } as never);
    vi.mocked(getMissingTitleEpisodes).mockReturnValue([{ index: 1 }] as never);
    vi.mocked(calibrateEpisodeTitles).mockResolvedValue({ success: true, totalMissing: 3, calibratedCount: 2 } as never);
    const setStatus = vi.fn();
    const setMissingTitleCount = vi.fn();
    const { result } = renderHook(() => useScriptTitleCalibration({ projectId: 'p1', setStatus, setMissingTitleCount }));

    await result.current();

    expect(calibrateEpisodeTitles).toHaveBeenCalledWith('p1', {
      apiKey: 'k1,k2', provider: 'zhipu', baseUrl: 'https://api.example', model: 'm1',
    }, expect.any(Function));
    expect(setStatus.mock.calls.map(([status]) => status)).toEqual(['calibrating', 'completed']);
    expect(setMissingTitleCount).toHaveBeenCalledWith(1);
  });

  it('preserves failed result error state and toast', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(aiManager.featureConfig).mockReturnValue({ allApiKeys: ['k'], platform: 'openai' } as never);
    vi.mocked(getMissingTitleEpisodes).mockReturnValue([{ index: 1 }] as never);
    vi.mocked(calibrateEpisodeTitles).mockResolvedValue({ success: false, error: 'provider down' } as never);
    const setStatus = vi.fn();
    const { result } = renderHook(() => useScriptTitleCalibration({ projectId: 'p1', setStatus, setMissingTitleCount: vi.fn() }));

    await result.current();
    expect(setStatus).toHaveBeenLastCalledWith('error');
    expect(toast.error).toHaveBeenCalledWith('校准失败: provider down');
  });
});
