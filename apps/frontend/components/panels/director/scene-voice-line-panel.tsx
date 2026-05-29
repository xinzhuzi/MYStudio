"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Loader2, Mic2, RotateCcw, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createBackendVoiceProfile,
  fetchGenerationAudio,
  generateSpeech,
  getGenerationStatus,
  startTtsRuntime,
} from "@/lib/tts/client";
import { getDefaultPresetVoiceId, validateVoiceProfileForGeneration } from "@/lib/tts/voice-profile-capabilities";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import type { SplitScene } from "@/stores/director-store";
import { useProjectStore } from "@/stores/project-store";
import { useTtsStore } from "@/stores/tts-store";
import type { TtsSpeakerId, VoiceProfile } from "@/types/tts";

interface SceneVoiceLinePanelProps {
  scene: SplitScene;
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function getGenerationAudioPath(result: unknown) {
  const data = result as { audioPath?: string; audio_path?: string };
  return data.audioPath || data.audio_path;
}

function getGenerationError(result: unknown) {
  const data = result as { error?: string; detail?: string };
  return data.error || data.detail;
}

function getGenerationMetadata(result: unknown) {
  const data = result as { backend?: string; mocked?: boolean | number; warning?: string };
  return {
    ttsBackend: data.backend,
    mocked: typeof data.mocked === "number" ? data.mocked === 1 : data.mocked,
    warning: data.warning,
  };
}

function speakerLabel(speakerId: TtsSpeakerId, characters: Array<{ id: string; name: string }>) {
  if (speakerId === "narrator") return "旁白";
  const characterId = speakerId.replace("character:", "");
  return characters.find((character) => character.id === characterId)?.name || "角色";
}

async function waitForGeneration(generationId: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await getGenerationStatus(generationId);
    if (status.status === "completed") return status;
    if (status.status === "failed") throw new Error(getGenerationError(status) || "口播生成失败");
    await delay(1000);
  }
  throw new Error("口播生成超时");
}

