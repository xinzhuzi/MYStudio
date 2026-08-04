// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  File,
  Folder,
  Image,
  Video,
  CheckCircle,
  AlertCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactRecord, ArtifactStage, ArtifactState } from "@/types/artifacts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Artifact Table Component
 *
 * Dense sortable table for artifact inventory
 * Supports single/multi selection via checkbox or Shift-click range
 * Filters by stage and state
 *
 * Props are pure - no IPC calls inside component
 */

export interface ArtifactTableProps {
  /** List of artifacts to display */
  artifacts: ArtifactRecord[];

  /** Currently selected artifact IDs */
  selectedIds?: Set<string>;

  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: Set<string>) => void;

  /** Callback when an artifact row is clicked */
  onArtifactClick?: (artifact: ArtifactRecord) => void;

  /** Current filter by stage */
  stageFilter?: ArtifactStage | 'all';

  /** Current filter by state */
  stateFilter?: ArtifactState | 'all';

  /** Sort configuration */
  sortBy?: keyof ArtifactRecord;
  sortOrder?: 'asc' | 'desc';

  /** Optional callback for sort change */
  onSortChange?: (sortBy: keyof ArtifactRecord, sortOrder: 'asc' | 'desc') => void;

  /** Custom className for root element */
  className?: string;
}

const STAGE_LABELS: Record<ArtifactStage, string> = {
  "novel": "小说导入",
  "analysis": "内容分析",
  "script": "剧本生成",
  "assets": "素材准备",
  "storyboard": "分镜设计",
  "image": "图像生成",
  "voice": "语音合成",
  "production": "视频生产",
  "editing": "剪辑编辑",
  "remotion": "Remotion 编排",
  "export": "导出输出",
  "backup": "备份归档",
  "media-library": "媒体库",
};

const STATE_ICONS_AND_COLORS: Record<ArtifactState, { icon: React.ReactNode; color: string }> = {
  "active": { icon: <CheckCircle className="h-4 w-4" />, color: "text-green-600 dark:text-green-400" },
  "archived": { icon: <Clock className="h-4 w-4" />, color: "text-gray-600 dark:text-gray-400" },
  "orphaned": { icon: <XCircle className="h-4 w-4" />, color: "text-orange-600 dark:text-orange-400" },
  "blocked": { icon: <AlertCircle className="h-4 w-4" />, color: "text-red-600 dark:text-red-400" },
  "unknown": { icon: <AlertCircle className="h-4 w-4" />, color: "text-yellow-600 dark:text-yellow-400" },
};

