// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback } from "react";
import { useArtifactStore } from "@/stores/artifacts/artifact-store";
import type { ArtifactRecord, InventoryResult } from "@/types/artifacts";

/**
 * Artifact Scan Hook
 *
 * Handles IPC calls to artifact inventory service and updates store state.
 * Follows separation of concerns: store manages state, hook handles async IPC.
 *
 * Usage:
 * ```ts
 * const scanArtifacts = useArtifactScan();
 * const filteredArtifacts = useArtifactStore(state => state.getFilteredArtifacts());
 *
 * const handleScan = async () => {
 *   await scanArtifacts(projectId, chapterId);
 * };
 * ```
 */
export function useArtifactScan() {
  const startScan = useArtifactStore((state) => state.startScan);
  const finishScan = useArtifactStore((state) => state.finishScan);
  const setError = useArtifactStore((state) => state.setError);

  /**
   * Scan project/chapter for artifacts via IPC
   *
   * @param projectId - Project ID to scan
   * @param chapterId - Optional chapter filter
   * @returns Promise that resolves when scan completes
   */
  const scanArtifacts = useCallback(async (
    projectId: string,
    chapterId?: string,
  ): Promise<InventoryResult> => {
    try {
      // Set loading state
      startScan();

      // Call IPC via window.artifactInventory bridge
      // Note: IPC handler 'artifact-inventory-scan' is defined in:
      // apps/frontend/electron/ipc/files/artifact-management-ipc.ts
      const ipcResult = await window.artifactInventory?.scan(projectId, chapterId);

      if (!ipcResult) {
        throw new Error("IPC returned null result");
      }

      const result: InventoryResult = ipcResult;

      // Check for error response
      if (!result.success) {
        const errorMessage = result.error || "Unknown error during artifact scan";
        setError(errorMessage);
        throw new Error(errorMessage);
      }

      // Extract artifacts from successful response
      const artifacts = result.data?.artifacts || [];

      // Update store with results
      finishScan(artifacts);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to scan artifacts";
      setError(message);
      throw error;
    }
  }, [startScan, finishScan, setError]);

  return scanArtifacts;
}

/**
 * Artifact Selection Hook
 *
 * Provides convenient selection management based on current filter context.
 */
export function useArtifactSelection() {
  const setChapterFilter = useArtifactStore((state) => state.setChapterFilter);
  const toggleArtifactSelection = useArtifactStore((state) => state.toggleArtifactSelection);
  const clearSelection = useArtifactStore((state) => state.clearSelection);
  const selectedChapterId = useArtifactStore((state) => state.selectedChapterId);
  const getSelectedArtifactsSelector = useArtifactStore((state) => state.getSelectedArtifacts);
  const getFilteredArtifactsSelector = useArtifactStore((state) => state.getFilteredArtifacts);

  /**
   * Select all visible artifacts in current filter context
   */
  const selectAllVisible = useCallback(() => {
    const filtered = getFilteredArtifactsSelector();
    filtered.forEach(artifact => toggleArtifactSelection(artifact.id));
  }, [getFilteredArtifactsSelector, toggleArtifactSelection]);

  /**
   * Deselect all currently selected artifacts
   */
  const deselectAll = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  /**
   * Toggle chapter filter and clear selection
   */
  const changeChapterFilter = useCallback((chapterId?: string) => {
    setChapterFilter(chapterId);
  }, [setChapterFilter]);

  return {
    selectedChapterId,
    isSelected: (id: string) => getSelectedArtifactsSelector().some(a => a.id === id),
    selectAllVisible,
    deselectAll,
    toggle: toggleArtifactSelection,
    changeChapterFilter,
    selectedCount: getSelectedArtifactsSelector().length,
    visibleCount: getFilteredArtifactsSelector().length,
  };
}
