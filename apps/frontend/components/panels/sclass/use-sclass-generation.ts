// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * use-sclass-generation.ts — S级 Seedance 2.0 视频生成 Hook
 *
 * 核心功能：
 * 1. generateGroupVideo(group) — 单组生成：收集 @引用 → 构建多模态请求 → 调用 API → 轮询
 * 2. generateAllGroups() — 批量生成：逐组串行，各组独立生成
 * 3. generateSingleShot(sceneId) — 单镜生成（兼容模式）
 * 4. 自动上传 base64/local 图片到 HTTP URL
 * 5. 生成状态实时同步到 sclass-store
 */

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  useSClassStore,
  type ShotGroup,
  type SClassAspectRatio,
  type SClassResolution,
} from "@/stores/sclass-store";
import { useDirectorStore, useActiveDirectorProject, type SplitScene } from "@/stores/director-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { saveVideoLocally, isContentModerationError } from "@/lib/ai/video-generator";
import { aiManager } from "@/lib/ai/ai-manager";
import { runSClassVideoWithKeyRotation } from "./sclass-video-retry";
import { prepareSClassGroupGeneration } from "./sclass-generation-prep";
import {
  createSClassGenerationRecord,
  materializeSClassGenerationReferences,
} from "./sclass-generation-output";
import { runSClassBatchGeneration } from "./sclass-batch-generation";
import type { BatchGenerationProgress, GroupGenerationResult } from "./sclass-generation-types";
import { runSClassSingleShotGeneration } from "./sclass-single-shot-generation";
export type { BatchGenerationProgress, GroupGenerationResult } from "./sclass-generation-types";

// ==================== Types ====================

// ==================== Hook ====================

