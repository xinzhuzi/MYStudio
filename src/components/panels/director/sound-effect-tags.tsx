// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 音效标签选择器组件 (Sound Effect Tags)
 * 用于选择镜头的音效标签：自然环境、人物动作、氛围效果等
 */

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SOUND_EFFECT_PRESETS, type SoundEffectTag } from "@/stores/director-store";
import { Volume2, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface SoundEffectTagsProps {
  value: SoundEffectTag[];
  onChange: (tags: SoundEffectTag[]) => void;
  disabled?: boolean;
  maxTags?: number;
}

// 所有音效标签的扁平列表
const ALL_SOUND_EFFECTS = [
  ...SOUND_EFFECT_PRESETS.nature,
  ...SOUND_EFFECT_PRESETS.action,
  ...SOUND_EFFECT_PRESETS.atmosphere,
  ...SOUND_EFFECT_PRESETS.urban,
];

// 分类名称映射
const CATEGORY_LABELS: Record<keyof typeof SOUND_EFFECT_PRESETS, string> = {
  nature: "🌿 自然环境",
  action: "🏃 人物动作",
  atmosphere: "🎭 氛围效果",
  urban: "🏙️ 城市环境",
};

export function SoundEffectTags({
  value,
  onChange,
  disabled,
  maxTags = 5,
}: SoundEffectTagsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleTag = (tagId: SoundEffectTag) => {
    if (value.includes(tagId)) {
      onChange(value.filter((t) => t !== tagId));
    } else if (value.length < maxTags) {
      onChange([...value, tagId]);
    }
  };

  const removeTag = (tagId: SoundEffectTag) => {
    onChange(value.filter((t) => t !== tagId));
  };

  const getTagLabel = (tagId: SoundEffectTag) => {
    const tag = ALL_SOUND_EFFECTS.find((t) => t.id === tagId);
    return tag?.label || tagId;
  };

  return (
    <div className="space-y-1.5">
      {/* 已选标签展示 */}
      <div className="flex flex-wrap gap-1">
        {value.map((tagId) => (
          <span
            key={tagId}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-orange-500/10 text-orange-600 dark:text-orange-400 rounded text-[10px]"
          >
            <Volume2 className="h-2.5 w-2.5" />
            {getTagLabel(tagId)}
            {!disabled && (
              <button
                onClick={() => removeTag(tagId)}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}
        
        {/* 添加按钮 */}
        {value.length < maxTags && !disabled && (
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-dashed border-muted-foreground/30 hover:border-primary/50 rounded text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="h-2.5 w-2.5" />
                音效
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <p className="text-sm font-medium mb-2">选择音效 ({value.length}/{maxTags})</p>
              <div className="max-h-[240px] overflow-y-auto space-y-2">
                {(Object.keys(SOUND_EFFECT_PRESETS) as Array<keyof typeof SOUND_EFFECT_PRESETS>).map(
                  (category) => (
                    <div key={category}>
                      <p className="text-[10px] text-muted-foreground mb-1">
                        {CATEGORY_LABELS[category]}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {SOUND_EFFECT_PRESETS[category].map((tag) => {
                          const isSelected = value.includes(tag.id as SoundEffectTag);
                          const isDisabledTag = !isSelected && value.length >= maxTags;
                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleTag(tag.id as SoundEffectTag)}
                              disabled={isDisabledTag}
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                                isSelected
                                  ? "bg-orange-500 text-white"
                                  : "bg-muted hover:bg-muted-foreground/20",
                                isDisabledTag && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              {tag.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
