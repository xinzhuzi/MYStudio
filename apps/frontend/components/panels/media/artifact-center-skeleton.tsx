// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Extracted from ArtifactCenter.tsx (behavior-preserving refactor).
// 产物表格加载骨架(镜像真实表 6 列列宽,加载→真实无 layout shift)
// 遵循 emil-design-eng:用 Skeleton 自带 animate-pulse(opacity),主线程忙时比 JS 动画流畅

import { Skeleton } from "@/components/ui/skeleton";

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
