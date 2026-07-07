import { useCallback, useState } from "react";
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
  generateAsset,
} from "@/lib/studio/asset-generation-orchestrator";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { eventBus } from "@/lib/event-bus";
import type { EntityExtractionResult, ScriptPlan } from "@/types/studio";
import type { StudioAssetSummary, StudioAssetKind } from "@/types/studio-assets";
import { toast } from "sonner";
import {
  assetLibraryRowKey,
  findPlanForEpisode,
  getRowDescription,
  getRowImage,
  getRowPrompt,
  toGenerationTask,
  toRuntimeAssetType,
  type AssetGenerationType,
  type AssetRow,
} from "./script-asset-generation-model";
import { getAbsoluteImagePath } from "@/lib/image-storage";

export function useScriptAssetGenerationActions({
  activeType,
  visualManualId,
  currentRows,
  activeProjectId,
  scriptPlans,
  productionEpisodeId,
  entityExtractions,
  onAssetStored,
}: {
  activeType: AssetGenerationType;
  visualManualId: string | undefined;
  currentRows: AssetRow[];
  activeProjectId: string | null;
  scriptPlans: ScriptPlan[];
  productionEpisodeId: string;
  entityExtractions: EntityExtractionResult[];
  onAssetStored?: (row: AssetRow, asset: StudioAssetSummary) => void;
}) {
  const [selectedAsset, setSelectedAsset] = useState<StudioAssetSummary | null>(null);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [notFoundAsset, setNotFoundAsset] = useState<AssetRow | null>(null);
  const [isGeneratingSingle, setIsGeneratingSingle] = useState(false);
  const [isAutoAssigningAudio, setIsAutoAssigningAudio] = useState(false);
  const [storingAssetKey, setStoringAssetKey] = useState<string | null>(null);
  const materials = useStudioStore((state) => state.materials);
  const setTtsActiveProjectId = useTtsStore((state) => state.setActiveProjectId);
  const createVoiceProfile = useTtsStore((state) => state.createVoiceProfile);
  const bindSpeaker = useTtsStore((state) => state.bindSpeaker);

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
      batch.props.map((item) => ({ id: item.assetId, name: item.name })),
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
    if (row.assetLibrary) {
      setSelectedAsset(row.assetLibrary);
      setAssetDialogOpen(true);
      return;
    }
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
      setNotFoundAsset(row);
    } catch {
      toast.error("查询资产库失败");
    }
  }, []);

  const handleStoreInAssetLibrary = useCallback(async (row: AssetRow) => {
    if (row.assetLibrary) return;
    if (!window.studioAssets?.add) {
      toast.error("资产库接口仅在桌面应用中可用");
      return;
    }

    const key = assetLibraryRowKey(row);
    setStoringAssetKey(key);
    try {
      const storedAsset = await storeRowInAssetLibrary(row);
      if (storedAsset) {
        onAssetStored?.(row, storedAsset.asset);
        notifyAssetLibraryUpdated(storedAsset.asset);
        if (storedAsset.status === "existing") {
          toast.info(`资产库已存在：${row.name}`);
        } else {
          toast.success(`已放入资产库：${row.name}`);
        }
        return;
      }
      const existing = await window.studioAssets.getByName?.({
        type: toRuntimeAssetType(row.type),
        name: row.name,
      });
      if (existing) {
        onAssetStored?.(row, existing);
        notifyAssetLibraryUpdated(existing);
        toast.info(`资产库已存在：${row.name}`);
        return;
      }
      toast.error(`「${row.name}」放入资产库失败`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "放入资产库失败");
    } finally {
      setStoringAssetKey(null);
    }
  }, [onAssetStored]);

  const handleGenerateSingle = useCallback(async () => {
    if (!notFoundAsset) return;
    if (!visualManualId) {
      toast.error("请先在「风格与导演」中选择视觉手册");
      return;
    }
    setIsGeneratingSingle(true);
    try {
      const localRow = ensureLocalAssetForRow(notFoundAsset, {
        activeProjectId,
        productionEpisodeId,
      });
      const task = toGenerationTask(localRow, visualManualId, activeProjectId);
      if (!task) {
        toast.error(`「${notFoundAsset.name}」缺少可生成的本地资产`);
        return;
      }
      const result = await generateAsset(task);
      if (result.phase !== "done") {
        toast.error(`「${notFoundAsset.name}」生成失败：${result.error ?? "未知错误"}`);
        return;
      }
      toast.success(`「${notFoundAsset.name}」资产生成成功`);
      setNotFoundAsset(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsGeneratingSingle(false);
    }
  }, [activeProjectId, notFoundAsset, onAssetStored, productionEpisodeId, visualManualId]);

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
    isGeneratingSingle,
    isAutoAssigningAudio,
    storingAssetKey,
    selectedAsset,
    setSelectedAsset,
    assetDialogOpen,
    setAssetDialogOpen,
    notFoundAsset,
    setNotFoundAsset,
    handleDeriveAssets,
    handleOpenAsset,
    handleGenerateSingle,
    handleAutoAssignAudio,
    handleStoreInAssetLibrary,
  };
}

