import { useCallback, useRef, useState } from "react";
import type { ContinuityAssetVersion, StoryboardItem, StoryboardTtsJobV1 } from "@/types/studio";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { buildRemotionShotPlans } from "@/lib/studio/remotion/remotion-shot-plan-builder";
import { createReadyShotJob } from "@/lib/studio/remotion/remotion-job-factory";
import { DEFAULT_REMOTION_RENDER_SETTINGS } from "@/lib/studio/remotion/remotion-workspace-storage";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import {
  createStoryboardAudioRefFromBinding,
  createStoryboardTtsInputFingerprint,
  createStoryboardVoiceBinding,
} from "@/lib/studio/storyboard-tts-runner";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";

export interface FirstShotPreviewActionsInput {
  projectId?: string;
  chapterId: string;
  storyboards: StoryboardItem[];
  continuityAssetVersions?: ContinuityAssetVersion[];
}

export interface FirstShotPreviewActions {
  busy: boolean;
  error?: string;
  generateFirstShotPreview: () => Promise<RemotionRenderJobV1 | undefined>;
}

/** Select the first storyboard without inferring identity from array order. */
export function selectFirstStoryboard(
  storyboards: readonly StoryboardItem[],
  chapterId: string,
): StoryboardItem | undefined {
  return storyboards
    .filter((storyboard) => storyboard.episodeId === chapterId)
    .slice()
    .sort((left, right) => left.index - right.index)[0];
}

/**
 * Renderer-side action for the in-app first-shot preview.
 *
 * The queue remains the only render entry. This hook only compiles the current
 * first storyboard into a landscape shot plan and exposes a visible error when
 * the plan or desktop bridge is not available.
 */
