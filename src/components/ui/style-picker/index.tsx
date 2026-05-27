// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * StylePicker - 统一的视觉风格选择器
 * 
 * 功能：
 * - 左侧：分类小图列表，可滚动
 * - 右侧：悬停/选中时显示大图预览 + 描述
 * - 支持下拉弹出模式和内嵌模式
 */

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  STYLE_CATEGORIES,
  VISUAL_STYLE_PRESETS,
  getStyleById,
  type StylePreset,
  type VisualStyleId,
} from "@/lib/constants/visual-styles";
import { getStyleThumbnailSource } from "@/lib/constants/visual-style-thumbnails";
import { useCustomStyleStore } from "@/stores/custom-style-store";

// 风格分类对应的背景色（图片已移除，使用色块占位）
const CATEGORY_COLORS: Record<string, string> = {
  '3d': 'bg-blue-500/20 text-blue-600',
  '2d': 'bg-green-500/20 text-green-600',
  'real': 'bg-amber-500/20 text-amber-600',
  'stop_motion': 'bg-purple-500/20 text-purple-600',
};

interface StylePickerProps {
  /** 当前选中的风格 ID */
  value: string;
  /** 选择变化回调 */
  onChange: (styleId: VisualStyleId) => void;
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
}

/**
 * 风格选择器组件
 */
export function StylePicker({
  value,
  onChange,
  popover = true,
  trigger,
  className,
  disabled = false,
  placeholder = "选择风格",
}: StylePickerProps) {
  const [hoveredStyle, setHoveredStyle] = useState<StylePreset | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // 用户自定义风格（用户数据，存储在 localStorage）
  const customStyles = useCustomStyleStore((s) => s.styles);
  const customAsPresets: StylePreset[] = useMemo(() =>
    customStyles.map((s) => ({
      id: s.id,
      name: s.name,
      category: '2d' as const,
      mediaType: 'animation' as const,
      prompt: s.prompt || '',
      negativePrompt: s.negativePrompt || '',
      description: s.description || '',
      thumbnail: s.referenceImages[0] || '',
    })),
    [customStyles]
  );

  // 获取当前选中的风格（内置 + 自定义）
  const selectedStyle = useMemo(() => getStyleById(value), [value]);

  // 预览的风格（悬停优先，否则显示选中的）
  const previewStyle = hoveredStyle || selectedStyle || VISUAL_STYLE_PRESETS[0];
  const previewThumbnail = previewStyle.id.startsWith('custom_style_')
    ? previewStyle.thumbnail
    : getStyleThumbnailSource(previewStyle);

  // 处理选择
  const handleSelect = (style: StylePreset) => {
    onChange(style.id as VisualStyleId);
    if (popover) {
      setIsOpen(false);
    }
  };

  // 内容面板
  const pickerContent = (
    <div className={cn("flex", popover ? "w-[520px] h-[400px]" : "w-full h-full", className)}>
      {/* 左侧：风格列表 */}
      <ScrollArea className="w-[240px] border-r border-border">
        <div className="p-2">
          {STYLE_CATEGORIES.map((category) => (
            <div key={category.id} className="mb-4">
              {/* 分类标题 */}
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/50 mb-2">
                {category.name}
              </div>
              {/* 风格列表 */}
              <div className="space-y-1">
                {category.styles.map((style) => (
                  <StyleItem
                    key={style.id}
                    style={style}
                    isSelected={value === style.id}
                    onSelect={() => handleSelect(style)}
                    onHover={() => setHoveredStyle(style)}
                    onLeave={() => setHoveredStyle(null)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* 用户自定义风格（用户个人资产） */}
          {customAsPresets.length > 0 && (
            <div className="mb-4">
              <div className="px-2 py-1.5 text-xs font-medium text-primary border-b border-primary/30 mb-2">
                我的风格
              </div>
              <div className="space-y-1">
                {customAsPresets.map((style) => (
                  <StyleItem
                    key={style.id}
                    style={style}
                    isSelected={value === style.id}
                    isCustom
                    onSelect={() => handleSelect(style)}
                    onHover={() => setHoveredStyle(style)}
                    onLeave={() => setHoveredStyle(null)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 右侧：预览信息 */}
      <div className="flex-1 p-4 flex flex-col">
        {/* 预览图 + 风格名称 */}
        <div className="relative flex-1 overflow-hidden rounded-lg bg-muted mb-3">
          {previewThumbnail ? (
            <img
              src={previewThumbnail}
              alt={previewStyle.name}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div className={cn(
              "w-full h-full flex flex-col items-center justify-center",
              CATEGORY_COLORS[previewStyle.category] || 'bg-muted/30'
            )}>
              <div className="text-2xl font-bold mb-2">{previewStyle.name}</div>
              <div className="text-xs opacity-70">{previewStyle.category.toUpperCase()} · {previewStyle.mediaType}</div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-black/45 p-3 text-white">
            <div className="text-sm font-medium">{previewStyle.name}</div>
            <div className="text-[11px] opacity-80">{previewStyle.category.toUpperCase()} · {previewStyle.mediaType}</div>
          </div>
        </div>
        {/* 风格信息 */}
        <div className="text-center">
          <div className="font-medium text-sm mb-1">{previewStyle.name}</div>
          <div className="text-xs text-muted-foreground line-clamp-2">
            {previewStyle.description}
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
                {selectedStyle && (
                  <span className="w-6 h-6 rounded overflow-hidden bg-muted flex items-center justify-center text-[10px] font-bold">
                    {selectedStyle.id.startsWith('custom_style_') && !selectedStyle.thumbnail ? (
                      "★"
                    ) : (
                      <img
                        src={selectedStyle.id.startsWith('custom_style_') ? selectedStyle.thumbnail : getStyleThumbnailSource(selectedStyle)}
                        alt=""
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    )}
                  </span>
                )}
                <span className={!selectedStyle ? "text-muted-foreground" : ""}>
                  {selectedStyle?.name || placeholder}
                </span>
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
 * 单个风格项
 */
interface StyleItemProps {
  style: StylePreset;
  isSelected: boolean;
  isCustom?: boolean;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
}

function StyleItem({ style, isSelected, isCustom, onSelect, onHover, onLeave }: StyleItemProps) {
  const thumbnailSource = isCustom ? style.thumbnail : getStyleThumbnailSource(style);

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
      {/* 缩略图 */}
      <span className={cn(
        "w-10 h-10 rounded overflow-hidden flex items-center justify-center text-[10px] font-bold flex-shrink-0",
        !thumbnailSource && (isCustom ? 'bg-primary/20 text-primary' : CATEGORY_COLORS[style.category] || 'bg-muted')
      )}>
        {thumbnailSource ? (
          <img
            src={thumbnailSource}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          isCustom ? '★' : style.category === '3d' ? '3D' : style.category === '2d' ? '2D' : style.category === 'real' ? '真' : '定'
        )}
      </span>
      {/* 名称 */}
      <span className="flex-1 text-left text-sm truncate">{style.name}</span>
      {/* 选中标记 */}
      {isSelected && (
        <Check className="w-4 h-4 text-primary flex-shrink-0" />
      )}
    </button>
  );
}

export default StylePicker;
