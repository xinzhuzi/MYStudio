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

## Scenario: audio asset creation from the asset library

### Contract

- `AddAssetDialog` with `type === "audio"` must call the existing
  `window.studioAssets.selectAudioFile` bridge, display the returned path, and
  pass that exact value as `sourceFilePath` to the existing `assets:add` IPC.
- The audio branch must not call `selectImageFile`; image asset behavior stays
  unchanged.

### Tests Required

- Render the dialog as an audio asset, resolve a deterministic audio path from
  `selectAudioFile`, assert the path is visible, and assert the `assets:add`
  payload contains the same `sourceFilePath`.
- Keep the packaged/installed smoke assertion that the asset voice flow can
  discover and play an audio asset (`assetVoiceFlow=ok`).

### Common Mistake

The dialog previously rendered no audio picker while still submitting the
image state as `sourceFilePath`; this made audio creation appear successful
without a selectable source file.

## Packaged production-canvas interaction gate

Production workflow canvas changes are not complete on unit tests alone. Build
and overwrite-install the current source through `npm run build:mac`, verify
the packaged and installed `app.asar` hashes match, then seed a real Daojie
clone and run the packaged 15-round zoom probe:

```bash
MYSTUDIO_BACKGROUND_WORKFLOW_REPORT_PATH=output/automation/background-workflow-daojie-current.json \
  npm run smoke:workflow:background:daojie

MYSTUDIO_ZOOM_PROBE_INPUT_REPORT_PATH=output/automation/background-workflow-daojie-current.json \
MYSTUDIO_ZOOM_PROBE_REPORT_PATH=output/automation/workflow-zoom-performance-current.json \
  node ./build/smoke/measure-workflow-zoom-performance.mjs
```

Acceptance requires 5 zoom-out, 5 zoom-in, and 5 fit rounds; every round must
have `transparentRatio=0`, `maximumNearBlackBandHeightCss=0`, empty
`geometryFailureReasons`, and `frameIntervalsOver100Ms=0`. Window return, pan,
25%/100%/200% controls, and resize must pass. A navigation/installed smoke or
Daojie clone alone does not prove a real Remotion MP4; keep that evidence in the
separate Remotion media gate.

## Source-contract test stability

Tests that inspect Electron source text should assert the stable boundary
contract (for example, lazy initialization through the context callback), not
an incidental local-variable spelling. When a helper intentionally snapshots
an externally visible source contract, keep the assertion focused on the
observable call and add a behavior test for the actual runtime path.

## Cancellation and Optional Bridge Contracts

Director generation cancellation has two ordered effects. `GenerationProgress`
must await `aiManager.initWorker()` and, when initialization succeeds, call the
initialized `AIWorkerBridge.cancel()` before the Director store's `cancelAll()`.
If worker initialization rejects, the handler must log the failure and still
apply `cancelAll()` so local UI state cannot remain generating.

`AIWorkerBridge` assigns a monotonically increasing `runId` to generation
commands, sends the active id with `CANCEL`, and drops run-bound events whose id
does not match the current active run. The protocol still permits legacy
runId-less events for compatibility; do not treat those events as fenced or
tighten that compatibility path without an explicit protocol decision and
regression tests.

Optional Electron bridges such as `projectFiles` must be read through a helper
that returns `undefined` when `typeof window === "undefined"` and otherwise
returns the exact preload object without reshaping it. Tests must cover both
the no-window case and object identity.

Required regressions include cancel-before-store ordering, initialization
failure recovery, late event suppression after cancel/supersession, and SSR
bridge lookup without a browser `window`.

## Scenario: local-only self-media provider boundary

### 1. Scope / Trigger

Main-process self-media IPC handlers receive `providerId` values from the
renderer and resolve them through `SelfMediaProviderRegistry`. The product
ships exactly one provider: the Electron-local `aitoearn-local` adapter.

### 2. Signatures

- `registry.get(providerId): SelfMediaProviderAdapter | undefined`
- `SelfMediaProviderId = "aitoearn-local"`
- Self-media list/create/login/poll/cancel handlers return `SelfMediaIpcReply<T>`.

### 3. Contracts

- Only `aitoearn-local` may reach the adapter path. Its MYStudio-owned package
  registry contains the exact 14 platform IDs. `douyin`, `xhs`, `wxSph`, and
  `KWAI` retain vendor-backed Electron transports; the other platform packages
  use injectable OAuth/API transports and fail with `transport-unavailable`
  when no transport is configured.
- The renderer has no MCP client, remote provider, API-key configuration, or
  fallback provider path. Login credentials remain main-process-only.
- An unknown provider returns `{ success: false, error: { code:
  "invalid-provider", message: "provider 无效" } }`.
