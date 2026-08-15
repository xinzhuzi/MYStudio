# Artifact Management Infrastructure Contracts

## Introduction
This document describes the core infrastructure contracts introduced in Trellis task 08-04-artifact-output-management for safe artifact deletion and management.

## Contract C1: Project-Scoped Deletion Mutex

### Purpose
Provides atomicity across all files within a single project during deletion operations.

### Interface
```typescript
type ReleaseFn = () => Promise<void>;

interface ProjectDeletionMutex {
  acquire(projectKey: string): Promise<ReleaseFn>;
}
```

### Acquisition Order (CRITICAL)
1. **Project mutex FIRST** - prevent concurrent deletions of same project
2. **Per-file locks SECOND** - sorted by path for deterministic ordering

### File Location
`apps/frontend/electron/storage/project-mutex.ts`

### Usage Example
```typescript
const releaseProjectLock = await projectDeletionMutex.acquire(projectId);
try {
  const releaseFileLocks = await withFileStorageMutationLocks(sortedJsonFilePaths);
  try {
    await executeDeletionTransaction(...);
  } finally {
    await releaseFileLocks();
  }
} finally {
  await releaseProjectLock();
}
```

---

## Contract C2: Project Root Path Resolution

### Purpose
Safely resolve project root directory with symlink escape protection.

### Interface
```typescript
export function resolveProjectRootPath(
  dataRoot: string, 
  projectId: string
): string;
```

### Security Guarantees
- Uses `realpath` containment check via `assertInsideRoot()`
- Rejects symlink escapes where `_p/malicious` → `/etc/passwd`
- Normalizes project ID before path construction

### File Location
`apps/frontend/electron/storage/storage-paths.ts`

### Comparison with Similar Functions

| Function | Purpose | Returns |
|----------|---------|---------|
| `resolveDataFilePath` | Single JSON file | `${dataRoot}/{key}.json` |
| `resolveProjectScopedFilePath` | File inside project | `${dataRoot}/_p/{id}/{relative}` |
| **`resolveProjectRootPath`** | **Project directory itself** | **`${dataRoot}/_p/{id}`** |

### Usage Example
```typescript
const projectRoot = resolveProjectRootPath(dataDir, projectId);
// Use projectRoot to scan all files under _p/{projectId}/
```

### External Project Locations (added 2026-08-15, task 08-15-project-folder-choice)

Projects may live outside `${dataRoot}/_p/{id}` at a user-chosen folder ("外部位置"). Rules:

- **Authoritative map**: main process owns `<userData>/project-locations.json` (`{version, locations: {projectId: absPath}}`, atomic write, `electron/storage/project-locations.ts`). The renderer registry's `Project.location` is display/cache only — never a resolution source.
- **Redirect semantics**: `storage-paths.ts` exposes `setProjectLocationResolver(resolver)`; all five resolve functions redirect keys/prefixes of form `_p/{pid}/...` (or project root) to the registered location root when hit, with `assertInsideRoot` containment against that root. Unset resolver / unknown pid / bare `_p` prefix → byte-identical legacy behavior.
- **MANDATORY**: any main-process code touching a project directory MUST use `resolveProjectRootPath` / `resolveDataFilePath` / `resolveDataDirPath` / `resolveProjectScopedFilePath` (or a `projectRootFor(pid)` helper over them). Never `path.join(dataDir, "_p", projectId)` directly — external projects will silently read/write the wrong (legacy-empty) path. Known deliberate exceptions (legacy-data semantics only): `storage-manager.ts` data-root validation counters and the `_migrated.json` import marker.
- **Folder lifecycle IPC** (string literals, alphabetical whitelist in `main-ipc-contract.test.ts`): `project-folder-prepare` (validate parent + create `<parent>/<name>` + register; CONFLICT is case-insensitive), `project-folder-rename` (mv + table update), `project-folder-remove` (rm -rf + unregister), `project-folder-status` (existence check before opening).
- New projects require a user-picked parent folder (Dashboard inline form, required 位置 field; picker defaults to last used parent dir stored in app-settings `projectLocationDefaults.lastParentDir`). Legacy projects without `location` keep legacy behavior forever.

