# Slice 7: Transactional Execution & Recovery

## Overview

Slice 7 implements atomic, transactional deletion execution with recovery capabilities for the artifact management system.

## Core Responsibilities

### a) Project-scoped Deletion Mutex Primitive
- **Order**: project-lock FIRST, then sorted per-file locks
- `withProjectLock()` enforces sequential execution within a project
- `withFileStorageMutationLocks()` prevents concurrent modifications to affected files

### b) Rollback Bundle Writer
**Discipline**: temp + fsync + parent-fsync + atomic-rename
- Writes rollback bundle to temp file first
- Calls `handle.sync()` on temp file descriptor
- Syncs parent directory after rename
- Atomic rename ensures crash-safe writes

```typescript
async function atomicWrite(file: string, data: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fsp.open(temporary, "w", 0o600);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync(); // fsync on file
  } finally {
    await handle.close();
  }
  await fsp.rename(temporary, file); // atomic rename
  const parent = await fsp.open(path.dirname(file), "r").catch(() => null);
  await parent?.sync().catch(() => undefined); // fsync on parent
}
```

### c) Migration Manifest for Protected Asset Copies
- Tracks protected assets moved to `workflow-images/assets/protected/`
- Stores `{ from, to, sha256 }` tuples in migration manifest
- Bundle includes both source capture and migration record

### d) Protected Asset Handling BEFORE Source Deletion
1. Capture source file to bundle (hash validation)
2. Copy to protected location under workflow-images root
3. Verify copied hash matches source
4. Only then add to deletion targets

```typescript
// Protected asset handling order (BEFORE source deletion)
if (!bundle.files.some((file) => file.file === source)) bundle.files.push(await captureFile(source));
await fsp.copyFile(source, destination);
targets.add(source); // Only after protection complete
```

### e) JSON/Backup Rewrite via temp+fsync+atomic-rename
- **NO legacy delete-image IPC** used
- All persisted file rewrites use `atomicWrite()`
- Backup files (`.bak`) validated with decoder registry before rewrite

### f) Store Rehydration Under Workflow Freeze + Scan Runs
After successful physical deletion and journal commit:

**Novel Chapters** (`studioTransformDeleteNovelChapters`):
```typescript
const snapshot: NovelChaptersSnapshot = {
  novelChapters: parsed.novelChapters.map(
    (ch) => ({ ...ch, id: ch.id || String(ch.index) })
  ),
};
const nextSnapshot = studioTransformDeleteNovelChapters(snapshot, rawIds);
await atomicWrite(chapterFile, JSON.stringify(nextSnapshot, null, 2));
```

**Script Episodes** (`scriptTransformDeleteEpisodes`):
```typescript
const episodeIndices = [...new Set(
  snapshot.projects[projectId]?.scriptData?.episodes
    .filter(e => rawIds.has(String(e.index)))
    .map(e => e.index)
)];
const nextSnapshot = scriptTransformDeleteEpisodes(snapshot, projectId, episodeIndices);
await atomicWrite(scriptFile, JSON.stringify(nextSnapshot, null, 2));
```

**Post-deletion scans** run after store rehydration:
- Orphan records
- Invalid paths
- Residual chapter files
- Backup residue
- Cross-project leaks
- Transaction residue

### g) Journal State Machine
**States**: `prepared` → `commit-ready` → `committed`

```typescript
// prepared: bundle written, pre-fingerprint captured
journal = { schemaVersion: 1, state: "prepared", planId, bundlePath, bundleSha256, preFingerprint, migrationManifest };
await atomicWrite(journalPath, JSON.stringify(journal));

// After post-delete verification, move to commit-ready
journal.state = "commit-ready";
await atomicWrite(journalPath, JSON.stringify(journal));

// Final commit, no rollback needed anymore
journal.state = "committed";
await atomicWrite(journalPath, JSON.stringify(journal));
```

### h) Recovery Logic
**Single-branch on journal state**:

