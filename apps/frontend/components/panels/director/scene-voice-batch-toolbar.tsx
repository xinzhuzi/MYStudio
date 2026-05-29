"use client";

import { useRef, useState } from "react";
import { Loader2, Mic2, RotateCcw, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createBackendVoiceProfile,
  fetchGenerationAudio,
  generateSpeech,
  getGenerationStatus,
  startTtsRuntime,
} from "@/lib/tts/client";
import { validateVoiceProfileForGeneration } from "@/lib/tts/voice-profile-capabilities";
import type { SplitScene } from "@/stores/director-store";
import { useProjectStore } from "@/stores/project-store";
import { useTtsStore } from "@/stores/tts-store";

interface SceneVoiceBatchToolbarProps {
  scenes: SplitScene[];
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function waitForBatchGeneration(generationId: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await getGenerationStatus(generationId);
    if (status.status === "completed") return status;
    if (status.status === "failed") throw new Error(status.error || "口播生成失败");
    await delay(1000);
  }
  throw new Error("口播生成超时");
}

export function SceneVoiceBatchToolbar({ scenes }: SceneVoiceBatchToolbarProps) {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveProjectId = useTtsStore((state) => state.setActiveProjectId);
  const ensureSceneVoiceLine = useTtsStore((state) => state.ensureSceneVoiceLine);
  const selectBatchSceneIds = useTtsStore((state) => state.selectBatchSceneIds);
  const getSceneVoiceLine = useTtsStore((state) => state.getSceneVoiceLine);
  const markGenerating = useTtsStore((state) => state.markGenerating);
  const markCompleted = useTtsStore((state) => state.markCompleted);
  const markFailed = useTtsStore((state) => state.markFailed);
  const voiceProfiles = useTtsStore((state) => state.voiceProfiles);
  const [running, setRunning] = useState<"missing" | "failed" | null>(null);
  const cancelRef = useRef(false);

  const runBatch = async (mode: "missing" | "failed") => {
    if (!activeProjectId) {
      toast.error("当前没有项目");
      return;
    }
    if (!window.studioAssets?.saveMaterial) {
      toast.error("素材保存接口仅在桌面应用中可用");
      return;
    }
    setActiveProjectId(activeProjectId);
    scenes.forEach((scene) => ensureSceneVoiceLine({
      sceneId: scene.id,
      dialogue: scene.dialogue || "",
      characterIds: scene.characterIds || [],
    }));
    const targetIds = selectBatchSceneIds(scenes.map((scene) => scene.id), mode);
    if (targetIds.length === 0) {
      toast.info(mode === "missing" ? "没有缺失的口播" : "没有失败项");
      return;
    }

    cancelRef.current = false;
    setRunning(mode);
    let success = 0;
    let failed = 0;
    try {
      const runtime = await startTtsRuntime();
      if (!runtime.success) throw new Error(runtime.error || "TTS 后端启动失败");

      for (const sceneId of targetIds) {
        if (cancelRef.current) break;
        const scene = scenes.find((item) => item.id === sceneId);
        const line = getSceneVoiceLine(sceneId);
        if (!scene || !line) continue;
        const profile = line.profileId ? voiceProfiles[line.profileId] : undefined;
        if (!profile) {
          markFailed(sceneId, "未绑定声线 profile");
          failed += 1;
          continue;
        }
        const validationError = validateVoiceProfileForGeneration(profile);
        if (validationError) {
          markFailed(sceneId, validationError);
          failed += 1;
          continue;
        }
        try {
          await createBackendVoiceProfile(profile);
          const generation = await generateSpeech({
            text: line.text || scene.dialogue || "",
            profileId: profile.id,
            engine: line.engine,
            modelSize: line.modelSize,
            language: profile.language,
          });
          markGenerating(sceneId, generation.id);
          const completed = await waitForBatchGeneration(generation.id);
          const bytes = await fetchGenerationAudio(generation.id);
          const material = await window.studioAssets.saveMaterial({
            name: `scene-${scene.id + 1}-voice-${Date.now()}.wav`,
            bytes,
          });
          if (!material.success || !material.localPath) throw new Error(material.error || "保存音频素材失败");
          markCompleted(sceneId, {
            audioLocalPath: material.localPath,
            audioMaterialId: material.filePath || material.localPath,
            audioFilePath: material.filePath,
            ttsBackend: completed.backend,
            mocked: typeof completed.mocked === "number" ? completed.mocked === 1 : completed.mocked,
            warning: completed.warning,
          });
          success += 1;
        } catch (error) {
          markFailed(sceneId, error instanceof Error ? error.message : "口播生成失败");
          failed += 1;
        }
      }
      toast.success(`口播批量完成：成功 ${success}，失败 ${failed}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量口播失败");
    } finally {
      setRunning(null);
      cancelRef.current = false;
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Mic2 className="h-4 w-4 text-primary" />
        分镜口播
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void runBatch("missing")} disabled={!!running || scenes.length === 0}>
          {running === "missing" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Volume2 className="mr-1 h-3.5 w-3.5" />}
          生成缺失项
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runBatch("failed")} disabled={!!running || scenes.length === 0}>
          {running === "failed" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
          重试失败项
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { cancelRef.current = true; }} disabled={!running}>
          <Square className="mr-1 h-3.5 w-3.5" />
          停止队列
        </Button>
      </div>
    </div>
  );
}