- IPC channel names and successful reply payloads remain unchanged.

### 4. Validation & Error Matrix

- Unknown provider before list/create/poll/cancel adapter call -> typed
  `invalid-provider` reply.
- Non-local or malformed login request -> existing `invalid-login-request`
  reply before adapter lookup.
- A historical MCP/remote provider id -> typed `invalid-provider` reply and
  no adapter, network, or fallback invocation.
- Adapter throws -> existing normalized provider error behavior.
- Poll/cancel task with an invalid persisted provider -> typed
  `invalid-provider` reply, never an uncaught `undefined` dereference.

### 5. Good/Base/Bad Cases

- Good: check the adapter result before invoking `.listAccounts`, `.summary`,
  or an action method.
- Base: preserve the `aitoearn-local` bridge and its typed IPC channel.
- Bad: reintroduce `aitoearn-mcp`, a `remote:` capability, or a renderer-side
  API-key fallback because a local adapter call failed.

### 6. Tests Required

- Send an unknown provider to list and create handlers and assert the exact
  error code/message.
- Keep valid provider publish, progress, and task state tests.
- Assert the shared capability manifest, native panel controls, typed login
  boundary, and main-process platform registry contain the same exact 14 IDs.
- Search product code, package manifest, and lockfile for
  `aitoearn-mcp`, `@modelcontextprotocol/sdk`, and `remote:`; all must be
  absent.
- Cover the Electron IPC channel inventory and preload surface separately.

### 7. Wrong vs Correct

#### Wrong

```ts
const adapter = registry.get(request.providerId);
return adapter.listAccounts(request.projectId);
```

#### Correct

```ts
const adapter = registry.get(request.providerId);
if (!adapter) return disabled("invalid-provider", "provider 无效");
return adapter.listAccounts(request.projectId);
```

## Scenario: self-media asset and task safety

### 1. Scope / Trigger

Any local AiToEarn publish path that resolves renderer-selected assets or
creates a retry/cancel task through the Electron main process.

### 2. Signatures

- `resolveAsset(projectId, asset): Promise<SelfMediaResolvedAsset>`
- `createTask({ projectId, providerId, draft, previousTaskId? }): SelfMediaIpcReply<SelfMediaTask[]>`
- `pollTask/cancelTask({ projectId, taskId }): SelfMediaIpcReply<SelfMediaTask>`
- `decodeSelfMediaTaskRecord(value): SelfMediaTask`
- `SelfMediaTaskRuntime.poll/execute/cancel(task): Promise<SelfMediaTask>`
- `listOfficialAccounts(runtime): Promise<PlatformAccountInput[]>`
- `requestJson(runtime, url, init?): Promise<T>`
- `readOfficialAsset(runtime, url): Promise<OfficialAssetBytes>`

### 3. Contracts

- Production local publishing must use the main-process resolver; renderer
  URLs are never treated as filesystem paths by the provider adapter.
- Absolute asset paths must be inside the configured project/media roots and
  downloaded remote assets must use an explicitly allowlisted HTTPS host.
- `previousTaskId` must identify a failed or expired-login task belonging to
  the same project/provider; per-account retries reuse only that account.
- Cancel errors return a typed failure reply and leave the task state intact;
  terminal tasks reject further poll/cancel actions.
- IPC replies, the journal, and the persisted Zustand slice rebuild task and
  draft values from an allowlist. Credential-like and unknown fields are not
  passed to the renderer or written to disk.
- An asynchronous poll, scheduled publish, or cancel may commit only when the
  current record still has the same `attemptId`, is non-terminal, and permits
  the requested state transition.
- Official OAuth accounts require a decryptable OAuth credential and a finite,
  future `expiresAt`. Account projections expose only account id, name, avatar
  and status; they never expose credential or token fields.
- Official API failures expose platform id plus HTTP status only, never raw
  response text. Vendor calls serialize their temporary console override and
  redact every string passed through `log`, `error`, `warn`, `info`, `debug`
  and `trace` before the original console method receives it.
- Official transports re-check absolute asset paths against configured roots
  after `realpath`; lexical containment alone is insufficient for symlinks.

### 4. Validation & Error Matrix

- Missing production resolver -> `asset-resolver-unavailable` and no provider request.
- Absolute path outside an allowed root -> provider failure; no file read.
- Non-HTTPS or non-allowlisted remote asset -> provider failure; no download.
- Missing/cross-project/terminal retry source -> `invalid-previous-task`.
- Unsupported cancel -> provider error reply; task remains `running`/`scheduled`.
- Poll/cancel after a terminal status -> `task-terminal`.
- Late poll/scheduled-publish completion after cancel -> ignored; `canceled`
  remains the persisted terminal state.
