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

```typescript
type TtsRuntimeStatus = {
  sidecarAvailable: boolean;
  pythonInstalled: boolean;
  pythonExecutablePath?: string;
  dependenciesReady: boolean;
  running: boolean;
};

controller.start(): Promise<TtsRuntimeCommandResult>
controller.readRequirements(): Promise<{ content: string; path: string } | null>
controller.deleteRuntime(): Promise<TtsRuntimeCommandResult>
```

Electron resolves the runtime from `<storageBasePath>/python`; the Daojie
direct runner resolves the same storage base from `MYSTUDIO_STORAGE_BASE_PATH`,
`<userData>/storage-config.json`, or a development fallback, then uses
`apps/backend` only as `PYTHONPATH` and the subprocess working directory.

### 3. Contracts

- macOS/Linux executable: `<storageBasePath>/python/bin/python3`.
- Windows executable: `<storageBasePath>/python/python.exe`.
- `TtsRuntimeStatus.installed` is only a compatibility alias for
  `sidecarAvailable`. Renderers must use `pythonInstalled` and
  `dependenciesReady` for Python readiness and display
  `pythonExecutablePath` as the main-process-resolved executable.
- The dependency marker is `<storageBasePath>/TTS/runtime/.deps-hash`, derived
  from the exact managed Python path and the current sidecar
  `requirements.txt` content. A matching marker is the fast path.
- When the marker is absent or stale, `start()` may repair it only after the
  managed Python successfully runs `pip install --dry-run --no-index --report
  - --quiet -r <current requirements>` and the decoded JSON has
  `install: []`. This probe must not install packages or use the network.
- A failed command, invalid report, or non-empty `install` array is
  fail-closed: do not write the marker and do not spawn the sidecar. Package
  installation remains an explicit `setup()` action.
- `readRequirements()` always reads the currently resolved sidecar file; it
  must not trust a historical absolute path from `installedItems`.
- Renderer deletion is a no-payload IPC action. The main process resolves and
  removes only `<storageBasePath>/python`, then clears the marker, installed
  rows, and setup state. Renderer-provided recursive-delete paths are forbidden.
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
| Dependency marker matches | Skip the pip dry-run probe |
| Marker is absent/stale and pip report has `install: []` | Write the current marker, refresh installed dependency state, then start |
| Pip report needs installs, is invalid, or the command fails | Return a configuration error; do not write the marker or spawn |
| Delete requested from the renderer | Stop TTS, delete only the main-resolved runtime, and return fresh status |
| TTS cannot stop or runtime removal fails | Return failure and do not report deletion success |

### 5. Good / Base / Bad Cases

- Good: a configured storage runtime starts the sidecar and writes data under
  the runtime data directory.
- Base: a healthy existing sidecar is reused without requiring a local runtime
  probe.
- Good: an application upgrade changes `requirements.txt`; the existing
  environment produces `install: []`, so the marker self-heals offline and the
  backend starts without reinstalling dependencies.
- Bad: copying or probing `apps/backend/python` to hide a missing Settings
  configuration.
- Bad: treating sidecar source availability as proof that Python and its
  dependencies are configured, or accepting a renderer path for recursive
  deletion.

### 6. Tests Required

- `apps/build/daojie/tests/test_tts_runtime_path.py` must assert platform
  executable selection, storage-runtime startup, missing-runtime error text,
  no source-tree fallback, and healthy-process reuse.
- `frontend/electron/tts/tts-runtime.test.ts` must cover matching-marker fast
  path, absent/stale self-heal, pending installs, invalid JSON, command failure,
  current-sidecar requirements reads, and isolated delete-to-reconfigure state.
- IPC/preload/client/component tests must assert the no-payload delete contract,
  removal of renderer path reset, explicit status fields, setup failure
  propagation, and visible Python/TTS control behavior.
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
    raise RuntimeError("请先到设置里的插件配置页点击开始配置，完成 TTS 依赖安装")
```

For dependency readiness, do not refresh a marker merely because Python
exists:

```typescript
// Wrong: hides missing or incompatible dependencies.
writeTextFile(markerPath, reqHash);

// Correct: only the strict offline pip report can authorize self-healing.
const pendingInstalls = readPipDryRunInstallList(await runOfflineProbe());
if (!pendingInstalls || pendingInstalls.length > 0) return dependencyError();
writeTextFile(markerPath, reqHash);
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
