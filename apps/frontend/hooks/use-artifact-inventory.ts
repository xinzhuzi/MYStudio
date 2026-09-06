// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Extracted from ArtifactCenter.tsx (behavior-preserving refactor).
//
// Owns the artifact inventory refresh lifecycle: kicks off a scan on mount and
// whenever the active project changes, threading the result back into the
// artifact store. Skipped entirely when mock data is supplied (testing).

import { useCallback, useEffect, useRef } from "react";
import { loadArtifactInventory, useArtifactStore } from "@/stores/artifacts/artifact-store";
import type { ArtifactRecord } from "@/types/artifacts";

export function useArtifactInventory(activeProjectId: string | null, mockArtifacts?: ArtifactRecord[]) {
  const startScan = useArtifactStore((state) => state.startScan);
  const finishScan = useArtifactStore((state) => state.finishScan);
  const setScanError = useArtifactStore((state) => state.setError);
  const loading = useArtifactStore((state) => state.loading);
  // 递增令牌:await 期间项目切换/再次刷新时,旧响应不得回写覆盖新视图
  const requestSeq = useRef(0);

  const refreshInventory = useCallback(async () => {
    if (!activeProjectId || mockArtifacts) return;
    const token = ++requestSeq.current;
    startScan();
    try {
      const result = await loadArtifactInventory(activeProjectId);
      if (token !== requestSeq.current) return;
      if (result.success) finishScan(result.data.artifacts);
      else setScanError(result.error);
    } catch (error) {
      // IPC 桥本身 reject 时也必须收口,否则 loading 永卡且 unhandled rejection
      if (token !== requestSeq.current) return;
      setScanError(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectId, mockArtifacts, startScan, finishScan, setScanError]);

  useEffect(() => {
    void refreshInventory();
  }, [refreshInventory]);

  return { refreshInventory, loading };
}
