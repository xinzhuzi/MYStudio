import { getAIConcurrency } from "@/lib/ai/config/store-adapter";
import type {
  EpisodeRawScript,
  ProjectBackground,
  SceneViewpointData,
  ScriptData,
  ScriptScene,
  Shot,
} from "@/types/script";
import { runStaggered } from "@/lib/utils/concurrency";
import { analyzeSceneViewpoints, type ViewpointAnalysisOptions } from "./viewpoint-analyzer";

interface EpisodeViewpointProviderOptions {
  apiKey: string;
  provider: string;
  baseUrl?: string;
}

interface AnalyzeEpisodeViewpointsInput {
  projectId: string;
  scriptData: ScriptData;
  projectBackground: ProjectBackground | null;
  episodeScript: EpisodeRawScript;
  episodeScenes: ScriptScene[];
  newShots: Shot[];
  options: EpisodeViewpointProviderOptions;
  onProgress?: (message: string) => void;
  setScriptData: (projectId: string, data: ScriptData) => void;
}

export interface EpisodeViewpointAnalysisResult {
  viewpointAnalyzed: boolean;
  viewpointSkippedReason?: string;
}

export async function analyzeEpisodeViewpoints({
  projectId,
  scriptData,
  projectBackground,
  episodeScript,
  episodeScenes,
  newShots,
  options,
  onProgress,
  setScriptData,
}: AnalyzeEpisodeViewpointsInput): Promise<EpisodeViewpointAnalysisResult> {
  let analysisExecuted = false;
  let viewpointCount = 0;


  if (!options.apiKey) {
    console.error("[generateEpisodeShots] ❌ 跳过 AI 视角分析: apiKey 未配置");
    return { viewpointAnalyzed: false, viewpointSkippedReason: "apiKey 未配置" };
  }
  if (episodeScenes.length === 0) {
    console.warn("[generateEpisodeShots] ⚠️ 跳过 AI 视角分析: 无场景");
    return { viewpointAnalyzed: false, viewpointSkippedReason: "无场景" };
  }

  onProgress?.(`正在 AI 分析场景视角（共 ${episodeScenes.length} 个场景）...`);

  try {
    const viewpointOptions: ViewpointAnalysisOptions = {
      episodeSynopsis: episodeScript.synopsis || "",
      keyEvents: episodeScript.keyEvents || [],
      title: projectBackground?.title,
      genre: projectBackground?.genre,
      era: projectBackground?.era,
      worldSetting: projectBackground?.worldSetting,
    };
    const userConcurrency = getAIConcurrency();
    const concurrency = Math.min(userConcurrency, 10);
    const updatedScenes = [...scriptData.scenes];
    const sceneAnalysisTasks = episodeScenes
      .map((scene, index) => ({
        scene,
        index,
        sceneShots: newShots.filter((shot) => shot.sceneRefId === scene.id),
      }))
      .filter((task) => task.sceneShots.length > 0);


    const settledResults = await runStaggered(
      sceneAnalysisTasks.map((task, _taskIndex) => async () => {
        const { scene, index, sceneShots } = task;
        analysisExecuted = true;
        onProgress?.(`AI 分析场景 ${index + 1}/${episodeScenes.length}: ${scene.location}...`);
        const result = await analyzeSceneViewpoints(scene, sceneShots, viewpointOptions);
        return { scene, sceneShots, result };
      }),
      concurrency,
      5000,
    );

    for (const settledResult of settledResults) {
      if (settledResult.status === "rejected") {
        console.error("[generateEpisodeShots] ❌ 场景分析失败:", settledResult.reason);
        continue;
      }

      const { scene, sceneShots, result } = settledResult.value;
      const sceneIndex = updatedScenes.findIndex((item) => item.id === scene.id);
      if (sceneIndex === -1) continue;

      const viewpointsData: SceneViewpointData[] = result.viewpoints.map((viewpoint, index) => ({
        id: viewpoint.id,
        name: viewpoint.name,
        nameEn: viewpoint.nameEn,
        shotIds: viewpoint.shotIndexes
          .map((shotIndex) => sceneShots[shotIndex - 1]?.id)
          .filter((shotId): shotId is string => Boolean(shotId)),
        keyProps: viewpoint.keyProps,
        gridIndex: index,
      }));
      const assignedShotIds = new Set(viewpointsData.flatMap((viewpoint) => viewpoint.shotIds));
      const unassignedShots = sceneShots.filter((shot) => !assignedShotIds.has(shot.id));

      for (const shot of unassignedShots) {
        const shotText = [
          shot.actionSummary,
          shot.visualDescription,
          shot.visualFocus,
          shot.dialogue,
        ].filter(Boolean).join(" ").toLowerCase();
        let bestViewpointIndex = 0;
        let bestScore = 0;

        for (let index = 0; index < viewpointsData.length; index += 1) {
          const viewpoint = viewpointsData[index];
          let score = 0;
          for (const character of viewpoint.name.toLowerCase().replace(/(视角|区|位)$/g, "").split("")) {
            if (shotText.includes(character)) score += 1;
          }
          for (const prop of viewpoint.keyProps || []) {
            if (shotText.includes(prop.toLowerCase())) score += 2;
          }
          if (score > bestScore) {
            bestScore = score;
            bestViewpointIndex = index;
          }
        }

        if (bestScore === 0) {
          const overviewIndex = viewpointsData.findIndex(
            (viewpoint) => viewpoint.name.includes("全景") || viewpoint.id === "overview",
          );
          bestViewpointIndex = overviewIndex >= 0 ? overviewIndex : 0;
        }
        viewpointsData[bestViewpointIndex].shotIds.push(shot.id);
      }

      updatedScenes[sceneIndex] = { ...updatedScenes[sceneIndex], viewpoints: viewpointsData };
      viewpointCount += viewpointsData.length;
    }

 
    for (const _scene of episodeScenes.filter(
      (item) => !sceneAnalysisTasks.some((task) => task.scene.id === item.id),
    )) {
    }

    setScriptData(projectId, { ...scriptData, scenes: updatedScenes });
    const viewpointSkippedReason = analysisExecuted ? undefined : "无分镜";
    onProgress?.(`AI 视角分析完成（${viewpointCount} 个视角）`);
    return { viewpointAnalyzed: analysisExecuted, viewpointSkippedReason };
  } catch (error) {
    const err = error as Error;
    console.error("[generateEpisodeShots] ❌ AI 视角分析失败:", err);
    return {
      viewpointAnalyzed: false,
      viewpointSkippedReason: `AI 分析失败: ${err.message}`,
    };
  }
}
