---
name: mystudio-workflow-integrity-testing
description: Use when verifying MYStudio workflow completeness, step-by-step app workflow execution, storyboard/video workflow node graph, Toonflow-style node parity, director-plan markdown previews, derived asset links/thumbnails, workbench export state, project-scoped persistence, packaged Electron smoke coverage, 工作流自动运行, or questions like "有没有自动化测试这个工作流?" and "资产保存路径有没有分清楚?"
---

# MYStudio Workflow Integrity Testing

Use this skill to prove the workflow is complete with fresh evidence, not impressions. Scope includes the Studio workflow graph, workflow data, preview rendering, asset links, storage boundaries, and packaged app smoke tests.

## Path dictionary

- `<repo-root>` means `/Users/zhengbingjin/Project/Github/MYStudio`; run npm commands from `<repo-root>/apps`. This `SKILL.md` and all `apps/...` paths below are repository source/instructions, read-only to the running product.
- Workflow UI and model sources are under `<repo-root>/apps/frontend/components/panels/studio/`; the smoke bridge is `<repo-root>/apps/frontend/lib/studio/workflow-smoke-bridge.ts`; packaged smoke is `<repo-root>/apps/build/smoke/smoke-desktop.mjs`. All three are source entry points, not runtime write targets.
- `<userData>` is Electron's per-user application-data directory. `<storageBasePath>` is the runtime-writable storage root resolved from `<userData>/storage-config.json`; project workflow state is stored under `<storageBasePath>/projects/_p/<projectId>/`, while the independent asset library is `<storageBasePath>/assets/`.
- Product-editable skills are `<storageBasePath>/skills/`. The bundled seed source `<repo-root>/apps/frontend/assets/studio-manuals/` is read-only; AI/development skills under `<repo-root>/.agents/skills/`, `~/.codex/skills/`, or `~/.agents/skills/` are not product data.
- The default durable smoke report is `<repo-root>/apps/output/automation/desktop-smoke-report.json` (generated, writable runtime/output evidence); use `MYSTUDIO_SMOKE_REPORT_PATH` to override it.

## Ground Rules

- Work from `/Users/zhengbingjin/Project/Github/MYStudio`.
- Run npm commands from `apps/`.
- Do not run git commands unless the user explicitly asks.
- Treat old logs as stale. Rerun the relevant check before saying it passes.
- Do not claim "修好了" or "完整" unless the matching verification command just passed.
- Do not create files at repo root. Temporary screenshots or probes go under `/tmp`.
- Before packaged, visible, installed, or real Daojie smoke tests, close all existing MYStudio app instances. The smoke scripts do this automatically by default; only set `MYSTUDIO_SMOKE_SKIP_PREKILL=1` for deliberate debugging.
- Wait for Electron/build/smoke sessions to exit before final reporting.

## Storage Boundary

Keep these separate when testing or fixing workflow behavior:

- Project workflow/state files: `<storageBasePath>/projects/_p/<projectId>/...`, including `studio-workflow-store`, `characters`, `scenes`, and project file URLs such as `project-file://...`.
- Independent asset library: `<storageBasePath>/assets/assets.db` and `<storageBasePath>/assets/files/...`; this is the existing `{basePath}/assets/assets.db` and `assets/files/...` contract after `basePath` resolves to `<storageBasePath>`.

Workflow node generation, storyboard images, character/scene/prop project state, and smoke seed data should stay project-scoped unless the user explicitly asks to write the independent asset library.

## Evidence Types

- seedCompleteWorkflow() is only a seeded preview regression. It proves node previews, links, markdown rendering, image tiles, and export state can render from complete data.
- Step-by-step app execution is the only proof of workflow auto-run. The default proof uses the background runner; visible execution is reserved for explicit human observation. Both must start the packaged app, click through the workflow route and stages, run one deterministic stage at a time, wait for readiness/evidence, then move to the next stage.
- Report the tested data source exactly: isolated smoke project, 真实用户项目, or 真实《道劫》项目.
- In the isolated smoke project, deterministic smoke providers may replace real AI/image/TTS/rendering providers. Do not describe that as a real model run.
- normal visible app startup is separate from automated smoke. Use `npm run smoke:workflow:open` when the user needs to see the packaged app start and stay open.
- visible step-by-step workflow runner is separate from normal startup. Use `npm run smoke:workflow:run` when the user needs to watch the packaged app click through stages, wait for results, and stay open afterward.
- Visible step-by-step evidence must include `[visible-run] stage ...` logs for each stage and a final `frontmostApp=漫影工作室` line; a hidden `progress=100` result alone is not enough.
- Background step-by-step evidence must include `mode=background`, `windowVisibility`, `documentHasFocus`, `focusSamples`, `foregroundViolation=false`, stage logs, and a durable report. It must not invoke `Page.bringToFront`, `window.focus()`, or macOS `System Events` on its background branch.
- Real Daojie validation uses `npm run smoke:workflow:run:project`. It must load the 真实《道劫》第一章节项目 (`chapter-001`) from the user's real project data clone, not an empty smoke template; report that it is 不是 empty smoke template.

