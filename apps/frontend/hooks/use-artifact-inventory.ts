// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Extracted from ArtifactCenter.tsx (behavior-preserving refactor).
//
// Owns the artifact inventory refresh lifecycle: kicks off a scan on mount and
// whenever the active project changes, threading the result back into the
// artifact store. Skipped entirely when mock data is supplied (testing).

import { useCallback, useEffect } from "react";
import { loadArtifactInventory, useArtifactStore } from "@/stores/artifacts/artifact-store";
import type { ArtifactRecord } from "@/types/artifacts";

export function useArtifactInventory(activeProjectId: string | null, mockArtifacts?: ArtifactRecord[]) {
  const startScan = useArtifactStore((state) => state.startScan);
  const finishScan = useArtifactStore((state) => state.finishScan);
  const setScanError = useArtifactStore((state) => state.setError);
  const loading = useArtifactStore((state) => state.loading);

  const refreshInventory = useCallback(async () => {
    if (!activeProjectId || mockArtifacts) return;
    startScan();
    const result = await loadArtifactInventory(activeProjectId);
    if (result.success) finishScan(result.data.artifacts);
    else setScanError(result.error);
  }, [activeProjectId, mockArtifacts, startScan, finishScan, setScanError]);

  useEffect(() => {
    void refreshInventory();
  }, [refreshInventory]);

  return { refreshInventory, loading };
}
