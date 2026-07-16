// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 分镜卡片组件 (Split Scene Card Component)
 * 显示单个分镜的所有信息，包括首帧/尾帧图片、视频预览、提示词编辑等
 * 用于 SplitScene 类型（与 scene-card.tsx 中的 AIScene 类型不同）
 */

import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  type SplitScene, 
  type EmotionTag,
  type ShotSizeType,
  type DurationType,
  type SoundEffectTag,
  CAMERA_MOVEMENT_PRESETS,
  SPECIAL_TECHNIQUE_PRESETS,
  CAMERA_ANGLE_PRESETS,
  PHOTOGRAPHY_TECHNIQUE_PRESETS,
  FOCAL_LENGTH_PRESETS,
} from "@/stores/director-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2, 
  Play,
  ImageIcon,
  AlertCircle,
  Loader2,
  RefreshCw,
  MapPin,
  Camera,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { EmotionTags } from "../director/emotion-tags";
import { ShotSizeSelector } from "../director/shot-size-selector";
import { DurationSelector } from "../director/duration-selector";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { usePreviewStore } from "@/stores/preview-store";
import { ScenePromptPanel } from "../director/scene-prompt-panel";
import { SceneVoiceLinePanel } from "../director/scene-voice-line-panel";
import { useResolvedImageUrl } from "@/hooks/use-resolved-image-url";
import { StoryboardSceneFrameSection, type StoryboardSceneFrameSectionProps } from "../director/storyboard-scene-frame-section";