export function SceneVoiceLinePanel({ scene }: SceneVoiceLinePanelProps) {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const characters = useCharacterLibraryStore((state) => state.characters);
  const setActiveProjectId = useTtsStore((state) => state.setActiveProjectId);
  const ensureSceneVoiceLine = useTtsStore((state) => state.ensureSceneVoiceLine);
  const upsertSceneVoiceLine = useTtsStore((state) => state.upsertSceneVoiceLine);
  const line = useTtsStore((state) => state.getSceneVoiceLine(scene.id));
  const voiceProfilesById = useTtsStore((state) => state.voiceProfiles);
  const createVoiceProfile = useTtsStore((state) => state.createVoiceProfile);
  const bindSpeaker = useTtsStore((state) => state.bindSpeaker);
  const getBinding = useTtsStore((state) => state.getBinding);
  const markGenerating = useTtsStore((state) => state.markGenerating);
  const markCompleted = useTtsStore((state) => state.markCompleted);
  const markFailed = useTtsStore((state) => state.markFailed);
  const clearSceneAudio = useTtsStore((state) => state.clearSceneAudio);
  const [busy, setBusy] = useState(false);
  const voiceProfiles = useMemo(() => Object.values(voiceProfilesById), [voiceProfilesById]);

  const sceneCharacters = useMemo(
    () => (scene.characterIds || [])
      .map((id) => characters.find((character) => character.id === id))
      .filter(Boolean) as Array<{ id: string; name: string }>,
    [characters, scene.characterIds],
  );

  useEffect(() => {
    if (activeProjectId) setActiveProjectId(activeProjectId);
  }, [activeProjectId, setActiveProjectId]);

  useEffect(() => {
    if (!activeProjectId) return;
    ensureSceneVoiceLine({
      sceneId: scene.id,
      dialogue: scene.dialogue || "",
      characterIds: scene.characterIds || [],
    });
  }, [activeProjectId, ensureSceneVoiceLine, scene.characterIds, scene.dialogue, scene.id]);

  const currentLine = line ?? {
    sceneId: scene.id,
    speakerId: "narrator" as const,
    text: scene.dialogue || "",
    engine: "qwen" as const,
    modelSize: "0.6B",
    status: "idle" as const,
    updatedAt: Date.now(),
  };

  const selectedProfile = voiceProfiles.find((profile) => profile.id === currentLine.profileId);

  const handleCreateQuickProfile = () => {
    const speaker = currentLine.speakerId;
    const profile = createVoiceProfile({
      name: `${speakerLabel(speaker, sceneCharacters)}声线`,
      type: "preset",
      language: "zh",
      defaultEngine: "kokoro",
      presetVoiceId: getDefaultPresetVoiceId("kokoro", "zh"),
    });
    bindSpeaker({
      speakerId: speaker,
      profileId: profile.id,
      defaultEngine: profile.defaultEngine,
      defaultModelSize: profile.defaultModelSize,
    });
    upsertSceneVoiceLine({
      sceneId: scene.id,
      speakerId: speaker,
      profileId: profile.id,
      engine: profile.defaultEngine,
      modelSize: profile.defaultModelSize,
    });
    toast.success("已创建并绑定声线");
  };

  const handleSpeakerChange = (speakerId: TtsSpeakerId) => {
    const binding = getBinding(speakerId);
    upsertSceneVoiceLine({
      sceneId: scene.id,
      speakerId,
      profileId: binding?.profileId,
      engine: binding?.defaultEngine,
      modelSize: binding?.defaultModelSize,
    });
  };

  const handleProfileChange = (profileId: string) => {
    const profile = voiceProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    bindSpeaker({
      speakerId: currentLine.speakerId,
      profileId: profile.id,
      defaultEngine: profile.defaultEngine,
      defaultModelSize: profile.defaultModelSize,
    });
    upsertSceneVoiceLine({
      sceneId: scene.id,
      profileId: profile.id,
      engine: profile.defaultEngine,
      modelSize: profile.defaultModelSize,
    });
  };

  const syncProfileToBackend = async (profile: VoiceProfile) => {
    await createBackendVoiceProfile({
      ...profile,
      defaultEngine: profile.defaultEngine,
      defaultModelSize: profile.defaultModelSize,
      referenceAudioPath: profile.referenceAudioPath,
      referenceText: profile.referenceText,
      presetVoiceId: profile.presetVoiceId,
      instruct: profile.instruct,
    });
  };

  const handleGenerate = async () => {
    if (!currentLine.text.trim()) {
      toast.error("口播文本为空");
      return;
    }
    if (!selectedProfile) {
      toast.error("请先选择或创建声线 profile");
      return;
    }
    const validationError = validateVoiceProfileForGeneration(selectedProfile);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (!window.studioAssets?.saveMaterial) {
      toast.error("素材保存接口仅在桌面应用中可用");
      return;
    }

    setBusy(true);
    try {
      const runtime = await startTtsRuntime();
      if (!runtime.success) throw new Error(runtime.error || "TTS 后端启动失败");
      await syncProfileToBackend(selectedProfile);
      const generation = await generateSpeech({
        text: currentLine.text.trim(),
        profileId: selectedProfile.id,
        engine: currentLine.engine,
        modelSize: currentLine.modelSize,
        language: selectedProfile.language,
      });
      markGenerating(scene.id, generation.id);
      const completed = await waitForGeneration(generation.id);
      if (!getGenerationAudioPath(completed)) throw new Error("生成完成但没有音频路径");
      const bytes = await fetchGenerationAudio(generation.id);
      const material = await window.studioAssets.saveMaterial({
        name: `scene-${scene.id + 1}-voice-${Date.now()}.wav`,
        bytes,
      });
      if (!material.success || !material.localPath) {
        throw new Error(material.error || "保存音频素材失败");
      }
      markCompleted(scene.id, {
        audioLocalPath: material.localPath,
        audioMaterialId: material.filePath || material.localPath,
        audioFilePath: material.filePath,
        ...getGenerationMetadata(completed),
      });
      toast.success(`分镜 ${scene.id + 1} 口播已生成`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "口播生成失败";
      markFailed(scene.id, message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenAudio = async () => {
    const target = currentLine.audioFilePath || currentLine.audioLocalPath;
    if (!target) return;
    if (!window.electronAPI?.openPath) {
      toast.error("当前环境不支持打开本地文件");
      return;
    }
    const result = await window.electronAPI.openPath(target);
    if (!result.success) {
      toast.error(result.error || "打开音频失败");
    }
  };

  const isGenerating = busy || currentLine.status === "generating" || currentLine.status === "queued";

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Mic2 className="h-4 w-4 text-primary" />
          口播
        </Label>
        <div className="flex items-center gap-2">
          {currentLine.audioLocalPath && (
            <audio controls src={currentLine.audioLocalPath} className="h-8 w-44" />
          )}
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Volume2 className="mr-1 h-3.5 w-3.5" />}
            {currentLine.audioLocalPath ? "重生成" : "生成"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-[150px_1fr_150px]">
        <Select value={currentLine.speakerId} onValueChange={(value) => handleSpeakerChange(value as TtsSpeakerId)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="narrator">旁白</SelectItem>
            {sceneCharacters.map((character) => (
              <SelectItem key={character.id} value={`character:${character.id}`}>
                {character.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={currentLine.profileId || ""} onValueChange={handleProfileChange}>
          <SelectTrigger>
            <SelectValue placeholder="选择声线 profile" />
          </SelectTrigger>
          <SelectContent>
            {voiceProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={handleCreateQuickProfile}>
          快速声线
        </Button>
      </div>

      <Textarea
        value={currentLine.text}
        onChange={(event) => upsertSceneVoiceLine({ sceneId: scene.id, text: event.target.value })}
        rows={3}
        className="resize-none text-sm"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="min-w-0 space-y-1">
          <span className="break-words">
            {currentLine.status === "failed"
              ? currentLine.error || "生成失败"
              : `${currentLine.mocked ? "占位音频" : currentLine.ttsBackend || currentLine.engine}${currentLine.modelSize ? ` / ${currentLine.modelSize}` : ""}`}
          </span>
          {currentLine.mocked && currentLine.warning && (
            <p className="break-words text-amber-600 dark:text-amber-400" title={currentLine.warning}>
              真实模型未运行，当前音频仅用于流程验证
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentLine.audioLocalPath && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void handleOpenAudio()}>
                <FolderOpen className="mr-1 h-3.5 w-3.5" />
                打开
              </Button>
              <Button size="sm" variant="ghost" onClick={() => clearSceneAudio(scene.id)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                清除
              </Button>
            </>
          )}
          {currentLine.status === "failed" && (
            <Button size="sm" variant="ghost" onClick={handleGenerate}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
