# Design

## Problem Restatement

MYStudio currently resembles Toonflow in visible workflow shape, but key production contracts are scattered or unproven. The system needs a traceable parity layer that says which Toonflow contracts exist in MYStudio, which are missing, and which runtime evidence proves each workflow stage.

## Data Flow

```text
MYStudio project state
  -> StoryboardItem / ScriptPlan / ProductionTrack / VideoCandidate
  -> buildStudioFlowData()
  -> buildProductionFlowModel()
  -> buildWorkflowParityReport()
  -> tests / smoke reports / human audit ledger
```

Toonflow evidence is documented in the trace ledger, not stored as a replacement schema. MYStudio runtime data remains the source of truth for the parity report.

## Persistent Contracts

- `StoryboardItem.sourceEvidence` is optional metadata for the origin of a storyboard row, such as MYStudio agent, Toonflow import, canonical script, or smoke seed.
- `StoryboardItem.orderedReferenceManifest` is optional ordered reference evidence. When present, it records the exact sequence used to build image references. This is the MYStudio-side equivalent of Toonflow's `o_assets2Storyboard.rowid -> o_assets.imageId -> o_image.filePath`.
- `StudioFlowStoryboardItem` must preserve `index`, `sourceEvidence`, and ordered reference data so UI/model/report code does not recalculate contracts from raw stores.
- `buildWorkflowParityReport()` is a pure frontend-library function. It reads existing typed MYStudio inputs and emits counts/issues only; it does not mutate project data.

## Report Contract

The report contains:

- `nodes`: expected six-node contract with booleans for input, action, writeback, and report evidence.
- `storyboard`: total rows and counts for required Toonflow fields.
- `references`: ordered-reference coverage, missing image references, and raw asset-name leak count.
- `skills`: selected visual/director manuals and whether selected modules are present for director plan, storyboard table, storyboard prompt, and video prompt contexts.
- `images`: state counts and image workflow link counts.
- `audio`: storyboards with lines, speaker IDs, and audio refs.
- `video`: track/candidate/final export evidence.
- `evidenceBoundary`: explicit booleans separating seeded smoke, visible workflow smoke, real Daojie visible smoke, and real media generation.
- `issues`: blocking or warning strings suitable for tests and smoke report output.

## 2026-07-10 Remaining Architecture Direction

The first parity layer is complete enough to expose evidence gaps, but it is not the final workflow kernel. The next architecture layer should be built in this order:

1. `StudioAgentRun` becomes a persisted project-scoped run ledger. Each workflow stage writes `runId`, `status`, `inputFingerprint`, `outputRefs`, `error`, `retryCount`, `checkpoint`, `startedAt`, and `finishedAt`.
2. Workflow artifacts carry producer run ids and input fingerprints. When upstream script, director plan, storyboard table, asset references, voice bindings, or media inputs change, downstream artifacts are marked stale instead of silently retaining ready candidates.
3. Agent orchestration goes through a typed tool registry. A decision/supervision Agent may request operations, but only MYStudio services perform writes.
4. Event graph and memory stay project-scoped. The system may absorb Toonflow short-term memory, summaries, embeddings, and deep retrieval, but not unbounded full-table vector scans.
5. Asset, image, TTS, and video generation become run-kernel tasks with per-item progress, retry, cancel, resume, and writeback evidence.
6. Toonflow fixture/golden comparison remains a validation layer, not a runtime dependency.

## Absorb / Do Not Copy Decisions

- Absorb Toonflow's decision Agent, sub-Agent tools, run states, ordered references, event graph, memory retrieval, model-aware video prompt generation, and supervision loop.
- Do not copy Toonflow's SQLite schema wholesale into MYStudio project storage.
- Do not execute arbitrary user TypeScript vendor code. MYStudio should expose a restricted provider adapter contract.
- Do not turn the six-stage MYStudio workflow into a fully free global graph. Keep the six business stages stable and make stage-internal task graphs extensible.

## Compatibility

- Old project data does not have `sourceEvidence` or `orderedReferenceManifest`; both fields remain optional.
- Existing `assetIds` order remains unchanged.
- `shouldGenerateImage` semantics remain unchanged: explicit `false` means skip unless forced; existing image media makes generation unnecessary.
- The report must not assume Daojie-specific data or Toonflow DB availability.

## Trace Ledger

The ledger under `docs/融合/` is the human-readable source for the broader audit. It maps each Toonflow mechanism to current MYStudio state and gives the absorb decision. This prevents future work from treating a single UI fix as full parity.

## Validation Strategy

- Unit tests cover the projection and report builder with both complete and incomplete data.
- Existing workflow-node tests continue proving six-node model shape and action labels.
- Typecheck catches cross-layer type drift.
- Lint catches unused report fields or accidental debug leftovers.
- Smoke/build/media gates remain separate and are not claimed unless rerun.
- Future validation should move from inferred evidence to real run-ledger evidence before any new Agent migration is marked complete.
