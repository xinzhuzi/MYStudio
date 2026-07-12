# Design

## Problem Restatement

MYStudio currently has a Toonflow-shaped workflow shell, but generic director-plan generation can still save the old three-block output. Toonflow's current runtime skill is also three-block, while the real Daojie Toonflow project data contains the six-section, five-scene high-quality plan the user expects. The implementation must turn that real output contract into MYStudio's generation and validation contract.

## Data Flow

```text
script text + selected visual/director manuals
  -> buildDirectorPlanMessages()
  -> AI director-plan output
  -> auditDirectorPlanStructure()
  -> parseDirectorPlan()
  -> saveAgentWorkData("directorPlan") + saveScriptPlan()
  -> storyboard-table context
  -> workflow preview / smoke evidence
```

## Contracts

- The required generated output is Markdown wrapped in `<scriptPlan>...</scriptPlan>`.
- The six required headings are exact second-level Markdown headings with circled numbers `①-⑥`.
- `④ 分场景情绪与画面意图` must include one or more `### Sc` scene subsections. For each scene, structured fields should be extractable into `sceneIntents`.
- Legacy Toonflow-style three-block plans remain parseable for existing data, but are not valid for new generic generation.
- Audit lives in `director-plan.ts` so runtime code, tests, smoke helpers, and future reports can reuse one contract.

## Runtime Behavior

- First AI call uses the normal prompt with stricter six-section requirements.
- If the audit fails, one repair call is made. The repair prompt includes the original invalid output and exact audit issues.
- If the repaired output still fails, the action shows a toast error and returns without saving raw or structured director-plan data.
- If output passes, save raw text and parsed structured plan exactly once.

## Toonflow Evidence Interpretation

- Current Toonflow runtime skill is not the source of the six sections; it still states a compact three-part output.
- The real Toonflow `productionAgent.scriptPlan` is the golden evidence: 5331 chars, 3646 Chinese chars, six headings, five `Sc` scene sections, 73 bullets.
- MYStudio should absorb that real production contract, while keeping selected manual context to adapt content per project.

## Compatibility

- Existing `parseDirectorPlan()` behavior for legacy three-block content remains.
- `⑦ 衍生资产预划清单` stays optional and compatible with existing derived-asset parsing.
- No persistent schema migration is required.
