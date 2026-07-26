// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Shot Grid View with Detail Panel
 * Based on CineGen-AI StageDirector.tsx
 * Features: shot thumbnails grid, right detail panel, variation selector, keyframe generation
 */

import { useState, useMemo } from "react";
import { useScriptStore, useActiveScriptProject } from "@/stores/script/script-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useCharacterLibraryStore, type Character } from "@/stores/library/character-library-store";
import type { Shot, Keyframe } from "@/types/script";
import { BatchProgressOverlay } from "@/components/BatchProgressOverlay";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, LayoutGrid, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { delay, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { AngleSwitchDialog, AngleSwitchResultDialog, type AngleSwitchResult } from "@/components/features/storyboard/angle-switch";
import { generateAngleSwitch } from "@/lib/ai/runninghub-client";
import { getAngleLabel, type HorizontalDirection, type ElevationAngle, type ShotSize } from "@/lib/ai/runninghub-angles";
import { useAPIConfigStore } from "@/stores/ai/api-config-store";
import { parseApiKeys } from "@/lib/ai/core";
import { ShotGridCard } from "./shot-grid-card";
import { ShotGridDetailPanel } from "./shot-grid-detail-panel";

interface ShotGridViewProps {
  onGenerateImage?: (shot: Shot, type: "start" | "end") => Promise<string>;
  onGenerateVideo?: (shot: Shot, startImage: string, endImage?: string) => Promise<string>;
}

export function ShotGridView({ onGenerateImage, onGenerateVideo }: ShotGridViewProps) {
  const { activeProjectId } = useProjectStore();
  const scriptProject = useActiveScriptProject();
  const { updateShot } = useScriptStore();
  const { characters, getCharacterById } = useCharacterLibraryStore();

  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingType, setProcessingType] = useState<"start" | "end" | "video" | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    isVisible: boolean;
    current: number;
    total: number;
    message?: string;
  }>({ isVisible: false, current: 0, total: 0 });

  // Angle switch state
  const [angleSwitchOpen, setAngleSwitchOpen] = useState(false);
  const [angleSwitchResultOpen, setAngleSwitchResultOpen] = useState(false);
  const [angleSwitchTarget, setAngleSwitchTarget] = useState<"start" | "end">("start");
  const [angleSwitchResult, setAngleSwitchResult] = useState<AngleSwitchResult | null>(null);
  const [isAngleSwitching, setIsAngleSwitching] = useState(false);

  const projectId = activeProjectId || "";
  const shots = scriptProject?.shots || [];
  const scriptData = scriptProject?.scriptData;

  // Find active shot
  const activeShotIndex = shots.findIndex((s) => s.id === activeShotId);
  const activeShot = activeShotIndex >= 0 ? shots[activeShotIndex] : null;

  // Get keyframes for active shot
  const startKf = activeShot?.keyframes?.find((k) => k.type === "start");
  const endKf = activeShot?.keyframes?.find((k) => k.type === "end");

  // Check if all start frames are generated
  const allStartFramesGenerated = useMemo(() => {
    return shots.length > 0 && shots.every((s) => 
      s.keyframes?.find((k) => k.type === "start")?.imageUrl || s.imageUrl
    );
  }, [shots]);

  // Get scene for active shot
  const activeScene = useMemo(() => {
    if (!activeShot || !scriptData?.scenes) return null;
    return scriptData.scenes.find((s) => String(s.id) === String(activeShot.sceneRefId));
  }, [activeShot, scriptData]);

  // Get characters in active shot
  const activeCharacters = useMemo(() => {
    if (!activeShot) return [];
    return (activeShot.characterIds || [])
      .map((id) => getCharacterById(id))
      .filter(Boolean) as Character[];
  }, [activeShot, getCharacterById]);

  // Navigation
  const goToPrevShot = () => {
    if (activeShotIndex > 0) {
      setActiveShotId(shots[activeShotIndex - 1].id);
    }
  };

  const goToNextShot = () => {
    if (activeShotIndex < shots.length - 1) {
      setActiveShotId(shots[activeShotIndex + 1].id);
    }
  };

  // Handle variation change
  const handleVariationChange = (shotId: string, charId: string, varId: string) => {
    const shot = shots.find((s) => s.id === shotId);
    const existing = { ...(shot?.characterVariations || {}) };
    
    if (varId === "default") {
      delete existing[charId];
    } else {
      existing[charId] = varId;
    }
    
    updateShot(projectId, shotId, {
      characterVariations: existing,
    });
  };

  // Handle keyframe generation
  const handleGenerateKeyframe = async (shot: Shot, type: "start" | "end") => {
    if (!onGenerateImage) {
      toast.error("图片生成服务未配置");
      return;
    }

    const kfId = `kf-${shot.id}-${type}-${Date.now()}`;
    setProcessingId(kfId);
    setProcessingType(type);

    try {
      const imageUrl = await onGenerateImage(shot, type);

      // Update keyframes
      const existingKeyframes = shot.keyframes || [];
      const newKeyframe: Keyframe = {
        id: kfId,
        type,
        visualPrompt: shot.visualPrompt || shot.actionSummary,
        imageUrl,
        status: "completed",
      };

      const idx = existingKeyframes.findIndex((k) => k.type === type);
      const newKeyframes =
        idx >= 0
          ? existingKeyframes.map((k, i) => (i === idx ? newKeyframe : k))
          : [...existingKeyframes, newKeyframe];

      updateShot(projectId, shot.id, {
        keyframes: newKeyframes,
        // Also update legacy imageUrl for compatibility
        ...(type === "start" ? { imageUrl, imageStatus: "completed" } : {}),
      });

      toast.success(`${type === "start" ? "起始帧" : "结束帧"}生成完成`);
    } catch (error) {
      toast.error(`生成失败: ${(error as Error).message}`);
    } finally {
      setProcessingId(null);
      setProcessingType(null);
    }
  };

  // Handle video generation
  const handleGenerateVideo = async (shot: Shot) => {
    if (!onGenerateVideo) {
      toast.error("视频生成服务未配置");
      return;
    }

    const sKf = shot.keyframes?.find((k) => k.type === "start");
    const eKf = shot.keyframes?.find((k) => k.type === "end");

    if (!sKf?.imageUrl && !shot.imageUrl) {
      toast.error("请先生成起始帧");
      return;
    }

    setProcessingId(shot.id);
    setProcessingType("video");

    try {
      const startImage = sKf?.imageUrl || shot.imageUrl!;
      const endImage = eKf?.imageUrl;

      const videoUrl = await onGenerateVideo(shot, startImage, endImage);

      updateShot(projectId, shot.id, {
        videoUrl,
        videoStatus: "completed",
        interval: {
          videoUrl,
          duration: 3,
          status: "completed",
        },
      });

      toast.success("视频生成完成");
    } catch (error) {
      toast.error(`视频生成失败: ${(error as Error).message}`);
    } finally {
      setProcessingId(null);
      setProcessingType(null);
    }
  };

  // Handle angle switch button click
  const handleAngleSwitchClick = (type: "start" | "end") => {
    if (!activeShot) return;
    const imageUrl = type === "start"
      ? (startKf?.imageUrl || activeShot.imageUrl)
      : endKf?.imageUrl;

    if (!imageUrl) {
      toast.error(`请先生成${type === "start" ? "起始帧" : "结束帧"}`);
      return;
    }

    setAngleSwitchTarget(type);
    setAngleSwitchOpen(true);
  };

  // Handle angle switch generation
  const handleAngleSwitchGenerate = async (params: {
    direction: HorizontalDirection;
    elevation: ElevationAngle;
    shotSize: ShotSize;
    applyToSameScene: boolean;
    applyToAll: boolean;
  }) => {
    if (!activeShot) return;
    const { direction, elevation, shotSize } = params;

    // Get RunningHub API key
    const runninghubProvider = useAPIConfigStore.getState().getProviderByPlatform('runninghub');
    const apiKey = parseApiKeys(runninghubProvider?.apiKey || '')[0];
    const baseUrl = runninghubProvider?.baseUrl?.trim();
    const appId = runninghubProvider?.model?.[0];

    if (!apiKey || !baseUrl || !appId) {
      toast.error("请先在设置中配置 RunningHub（API Key / Base URL / 模型AppId）");
      setAngleSwitchOpen(false);
      return;
    }

    const originalImage = angleSwitchTarget === "start"
      ? (startKf?.imageUrl || activeShot.imageUrl)
      : endKf?.imageUrl;

    if (!originalImage) {
      toast.error("找不到原图");
      return;
    }

    setIsAngleSwitching(true);

    try {
      const newImageUrl = await generateAngleSwitch({
        referenceImage: originalImage,
        direction,
        elevation,
        shotSize,
        apiKey,
        baseUrl,
        appId,
        onProgress: (progress, status) => {
          console.log(`[AngleSwitch] Progress: ${progress}%, Status: ${status}`);
        },
      });

      const angleLabel = getAngleLabel(direction, elevation, shotSize);

      setAngleSwitchResult({
        originalImage,
        newImage: newImageUrl,
        angleLabel,
      });

      setAngleSwitchOpen(false);
      setAngleSwitchResultOpen(true);

      toast.success("视角切换生成完成");
    } catch (error) {
      toast.error(`视角切换失败: ${(error as Error).message}`);
    } finally {
      setIsAngleSwitching(false);
    }
  };

  // Apply angle switch result
  const handleApplyAngleSwitch = () => {
    if (!angleSwitchResult || !activeShot) return;

    const newKeyframe: Keyframe = {
      id: `kf-${activeShot.id}-${angleSwitchTarget}-${Date.now()}`,
      type: angleSwitchTarget,
      visualPrompt: activeShot.visualPrompt || activeShot.actionSummary,
      imageUrl: angleSwitchResult.newImage,
      status: "completed",
    };

    const existingKeyframes = activeShot.keyframes || [];
    const idx = existingKeyframes.findIndex((k) => k.type === angleSwitchTarget);
    const newKeyframes =
      idx >= 0
        ? existingKeyframes.map((k, i) => (i === idx ? newKeyframe : k))
        : [...existingKeyframes, newKeyframe];

    updateShot(projectId, activeShot.id, {
      keyframes: newKeyframes,
      ...(angleSwitchTarget === "start" ? { imageUrl: angleSwitchResult.newImage, imageStatus: "completed" } : {}),
    });

    setAngleSwitchResultOpen(false);
    setAngleSwitchResult(null);
    toast.success("视角已应用");
  };

  // Batch generate start frames
  const handleBatchGenerateImages = async () => {
    if (!onGenerateImage) {
      toast.error("图片生成服务未配置");
      return;
    }

    const shotsToProcess = allStartFramesGenerated
      ? shots
      : shots.filter((s) => !s.keyframes?.find((k) => k.type === "start")?.imageUrl && !s.imageUrl);

    if (shotsToProcess.length === 0) return;

    if (allStartFramesGenerated) {
      if (!confirm("确定要重新生成所有镜头的首帧吗？")) return;
    }

    setBatchProgress({
      isVisible: true,
      current: 0,
      total: shotsToProcess.length,
      message: allStartFramesGenerated ? "正在重新生成所有首帧..." : "正在批量生成首帧...",
    });

    for (let i = 0; i < shotsToProcess.length; i++) {
      if (i > 0) await delay(RATE_LIMITS.BATCH_ITEM_DELAY);

      const shot = shotsToProcess[i];
      setBatchProgress((prev) => ({
        ...prev,
        current: i + 1,
        message: `正在生成镜头 ${i + 1}/${shotsToProcess.length}...`,
      }));

      try {
        const imageUrl = await onGenerateImage(shot, "start");
        const kfId = `kf-${shot.id}-start-${Date.now()}`;

        const existingKeyframes = shot.keyframes || [];
        const newKeyframe: Keyframe = {
          id: kfId,
          type: "start",
          visualPrompt: shot.visualPrompt || shot.actionSummary,
          imageUrl,
          status: "completed",
        };

        const idx = existingKeyframes.findIndex((k) => k.type === "start");
        const newKeyframes =
          idx >= 0
            ? existingKeyframes.map((k, i) => (i === idx ? newKeyframe : k))
            : [...existingKeyframes, newKeyframe];

        updateShot(projectId, shot.id, {
          keyframes: newKeyframes,
          imageUrl,
          imageStatus: "completed",
        });
      } catch (error) {
        console.error(`Failed to generate for shot ${shot.id}`, error);
      }
    }

    setBatchProgress({ isVisible: false, current: 0, total: 0 });
    toast.success("批量生成完成");
  };

  if (shots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 bg-[#121212] p-8">
        <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm">暂无镜头数据</p>
        <p className="text-xs text-zinc-600 mt-1">请先在剧本阶段生成分镜列表</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#121212] relative overflow-hidden">
      {/* Batch Progress Overlay */}
      <BatchProgressOverlay
        isVisible={batchProgress.isVisible}
        current={batchProgress.current}
        total={batchProgress.total}
        message={batchProgress.message}
        title="批量生成首帧"
      />

      {/* Toolbar */}
      <div className="h-14 border-b border-zinc-800 bg-[#1A1A1A] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-medium text-white">镜头网格</span>
          <span className="text-xs text-zinc-500 font-mono">
            {shots.filter((s) => s.imageUrl || s.keyframes?.find((k) => k.type === "start")?.imageUrl).length} / {shots.length}
          </span>
        </div>

        <Button
          onClick={handleBatchGenerateImages}
          disabled={batchProgress.isVisible || !onGenerateImage}
          variant={allStartFramesGenerated ? "outline" : "default"}
          size="sm"
          className="h-8"
        >
          <Sparkles className="w-3 h-3 mr-1.5" />
          {allStartFramesGenerated ? "重新生成首帧" : "批量生成首帧"}
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Grid View */}
        <ScrollArea className={cn("flex-1 p-4", activeShotId && "border-r border-zinc-800")}>
          <div
            className={cn(
              "grid gap-3",
              activeShotId ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            )}
          >
            {shots.map((shot, idx) => (
              <ShotGridCard
                key={shot.id}
                shot={shot}
                index={idx}
                isActive={activeShotId === shot.id}
                onSelect={setActiveShotId}
              />
            ))}
          </div>
        </ScrollArea>

        {/* Right Detail Panel */}
        {activeShotId && activeShot && (
          <ShotGridDetailPanel
            shot={activeShot}
            shotIndex={activeShotIndex}
            totalShots={shots.length}
            scene={activeScene ?? null}
            characters={activeCharacters}
            startKeyframe={startKf}
            endKeyframe={endKf}
            processingType={processingType}
            isAngleSwitching={isAngleSwitching}
            onPrevious={goToPrevShot}
            onNext={goToNextShot}
            onClose={() => setActiveShotId(null)}
            onVariationChange={handleVariationChange}
            onAngleSwitch={handleAngleSwitchClick}
            onGenerateKeyframe={handleGenerateKeyframe}
            onGenerateVideo={handleGenerateVideo}
          />
        )}
      </div>

      {/* Angle Switch Dialog */}
      <AngleSwitchDialog
        open={angleSwitchOpen}
        onOpenChange={setAngleSwitchOpen}
        onGenerate={handleAngleSwitchGenerate}
        isGenerating={isAngleSwitching}
        frameType={angleSwitchTarget}
        previewUrl={angleSwitchTarget === "start"
          ? (startKf?.imageUrl || activeShot?.imageUrl)
          : endKf?.imageUrl
        }
        sameSceneShotsCount={0}
      />

      {/* Angle Switch Result Dialog */}
      <AngleSwitchResultDialog
        open={angleSwitchResultOpen}
        onOpenChange={setAngleSwitchResultOpen}
        result={angleSwitchResult}
        onApply={handleApplyAngleSwitch}
        onRegenerate={() => {
          setAngleSwitchResultOpen(false);
          setAngleSwitchOpen(true);
        }}
      />
    </div>
  );
}
