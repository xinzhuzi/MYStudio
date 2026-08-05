// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { create } from "zustand";
import type {
  ArtifactRecord,
  DeletionPlan,
  ExecuteResult,
  InventoryResult,
  PlanResult,
  MetadataUpdateResult,
  DeletionConfirmation,
} from "@/types/artifacts";

/**
 * Artifact Inventory Store
 *
 * Manages local state and caching logic for artifact inventory scans.
 * Does NOT call IPC directly - exposes useArtifactScan() hook for IPC handling.
 *
 * Pattern follows media-panel-store.ts: Zustand-based reactive state management.
 */

interface ArtifactStoreState {
  // State fields
  loading: boolean; // Is scan in progress?
  error: string | null; // Last error message
  artifacts: ArtifactRecord[]; // Cached inventory
  selectedChapterId: string | null; // Current chapter filter
  selectedArtifactIds: Set<string>; // For multi-selection
  lastScanTime: number; // Timestamp of last successful scan

  // Actions
  startScan: () => void;
  finishScan: (artifacts: ArtifactRecord[]) => void;
  setError: (err: string) => void;
  setChapterFilter: (chapterId?: string) => void;
  toggleArtifactSelection: (id: string) => void;
  clearSelection: () => void;
  reset: () => void;

  // Selectors
  getFilteredArtifacts: () => ArtifactRecord[];
  getSelectedArtifacts: () => ArtifactRecord[];
  hasActiveJobs: () => boolean;
}

export const useArtifactStore = create<ArtifactStoreState>((set, get) => ({
  // Initial state
  loading: false,
  error: null,
  artifacts: [],
  selectedChapterId: null,
  selectedArtifactIds: new Set<string>(),
  lastScanTime: 0,

  // Actions
  startScan: () => set({ loading: true, error: null }),

  finishScan: (artifacts) => set({
    artifacts,
    loading: false,
    error: null,
    lastScanTime: Date.now(),
  }),

  setError: (err) => set({ error: err, loading: false }),

  setChapterFilter: (chapterId) => {
    // Clear selection when changing chapters
    if (chapterId !== get().selectedChapterId) {
      get().clearSelection();
    }
    set({ selectedChapterId: chapterId || null });
  },

  toggleArtifactSelection: (id) => {
    const current = new Set(get().selectedArtifactIds);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    set({ selectedArtifactIds: current });
  },

  clearSelection: () => set({ selectedArtifactIds: new Set<string>() }),

  reset: () => set({
    loading: false,
    error: null,
    artifacts: [],
    selectedChapterId: null,
    selectedArtifactIds: new Set<string>(),
    lastScanTime: 0,
  }),

  // Selectors
  getFilteredArtifacts: () => {
    const { artifacts, selectedChapterId } = get();
    if (!selectedChapterId) {
      return artifacts;
    }
    return artifacts.filter(a => a.chapterId === selectedChapterId);
  },

  getSelectedArtifacts: () => {
    const { artifacts, selectedArtifactIds } = get();
    const idSet = new Set(selectedArtifactIds);
    return artifacts.filter(a => idSet.has(a.id));
  },

  hasActiveJobs: () => {
    const { artifacts } = get();
    // Check if any artifacts have running jobs as blockers
    return artifacts.some(artifact => {
      // RunningJob blockers would be indicated by specific deletePolicy or blockerReason
      return artifact.deletePolicy === "blocker-running-job" ||
             artifact.blockerReason?.includes("RunningJob");
    });
  },
}));

export async function loadArtifactInventory(projectId: string, chapterId?: string): Promise<InventoryResult> {
  if (typeof window === "undefined" || !window.artifactInventory) return { success: false, error: "产物盘点桥接不可用" };
  return window.artifactInventory.scan(projectId, chapterId);
}

export async function createArtifactDeletionPlan(request: {
  projectId: string;
  /** Required for chapter scope. Empty string allowed for artifacts scope
   *  (folder/file/selection delete that may span chapters). */
  chapterId: string;
  scope: "chapter" | "artifacts";
  artifactIds?: string[];
}): Promise<PlanResult> {
  if (typeof window === "undefined" || !window.artifactPlanDeletion) return { success: false, error: "删除计划桥接不可用" };
  return window.artifactPlanDeletion.plan(request);
}

export async function updateArtifactMetadata(request: {
  projectId: string;
  artifactId: string;
  updates: { name?: string; tags?: string[]; notes?: string };
}): Promise<MetadataUpdateResult> {
  if (typeof window === "undefined" || !window.artifactMetadata) return { success: false, error: "产物元数据桥接不可用" };
  return window.artifactMetadata.update(request);
}

