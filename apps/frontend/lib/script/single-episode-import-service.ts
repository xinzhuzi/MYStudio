import type { EpisodeRawScript } from "@/types/script";
import { aiManager } from "@/lib/ai/ai-manager";
import { useScriptStore } from "@/stores/script-store";
import { parseScenes } from "./episode-parser";
import { preprocessLineBreaks } from "./script-normalizer";
import { buildSeriesContextSummary } from "./series-meta-sync";

export interface SingleEpisodeImportResult {
  success: boolean;
  sceneCount: number;
  error?: string;
}

export async function importSingleEpisodeContent(
  rawContent: string,
  episodeIndex: number,
  projectId: string,
): Promise<SingleEpisodeImportResult> {
  const tag = "[importSingleEpisodeContent]";
  try {
    const store = useScriptStore.getState();
    const project = store.projects[projectId];
    if (!project?.scriptData) return { success: false, sceneCount: 0, error: "项目或剧本数据不存在" };

    const scriptData = project.scriptData;
    const episode = scriptData.episodes.find((item) => item.index === episodeIndex);
    if (!episode) return { success: false, sceneCount: 0, error: `找不到第 ${episodeIndex} 集` };

    const rawScenes = parseScenes(preprocessLineBreaks(rawContent).text);
    console.log(`${tag} 解析出 ${rawScenes.length} 个场景`);
    if (rawScenes.length === 0) {
      store.updateEpisodeRawScript(projectId, episodeIndex, { rawContent, scenes: [] });
      return { success: true, sceneCount: 0 };
    }

    const timestamp = Date.now();
    const timeMap: Record<string, string> = {
      日: "day",
      夜: "night",
      晨: "dawn",
      暮: "dusk",
      黄昏: "dusk",
      黎明: "dawn",
      清晨: "dawn",
      傍晚: "dusk",
    };
    const newScenes = rawScenes.map((scene, index) => {
      const sceneId = `scene_ep${episodeIndex}_${timestamp}_${index + 1}`;
      const headerParts = scene.sceneHeader.split(/\s+/);
      const timeOfDay = headerParts[1] || "日";
      const hasInterior = headerParts[2] && /^(内|外|内\/外)$/.test(headerParts[2]);
      const locationStart = hasInterior ? 3 : 2;
      let location = headerParts.slice(locationStart).join(" ") || headerParts[headerParts.length - 1] || "未知";
      location = location.replace(/\s*(?:人物|角色)[：:].*/g, "").trim();

      let atmosphere = "平静";
      if (/紧张|危险|冲突|打斗|怒/.test(scene.content)) atmosphere = "紧张";
      else if (/温馨|幸福|笑|欢/.test(scene.content)) atmosphere = "温馨";
      else if (/悲伤|哭|痛|泪/.test(scene.content)) atmosphere = "悲伤";
      else if (/神秘|阴森|黑暗/.test(scene.content)) atmosphere = "神秘";

      return {
        id: sceneId,
        name: `${episodeIndex}-${index + 1} ${location}`,
        location,
        time: timeMap[timeOfDay] || "day",
        atmosphere,
      };
    });
    const newSceneIds = newScenes.map((scene) => scene.id);
    const oldSceneIds = new Set(episode.sceneIds);
    const remainingScenes = scriptData.scenes.filter((scene) => !oldSceneIds.has(scene.id));
    const remainingShots = project.shots.filter((shot) => !oldSceneIds.has(shot.sceneRefId));

    store.updateEpisodeRawScript(projectId, episodeIndex, { rawContent, scenes: rawScenes });
    store.setScriptData(projectId, {
      ...scriptData,
      scenes: [...remainingScenes, ...newScenes],
      episodes: scriptData.episodes.map((item) => (
        item.index === episodeIndex ? { ...item, sceneIds: newSceneIds } : item
      )),
    });
    if (remainingShots.length !== project.shots.length) {
      store.setShots(projectId, remainingShots);
      console.log(`${tag} 清理旧 shot: ${project.shots.length - remainingShots.length} 个`);
    }
    console.log(`${tag} 结构补全完成: ${newScenes.length} 个场景`);

    generateSingleEpisodeTitleAndSynopsis(projectId, episodeIndex).catch((error) => {
      console.warn(`${tag} 标题/大纲生成失败（不影响结构补全）:`, error);
    });
    return { success: true, sceneCount: newScenes.length };
  } catch (error) {
    console.error("[importSingleEpisodeContent] Error:", error);
    return {
      success: false,
      sceneCount: 0,
      error: error instanceof Error ? error.message : "结构补全失败",
    };
  }
}

async function generateSingleEpisodeTitleAndSynopsis(projectId: string, episodeIndex: number): Promise<void> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  if (!project) return;
  const episode = project.episodeRawScripts.find((item) => item.episodeIndex === episodeIndex);
  if (!episode?.rawContent) return;

  const hasTitle = !!episode.title && !/^第[\d一二三四五六七八九十百千]+集$/.test(episode.title.trim());
  const hasSynopsis = !!episode.synopsis?.trim();
  if (hasTitle && hasSynopsis) return;

  const background = project.projectBackground;
  const seriesContext = buildSeriesContextSummary(project.seriesMeta || null);
  const system = `你是剧本结构分析专家。根据剧本全局背景和单集内容，生成该集的标题和大纲。
${seriesContext ? `\n【剧级知识参考】\n${seriesContext}\n` : ""}剧名：${background?.title || project.scriptData?.title || "未命名"}
类型：${background?.genre || "未知"}
${background?.era ? `时代：${background.era}` : ""}

请以 JSON 格式返回：
{
  "title": "6-15字标题（体现本集核心冲突/转折）",
  "synopsis": "100-200字大纲（概括本集主要剧情）",
  "keyEvents": ["关键事件1", "关键事件2", "关键事件3"]
}`;
  const user = `第${episodeIndex}集内容：\n${episode.rawContent.slice(0, 800)}`;

  try {
    const result = await aiManager.featureText("script_analysis", system, user, { temperature: 0.3, maxTokens: 512 });
    if (!result) return;
    const jsonMatch = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const parsed = JSON.parse(jsonMatch[0]);
    const updates: Partial<EpisodeRawScript> = {};

    if (!hasTitle && parsed.title) {
      const fullTitle = `第${episodeIndex}集：${parsed.title}`;
      updates.title = fullTitle;
      const currentStore = useScriptStore.getState();
      const scriptData = currentStore.projects[projectId]?.scriptData;
      if (scriptData) {
        currentStore.setScriptData(projectId, {
          ...scriptData,
          episodes: scriptData.episodes.map((item) => (
            item.index === episodeIndex ? { ...item, title: fullTitle } : item
          )),
        });
      }
    }
    if (!hasSynopsis && parsed.synopsis) {
      updates.synopsis = parsed.synopsis;
      updates.keyEvents = parsed.keyEvents || [];
      updates.synopsisGeneratedAt = Date.now();
    }
    if (Object.keys(updates).length > 0) {
      useScriptStore.getState().updateEpisodeRawScript(projectId, episodeIndex, updates);
      console.log(`[generateSingleEpisodeTitleAndSynopsis] 第${episodeIndex}集标题/大纲已生成`);
    }
  } catch (error) {
    console.warn("[generateSingleEpisodeTitleAndSynopsis] AI 调用失败:", error);
  }
}
