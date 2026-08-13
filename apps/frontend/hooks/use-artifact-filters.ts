// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Extracted from ArtifactCenter.tsx (behavior-preserving refactor).
//
// Derives the filtered + sorted artifact list. Pure with respect to its inputs:
// the active filter values (stage/state) and navigation context are passed in,
// and the (currently fixed) sort config is owned internally. No IPC, no store
// writes.

import { useState, useMemo } from "react";
import type { ArtifactRecord, ArtifactStage, ArtifactState } from "@/types/artifacts";
import {
  BACKUP_BUCKET_ID,
  NONE_BUCKET_ID,
  inferChapterId,
  isBackupOnlyArtifact,
} from "@/components/panels/media/artifact-center-utils";

export function useArtifactFilters(
  artifacts: ArtifactRecord[],
  selectedChapterId: string | null,
  fileNavigationActive: boolean,
  stageFilter: ArtifactStage | 'all',
  stateFilter: ArtifactState | 'all',
) {
  // Sort state — fixed config (no setter needed; preserved from original ArtifactCenter)
  const [sortBy] = useState<keyof ArtifactRecord>('updatedAt');
  const [sortOrder] = useState<'asc' | 'desc'>('desc');

  // Filter and sort artifacts
  const filteredArtifacts = useMemo(() => {
    let result = [...artifacts];

    // Chapter filter. Must mirror how the left chapter column is grouped
    // (inferChapterId, with "__none__" for ungrouped), otherwise inferred-
    // chapter artifacts are counted in the column but filtered out of the
    // table. See chapters useMemo and inferChapterId.
    if (selectedChapterId && !fileNavigationActive) {
      if (selectedChapterId === NONE_BUCKET_ID) {
        // 杂项: non-backup artifacts with no inferred chapter.
        result = result.filter(a => !isBackupOnlyArtifact(a) && inferChapterId(a) === null);
      } else if (selectedChapterId === BACKUP_BUCKET_ID) {
        // 备份: backup-only artifacts.
        result = result.filter(a => isBackupOnlyArtifact(a));
      } else {
        // Real chapter: non-backup artifacts whose inferred chapter matches.
        // Must mirror the chapters useMemo bucketing so backup-only artifacts
        // (which may carry the same chapterId from a backup file) are excluded.
        result = result.filter(a => !isBackupOnlyArtifact(a) && inferChapterId(a) === selectedChapterId);
      }
    }

    // Stage filter
    if (stageFilter !== 'all') {
      result = result.filter(a => a.stage === stageFilter);
    }

    // State filter
    if (stateFilter !== 'all') {
      result = result.filter(a => a.state === stateFilter);
    }

    // Sort
    result.sort((a, b) => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      let valueA: any = a[sortBy];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      let valueB: any = b[sortBy];

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

    return result;
  }, [artifacts, fileNavigationActive, selectedChapterId, stageFilter, stateFilter, sortBy, sortOrder]);

  return { filteredArtifacts };
}