## Integrity Checklist

Verify the workflow in layers:

1. **Model contract**
   - Check `apps/frontend/components/panels/studio/workflow-node-model.ts`.
   - Expected node ids: `script`, `scriptPlan`, `assets`, `storyboardTable`, `storyboard`, `remotionProduction`, `workbench`.
   - Expected edges: `script -> scriptPlan`, `script -> assets`, `scriptPlan -> storyboardTable`, `storyboardTable -> storyboard`, `storyboard -> remotionProduction`, `remotionProduction -> workbench`.

2. **Preview contract**
   - Check `WorkflowNodePreviews.tsx`, `WorkflowProductionNode.tsx`, and `WorkflowNodeCanvas.tsx`.
   - `script` and `scriptPlan` must render markdown via `MdPreview`.
   - `assets` must show Toonflow-style source/derived cards, parent asset ids, flow ids, states, prompts/reasons, and real image previews when linked.
   - Clicking a derived asset card must open the asset image workflow detail with the parent image as the reference node, the derived result as the generated node, and the existing flow id reused when present.
   - `storyboard` must show generated image tiles when `mediaRef.path` exists.
   - `remotionProduction` must show the current chapter's StoryboardShot queue, per-shot state, current MP4/evidence readiness, and fail-closed blockers.
   - `workbench` must show the native Remotion Studio boundary, ChapterVideo renderer/evidence state, and project-scoped chapter output. Legacy track/candidate fields are compatibility metadata, not the current production path.

3. **Smoke bridge seed**
   - Check `apps/frontend/lib/studio/workflow-smoke-bridge.ts`.
   - Seed data should include script, director plan, derived asset plan, character/scene/prop media, storyboard image, voice binding, and isolated project-scoped editing evidence. Legacy track/candidate fields may remain in the seed for projection compatibility, but they must not be used as proof of Remotion production; the model contract must still expose the `remotionProduction` node.
   - Smoke seed must use isolated smoke user data and project-scoped stores.

4. **Packaged smoke assertions**
   - Check `apps/build/smoke/smoke-desktop.mjs`.
   - It should assert route health, workflow stages, React Flow canvas, node FlowData text, `hasDirectorPlanPreview`, `hasToonflowDerivativeLinks`, `hasStoryboardImagePreview`, voice flow, Python settings, and visual stats.
   - Screenshot timeout is acceptable only if the script exits `0` and DOM visual fallback reports a low `whiteRatio`.

## Step-by-Step Review And Test Flow

Review evidence before running the matching test. Do not collapse the checklist into only `npm run smoke:desktop`; smoke is the final packaged gate, not a substitute for layer-by-layer review.

1. **Step 1 - Skill contract review**
   - Review this `SKILL.md` and `apps/frontend/config/build-scripts.test.ts`.
   - Test: `npm test -- frontend/config/build-scripts.test.ts`.

2. **Step 2 - Model contract test**
   - Review node ids, edges, metrics, target stages, the `enqueue-remotion-shots` action, and storage/project assumptions in `workflow-node-model.ts`.
   - Test: `npm test -- frontend/components/panels/studio/workflow-node-model.test.ts`.

3. **Step 3 - Preview contract test**
   - Review markdown previews, derived asset cards, storyboard images, the Remotion shot-production preview, native Studio workbench lanes, and theme-aware canvas controls.
   - Test: `npm test -- frontend/components/panels/studio/workflow-node-previews.test.tsx frontend/components/panels/studio/workflow-tabs.test.ts`.

4. **Step 4 - Smoke bridge seed test**
   - Review `workflow-smoke-bridge.ts` for director plan, derived assets, image refs, voice binding, isolated project-scoped editing evidence, and the explicit boundary that seeded track/candidate fields are compatibility-only rather than Remotion production evidence.
   - Test: `npm test -- frontend/lib/studio/workflow-smoke-bridge.test.ts`.

