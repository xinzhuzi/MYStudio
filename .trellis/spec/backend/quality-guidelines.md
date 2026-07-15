# Quality Guidelines

> Code quality standards for backend development.

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

Backend changes must preserve the Electron-sidecar contract, avoid import-time
model downloads, and include focused Python contract tests. Real and mock TTS
results must remain distinguishable.

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

- Importing or downloading heavy ML models during module import.
- Removing the control-token check from stateful routes.
- Writing generated files outside the configured runtime data directory.
- Treating mock audio as successful real generation without `mocked=true`.
- Editing SQL with unparameterized external values.

---

## Required Patterns

<!-- Patterns that must always be used -->

- Keep `main.py` thin and route work through focused modules.
- Keep platform-specific dependencies guarded in `requirements.txt` and runtime
  imports.
- Preserve explicit terminal task states and output-file evidence.
- Reuse `RuntimeStore`, `RuntimeState`, and existing route mixins.

---

## Testing Requirements

<!-- What level of testing is expected -->

Run from `apps/`:

```bash
PYTHONPATH=backend python3 -m unittest discover -s backend/tests
```

When Electron supervision changes, also run the focused
`frontend/electron/tts-runtime.test.ts` Vitest suite and the normal TypeScript
quality gate.

---

## Code Review Checklist

<!-- What reviewers should check -->

- Input validation and HTTP status are correct.
- Tokens, keys, prompts, and binary payloads are not leaked.
- Runtime state cannot remain stuck after failure.
- SQLite changes are additive and tested against an existing database shape.
- macOS ARM and Windows/Linux dependency branches remain valid.
