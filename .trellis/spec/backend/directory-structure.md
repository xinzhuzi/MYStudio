# Directory Structure

> How backend code is organized in this project.

---

## Overview

<!--
Document your project's backend directory structure here.

Questions to answer:
- How are modules/packages organized?
- Where does business logic live?
- Where are API endpoints defined?
- How are utilities and helpers organized?
-->

The backend is a local Python sidecar started and supervised by Electron. It
provides TTS, voice cloning, model management, and transcription; it is not a
standalone remote web service.

---

## Directory Layout

```
apps/backend/
├── manying_voicebox_tts/
│   ├── main.py              # thin module entrypoint
│   ├── server.py            # HTTP server and top-level routing
│   ├── generation_routes.py # generation and transcription routes
│   ├── model_routes.py      # model download/cache routes
│   ├── engine.py            # TTS/STT engine adapters
│   ├── runtime_state.py     # threads, queues, and task state
│   └── storage.py           # SQLite runtime persistence
├── tests/                   # unittest contract tests
└── requirements.txt         # sidecar dependencies
```

---

## Module Organization

<!-- How should new features/modules be organized? -->

- Keep `main.py` as a thin re-export and `python -m` entrypoint.
- Put HTTP dispatch and shared response helpers in `server.py`.
- Put route-family behavior in focused mixins such as
  `GenerationRoutesMixin` and `ModelRoutesMixin`.
- Put inference adapters in `engine.py`; load heavy model libraries lazily.
- Keep Electron process management in `apps/frontend/electron/tts-runtime.ts`.

---

## Naming Conventions

<!-- File and folder naming rules -->

- Python modules and functions use `snake_case`; classes use `PascalCase`.
- Tests use `test_*.py` and methods beginning with `test_`.
- Runtime files belong under the configured data directory, never in source or
  packaged application directories.

---

## Examples

<!-- Link to well-organized modules as examples -->

- `apps/backend/manying_voicebox_tts/main.py` demonstrates the thin entrypoint.
- `apps/backend/manying_voicebox_tts/server.py` owns shared HTTP behavior.
- `apps/backend/tests/test_tts_contract.py` demonstrates contract-focused tests.
