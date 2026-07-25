// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * CinematographyProfilePicker — 摄影风格档案选择器
 *
 * 功能：
 * - 左侧：按分类显示档案列表（emoji + 名称）
 * - 右侧：悬停/选中时显示详细描述、摄影参数、参考影片
 * - 支持 Popover 弹出模式和内嵌模式
 */

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Camera } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CINEMATOGRAPHY_PROFILE_CATEGORIES,
  CINEMATOGRAPHY_PROFILES,
  getCinematographyProfile,
  type CinematographyProfile,
} from "@/lib/constants/cinematography-profiles";
import { getMediaType, MEDIA_TYPE_LABELS, type MediaType } from "@/lib/constants/visual-styles";
import { isFieldSkipped } from "@/lib/generation/media-type-tokens";

interface CinematographyProfilePickerProps {
  /** 当前选中的档案 ID */
  value: string;
  /** 选择变化回调 */
  onChange: (profileId: string) => void;
  /** 是否使用下拉弹出模式（默认 true） */
  popover?: boolean;
  /** 自定义触发器（仅 popover 模式） */
  trigger?: React.ReactNode;
  /** 自定义类名 */
  className?: string;
  /** 禁用状态 */
  disabled?: boolean;
  /** 未选择时的占位文字 */
  placeholder?: string;
  /** 当前视觉风格 ID（用于显示媒介适配提示） */
  styleId?: string;
}

/**
 * 摄影风格档案选择器
 */
export function CinematographyProfilePicker({
  value,
  onChange,
  popover = true,
  trigger,
  className,
  disabled = false,
  placeholder = "选择摄影风格",
  styleId,
}: CinematographyProfilePickerProps) {
  const [hoveredProfile, setHoveredProfile] = useState<CinematographyProfile | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // 获取当前选中的档案
  const selectedProfile = useMemo(() => getCinematographyProfile(value), [value]);

  // 预览的档案（悬停优先，否则显示选中的，兆底第一个）
  const previewProfile = hoveredProfile || selectedProfile || CINEMATOGRAPHY_PROFILES[0];

  // 媒介类型适配提示
  const mediaType: MediaType | undefined = styleId ? getMediaType(styleId) : undefined;
  const showAdaptHint = mediaType && mediaType !== 'cinematic';

  // 处理选择
  const handleSelect = (profile: CinematographyProfile) => {
    onChange(profile.id);
    if (popover) {
      setIsOpen(false);
    }
  };

  // 内容面板
  const pickerContent = (
    <div className={cn("flex", popover ? "w-[560px] h-[420px]" : "w-full h-full", className)}>
      {/* 左侧：档案列表 */}
      <ScrollArea className="w-[220px] border-r border-border">
        <div className="p-2">
          {CINEMATOGRAPHY_PROFILE_CATEGORIES.map((category) => (
            <div key={category.id} className="mb-4">
              {/* 分类标题 */}
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/50 mb-2">
                {category.emoji} {category.name}
              </div>
              {/* 档案列表 */}
              <div className="space-y-1">
                {category.profiles.map((profile) => (
                  <ProfileItem
                    key={profile.id}
                    profile={profile}
                    isSelected={value === profile.id}
                    onSelect={() => handleSelect(profile)}
                    onHover={() => setHoveredProfile(profile)}
                    onLeave={() => setHoveredProfile(null)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* 右侧：预览 */}
      <div className="flex-1 p-4 flex flex-col overflow-hidden">
        {/* 档案标题 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">{previewProfile.emoji}</span>
          <div>
            <div className="font-medium text-sm">{previewProfile.name}</div>
            <div className="text-xs text-muted-foreground">{previewProfile.nameEn}</div>
          </div>
        </div>

        {/* 描述 */}
        <div className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {previewProfile.description}
        </div>

        {/* 媒介适配提示 */}
        {showAdaptHint && (
          <div className="text-xs mb-3 px-2 py-1.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            ⓘ 当前视觉风格为「{MEDIA_TYPE_LABELS[mediaType]}」媒介，摄影参数将自动适配
            {isFieldSkipped(mediaType, 'cameraRig') && '（器材/景深/转焦将被跳过）'}
          </div>
        )}

        {/* 摄影参数速览 */}
        <ScrollArea className="flex-1 mb-3">
          <div className="space-y-2 text-xs">
            <ParamRow
              label="💡 灯光"
              value={`${previewProfile.defaultLighting.style} · ${previewProfile.defaultLighting.direction} · ${previewProfile.defaultLighting.colorTemperature}`}
            />
            <ParamRow
              label="🔭 焦点"
              value={`${previewProfile.defaultFocus.depthOfField} · ${previewProfile.defaultFocus.focusTransition}`}
            />
            <ParamRow
              label="🎥 器材"
              value={`${previewProfile.defaultRig.cameraRig} · ${previewProfile.defaultRig.movementSpeed}`}
            />
            {previewProfile.defaultAtmosphere.effects.length > 0 && (
              <ParamRow
                label="🌫️ 氛围"
                value={`${previewProfile.defaultAtmosphere.effects.join(" + ")} (${previewProfile.defaultAtmosphere.intensity})`}
              />
            )}
            <ParamRow
              label="⏱️ 速度"
              value={previewProfile.defaultSpeed.playbackSpeed}
            />
          </div>
        </ScrollArea>

        {/* 参考影片 */}
        <div className="border-t border-border/50 pt-2">
          <div className="text-xs text-muted-foreground mb-1">🎞️ 参考影片</div>
          <div className="flex flex-wrap gap-1">
            {previewProfile.referenceFilms.map((film) => (
              <span
                key={film}
                className="inline-block px-1.5 py-0.5 text-xs bg-muted rounded"
              >
                {film}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // 下拉模式
  if (popover) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          {trigger || (
            <button
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-background",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "text-sm w-full justify-between"
              )}
              disabled={disabled}
            >
              <div className="flex items-center gap-2">
                {selectedProfile ? (
                  <>
                    <span>{selectedProfile.emoji}</span>
                    <span>{selectedProfile.name}</span>
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{placeholder}</span>
                  </>
                )}
              </div>
              <svg
                className="w-4 h-4 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-auto"
          align="start"
          sideOffset={4}
        >
          {pickerContent}
        </PopoverContent>
      </Popover>
    );
  }

  // 内嵌模式
  return pickerContent;
}

/**
 * 单个档案项
 */
interface ProfileItemProps {
  profile: CinematographyProfile;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
}

function ProfileItem({ profile, isSelected, onSelect, onHover, onLeave }: ProfileItemProps) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors",
        "hover:bg-accent",
        isSelected && "bg-accent"
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {/* Emoji */}
      <span className="text-base flex-shrink-0">{profile.emoji}</span>
      {/* 名称 */}
      <span className="flex-1 text-left text-sm truncate">{profile.name}</span>
      {/* 选中标记 */}
      {isSelected && (
        <Check className="w-4 h-4 text-primary flex-shrink-0" />
      )}
    </button>
  );
}

/**
 * 参数行
 */
function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

export default CinematographyProfilePicker;
