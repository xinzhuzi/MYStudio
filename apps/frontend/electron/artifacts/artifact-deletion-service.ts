/**
 * Slice 7: Transactional Execution & Recovery —— 门面
 *
 * 计划注册表与指纹、executeDeletion 事务、queryRecovery 恢复;
 * 工具/回滚束/持久层分别见 deletion-shared / deletion-bundle / deletion-stores。
 * 历史 import 面(fingerprintPlan/registerDeletionPlan/getDeletionPlan/
 * executeDeletion/queryRecovery)保持不变。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type {
  DeletionPlan,
  ExecuteResult,
  RecoveryQueryResult,
  RecoveryState,
} from "@/types/artifacts";
import { resolveProjectRootPath } from "../storage/storage-paths";
import { withProjectDeletionLock } from "../storage/project-mutex";
import { withFileStorageMutationLocks } from "../ipc/files/file-storage-ipc";
import { scanProjectInventory } from "./artifact-inventory-service";
import { buildDeletionPlan } from "@/lib/artifacts/artifact-dependency-graph";
import { studioTransformDeleteNovelChapters, scriptTransformDeleteEpisodes } from "@/lib/stores/store-transforms";
import type { NovelChaptersSnapshot, ScriptDataSnapshot } from "@/lib/stores/store-transforms";
import {
  type Confirmation,
  type DeletionContext,
  type Journal,
  type MigrationEntry,
  type PlannedTarget,
  type RollbackBundle,
  atomicWrite,
  captureFile,
  fileHash,
  getPlanItemTargets,
  hasRequiredFreeSpace,
  isEnospc,
  isInside,
  mapError,
  resolveTarget,
  stableHash,
  unlinkDurably,
} from "./deletion-shared";
import {
  capturedFingerprint,
  currentProjectFingerprint,
  journalState,
  readBundle,
  removeCreatedMigrationCopies,
  restoreFiles,
  validateBundlePaths,
  verifyCapturedFingerprint,
  writeBundle,
} from "./deletion-bundle";
import { collectPersistedFiles, postScan, rewritePersistedFiles } from "./deletion-stores";

const plans = new Map<string, DeletionPlan>();

export function fingerprintPlan(
  plan: Pick<DeletionPlan,
    | "projectId"
    | "chapterId"
    | "scope"
    | "selectedArtifactIds"
    | "deleteItems"
    | "migrateItems"
    | "retainItems"
    | "blockerItems"
    | "backupImpact"
    | "byteTotals"
    | "confirmationRequired"
    | "executionAllowed"
  >,
): string {
  const normalizeItems = (items: DeletionPlan["deleteItems"]) => items
    .map((item) => ({
      ...item,
      physicalRefs: item.physicalRefs
        ? [...item.physicalRefs].sort((left, right) => `${left.type}:${left.path}`.localeCompare(`${right.type}:${right.path}`))
        : undefined,
      upstreamOwnerIds: item.upstreamOwnerIds ? [...item.upstreamOwnerIds].sort() : undefined,
    }))
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return stableHash({
    projectId: plan.projectId,
    chapterId: plan.chapterId,
    scope: plan.scope,
    selectedArtifactIds: [...plan.selectedArtifactIds].sort(),
    deleteItems: normalizeItems(plan.deleteItems),
    migrateItems: normalizeItems(plan.migrateItems),
    retainItems: normalizeItems(plan.retainItems),
    blockerItems: normalizeItems(plan.blockerItems),
    backupImpact: [...plan.backupImpact].sort((left, right) => left.filePath.localeCompare(right.filePath)),
    byteTotals: plan.byteTotals,
    confirmationRequired: plan.confirmationRequired,
    executionAllowed: plan.executionAllowed,
  });
}

export function registerDeletionPlan(plan: DeletionPlan): DeletionPlan {
  const registered = structuredClone({
    ...plan,
    selectedArtifactIds: [...plan.selectedArtifactIds],
    fingerprint: fingerprintPlan(plan),
  });
  plans.set(registered.planId, registered);
  return structuredClone(registered);
}

export function getDeletionPlan(planId: string): DeletionPlan | undefined {
  return plans.get(planId);
}

async function withProjectLock<T>(projectKey: string, action: () => Promise<T>): Promise<T> {
  return withProjectDeletionLock(projectKey, action);
}

export async function executeDeletion(
  context: DeletionContext,
  input: { planId: string; fingerprint: string; confirmation: Confirmation },
): Promise<ExecuteResult> {
  const plan = plans.get(input.planId);
  if (!plan || input.fingerprint !== plan.fingerprint) return { success: false, error: "fingerprint-drift", journalState: "none" };
  if (!plan.executionAllowed || plan.blockerItems.length > 0) return { success: false, error: "post-scan-orphans", journalState: "none" };
  const confirmationMatches = plan.scope === "chapter"
    ? input.confirmation.type === "chapter" && (
        plan.confirmationRequired.type === "chapter-id"
          ? input.confirmation.chapterId === plan.confirmationRequired.value
          : plan.confirmationRequired.type === "chapter-title"
            ? input.confirmation.chapterTitle === plan.confirmationRequired.value
            : false
      )
    : input.confirmation.type === "artifacts"
      && input.confirmation.artifactCount === plan.deleteItems.length + plan.migrateItems.length;
  if (!confirmationMatches) {
    return { success: false, error: "confirmation-mismatch", journalState: "none" };
  }

  return withProjectLock(`${context.dataRoot}:${plan.projectId}`, async () => {
    const projectRoot = resolveProjectRootPath(context.dataRoot, plan.projectId);
    const journalPath = path.join(projectRoot, ".artifact-delete-journal.json");
    const bundlePath = path.join(projectRoot, `.artifact-delete-${plan.planId}.bundle.json`);
    let plannedTargets: Array<PlannedTarget & { resolved: string }>;
    try {
      plannedTargets = (await Promise.all(
        [...plan.deleteItems, ...plan.migrateItems].flatMap((item) =>
          getPlanItemTargets(item).map(async (target) => ({
            ...target,
            resolved: await resolveTarget(context, projectRoot, target.path, plan.projectId),
          })),
        ),
      ));
    } catch (error) {
      return {
        success: false,
        error: mapError(error instanceof Error ? error.message : String(error)),
        journalState: "none",
      };
    }
    // Lock every path that can be changed, including media/protected-asset
    // files.  Locking only persisted JSON allows a concurrent media writer to
    // race the transaction and invalidate the reviewed fingerprint.
    const lockFiles = [
      ...(await collectPersistedFiles(projectRoot)),
      ...plannedTargets.map((target) => target.resolved),
      journalPath,
      bundlePath,
      path.join(projectRoot, ".artifact-delete-project.lock"),
    ];
    return withFileStorageMutationLocks(lockFiles, async () => {
    const existingJournal = await journalState(projectRoot);
    if (existingJournal.error) {
      return { success: false, error: "journal-transition-failed", journalState: "none" };
    }
    if (existingJournal.journal) {
      const journalStateForResult = existingJournal.journal.state === "commit-ready" ? "commit-ready" : "prepared";
      return { success: false, error: "project-lock-hold", journalState: journalStateForResult };
    }
    // The reviewed plan is only a snapshot. Rebuild it under the same project
    // and file locks immediately before the first write so any changed file,
    // backup, dependency edge, discrepancy, or active job invalidates it.
    const currentInventory = await scanProjectInventory(
      context.dataRoot,
      plan.projectId,
      undefined,
      context.mediaRoot,
      { projectLockAlreadyHeld: true },
    );
    if (!currentInventory.success
      || currentInventory.data.discrepancies.length > 0
      || currentInventory.data.blockers.some((job) => !job.chapterId || job.chapterId === plan.chapterId)) {
      return { success: false, error: "fingerprint-drift", journalState: "none" };
    }
    const rebuilt = buildDeletionPlan(
      currentInventory.data.artifacts,
      plan.selectedArtifactIds,
      plan.chapterId,
    );
    if (rebuilt.errors.length > 0
      || rebuilt.plan.scope !== plan.scope
      || rebuilt.plan.projectId !== plan.projectId
      || rebuilt.plan.chapterId !== plan.chapterId
      || fingerprintPlan(rebuilt.plan) !== plan.fingerprint) {
      return { success: false, error: "fingerprint-drift", journalState: "none" };
    }
    // Projected IDs may be namespaced as `${projectId}-${chapterId}`. Keep
    // both the stable chapter identity and the projected suffix so persisted
    // records and registered backups are pruned consistently.
    const rawIds = new Set<string>([plan.chapterId]);
    for (const item of plan.deleteItems) {
      const suffix = item.artifactId.split(":").pop() ?? item.artifactId;
      rawIds.add(suffix);
      if (suffix.startsWith(`${plan.projectId}-`)) rawIds.add(suffix.slice(plan.projectId.length + 1));
    }
    const targets = new Set<string>(plannedTargets.map((target) => target.resolved));
    const targetTypes = new Map(plannedTargets.map((target) => [target.resolved, target.type]));
    const migrations: MigrationEntry[] = [];
    const bundle: RollbackBundle = { schemaVersion: 1, files: [], migrations };
    let journal: Journal | undefined;
    try {
      for (const item of [...plan.deleteItems, ...plan.migrateItems]) {
        for (const planned of getPlanItemTargets(item)) {
          if (!planned.hash256) continue;
          const target = await resolveTarget(context, projectRoot, planned.path, plan.projectId);
          const data = await fsp.readFile(target).catch(() => null);
          if (!data || fileHash(data) !== planned.hash256) throw new Error("fingerprint-drift");
        }
      }
      let protectedAssetCopyBytes = 0;
      for (const item of plan.migrateItems) {
        for (const planned of getPlanItemTargets(item)) {
          const source = await resolveTarget(context, projectRoot, planned.path, plan.projectId);
          if (!/\.(?:png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|m4a)$/i.test(source)) continue;
          const sourceData = await fsp.readFile(source);
          const destination = path.join(projectRoot, "workflow-images", "assets", "protected", `${fileHash(sourceData).slice(0, 16)}-${path.basename(source)}`);
          if (!isInside(projectRoot, destination)) throw new Error("cross-root");
          const sha256 = fileHash(sourceData);
          migrations.push({ from: source, to: destination, sha256 });
          protectedAssetCopyBytes += sourceData.byteLength;
          if (fs.existsSync(destination) && !bundle.files.some((file) => file.file === destination)) {
            bundle.files.push(await captureFile(destination));
          }
          targets.add(source);
          targetTypes.set(source, planned.type);
        }
      }
      for (const file of await collectPersistedFiles(projectRoot)) {
        if (!bundle.files.some((captured) => captured.file === file)) bundle.files.push(await captureFile(file));
      }
      for (const target of targets) if (!bundle.files.some((captured) => captured.file === target)) bundle.files.push(await captureFile(target));
      bundle.migrations = migrations;
      const bundleBytes = Buffer.byteLength(JSON.stringify(bundle));
      const maxTempFileBytes = Math.max(0, ...bundle.files.map((file) => file.bytes));
      if (!await hasRequiredFreeSpace(projectRoot, bundleBytes, protectedAssetCopyBytes, maxTempFileBytes)) {
        return { success: false, error: "insufficient-free-space", journalState: "none" };
      }
      const preFingerprint = capturedFingerprint(bundle.files);
      const bundleSha256 = await writeBundle(bundlePath, bundle);
      journal = { schemaVersion: 1, state: "prepared", planId: plan.planId, bundlePath, bundleSha256, preFingerprint, migrationManifest: migrations };
      await atomicWrite(journalPath, JSON.stringify(journal));

      if (!await hasRequiredFreeSpace(projectRoot, bundleBytes, protectedAssetCopyBytes, maxTempFileBytes)) {
        throw new Error("insufficient-free-space");
      }
      for (const migration of migrations) {
        await fsp.mkdir(path.dirname(migration.to), { recursive: true });
        await fsp.copyFile(migration.from, migration.to);
        const copied = await fsp.readFile(migration.to);
        if (fileHash(copied) !== migration.sha256) throw new Error("protected-asset-copy-failed");
      }

      if (!await hasRequiredFreeSpace(projectRoot, bundleBytes, 0, maxTempFileBytes)) {
        throw new Error("insufficient-free-space");
      }
      const rewritten = await rewritePersistedFiles(projectRoot, plan.chapterId, rawIds, plan.backupImpact);
      const rewrittenPaths = new Set(rewritten.map((file) => file.file));

      // Rehydrate persisted store snapshots while the journal is still
      // prepared.  Any failure remains rollback-able from the bundle; no
      // business write is allowed after the commit-ready transition.
      try {
        for (const chapterFile of await collectPersistedFiles(projectRoot)) {
          const text = await fsp.readFile(chapterFile, "utf8").catch(() => null);
          if (text === null) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { continue; }
          if (Array.isArray((parsed as NovelChaptersSnapshot)?.novelChapters)) {
            const snapshot: NovelChaptersSnapshot = {
              novelChapters: (parsed as NovelChaptersSnapshot).novelChapters.map(
                (ch) => ({ ...ch, id: ch.id || String(ch.index) })
              ),
            };
            const nextSnapshot = studioTransformDeleteNovelChapters(snapshot, rawIds);
            if (JSON.stringify(nextSnapshot) !== JSON.stringify(snapshot)) {
              await atomicWrite(chapterFile, JSON.stringify(nextSnapshot, null, 2));
            }
          }
        }
        for (const scriptFile of await collectPersistedFiles(projectRoot)) {
          const text = await fsp.readFile(scriptFile, "utf8").catch(() => null);
          if (text === null) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { continue; }
          const root = parsed as Record<string, unknown>;
          const projects = root.projects as Record<string, unknown> | undefined;
          if (projects && typeof projects[plan.projectId] === "object") {
            const snapshot: ScriptDataSnapshot = {
              projects: { [plan.projectId]: projects[plan.projectId] as never },
            };
            const episodeIndices = [...new Set(
              (snapshot.projects[plan.projectId]?.scriptData?.episodes || [])
                .filter(e => rawIds.has(String(e.index)) || rawIds.has(String(e.id)))
                .map(e => e.index)
            )];
            if (episodeIndices.length > 0) {
              const nextSnapshot = scriptTransformDeleteEpisodes(snapshot, plan.projectId, episodeIndices);
              const nextRoot = { ...root, projects: { ...projects, [plan.projectId]: nextSnapshot.projects[plan.projectId] } };
              if (JSON.stringify(nextRoot) !== JSON.stringify(parsed)) {
                await atomicWrite(scriptFile, JSON.stringify(nextRoot, null, 2));
              }
            }
          }
        }
      } catch {
        throw new Error("store-rehydration-failed");
      }

      // Permanent deletion occurs only after the verified rollback bundle and
      // all structured rewrites are in place.  Do not use Electron's
      // shell.trashItem here: the product contract explicitly requires
      // irreversible deletion (with rollback available only until commit).
      for (const target of targets) {
        if (!fs.existsSync(target)) throw new Error("physical-delete-failed");
        if (targetTypes.get(target) === "project-file" && /\.json$/i.test(target) && rewrittenPaths.has(target)) continue;
        const backupImpact = plan.backupImpact.find((impact) => impact.filePath === target || path.resolve(projectRoot, impact.filePath) === target);
        if (backupImpact?.action === "rewrite") continue;
        await unlinkDurably(target);
      }
      const scan = await postScan(context, plan.projectId, plan.chapterId, projectRoot, rawIds);
      if (Object.values(scan).some((count) => count > 0)) throw new Error("post-scan");
      const verifiedPostFingerprint = await currentProjectFingerprint(projectRoot);
      if (await currentProjectFingerprint(projectRoot) !== verifiedPostFingerprint) {
        throw new Error("post-fingerprint-mismatch");
      }
      journal.postFingerprint = verifiedPostFingerprint;
      journal.state = "commit-ready";
      await atomicWrite(journalPath, JSON.stringify(journal));
      journal.state = "committed";
      await atomicWrite(journalPath, JSON.stringify(journal));

      // The durable committed journal above is the only commit point. GC is a
      // separate best-effort phase and never triggers rollback after commit.
      const committedState = await journalState(projectRoot);
      if (!committedState.error && committedState.journal?.state === "committed") {
        await unlinkDurably(bundlePath).catch(() => undefined);
        await unlinkDurably(journalPath).catch(() => undefined);
      }
      scan.transactionResidue = (fs.existsSync(bundlePath) || fs.existsSync(journalPath)) ? 1 : 0;
      return {
        success: true,
        journalState: "committed",
        data: {
          planId: plan.planId,
          chaptersAffected: [plan.chapterId],
          artifactsDeleted: plan.deleteItems.length,
          artifactsMigrated: migrations.length,
          bytesFreed: plan.byteTotals.deleteBytes,
          backupsModified: plan.backupImpact.map((impact) => impact.filePath),
          postScan: scan,
          completedAt: Date.now(),
        },
      };
    } catch (error) {
      if (!journal) {
        return { success: false, error: mapError(error instanceof Error ? error.message : String(error)), journalState: "none" };
      }
      try {
        const saved = await readBundle(journal);
        validateBundlePaths(projectRoot, saved, context.mediaRoot);
        await restoreFiles(saved.files);
        await removeCreatedMigrationCopies(projectRoot, saved);
        if (!await verifyCapturedFingerprint(saved.files, journal.preFingerprint)) {
          throw new Error("pre-fingerprint-mismatch");
        }
        const rollbackInventory = await scanProjectInventory(
          context.dataRoot,
          plan.projectId,
          undefined,
          context.mediaRoot,
          { projectLockAlreadyHeld: true },
        );
        if (!rollbackInventory.success || rollbackInventory.data.discrepancies.length > 0) {
          throw new Error("pre-fingerprint-mismatch");
        }
        await unlinkDurably(bundlePath);
        await unlinkDurably(journalPath);
      } catch (rollbackError) {
        const rollbackFailure = isEnospc(rollbackError) ? "enospace-at-restore" : mapError(
          rollbackError instanceof Error ? rollbackError.message : "rollback-restore-failed",
        );
        return {
          success: false,
          error: rollbackFailure === "pre-fingerprint-mismatch" || rollbackFailure === "enospace-at-restore"
            ? rollbackFailure
            : "rollback-restore-failed",
          journalState: "prepared",
        };
      }
      return { success: false, error: mapError(error instanceof Error ? error.message : String(error)), journalState: "none" };
    }
    });
  });
}

export async function queryRecovery(dataRoot: string, projectId: string, mediaRoot?: string): Promise<RecoveryQueryResult> {
  try {
    const root = resolveProjectRootPath(dataRoot, projectId);
    const projectLockPath = path.join(root, ".artifact-delete-project.lock");
    return await withProjectLock(`${dataRoot}:${projectId}`, async () => {
      // Keep recovery behind the same on-disk project lock and deterministic
      // mutation lock set as executeDeletion. This prevents a recovery query
      // from deleting/restoring a journal while an execution transaction is
      // writing its bundle or transitioning the journal.
      return withFileStorageMutationLocks([projectLockPath, path.join(root, ".artifact-delete-journal.json")], async () => {
        const { journal, journalPath, error } = await journalState(root);
        if (error) return { success: false, error: "journal-corrupt" };
        if (!journal) return { success: true, data: { journalState: "none", bundleExists: false, bundleValid: false, canAutoRecover: true, requiredAction: "none" } };
        const bundleExists = fs.existsSync(journal.bundlePath);
        if (journal.state === "committed") {
          // POST fingerprint is advisory after commit because normal writers
          // may already have resumed. The committed journal remains the sole
          // source of truth and is never rolled back here.
          await currentProjectFingerprint(root).catch(() => undefined);
          try {
            if (bundleExists) await unlinkDurably(journal.bundlePath);
            await unlinkDurably(journalPath);
          } catch {
            return {
              success: true,
              data: {
                journalState: "committed",
                bundleExists: fs.existsSync(journal.bundlePath),
                bundleValid: true,
                preFingerprint: journal.preFingerprint,
                postFingerprint: journal.postFingerprint,
                canAutoRecover: true,
                requiredAction: "gc-bundle",
                errorMessage: "committed transaction requires GC retry",
              },
            };
          }
          return { success: true, data: { journalState: "none", bundleExists: false, bundleValid: true, canAutoRecover: true, requiredAction: "none" } };
        }
        if (!bundleExists) {
          return {
            success: false,
            error: journal.state === "commit-ready" ? "missing-bundle-at-commit-ready" : "bundle-corrupt",
          };
        }
        const bundle = await readBundle(journal);
        validateBundlePaths(root, bundle, mediaRoot);
        try {
          await restoreFiles(bundle.files);
          await removeCreatedMigrationCopies(root, bundle);
          if (!await verifyCapturedFingerprint(bundle.files, journal.preFingerprint)) {
            return { success: false, error: "pre-fingerprint-mismatch" };
          }
          const restoredInventory = await scanProjectInventory(
            dataRoot,
            projectId,
            undefined,
            mediaRoot,
            { projectLockAlreadyHeld: true },
          );
          if (!restoredInventory.success || restoredInventory.data.discrepancies.length > 0) {
            return { success: false, error: "pre-fingerprint-mismatch" };
          }
        } catch (restoreError) {
          return { success: false, error: isEnospc(restoreError) ? "enospace-at-restore" : "rollback-restore-failed" };
        }
        await unlinkDurably(journal.bundlePath);
        await unlinkDurably(journalPath);
        const state: RecoveryState = { journalState: "none", bundleExists: false, bundleValid: true, preFingerprint: journal.preFingerprint, postFingerprint: journal.postFingerprint, canAutoRecover: true, requiredAction: "none" };
        return { success: true, data: state };
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message === "bundle-corrupt" ? "bundle-corrupt" : message };
  }
}
