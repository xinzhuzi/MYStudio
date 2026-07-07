---
name: mystudio-workflow-integrity-testing
description: Use when verifying MYStudio workflow completeness, step-by-step app workflow execution, storyboard/video workflow node graph, Toonflow-style node parity, director-plan markdown previews, derived asset links/thumbnails, workbench export state, project-scoped persistence, packaged Electron smoke coverage, 工作流自动运行, or questions like "有没有自动化测试这个工作流?" and "资产保存路径有没有分清楚?"
---

# MYStudio Workflow Integrity Testing

Use this skill to prove the workflow is complete with fresh evidence, not impressions. Scope includes the Studio workflow graph, workflow data, preview rendering, asset links, storage boundaries, and packaged app smoke tests.

## Ground Rules

- Work from `/Users/zhengbingjin/Project/Github/MYStudio`.
- Run npm commands from `apps/`.
- Do not run git commands unless the user explicitly asks.
- Treat old logs as stale. Rerun the relevant check before saying it passes.
- Do not claim "修好了" or "完整" unless the matching verification command just passed.
- Do not create files at repo root. Temporary screenshots or probes go under `/tmp`.
- Wait for Electron/build/smoke sessions to exit before final reporting.

## Storage Boundary

Keep these separate when testing or fixing workflow behavior:

- Project workflow/state files: `_p/{projectId}/...`, including `studio-workflow-store`, `characters`, `scenes`, and project file URLs such as `project-file://...`.
- Independent asset library: `{basePath}/assets/assets.db` and `assets/files/...`.

Workflow node generation, storyboard images, character/scene/prop project state, and smoke seed data should stay project-scoped unless the user explicitly asks to write the independent asset library.

## Evidence Types

- seedCompleteWorkflow() is only a seeded preview regression. It proves node previews, links, markdown rendering, image tiles, and export state can render from complete data.
- Step-by-step app execution is the only proof of workflow auto-run. It must start the packaged app, click through the workflow route and stages, run one deterministic stage at a time, wait for readiness/evidence, then move to the next stage.
- Report the tested data source exactly: isolated smoke project, 真实用户项目, or 真实《道劫》项目.
- In the isolated smoke project, deterministic smoke providers may replace real AI/image/TTS/rendering providers. Do not describe that as a real model run.
- normal visible app startup is separate from automated smoke. Use `npm run smoke:workflow:open` when the user needs to see the packaged app start and stay open.
- visible step-by-step workflow runner is separate from normal startup. Use `npm run smoke:workflow:run` when the user needs to watch the packaged app click through stages, wait for results, and stay open afterward.
- Visible step-by-step evidence must include `[visible-run] stage ...` logs for each stage and a final `frontmostApp=漫影工作室` line; a hidden `progress=100` result alone is not enough.
- Real Daojie validation uses `npm run smoke:workflow:run:daojie`. It must load the 真实《道劫》第一章节项目 (`chapter-001`) from the user's real project data clone, not an empty smoke template; report that it is 不是 empty smoke template.

## Integrity Checklist

Verify the workflow in layers:

1. **Model contract**
   - Check `apps/frontend/components/panels/studio/workflow-node-model.ts`.
   - Expected node ids: `script`, `scriptPlan`, `assets`, `storyboardTable`, `storyboard`, `workbench`.
   - Expected edges: `script -> scriptPlan`, `script -> assets`, `scriptPlan -> storyboardTable`, `storyboardTable -> storyboard`, `storyboard -> workbench`.

2. **Preview contract**
   - Check `WorkflowNodePreviews.tsx`, `WorkflowProductionNode.tsx`, and `WorkflowNodeCanvas.tsx`.
   - `script` and `scriptPlan` must render markdown via `MdPreview`.
   - `assets` must show Toonflow-style source/derived cards, parent asset ids, flow ids, states, prompts/reasons, and real image previews when linked.
   - Clicking a derived asset card must open the asset image workflow detail with the parent image as the reference node, the derived result as the generated node, and the existing flow id reused when present.
   - `storyboard` must show generated image tiles when `mediaRef.path` exists.
   - `workbench` must show track, media count, selected video, and final export state.

3. **Smoke bridge seed**
   - Check `apps/frontend/lib/studio/workflow-smoke-bridge.ts`.
   - Seed data should include script, director plan, derived asset plan, character/scene/prop media, storyboard image, voice binding, track, candidate video, and final export.
   - Smoke seed must use isolated smoke user data and project-scoped stores.

4. **Packaged smoke assertions**
   - Check `apps/build/smoke-desktop.mjs`.
   - It should assert route health, workflow stages, React Flow canvas, node FlowData text, `hasDirectorPlanPreview`, `hasToonflowDerivativeLinks`, `hasStoryboardImagePreview`, voice flow, Python settings, and visual stats.
   - Screenshot timeout is acceptable only if the script exits `0` and DOM visual fallback reports a low `whiteRatio`.

## Step-by-Step Review And Test Flow

