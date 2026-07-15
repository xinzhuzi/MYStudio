import type { EpisodeRawScript } from '@/types/script';
import { processBatched } from '@/lib/ai/batch-processor';
import { useScriptStore } from '@/stores/script-store';
import { buildSeriesContextSummary } from './series-meta-sync';
import { extractEpisodeSummary } from './episode-calibration-utils';
import type { CalibrationOptions } from './full-script-service';

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

// ==================== 导出项目元数据 MD ====================

/**
 * 导出项目元数据为 Markdown 格式
 * 类似 Cursor 的 .cursorrules，作为项目的知识库
 */
export function exportProjectMetadata(projectId: string): string {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return '# 错误\n\n项目不存在';
  }
  
  const background = project.projectBackground;
  const episodes = project.episodeRawScripts;
  const scriptData = project.scriptData;
  const meta = project.seriesMeta;
  
  const sections: string[] = [];
  
  // 标题
  const title = meta?.title || background?.title || scriptData?.title || '未命名剧本';
  sections.push(`# 《${title}》`);
  sections.push('');
  
  // 基本信息
  sections.push('## 基本信息');
  const genre = meta?.genre || background?.genre;
  const era = meta?.era || background?.era;
  if (genre) sections.push(`- **类型**：${genre}`);
  if (era) sections.push(`- **时代**：${era}`);
  sections.push(`- **总集数**：${episodes.length}集`);
  if (meta?.language || scriptData?.language) sections.push(`- **语言**：${meta?.language || scriptData?.language}`);
  if (meta?.logline) sections.push(`- **Logline**：${meta.logline}`);
  if (meta?.centralConflict) sections.push(`- **核心冲突**：${meta.centralConflict}`);
  if (meta?.themes?.length) sections.push(`- **主题**：${meta.themes.join('、')}`);
  sections.push('');
  
  // 故事大纲
  const outline = meta?.outline || background?.outline;
  if (outline) {
    sections.push('## 故事大纲');
    sections.push(outline);
    sections.push('');
  }
  
  // 世界观设定
  const worldNotes = meta?.worldNotes || background?.worldSetting;
  if (worldNotes || meta?.powerSystem || meta?.socialSystem) {
    sections.push('## 世界观设定');
    if (worldNotes) sections.push(worldNotes);
    if (meta?.socialSystem) sections.push(`- **社会体系**：${meta.socialSystem}`);
    if (meta?.powerSystem) sections.push(`- **力量体系**：${meta.powerSystem}`);
    sections.push('');
  }
  
  // 地理设定
  if (meta?.geography?.length) {
    sections.push('## 地理设定');
    for (const g of meta.geography) {
      sections.push(`- **${g.name}**：${g.desc}`);
    }
    sections.push('');
  }
  
  // 关键物品
  if (meta?.keyItems?.length) {
    sections.push('## 关键物品');
    for (const item of meta.keyItems) {
      sections.push(`- **${item.name}**：${item.desc}`);
    }
    sections.push('');
  }
  
  // 主要人物（原始小传）
  if (background?.characterBios) {
    sections.push('## 主要人物');
    sections.push(background.characterBios);
    sections.push('');
  }
  
  // 角色列表（结构化）— 优先从 seriesMeta 读取
  const characters = meta?.characters || scriptData?.characters;
  if (characters && characters.length > 0) {
    sections.push('## 角色列表');
    for (const char of characters) {
      sections.push(`### ${char.name}`);
      if (char.gender) sections.push(`- 性别：${char.gender}`);
      if (char.age) sections.push(`- 年龄：${char.age}`);
      if (char.role) sections.push(`- 身份：${char.role}`);
      if (char.personality) sections.push(`- 性格：${char.personality}`);
      if (char.traits) sections.push(`- 特质：${char.traits}`);
      if (char.relationships) sections.push(`- 关系：${char.relationships}`);
      if (char.skills) sections.push(`- 技能：${char.skills}`);
      sections.push('');
    }
  }
  
  // 阵营/势力
  if (meta?.factions?.length) {
    sections.push('## 阵营/势力');
    for (const f of meta.factions) {
      sections.push(`- **${f.name}**：${f.members.join('、')}`);
    }
    sections.push('');
  }
  
  // 剧集大纲
  sections.push('## 剧集大纲');
  for (const ep of episodes) {
    sections.push(`### 第${ep.episodeIndex}集：${ep.title.replace(/^第\d+集[：:]？/, '')}`);
    if (ep.synopsis) {
      sections.push(ep.synopsis);
    }
    if (ep.keyEvents && ep.keyEvents.length > 0) {
      sections.push('**关键事件：**');
      for (const event of ep.keyEvents) {
        sections.push(`- ${event}`);
      }
    }
    // 显示场景数量
    sections.push(`> 本集包含 ${ep.scenes.length} 个场景`);
    sections.push('');
  }
  
  // 生成时间
  sections.push('---');
  sections.push(`*导出时间：${new Date().toLocaleString('zh-CN')}*`);
  
  return sections.join('\n');
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

