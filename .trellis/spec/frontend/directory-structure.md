# Directory Structure

> How frontend code is organized in this project.

---

## Overview

<!--
Document your project's frontend directory structure here.

Questions to answer:
- Where do components live?
- How are features/modules organized?
- Where are shared utilities?
- How are assets organized?
-->

The desktop UI is a React renderer bundled with Electron Vite. Main/preload
code lives beside renderer code under `apps/frontend/`, while packaging and
end-to-end smoke runners live in `apps/build/`.

---

## Directory Layout

```
apps/frontend/
├── components/  # React UI and feature panels
├── hooks/       # reusable renderer hooks
├── stores/      # Zustand state and persistence
├── lib/         # domain logic, storage, AI, and utilities
├── types/       # shared TypeScript contracts
├── electron/    # Electron main, preload, and runtime controllers
├── renderer/    # renderer HTML and entrypoint
├── config/      # Vite, TypeScript, ESLint, builder, and test setup
├── assets/      # bundled UI and Studio manual assets
└── packages/    # locally vendored packages such as ai-core
```

---

## Module Organization

<!-- How should new features be organized? -->

- Put reusable primitives in `components/ui/`; feature UI belongs in the
  matching `components/panels/<feature>/` directory.
- Put reusable domain behavior in `lib/<domain>/`, not inside large panels.
- Put cross-feature contracts in `types/`; keep component-only props local.
- Keep Electron-only Node APIs in `electron/` and expose narrow preload bridges.
- Colocate `*.test.ts` and `*.test.tsx` with the unit being tested.

---

## Naming Conventions

<!-- File and folder naming rules -->

- Components use `PascalCase.tsx`; hooks use `use-kebab-name.ts` or the existing
  feature naming convention; stores use `<feature>-store.ts`.
- General modules and tests use `kebab-case` filenames.
- Prefer the `@/` alias for imports rooted at `apps/frontend/`.

---

## Examples

<!-- Link to well-organized modules as examples -->

- `components/BrandMark.tsx`: small reusable component.
- `stores/studio-store.ts`: project-scoped workflow state.
- `lib/studio/`: reusable Studio production contracts and algorithms.
- `electron/tts-runtime.ts`: Electron-owned sidecar supervision.