Review evidence before running the matching test. Do not collapse the checklist into only `npm run smoke:desktop`; smoke is the final packaged gate, not a substitute for layer-by-layer review.

1. **Step 1 - Skill contract review**
   - Review this `SKILL.md` and `apps/frontend/config/build-scripts.test.ts`.
   - Test: `npm test -- frontend/config/build-scripts.test.ts`.

2. **Step 2 - Model contract test**
   - Review node ids, edges, metrics, target stages, and storage/project assumptions in `workflow-node-model.ts`.
   - Test: `npm test -- frontend/components/panels/studio/workflow-node-model.test.ts`.

3. **Step 3 - Preview contract test**
   - Review markdown previews, derived asset cards, storyboard images, workbench lanes, and theme-aware canvas controls.
   - Test: `npm test -- frontend/components/panels/studio/workflow-node-previews.test.tsx frontend/components/panels/studio/workflow-tabs.test.ts`.

4. **Step 4 - Smoke bridge seed test**
   - Review `workflow-smoke-bridge.ts` for director plan, derived assets, image refs, voice binding, track, selected candidate, final export, and isolated project-scoped seed data.
   - Test: `npm test -- frontend/lib/studio/workflow-smoke-bridge.test.ts`.

5. **Step 5 - Step-by-step app execution smoke**
   - Review `apps/build/smoke-desktop.mjs` for `verifyWorkflowStepByStepExecution`.
   - It must use `resetForStepwiseExecution`, `runStepwiseWorkflowStage`, `inspectWorkflowStages`, and wait for each stage to become ready.
   - It must not use `seedCompleteWorkflow()` as a substitute for the execution path.
   - It must write durable evidence to `apps/output/automation/desktop-smoke-report.json`, or to `MYSTUDIO_SMOKE_REPORT_PATH` when that variable is set.
   - Test: `MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1 npm run smoke:desktop`.
   - Visible test: `MYSTUDIO_SMOKE_FOREGROUND=1 MYSTUDIO_SMOKE_HOLD_MS=15000 MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1 npm run smoke:desktop`.
   - Normal visible app startup: `npm run smoke:workflow:open`. This starts the packaged app with isolated smoke data and leaves it open for human inspection.
   - Visible step-by-step workflow runner: `npm run smoke:workflow:run`. This starts the packaged app with isolated smoke data, clicks through each workflow stage with a visible delay, waits for stage evidence, and leaves the app open.
   - Required visible evidence: stage logs like `[visible-run] stage script clicked ...`, final `progress=100`, and final `frontmostApp=漫影工作室`.
   - Real Daojie first-chapter visible runner: `npm run smoke:workflow:run:daojie`. This clones the real `道劫` project data into a temporary userData dir, opens `chapter-001`, clicks all workflow stages, verifies real chapter evidence such as storyboards, video candidates, derived asset project records, and asset image workflows with reference/generated nodes, then clicks at least one real `asset-flow-chapter-001*` derived asset card and waits for the image workflow detail to show the parent reference node, generated node, and writeback target.

6. **Step 6 - Build and packaged smoke test**
   - Review `apps/build/smoke-desktop.mjs` for route, stage, node preview, storage, visual, and voice assertions.
   - Test: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:mac`, then `npm run smoke:desktop`.

7. **Step 7 - Visual inspection**
   - Open the packaged app with an isolated `mystudio-smoke-*` user data dir, seed `window.mystudioWorkflowSmoke.seedCompleteWorkflow()`, switch to `storyboard`, and capture `/tmp` evidence.
   - Confirm all six nodes, markdown director plan, derived asset image/link cards, storyboard image, workbench export state, no default white React Flow controls, and themed viewport controls.

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
MYSTUDIO_SMOKE_FOREGROUND=1 MYSTUDIO_SMOKE_HOLD_MS=15000 MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1 npm run smoke:desktop
npm run smoke:workflow:open
npm run smoke:workflow:run
npm run smoke:workflow:run:daojie
```

Use a different debug port if a smoke run collides:

```bash
cd apps
MYSTUDIO_SMOKE_DEBUG_PORT=9374 npm run smoke:desktop
```

For real Daojie video workflow output, only run when the user asks for full media generation and dependencies are available:

```bash
cd apps
npm run video:daojie:chapter001
```

This script requires real TTS by default and may fail if local audio/model dependencies are not configured.

## Visual Inspection

Packaged smoke is the main automated gate. If the user asks whether the graph was personally inspected, also open the packaged app with an isolated smoke user data dir, seed the workflow through `window.mystudioWorkflowSmoke.seedCompleteWorkflow()`, switch to the `storyboard` stage, and capture a screenshot under `/tmp`.

The screenshot/DOM summary should confirm:

- React Flow canvas exists.
- All six nodes are visible.
- `scriptPlan` has markdown preview content.
- `assets` has parent and derived cards with image elements.
- `storyboard` has image preview elements.
- `workbench` shows selected video/final export state.

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