function notifyAssetLibraryUpdated(asset: StudioAssetSummary) {
  eventBus.emit("asset:updated", { id: asset.id, type: asset.type });
}

async function toAssetLibraryAddPayload(row: AssetRow) {
  const image = getRowImage(row);
  const sourceFilePath = await resolveAssetSourceFilePath(image);
  const description = getRowDescription(row) || row.note || row.name;
  const prompt = getRowPrompt(row) || description;
  const setting = getAssetLibrarySetting(row);
  return {
    type: toRuntimeAssetType(row.type),
    name: row.name,
    ...(sourceFilePath ? { sourceFilePath } : {}),
    description,
    prompt,
    setting,
  };
}

async function storeRowInAssetLibrary(
  row: AssetRow,
): Promise<{ status: "existing" | "created"; asset: StudioAssetSummary } | null> {
  if (!window.studioAssets?.add) return null;
  const existing = await window.studioAssets.getByName?.({
    type: toRuntimeAssetType(row.type),
    name: row.name,
  });
  if (existing) return { status: "existing", asset: existing };
  const created = await window.studioAssets.add(await toAssetLibraryAddPayload(row));
  return created ? { status: "created", asset: created } : null;
}

function ensureLocalAssetForRow(
  row: AssetRow,
  {
    activeProjectId,
    productionEpisodeId,
  }: {
    activeProjectId: string | null;
    productionEpisodeId: string;
  },
): AssetRow {
  if (row.asset) return row;

  if (row.type === "character") {
    const store = useCharacterLibraryStore.getState();
    const existing = store.characters.find(
      (item) => item.name === row.name && (!activeProjectId || item.projectId === activeProjectId),
    );
    const id = existing?.id ?? store.addCharacter({
      name: row.name,
      description: row.note || row.name,
      visualTraits: "",
      projectId: activeProjectId ?? undefined,
      notes: row.note,
      status: "linked",
      linkedEpisodeId: productionEpisodeId,
      views: [],
    });
    const asset = useCharacterLibraryStore.getState().getCharacterById(id);
    return asset ? { ...row, id: asset.id, asset } : row;
  }

  if (row.type === "scene") {
    const store = useSceneStore.getState();
    const existing = store.scenes.find(
      (item) => item.name === row.name && (!activeProjectId || item.projectId === activeProjectId),
    );
    const id = existing?.id ?? store.addScene({
      name: row.name,
      location: row.note || row.name,
      time: "",
      atmosphere: row.note || "",
      projectId: activeProjectId ?? undefined,
      notes: row.note,
      status: "linked",
      linkedEpisodeId: productionEpisodeId,
    });
    const asset = useSceneStore.getState().getSceneById(id);
    return asset ? { ...row, id: asset.id, asset } : row;
  }

  const store = usePropsLibraryStore.getState();
  const existing = store.items.find(
    (item) =>
      item.name === row.name &&
      (!activeProjectId || item.projectId === activeProjectId),
  );
  const asset = existing ?? store.addProp({
    name: row.name,
    projectId: activeProjectId ?? undefined,
    description: row.note || row.name,
    visualPrompt: "",
    imageUrl: "",
    folderId: null,
  });
  return { ...row, id: asset.id, asset };
}

function resolveLatestAssetRow(row: AssetRow): AssetRow {
  if (!row.asset) return row;
  if (row.type === "character") {
    const asset = useCharacterLibraryStore.getState().getCharacterById(row.asset.id);
    return asset ? { ...row, asset } : row;
  }
  if (row.type === "scene") {
    const asset = useSceneStore.getState().getSceneById(row.asset.id);
    return asset ? { ...row, asset } : row;
  }
  const asset = usePropsLibraryStore.getState().getPropById(row.asset.id);
  return asset ? { ...row, asset } : row;
}

async function resolveAssetSourceFilePath(image?: string) {
  if (!image) return undefined;
  if (image.startsWith("local-image://")) {
    return (await getAbsoluteImagePath(image)) ?? undefined;
  }
  if (image.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(image).pathname);
    } catch {
      return undefined;
    }
  }
  if (image.startsWith("/")) return image;
  return undefined;
}

function getAssetLibrarySetting(row: AssetRow) {
  if (row.note) return row.note;
  if (row.type === "character") {
    const character = row.asset;
    return [
      character?.role,
      character?.traits,
      character?.personality,
      character?.notes,
    ].filter(Boolean).join("。");
  }
  if (row.type === "scene") {
    const scene = row.asset;
    return [
      scene?.location,
      scene?.time,
      scene?.atmosphere,
      scene?.notes,
    ].filter(Boolean).join("。");
  }
  const prop = row.asset;
  return prop?.category ?? "";
}

function toRoleAssetSummary(row: AssetRow): StudioAssetSummary | null {
  if (row.type !== "character") return null;
  if (row.assetLibrary?.type === "role") return row.assetLibrary;
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
