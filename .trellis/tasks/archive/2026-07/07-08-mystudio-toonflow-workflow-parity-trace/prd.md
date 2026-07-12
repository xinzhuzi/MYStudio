# MYStudio Toonflow workflow parity trace

## Goal

Trace the real Toonflow production workflow end to end, map every important contract to the current MYStudio workflow, and add the first absorbable parity layer: a durable audit ledger plus a typed workflow parity report that makes missing contract evidence visible in tests and smoke reports.

This task is broader than the earlier Daojie chapter/image fixes. It must explain which Toonflow mechanisms have not been traced, which should be absorbed, and how MYStudio can prove workflow integrity without confusing UI previews with real generation.

## Background And Evidence

- Existing audit `docs/融合/Toonflow_MYStudio_分镜差异审计.md` proves MYStudio chapter-001 does not reuse Toonflow's original `o_storyboard`, `o_assets2Storyboard`, `o_assets.imageId`, or golden images.
- Toonflow agent tools expose real workspace operations such as `get_flowData`, `add_flowData_storyboard`, `generate_storyboard`, `add_deriveAsset`, and `generate_deriveAsset`.
- Toonflow storyboard image generation uses ordered references: `o_assets2Storyboard.rowid -> o_assets.imageId -> o_image.filePath`, then passes `referenceList`, project image model, image quality, art style, and video ratio to the image provider.
- MYStudio already has a six-node workflow model: `script`, `scriptPlan`, `assets`, `storyboardTable`, `storyboard`, `workbench`.
- MYStudio already stores many Toonflow-shaped storyboard fields, including `videoDesc`, `prompt`, `assetIds`, `shouldGenerateImage`, media refs, audio refs, and optional consistency fields.
- Current missing layer is a single contract report that proves each workflow node has real input, action, writeback, status, and report evidence.

## Requirements

- R1. Create a Trellis task with `prd.md`, `design.md`, and `implement.md` before code changes.
- R2. Add a persistent trace ledger under `docs/融合/` with Toonflow evidence, MYStudio evidence, parity status, impact, absorb action, and validation command for each workflow area.
- R3. Add a typed MYStudio workflow parity report builder that summarizes:
  - node execution contract status
  - storyboard table contract completeness
  - ordered reference evidence
  - skill/manual injection evidence
  - image workflow state evidence
  - TTS/audio evidence
  - video/workbench export evidence
  - evidence boundary between seeded UI smoke, visible workflow smoke, real Daojie smoke, and real media generation
- R4. Extend storyboard types/projections with optional source and ordered-reference evidence without breaking old projects.
- R5. Add focused tests that fail when Toonflow-critical fields are dropped or when a workflow node has no real writeback/report evidence.
- R6. Keep storage boundaries unchanged: project workflow data stays under `_p/{projectId}/...`; independent asset library writes are not introduced by this task.
- R7. Do not replace MYStudio's data model with Toonflow DB tables. Absorb mechanisms, not the full schema.
- R8. Do not package Daojie project content into the app bundle. Daojie remains a user project on disk.
- R9. Do not run git/worktree commands.
- R10. Maintain the 2026-07-10 current-state gap matrix with explicit status labels: implemented, partial, config-placeholder, missing, or do-not-copy.
- R11. Split the remaining Toonflow absorption work into independently verifiable goals:
  - current documentation and Trellis state convergence
  - workflow run kernel
  - toolized Agent orchestration and supervision loop
  - event graph and project memory
  - asset/storyboard/audio/video taskization
  - Toonflow fixture and golden comparison validation
- R12. Prefer MYStudio-native typed services and project-scoped stores over direct Toonflow DB/schema replacement.
- R13. Treat `StudioAgentRun`, advanced generation options, and agent deployment keys as incomplete until production execution paths read and persist them.

## Acceptance Criteria

- [x] Trellis task artifacts exist and validate.
- [x] `docs/融合/MYStudio_Toonflow_工作流全链路追溯矩阵.md` contains at least the ten requested gap areas: agent tools, storyboard source, asset reference order, project model context, director plan detail, image workflow semantics, derived assets, video/workbench, TTS/audio, and evidence boundaries.
- [x] `docs/融合/MYStudio_Toonflow_工作流全链路追溯矩阵.md` contains the 2026-07-10 current-state review with status labels and the six target plan.
- [x] `StoryboardItem` can preserve optional `sourceEvidence` and ordered reference manifest data.
- [x] `buildStudioFlowData()` preserves storyboard `index`, source evidence, and ordered reference manifest in the Toonflow-shaped flow projection.
- [x] A new workflow parity report builder produces node, storyboard, reference, skill, image, audio, video, and evidence-boundary summaries from existing MYStudio data.
- [x] Focused tests pass:
  - `cd apps && npm test -- frontend/lib/studio/studio-flow-data.test.ts frontend/lib/studio/workflow-parity-report.test.ts frontend/components/panels/studio/workflow-node-model.test.ts`
- [x] Type and quality gates pass, or failures are reported with exact commands and reasons:
  - `cd apps && npm run typecheck`
  - `cd apps && npm run lint`
- [x] Full smoke/media/build/install commands are not claimed as passed unless freshly run.

## Out Of Scope

- Direct import of Toonflow DB data into MYStudio project stores.
- Full visual golden-image comparison implementation.
- Replacing all image generation logic.
- Running `npm run video:daojie:chapter001` unless explicitly needed after this contract layer.
- Running package/install unless UI or Electron runtime code changes require it.

## Open Questions

No user decision is blocking planning. The default is to reuse this parent task and execute goal one first, then implement the workflow run kernel before migrating more Toonflow UI/database surface. Daojie/Toonflow EP01 remains a golden audit fixture rather than a global default for all MYStudio projects.
