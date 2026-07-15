import type { EpisodeRawScript } from "@/types/script";
import { processBatched } from "@/lib/ai/batch-processor";
import { useScriptStore } from "@/stores/script-store";
import { buildSeriesContextSummary } from "./series-meta-sync";
import { extractEpisodeSummary, isMissingTitle } from "./episode-calibration-utils";

export interface CalibrationOptions {
  // 保留空接口以保持兼容性
}

export interface CalibrationResult {
  success: boolean;
  calibratedCount: number;
  totalMissing: number;
  error?: string;
}

export function getMissingTitleEpisodes(projectId: string): EpisodeRawScript[] {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  if (!project || !project.episodeRawScripts.length) return [];
  return project.episodeRawScripts.filter((episode) => isMissingTitle(episode.title));
}

export async function calibrateEpisodeTitles(
  projectId: string,
  _options?: CalibrationOptions,
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<CalibrationResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  if (!project) {
    return { success: false, calibratedCount: 0, totalMissing: 0, error: "项目不存在" };
  }

  const missingEpisodes = getMissingTitleEpisodes(projectId);
  const totalMissing = missingEpisodes.length;
  if (totalMissing === 0) return { success: true, calibratedCount: 0, totalMissing: 0 };

  onProgress?.(0, totalMissing, `找到 ${totalMissing} 集缺失标题，开始校准...`);
  const background = project.projectBackground;
  const globalContext = {
    title: background?.title || project.scriptData?.title || "未命名剧本",
    outline: background?.outline || project.scriptData?.logline || "",
    characterBios: background?.characterBios || "",
    totalEpisodes: project.episodeRawScripts.length,
  };
  const seriesContext = buildSeriesContextSummary(project.seriesMeta || null);

  try {
    type TitleItem = { index: number; contentSummary: string };
    const items: TitleItem[] = missingEpisodes.map((episode) => ({
      index: episode.episodeIndex,
      contentSummary: extractEpisodeSummary(episode),
    }));
    const { results, failedBatches, totalBatches } = await processBatched<TitleItem, string>({
      items,
      feature: "script_analysis",
      buildPrompts: (batch) => {
        const { title, outline, characterBios, totalEpisodes } = globalContext;
        const system = `你是好莱坞资深编剧，拥有艾美奖最佳编剧提名经历。

你的专业能力：
- 精通剧集命名艺术：能用简短有力的标题捕捉每集核心冲突和情感转折
- 叙事结构把控：理解商战、家族、情感等不同类型剧集的命名风格
- 市场敏感度：知道什么样的标题能吸引观众，提升点击率

你的任务是根据剧本的全局背景和每集内容，为每集生成简短有吸引力的标题。
${seriesContext ? `\n【剧级知识参考】\n${seriesContext}\n` : ""}
【剧本信息】
剧名：${title}
总集数：${totalEpisodes}集

【故事大纲】
${outline.slice(0, 1500)}

【主要人物】
${characterBios.slice(0, 1000)}

【要求】
1. 标题要能概括该集的主要内容或转折点
2. 标题长度控制在6-15个字
3. 风格要符合剧本类型（如商战剧用商战术语，武侠剧用江湖气息）
4. 标题之间要有连贯性，体现剧情发展

请以JSON格式返回，格式为：
{
  "titles": {
    "1": "第1集标题",
    "2": "第2集标题"
  }
}`;
        const episodeContents = batch
          .map((episode) => `第${episode.index}集内容摘要：${episode.contentSummary}`)
          .join("\n\n");
        return { system, user: `请为以下集数生成标题：\n\n${episodeContents}` };
      },
      parseResult: (raw) => {
        const parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        const result = new Map<string, string>();
        if (parsed.titles) {
          for (const [key, value] of Object.entries(parsed.titles)) result.set(key, value as string);
        }
        return result;
      },
      estimateItemOutputTokens: () => 30,
      onProgress: (completed, total, message) => onProgress?.(completed, total, `[标题校准] ${message}`),
    });

    let calibratedCount = 0;
    for (const episode of missingEpisodes) {
      const newTitle = results.get(String(episode.episodeIndex));
      if (!newTitle) continue;
      const title = `第${episode.episodeIndex}集：${newTitle}`;
      store.updateEpisodeRawScript(projectId, episode.episodeIndex, { title });
      const scriptData = store.projects[projectId]?.scriptData;
      const episodeData = scriptData?.episodes.find((item) => item.index === episode.episodeIndex);
      if (scriptData && episodeData) {
        episodeData.title = title;
        store.setScriptData(projectId, { ...scriptData });
      }
      calibratedCount++;
    }

    if (failedBatches > 0) console.warn(`[集标题校准] ${failedBatches}/${totalBatches} 批次失败`);
    onProgress?.(calibratedCount, totalMissing, `已校准 ${calibratedCount}/${totalMissing} 集`);
    return { success: true, calibratedCount, totalMissing };
  } catch (error) {
    console.error("[calibrate] Error:", error);
    return {
      success: false,
      calibratedCount: 0,
      totalMissing,
      error: error instanceof Error ? error.message : "校准失败",
    };
  }
}
