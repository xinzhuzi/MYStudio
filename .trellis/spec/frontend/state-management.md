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
