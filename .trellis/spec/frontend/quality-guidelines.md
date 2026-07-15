# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

Every frontend change must pass TypeScript, ESLint, and Vitest. Electron and
workflow changes also require the relevant packaged or workflow smoke layer;
navigation smoke must not be reported as real MP4 generation success.

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

- Direct Node filesystem/process access from renderer components.
- New untyped preload globals or duplicate IPC channel contracts.
- Tests that only assert a mock without exercising production behavior.
- Silent fallbacks that convert a failed real generation into apparent success.
- Broad unrelated refactors inside a focused task.

---

## Required Patterns

<!-- Patterns that must always be used -->

- Reuse preload bridges, stores, domain helpers, and shared UI primitives.
- Keep project persistence scoped and migration-compatible.
- Preserve explicit loading, failure, stale, canceled, and completed states.
- Sanitize diagnostics before writing logs.
- Add regression tests beside the affected code.

---

## Testing Requirements

<!-- What level of testing is expected -->

Run from `apps/`:

```bash
npm run typecheck
npm run lint
npm test
```

Use focused Vitest files during iteration. For Electron packaging or workflow
changes, also run the exact smoke commands named in the task acceptance criteria.

---

## Code Review Checklist

<!-- What reviewers should check -->

- Data flow is correct across component, store/lib, preload, and main process.
- Project switching cannot redirect an in-flight write.
- Errors and terminal states are visible and testable.
- No secrets, prompts, or binary payloads leak into diagnostics.
- The reported verification level matches the commands actually rerun.