export function useSClassGeneration() {
  const abortRef = useRef(false);

  // ========== Store access ==========

  const {
    activeProjectId,
    getProjectData,
    updateGroupVideoStatus,
    addGroupHistory,
    updateSingleShotVideo,
    updateShotGroup,
    addShotGroup,
  } = useSClassStore();

  const projectData = useActiveDirectorProject();
  const splitScenes = projectData?.splitScenes || [];
  const characters = useCharacterLibraryStore((s) => s.characters);
  const scenes = useSceneStore((s) => s.scenes);

  // ========== Helpers ==========

  /** 获取组内场景列表 */
  const getGroupScenes = useCallback(
    (group: ShotGroup): SplitScene[] => {
      return group.sceneIds
        .map((id: number) => splitScenes.find((s: SplitScene) => s.id === id))
        .filter(Boolean) as SplitScene[];
    },
    [splitScenes]
  );

  // ========== 单组生成 ==========

  const generateGroupVideo = useCallback(
    async (
      group: ShotGroup,
      options?: {
        /** 进度回调 */
        onProgress?: (progress: number) => void;
        /** 构建完格子图+prompt 后，询问用户是否继续生成视频；返回 false 则中止 */
        confirmBeforeGenerate?: () => Promise<boolean>;
        /** 前组视频 URL（链式重试时传入，用于衔接前后组视频） */
        prevVideoUrl?: string;
      }
    ): Promise<GroupGenerationResult> => {
      const projectId = activeProjectId;
      if (!projectId) {
        return {
          groupId: group.id,
          success: false,
          videoUrl: null,
          error: "无活跃项目",
        };
      }

      // 1. 获取 API 配置
      const featureConfig = aiManager.featureConfig("video_generation");
      if (!featureConfig) {
        const msg = aiManager.featureNotConfiguredMessage("video_generation");
        return {
          groupId: group.id,
          success: false,
          videoUrl: null,
          error: msg,
        };
      }

      const keyManager = featureConfig.keyManager;
      if (!keyManager.getCurrentKey()) {
        return {
          groupId: group.id,
          success: false,
          videoUrl: null,
          error: "请先在设置中配置视频生成 API Key",
        };
      }
      const sclassProjectData = getProjectData(projectId);
      const sclassConfig = sclassProjectData.config;

      // 1b. 从 director-store 直读共享配置（单一数据源，避免双 store 同步问题）
      const directorState = useDirectorStore.getState();
      const directorProject = directorState.projects[directorState.activeProjectId || ''];
      const storyboardConfig = directorProject?.storyboardConfig;
      const aspectRatio = (storyboardConfig?.aspectRatio || '16:9') as SClassAspectRatio;
      const videoResolution = (storyboardConfig?.videoResolution || '720p') as SClassResolution;
      const styleTokens = storyboardConfig?.styleTokens;

      // 2. 获取组内场景
      const groupScenes = getGroupScenes(group);
      if (groupScenes.length === 0) {
        return {
          groupId: group.id,
          success: false,
          videoUrl: null,
          error: "组内无场景",
        };
      }

      // 3. 设置生成中状态
      updateGroupVideoStatus(group.id, {
        videoStatus: "generating",
        videoProgress: 0,
        videoError: null,
      });

      try {
        // 4. 聚合音频/运镜设置、格子图与组级 prompt
        const {
          isExtendOrEdit,
          enableAudio,
          allStaticCamera,
          gridImageRef,
          promptResult,
          prompt,
          duration,
        } = await prepareSClassGroupGeneration({
          group,
          scenes: groupScenes,
          characters,
          sceneLibrary: scenes,
          styleTokens: styleTokens || undefined,
          aspectRatio,
          defaultDuration: sclassConfig.defaultDuration,
          cachedGridUrl: sclassProjectData.lastGridImageUrl,
          cachedSceneIds: sclassProjectData.lastGridSceneIds,
        });

        if (promptResult.refs.overLimit) {
          console.warn(
            "[SClassGen] 素材超限:",
            promptResult.refs.limitWarnings
          );
        }

        // 4d. 保存格子图 + prompt 到 group（用于 UI 预览/复制）
        updateShotGroup(group.id, {
          gridImageUrl: gridImageRef?.localUrl || null,
          lastPrompt: promptResult.prompt || null,
        });

        // 4e. 确认是否继续生成视频（用户可在此处仅预览格子图/prompt 后中止）
        if (options?.confirmBeforeGenerate) {
          const proceed = await options.confirmBeforeGenerate();
          if (!proceed) {
            // 用户取消，重置状态但保留 gridImageUrl + lastPrompt
            updateGroupVideoStatus(group.id, {
              videoStatus: 'idle',
              videoProgress: 0,
            });
            return {
              groupId: group.id,
              success: false,
              videoUrl: null,
              error: null,
            };
          }
        }

        // 5. 收集图片/视频/音频引用并转换为 HTTP URL
        const { imageWithRoles, videoRefUrls, audioRefUrls } = await materializeSClassGenerationReferences({
          imageRefs: promptResult.refs.images,
          videoRefs: promptResult.refs.videos,
          audioRefs: promptResult.refs.audios,
          prevVideoUrl: options?.prevVideoUrl,
          isExtendOrEdit,
        });

        updateGroupVideoStatus(group.id, { videoProgress: 10 });

        // 6. 调用视频生成 API
        console.log("[SClassGen] Generating group video:", {
          groupId: group.id,
          groupName: group.name,
          scenesCount: groupScenes.length,
          promptLength: prompt.length,
          imagesCount: imageWithRoles.length,
          videoRefsCount: videoRefUrls.length,
          audioRefsCount: audioRefUrls.length,
          duration,
          aspectRatio,
          videoResolution,
        });

        const videoUrl = await runSClassVideoWithKeyRotation({
          keyManager,
          label: "Group video",
          context: { groupId: group.id },
          invoke: (currentApiKey) => aiManager.video(
            currentApiKey,
            prompt,
            duration,
            aspectRatio,
            imageWithRoles,
            (progress) => {
              const mappedProgress = 10 + Math.floor(progress * 0.85);
              updateGroupVideoStatus(group.id, { videoProgress: mappedProgress });
              options?.onProgress?.(mappedProgress);
            },
            keyManager,
            featureConfig.platform,
            videoResolution,
            videoRefUrls.length > 0 ? videoRefUrls : undefined,
            audioRefUrls.length > 0 ? audioRefUrls : undefined,
            enableAudio,
            allStaticCamera,
          ),
        });
        // 7. 保存视频到本地
        const localUrl = await saveVideoLocally(
          videoUrl,
          group.sceneIds[0] || 0
        );

        // 8. 更新状态 → 完成
        updateGroupVideoStatus(group.id, {
          videoStatus: "completed",
          videoProgress: 100,
          videoUrl: localUrl,
          videoError: null,
        });

        // 9. 记录历史
        const record = createSClassGenerationRecord({
          group,
          prompt,
          videoUrl: localUrl,
          assetRefs: [
            ...promptResult.refs.images,
            ...promptResult.refs.videos,
            ...promptResult.refs.audios,
          ],
          aspectRatio,
          resolution: videoResolution,
          duration,
        });
        addGroupHistory(group.id, record);

        return {
          groupId: group.id,
          success: true,
          videoUrl: localUrl,
          error: null,
        };
      } catch (error) {
        const err = error as Error;
        const errorMsg = err.message || "视频生成失败";
        const isModeration = isContentModerationError(err);

        console.error("[SClassGen] Group generation failed:", err);

        updateGroupVideoStatus(group.id, {
          videoStatus: "failed",
          videoProgress: 0,
          videoError: isModeration ? `内容审核未通过: ${errorMsg}` : errorMsg,
        });

        return {
          groupId: group.id,
          success: false,
          videoUrl: null,
          error: errorMsg,
        };
      }
    },
    [
      activeProjectId,
      getProjectData,
      getGroupScenes,
      characters,
      scenes,
      updateGroupVideoStatus,
      addGroupHistory,
      updateShotGroup,
      addShotGroup,
    ]
  );

  // ========== 批量生成（逐组串行 + 尾帧传递） ==========

  const generateAllGroups = useCallback(
    async (
      onBatchProgress?: (progress: BatchGenerationProgress) => void
    ): Promise<GroupGenerationResult[]> => {
      const projectId = activeProjectId;
      if (!projectId) {
        toast.error("无活跃项目");
        return [];
      }

      const projectData = getProjectData(projectId);
      abortRef.current = false;
      return runSClassBatchGeneration({
        groups: projectData.shotGroups,
        isAborted: () => abortRef.current,
        generateGroup: generateGroupVideo,
        onBatchProgress,
      });
    },
    [activeProjectId, getProjectData, generateGroupVideo]
  );

  // ========== 单镜生成（兼容模式） ==========

  const generateSingleShot = useCallback(
    async (sceneId: number): Promise<boolean> => {
      const scene = splitScenes.find((s: SplitScene) => s.id === sceneId);
      if (!scene) {
        toast.error("未找到分镜");
        return false;
      }
      return runSClassSingleShotGeneration({ scene, activeProjectId, updateSingleShotVideo });
    },
    [splitScenes, activeProjectId, updateSingleShotVideo]
  );

  // ========== 中止 ==========

  const abortGeneration = useCallback(() => {
    abortRef.current = true;
    toast.info("正在中止生成...");
  }, []);

  // ========== 重试单组 ==========

  const retryGroup = useCallback(
    async (groupId: string): Promise<GroupGenerationResult | null> => {
      const projectId = activeProjectId;
      if (!projectId) return null;

      const projectData = getProjectData(projectId);
      const group = projectData.shotGroups.find((g) => g.id === groupId);
      if (!group) return null;

      // 重置状态
      updateGroupVideoStatus(groupId, {
        videoStatus: "idle",
        videoProgress: 0,
        videoError: null,
      });

      // 查找前组的 videoUrl（链式衔接）
      let prevVideoUrl: string | undefined;
      const allGroups = projectData.shotGroups;
      const idx = allGroups.findIndex(g => g.id === groupId);
      if (idx > 0 && allGroups[idx - 1].videoUrl) {
        prevVideoUrl = allGroups[idx - 1].videoUrl!;
      }

      return generateGroupVideo(group, { prevVideoUrl });
    },
    [activeProjectId, getProjectData, updateGroupVideoStatus, generateGroupVideo]
  );

  // ========== 链式延长 ==========

  /**
   * 基于已完成组创建延长子组并生成视频
   *
   * @param sourceGroupId 来源组 ID（必须已完成且有 videoUrl）
   * @param extendDuration 延长时长 (4-15s)
   * @param direction 延长方向
   * @param description 用户补充描述（可选）
   */
  const generateChainExtension = useCallback(
    async (
      sourceGroupId: string,
      extendDuration: number = 10,
      direction: 'backward' | 'forward' = 'backward',
      description?: string,
    ): Promise<GroupGenerationResult | null> => {
      const projectId = activeProjectId;
      if (!projectId) {
        toast.error('无活跃项目');
        return null;
      }

      const pd = getProjectData(projectId);
      const sourceGroup = pd.shotGroups.find(g => g.id === sourceGroupId);
      if (!sourceGroup || !sourceGroup.videoUrl) {
        toast.error('源组无已完成视频，无法延长');
        return null;
      }

      // 创建延长子组
      const childId = `extend_${Date.now()}_${sourceGroupId.substring(0, 8)}`;
      const childGroup: ShotGroup = {
        id: childId,
        name: `${sourceGroup.name} - 延长`,
        sceneIds: [...sourceGroup.sceneIds],
        sortIndex: sourceGroup.sortIndex + 0.5,
        totalDuration: Math.max(4, Math.min(15, extendDuration)) as ShotGroup["totalDuration"],
        videoStatus: 'idle',
        videoProgress: 0,
        videoUrl: null,
        videoMediaId: null,
        videoError: null,
        gridImageUrl: null,
        lastPrompt: null,
        mergedPrompt: description || sourceGroup.mergedPrompt || "",
        history: [],
        imageRefs: [],
        videoRefs: [],
        audioRefs: [],
        generationType: 'extend',
        extendDirection: direction,
        sourceGroupId,
        sourceVideoUrl: sourceGroup.videoUrl || undefined,
      };

      addShotGroup(childGroup);
      toast.info(`已创建延长子组「${childGroup.name}」`);

      return generateGroupVideo(childGroup);
    },
    [activeProjectId, getProjectData, addShotGroup, generateGroupVideo]
  );

  return {
    generateGroupVideo,
    generateAllGroups,
    generateSingleShot,
    abortGeneration,
    retryGroup,
    generateChainExtension,
  };
}