export function getDeletionPlanConfirmation(plan: DeletionPlan): DeletionConfirmation {
  return plan.scope === "chapter"
    ? { type: "chapter", chapterId: plan.chapterId }
    : { type: "artifacts", artifactCount: plan.deleteItems.length + plan.migrateItems.length };
}

export function isDeletionPlanConfirmationValid(
  plan: DeletionPlan,
  confirmation: DeletionConfirmation,
): boolean {
  if (confirmation.type === "chapter") {
    return plan.scope === "chapter" && confirmation.chapterId === plan.chapterId;
  }
  return plan.scope === "artifacts"
    && confirmation.artifactCount === plan.deleteItems.length + plan.migrateItems.length;
}

/** Execute only a registered, reviewed plan through the single renderer controller. */
export async function executeArtifactDeletionPlan(
  plan: DeletionPlan,
  confirmation = getDeletionPlanConfirmation(plan),
): Promise<ExecuteResult> {
  if (!plan.executionAllowed || plan.blockerItems.length > 0) {
    return { success: false, error: "post-scan-orphans", journalState: "none" };
  }
  if (!isDeletionPlanConfirmationValid(plan, confirmation)) {
    return { success: false, error: "confirmation-mismatch", journalState: "none" };
  }
  if (typeof window === "undefined" || !window.artifactDeletion) {
    return { success: false, error: "journal-transition-failed", journalState: "none" };
  }
  return window.artifactDeletion.execute({
    planId: plan.planId,
    fingerprint: plan.fingerprint,
    confirmation,
  });
}

/** Build the irreversible confirmation text shared by every workflow entry. */
export function formatDeletionPlanConfirmation(plan: DeletionPlan): string {
  const lines = [
    "删除后无法恢复。",
    `项目：${plan.projectId}`,
    `章节：${plan.chapterId}`,
    `将删除 ${plan.deleteItems.length} 项，迁移 ${plan.migrateItems.length} 项，保留 ${plan.retainItems.length} 项，阻塞 ${plan.blockerItems.length} 项。`,
    `释放空间：${plan.byteTotals.deleteBytes} bytes；历史备份影响：${plan.backupImpact.length} 项。`,
    "",
    "【删除】",
    ...plan.deleteItems.map((item) => formatPlanItem(item)),
    "【迁移】",
    ...plan.migrateItems.map((item) => formatPlanItem(item)),
    "【保留】",
    ...plan.retainItems.map((item) => formatPlanItem(item)),
    "【阻塞】",
    ...plan.blockerItems.map((item) => formatPlanItem(item)),
    "【备份】",
    ...plan.backupImpact.map((impact) => `${impact.action}：${impact.filePath}${impact.reason ? `（${impact.reason}）` : ""}`),
    "",
    "确认继续？",
  ];
  return lines.join("\n");
}

function formatPlanItem(item: DeletionPlan["deleteItems"][number]): string {
  return `- ${item.name} [${item.stage}/${item.kind}]${item.physicalPath ? `：${item.physicalPath}` : ""}${item.reason ? `（${item.reason}）` : ""}`;
}

export async function requestChapterDeletion(
  projectId: string,
  chapterId: string,
  scope: "chapter" | "artifacts",
  artifactIds?: string[],
  confirmation?: { chapterId?: string; artifactCount?: number },
): Promise<ExecuteResult> {
  const planResult = await createArtifactDeletionPlan({ projectId, chapterId, scope, artifactIds });
  if (!planResult.success) return { success: false, error: "post-scan-orphans", journalState: "none" };
  const plan: DeletionPlan = planResult.data;
  if (!plan.executionAllowed || plan.blockerItems.length > 0) {
    return { success: false, error: "post-scan-orphans", journalState: "none" };
  }
  if (typeof window === "undefined" || !window.artifactDeletion) return { success: false, error: "journal-transition-failed", journalState: "none" };
  if (scope === "chapter" && confirmation?.chapterId !== plan.chapterId) {
    return { success: false, error: "confirmation-mismatch", journalState: "none" };
  }
  if (scope === "artifacts" && confirmation?.artifactCount !== plan.deleteItems.length + plan.migrateItems.length) {
    return { success: false, error: "confirmation-mismatch", journalState: "none" };
  }
  return executeArtifactDeletionPlan(plan, scope === "chapter"
    ? { type: "chapter", chapterId }
    : { type: "artifacts", artifactCount: plan.deleteItems.length + plan.migrateItems.length });
}
