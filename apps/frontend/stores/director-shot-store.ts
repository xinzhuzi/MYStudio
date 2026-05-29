// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Director Shot Store
 * Manages the currently selected shot for the Director stage
 * Enables communication between left panel (grid), center (preview), and right panel (properties)
 */

import { create } from "zustand";
import type { Shot } from "@/types/script";

interface DirectorShotState {
  // Selected shot
  selectedShotId: string | null;
  
  // Preview mode: which frame to show
  previewMode: "start" | "end" | "video";
  
  // Processing state
  processingType: "start" | "end" | "video" | null;
  
  // Actions
  selectShot: (shotId: string | null) => void;
  setPreviewMode: (mode: "start" | "end" | "video") => void;
  setProcessingType: (type: "start" | "end" | "video" | null) => void;
  clearSelection: () => void;
}

export const useDirectorShotStore = create<DirectorShotState>((set) => ({
  selectedShotId: null,
  previewMode: "start",
  processingType: null,
  
  selectShot: (shotId) => set({ selectedShotId: shotId }),
  
  setPreviewMode: (mode) => set({ previewMode: mode }),
  
  setProcessingType: (type) => set({ processingType: type }),
  
  clearSelection: () => set({ 
    selectedShotId: null, 
    previewMode: "start",
    processingType: null,
  }),
}));
