import type {
  EpisodeRawScript,
  ProjectBackground,
  PromptLanguage,
  ScriptData,
} from "@/types/script";
import { useScriptStore } from "@/stores/script-store";
import { convertToScriptData, parseFullScript } from "./episode-parser";
import {
  analyzeScriptStructureWithAI,
  applyAIAnalysis,
  normalizeScriptFormat,
  preprocessLineBreaks,
} from "./script-normalizer";
import { populateSeriesMetaFromImport } from "./series-meta-sync";
import { exportProjectMetadata } from "./episode-synopsis-service";

export interface ImportResult {
  success: boolean;
  background: ProjectBackground | null;
  projectBackground?: ProjectBackground;
  episodes: EpisodeRawScript[];
  scriptData: ScriptData | null;
  error?: string;
}

export async function importFullScript(
  fullText: string,
  projectId: string,
  importSettings?: { styleId?: string; promptLanguage?: PromptLanguage },
): Promise<ImportResult> {
  try {
    const processedText = preprocessLineBreaks(fullText).text;
    const aiAnalysis = await analyzeScriptStructureWithAI(processedText);
    const normalizeResult = aiAnalysis
      ? applyAIAnalysis(processedText, aiAnalysis)
      : normalizeScriptFormat(processedText);

    if (aiAnalysis) {
      console.log("[importFullScript] AI 结构检测完成:", normalizeResult.changes);
    } else if (normalizeResult.changes.length > 0) {
      console.log("[importFullScript] 正则兜底归一化:", normalizeResult.changes);
    }

    const { background, episodes } = parseFullScript(normalizeResult.normalized);
    if (episodes.length === 0) {
      return {
        success: false,
        background: null,
        episodes: [],
        scriptData: null,
        error: "未能解析出任何集数，请检查剧本格式",
      };
    }

    if (normalizeResult.aiAnalysis?.era) background.era = normalizeResult.aiAnalysis.era;
    if (normalizeResult.aiAnalysis?.genre) background.genre = normalizeResult.aiAnalysis.genre;

    const scriptData = convertToScriptData(background, episodes);
    const store = useScriptStore.getState();
    store.setProjectBackground(projectId, background);
    store.setEpisodeRawScripts(projectId, episodes);
    store.setScriptData(projectId, scriptData);
    store.setRawScript(projectId, fullText);
    store.setParseStatus(projectId, "ready");

    const seriesMeta = populateSeriesMetaFromImport(
      background,
      scriptData,
      normalizeResult.aiAnalysis || null,
      importSettings,
    );
    store.setSeriesMeta(projectId, seriesMeta);
    const metadataMd = exportProjectMetadata(projectId);
    store.setMetadataMarkdown(projectId, metadataMd);
    console.log("[importFullScript] 元数据已自动生成，长度:", metadataMd.length);

    return {
      success: true,
      background,
      projectBackground: background,
      episodes,
      scriptData,
    };
  } catch (error) {
    console.error("Import error:", error);
    return {
      success: false,
      background: null,
      episodes: [],
      scriptData: null,
      error: error instanceof Error ? error.message : "导入失败",
    };
  }
}