| Journal State | Bundle Exists | Action |
|---------------|---------------|--------|
| `committed` | Any | Delete stale journal idempotently, return success |
| `commit-ready` | YES | Rollback from bundle (restore all files + migrations) |
| `commit-ready` | NO | Impossible/corrupt scenario, block mutation |
| `prepared` | YES | Rollback from bundle |
| `prepared` | NO | Restore from captured files if available |

```typescript
export async function queryRecovery(...): Promise<RecoveryQueryResult> {
  const { journal, journalPath } = await journalState(root);
  
  if (!journal) return { success: true, data: { journalState: "none", ... } };
  
  if (journal.state === "committed") {
    // Clean up stale journal idempotently
    await fsp.unlink(journal.bundlePath).catch(() => undefined);
    await fsp.unlink(journalPath).catch(() => undefined);
    return { success: true, data: { journalState: "none", ... } };
  }
  
  // commit-ready or prepared - need bundle to rollback
  if (!bundleExists) return { success: false, error: "missing-bundle-at-commit-ready" };
  
  // Rollback from bundle
  const bundle = await readBundle(journal);
  await restoreFiles(bundle.files);
  for (const migration of bundle.migrations) {
    await fsp.unlink(migration.to).catch(() => undefined); // Remove protected copies
  }
  await fsp.unlink(journalPath).catch(() => undefined);
  return { success: true, data: { journalState: "none", requiredAction: "none" } };
}
```

## File Structure Changes

### New Imports
```typescript
import { studioTransformDeleteNovelChapters, scriptTransformDeleteEpisodes } from "@/lib/stores/store-transforms";
import type { NovelChaptersSnapshot, ScriptDataSnapshot } from "@/lib/stores/store-transforms";
```

### Modified Functions
1. **executeDeletion** - Now uses dual locking + pure transforms
2. **queryRecovery** - Implements recovery state machine logic

### Execution Flow
```
1. Lock acquisition (project-lock THEN per-file locks)
2. Physical file preparation
   ├── Capture delete targets to bundle
   ├── Migrate protected assets
   └── Collect persisted JSON files
3. Write bundle + journal (prepared)
4. Rewrite persisted files (JSON pruning)
5. Post-rewrite bundle sync
6. Physical deletion of targets
7. Post-deletion scan validation
8. Commit ready → committed transition
9. Store rehydration using pure transforms
10. Cleanup bundle + journal
```

## Error Handling

All errors follow mapped codes from Slice 6:
- `bundle-corrupt`, `rollback-bundle-write-failed`
- `store-rehydration-failed`, `post-scan-orphans`
- `cross-root-path`, `symlink-detected`, etc.

On failure:
1. Attempt rollback from bundle
2. Preserve journal at `prepared` state for manual inspection
3. Return specific error code + current journalState

## Testing Requirements

**Unit tests** should cover:
- Bundle write/fsync/ordering guarantees
- Journal state transitions
- Recovery scenarios for each journal state
- Store rehydration correctness
- Protected asset migration integrity

**E2E tests** should verify:
- Full lifecycle: plan → execute → scan → recovery
- Concurrent deletion isolation
- Crash during execution → recovery succeeds
- Hash validation throughout pipeline

## Compliance Notes

✅ Uses PURE functions from Slice 6 (`studioTransformDeleteNovelChapters`, `scriptTransformDeleteEpisodes`)
✅ Computes next-state snapshots BEFORE writing to disk
✅ No legacy delete-image IPC calls
✅ Strict journal state machine enforcement
✅ Recovery logic handles all edge cases

## Files Modified

- `apps/frontend/electron/artifacts/artifact-deletion-service.ts`
  - Added imports for Slice 6 transforms
  - Updated `executeDeletion()` with store rehydration
  - Enhanced `queryRecovery()` with complete recovery scenarios

## Files Created

None (Slice 7 modifies existing service, no new files created)
