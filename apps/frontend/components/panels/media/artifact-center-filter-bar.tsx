// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Extracted from ArtifactCenter.tsx (behavior-preserving refactor).
// Pure presentational component — no behavior change.

import { FIXED_NAV_STAGES, STAGE_LABELS } from "@/lib/artifacts/stage-labels";
import type { ArtifactStage, ArtifactState } from "@/types/artifacts";

export interface FilterBarProps {
  stageFilter: ArtifactStage | 'all';
  stateFilter: ArtifactState | 'all';
  onStageFilterChange: (stage: ArtifactStage | 'all') => void;
  onStateFilterChange: (state: ArtifactState | 'all') => void;
  totalArtifacts: number;
}

export function FilterBar({
  stageFilter,
  stateFilter,
  onStageFilterChange,
  onStateFilterChange,
  totalArtifacts,
}: FilterBarProps) {
  return (
    <>
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        共 {totalArtifacts} 个产物
      </div>

      {/* Stage filter */}
      <select
          value={stageFilter}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={(e) => onStageFilterChange(e.target.value as any)}
          className="px-2 py-1 text-xs border rounded bg-background h-8"
        >
          <option value="all">所有阶段</option>
          {FIXED_NAV_STAGES.map((stage) => (
            <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
          ))}
        </select>

        {/* State filter */}
        <select
          value={stateFilter}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={(e) => onStateFilterChange(e.target.value as any)}
          className="px-2 py-1 text-xs border rounded bg-background h-8"
        >
          <option value="all">所有状态</option>
          <option value="active">活跃</option>
          <option value="archived">已归档</option>
          <option value="orphaned">孤儿</option>
          <option value="blocked">已阻塞</option>
        </select>
    </>
  );
}