function formatBytes(bytes?: number): string {
  if (!bytes) return "-";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getKindIcon(kind: string): React.ReactNode {
  if (kind.includes("video") || kind.includes("image")) {
    return <Image className="h-4 w-4" />;
  }
  if (kind.includes("audio") || kind.includes("voice") || kind.includes("tts")) {
    return <Video className="h-4 w-4" />;
  }
  return <File className="h-4 w-4" />;
}

export function ArtifactTable({
  artifacts,
  selectedIds = new Set(),
  onSelectionChange,
  onArtifactClick,
  stageFilter = 'all',
  stateFilter = 'all',
  sortBy = 'name',
  sortOrder = 'asc',
  onSortChange,
  className,
}: ArtifactTableProps) {
  const [shiftKeyDown, setShiftKeyDown] = useState(false);

  // Filter artifacts
  const filteredArtifacts = useMemo(() => {
    return artifacts.filter(a => {
      if (stageFilter !== 'all' && a.stage !== stageFilter) return false;
      if (stateFilter !== 'all' && a.state !== stateFilter) return false;
      return true;
    });
  }, [artifacts, stageFilter, stateFilter]);

  // Sort artifacts
  const sortedArtifacts = useMemo(() => {
    const sorted = [...filteredArtifacts].sort((a, b) => {
      let valueA: any = a[sortBy];
      let valueB: any = b[sortBy];

      // Handle special cases
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        valueA = new Date(valueA).getTime();
        valueB = new Date(valueB).getTime();
      } else if (typeof valueA === 'string') {
        valueA = valueA.toLowerCase();
        valueB = valueB.toLowerCase();
      }

      if (valueA < valueB) return sortOrder === 'asc' ? -1 : 1;
      if (valueA > valueB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [filteredArtifacts, sortBy, sortOrder]);

  // Toggle selection with shift-click support
  const lastSelectedRef = useRef<string | null>(null);

  const handleSelect = useCallback((id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onSelectionChange) return;

    const newSet = new Set(selectedIds);

    if (shiftKeyDown && lastSelectedRef.current) {
      // Range selection
      const allIds = sortedArtifacts.map(a => a.id);
      const startIndex = allIds.indexOf(lastSelectedRef.current);
      const endIndex = allIds.indexOf(id);
      if (startIndex !== -1 && endIndex !== -1) {
        const [min, max] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];
        for (let i = min; i <= max; i++) {
          newSet.add(allIds[i]);
        }
      }
    } else {
      // Single toggle
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
    }

    lastSelectedRef.current = id;
    onSelectionChange(newSet);
  }, [selectedIds, onSelectionChange, sortedArtifacts, shiftKeyDown]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    setShiftKeyDown(e.shiftKey);
  }, []);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    setShiftKeyDown(!e.shiftKey);
  }, []);

  const handleSort = useCallback((column: keyof ArtifactRecord) => {
    if (!onSortChange) return;
    if (sortBy === column) {
      onSortChange(column, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChange(column, 'asc');
    }
  }, [sortBy, sortOrder, onSortChange]);

  const SortButton = ({ column }: { column: keyof ArtifactRecord }) => {
    const isActive = sortBy === column;
    const Icon = sortOrder === 'asc' ? ChevronUp : ChevronDown;

    return (
      <button
        onClick={() => handleSort(column)}
        className="flex items-center gap-1 hover:text-primary"
      >
        {column.toString().replace(/([A-Z])/g, ' $1').trim()}
        {isActive && <Icon className="h-3 w-3" />}
      </button>
    );
  };

  // Keyboard event handlers for shift key tracking
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Shift') setShiftKeyDown(true);
    };
    const handleKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Shift') setShiftKeyDown(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const totalSize = useMemo(() => {
    return sortedArtifacts.reduce((sum, a) => sum + (a.bytes || 0), 0);
  }, [sortedArtifacts]);

  return (
    <div
      className={cn("h-full flex flex-col", className)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {/* Summary bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="text-sm text-muted-foreground">
          {sortedArtifacts.length} 个条目，{formatBytes(totalSize)}
        </div>

        {/* Stage filter dropdown */}
        <select
          value={stageFilter}
          onChange={(e) => {}}
          className="px-2 py-1 text-xs border rounded bg-background"
        >
          <option value="all">所有阶段</option>
          {Object.entries(STAGE_LABELS).map(([stage, label]) => (
            <option key={stage} value={stage}>{label}</option>
          ))}
        </select>

        {/* State filter dropdown */}
        <select
          value={stateFilter}
          onChange={(e) => {}}
          className="px-2 py-1 text-xs border rounded bg-background ml-2"
        >
          <option value="all">所有状态</option>
          <option value="active">活跃</option>
          <option value="archived">已归档</option>
          <option value="orphaned">孤儿</option>
          <option value="blocked">已阻塞</option>
        </select>
      </div>

      {/* Data table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={sortedArtifacts.length > 0 && sortedArtifacts.every(a => selectedIds.has(a.id))}
                  onChange={(e) => {
                    if (onSelectionChange) {
                      const newSet = e.target.checked
                        ? new Set(sortedArtifacts.map(a => a.id))
                        : new Set<string>();
                      onSelectionChange(newSet);
                    }
                  }}
                  className="cursor-pointer"
                />
              </TableHead>
              <TableHead className="w-[250px]">名称</TableHead>
              <TableHead className="w-[120px]"><SortButton column="stage" /></TableHead>
              <TableHead className="w-[100px]">状态</TableHead>
              <TableHead className="w-[100px]"><SortButton column="bytes" /></TableHead>
              <TableHead className="w-[100px]"><SortButton column="updatedAt" /></TableHead>
              <TableHead className="w-[200px]">类型</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedArtifacts.map((artifact) => (
              <TableRow
                key={artifact.id}
                className={cn(
                  "cursor-pointer",
                  selectedIds.has(artifact.id) && "bg-muted/50",
                  artifact.state === 'orphaned' && "text-orange-600 dark:text-orange-400",
                  artifact.state === 'blocked' && "text-red-600 dark:text-red-400",
                )}
                onClick={() => onArtifactClick?.(artifact)}
              >
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(artifact.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleSelect(artifact.id, e);
                    }}
                    className="cursor-pointer"
                  />
                </TableCell>
                <TableCell className="font-medium">
                  {artifact.name}
                </TableCell>
                <TableCell>
                  <span className="text-xs bg-muted px-2 py-1 rounded">
                    {STAGE_LABELS[artifact.stage]}
                  </span>
                </TableCell>
                <TableCell>
                  <div className={cn("flex items-center gap-1", STATE_ICONS_AND_COLORS[artifact.state].color)}>
                    {STATE_ICONS_AND_COLORS[artifact.state].icon}
                    <span className="text-xs capitalize">{artifact.state}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-xs font-mono">{formatBytes(artifact.bytes)}</span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(artifact.updatedAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getKindIcon(artifact.kind)}
                    <span className="text-xs truncate max-w-[120px]" title={artifact.kind}>
                      {artifact.kind}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Empty state */}
        {sortedArtifacts.length === 0 && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            没有符合条件的 artifacts
          </div>
        )}
      </div>
    </div>
  );
}

export default ArtifactTable;
