// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for files.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { BookOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Chapter Tree Component
 *
 * Lists the distinct chapters in the active project's artifact inventory.
 * One chapter node per distinct chapter id (artifact.chapterId, or inferred
 * from a `chapter-xxx` segment in physicalRefs when chapterId is absent).
 * Artifacts with no chapter association are grouped under a synthetic
 * "__none__" node labelled "杂项".
 *
 * Clicking a chapter toggles the selectedChapterId filter. The filter composes
 * with the stage filter (chapter ∩ stage), so both columns can be active at
 * once. See ArtifactCenter.tsx handleChapterClick.
 *
 * Props are pure - no IPC calls inside component.
 */

export interface ChapterNode {
  /** Raw chapter id, e.g. "chapter-1"; "__none__" for the ungrouped bucket. */
  id: string;
  /** Human-readable label, e.g. "第 chapter-1 章" or "杂项". */
  label: string;
  /** Number of artifacts in this chapter. */
  count: number;
}

export interface ChapterTreeProps {
  /** Chapters to render, in the order supplied by the parent. */
  chapters: ChapterNode[];

  /** Currently selected chapter id (highlight). */
  selectedChapterId?: string | null;

  /** Callback when a chapter node is clicked (used to toggle the filter). */
  onChapterClick?: (chapterId: string) => void;

  /** Custom className for root element. */
  className?: string;
}

const CHAPTER_ICON: LucideIcon = BookOpen;

export function ChapterTree({
  chapters,
  selectedChapterId = null,
  onChapterClick,
  className,
}: ChapterTreeProps) {
  if (chapters.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-3 text-center text-xs text-muted-foreground py-8">
        当前项目没有章节产物
      </div>
    );
  }

  return (
    <div className={cn("h-full overflow-y-auto scrollbar-thin py-1 pb-3", className)} role="tree">
      {chapters.map((chapter) => {
        const isSelected = chapter.id === selectedChapterId;
        // Chapter row indent (level=0 → 8 px). Historically mirrored the
        // removed ArtifactTree TreeNode styling; kept for visual consistency.
        const paddingLeft = "8px";
        const Icon = CHAPTER_ICON;
        return (
          <div
            key={chapter.id}
            className={cn(
              "flex items-center gap-1 py-1.5 pr-2 hover:bg-muted/50 transition-colors cursor-pointer select-none text-foreground",
              isSelected && "bg-primary/15 text-primary font-medium",
            )}
            style={{ paddingLeft }}
            role="treeitem"
            tabIndex={0}
            onClick={() => onChapterClick?.(chapter.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onChapterClick?.(chapter.id);
              }
            }}
            data-node-id={`chapter__${chapter.id}`}
          >
            {/* Spacer matching the historical expand-toggle column width. */}
            <div className="w-5 shrink-0" />
            <div className="text-muted-foreground shrink-0">
              <Icon className="h-4 w-4" />
            </div>
            <span className="flex-1 text-sm truncate">{chapter.label}</span>
            {chapter.count > 0 && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                {chapter.count}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ChapterTree;
