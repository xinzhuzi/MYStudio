// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiManager } from '@/lib/ai/ai-manager';
import {
  generateEpisodeSynopses,
  getMissingSynopsisEpisodes,
} from '@/lib/script/full-script-service';
import { toast } from 'sonner';

import { useScriptSynopsisGeneration } from './use-script-synopsis-generation';

vi.mock('@/lib/ai/ai-manager', () => ({
  aiManager: { featureConfig: vi.fn(), featureNotConfiguredMessage: vi.fn(() => '未配置') },
}));
vi.mock('@/lib/script/full-script-service', () => ({
  generateEpisodeSynopses: vi.fn(),
  getMissingSynopsisEpisodes: vi.fn(() => []),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

describe('useScriptSynopsisGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops when script analysis is not configured', async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    const setStatus = vi.fn();
    const { result } = renderHook(() => useScriptSynopsisGeneration({
      projectId: 'p1', episodeCount: 2, setStatus, setMissingSynopsisCount: vi.fn(),
    }));
    await result.current();
    expect(toast.error).toHaveBeenCalledWith('未配置');
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('passes provider options and completes synopsis state', async () => {
    vi.mocked(aiManager.featureConfig).mockReturnValue({
      allApiKeys: ['k1', 'k2'], platform: 'zhipu', baseUrl: 'https://api.example', models: ['m1'],
    } as never);
    vi.mocked(generateEpisodeSynopses).mockResolvedValue({ success: true, generatedCount: 2 } as never);
    vi.mocked(getMissingSynopsisEpisodes).mockReturnValue([{ episodeIndex: 3 }] as never);
    const setStatus = vi.fn();
    const setMissingSynopsisCount = vi.fn();
    const { result } = renderHook(() => useScriptSynopsisGeneration({
      projectId: 'p1', episodeCount: 3, setStatus, setMissingSynopsisCount,
    }));
    await result.current();
    expect(generateEpisodeSynopses).toHaveBeenCalledWith('p1', {
      apiKey: 'k1,k2', provider: 'zhipu', baseUrl: 'https://api.example', model: 'm1',
    }, expect.any(Function));
    expect(setStatus.mock.calls.map(([status]) => status)).toEqual(['generating', 'completed']);
    expect(setMissingSynopsisCount).toHaveBeenCalledWith(1);
    expect(toast.info).toHaveBeenCalledWith('正在为 3 集生成大纲...');
  });

  it('preserves failed result state and error message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(aiManager.featureConfig).mockReturnValue({ allApiKeys: ['k'], platform: 'openai' } as never);
    vi.mocked(generateEpisodeSynopses).mockResolvedValue({ success: false, error: 'provider down' } as never);
    const setStatus = vi.fn();
    const { result } = renderHook(() => useScriptSynopsisGeneration({
      projectId: 'p1', episodeCount: 1, setStatus, setMissingSynopsisCount: vi.fn(),
    }));
    await result.current();
    expect(setStatus).toHaveBeenLastCalledWith('error');
    expect(toast.error).toHaveBeenCalledWith('大纲生成失败: provider down');
  });
});