- Missing typed `createTask` bridge during retry -> a visible failure; no
  renderer-only task or apparent success.
- Missing/unreadable OAuth credential -> account `error`; no publish call.
- Missing/invalid `expiresAt` -> account `error`; expired `expiresAt` -> account
  `expired` and publish/login refresh required.
- Platform error body contains token/cookie text -> normalized HTTP-status
  error; raw body is discarded.
- Absolute path is lexically inside a root but canonicalizes outside it ->
  provider failure; no file read.

### 5. Good/Base/Bad Cases

- Good: resolve `project-file://` and `local-image://` in main, then enforce
  canonical roots again in the local adapter.
- Good: project official account summaries from the encrypted vault and redact
  every standard string console method during vendor execution.
- Base: retain one immutable task record per attempt and link retries with
  `previousTaskId`.
- Base: retain only the documented task/draft fields after a journal round trip.
- Bad: pass `approvedUrl` directly to a local adapter when no resolver is
  installed, fetch arbitrary HTTP URLs, let a late result overwrite a terminal
  task, persist cookies/tokens with a draft, or append raw platform error text
  to a renderer-visible exception.

### 6. Tests Required

- Assert resolver enforcement, root traversal rejection, and HTTPS-only
  materialization.
- Assert retry-source project/provider/status validation and account scoping.
- Assert unsupported cancel preserves the original task and terminal actions
  are rejected.
- Assert late poll and scheduled results cannot overwrite cancellation; assert
  credential-like and unknown fields are rejected at IPC, journal, and store
  persistence boundaries.
- Assert OAuth online/expired/error projection, cross-platform vault filtering,
  and absence of `credential`, `accessToken` and `refreshToken` fields.
- Assert token/profile endpoint method, body and authorization headers for each
  official transport without external network calls.
- Assert all six standard vendor console methods receive redacted strings and
  are restored after serialized execution.
- Assert official absolute asset reads accept an in-root canonical file and
  reject an existing file outside the configured roots.

### 7. Wrong vs Correct

#### Wrong

```ts
if (asset.approvedUrl) return { assetId, url: asset.approvedUrl, kind };
```

#### Correct

```ts
if (resolveAsset) return resolveAsset(projectId, asset);
if (localBridge) throw new SelfMediaProviderError(providerId, "asset-resolver-unavailable", "主进程未提供受控资产解析器");
```

#### Wrong

```ts
throw new Error(`${platformId} API failed: ${providerResponse.message}`);
```

#### Correct

```ts
throw new Error(`${platformId} API 请求失败 (${response.status})`);
```

## Scenario: reviewed local AiToEarn snapshot upgrade

### 1. Scope / Trigger

Apply when refreshing the vendored AiToEarn Electron core under
`electron/aitoearn/vendor/aitoearn-core/`. The snapshot is upstream-owned;
the MYStudio adapter, IPC, UI, store, manifest, and compatibility matrix are
not upstream sync targets.

### 2. Signatures

- `runSync(check|dry-run|apply, --source-root, --manifest, --compatibility-matrix)`
- Source manifest `adapterContractVersion = "self-media/v1"`
- Matrix local entry `{ providerId: "aitoearn-local", upstreamCommit }`

### 3. Contracts

- `check` and `dry-run` validate the exact adapter contract, source hashes,
  MIT notice, source manifest, and reviewed compatibility matrix without
  modifying the vendor root.
- `apply` requires `--approve` plus the exact reviewed full commit. Its matrix
  entry must match the replacement commit before the atomic snapshot swap.
- Source entries, stale entries, and license metadata may not target the
  source manifest, previous manifest, license notice, adapter metadata, or any
  MYStudio-owned path. Source, vendor, and staging trees must contain no
  symlinks.
- An apply writes only listed vendor source files, preserves control files and
  a previous snapshot, and makes no network or platform publish call.

### 4. Validation & Error Matrix

- Wrong `adapterContractVersion` -> reject before reading/copying the source.
- Unreviewed or malformed ref -> reject before staging or rename.
- Matrix contract/commit mismatch -> reject apply; no vendor-root replacement.
- Reserved path or symlink -> reject check and apply; never follow the path.
- Tampered current snapshot -> block apply until a known-good snapshot is
  restored.
- Swap or manifest-write failure -> restore the exact old vendor root and
  manifest; do not delete an existing rollback.

### 5. Good/Base/Bad Cases

- Good: review a commit, update the local compatibility matrix deliberately,
  then run `dry-run` and `apply --approve --reviewed-ref <40-char-sha>`.
- Base: a pinned source whose checksum and matrix already match reports no
  unsafe replacement.
