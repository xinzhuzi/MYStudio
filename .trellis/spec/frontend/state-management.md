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

---

## Common Mistakes

<!-- State management mistakes your team has made -->

- Persisting project-owned data in a global browser key.
- Calling `getActiveProjectId()` after an `await` and writing into a different
  project.
- Mutating arrays or nested objects in place instead of returning new state.
- Duplicating derived state that can be computed from the canonical records.
- Resetting a store without considering its persisted project file.
