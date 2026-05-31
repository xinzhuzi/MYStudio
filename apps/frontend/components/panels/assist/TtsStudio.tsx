"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Mic, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  createBackendVoiceProfile,
  fetchGenerationAudio,
  getGenerationStatus,
  getTtsRuntimeStatus,
  startTtsRuntime,
} from "@/lib/tts/client";
import { aiManager } from "@/lib/ai/ai-manager";
import { TTS_MODEL_GROUPS } from "@/lib/tts/model-catalog";
import type { TtsModelDefinition } from "@/types/tts";
import type { StudioAssetSummary } from "@/types/studio-assets";

const VOICE_CLONE_MODELS: TtsModelDefinition[] =
  TTS_MODEL_GROUPS.find((g) => g.id === "voiceClone")?.models ?? [];

const MAX_POLL_ATTEMPTS = 120; // 2 分钟超时

interface LocalAudioItem {
  id: string;
  name: string;
  filePath: string;
  createdAt: number;
}

const LOCAL_AUDIO_KEY = "moyin-tts-local-audio";

function loadLocalAudio(): LocalAudioItem[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_AUDIO_KEY) || "[]");
  } catch { return []; }
}

function saveLocalAudio(items: LocalAudioItem[]) {
  localStorage.setItem(LOCAL_AUDIO_KEY, JSON.stringify(items.slice(0, 100)));
}

