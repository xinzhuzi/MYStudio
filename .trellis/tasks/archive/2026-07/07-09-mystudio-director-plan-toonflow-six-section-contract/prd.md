# MYStudio Toonflow director plan six section contract

## Goal

Trace Toonflow director-plan evidence first, then enforce Toonflow-grade six-section director planning in the generic MYStudio workflow so weak three-block plans are not saved or shown as complete.

## Background And Evidence

- Toonflow source and runtime both load `production_execution_director_plan.md` for `productionAgent:directorPlanAgent`.
- The current Toonflow runtime director-plan skill still describes a compact three-part output: `分场汇总表`, `逐场注意事项`, and `场间过渡`.
- Toonflow injects project model context and art/story skill availability into the director-plan sub-agent through `productionAgent/index.ts`, but the current runtime skill does not hard-code the six headings.
- Toonflow real Daojie project data in `/Users/zhengbingjin/Library/Application Support/toonflow/data/db2.sqlite` contains the actual `productionAgent.scriptPlan` for `剑主夜访道口镇 EP01`.
- The real Toonflow `scriptPlan` is `5331` chars / `3646` Chinese chars, has exactly six `## ①-⑥` headings, five `### Sc` scene sections, and 73 bullet items.
- Therefore MYStudio must absorb the real Toonflow output contract and quality gate, not blindly copy the currently stale three-block Toonflow runtime skill.
- MYStudio already parses rich `①-⑥` plans in `apps/frontend/lib/studio/director-plan.ts`, but generic generation has no hard gate and saves weak output immediately in `useProductionPlanningActions.ts`.

## Requirements

- R1. Rewrite the generic director-plan skill contract so generated plans must use `<scriptPlan>` and the exact six required headings:
  - `## ① 主题立意与叙事核心`
  - `## ② 视觉风格与画面基调`
  - `## ③ 叙事结构与节奏规划`
  - `## ④ 分场景情绪与画面意图`
  - `## ⑤ 声音方向`
  - `## ⑥ 转场与视觉连续性`
- R2. Section `④` must contain `### Sc ...` scene subsections with `情绪目标`, `氛围方向`, `镜头意图`, `空间叙事`, and `连续性锚点` or equivalent continuity detail.
- R3. Keep optional `⑦ 衍生资产预划清单` compatible for derived asset planning, but do not count it as one of the six core sections.
- R4. Add a shared director-plan structure audit in the frontend library.
- R5. `handleDirectorPlan` must validate model output before saving. If the first output is weak, run one repair pass with concrete missing-section errors. If repair still fails, show an error and do not overwrite the existing plan.
- R6. Preserve old-project compatibility: parsing legacy three-block plans remains possible, but generic generation cannot mark them complete.
- R7. Add focused tests proving three-block output fails the audit and six-section output passes with scene intents.
- R8. Keep UI metadata minimal. Do not add internal ids or noisy debug fields to node chrome.

## Acceptance Criteria

- [ ] Toonflow evidence is recorded in this task and distinguishes current Toonflow runtime skill from real six-section project data.
- [ ] `production_execution_director_plan.md` in MYStudio requires exact `①-⑥` headings and scene subsections.
- [ ] `buildDirectorPlanMessages()` includes the six-section contract and manual context.
- [ ] A three-block director plan is rejected by the new audit.
- [ ] A six-section plan with `### Sc` subsections passes the audit and parses scene intents.
- [ ] `handleDirectorPlan` attempts one repair pass, saves only audited output, and does not save invalid output.
- [ ] Focused tests pass:
  - `cd apps && npm test -- frontend/lib/studio/director-plan.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx`
- [ ] Quality gates pass:
  - `cd apps && npm run typecheck`
  - `cd apps && npm run lint`
- [ ] Workflow smoke is run after implementation:
  - `cd apps && npm run smoke:workflow:run`
- [ ] Because Electron-bundled assets and runtime UI logic change, package/install validation is run:
  - `cd apps && npm run build:mac:install`

## Out Of Scope

- Do not put Daojie user project content into the MYStudio app bundle.
- Do not replace MYStudio's data model with Toonflow DB tables.
- Do not remove legacy parsing support for existing saved plans.
- Do not run git or worktree commands.
