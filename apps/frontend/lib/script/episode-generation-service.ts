import type { PromptLanguage, Shot } from "@/types/script";
import { useScriptStore } from "@/stores/script-store";
import { generateShotsForEpisode } from "./episode-shot-generation";
import {
  summarizeEpisodeGeneration,
  type EpisodeGenerationSummary,
} from "./episode-generation-summary";
import { analyzeEpisodeViewpoints } from "./episode-viewpoint-analysis";

export interface GenerateShotsOptions {
  apiKey: string;
  provider: string;
  baseUrl?: string;
  styleId: string;
  targetDuration: string;
  promptLanguage?: PromptLanguage;
}

export interface GenerateEpisodeShotsResult {
  shots: Shot[];
  viewpointAnalyzed: boolean;
  viewpointSkippedReason?: string;
}

export async function generateEpisodeShots(
  episodeIndex: number,
  projectId: string,
  options: GenerateShotsOptions,
  onProgress?: (message: string) => void,
): Promise<GenerateEpisodeShotsResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];

  if (!project) {
    throw new Error("项目不存在");
  }

  const episodeScript = project.episodeRawScripts.find(
    (episode) => episode.episodeIndex === episodeIndex,
  );

  if (!episodeScript) {
    throw new Error(`找不到第 ${episodeIndex} 集的剧本`);
  }

  store.updateEpisodeRawScript(projectId, episodeIndex, {
    shotGenerationStatus: "generating",
  });

  try {
    onProgress?.(`正在为第 ${episodeIndex} 集生成分镜...`);

    const scriptData = project.scriptData;
    if (!scriptData) {
      throw new Error("剧本数据不存在");
    }

    const episode = scriptData.episodes.find((item) => item.index === episodeIndex);
    if (!episode) {
      throw new Error(`找不到第 ${episodeIndex} 集的结构数据`);
    }

    const episodeScenes = scriptData.scenes.filter((scene) => episode.sceneIds.includes(scene.id));
    const scenesWithContent = episodeScenes.map((scene, index) => {
      const rawScene = episodeScript.scenes[index];
      return {
        ...scene,
        rawContent: rawScene?.content || "",
        dialogues: rawScene?.dialogues || [],
        actions: rawScene?.actions || [],
      };
    });

    const newShots = await generateShotsForEpisode(
      scenesWithContent,
      episode.id,
      scriptData.characters,
      onProgress,
    );
    const existingShots = project.shots.filter((shot) => shot.episodeId !== episode.id);
    store.setShots(projectId, [...existingShots, ...newShots]);

    const { viewpointAnalyzed, viewpointSkippedReason } = await analyzeEpisodeViewpoints({
      projectId,
      scriptData,
      projectBackground: project.projectBackground,
      episodeScript,
      episodeScenes,
      newShots,
      options,
      onProgress,
      setScriptData: store.setScriptData,
    });
    store.updateEpisodeRawScript(projectId, episodeIndex, {
      shotGenerationStatus: "completed",
      lastGeneratedAt: Date.now(),
    });

    onProgress?.(`第 ${episodeIndex} 集分镜生成完成！共 ${newShots.length} 个分镜`);
    return { shots: newShots, viewpointAnalyzed, viewpointSkippedReason };
  } catch (error) {
    store.updateEpisodeRawScript(projectId, episodeIndex, {
      shotGenerationStatus: "error",
    });
    throw error;
  }
}

export async function regenerateAllEpisodeShots(
  projectId: string,
  options: GenerateShotsOptions,
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<void> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];

  if (!project || !project.episodeRawScripts.length) {
    throw new Error("没有可生成的集");
  }

  const totalEpisodes = project.episodeRawScripts.length;
  for (let index = 0; index < totalEpisodes; index += 1) {
    const episode = project.episodeRawScripts[index];
    onProgress?.(index + 1, totalEpisodes, `正在生成第 ${episode.episodeIndex} 集...`);
    await generateEpisodeShots(
      episode.episodeIndex,
      projectId,
      options,
      (message) => onProgress?.(index + 1, totalEpisodes, message),
    );
  }
}

export function getEpisodeGenerationSummary(projectId: string): EpisodeGenerationSummary {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];

  if (!project) {
    return { total: 0, completed: 0, generating: 0, idle: 0, error: 0 };
  }

  return summarizeEpisodeGeneration(project.episodeRawScripts);
}
