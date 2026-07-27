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
├── tts/
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
- Keep Electron process management in `apps/frontend/electron/tts/tts-runtime.ts`.

## Runtime Contract: Managed Python and Daojie direct runner

### 1. Scope / Trigger

This contract applies when changing Python runtime discovery, TTS sidecar startup,
Daojie HTTP-TTS direct runs, or storage/runtime documentation. The source tree
contains sidecar code; it is not a Python runtime distribution.

### 2. Signatures

```python
managed_python_executable_path(runtime_dir: Path, platform: str | None = None) -> Path
start_tts_backend() -> subprocess.Popen | None
```

Electron resolves the runtime from `<storageBasePath>/python`; the Daojie
direct runner resolves the same storage base from `MYSTUDIO_STORAGE_BASE_PATH`,
`<userData>/storage-config.json`, or a development fallback, then uses
`apps/backend` only as `PYTHONPATH` and the subprocess working directory.

### 3. Contracts

- macOS/Linux executable: `<storageBasePath>/python/bin/python3`.
- Windows executable: `<storageBasePath>/python/python.exe`.
- Sidecar data: `MANYING_TTS_DATA_DIR` and `--data-dir` point to the runtime
  data directory; model variables point to the configured model cache.
- `apps/backend/python` is not a supported directory and must never be used as
  a fallback candidate. Python runtime files belong only under the configured
  `<storageBasePath>/python`; do not add a runtime distribution to the sidecar
  source tree.
- The default Daojie video command does not enable HTTP TTS; the direct HTTP
  branch is opt-in through `MANYING_TTS_USE_HTTP=1`.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Existing TTS health check is healthy | Return without starting another process |
| Managed runtime executable exists | Start `tts.main` with backend `PYTHONPATH` |
| Managed runtime is missing | Raise a settings-directed configuration error before `Popen` |
| Only `apps/backend/python` exists | Treat the runtime as missing; never invoke the source-tree executable |

### 5. Good / Base / Bad Cases

- Good: a configured storage runtime starts the sidecar and writes data under
  the runtime data directory.
- Base: a healthy existing sidecar is reused without requiring a local runtime
  probe.
- Bad: copying or probing `apps/backend/python` to hide a missing Settings
  configuration.

### 6. Tests Required

- `apps/build/daojie/tests/test_tts_runtime_path.py` must assert platform
  executable selection, storage-runtime startup, missing-runtime error text,
  no source-tree fallback, and healthy-process reuse.
- `cd apps && PYTHONPATH=backend python3 -m unittest discover -s build/daojie/tests`.
- `cd apps && PYTHONPATH=backend python3 -m unittest discover -s backend/tests`.
- When packaging/build helpers change, run the focused build-script test and
  the applicable packaged smoke gate.

### 7. Wrong vs Correct

#### Wrong

```python
python_bin = BACKEND_ROOT / "python" / "bin" / "python3.12"
```

#### Correct

```python
python_bin = managed_python_executable_path(PYTHON_RUNTIME_DIR)
if not python_bin.exists():
    raise RuntimeError("请先到设置里的 Python 配置页点击开始配置，完成 TTS 依赖安装")
```

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

- `apps/backend/tts/main.py` demonstrates the thin entrypoint.
- `apps/backend/tts/server.py` owns shared HTTP behavior.
- `apps/backend/tests/test_tts_contract.py` demonstrates contract-focused tests.
