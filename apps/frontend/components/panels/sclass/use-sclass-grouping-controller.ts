import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { Character } from "@/stores/character-library-store";
import type { SplitScene } from "@/stores/director-store";
import type { Scene } from "@/stores/scene-store";
import { useSClassStore, useShotGroups, type ShotGroup } from "@/stores/sclass-store";
import { autoGroupScenes, generateGroupName } from "./auto-grouping";
import type { ExtendEditMode } from "./extend-edit-dialog";
import { runBatchCalibration, runCalibration } from "./sclass-calibrator";

type GenerateGroupVideo = (
  group: ShotGroup,
  options?: { confirmBeforeGenerate?: () => Promise<boolean> },
) => Promise<unknown>;

interface UseSClassGroupingControllerOptions {
  splitScenes: SplitScene[];
  allCharacters: Character[];
  sceneLibrary: Scene[];
  generateGroupVideo: GenerateGroupVideo;
  setIsGenerating: (value: boolean) => void;
}

export function useSClassGroupingController({
  splitScenes,
  allCharacters,
  sceneLibrary,
  generateGroupVideo,
  setIsGenerating,
}: UseSClassGroupingControllerOptions) {
  const generationMode = useSClassStore((state) => state.generationMode);
  const setGenerationMode = useSClassStore((state) => state.setGenerationMode);
  const setShotGroups = useSClassStore((state) => state.setShotGroups);
  const setHasAutoGrouped = useSClassStore((state) => state.setHasAutoGrouped);
  const hasAutoGrouped = useSClassStore((state) => {
    if (!state.activeProjectId) return false;
    return state.projects[state.activeProjectId]?.hasAutoGrouped || false;
  });
  const shotGroups = useShotGroups();
  const [extendEditOpen, setExtendEditOpen] = useState(false);
  const [extendEditMode, setExtendEditMode] = useState<ExtendEditMode>("extend");
  const [extendEditSourceGroup, setExtendEditSourceGroup] = useState<ShotGroup | null>(null);
  const sceneMap = useMemo(
    () => new Map(splitScenes.map((scene) => [scene.id, scene])),
    [splitScenes],
  );

  useEffect(() => {
    if (splitScenes.length === 0) return;

    if (!hasAutoGrouped) {
      const groups = autoGroupScenes(splitScenes);
      const named = groups.map((group, index) => ({
        ...group,
        name: generateGroupName(group, splitScenes, index),
      }));
      setShotGroups(named);
      setHasAutoGrouped(true);
      console.log("[SClassScenes] Auto-grouped:", named.length, "groups from", splitScenes.length, "scenes");
      return;
    }

    const assignedIds = new Set(shotGroups.flatMap((group) => group.sceneIds));
    const unassigned = splitScenes.filter((scene) => !assignedIds.has(scene.id));
    if (unassigned.length === 0) return;

    const existingCount = shotGroups.length;
    const namedNew = autoGroupScenes(unassigned).map((group, index) => ({
      ...group,
      name: generateGroupName(group, unassigned, existingCount + index),
    }));
    setShotGroups([...shotGroups, ...namedNew]);
    console.log("[SClassScenes] Incremental grouping:", namedNew.length, "new groups for", unassigned.length, "new scenes");
  }, [hasAutoGrouped, setHasAutoGrouped, setShotGroups, shotGroups, splitScenes]);

  const getGroupScenes = useCallback((groupId: string) => {
    const group = shotGroups.find((item) => item.id === groupId);
    if (!group) return [];
    return group.sceneIds
      .map((id) => sceneMap.get(id))
      .filter((scene): scene is SplitScene => Boolean(scene));
  }, [sceneMap, shotGroups]);

  const batchCalibrate = useCallback(async () => {
    toast.info("开始批量 AI 校准...");
    const { success, total } = await runBatchCalibration(splitScenes, allCharacters, sceneLibrary);
    if (total === 0) toast.info("没有需要校准的组");
    else toast.success(`批量校准完成：${success}/${total} 组成功`);
  }, [allCharacters, sceneLibrary, splitScenes]);

  const regroup = useCallback(() => {
    const groups = autoGroupScenes(splitScenes);
    const named = groups.map((group, index) => ({
      ...group,
      name: generateGroupName(group, splitScenes, index),
    }));
    setShotGroups(named);
    toast.success(`已重新分组：${named.length} 组`);
  }, [setShotGroups, splitScenes]);

  const calibrateGroup = useCallback(async (groupId: string) => {
    const ok = await runCalibration(groupId, getGroupScenes(groupId), allCharacters, sceneLibrary);
    if (ok) toast.success("AI 校准完成");
    else toast.error("AI 校准失败");
  }, [allCharacters, getGroupScenes, sceneLibrary]);

  const generateGroup = useCallback(async (groupId: string) => {
    const group = shotGroups.find((item) => item.id === groupId);
    if (!group) return;
    setIsGenerating(true);
    try {
      await generateGroupVideo(group, {
        confirmBeforeGenerate: async () => window.confirm(
          "格子图和提示词已准备完毕，可在分组卡片中预览和下载。\n\n是否继续调用 API 生成视频？",
        ),
      });
    } finally {
      setIsGenerating(false);
    }
  }, [generateGroupVideo, setIsGenerating, shotGroups]);

  const openExtendEdit = useCallback((groupId: string, mode: ExtendEditMode) => {
    const group = shotGroups.find((item) => item.id === groupId);
    if (!group) return;
    setExtendEditMode(mode);
    setExtendEditSourceGroup(group);
    setExtendEditOpen(true);
  }, [shotGroups]);

  const confirmExtendEdit = useCallback(async (childGroup: ShotGroup) => {
    setIsGenerating(true);
    try {
      await generateGroupVideo(childGroup);
    } finally {
      setIsGenerating(false);
    }
  }, [generateGroupVideo, setIsGenerating]);

  return {
    generationMode,
    setGenerationMode,
    shotGroups,
    sceneMap,
    isBatchCalibrationDisabled: shotGroups.length === 0
      || shotGroups.some((group) => group.calibrationStatus === "calibrating"),
    batchCalibrate,
    regroup,
    calibrateGroup,
    generateGroup,
    openExtendEdit,
    extendEditOpen,
    setExtendEditOpen,
    extendEditMode,
    extendEditSourceGroup,
    confirmExtendEdit,
  };
}
