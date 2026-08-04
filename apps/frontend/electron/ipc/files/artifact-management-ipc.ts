/**
 * Artifact Management IPC Handlers
 *
 * Artifact inventory, planning and transactional execution share one typed
 * boundary.  All destructive calls require a plan fingerprint and an exact
 * chapter/selection confirmation; no renderer path is accepted.
 *
 * CURRENT SCOPE:
 * - artifact-inventory-scan: Scan project/chapter for artifacts
 * - artifact-get-project-artifacts: Convenience alias for getting all project artifacts
 * - artifact-plan-deletion: Compute immutable deletion plan
 * - artifact-execute-deletion: Execute the reviewed plan transactionally
 * - artifact-deletion-recovery-query: Recover an interrupted transaction
 *
 * HOW UI CALLS THIS:
 * The renderer process calls this via the preload bridge:
 *   const result = await window.electron.artifactInventory?.scan(projectId, chapterId);
 *   const plan = await window.electron.artifactPlanDeletion?.(planRequest);
 *
 * ERROR HANDLING:
 * All handlers catch errors and return typedExecuteError codes.
 * Errors are serialized properly for cross-process communication.
 */

import { ipcMain } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { scanProjectInventory } from '@/electron/artifacts/artifact-inventory-service';
import type { InventoryResult, PlanRequest, PlanResult, RecoveryQueryResult, MetadataUpdateResult } from '@/types/artifacts';
import { buildDeletionPlan } from '@/lib/artifacts/artifact-dependency-graph';
import { executeDeletion, queryRecovery, registerDeletionPlan } from '@/electron/artifacts/artifact-deletion-service';
import { resolveProjectRootPath } from '@/electron/storage/storage-paths';
import { withFileStorageMutationLocks } from './file-storage-ipc';
import { validateMetadataOverlay } from '@/lib/artifacts/artifact-metadata';

export interface ArtifactManagementIpcContext {
  getDataDir: () => string;
  getMediaRoot?: () => string;
}

let artifactContext: ArtifactManagementIpcContext = {
  getDataDir: () => process.env.MYSTUDIO_APP_DATA_DIR || '',
};

export function configureArtifactManagementIpc(context: ArtifactManagementIpcContext): void {
  artifactContext = context;
}

// ============================================================================
// ARTIFACT INVENTORY HANDLERS (SCAN ONLY)
// ============================================================================

/**
 * HANDLER: artifact-inventory-scan
 *
 * Scans a project (optionally filtered by chapter) and returns a complete
 * inventory of artifacts that could potentially be deleted.
 *
 * This is the PRIMARY entry point for artifact inventory operations.
 * The UI should call this via the preload bridge method:
 *   window.electron.artifactInventory.scan(projectId, chapterId?)
 *
 * PAYLOAD:
 * {
 *   projectId: string;           // Required: Project ID to scan
 *   chapterId?: string;          // Optional: Filter to specific chapter
 * }
 *
 * RETURNS:
 * InventoryResult (typed response from artifactInventoryService.scan())
 */
ipcMain.handle('artifact-inventory-scan', async (event, payload: {
  projectId: string;
  chapterId?: string;
}) => {
  try {
    // Validate payload
    if (!payload.projectId || typeof payload.projectId !== 'string') {
      return {
        success: false,
        error: 'INVALID_PAYLOAD: projectId is required and must be a string',
      };
    }

    // Perform the scan
    const result: InventoryResult = await scanProjectInventory(
      artifactContext.getDataDir(),
      payload.projectId,
      payload.chapterId,
      artifactContext.getMediaRoot?.(),
    );

    return result;

  } catch (error) {
    // Ensure we return a properly formatted error
    if (error instanceof Error) {
      return {
        success: false,
        error: `ARTIFACT_SCAN_FAILED: ${error.message}`,
      };
    }

    return {
      success: false,
      error: 'ARTIFACT_SCAN_FAILED: Unknown error during artifact scan',
    };
  }
});

/**
 * HANDLER: artifact-execute-deletion
 *
 * Executes a deletion plan transactionally. This is the ONLY entry point for
 * destructive deletion operations - no renderer path is accepted directly.
 *
 * PAYLOAD: ExecuteRequest
 * {
 *   planId: string;           // Plan ID from artifact-plan-deletion
 *   fingerprint: string;      // Fingerprint to verify plan integrity
 *   confirmation: DeletionConfirmation;
 * }
 *
 * CONFIRMATION TYPES:
 * - chapter: { type: "chapter", chapterId: string }
 * - artifacts: { type: "artifacts", artifactCount: number }
 *
 * SECURITY: Requires exact plan+confirmation match per slice spec.
 * The plan must be registered via registerDeletionPlan first.
 */