export function useFirstShotPreviewActions(
  input: FirstShotPreviewActionsInput,
): FirstShotPreviewActions {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const currentScope = useRef({ projectId: input.projectId, chapterId: input.chapterId });
  currentScope.current = { projectId: input.projectId, chapterId: input.chapterId };

  const generateFirstShotPreview = useCallback(async () => {
    if (busy) return undefined;
    const projectId = input.projectId;
    const chapterId = input.chapterId;
    const firstStoryboard = selectFirstStoryboard(input.storyboards, chapterId);
    if (!projectId) return fail(setError, "请先选择项目，再生成首镜预览");
    if (!firstStoryboard) return fail(setError, "当前章节没有可生成的首个分镜");
    if (firstStoryboard.index !== 1) return fail(setError, "当前章节缺少 index=1 的首镜分镜");

    const capturedProjectId = projectId;
    const capturedChapterId = chapterId;
    setBusy(true);
    setError(undefined);
    try {
      assertScopeStillActive(capturedProjectId, capturedChapterId, currentScope.current);
      const runtime = await window.remotionRuntime?.workspaceRuntime?.();
      const queue = window.remotionQueue;
      if (!runtime || !queue?.enqueueShot) {
        throw new Error("Remotion workspace runtime 或持久队列接口不可用");
      }
      assertScopeStillActive(capturedProjectId, capturedChapterId, currentScope.current);

      let chapterRevision = 1;
      const manifestBridge = window.remotionChapterManifest;
      if (manifestBridge?.read) {
        const reply = await manifestBridge.read({ projectId: capturedProjectId, chapterId: capturedChapterId });
        assertScopeStillActive(capturedProjectId, capturedChapterId, currentScope.current);
        if (reply.status === "ready") chapterRevision = Math.max(1, reply.manifest.revision);
      }
      const normalizedStoryboard = await normalizeLegacyFirstShotAudio({
        projectId: capturedProjectId,
        chapterId: capturedChapterId,
        storyboard: firstStoryboard,
        manifestBridge,
        assertActive: () => assertScopeStillActive(
          capturedProjectId,
          capturedChapterId,
          currentScope.current,
        ),
      });

      const plans = await buildRemotionShotPlans({
        projectId: capturedProjectId,
        chapterId: capturedChapterId,
        chapterRevision,
        renderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
        storyboards: [normalizedStoryboard],
        requireHumanApproval: true,
        continuityPolicy: "required",
        assetVersions: input.continuityAssetVersions,
      });
      assertScopeStillActive(capturedProjectId, capturedChapterId, currentScope.current);
      if (!plans.success) {
        throw new Error(plans.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
      }
      const plan = plans.plans[0];
      if (!plan) throw new Error("首镜 plan 为空，已停止提交");

      const job = await createReadyShotJob({
        plan,
        bundleContentHash: runtime.bundleContentHash,
        templateVersion: runtime.templateVersion,
        remotionVersion: runtime.remotionVersion,
      });
      assertScopeStillActive(capturedProjectId, capturedChapterId, currentScope.current);
      const result = await queue.enqueueShot({ job, plan });
      if (result.accepted || result.reason === "already-succeeded" || result.reason === "duplicate-active") {
        return result.job;
      }
      throw new Error("message" in result ? result.message : "首镜 Remotion 队列拒绝了渲染请求");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [busy, input]);

  return { busy, error, generateFirstShotPreview };
}

function assertScopeStillActive(
  projectId: string,
  chapterId: string,
  currentScope: { projectId?: string; chapterId: string },
) {
  if (useProjectStore.getState().activeProjectId !== projectId) {
    throw new Error("项目已切换，首镜预览已停止提交");
  }
  if (currentScope.projectId !== projectId || currentScope.chapterId !== chapterId) {
    throw new Error("章节已切换，首镜预览已停止提交");
  }
}

async function normalizeLegacyFirstShotAudio(input: {
  projectId: string;
  chapterId: string;
  storyboard: StoryboardItem;
  manifestBridge: Window["remotionChapterManifest"];
  assertActive: () => void;
}): Promise<StoryboardItem> {
  const audioRef = input.storyboard.audioRef;
  const isAbsoluteLegacyAudio = audioRef?.kind === "audio"
    && audioRef.path.startsWith("/")
    && !audioRef.contentSha256;
  if (!isAbsoluteLegacyAudio) return input.storyboard;

  const voiceBindings = input.storyboard.shotAudioBindings?.filter((binding) => binding.role === "voice") ?? [];
  if (voiceBindings.length > 0 || input.storyboard.ttsJob) {
    throw new Error("首镜旧音频 canonical 状态不完整，已停止自动迁移");
  }
  const importAudio = input.manifestBridge?.importAudio;
  if (!importAudio) throw new Error("Remotion 音频导入 bridge 不可用，已停止首镜提交");
  const speakerId = input.storyboard.speakerId;
  if (!speakerId || input.storyboard.requiresFixedVoice !== true || !input.storyboard.ttsSpokenText?.trim()) {
    throw new Error("首镜旧音频缺少 canonical speaker、口播文本或固定音色约束");
  }
  const backend = input.storyboard.ttsBackend?.trim();
  if (!backend || /mock|fallback|system-voice|silent/i.test(backend)) {
    throw new Error("首镜旧音频缺少可验证的真实 TTS backend");
  }
  const ttsState = useTtsStore.getState();
  const voiceBinding = ttsState.projects[input.projectId]?.bindings[speakerId];
  const profile = voiceBinding ? ttsState.voiceProfiles[voiceBinding.profileId] : undefined;
  if (!profile) throw new Error(`speaker ${speakerId} 缺少固定 profile`);
  if (input.storyboard.voiceProfileId && input.storyboard.voiceProfileId !== profile.id) {
    throw new Error("首镜 voiceProfileId 与当前 speaker binding 不一致");
  }

  input.assertActive();
  const imported = await importAudio({
    projectId: input.projectId,
    chapterId: input.chapterId,
    shotId: input.storyboard.id,
    role: "voice",
    sourcePath: audioRef.path,
  });
  input.assertActive();
  const baseInputFingerprint = await createStoryboardTtsInputFingerprint({
    projectId: input.projectId,
    chapterId: input.chapterId,
    storyboard: input.storyboard,
    profile,
  });
  const inputFingerprint = await sha256CanonicalJson({
    schemaVersion: 1,
    kind: "legacy-storyboard-audio-import",
    baseInputFingerprint,
    audioContentSha256: imported.source.contentSha256,
  });
  const shotRevision = Math.max(1, input.storyboard.outputVersion ?? 1);
  const binding = await createStoryboardVoiceBinding({
    projectId: input.projectId,
    chapterId: input.chapterId,
    storyboard: input.storyboard,
    shotRevision,
    inputFingerprint,
    imported,
  });
  const now = Date.now();
  const generationId = `legacy-import:${imported.source.contentSha256}`;
  const ttsJob: StoryboardTtsJobV1 = {
    schemaVersion: 1,
    projectId: input.projectId,
    chapterId: input.chapterId,
    shotId: input.storyboard.id,
    shotRevision,
    inputFingerprint,
    status: "completed",
    attempt: 1,
    generationId,
    emotionCapability: input.storyboard.ttsEmotionCapability ?? "metadata-only",
    createdAt: now,
    updatedAt: now,
  };
  const updates = {
    audioRef: createStoryboardAudioRefFromBinding(binding),
    shotAudioBindings: [
      ...(input.storyboard.shotAudioBindings?.filter((item) => item.role !== "voice") ?? []),
      binding,
    ],
    ttsJob,
    ttsGenerationId: generationId,
    ttsBackend: backend,
    ttsMocked: false,
    ttsEmotionCapability: ttsJob.emotionCapability,
    ttsWarning: input.storyboard.ttsWarning,
  };

  input.assertActive();
  const store = useStudioStore.getState();
  const current = store.storyboards.find((item) => item.id === input.storyboard.id);
  if (!current || current.episodeId !== input.chapterId
    || Math.max(1, current.outputVersion ?? 1) !== shotRevision
    || current.audioRef?.path !== audioRef.path) {
    throw new Error("首镜数据已变化，旧音频迁移已停止");
  }
  store.writeStoryboardAudio(input.storyboard.id, updates);
  return { ...input.storyboard, ...updates };
}

function fail(setError: (value: string) => void, message: string): undefined {
  setError(message);
  return undefined;
}
