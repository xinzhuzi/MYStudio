// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useState } from "react";
import { X, Save, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Visual config for each ArtifactRecord.state badge. */
export const STATE_INFO: Record<string, { color: string; label: string }> = {
  active: { color: "bg-green-600", label: "活跃" },
  archived: { color: "bg-gray-600", label: "已归档" },
  orphaned: { color: "bg-orange-600", label: "孤儿" },
  blocked: { color: "bg-red-600", label: "已阻塞" },
  unknown: { color: "bg-yellow-600", label: "未知" },
};

/** Locale-aware timestamp formatting for the metadata tab. */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Human-readable byte size (B/KB/MB/GB). */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

interface EditableFieldProps<T extends string | string[] | undefined> {
  label: string;
  value: T;
  onSave: (newValue: T) => Promise<void>;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  placeholder?: string;
}

/**
 * Inline-editable metadata field (name / notes). String values edit directly;
 * array values edit as a JSON string and parse on save.
 */
export function EditableField({
  label,
  value,
  onSave,
  isEditing,
  setIsEditing,
  placeholder,
}: EditableFieldProps<any>) {
  const [tempValue, setTempValue] = useState<string>(
    typeof value === "string" ? value : JSON.stringify(value)
  );

  useEffect(() => {
    if (!isEditing) {
      setTempValue(typeof value === "string" ? value : JSON.stringify(value));
    }
  }, [isEditing, value]);

  const handleSave = async () => {
    try {
      let newValue: any = tempValue;
      if (typeof value === "object" && value !== null) {
        try {
          newValue = JSON.parse(tempValue);
        } catch {
          // Keep original if parse fails
          return;
        }
      }
      await onSave(newValue);
    } finally {
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setTempValue(typeof value === "string" ? value : JSON.stringify(value));
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus
          className="flex-1"
        />
        <Button size="icon" variant="ghost" onClick={handleSave}>
          <Save className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setIsEditing(false)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between group">
      <div className="text-sm text-muted-foreground flex-1 truncate">
        {value || <span className="italic text-muted-foreground">未设置</span>}
      </div>
      <button
        onClick={() => setIsEditing(true)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
      >
        <FileText className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}
