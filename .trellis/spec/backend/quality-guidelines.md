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
- TTS generation is keyed by the exact shot input fingerprint (project/chapter/shot
  identity, shot revision, text, resolved voice profile/engine/model/language/seed,
  and reference-audio SHA). A chapter-wide dialogue file must not be generated and
  blindly sliced into shots.
- Generation persistence is additive and idempotent: the same fingerprint reuses a
  generating/completed record, transient transport failures may retry twice, and a
  terminal shot failure is isolated from independent shots. Cancellation checks at
  submit/poll/fetch/save/writeback boundaries must discard late results.

---

## Testing Requirements

<!-- What level of testing is expected -->

Run from `apps/`:

```bash
PYTHONPATH=backend python3 -m unittest discover -s backend/tests
```

When Electron supervision changes, also run the focused
`frontend/electron/tts/tts-runtime.test.ts` Vitest suite and the normal TypeScript
quality gate.

---

## Code Review Checklist

<!-- What reviewers should check -->

- Input validation and HTTP status are correct.
- Tokens, keys, prompts, and binary payloads are not leaked.
- Runtime state cannot remain stuck after failure.
- SQLite changes are additive and tested against an existing database shape.
- Python contract tests cover fingerprint/revision isolation, bounded concurrency,
  retry classification, cancellation, restart recovery, and independent shot
  failure without falsely marking mock/fallback audio as real.
- macOS ARM and Windows/Linux dependency branches remain valid.
