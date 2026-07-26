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

Build-time domain automation belongs under `apps/build/<domain>/`. Python
workflow helpers and their contract tests stay colocated there rather than in a
repository-root utility directory or under the renderer/backend packages.

---

## Directory Layout

```
apps/frontend/
├── components/  # React UI and feature panels
├── hooks/       # reusable renderer hooks
├── stores/      # Zustand state and persistence, grouped by domain
│   ├── ai/      # provider, feature-binding, model, and image-host configuration
│   ├── app/     # renderer-wide settings, theme, and Studio configuration
│   ├── project/ # project discovery and identity
│   ├── script/  # screenplay state, types, and persistence
│   ├── director/ # storyboard state, actions, selectors, and persistence
│   ├── library/ # character, prop, scene, and custom-style libraries
│   ├── media/   # media state, file moves, and persistence
│   ├── navigation/ # panel navigation and pending intake state
│   ├── playback/ # preview and playback coordination
│   ├── editing/ # editing projects and simple timeline state
│   ├── studio/  # Studio workflow, runtime, and continuity helpers
│   ├── sclass/  # S-class generation state and persistence
│   ├── tts/     # project-scoped voice and TTS state
│   └── assist/  # Assist-mode transient generation state
├── lib/         # domain logic, storage, AI, and utilities
│   └── ai/      # canonical AI manager, config adapter, core contracts, providers, and workers
├── types/       # shared TypeScript contracts
├── electron/    # Electron main-process modules, grouped by domain
│   ├── main/    # main process entrypoint and startup/contract tests
│   ├── preload/ # context-isolated bridge entrypoint and surface tests
│   ├── ipc/     # handlers grouped by ai, app, assets, diagnostics, files, media, studio, and tts
│   ├── runtime/ # lifecycle, protocol registration, and update policy
│   ├── diagnostics/ # diagnostics service
│   ├── storage/ # storage manager, paths, and Studio persistence services
│   ├── media/   # Node-only media source and picker helpers
│   ├── rendering/ # FFmpeg command compiler and timeline runtime
│   ├── tts/     # local TTS sidecar runtime
│   └── types/   # Electron-only ambient declarations
├── renderer/    # renderer HTML and entrypoint
├── config/      # Vite, TypeScript, ESLint, builder, and test setup
└── assets/      # bundled UI and Studio manual assets

apps/build/
├── packaging/   # desktop build, install, and setup entrypoints
├── smoke/       # packaged, installed, and workflow smoke runners
├── daojie/      # Daojie orchestration, image helpers, and Python tooling
│   ├── pipeline/ # production Python helpers and JSON capability data
│   └── tests/    # Python contract tests
├── timeline/    # Node-only direct timeline runner and config
└── shared/      # build-time reports and request ledgers
```

---

## Module Organization

<!-- How should new features be organized? -->

- Keep `components/ui/` limited to reusable, domain-neutral visual and
  interaction primitives. These modules must not own provider schemas, store
  state, playback state, or generation-domain contracts.
- Put reusable business-facing controls in `components/features/<domain>/`.
  These controls may depend on a domain store or contract while remaining
  reusable across panels. Current examples include
  `features/visual-style/style-picker/`,
  `features/cinematography/cinematography-profile-picker/`, and
  `features/playback/audio-player.tsx`.
- Put settings-only UI and dialogs in `components/panels/settings/<domain>/`.
  The image-host dialogs live under
  `panels/settings/image-host/`; their settings controller and tab remain in
  the settings panel layer.
- Put other feature UI in the matching `components/panels/<feature>/`
  directory when it is owned by one panel rather than shared across domains.
- Put reusable domain behavior in `lib/<domain>/`, not inside large panels.
- Put every Zustand store, its persistence/helper modules, and colocated tests
  in `stores/<domain>/`; do not add flat store files or root compatibility
  shims under `stores/`.
- Keep all reusable AI behavior, AI core contracts, providers, workers, and
  image-fetch helpers under the existing `lib/ai/` and `lib/` modules. Do not
  reintroduce the removed legacy `app/` directory.
- Keep `lib/ai/config/store-adapter.ts` as the only production bridge from AI
  runtime and adjacent generation helpers to `stores/ai/api-config-store`. The
  Zustand store owns persistence and migrations; runtime modules must use the
  adapter rather than importing the store directly.
- Put cross-feature contracts in `types/`; keep component-only props local.
- Keep Electron-only Node APIs in `electron/`; main and preload entrypoints live in `main/` and `preload/`, while Node services and handlers stay in their named domains. Expose only narrow preload bridges.
- Colocate `*.test.ts` and `*.test.tsx` with the unit being tested.
- Keep domain-specific build scripts and Python contract tests under
  `apps/build/<domain>/`; use a nested subpackage for related Python helpers.

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
- `components/features/visual-style/style-picker/`: reusable visual-style
  control used by generation panels.
- `components/features/cinematography/cinematography-profile-picker/`:
  reusable cinematography profile control.
- `components/features/playback/audio-player.tsx`: playback control that
  preserves the shared playback store and event contract.
- `components/panels/settings/image-host/`: settings-only image-host dialogs.
- `stores/studio/studio-store.ts`: project-scoped workflow state.
- `lib/studio/`: reusable Studio production contracts and algorithms.
- `electron/tts/tts-runtime.ts`: Electron-owned sidecar supervision.
