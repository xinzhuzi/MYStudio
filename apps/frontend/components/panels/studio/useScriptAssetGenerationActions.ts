import { useCallback, useRef, useState } from "react";
import {
  buildRoleAudioCandidates,
  createNarratorVoiceTarget,
  planFixedRoleVoices,
} from "@/components/panels/assets/role-audio-auto-assign";
import {
  buildEntityResolver,
  createMystudioDerivedSinks,
  syncDerivedAssets,
} from "@/lib/studio/derived-asset-sync";
import {
  generateAsset,
} from "@/lib/studio/asset-generation-orchestrator";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { parseAssetNames } from "@/lib/studio/asset-names";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { eventBus } from "@/lib/events/event-bus";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
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
import { getAbsoluteImagePath } from "@/lib/media/image-storage";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";
import type { TtsSpeakerId } from "@/types/tts";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";

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
  // 从角色行打开详情时,收集该资产全部别名对应的角色库条目 id(共享资产如「李先生;管事」
  // 拆开的两行都要接住音色):分配时对这些工作流 speaker 键统一双写
  const [selectedRowLinkedSpeakerIds, setSelectedRowLinkedSpeakerIds] = useState<TtsSpeakerId[]>([]);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [notFoundAsset, setNotFoundAsset] = useState<AssetRow | null>(null);
  // 后台生成中的行 key(同步 ref,不驱动渲染):确认弹窗关闭后生成转后台,
  // 此集合用于拦截同一资产的重复提交(连点/再次打开行时提示而非重复生图)
  const generatingRowKeysRef = useRef(new Set<string>());
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

  /** 资产名全部分隔符别名解析后,收集项目内所有匹配的角色库条目 speaker 键(共享资产拆开也接得住)。 */
  const collectLinkedSpeakerIds = useCallback(
    (asset: StudioAssetSummary | null, fallbackRow?: AssetRow): TtsSpeakerId[] => {
      const names = new Set(parseAssetNames(asset?.name ?? fallbackRow?.name ?? "").allNames);
      const ids = useCharacterLibraryStore
        .getState()
        .characters.filter(
          (character) =>
            (!activeProjectId || character.projectId === activeProjectId) &&
            names.has(character.name.trim()),
        )
        .map((character) => toRoleSpeakerId(character.id));
      if (fallbackRow?.type === "character" && !ids.includes(toRoleSpeakerId(fallbackRow.id))) {
        ids.push(toRoleSpeakerId(fallbackRow.id));
      }
      return ids;
    },
    [activeProjectId],
  );

  const handleOpenAsset = useCallback(async (row: AssetRow) => {
    if (row.assetLibrary) {
      setSelectedRowLinkedSpeakerIds(collectLinkedSpeakerIds(row.assetLibrary, row));
      setSelectedAsset(row.assetLibrary);
      setAssetDialogOpen(true);
      return;
    }
    // 该行生成仍在后台进行:提示进度位置,不再弹「资产未找到」诱导重复提交
    if (generatingRowKeysRef.current.has(assetLibraryRowKey(row))) {
      toast.info(`「${row.name}」正在后台生成中，进度见顶部提示`);
      return;
    }
    try {
      const asset = await getStudioAssetsBridge()?.getByName({
        type: toRuntimeAssetType(row.type),
        name: row.name,
      });
      if (asset) {
        setSelectedRowLinkedSpeakerIds(collectLinkedSpeakerIds(asset, row));
        setSelectedAsset(asset);
        setAssetDialogOpen(true);
        return;
      }
      setNotFoundAsset(row);
    } catch {
      toast.error("查询资产库失败");
    }
  }, [collectLinkedSpeakerIds]);

  const handleStoreInAssetLibrary = useCallback(async (row: AssetRow) => {
    if (row.assetLibrary) return;
    const studioAssets = getStudioAssetsBridge();
    if (!studioAssets?.add) {
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
      const existing = await studioAssets.getByName?.({
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

  // 确认后立即收起弹窗、生成转后台:生图链路在 API 池被其他生成占用时会经历
  // 503 重试/多绑定轮转/长轮询(可达数分钟),若用模态弹窗等它结束会把整个
  // 界面锁死且无法取消。进度与结果一律走 toast,行状态由 store 订阅自动刷新。
  const handleGenerateSingle = useCallback(() => {
    if (!notFoundAsset) return;
    if (!visualManualId) {
      toast.error("请先在「风格与导演」中选择视觉手册");
      return;
    }
    const row = notFoundAsset;
    const rowKey = assetLibraryRowKey(row);
    // 同一资产生成已在后台进行:只收起弹窗,不重复提交(ref 保证连点同步拦截)
    if (generatingRowKeysRef.current.has(rowKey)) {
      setNotFoundAsset(null);
      return;
    }
    setNotFoundAsset(null);
    generatingRowKeysRef.current.add(rowKey);
    const toastId = `script-asset-generate:${rowKey}`;
    toast.loading(`「${row.name}」生成任务已提交...`, { id: toastId });
    void (async () => {
      try {
        const localRow = ensureLocalAssetForRow(row, {
          activeProjectId,
          productionEpisodeId,
        });
        const task = toGenerationTask(localRow, visualManualId, activeProjectId, productionEpisodeId);
        if (!task) {
          toast.error(`「${row.name}」缺少可生成的本地资产`, { id: toastId });
          return;
        }
        const result = await generateAsset(task, (progress) => {
          if (progress.phase === "polishing") {
            toast.loading(`正在润色「${row.name}」的提示词...`, { id: toastId });
          } else if (progress.phase === "generating") {
            toast.loading(`正在生成「${row.name}」的图片...（排队或重试时可能较久，可继续其他操作）`, { id: toastId });
          } else if (progress.phase === "saving") {
            toast.loading(`正在保存「${row.name}」的图片...`, { id: toastId });
          }
        });
        if (result.phase !== "done") {
          toast.error(`「${row.name}」生成失败：${result.error ?? "未知错误"}`, { id: toastId });
          return;
        }
        toast.success(`「${row.name}」资产生成成功`, { id: toastId });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : `「${row.name}」生成失败`,
          { id: toastId },
        );
      } finally {
        generatingRowKeysRef.current.delete(rowKey);
      }
    })();
  }, [activeProjectId, notFoundAsset, productionEpisodeId, visualManualId]);

  const handleAutoAssignAudio = useCallback(async () => {
    if (activeType !== "character") return;
    if (!activeProjectId) {
      toast.error("未选择项目，无法写入音色绑定");
      return;
    }
    const studioAssets = getStudioAssetsBridge();
    if (!studioAssets?.list) {
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
      const audioResult = await studioAssets.list({
        type: "audio",
        limit: 9999,
      });
      const candidates = buildRoleAudioCandidates(
        materials,
        audioResult.items ?? [],
      );
      setTtsActiveProjectId(activeProjectId);
      const ttsState = useTtsStore.getState();
      const ttsProject = ttsState.projects[activeProjectId];
      const plan = await planFixedRoleVoices({
        targets: [
          createNarratorVoiceTarget(),
          ...roles.map((role) => ({
            speakerId: toRoleSpeakerId(role.id),
            role,
          })),
        ],
        candidates,
        narratorVoiceFamily: useStudioStore.getState().workflowConfig.narratorVoiceFamily,
        bindings: ttsProject?.bindings ?? {},
        voiceProfiles: ttsState.voiceProfiles,
        resolveReferenceAudioPath: async (audioPath) =>
          getTtsRuntimeBridge()?.resolveReferenceAudioPath(audioPath) ?? null,
      });
      if (plan.errors.length > 0) {
        throw new Error(plan.errors.map((item) => item.message).join("；"));
      }
      const createdFinalBindings: Array<{ speakerId: string; profileId: string }> = [];
      for (const item of plan.created) {
        const profile = createVoiceProfile(item.draft.profile);
        const binding = { ...item.draft.binding, profileId: profile.id };
        bindSpeaker(binding);
        createdFinalBindings.push({ speakerId: binding.speakerId, profileId: binding.profileId });
      }
      // 同名角色跨 id 复用：直接绑定既有 profile（不重复建档），声音保持固定。
      for (const item of plan.rebound) {
        bindSpeaker(item.binding);
      }
      // 双写镜像(2026-08-22):工作流键(角色库 id)绑定同步到资产库键,角色详情页试听与工作流一致
      const assetSpeakerByCharId = new Map(
        currentRows
          .filter(
            (row) =>
              row.type === "character" &&
              row.id &&
              row.assetLibrary &&
              row.assetLibrary.id !== row.id,
          )
          .map((row) => [row.id, toRoleSpeakerId(row.assetLibrary!.id)] as const),
      );
      const mirrorBindingToAssetKey = (speakerId: string, profileId: string) => {
        const assetSpeakerId = assetSpeakerByCharId.get(speakerId);
        if (!assetSpeakerId) return;
        bindSpeaker({
          speakerId: assetSpeakerId,
          profileId,
          defaultEngine: "qwen",
          defaultModelSize: "1.7B",
        });
      };
      for (const binding of createdFinalBindings) {
        mirrorBindingToAssetKey(binding.speakerId, binding.profileId);
      }
      for (const item of plan.rebound) {
        mirrorBindingToAssetKey(item.binding.speakerId, item.binding.profileId);
      }
      toast.success(
        `固定音色校验完成：复用 ${plan.fixed.length}，跨id续用 ${plan.rebound.length}，新建 ${plan.created.length}`,
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
    isAutoAssigningAudio,
    storingAssetKey,
    selectedAsset,
    setSelectedAsset,
    selectedRowLinkedSpeakerIds,
    setSelectedRowLinkedSpeakerIds,
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
  const studioAssets = getStudioAssetsBridge();
  if (!studioAssets?.add) return null;
  const existing = await studioAssets.getByName?.({
    type: toRuntimeAssetType(row.type),
    name: row.name,
  });
  if (existing) return { status: "existing", asset: existing };
  const created = await studioAssets.add(await toAssetLibraryAddPayload(row));
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


async function resolveAssetSourceFilePath(image?: string) {
  if (!image) return undefined;
  if (image.startsWith("local-image://")) {
    return (await getAbsoluteImagePath(image)) ?? undefined;
  }
  if (image.startsWith("project-file://")) {
    // 生图产物落在项目 workflow-images,经主进程 project-files 桥解析为绝对路径后才能入库拷贝
    return (await getProjectFilesBridge()?.getAbsolutePath(image)) ?? undefined;
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
  const libraryRole = row.assetLibrary?.type === "role" ? row.assetLibrary : undefined;
  const character = row.asset;
  const fields = [
    character?.description,
    character?.role,
    character?.traits,
    character?.gender ? `性别：${character.gender}` : "",
    character?.age ? `年龄：${character.age}` : "",
    character?.personality,
    character?.notes,
    libraryRole?.description,
    libraryRole?.setting,
    row.note,
  ].filter(Boolean).join("。");
  return {
    ...libraryRole,
    id: row.id,
    source: libraryRole?.source ?? "manying-local",
    type: "role" satisfies StudioAssetKind,
    name: character?.name ?? libraryRole?.name ?? row.name,
    description: fields,
    setting: fields,
    prompt: character?.visualTraits || character?.description || libraryRole?.prompt || row.note,
    thumbnailUrl: character?.thumbnailUrl || character?.views?.[0]?.imageUrl || libraryRole?.thumbnailUrl,
    tags: character?.tags ?? libraryRole?.tags,
  };
}
