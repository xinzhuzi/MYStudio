/**
 * ArtifactCenter 子组件——过滤条与表格骨架屏。
 * 08-31 file-size-reduction P2 拆出,体逐字保留。
 */
import { Skeleton } from "@/components/ui/skeleton";
import type { ArtifactStage, ArtifactState } from "@/types/artifacts";
import { FIXED_NAV_STAGES, STAGE_LABELS } from "@/lib/artifacts/stage-labels";

interface FilterBarProps {
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

// 产物表格加载骨架(镜像真实表 6 列列宽,加载→真实无 layout shift)
// 遵循 emil-design-eng:用 Skeleton 自带 animate-pulse(opacity),主线程忙时比 JS 动画流畅
export function ArtifactTableSkeleton() {
  return (
    <table className="w-full text-sm" aria-hidden="true">
      <tbody>
        {Array.from({ length: 6 }).map((_, i) => (
          <tr key={i} className="border-t">
            <td className="p-2 w-10"><Skeleton className="h-4 w-4" /></td>
            <td className="p-2"><Skeleton className="h-4 w-[60%]" /></td>
            <td className="p-2 w-[110px]"><Skeleton className="h-3.5 w-16" /></td>
            <td className="p-2 w-[100px]"><Skeleton className="h-5 w-16 rounded-full" /></td>
            <td className="p-2 w-[100px]"><Skeleton className="h-3.5 w-12" /></td>
            <td className="p-2 w-[180px]"><Skeleton className="h-3.5 w-28" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

