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
import type { ZodIssue } from 'zod';
import { scanProjectInventory } from '@/electron/artifacts/artifact-inventory-service';
import type {
  Discrepancy,
  DeletionPlan,
  InventoryResult,
  PlanResult,
  RecoveryQueryResult,
  MetadataUpdateResult,
} from '@/types/artifacts';
import { buildDeletionPlan } from '@/lib/artifacts/artifact-dependency-graph';
import { executeDeletion, queryRecovery, registerDeletionPlan } from '@/electron/artifacts/artifact-deletion-service';
import { resolveProjectRootPath } from '@/electron/storage/storage-paths';
import { withFileStorageMutationLocks } from './file-storage-ipc';
import { validateMetadataOverlay } from '@/lib/artifacts/artifact-metadata';
import {
  ExecuteRequestDecoder,
  InventoryRequestDecoder,
  MetadataUpdateRequestDecoder,
  PlanRequestDecoder,
  ProjectArtifactsRequestDecoder,
  RecoveryQueryRequestDecoder,
} from '@/lib/artifacts/artifact-decoders';

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

function formatInvalidPayload(issues: readonly ZodIssue[]): string {
  const details = issues
    .map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
    .join('; ');
  return `INVALID_PAYLOAD: ${details}`;
}

/**
 * Add inventory discrepancies to the reviewed blocker section. A deletion
 * plan must stay fail-closed until live and persisted state agree; surfacing
 * these as plan items keeps the exact reason visible in the confirmation
 * dialog instead of silently returning an executable plan.
 */
export function applyInventoryDiscrepancyBlockers(
  plan: DeletionPlan,
  discrepancies: readonly Discrepancy[],
): DeletionPlan {
  if (discrepancies.length === 0) return plan;
  const existing = new Set(plan.blockerItems.map((item) => item.artifactId));
  const discrepancyItems = discrepancies.flatMap((discrepancy, index) => {
    const artifactId = `__inventory_discrepancy__${index}`;
    if (existing.has(artifactId)) return [];
    const affected = discrepancy.affectedArtifacts.length > 0
      ? `；受影响记录：${discrepancy.affectedArtifacts.join("、")}`
      : "";
    return [{
      artifactId,
      kind: "media-file" as const,
      stage: "media-library" as const,
      name: `盘面不一致 #${index + 1}`,
      reason: `${discrepancy.type}：${discrepancy.description}${affected}。请先同步结构化状态并刷新盘点。`,
    }];
  });
  return {
    ...plan,
    blockerItems: [...plan.blockerItems, ...discrepancyItems],
    executionAllowed: false,
  };
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
ipcMain.handle('artifact-inventory-scan', async (_event, payload: unknown) => {
  try {
    const decoded = InventoryRequestDecoder.safeParse({ type: 'inventory', payload });
    if (!decoded.success) {
      return {
        success: false,
        error: formatInvalidPayload(decoded.error.issues),
      };
    }
    const request = decoded.data.payload;

    // Perform the scan
    const result: InventoryResult = await scanProjectInventory(
      artifactContext.getDataDir(),
      request.projectId,
      request.chapterId,
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
ipcMain.handle('artifact-execute-deletion', async (_event, payload: unknown) => {
  try {
    const decoded = ExecuteRequestDecoder.safeParse({ type: 'execute', payload });
    if (!decoded.success) {
      return {
        success: false,
        error: formatInvalidPayload(decoded.error.issues),
        journalState: 'none',
      };
    }
    const request = decoded.data.payload;

    // Execute deletion via shared controller
    const result = await executeDeletion(
      {
        dataRoot: artifactContext.getDataDir(),
        mediaRoot: artifactContext.getMediaRoot?.(),
      },
      {
        planId: request.planId,
        fingerprint: request.fingerprint,
        confirmation: request.confirmation,
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

ipcMain.handle('artifact-deletion-recovery-query', async (_event, payload: unknown): Promise<RecoveryQueryResult> => {
  const decoded = RecoveryQueryRequestDecoder.safeParse({ type: 'recovery-query', payload });
  if (!decoded.success) {
    return { success: false, error: formatInvalidPayload(decoded.error.issues) };
  }
  return queryRecovery(
    artifactContext.getDataDir(),
    decoded.data.payload.projectId,
    artifactContext.getMediaRoot?.(),
  );
});

ipcMain.handle('artifact-update-metadata', async (_event, payload: unknown): Promise<MetadataUpdateResult> => {
  const decoded = MetadataUpdateRequestDecoder.safeParse({ type: 'metadata-update', payload });
  if (!decoded.success) {
    return { success: false, error: formatInvalidPayload(decoded.error.issues) };
  }
  const request = decoded.data.payload;
  try {
    const projectRoot = resolveProjectRootPath(artifactContext.getDataDir(), request.projectId);
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
      const existing = persisted.overlays[request.artifactId];
      const validation = validateMetadataOverlay(request.updates, typeof existing?.name === 'string' ? existing.name : undefined);
      if (!validation.valid) return { success: false, error: validation.errors.join('; ') };
      const overlay = {
        ...(existing ?? {}),
        ...validation.normalized,
        artifactId: request.artifactId,
        updatedAt: Date.now(),
      };
      const next = { version: 1, overlays: { ...persisted.overlays, [request.artifactId]: overlay } };
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
ipcMain.handle('artifact-get-project-artifacts', async (_event, payload: unknown) => {
  try {
    const decoded = ProjectArtifactsRequestDecoder.safeParse({ type: 'project-artifacts', payload });
    if (!decoded.success) {
      return {
        success: false,
        error: formatInvalidPayload(decoded.error.issues),
      };
    }

    // Call scan without chapter filter to get all project artifacts
    const result: InventoryResult = await scanProjectInventory(
      artifactContext.getDataDir(),
      decoded.data.payload.projectId,
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
ipcMain.handle('artifact-plan-deletion', async (_event, payload: unknown): Promise<PlanResult> => {
  try {
    const decoded = PlanRequestDecoder.safeParse({ type: 'plan', payload });
    if (!decoded.success) {
      return {
        success: false,
        error: formatInvalidPayload(decoded.error.issues),
      };
    }
    const request = decoded.data.payload;

    // Build the plan from the complete project inventory.  A chapter-filtered
    // inventory cannot see cross-chapter references, so it would incorrectly
    // classify shared characters/scenes/props as chapter-exclusive.
    const allArtifactsResult: InventoryResult = await scanProjectInventory(
      artifactContext.getDataDir(),
      request.projectId,
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
    const selectedArtifactIds = request.scope === 'artifacts' && request.artifactIds
      ? request.artifactIds
      : [];

    // Build deletion plan using dependency graph logic
    const { plan, errors } = buildDeletionPlan(allArtifacts, selectedArtifactIds, request.chapterId);

    // A plan with blockers is still useful to the user: the confirmation
    // dialog must show the exact blocking records and remain disabled.  Only
    // malformed scope/input errors prevent returning a plan at all.
    if (errors.length > 0) {
      return {
        success: false,
        error: `PLAN_INVALID: ${errors.join('; ') || 'deletion plan is not executable'}`,
      };
    }

    const gatedPlan = applyInventoryDiscrepancyBlockers(plan, allArtifactsResult.data.discrepancies);
    const registeredPlan = registerDeletionPlan(gatedPlan);
    return {
      success: true,
      data: registeredPlan,
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
