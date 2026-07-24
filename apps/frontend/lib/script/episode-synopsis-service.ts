import type { EpisodeRawScript } from '@/types/script';
import { processBatched } from '@/lib/ai/batch-processor';
import { useScriptStore } from '@/stores/script-store';
import { buildSeriesContextSummary } from './series-meta-sync';
import { extractEpisodeSummary } from './episode-calibration-utils';
import type { CalibrationOptions } from './episode-title-calibration-service';
import { exportProjectMetadata } from './project-metadata-export-service';

export { exportProjectMetadata } from './project-metadata-export-service';

export interface SynopsisGenerationResult {
  success: boolean;
  generatedCount: number;
  totalEpisodes: number;
  error?: string;
}

/**
 * AI 生成每集大纲
 * 基于全局背景和每集内容，生成简洁的集大纲
 */
export async function generateEpisodeSynopses(
  projectId: string,
  _options?: CalibrationOptions, // 不再需要，保留以兼容
  onProgress?: (current: number, total: number, message: string) => void
): Promise<SynopsisGenerationResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return { success: false, generatedCount: 0, totalEpisodes: 0, error: '项目不存在' };
  }
  
  const episodes = project.episodeRawScripts;
  const totalEpisodes = episodes.length;
  
  if (totalEpisodes === 0) {
    return { success: false, generatedCount: 0, totalEpisodes: 0, error: '没有集数据' };
  }
  
  // 获取全局背景
  const background = project.projectBackground;
  const globalContext = {
    title: background?.title || project.scriptData?.title || '未命名剧本',
    genre: background?.genre || '',
    era: background?.era || '',
    worldSetting: background?.worldSetting || '',
    themes: background?.themes || [],
    outline: background?.outline || '',
    characterBios: background?.characterBios || '',
    totalEpisodes,
  };
  
  // 注入概览里的世界观知识（角色、阵营、核心冲突、关键物品等）
  const seriesCtx = buildSeriesContextSummary(project.seriesMeta || null);
  
  onProgress?.(0, totalEpisodes, `开始为 ${totalEpisodes} 集生成大纲...`);
  
  try {
    // 准备 batch items
    type SynopsisItem = { index: number; title: string; contentSummary: string };
    type SynopsisResult = { synopsis: string; keyEvents: string[] };
    const items: SynopsisItem[] = episodes.map(ep => ({
      index: ep.episodeIndex,
      title: ep.title,
      contentSummary: extractEpisodeSummary(ep),
    }));
    
    const { results, failedBatches, totalBatches } = await processBatched<SynopsisItem, SynopsisResult>({
      items,
      feature: 'script_analysis',
      buildPrompts: (batch) => {
        const { title, genre, era, worldSetting, themes, outline, characterBios, totalEpisodes: total } = globalContext;
        const system = `你是好莱坞资深剧本医生(Script Doctor)，擅长分析剧本结构和叙事节奏。

你的专业能力：
- 剧本结构分析：能快速提炼每集的核心冲突、转折点和情感高潮
- 叙事节奏把控：理解不同类型剧集的节奏特点
- 关键事件提取：能准确识别推动剧情发展的关键场景和动作

你的任务是根据剧本全局背景和每集内容，为每集生成简洁的大纲和关键事件。
${seriesCtx ? `\n【剧级知识参考】\n${seriesCtx}\n` : ''}
【剧本信息】
剧名：${title}
类型：${genre || '未知'}
${era ? `时代背景：${era}` : ''}
${worldSetting ? `世界观：${worldSetting.slice(0, 200)}` : ''}
${themes && themes.length > 0 ? `主题：${themes.join('、')}` : ''}
总集数：${total}集

【故事大纲】
${outline.slice(0, 1000)}

【主要人物】
${characterBios.slice(0, 800)}

【要求】
为每集生成：
1. synopsis: 100-200字的集大纲，概括本集主要剧情发展
2. keyEvents: 3-5个关键事件，每个10-20字

注意：
- 大纲要突出本集的核心冲突和转折
- 关键事件要具体、可视觉化
- 保持前后集的连贯性

请以JSON格式返回：
{
  "synopses": {
    "1": {
      "synopsis": "本集大纲...",
      "keyEvents": ["事件1", "事件2", "事件3"]
    }
  }
}`;
        const episodeContents = batch.map(ep => 
          `第${ep.index}集「${ep.title}」：\n${ep.contentSummary}`
        ).join('\n\n---\n\n');
        const user = `请为以下集数生成大纲和关键事件：\n\n${episodeContents}`;
        return { system, user };
      },
      parseResult: (raw) => {
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const result = new Map<string, SynopsisResult>();
        if (parsed.synopses) {
          for (const [key, value] of Object.entries(parsed.synopses)) {
            const v = value as SynopsisResult;
            result.set(key, {
              synopsis: v.synopsis || '',
              keyEvents: v.keyEvents || [],
            });
          }
        }
        return result;
      },
      estimateItemOutputTokens: () => 200, // 大纲 + keyEvents 约 200 tokens
      onProgress: (completed, total, message) => {
        onProgress?.(completed, total, `[大纲生成] ${message}`);
      },
    });
    
    // 处理结果
    let generatedCount = 0;
    for (const ep of episodes) {
      const res = results.get(String(ep.episodeIndex));
      if (res) {
        store.updateEpisodeRawScript(projectId, ep.episodeIndex, {
          synopsis: res.synopsis,
          keyEvents: res.keyEvents,
          synopsisGeneratedAt: Date.now(),
        });
        generatedCount++;
      }
    }
    
    if (failedBatches > 0) {
      console.warn(`[集大纲生成] ${failedBatches}/${totalBatches} 批次失败`);
    }
    
    onProgress?.(generatedCount, totalEpisodes, `已生成 ${generatedCount}/${totalEpisodes} 集大纲`);
    
    // 大纲生成完成后，更新项目元数据 MD
    const updatedMetadata = exportProjectMetadata(projectId);
    store.setMetadataMarkdown(projectId, updatedMetadata);
    console.log('[generateSynopses] 元数据已更新，包含新生成的大纲');
    
    return {
      success: true,
      generatedCount,
      totalEpisodes,
    };
  } catch (error) {
    console.error('[generateSynopses] Error:', error);
    return {
      success: false,
      generatedCount: 0,
      totalEpisodes,
      error: error instanceof Error ? error.message : '大纲生成失败',
    };
  }
}

/**
 * 获取缺失大纲的集数
 */
export function getMissingSynopsisEpisodes(projectId: string): EpisodeRawScript[] {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project || !project.episodeRawScripts.length) {
    return [];
  }
  
  return project.episodeRawScripts.filter(ep => !ep.synopsis || ep.synopsis.trim() === '');
}