5. **Step 5 - Step-by-step app execution smoke**
   - Review `apps/build/smoke/smoke-desktop.mjs` for `verifyWorkflowStepByStepExecution`.
   - Confirm the smoke entry closes existing MYStudio instances before launching the packaged app.
   - It must use `resetForStepwiseExecution`, `runStepwiseWorkflowStage`, `inspectWorkflowStages`, and wait for each stage to become ready.
   - It must not use `seedCompleteWorkflow()` as a substitute for the execution path.
   - It must write durable evidence to `apps/output/automation/desktop-smoke-report.json`, or to `MYSTUDIO_SMOKE_REPORT_PATH` when that variable is set.
   - Test: `MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1 npm run smoke:desktop`.
   - Background workflow runner: `npm run smoke:workflow:background`.
   - Real Daojie background runner: `npm run smoke:workflow:background:project`.
   - Real Daojie background automatic-video runner: `npm run smoke:workflow:background:project -- --auto-video`.
   - Visible test: `MYSTUDIO_SMOKE_FOREGROUND=1 MYSTUDIO_SMOKE_HOLD_MS=15000 MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1 npm run smoke:desktop`.
   - Normal visible app startup: `npm run smoke:workflow:open`. This starts the packaged app with isolated smoke data and leaves it open for human inspection.
   - Visible step-by-step workflow runner: `npm run smoke:workflow:run`. This starts the packaged app with isolated smoke data, clicks through each workflow stage with a visible delay, waits for stage evidence, and leaves the app open.
   - Required visible evidence: stage logs like `[visible-run] stage script clicked ...`, final `progress=100`, and final `frontmostApp=漫影工作室`.
   - Real Daojie first-chapter visible runner: `npm run smoke:workflow:run:project`. This clones the real `道劫` project data into a temporary userData dir, opens `chapter-001`, clicks all workflow stages, verifies real chapter evidence such as storyboards, Remotion StoryboardShot jobs/current-slot MP4/evidence, derived asset project records, and asset image workflows with reference/generated nodes, then clicks at least one real `asset-flow-chapter-001*` derived asset card and waits for the image workflow detail to show the parent reference node, generated node, and writeback target.
   - Default real Daojie automatic-video runner: `npm run smoke:workflow:background:project -- --auto-video`. `MYSTUDIO_WORKFLOW_AUTO_VIDEO=1 npm run smoke:workflow:background:project` enables the same path; set `MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS` to a positive millisecond value when the default `600000` is insufficient.
   - AC6 passes only when `chapterAutoVideo.terminalStage` is `completed`, the run did not time out, and `chapterAutoVideo.finalPath` in `apps/output/automation/background-workflow-daojie-report.json` ends in `.mp4` and exists on disk. A failed, timed-out, foreground-violating, or missing-MP4 auto-video run must not count toward AC6.

