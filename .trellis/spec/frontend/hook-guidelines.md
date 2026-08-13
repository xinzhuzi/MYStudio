# Hook Guidelines

> How hooks are used in this project.

---

## Overview

<!--
Document your project's hook conventions here.

Questions to answer:
- What custom hooks do you have?
- How do you handle data fetching?
- What are the naming conventions?
- How do you share stateful logic?
-->

Hooks encapsulate reusable renderer state, browser/Electron integration, and
feature actions. They use the `use` prefix and return typed values or a stable
action object.

---

## Custom Hook Patterns

<!-- How to create and structure custom hooks -->

- Use `useMemo` for deterministic derived values and `useEffect` only for real
  external synchronization.
- Capture external identifiers before the first `await` when project switching
  could create a race.
- Clean up subscriptions, timers, object URLs, and event listeners.
- Keep pure parsing and transformation logic in `lib/` so it can be tested
  without React.
- Hooks that report long-running progress should expose an optional typed
  `onProgress` callback and let the caller surface it through toast / UI. Do
  not emit progress through `console.log` from inside the hook — `console.log`
  is an ESLint error in renderer code, and progress belongs to the caller's
  presentation, not the hook's internals.

---

## Data Fetching

<!-- How data fetching is handled (React Query, SWR, etc.) -->

The project does not use a general server-state library. Hooks call typed AI,
preload, or storage adapters and expose explicit loading/error state. Reuse the
existing retry, rate-limit, diagnostics, and task-polling helpers instead of
creating local fetch loops.

---

## Naming Conventions

<!-- Hook naming rules (use*, etc.) -->

- Hook names begin with `use`; action collections commonly end in `Actions`.
- Event callbacks exposed to components use `on...` or an imperative verb such
  as `generate`, `save`, or `retry`.
- Files follow the local kebab-case convention, for example
  `use-resolved-image-url.ts`.

---

## Common Mistakes

<!-- Hook-related mistakes your team has made -->

- Suppressing dependency problems instead of making captured values stable.
- Performing the same domain transformation in a hook and a store.
- Updating the currently active project after an awaited operation without
  confirming it is still the project that started the operation.
- Leaving Electron listeners registered after unmount.
- Surfacing long-running progress through `console.log` instead of an
  `onProgress` callback the caller renders (e.g. `use-script-*` emitting
  `[ScriptView]` console lines).
- Keeping unused hook return values in the destructure just to "match the
  shape". Omit unused members (or use the hole pattern `const [, setX] =
  ...`) — `noUnusedLocals` is on, so a kept-but-unused local fails typecheck.