- Bad: copy an upstream tree over the vendor directory, permit a symlinked
  manifest entry, or let sync overwrite MYStudio adapter/UI/storage files.

### 6. Tests Required

- Cover contract-version, reserved-path, symlink, unreviewed-ref,
  compatibility-matrix, stale/tampered snapshot, rollback, and protected
  sentinel cases in `sync-aitoearn-core.test.mjs`.
- Assert the shipped matrix commit and contract version match the source
  manifest.
- Keep the mocked upgrade smoke at `networkRequests=0` and
  `externalPublishAttempts=0`; then run the focused suite, typecheck, lint,
  full Vitest, macOS packaging, and packaged desktop smoke.

### 7. Wrong vs Correct

#### Wrong

```ts
await cp(sourceRoot, vendorRoot, { recursive: true, force: true });
```

#### Correct

```ts
await runSync([
  "apply", "--source-root", sourceRoot, "--approve",
  "--reviewed-ref", reviewedCommit,
]);
// runSync validates the local matrix, stages, swaps atomically, and rolls back on failure.
```

## Scenario: vendored snapshot native-module boundary

### 1. Scope / Trigger

Any bare import pulled in from `electron/aitoearn/vendor/aitoearn-core/`, or any
new dependency reachable from an Electron main entry in
`frontend/config/electron-vite.config.ts`.

### 2. Signatures

- `sharedAlias` in `frontend/config/electron-vite.config.ts`
- `electron/aitoearn/providers/aitoearn-local/compatibility/<module>.ts`

### 3. Contracts

- The main bundle must contain no native module. rollup cannot bundle a `.node`
  binary, so a native import survives typecheck, lint, Vitest, and the dev run,
  then crashes the packaged app at startup.
- A vendor bare import is redirected through `sharedAlias` to a named shim under
  `providers/aitoearn-local/compatibility/`. The vendor file is never edited.
- A shim implements only the surface the vendor actually consumes. Do not port
  the upstream module's full API.
- A dependency used only by a shim replacement stays out of `dependencies`; it
  must not be required at runtime.

### 4. Validation & Error Matrix

- Native import reaches the main bundle -> packaged app throws
  `Could not load the "<module>" module using the <platform> runtime` at
  `app.asar/out/main/index.cjs` before the window opens.
- Shim missing an API the vendor calls -> `TypeError` at publish time, not build
  time; the shim's regression test must cover every consumed method.
- Unsupported input -> the shim throws a typed error. It never returns zeroed or
  guessed values, which would silently corrupt an upload.

### 5. Good/Base/Bad Cases

- Good: `sharp` is consumed only as `sharp(buffer).metadata()` for width/height
  (`vendor/.../plat/utils/index.ts:38`), so `compatibility/sharp.ts` wraps the
  existing pure-JS `image-size` reader.
- Base: keep each shim aligned with the upstream source path it replaces and
  record it in `compatibility/provider-matrix.json` `requiredShims`.
- Bad: add the native package to `dependencies` plus `asarUnpack`, or mark it
  external, to make the bundler stop complaining.

### 6. Tests Required

- One regression test per shim covering each consumed method and the
  fail-closed path.
- After changing a shim or alias, rebuild and assert the produced
  `apps/out/main/index.cjs` contains no native binary reference, then package and
  scan the installed `app.asar` bytes for the same reference.

### 7. Wrong vs Correct

#### Wrong

```ts
// devDependencies-only native module bundled into the main process
import sharp from "sharp";
const { width, height } = await sharp(buffer).metadata();
```

#### Correct

```ts
// frontend/config/electron-vite.config.ts
sharp: path.join(aitoearnCompatibility, "sharp.ts"),

// compatibility/sharp.ts — only the consumed surface, fail-closed on bad input
export default function sharp(buffer: Buffer): SharpInstance {
  return { async metadata() { const { width, height, type } = imageSize(buffer); return { width, height, format: type }; } };
}
```

---

## Testing Requirements

<!-- What level of testing is expected -->

For the complete repository gate, run the single orchestration entry from
`apps/`:

```bash
npm run test:all
```

This command is the only aggregate runner to maintain. It invokes the curated
AiToEarn/build-contract tests, `typecheck`, `lint`, the full Vitest suite, the
local-only upgrade smoke, and on macOS the packaging/overwrite-install and
packaged desktop smoke stages in a fixed fail-fast order. Its durable report is
`apps/output/automation/quality-gate-report.json`; use `--plan` to inspect the
current stage list and `--skip-release` for non-release iteration. Individual
commands below remain useful for focused debugging, but new verification logic
should be added to the underlying command or test rather than duplicated in
the aggregate runner.

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