6. **Step 6 - Build and packaged smoke test**
   - Review `apps/build/smoke/smoke-desktop.mjs` for route, stage, node preview, storage, visual, and voice assertions.
   - Confirm stale MYStudio process cleanup runs before the tested app is spawned.
   - Test: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:mac`, then `npm run smoke:desktop`.

7. **Step 7 - Visual inspection**
   - Open the packaged app with an isolated `mystudio-smoke-*` user data dir, seed `window.mystudioWorkflowSmoke.seedCompleteWorkflow()`, switch to `storyboard`, and capture `/tmp` evidence.
   - Confirm all seven nodes, including the Remotion shot-production queue, markdown director plan, derived asset image/link cards, storyboard image, native Studio/ChapterVideo state, no default white React Flow controls, and themed viewport controls.

## Required Commands

For workflow UI, storage, smoke, or Electron-facing changes, run:

```bash
cd apps
npm test -- frontend/config/build-scripts.test.ts frontend/components/panels/studio/workflow-node-model.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx
npm run typecheck
npm run lint
npm test
npm run build:mac
npm run smoke:desktop
MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1 npm run smoke:desktop
npm run smoke:workflow:background
npm run smoke:workflow:background:project
npm run smoke:workflow:background:project -- --auto-video
npm run video:daojie:chapter001:probe-providers
MYSTUDIO_SMOKE_FOREGROUND=1 MYSTUDIO_SMOKE_HOLD_MS=15000 MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1 npm run smoke:desktop
npm run smoke:workflow:open
npm run smoke:workflow:run
npm run smoke:workflow:run:project
npm run smoke:workflow:run:project -- --auto-video
```

Use a different debug port if a smoke run collides:

```bash
cd apps
MYSTUDIO_SMOKE_DEBUG_PORT=9374 npm run smoke:desktop
```

For real Daojie video workflow output, only run when the user asks for full media generation and dependencies are available:

```bash
cd apps
npm run video:daojie:chapter001:probe-providers
npm run video:daojie:chapter001
```

This script requires real TTS by default and may fail if local audio/model dependencies are not configured.
The `probe-providers` variant only reads hidden app image configuration and calls `/v1/models`; it must not call `/v1/images/generations`, cannot prove account balance, and cannot satisfy final MP4 acceptance.

## Visual Inspection

Packaged smoke is the main automated gate. If the user asks whether the graph was personally inspected, also open the packaged app with an isolated smoke user data dir, seed the workflow through `window.mystudioWorkflowSmoke.seedCompleteWorkflow()`, switch to the `storyboard` stage, and capture a screenshot under `/tmp`.

The screenshot/DOM summary should confirm:

- React Flow canvas exists.
- All seven nodes are visible, including `remotionProduction`.
- `scriptPlan` has markdown preview content.
- `assets` has parent and derived cards with image elements.
- `storyboard` has image preview elements.
- `remotionProduction` shows StoryboardShot state/current MP4 evidence when seeded; `workbench` shows native Studio/ChapterVideo state.

## Failure Triage

- Missing node text: inspect `buildProductionFlowModel()` and `projectStudioDataToFlowData()`.
- Markdown missing or cramped: inspect `TextPreview` and node preview height classes.
- Derived asset links missing: inspect `buildAssetDerivationModel()` and `buildWorkbenchAssetMediaMap()`.
- Image path broken: preserve `project-file://`, `local-image://`, `data:`, `blob:`, `file:`, and `https?` in preview URL helpers.
- Director plan missing: check `latestWork(input.agentWorkData, "directorPlan")`, `scriptPlans`, and `saveAgentWorkData("directorPlan", ...)`.
- Storage path wrong: inspect project storage logs for `_p/{projectId}/...`; do not use `window.studioAssets` unless testing independent asset library behavior.
- Packaged-only failure: rebuild with `npm run build:mac` before rerunning `npm run smoke:desktop`.

## Reporting

Report fresh evidence only:

- Commands run and pass/fail result.
- Whether packaged smoke passed, including screenshot fallback if used.
- The smoke report path, usually `apps/output/automation/desktop-smoke-report.json`.
- Whether real visual inspection was done.
- Whether the tested data was isolated smoke data or the user's real project data.
- Any skipped step and exact reason.

---

## 现行视频工作流事实（2026-08-14 起）

唯一正式链路（所有验证以此为准）：

1. `npm run remotion:chapter001:shots`（`render-shot-slots.ts`）— 43 镜 StoryboardShot MP4，**TTS 配音烘进每镜**（经 `bind-voice-audio.ts` + `update-storyboards-voice.ts` 完成 manifest/storyboard 绑定后重渲生效）。门禁开关：`MYSTUDIO_REQUIRE_HUMAN_APPROVAL=0`、`MYSTUDIO_CONTINUITY_POLICY=skip`（测试用途；正式发布仍需人工批准）。
2. `npm run video:full-pipeline`（`run-full-pipeline.ts`）— video-use runChapter → accept → applyAcceptedArtifact（HyperFrames 透明特效层）→ chapter gate → 字幕归属校验（道劫 chapter-001 为 source-embedded：分镜图内嵌字幕，HyperFrames 禁文字模板、Remotion text clip=0）→ ChapterVideo 渲染。

已删除的旧入口（不要再引用）：`render-daojie-remotion-timeline.ts`、`render-daojie-editing-timeline.ts`、`render-derived-chapter.ts`、`video:daojie:chapter001:remotion`。旧 `MYSTUDIO_DAOJIE_*` 环境变量已改名 `MYSTUDIO_*`（项目专属的仅存于 `apps/build/daojie/`）。

完整性断言清单需覆盖：accepted video-use artifact（43 EDL）、accepted HyperFrames artifact（43 窗口、无文字模板）、gate accepted、authority source-embedded、voice binding 烘进 shot MP4（抽镜 volumedetect 非静音）。
