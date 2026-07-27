# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

Zustand is the default global state layer. Small transient UI state stays in
React components; reusable workflow and project data lives in typed stores.
Persisted project data is routed through the existing storage adapters.

---

## State Categories

<!-- Local state, global state, server state, URL state -->

- Local component state: open/closed state, temporary form input, and hover or
  selection state owned by one component tree.
- Global ephemeral state: Zustand stores without persistence, such as preview
  playback coordination.
- Project state: Zustand `persist` with `createProjectScopedStorage()` under
  `_p/{projectId}/`.
- Shared/project-split resources: use the existing split-storage adapter and
  resource-sharing settings.

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

Promote state when multiple panels need it, it must survive navigation, it is a
workflow source of truth, or it must persist with a project. Keep actions beside
the state they mutate and prefer selectors over subscribing to an entire large
store.

---

## Server State

<!-- How server data is cached and synchronized -->

AI/provider results are modeled as explicit workflow records and task states,
not as an implicit cache. Preserve request IDs, fingerprints, terminal status,
and error evidence where the workflow contract requires resumability.

## Editing Timeline Records

Timeline render completion is persisted in the project-scoped editing store,
not in component state or a global browser key. `TimelineRenderRecord` entries
live under `timelineRenderRecordsByEditingProjectId` and are keyed by the
current `EditingProject` ID.

- A saved record must match the active project, episode, editing project ID,
  editing revision, and source snapshot hash.
- Hydration must reject records for another project, an unknown editing
  project, a future revision, or incomplete timeline evidence.
- Readiness must only consider the record for the current episode's current
  editing project. A stale record from an older manual edit remains audit data,
  but it cannot make the workflow ready.
- A complete record must point to an existing MP4 plus the timeline artifacts:
  editing snapshot, render plan, input manifest, filter graph, render log, and
  ffprobe JSON.
- `productionPlan` text, legacy concat output, or seeded smoke evidence may be
  displayed as compatibility evidence, but none of them replace the current
  `TimelineRenderRecord`.

---

## Common Mistakes

<!-- State management mistakes your team has made -->

- Persisting project-owned data in a global browser key.
- Calling `getActiveProjectId()` after an `await` and writing into a different
  project.
- Mutating arrays or nested objects in place instead of returning new state.
- Duplicating derived state that can be computed from the canonical records.
- Resetting a store without considering its persisted project file.
- Replacing storyboard rows by generated id alone; when an upstream parser regenerates ids, preserve continuity/review metadata by episode and shot index, then reset review only for changed visual inputs.
- Treating an old timeline render record as current after an editing revision
  changes.

## Scenario: SSR-safe persisted store adapters

### 1. Scope / Trigger

Any Zustand store imported by Vitest, Node tooling, or a non-renderer module
that uses a renderer-only Electron/file-storage bridge.

### 2. Signatures

- `StateStorage.getItem(name: string): Promise<string | null> | string | null`
- `StateStorage.setItem(name: string, value: string): Promise<void> | void`
- `StateStorage.removeItem(name: string): Promise<void> | void`

### 3. Contracts

- The adapter checks `typeof window` when each storage method is called.
- Without a renderer `window`, reads return `null` and writes/removes are
  no-ops; importing or rehydrating the store must not access `window`.
- In the renderer, the existing file-storage bridge, persistence key,
  version, migration, and partialize payload are unchanged.

### 4. Validation & Error Matrix

- No `window` at import/rehydrate -> no bridge call, no `ReferenceError`.
- Renderer bridge present -> delegate to the existing adapter unchanged.
- Malformed persisted payload -> existing migration/normalization fallback.
- Bridge operation rejects -> preserve the adapter's existing error handling;
  do not convert the state to apparent success.

### 5. Good/Base/Bad Cases

- Good: `typeof window === "undefined" ? null : fileStorage.getItem(name)`.
- Base: browser storage fallback continues to run in a renderer without the
  Electron bridge.
- Bad: evaluating `window.fileStorage` while constructing a module-level
  storage object.

### 6. Tests Required

- Import and rehydrate the store with `window` removed and assert the bridge
  `getItem` was not called.
- Assert persistence key/version/partialize compatibility.
- Keep malformed payload and normal renderer recovery tests.

### 7. Wrong vs Correct

#### Wrong

```ts
const storage = { getItem: (key: string) => window.fileStorage!.getItem(key) };
```

#### Correct

```ts
const storage = {
  getItem: (key: string) =>
    typeof window === "undefined" ? null : fileStorage.getItem(key),
};
```
