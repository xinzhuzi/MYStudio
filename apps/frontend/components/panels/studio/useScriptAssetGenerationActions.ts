import { useCallback, useState } from "react";
import type { RoleVoiceAssignableCharacter } from "@/components/panels/assets/RoleVoiceAssignDialog";
import {
  assignAudioToRoles,
  buildRoleAudioCandidates,
  createRoleAudioVoiceProfileInput,
} from "@/components/panels/assets/role-audio-auto-assign";
import {
  buildEntityResolver,
  createMystudioDerivedSinks,
  syncDerivedAssets,
} from "@/lib/studio/derived-asset-sync";
import {
  batchGenerateAssets,
  generateAsset,
  polishAssetsAndUpdateStore,
  type AssetGenerationTask,
} from "@/lib/studio/asset-generation-orchestrator";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import type { EntityExtractionResult, ScriptPlan } from "@/types/studio";
import type { StudioAssetSummary, StudioAssetKind } from "@/types/studio-assets";
import { toast } from "sonner";
import {
  findPlanForEpisode,
  toGenerationTask,
  toRuntimeAssetType,
  type AssetGenerationType,
  type AssetRow,
} from "./script-asset-generation-model";

type Progress = { done: number; total: number };

export function useScriptAssetGenerationActions({
  activeType,
  visualManualId,
  currentRows,
  activeProjectId,
  scriptPlans,
  productionEpisodeId,
  entityExtractions,
}: {
  activeType: AssetGenerationType;
  visualManualId: string | undefined;
  currentRows: AssetRow[];
  activeProjectId: string | null;
  scriptPlans: ScriptPlan[];
  productionEpisodeId: string;
  entityExtractions: EntityExtractionResult[];
}) {
  const [isPolishing, setIsPolishing] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0 });
  const [selectedAsset, setSelectedAsset] = useState<StudioAssetSummary | null>(null);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [voiceDialogChar, setVoiceDialogChar] =
    useState<RoleVoiceAssignableCharacter | null>(null);
  const [notFoundAsset, setNotFoundAsset] = useState<{
    name: string;
    type: AssetGenerationType;
  } | null>(null);
  const [isGeneratingSingle, setIsGeneratingSingle] = useState(false);
  const [isAutoAssigningAudio, setIsAutoAssigningAudio] = useState(false);
  const materials = useStudioStore((state) => state.materials);
  const setTtsActiveProjectId = useTtsStore((state) => state.setActiveProjectId);
  const createVoiceProfile = useTtsStore((state) => state.createVoiceProfile);
  const bindSpeaker = useTtsStore((state) => state.bindSpeaker);

  const handlePolishAll = useCallback(async () => {
    if (!visualManualId) {
      toast.error("请先在「风格与导演」中选择视觉手册");
      return;
    }
    setIsPolishing(true);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await polishAssetsAndUpdateStore(activeType, visualManualId, {
        concurrency: 3,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (result.failed) {
        toast.warning(`提示词处理完成：${result.success} 成功，${result.failed} 失败`);
      } else {
        toast.success(`提示词处理完成：${result.success} 个资产已就绪`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提示词润色失败");
    } finally {
      setIsPolishing(false);
    }
  }, [activeType, visualManualId]);

  const handleGenerateImages = useCallback(async () => {
    if (!visualManualId) {
      toast.error("请先在「风格与导演」中选择视觉手册");
      return;
    }
    const tasks = currentRows
      .map((row) => toGenerationTask(row, visualManualId))
      .filter((task): task is AssetGenerationTask => Boolean(task));
    if (!tasks.length) {
      toast.info("当前分类没有可生成图片的资产");
      return;
    }

    setIsGeneratingImages(true);
    setProgress({ done: 0, total: tasks.length });
    try {
      const results = await batchGenerateAssets(tasks, {
        concurrency: 1,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const success = [...results.values()].filter(
        (result) => result.phase === "done",
      ).length;
      const failed = results.size - success;
      if (failed) {
        toast.warning(`图片生成完成：${success} 成功，${failed} 失败`);
      } else {
        toast.success(`图片生成完成：${success} 个资产已就绪`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败");
    } finally {
      setIsGeneratingImages(false);
    }
  }, [currentRows, visualManualId]);

  const handleDeriveAssets = useCallback(() => {
    const projectId = activeProjectId;
    if (!projectId) {
      toast.error("未选择项目，无法落地衍生资产");
      return;
    }
    const plan = findPlanForEpisode(scriptPlans, productionEpisodeId);
    if (!plan) {
      toast.error("尚无导演规划：请先到「分镜视频生成」完成导演规划节点");
      return;
    }
    const batch =
      entityExtractions.find((item) => item.episodeId === plan.episodeId) ??
      entityExtractions[0];
    if (!batch) {
      toast.error("尚无实体库：请先在「剧本资产管理」完成资产提取");
      return;
    }

    const resolver = buildEntityResolver(
      batch.characters.map((item) => ({
        id: item.characterId,
        name: item.name,
        aliases: item.aliases,
      })),
      batch.scenes.map((item) => ({ id: item.sceneId, name: item.name })),
    );
    const { summary } = syncDerivedAssets(plan.derivedAssetPlan, {
      projectId,
      resolver,
      ...createMystudioDerivedSinks(),
    });
    if (summary.skipped) {
      toast.warning(
        `衍生资产落地 ${summary.created} 条，跳过 ${summary.skipped} 条（父资产未匹配）`,
      );
    } else {
      toast.success(`衍生资产已落地 ${summary.created} 条`);
    }
  }, [activeProjectId, entityExtractions, productionEpisodeId, scriptPlans]);

  const handleOpenAsset = useCallback(async (row: AssetRow) => {
    try {
      const asset = await window.studioAssets?.getByName({
        type: toRuntimeAssetType(row.type),
        name: row.name,
      });
      if (asset) {
        setSelectedAsset(asset);
        setAssetDialogOpen(true);
        return;
      }
      setNotFoundAsset({ name: row.name, type: row.type });
    } catch {
      toast.error("查询资产库失败");
    }
  }, []);

  const handleGenerateSingle = useCallback(async () => {
    if (!notFoundAsset) return;
    if (!visualManualId) {
      toast.error("请先在「风格与导演」中选择视觉手册");
      return;
    }
    setIsGeneratingSingle(true);
    try {
      const result = await generateAsset({
        assetId: `single_${Date.now()}`,
        name: notFoundAsset.name,
        assetType: notFoundAsset.type,
        description: "",
        isDerivative: false,
        visualManualId,
        skipPolish: false,
      });
      if (result.phase !== "done") {
        toast.error(`「${notFoundAsset.name}」生成失败：${result.error ?? "未知错误"}`);
        return;
      }
      toast.success(`「${notFoundAsset.name}」资产生成成功`);
      const asset = await window.studioAssets?.getByName({
        type: toRuntimeAssetType(notFoundAsset.type),
        name: notFoundAsset.name,
      });
      setNotFoundAsset(null);
      if (asset) {
        setSelectedAsset(asset);
        setAssetDialogOpen(true);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsGeneratingSingle(false);
    }
  }, [notFoundAsset, visualManualId]);

  const handleAutoAssignAudio = useCallback(async () => {
    if (activeType !== "character") return;
    if (!activeProjectId) {
      toast.error("未选择项目，无法写入音色绑定");
      return;
    }
    if (!window.studioAssets?.list) {
      toast.error("素材读取接口仅在桌面应用中可用");
      return;
    }

    const roles = currentRows
      .map(toRoleAssetSummary)
      .filter((item): item is StudioAssetSummary => Boolean(item));
    if (!roles.length) {
      toast.info("当前角色尚未落地到资产库，请先完成角色资产生成");
      return;
    }

    setIsAutoAssigningAudio(true);
    try {
      const audioResult = await window.studioAssets.list({
        type: "audio",
        limit: 9999,
      });
      const candidates = buildRoleAudioCandidates(
        materials,
        audioResult.items ?? [],
      );
      if (!candidates.length) {
        toast.error("音频库暂无可用于克隆的音色音频");
        return;
      }
      const assignments = assignAudioToRoles(roles, candidates);
      if (!assignments.length) {
        toast.error("没有生成可写入的音色分配");
        return;
      }

      setTtsActiveProjectId(activeProjectId);
      for (const assignment of assignments) {
        const draft = createRoleAudioVoiceProfileInput(assignment);
        const profile = createVoiceProfile(draft.profile);
        bindSpeaker({
          ...draft.binding,
          profileId: profile.id,
        });
      }
      toast.success(
        `已为 ${assignments.length} 个角色自动分配音频（本地规则）`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "自动分配音频失败");
    } finally {
      setIsAutoAssigningAudio(false);
    }
  }, [
    activeProjectId,
    activeType,
    bindSpeaker,
    createVoiceProfile,
    currentRows,
    materials,
    setTtsActiveProjectId,
  ]);

  return {
    isPolishing,
    isGeneratingImages,
    isGeneratingSingle,
    isAutoAssigningAudio,
    progress,
    selectedAsset,
    setSelectedAsset,
    assetDialogOpen,
    setAssetDialogOpen,
    voiceDialogChar,
    setVoiceDialogChar,
    notFoundAsset,
    setNotFoundAsset,
    handlePolishAll,
    handleGenerateImages,
    handleDeriveAssets,
    handleOpenAsset,
    handleGenerateSingle,
    handleAutoAssignAudio,
  };
}

function toRoleAssetSummary(row: AssetRow): StudioAssetSummary | null {
  if (row.type !== "character") return null;
  const character = row.asset;
  const fields = [
    character?.description,
    character?.role,
    character?.traits,
    character?.gender ? `性别：${character.gender}` : "",
    character?.age ? `年龄：${character.age}` : "",
    character?.personality,
    character?.notes,
    row.note,
  ].filter(Boolean).join("。");
  return {
    id: character?.id ?? row.id,
    source: "manying-local",
    type: "role" satisfies StudioAssetKind,
    name: character?.name ?? row.name,
    description: fields,
    setting: fields,
    prompt: character?.visualTraits || character?.description || row.note,
    thumbnailUrl: character?.thumbnailUrl || character?.views?.[0]?.imageUrl,
    tags: character?.tags,
  };
}