export function TtsStudio() {
  const [audioAssets, setAudioAssets] = useState<StudioAssetSummary[]>([]);
  const [localAudio, setLocalAudio] = useState<LocalAudioItem[]>(loadLocalAudio);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedSource, setSelectedSource] = useState<"voice" | "local" | "">("");
  const [text, setText] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [selectedModelName, setSelectedModelName] = useState(VOICE_CLONE_MODELS[0]?.modelName ?? "");
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [backendRunning, setBackendRunning] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [voiceExpanded, setVoiceExpanded] = useState(false);
  const [localExpanded, setLocalExpanded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // 检测后端状态
  useEffect(() => {
    getTtsRuntimeStatus().then((s) => setBackendRunning(s.running)).catch(() => setBackendRunning(false));
  }, []);

  const handleStart = async () => {
    setStarting(true);
    try {
      const result = await startTtsRuntime();
      if (result.success) {
        setBackendRunning(true);
        toast.success("TTS 后端已启动");
      } else {
        toast.error(result.error || "启动失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "启动失败");
    } finally {
      setStarting(false);
    }
  };

  // 加载资产库音频（展开音色时才加载）
  useEffect(() => {
    if (!voiceExpanded || audioAssets.length > 0) return;
    if (!window.studioAssets?.list) return;
    window.studioAssets.list({ type: "audio", limit: 1000 }).then((res) => {
      setAudioAssets(res.items);
    }).catch(() => {});
  }, [voiceExpanded, audioAssets.length]);

  // 选中音频时严格读取数据库 description 字段作为参考文本
  useEffect(() => {
    if (!selectedAssetId || selectedSource !== "voice") { setReferenceText(""); return; }
    if (!window.studioAssets?.get) { setReferenceText(""); return; }
    let cancelled = false;
    window.studioAssets.get(selectedAssetId).then((detail) => {
      if (cancelled) return;
      setReferenceText(detail?.description?.trim() || "");
    }).catch(() => { if (!cancelled) setReferenceText(""); });
    return () => { cancelled = true; };
  }, [selectedAssetId, selectedSource]);

  // 组件卸载时释放 blob URL
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const selectedAsset = audioAssets.find((a) => a.id === selectedAssetId);
  const selectedLocalItem = localAudio.find((a) => a.id === selectedAssetId);
  const selectedAssetPath = selectedSource === "local"
    ? selectedLocalItem?.filePath
    : (selectedAsset?.sourcePath || selectedAsset?.filePath);
  const selectedModel = VOICE_CLONE_MODELS.find((m) => m.modelName === selectedModelName);

  const handleGenerate = useCallback(async () => {
    if (!selectedAssetPath) {
      toast.error("请选择参考音频");
      return;
    }
    if (!text.trim()) {
      toast.error("请输入要合成的文本");
      return;
    }
    if (!selectedModel) {
      toast.error("请选择模型");
      return;
    }

    setGenerating(true);
    try {
      // 1. 创建临时 profile（referenceText 用于声音特征对齐，不会出现在合成音频中）
      const profile = await createBackendVoiceProfile({
        name: `tts-clone-${Date.now()}`,
        type: "reference",
        language: "zh",
        defaultEngine: selectedModel.engine,
        defaultModelSize: selectedModel.modelSize,
        referenceAudioPath: selectedAssetPath,
        referenceText: referenceText.trim() || undefined,
      });

      // 2. 生成语音
      const generation = await aiManager.tts({
        text: text.trim(),
        profileId: profile.id,
        engine: selectedModel.engine,
        modelSize: selectedModel.modelSize,
        language: "zh",
      });

      // 3. 轮询状态（带超时，容忍推理期间后端阻塞）
      let status = generation;
      let attempts = 0;
      while (status.status === "generating" || status.status === "loading_model") {
        if (++attempts > MAX_POLL_ATTEMPTS) throw new Error("生成超时，请重试");
        await new Promise((r) => setTimeout(r, 2000));
        try {
          status = await getGenerationStatus(generation.id);
        } catch {
          // 推理期间后端可能阻塞，忽略请求失败继续等待
        }
      }

      if (status.status === "failed") {
        throw new Error(status.error || "生成失败");
      }

      // 4. 获取音频
      const audioBuffer = await fetchGenerationAudio(generation.id);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const blob = new Blob([audioBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setAudioUrl(url);

      // 5. 保存到本地制作列表
      const audioPath = status.audioPath || (status as unknown as Record<string, string>).audio_path;
      if (audioPath) {
        const newItem: LocalAudioItem = {
          id: generation.id,
          name: text.trim().slice(0, 20) + (text.trim().length > 20 ? "..." : ""),
          filePath: audioPath,
          createdAt: Date.now(),
        };
        const updated = [newItem, ...localAudio].slice(0, 100);
        setLocalAudio(updated);
        saveLocalAudio(updated);
      }

      toast.success("语音生成完成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "语音生成失败");
    } finally {
      setGenerating(false);
    }
  }, [selectedAssetPath, text, selectedModel, localAudio]);

  const handlePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">声音克隆</h3>
        </div>

        {backendRunning === false && (
          <div className="flex items-center gap-3 rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
            <AlertCircle className="h-5 w-5 text-orange-500 shrink-0" />
            <div className="flex-1 text-sm text-orange-700 dark:text-orange-300">
              TTS 后端未运行，请先启动。
            </div>
            <Button size="sm" onClick={() => void handleStart()} disabled={starting}>
              {starting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              启动
            </Button>
          </div>
        )}

        {/* 选择参考音频 - 分组折叠 */}
        <div className="space-y-2">
          <Label className="text-sm">参考音频</Label>
          <div className="rounded-md border border-border overflow-hidden">
            {/* 音色分组 */}
            <button
              type="button"
              onClick={() => setVoiceExpanded(!voiceExpanded)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium bg-muted/40 hover:bg-muted/60"
            >
              {voiceExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              音色（{audioAssets.length}）
            </button>
            {voiceExpanded && (
              <div className="max-h-60 overflow-y-auto border-t border-border [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {audioAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => { setSelectedAssetId(asset.id); setSelectedSource("voice"); }}
                    className={`w-full text-left px-4 py-1.5 text-sm hover:bg-muted/40 ${selectedAssetId === asset.id && selectedSource === "voice" ? "bg-primary/10 text-primary" : ""}`}
                  >
                    {asset.name}
                  </button>
                ))}
              </div>
            )}

            {/* 本地制作分组 */}
            <button
              type="button"
              onClick={() => setLocalExpanded(!localExpanded)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium bg-muted/40 hover:bg-muted/60 border-t border-border"
            >
              {localExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              本地制作（{localAudio.length}）
            </button>
            {localExpanded && (
              <div className="max-h-60 overflow-y-auto border-t border-border [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {localAudio.length === 0 ? (
                  <div className="px-4 py-2 text-xs text-muted-foreground">暂无，生成后自动添加</div>
                ) : localAudio.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setSelectedAssetId(item.id); setSelectedSource("local"); }}
                    className={`w-full text-left px-4 py-1.5 text-sm hover:bg-muted/40 ${selectedAssetId === item.id && selectedSource === "local" ? "bg-primary/10 text-primary" : ""}`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedAssetPath && (
            <p className="text-xs text-muted-foreground truncate">{selectedAssetPath}</p>
          )}
        </div>

        {/* 参考文本（音频中实际说的话，用于声音特征对齐） */}
        <div className="space-y-1">
          <Label className="text-sm text-muted-foreground">参考文本（音频中说的话，可选）</Label>
          <Textarea
            value={referenceText}
            onChange={(e) => setReferenceText(e.target.value)}
            rows={2}
            placeholder="输入参考音频中实际说的话，帮助模型更好地克隆声音..."
            className="resize-none text-sm"
          />
        </div>

        {/* 选择模型 */}
        <div className="space-y-2">
          <Label className="text-sm">模型</Label>
          <select
            value={selectedModelName}
            onChange={(e) => setSelectedModelName(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-hidden focus:ring-1 focus:ring-ring"
          >
            {VOICE_CLONE_MODELS.map((m) => (
              <option key={m.modelName} value={m.modelName}>{m.displayName}</option>
            ))}
          </select>
        </div>

        {/* 输入文本 */}
        <div className="space-y-2">
          <Label className="text-sm">合成文本</Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="输入要合成的文本..."
            className="resize-none"
          />
        </div>

        {/* 生成按钮 */}
        <Button
          onClick={() => void handleGenerate()}
          disabled={generating || !selectedAssetPath || !text.trim()}
          className="w-full"
        >
          {generating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              生成中...
            </>
          ) : (
            "生成语音"
          )}
        </Button>

        {/* 播放区域 */}
        {audioUrl && (
          <div className="flex items-center gap-3 rounded-lg border border-border p-4">
            <Button size="icon" variant="outline" onClick={handlePlay}>
              {playing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <span className="text-sm text-muted-foreground">
              {playing ? "播放中..." : "点击播放"}
            </span>
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setPlaying(false)}
              className="hidden"
            />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
