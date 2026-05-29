// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 时长选择器组件 (Duration Selector)
 * 用于选择视频生成时长：4-12秒（Seedance 1.5 Pro 支持范围）
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DURATION_PRESETS, type DurationType } from "@/stores/director-store";
import { Clock } from "lucide-react";

interface DurationSelectorProps {
  value: DurationType;
  onChange: (value: DurationType) => void;
  disabled?: boolean;
  className?: string;
}

export function DurationSelector({
  value,
  onChange,
  disabled,
  className,
}: DurationSelectorProps) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(Number(v) as DurationType)}
      disabled={disabled}
    >
      <SelectTrigger className={`h-7 text-xs w-20 ${className || ""}`}>
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {DURATION_PRESETS.map((preset) => (
          <SelectItem key={preset.id} value={String(preset.id)}>
            {preset.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