export interface SplitSceneCardProps extends StoryboardSceneFrameSectionProps {
  onUpdateImagePrompt: (id: number, prompt: string, promptZh?: string) => void;
  onUpdateVideoPrompt: (id: number, prompt: string, promptZh?: string) => void;
  onUpdateEndFramePrompt: (id: number, prompt: string, promptZh?: string) => void;
  onUpdateEmotions: (id: number, emotionTags: EmotionTag[]) => void;
  onUpdateShotSize: (id: number, shotSize: ShotSizeType | null) => void;
  onUpdateDuration: (id: number, duration: DurationType) => void;
  onUpdateAmbientSound: (id: number, ambientSound: string) => void;
  onUpdateSoundEffects: (id: number, soundEffects: SoundEffectTag[]) => void;
  onDelete: (id: number) => void;
  onSaveToLibrary?: (scene: SplitScene, type: 'image' | 'video') => void;
  onGenerateImage?: (sceneId: number) => void;
  onGenerateVideo?: (sceneId: number) => void;
  onUpdateField?: (sceneId: number, field: keyof SplitScene, value: any) => void;
  onExtractVideoLastFrame?: (sceneId: number) => void;
  onStopVideoGeneration?: (sceneId: number) => void;
  isExtractingFrame?: boolean;
}
export function SClassSceneCard({
  scene, 
  onUpdateImagePrompt,
  onUpdateVideoPrompt,
  onUpdateEndFramePrompt,
  onUpdateNeedsEndFrame,
  onUpdateEndFrame,
  onUpdateCharacters,
  onUpdateCharacterVariationMap,
  onUpdateEmotions,
  onUpdateShotSize,
  onUpdateDuration,
  onUpdateAmbientSound,
  onUpdateSoundEffects,
  onUpdateSceneReference,
  onUpdateEndFrameSceneReference,
  onDelete,
  onSaveToLibrary,
  onGenerateImage,
  onGenerateVideo,
  onGenerateEndFrame,
  onRemoveImage,
  onUploadImage,
  onUpdateField,
  onAngleSwitch,
  onQuadGrid,
  onExtractVideoLastFrame,
  onStopImageGeneration,
  onStopVideoGeneration,
  onStopEndFrameGeneration,
  isExtractingFrame,
  isAngleSwitching,
  isQuadGridGenerating,
  isGeneratingAny,
}: SplitSceneCardProps) {
  const { setPreviewItem } = usePreviewStore();
  const effectiveImageUrl = scene.imageDataUrl || scene.imageHttpUrl || '';
  const resolvedImageUrl = useResolvedImageUrl(effectiveImageUrl);

  // Status helpers
  const isImageGenerating = scene.imageStatus === 'generating' || scene.imageStatus === 'uploading';
  const isVideoReady = scene.videoStatus === 'completed' && scene.videoUrl;
  const isVideoGenerating = scene.videoStatus === 'generating' || scene.videoStatus === 'uploading';
  const isVideoFailed = scene.videoStatus === 'failed';
  const isVideoModerationSkipped = isVideoFailed && scene.videoError?.startsWith('MODERATION_SKIPPED:');
  const hasImage = !!effectiveImageUrl;
  const canDragVideo = isVideoReady && scene.videoUrl;

  // Handle drag start for video
  const handleVideoDragStart = (e: React.DragEvent) => {
    if (!canDragVideo || !scene.videoUrl) return;
    
    const dragData = {
      id: scene.videoMediaId || `scene-${scene.id}-video`,
      type: 'video',
      name: `分镜 ${scene.id + 1} - AI视频`,
      url: scene.videoUrl,
      thumbnailUrl: scene.imageDataUrl,
      duration: 5,
    };
    
    e.dataTransfer.setData('application/x-media-item', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copy';
    
    const dragImage = document.createElement('div');
    dragImage.className = 'bg-primary text-white px-2 py-1 rounded text-xs';
    dragImage.textContent = `分镜 ${scene.id + 1} 视频`;
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  };

  return (
    <div className="group relative border rounded-lg overflow-hidden bg-card hover:border-primary/50 transition-colors">
      {/* 分镜编号和控制栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-muted-foreground">分镜 #{scene.id + 1}</span>
          {(scene.sceneName || scene.sceneLocation) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary cursor-default">
                    <MapPin className="h-3 w-3" />
                    {scene.sceneName || scene.sceneLocation}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs">
                    {scene.sceneName && <p>场景: {scene.sceneName}</p>}
                    {scene.sceneLocation && <p>地点: {scene.sceneLocation}</p>}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <ShotSizeSelector
            value={scene.shotSize}
            onChange={(v) => onUpdateShotSize(scene.id, v)}
            disabled={isGeneratingAny}
            className="w-24"
          />
        </div>
        {!isGeneratingAny && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除分镜 #{scene.id + 1}？</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作将删除该分镜的所有内容，无法撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(scene.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <StoryboardSceneFrameSection
        scene={scene}
        onUpdateNeedsEndFrame={onUpdateNeedsEndFrame}
        onUpdateEndFrame={onUpdateEndFrame}
        onUpdateCharacters={onUpdateCharacters}
        onUpdateCharacterVariationMap={onUpdateCharacterVariationMap}
        onUpdateSceneReference={onUpdateSceneReference}
        onUpdateEndFrameSceneReference={onUpdateEndFrameSceneReference}
        onGenerateEndFrame={onGenerateEndFrame}
        onRemoveImage={onRemoveImage}
        onUploadImage={onUploadImage}
        onAngleSwitch={onAngleSwitch}
        onQuadGrid={onQuadGrid}
        onStopImageGeneration={onStopImageGeneration}
        onStopEndFrameGeneration={onStopEndFrameGeneration}
        isAngleSwitching={isAngleSwitching}
        isQuadGridGenerating={isQuadGridGenerating}
        isGeneratingAny={isGeneratingAny}
      />

        {/* 第二排：生成图片/视频按钮 + 视频预览/状态 */}
        <div className="flex items-center gap-2">
          {!hasImage ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => onGenerateImage?.(scene.id)}
                disabled={isGeneratingAny || isImageGenerating}
              >
                {isImageGenerating ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" />生成中 {scene.imageProgress}%</>
                ) : (
                  <><ImageIcon className="h-3 w-3 mr-1" />生成图片</>
                )}
              </Button>
              {isImageGenerating && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs px-2"
                  onClick={() => onStopImageGeneration?.(scene.id)}
                  title="停止生成"
                >
                  <Square className="h-3 w-3" />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={isVideoReady ? "outline" : "default"}
                className="h-7 text-xs"
                onClick={() => onGenerateVideo?.(scene.id)}
                disabled={isGeneratingAny || isVideoGenerating}
              >
                {isVideoGenerating ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" />生成中 {scene.videoProgress}%</>
                ) : isVideoReady ? (
                  <><RefreshCw className="h-3 w-3 mr-1" />重新生成</>
                ) : (
                  <><Play className="h-3 w-3 mr-1" />生成视频</>
                )}
              </Button>
              {isVideoGenerating && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs px-2"
                  onClick={() => onStopVideoGeneration?.(scene.id)}
                  title="停止生成"
                >
                  <Square className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
          
          {isVideoReady && scene.videoUrl && (
            <div className="flex items-center gap-1">
              <div 
                className="flex-1 aspect-video max-w-[120px] bg-muted rounded overflow-hidden cursor-pointer relative"
                onClick={() => setPreviewItem({ type: 'video', url: scene.videoUrl!, name: `分镜 ${scene.id + 1} 视频` })}
                draggable={!!canDragVideo}
                onDragStart={handleVideoDragStart}
              >
                <video src={scene.videoUrl} className="w-full h-full object-cover" muted preload="none" poster={resolvedImageUrl || undefined} />
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Play className="h-4 w-4 text-white" />
                </div>
                {canDragVideo && (
                  <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-green-600 text-white px-1 rounded">拖到时间线</span>
                )}
              </div>
              {/* 提取尾帧按钮 */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onExtractVideoLastFrame?.(scene.id);
                      }}
                      disabled={isExtractingFrame || isGeneratingAny}
                      className="p-1.5 rounded bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 transition-colors"
                    >
                      {isExtractingFrame ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Camera className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">提取最后一帧到下一分镜首帧</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}

          {isVideoFailed && (
            <span className={cn(
              "text-xs flex items-center gap-1",
              isVideoModerationSkipped 
                ? "text-amber-500" 
                : "text-destructive"
            )}>
              <AlertCircle className="h-3 w-3" />
              {isVideoModerationSkipped 
                ? '内容审核跳过'
                : (scene.videoError || '生成失败')}
            </span>
          )}
        </div>

        <ScenePromptPanel
          scene={scene}
          promptLanguage="zh"
          variant="sclass"
          disabled={!!isGeneratingAny}
          onUpdateAction={(value) => onUpdateField?.(scene.id, "actionSummary", value)}
          onSaveImage={(prompt, promptZh) => {
            onUpdateImagePrompt(scene.id, prompt, promptZh);
            toast.success(`分镜 ${scene.id + 1} 首帧提示词已更新`);
          }}
          onSaveEndFrame={(prompt, promptZh) => {
            onUpdateEndFramePrompt(scene.id, prompt, promptZh);
            toast.success(`分镜 ${scene.id + 1} 尾帧提示词已更新`);
          }}
          onSaveVideo={(prompt, promptZh) => {
            onUpdateVideoPrompt(scene.id, prompt, promptZh);
            toast.success(`分镜 ${scene.id + 1} 视频提示词已更新`);
          }}
        />
        {/* 秒数 + 镜头 + 情绪氛围（始终显示，不随提示词折叠） */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* 秒数 */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground">秒数:</span>
              <DurationSelector
                value={scene.duration || 5}
                onChange={(v) => onUpdateDuration(scene.id, v)}
                disabled={isGeneratingAny}
              />
            </div>
            {/* 镜头运动 */}
            <div className="flex items-center gap-1">
              <Select
                value={scene.cameraMovement || 'none'}
                onValueChange={(v) => onUpdateField?.(scene.id, 'cameraMovement', v)}
                disabled={isGeneratingAny}
              >
                <SelectTrigger className="h-6 text-[10px] px-1.5 min-w-0 w-auto max-w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAMERA_MOVEMENT_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-[11px]">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 特殊拍摄手法 */}
            <div className="flex items-center gap-1">
              <Select
                value={scene.specialTechnique || 'none'}
                onValueChange={(v) => onUpdateField?.(scene.id, 'specialTechnique', v)}
                disabled={isGeneratingAny}
              >
                <SelectTrigger className="h-6 text-[10px] px-1.5 min-w-0 w-auto max-w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPECIAL_TECHNIQUE_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-[11px]">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 拍摄角度 */}
            <div className="flex items-center gap-1">
              <Select
                value={scene.cameraAngle || 'eye-level'}
                onValueChange={(v) => onUpdateField?.(scene.id, 'cameraAngle', v)}
                disabled={isGeneratingAny}
              >
                <SelectTrigger className="h-6 text-[10px] px-1.5 min-w-0 w-auto max-w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAMERA_ANGLE_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-[11px]">
                      {p.emoji} {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 焦距 */}
            <div className="flex items-center gap-1">
              <Select
                value={scene.focalLength || '50mm'}
                onValueChange={(v) => onUpdateField?.(scene.id, 'focalLength', v)}
                disabled={isGeneratingAny}
              >
                <SelectTrigger className="h-6 text-[10px] px-1.5 min-w-0 w-auto max-w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOCAL_LENGTH_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-[11px]">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 摄影技法 */}
            <div className="flex items-center gap-1">
              <Select
                value={scene.photographyTechnique || 'none'}
                onValueChange={(v) => onUpdateField?.(scene.id, 'photographyTechnique', v === 'none' ? undefined : v)}
                disabled={isGeneratingAny}
              >
                <SelectTrigger className="h-6 text-[10px] px-1.5 min-w-0 w-auto max-w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-[11px]">无技法</SelectItem>
                  {PHOTOGRAPHY_TECHNIQUE_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-[11px]">
                      {p.emoji} {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* 机位描述（AI 生成的自由文本） */}
          {scene.cameraPosition && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground shrink-0">机位:</span>
              <span className="text-[10px] text-muted-foreground/80 truncate">{scene.cameraPosition}</span>
            </div>
          )}
          {/* 情绪氛围 */}
          <div>
            <EmotionTags
              value={scene.emotionTags || []}
              onChange={(tags) => onUpdateEmotions(scene.id, tags)}
              disabled={isGeneratingAny}
            />
          </div>
        </div>

        {/* 第四排：音频控制（环境音/音效/对白） */}
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground mb-0.5 block">音频控制</Label>
          {/* 环境音 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onUpdateField?.(scene.id, 'audioAmbientEnabled', scene.audioAmbientEnabled === false)}
              disabled={isGeneratingAny}
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded shrink-0 w-12 text-center transition-colors",
                scene.audioAmbientEnabled !== false
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground line-through"
              )}
            >
              环境音
            </button>
            <input
              type="text"
              value={scene.ambientSound || ''}
              onChange={(e) => onUpdateAmbientSound(scene.id, e.target.value)}
              placeholder="风声、雨声、鸟鸣..."
              disabled={isGeneratingAny || scene.audioAmbientEnabled === false}
              className="flex-1 h-6 px-1.5 text-[10px] rounded border bg-transparent disabled:opacity-40 placeholder:text-muted-foreground/30"
            />
          </div>
          {/* 音效 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onUpdateField?.(scene.id, 'audioSfxEnabled', scene.audioSfxEnabled === false)}
              disabled={isGeneratingAny}
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded shrink-0 w-12 text-center transition-colors",
                scene.audioSfxEnabled !== false
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground line-through"
              )}
            >
              音效
            </button>
            <input
              type="text"
              value={scene.soundEffectText || ''}
              onChange={(e) => onUpdateField?.(scene.id, 'soundEffectText', e.target.value)}
              placeholder="脚步声、门关声..."
              disabled={isGeneratingAny || scene.audioSfxEnabled === false}
              className="flex-1 h-6 px-1.5 text-[10px] rounded border bg-transparent disabled:opacity-40 placeholder:text-muted-foreground/30"
            />
          </div>
          {/* 对白 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onUpdateField?.(scene.id, 'audioDialogueEnabled', scene.audioDialogueEnabled === false)}
              disabled={isGeneratingAny}
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded shrink-0 w-12 text-center transition-colors",
                scene.audioDialogueEnabled !== false
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground line-through"
              )}
            >
              对白
            </button>
            <input
              type="text"
              value={scene.dialogue || ''}
              onChange={(e) => onUpdateField?.(scene.id, 'dialogue', e.target.value)}
              placeholder="角色台词..."
              disabled={isGeneratingAny || scene.audioDialogueEnabled === false}
              className="flex-1 h-6 px-1.5 text-[10px] rounded border bg-transparent disabled:opacity-40 placeholder:text-muted-foreground/30"
            />
          </div>
          {/* 背景音乐 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onUpdateField?.(scene.id, 'audioBgmEnabled', !(scene.audioBgmEnabled === true))}
              disabled={isGeneratingAny}
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded shrink-0 w-12 text-center transition-colors",
                scene.audioBgmEnabled === true
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground line-through"
              )}
            >
              音乐
            </button>
            <input
              type="text"
              value={scene.backgroundMusic || ''}
              onChange={(e) => onUpdateField?.(scene.id, 'backgroundMusic', e.target.value)}
              placeholder="默认禁止背景音乐，如需要请开启并填写..."
              disabled={isGeneratingAny || scene.audioBgmEnabled !== true}
              className="flex-1 h-6 px-1.5 text-[10px] rounded border bg-transparent disabled:opacity-40 placeholder:text-muted-foreground/30"
            />
          </div>
        </div>
        <SceneVoiceLinePanel scene={scene} />
    </div>
  );
}
