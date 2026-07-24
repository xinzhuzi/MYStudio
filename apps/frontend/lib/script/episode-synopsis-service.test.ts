import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processBatched } from '@/lib/ai/batch-processor';
import { useScriptStore } from '@/stores/script-store';

import {
  exportProjectMetadata,
  generateEpisodeSynopses,
  getMissingSynopsisEpisodes,
} from './episode-synopsis-service';
import { exportProjectMetadata as exportProjectMetadataService } from './project-metadata-export-service';

vi.mock('@/lib/ai/batch-processor', () => ({ processBatched: vi.fn() }));
vi.mock('@/stores/script-store', () => ({ useScriptStore: { getState: vi.fn() } }));

const episode = (episodeIndex: number, synopsis = '') => ({
  episodeIndex,
  title: `第${episodeIndex}集：标题`,
  synopsis,
  keyEvents: [],
  scenes: [],
  rawContent: `第${episodeIndex}集内容`,
});

describe('episode synopsis service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns explicit errors for missing projects and empty episode data', async () => {
    vi.mocked(useScriptStore.getState).mockReturnValue({ projects: {} } as never);
    await expect(generateEpisodeSynopses('missing')).resolves.toMatchObject({
      success: false,
      error: '项目不存在',
    });

    vi.mocked(useScriptStore.getState).mockReturnValue({
      projects: { empty: { episodeRawScripts: [] } },
    } as never);
    await expect(generateEpisodeSynopses('empty')).resolves.toMatchObject({
      success: false,
      error: '没有集数据',
    });
  });

  it('writes generated synopses and refreshes metadata through the existing store contract', async () => {
    const episodes = [episode(1), episode(2)];
    const updateEpisodeRawScript = vi.fn((projectId: string, index: number, updates: object) => {
      Object.assign(episodes.find((item) => item.episodeIndex === index)!, updates);
    });
    const setMetadataMarkdown = vi.fn();
    vi.mocked(useScriptStore.getState).mockReturnValue({
      projects: {
        project: {
          episodeRawScripts: episodes,
          projectBackground: { title: '测试剧本', themes: [] },
          scriptData: null,
          seriesMeta: null,
        },
      },
      updateEpisodeRawScript,
      setMetadataMarkdown,
    } as never);
    vi.mocked(processBatched).mockResolvedValue({
      results: new Map([
        ['1', { synopsis: '第一集大纲', keyEvents: ['事件一'] }],
      ]),
      failedBatches: 1,
      totalBatches: 2,
    } as never);

    const result = await generateEpisodeSynopses('project');

    expect(result).toEqual({ success: true, generatedCount: 1, totalEpisodes: 2 });
    expect(updateEpisodeRawScript).toHaveBeenCalledWith('project', 1, expect.objectContaining({
      synopsis: '第一集大纲',
      keyEvents: ['事件一'],
      synopsisGeneratedAt: expect.any(Number),
    }));
    expect(setMetadataMarkdown).toHaveBeenCalledWith('project', expect.stringContaining('第一集大纲'));
  });

  it('exports metadata and returns only episodes with missing synopsis', () => {
    const episodes = [episode(1, '已有大纲'), episode(2, '  ')];
    vi.mocked(useScriptStore.getState).mockReturnValue({
      projects: {
        project: {
          episodeRawScripts: episodes,
          projectBackground: { title: '测试剧本', genre: '动画', themes: [] },
          scriptData: null,
          seriesMeta: null,
        },
      },
    } as never);

    expect(getMissingSynopsisEpisodes('project').map((item) => item.episodeIndex)).toEqual([2]);
    expect(exportProjectMetadata('project')).toContain('# 《测试剧本》');
    expect(exportProjectMetadata('project')).toContain('**总集数**：2集');
    expect(exportProjectMetadata).toBe(exportProjectMetadataService);
  });
});