Phase-2 additions (08-15-project-location-phase2):
- **Move**: `project-folder-move (projectId, projectName, targetParentDir)` relocates any project (legacy projects become external after moving) via `project-move-engine.ts` (same-volume rename fast path; cross-volume copy → verify-by-size → delete-source, per-file progress, AbortSignal; engine MUST yield the event loop between files or the cancel IPC starves). Progress is relayed on `project-folder-move-progress`; cancel via `project-folder-move-cancel`. Location table is updated only on success. A target inside the source subtree is rejected as NESTED (the copy path deletes the source at finalize).
- **Import**: `project-folder-import (folderPath)` adopts an existing folder as a project (requires script.json or director.json). Original pid is recovered from `state.projects` keys (script → director); when already taken, a new UUID is minted and every parseable `*.json` in the folder is rewritten in place (projects key + activeProjectId only — mirror of renderer `rewriteProjectScopedPayload`). Same-folder re-import returns `ALREADY_REGISTERED` + existingProjectId. The renderer registry entry is added by the renderer (`importProject`), never by the import handler.
- **Hardening**: all samePath/containsPath checks (locations store + ipc) compare realpath-canonicalized paths (nearest existing ancestor), closing the symlink-into-data-root bypass.

---

## Contract C3: Mixed Backup Decoder Registry

### Purpose
Enable structural decoding of mixed backup formats for deletion planning.

### Design Principles
- **Fail-closed**: Unknown backup formats BLOCK deletion (safer than guessing)
- **Extensible**: New decoders added as backup formats discovered
- **Decoupled**: Registry pattern allows runtime extension without recompilation

### Interface
```typescript
interface MixedBackupDecoder {
  type: "mixed-backup";
  formatName: string;
  versionRange?: [number, number];
  matches(raw: unknown): boolean;
  decode(raw: unknown): { 
    artifacts: MixedBackupArtifact[];
    untouchedProjectionHash?: string;
  };
}
```

### Registry API
```typescript
function registerBackupDecoder(decoder: MixedBackupDecoder): void;
function findBackupDecoder(raw: unknown): MixedBackupDecoder | null;
function decodeMixedBackup(raw: unknown): any;
```

### Known Formats (Implemented)
1. **legacy-single-chapter** (`LEGACY_SINGLECHAPTER_DECODER`)
   - Structure: `{ chapters: [{id, content}], meta: {version} }`
   - Version: 1.x
   
2. **multi-chapter-state** (`MULTICHAPTER_STATE_DECODER`)
   - Structure: `{ state: { novelChapters, scriptData, ... }, timestamp }`
   - Versions: 1.x, 2.x

3. **zustand-project-state** (`ZUSTAND_PROJECT_STATE_DECODER`)
   - Structure: `{ projectId?, state: { novelChapters, episodes, storyboards, tracks, mediaFiles, ... } }`
   - Versions: 0.x and later

4. **daojie-multichapter-mixed-json** (`DAOJIE_MULTICHAPTER_DECODER`)
   - Structure: redacted Daojie multi-chapter mixed JSON with an explicit format marker
   - Version: 1.x

### File Locations
- Registry: `apps/frontend/electron/artifacts/backup-decoder-registry.ts`
- Implementations and registrations live in `backup-decoder-registry.ts`; unknown formats remain blockers.

### Integration with Deletion Service
During plan generation:
1. Detect backup file type
2. Find matching decoder via `findBackupDecoder()`
3. Decode structure
4. Identify which chapters are contained
5. Mark as BLOCKER if no decoder found

### Plan request scope boundary

`PlanRequestDecoder` mirrors the renderer/IPC transport contract:

| Scope | `chapterId` | `artifactIds` | Behavior |
|---|---|---|---|
| `chapter` | non-empty | optional/ignored | Delete one explicitly named chapter; an empty value is rejected. |
| `artifacts` | may be empty | selected IDs supplied by the caller | The dependency graph resolves the one chapter from the selected records; mixed chapters or unresolved ownership fail closed. |

An empty `chapterId` is a transport sentinel only for an artifact-scoped
request. It must not be interpreted as “all chapters”, and the request must
not be registered or executed until graph validation returns
`executionAllowed: true`.

---

## Task Reference
All contracts introduced in Trellis task `08-04-artifact-output-management`.

## Related Documentation
- Task PRD: `.trellis/tasks/08-04-artifact-output-management/prd.md`
- Task Design: `.trellis/tasks/08-04-artifact-output-management/design.md`
- Implementation: `.trellis/tasks/08-04-artifact-output-management/implement.md`
