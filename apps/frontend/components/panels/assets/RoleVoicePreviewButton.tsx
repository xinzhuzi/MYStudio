"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { ensureBackendVoiceProfile } from "@/lib/tts/client";
import {
  buildRoleVoicePreviewText,
  getVoicePreviewBlockReason,
} from "@/lib/tts/voice-preview-text";
import { recoverVoiceProfileReferenceText } from "@/lib/tts/voice-profile-reference-recovery";
import { cn } from "@/lib/utils";
import { useTtsStore } from "@/stores/tts-store";
import type { TtsEngine } from "@/types/tts";
import { Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";

type VoicePreviewGenerationStatus = {
  status?: string;
  audio_path?: string;
  error?: string;
  mocked?: boolean | number;
  warning?: string;
  backend?: string;
};

export function RoleVoicePreviewButton({
  profileId,
  characterName,
  defaultEngine,
  defaultModelSize,
  className,
  stopPropagation = false,
}: {
  profileId: string;
  characterName: string;
  defaultEngine?: TtsEngine;
  defaultModelSize?: string;
  className?: string;
  stopPropagation?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const profile = useTtsStore((state) => state.voiceProfiles[profileId]);
  const updateVoiceProfile = useTtsStore((state) => state.updateVoiceProfile);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const clearAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => clearAudio, [clearAudio]);

  const handlePreview = useCallback(async () => {
    if (playing && audioRef.current) {
      clearAudio();
      setPlaying(false);
      return;
    }
    if (!window.ttsRuntime) {
      toast.error("TTS 后端未就绪");
      return;
    }
    if (!profile) {
      toast.error("音色 profile 不存在，请重新分配音色");
      return;
    }

    const previewProfile = await recoverVoiceProfileReferenceText(
      profile,
      updateVoiceProfile,
    );
    const blockReason = getVoicePreviewBlockReason(previewProfile);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }

    setLoading(true);
    try {
      const ttsStatus = await window.ttsRuntime.status();
      if (!ttsStatus.running) {
        const startRes = await window.ttsRuntime.start();
        if (!startRes.success) {
          toast.error(`TTS 启动失败: ${startRes.error || "未知错误"}`);
          return;
        }
      }
      await ensureBackendVoiceProfile(previewProfile);
      const text = buildRoleVoicePreviewText(characterName);
      const genRes = await window.ttsRuntime.request({
        method: "POST",
        path: "/generate",
        body: {
          profile_id: previewProfile.id,
          text,
          engine: previewProfile.defaultEngine ?? defaultEngine,
          model_size: previewProfile.defaultModelSize ?? defaultModelSize,
          language: previewProfile.language ?? "zh",
        },
      }) as { id?: string; error?: string };
      if (!genRes.id) {
        toast.error(genRes.error || "生成失败");
        return;
      }

      let attempts = 0;
      let completedStatus: VoicePreviewGenerationStatus | null = null;
      while (attempts < 60) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const status = await window.ttsRuntime.request({
          method: "GET",
          path: `/generate/${genRes.id}/status`,
        }) as VoicePreviewGenerationStatus;
        if (status?.status === "completed" && status.audio_path) {
          completedStatus = status;
          break;
        }
        if (status?.status === "failed") {
          toast.error(status.error || "语音生成失败");
          return;
        }
        attempts += 1;
      }
      if (attempts >= 60) {
        toast.error("语音生成超时");
        return;
      }
      const usedMockAudio = completedStatus?.mocked === true || completedStatus?.mocked === 1;
      if (usedMockAudio) {
        toast.error(`本地 Qwen 声音克隆失败，未播放占位音频：${completedStatus?.warning || "真实 TTS 适配器不可用"}`);
        return;
      }

      const audioRes = await window.ttsRuntime.requestBytes({
        method: "GET",
        path: `/audio/${genRes.id}`,
      });
      const blob = new Blob([audioRes.data], { type: audioRes.mimeType || "audio/wav" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      clearAudio();
      objectUrlRef.current = url;
      audioRef.current = audio;
      audio.onended = () => {
        setPlaying(false);
        clearAudio();
      };
      audio.onerror = () => {
        setPlaying(false);
        toast.error("播放失败");
        clearAudio();
      };
      await audio.play();
      setPlaying(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "试听失败");
    } finally {
      setLoading(false);
    }
  }, [
    characterName,
    clearAudio,
    defaultEngine,
    defaultModelSize,
    playing,
    profile,
    updateVoiceProfile,
  ]);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) event.stopPropagation();
    void handlePreview();
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("mt-2 w-full gap-1.5 text-xs", className)}
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : playing ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      {loading ? "生成中..." : playing ? "停止播放" : "试听音色"}
    </Button>
  );
}
