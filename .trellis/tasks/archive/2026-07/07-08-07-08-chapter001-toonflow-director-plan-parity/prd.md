# Chapter001 Toonflow-grade director plan parity

## Goal

Make MYStudio Daojie chapter-001 director planning reach the same practical detail level as the real Toonflow EP01 director plan, so downstream storyboard-table, storyboard-image, sound, transition, and continuity stages receive a usable director contract instead of a short placeholder summary.

The fix is scoped to the Daojie chapter-001 automation/writeback path and the parser/reporting needed to verify it. It must not change unrelated projects, generic image workflow behavior, or package Daojie runtime project content into the application bundle.

## Background And Evidence

- Toonflow real project data is in `/Users/zhengbingjin/Library/Application Support/toonflow/data/db2.sqlite`, project `1779271590876`, episode `1`, project name `道劫`, art style `daojie_ink_guofeng`, director manual `Daojie_xianxia`.
- Toonflow real `scriptPlan` for `剑主夜访道口镇 EP01` is `5331` chars / `3646` Chinese chars, with `6` second-level sections, `5` scene subsections, and rich scene-level notes.
- Toonflow real `scriptPlan` sections are:
  - `## ① 主题立意与叙事核心`
  - `## ② 视觉风格与画面基调`
  - `## ③ 叙事结构与节奏规划`
  - `## ④ 分场景情绪与画面意图`
  - `## ⑤ 声音方向`
  - `## ⑥ 转场与视觉连续性`
- Toonflow real scene subsections are `### Sc 1-1` through `### Sc 1-5`, including per-scene emotion target, atmosphere direction, shot intent, spatial narrative, and distance design.
- Toonflow storyboard-table agent reads `get_flowData("script")`, `get_flowData("assets")`, and `get_flowData("scriptPlan")`, then explicitly aligns storyboard design to the director plan. This makes director planning a downstream contract, not a decorative preview.
- MYStudio current real project state is `/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0/studio-workflow-store.json`.
- MYStudio current chapter-001 `scriptDraft` is `3046` chars / `2256` Chinese chars and has enough story material. The weak director plan is not caused by an empty script.
- MYStudio current chapter-001 `directorPlan` is only `1053` chars / `505` Chinese chars, with `0` `##` sections, `4` `###` headings, and `15` bullet lines.
- MYStudio current structured `scriptPlans[chapter-001]` has `visualStyle=""`, `4` coarse `sceneIntents`, short sound/transitions, and no Toonflow-grade 5-scene planning.
- `Library/build_daojie_chapter001_workflow.py:1271` currently builds a short static `<scriptPlan>` with only `分场汇总表`, `逐场注意事项`, `场间过渡`, and `⑦ 衍生资产预划清单`.
- `Library/build_daojie_chapter001_workflow.py:2917` writes a separate short structured `ScriptPlan` that does not preserve rich theme, visual plan, narrative rhythm, 5 scene intentions, sound direction, or continuity details.
- `apps/build/automate-daojie-chapter001-video.mjs` currently validates storyboard count, spoken text length, media generation, image workflow integrity, and prompt integrity, but has no director-plan richness gate.
- MYStudio already carries the relevant Daojie manuals/skills under `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng` and `apps/frontend/assets/studio-manuals/story_skills/Daojie_xianxia`.
- `buildStudioManualContext()` already injects `director_planning_style`, `art_storyboard_video`, `director_planning_narrative`, and `director_storyboard_table_narrative` for selected manuals. The chapter-001 automation does not currently convert that Daojie planning knowledge into rich project data.

## Requirements

- R1. Generate and write back a Toonflow-grade raw `<scriptPlan>` for Daojie `chapter-001`.
  - It must include sections `①` through `⑥`.
  - It must include five director-planning scene subsections: four current script heads (`Sc 1-1` through `Sc 1-4`) plus one tail-hook subsection split from the current `Sc 1-4` interior/exterior ending.
  - It must include theme, visual style, narrative rhythm, per-scene intent, sound direction, transitions, and visual continuity anchors.
- R2. Preserve chapter-001 production invariants.
  - Keep `43` storyboard items exactly.
  - Keep the current 400-500 spoken-character requirement.
  - Keep real TTS/image/video workflow behavior unchanged unless a validation exposes an actual bug.
  - Do not change generic image workflow behavior or unrelated chapters.
- R3. Write a rich structured `ScriptPlan` alongside the raw agent work data.
  - `theme`, `visualStyle`, `narrativeRhythm`, `soundDirection`, and `transitions` must be non-empty.
  - `sceneIntents` must contain `5` entries, one per real script scene.
  - Each scene intent must preserve emotion, shot intent, and spatial/distance planning.
  - `derivedAssetPlan` must keep existing derived asset workflow data.
- R4. Add deterministic report/audit data.
  - Generated report data must include director-plan metrics: character counts, Chinese character counts, heading counts, scene section count, bullet count, structured scene intent count, and required-section booleans.
  - The automation wrapper must fail when the director plan regresses to a short placeholder.
- R5. Improve frontend parser only if needed for round-trip safety.
  - Existing compact Toonflow-style parsing must remain backward compatible.
  - Rich `①-⑥` plans with `### Sc ...` subsections must preserve scene intents instead of silently dropping them.
- R6. Keep UI preview behavior as markdown preview.
  - The raw `<scriptPlan>` may be stored with tags, but preview code should continue unwrapping tags and rendering markdown.

## Acceptance Criteria

- [ ] `Library/build_daojie_chapter001_workflow.py` can build a raw `chapter-001` `<scriptPlan>` with `>= 4500` chars and `>= 2500` Chinese chars.
- [ ] The raw plan contains all six required `## ①` through `## ⑥` sections.
- [ ] The raw plan contains exactly five director-planning scene sections: `### Sc 1-1` through `### Sc 1-5`, where `Sc 1-5` is the tail-hook split from the current script's `Sc 1-4` exterior ending and does not add storyboard items.
- [ ] The raw plan contains at least `50` markdown bullet lines.
- [ ] The structured `scriptPlans` writeback contains exactly `5` `sceneIntents`, and each has non-empty `emotion`, `shotIntent`, and `spatial`.
- [ ] `apps/build/automate-daojie-chapter001-video.mjs` fails if director-plan metrics fall below the required thresholds.
- [ ] Existing storyboard and media gates still require `storyboards === 43`, `storyboardSourceSegments === 43`, `spokenTextChars >= 400 && <= 500`, real TTS, real image workflow, and final video streams.
- [ ] Focused tests pass:
  - `python3 -m py_compile Library/build_daojie_chapter001_workflow.py`
  - `cd apps && npm test -- frontend/config/build-scripts.test.ts frontend/lib/studio/director-plan.test.ts frontend/lib/studio/studio-flow-data.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx`
  - `cd apps && npm run typecheck`
  - `cd apps && npm run lint`
- [ ] If the full media chain is run, `apps/output/automation/daojie-chapter001-video-report.json` contains the new director-plan audit fields and all existing media checks remain valid.

## Out Of Scope

- Replacing MYStudio chapter-001 storyboard table with Toonflow DB's original storyboard table.
- Reusing Toonflow original golden images as MYStudio output.
- Changing generic image workflow entry behavior.
- Packaging or installing the app unless explicitly requested after this task's code/test work.
- Moving Daojie user project content into the MYStudio application bundle.

## Open Questions

No user decision is currently blocking planning. Repository and local runtime evidence answer the technical direction: chapter-001 needs rich deterministic director-plan writeback and validation, not just UI display cleanup.