ipcMain.handle('artifact-execute-deletion', async (_event, payload: {
  planId: string;
  fingerprint: string;
  confirmation: {
    type: 'chapter' | 'artifacts';
    chapterTitle?: string;
    chapterId?: string;
    artifactCount?: number;
  };
}) => {
  try {
    // Validate payload structure
    if (!payload.planId || typeof payload.planId !== 'string') {
      return { success: false, error: 'INVALID_PAYLOAD: planId required', journalState: 'none' };
    }
    if (!payload.fingerprint || typeof payload.fingerprint !== 'string') {
      return { success: false, error: 'INVALID_PAYLOAD: fingerprint required', journalState: 'none' };
    }
    if (!payload.confirmation || typeof payload.confirmation.type !== 'string') {
      return { success: false, error: 'INVALID_PAYLOAD: confirmation required', journalState: 'none' };
    }
    if (payload.confirmation.type !== 'chapter' && payload.confirmation.type !== 'artifacts') {
      return { success: false, error: 'INVALID_PAYLOAD: invalid confirmation type', journalState: 'none' };
    }

    // Execute deletion via shared controller
    const result = await executeDeletion(
      {
        dataRoot: artifactContext.getDataDir(),
        mediaRoot: artifactContext.getMediaRoot?.(),
      },
      {
        planId: payload.planId,
        fingerprint: payload.fingerprint,
        confirmation: payload.confirmation as any,
      }
    );
    return result;

  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: `DELETE_FAILED: ${error.message}`, journalState: 'none' };
    }
    return { success: false, error: 'DELETE_FAILED: Unknown error during deletion', journalState: 'none' };
  }
});

ipcMain.handle('artifact-deletion-recovery-query', async (_event, payload: { projectId: string }): Promise<RecoveryQueryResult> => {
  if (!payload || typeof payload.projectId !== 'string' || payload.projectId.length === 0) {
    return { success: false, error: 'INVALID_PAYLOAD: projectId is required' };
  }
  return queryRecovery(artifactContext.getDataDir(), payload.projectId);
});

ipcMain.handle('artifact-update-metadata', async (_event, payload: {
  projectId: string;
  artifactId: string;
  updates: { name?: string; tags?: string[]; notes?: string };
}): Promise<MetadataUpdateResult> => {
  if (!payload || typeof payload.projectId !== 'string' || typeof payload.artifactId !== 'string' || !payload.updates || typeof payload.updates !== 'object') {
    return { success: false, error: 'INVALID_PAYLOAD: projectId, artifactId and updates are required' };
  }
  try {
    const projectRoot = resolveProjectRootPath(artifactContext.getDataDir(), payload.projectId);
    const metadataPath = path.join(projectRoot, 'artifacts.json');
    return await withFileStorageMutationLocks([metadataPath], async () => {
      let persisted: { version: 1; overlays: Record<string, Record<string, unknown>> } = { version: 1, overlays: {} };
      if (fs.existsSync(metadataPath)) {
        const raw = JSON.parse(await fsp.readFile(metadataPath, 'utf8')) as Record<string, unknown>;
        const overlays = raw.overlays;
        if (overlays && typeof overlays === 'object' && !Array.isArray(overlays)) {
          persisted = { version: 1, overlays: overlays as Record<string, Record<string, unknown>> };
        }
      }
      const existing = persisted.overlays[payload.artifactId];
      const validation = validateMetadataOverlay(payload.updates, typeof existing?.name === 'string' ? existing.name : undefined);
      if (!validation.valid) return { success: false, error: validation.errors.join('; ') };
      const overlay = {
        ...(existing ?? {}),
        ...validation.normalized,
        artifactId: payload.artifactId,
        updatedAt: Date.now(),
      };
      const next = { version: 1, overlays: { ...persisted.overlays, [payload.artifactId]: overlay } };
      const temporary = `${metadataPath}.${Date.now()}.tmp`;
      await fsp.mkdir(path.dirname(metadataPath), { recursive: true });
      await fsp.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
      await fsp.rename(temporary, metadataPath);
      return { success: true, data: overlay };
    });
  } catch (error) {
    return { success: false, error: `METADATA_UPDATE_FAILED: ${error instanceof Error ? error.message : String(error)}` };
  }
});

/**
 * HANDLER: artifact-get-project-artifacts
 *
 * Convenience alias for getting ALL artifacts in a project (no chapter filter).
 * This is essentially a shortcut for:
 *   artifact-inventory-scan({ projectId, chapterId: undefined })
 *
 * Use this when you want to see the entire project's artifact inventory
 * without filtering by chapter.
 *
 * PAYLOAD:
 * {
 *   projectId: string;           // Required: Project ID
 * }
 *
 * RETURNS:
 * InventoryResult (same as artifact-inventory-scan)
 */
