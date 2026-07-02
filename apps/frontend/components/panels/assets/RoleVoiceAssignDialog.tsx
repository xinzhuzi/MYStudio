"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createMystudioTtsSink } from "@/lib/studio/voice-sync";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { cn } from "@/lib/utils";
import { Search, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { buildVoiceReferenceAssets } from "../studio/voice-reference-assets";

export interface RoleVoiceAssignableCharacter {
  id: string;
  name: string;
  gender?: string;
  age?: string;
  personality?: string;
}

export function RoleVoiceAssignDialog({
  character,
  open,
  onOpenChange,
}: {
  character: RoleVoiceAssignableCharacter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const materials = useStudioStore((state) => state.materials);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setTtsActiveProjectId = useTtsStore((state) => state.setActiveProjectId);
  const ensureTtsProject = useTtsStore((state) => state.ensureProject);
  const [runtimeAudioAssets, setRuntimeAudioAssets] = useState<StudioAssetSummary[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [audioSearch, setAudioSearch] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedAssetId("");
      setAudioSearch("");
      return;
    }
    if (!window.studioAssets?.list) return;
    let cancelled = false;
    setLoadingAssets(true);
    window.studioAssets.list({ type: "audio", limit: 9999 })
      .then((result) => {
        if (!cancelled) setRuntimeAudioAssets(result.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setRuntimeAudioAssets([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!activeProjectId) return;
    setTtsActiveProjectId(activeProjectId);
    ensureTtsProject(activeProjectId);
  }, [activeProjectId, ensureTtsProject, setTtsActiveProjectId]);

  const referenceAssets = useMemo(
    () => buildVoiceReferenceAssets(materials, runtimeAudioAssets),
    [materials, runtimeAudioAssets],
  );
  const filteredAudioAssets = useMemo(() => {
    const keyword = audioSearch.trim().toLowerCase();
    if (!keyword) return referenceAssets;
    return referenceAssets.filter((asset) =>
      [asset.name, asset.sourceLabel, asset.filePath]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(keyword)),
    );
  }, [audioSearch, referenceAssets]);
  const selectedAsset = referenceAssets.find((item) => item.id === selectedAssetId);

  const handleAssignReferenceAsset = useCallback(async () => {
    if (!selectedAsset) {
      toast.error("请先从资产库选择音色音频");
      return;
    }
    setAssigning(true);
    try {
      if (!activeProjectId) {
        throw new Error("当前项目未就绪，无法绑定音色");
      }
      setTtsActiveProjectId(activeProjectId);
      ensureTtsProject(activeProjectId);
      const speakerId = toRoleSpeakerId(character.id);
      const sink = createMystudioTtsSink();
      const profileId = sink.createVoiceProfile({
        name: `音色·${character.name}·${selectedAsset.name}`,
        type: "reference",
        language: "zh",
        defaultEngine: "qwen",
        defaultModelSize: "1.7B",
        referenceAudioPath: selectedAsset.filePath,
        referenceText: selectedAsset.referenceText,
        instruct: buildRoleVoicePreviewInstruction(character),
      });
      sink.bindSpeaker({
        speakerId,
        profileId,
        defaultEngine: "qwen",
        defaultModelSize: "1.7B",
      });
      toast.success(`${character.name} 已绑定音色音频「${selectedAsset.name}」`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "分配失败");
    } finally {
      setAssigning(false);
    }
  }, [activeProjectId, character, ensureTtsProject, selectedAsset, setTtsActiveProjectId, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(760px,calc(100vw-24px))] max-w-none flex-col overflow-hidden border border-border bg-card/90 p-0 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 px-6 pt-6 pr-12 text-base">
            <Volume2 className="h-4 w-4 text-primary" />
            <span className="min-w-0 truncate">为角色「{character.name}」分配音色</span>
          </DialogTitle>
          <DialogDescription className="mt-1 px-6 text-xs">
            从资产库选择一段可被后续 TTS 生成流程克隆的参考音频，角色这里只负责绑定音色来源。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 pb-6">
          <div className="rounded-lg border border-border/80 bg-background/45 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">资产库音频</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  选择一段声音样本作为该角色后续克隆发声的参考。
                </div>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {loadingAssets
                  ? "加载中"
                  : audioSearch.trim()
                    ? `${filteredAudioAssets.length} / ${referenceAssets.length}`
                    : `共 ${referenceAssets.length} 个`}
              </span>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={audioSearch}
                onChange={(event) => setAudioSearch(event.target.value)}
                placeholder="搜索音频名称或文件名"
                showClearIcon
                onClear={() => setAudioSearch("")}
                className="h-9 border-border/80 bg-background/70 pl-9 text-sm"
              />
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto overflow-x-hidden pr-1">
            {referenceAssets.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                资产库中暂无可用音频。请先在资产库导入 WAV/MP3 音色样本。
              </div>
            )}
            {referenceAssets.length > 0 && filteredAudioAssets.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                没有匹配的音频。请换一个关键词。
              </div>
            )}
            {filteredAudioAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                title={asset.filePath}
                onClick={() => setSelectedAssetId(asset.id)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                  selectedAssetId === asset.id
                    ? "border-primary/55 bg-primary/12 text-foreground"
                    : "border-border/75 bg-background/40 hover:border-primary/35 hover:bg-muted/35",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
                  <Volume2 className="h-4 w-4 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{asset.name}</span>
                  {asset.sourceLabel && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{asset.sourceLabel}</span>
                  )}
                </span>
              </button>
            ))}
          </div>

          <DialogFooter className="shrink-0">
            <Button
              onClick={handleAssignReferenceAsset}
              disabled={assigning || !selectedAsset}
              size="sm"
              className="w-full"
            >
              {assigning ? "分配中..." : "确认分配"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildRoleVoicePreviewInstruction(character: RoleVoiceAssignableCharacter) {
  return [
    character.gender,
    character.age,
    character.personality,
    `${character.name}角色试音，保持中文自然口语，情绪克制但清晰。`,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("，");
}