ipcMain.handle('artifact-get-project-artifacts', async (event, payload: {
  projectId: string;
}) => {
  try {
    // Validate payload
    if (!payload.projectId || typeof payload.projectId !== 'string') {
      return {
        success: false,
        error: 'INVALID_PAYLOAD: projectId is required and must be a string',
      };
    }

    // Call scan without chapter filter to get all project artifacts
    const result: InventoryResult = await scanProjectInventory(
      artifactContext.getDataDir(),
      payload.projectId,
      undefined,
      artifactContext.getMediaRoot?.(),
    );

    return result;

  } catch (error) {
    // Ensure we return a properly formatted error
    if (error instanceof Error) {
      return {
        success: false,
        error: `ARTIFACT_LIST_FAILED: ${error.message}`,
      };
    }

    return {
      success: false,
      error: 'ARTIFACT_LIST_FAILED: Unknown error listing artifacts',
    };
  }
});

// ============================================================================
// DELETION PLANNING HANDLER (SLICE 5 - READ-ONLY)
// ============================================================================

/**
 * HANDLER: artifact-plan-deletion
 *
 * Computes a comprehensive deletion plan without modifying disk.  Execution
 * is a separate handler and can only consume the returned immutable plan.
 *
 * PAYLOAD: PlanRequest
 * {
 *   type: "plan";
 *   payload: {
 *     projectId: string;
 *     chapterId: string;
 *     scope: "chapter" | "artifacts";
 *     artifactIds?: string[];
 *   };
 * }
 *
 * RETURNS:
 * PlanResult with 4 categories: deleteItems, migrateItems, retainItems, blockerItems
 * Plus metadata: fingerprint, backupImpact, confirmationRequired, byteTotals
 *
 * WHEN ENABLED BY UI:
 * The UI will call this before showing the ArtifactDeleteDialog to pre-compute
 * what would be deleted/migrated/retained/blocked for the user's selection.
 *
 * SECURITY: No actual deletion occurs here - pure computation.
 *
 * TEST COVERAGE (Slice 5):
 * - Empty response when no artifacts match
 * - Loading state during computation
 * - Error handling for invalid inputs
 * - Same-chapter selection enforcement (via validation in buildDeletionPlan)
 * - Cancel-zero-write guarantee (no writes occur, only plan computation)
 */
ipcMain.handle('artifact-plan-deletion', async (event, payload: PlanRequest['payload']) => {
  try {
    // Validate payload
    if (!payload.projectId || typeof payload.projectId !== 'string') {
      return {
        success: false,
        error: 'INVALID_PAYLOAD: projectId is required and must be a string',
      };
    }

    if (!payload.chapterId || typeof payload.chapterId !== 'string') {
      return {
        success: false,
        error: 'INVALID_PAYLOAD: chapterId is required and must be a string',
      };
    }

    // Build the plan from the complete project inventory.  A chapter-filtered
    // inventory cannot see cross-chapter references, so it would incorrectly
    // classify shared characters/scenes/props as chapter-exclusive.
    const allArtifactsResult: InventoryResult = await scanProjectInventory(
      artifactContext.getDataDir(),
      payload.projectId,
      undefined,
      artifactContext.getMediaRoot?.(),
    );

    if (!allArtifactsResult.success || !allArtifactsResult.data) {
      return {
        success: false,
        error: allArtifactsResult.success
          ? 'INVENTORY_SCAN_FAILED: Could not retrieve artifact inventory'
          : allArtifactsResult.error ?? 'Unknown error retrieving inventory',
      };
    }

    const allArtifacts = allArtifactsResult.data.artifacts;
    const selectedArtifactIds = payload.scope === 'artifacts' && payload.artifactIds
      ? payload.artifactIds
      : [];

    // Build deletion plan using dependency graph logic
    const { plan, errors } = buildDeletionPlan(allArtifacts, selectedArtifactIds, payload.chapterId);

    // A plan with blockers is still useful to the user: the confirmation
    // dialog must show the exact blocking records and remain disabled.  Only
    // malformed scope/input errors prevent returning a plan at all.
    if (errors.length > 0) {
      return {
        success: false,
        error: `PLAN_INVALID: ${errors.join('; ') || 'deletion plan is not executable'}`,
      };
    }

    registerDeletionPlan(plan);
    return {
      success: true,
      data: plan,
    };

  } catch (error) {
    // Ensure we return a properly formatted error
    if (error instanceof Error) {
      return {
        success: false,
        error: `PLAN_FAILED: ${error.message}`,
      };
    }

    return {
      success: false,
      error: 'PLAN_FAILED: Unknown error computing deletion plan',
    };
  }
});

// ============================================================================
