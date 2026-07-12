# Workflow Auto-Video Smoke Contract

## 1. Scope / Trigger

Use this contract whenever the Daojie visible workflow runner, the chapter auto-video UI action, its Electron bridge, or its durable report schema changes. It protects the difference between clicking through the real-project clone and proving that the one-click path produced a real MP4.

## 2. Signatures

Primary command:

```bash
cd apps
npm run smoke:workflow:run:daojie -- --auto-video
```

Equivalent opt-in and supported environment keys:

```bash
MYSTUDIO_WORKFLOW_AUTO_VIDEO=1 npm run smoke:workflow:run:daojie
MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS=600000 npm run smoke:workflow:run:daojie -- --auto-video
MYSTUDIO_VISIBLE_WORKFLOW_REPORT_PATH="$PWD/output/automation/visible-workflow-daojie-report.json" npm run smoke:workflow:run:daojie -- --auto-video
```

- `--auto-video` requires `--daojie` or `MYSTUDIO_WORKFLOW_REAL_DAOJIE=1`.
- `MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS` must be a positive number; the default is `600000`.
- `MYSTUDIO_SMOKE_DEBUG_PORT` may select a free DevTools port.

## 3. Contracts

- The runner clones the real Daojie `chapter-001` project into temporary user data and must copy project `tts.json`; it must not write the original project.
- It clicks the button labeled `一键第一章成片` and records every observed `data-auto-video-stage` transition.
- The report must contain `source=real-daojie-chapter001-clone`, `runChapterAutoVideo=true`, and `chapterAutoVideo` with `stageHistory`, `terminalStage`, `statusText`, `finalPath`, `hasFinalPathButton`, and `timedOut`.
- Success requires `chapterAutoVideo.terminalStage=completed`, `timedOut=false`, `autoVideoFailed=false`, no failed workflow stages, and no runtime problems.
- `chapterAutoVideo.finalPath` must come from the visible "open final MP4" control, end in `.mp4`, and exist on disk when the runner exits.
- A normal real-project click-through without `--auto-video` proves only workflow navigation; it does not satisfy the product one-click acceptance criterion.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `--auto-video` without Daojie mode | Fail before app launch |
| Non-positive auto-video timeout | Fail before app launch |
| Auto-video button missing | Fail and report the missing UI contract |
| Terminal stage is `failed` | Fail and preserve `statusText` plus `stageHistory` |
| Timeout expires before `completed` | Fail with `timedOut=true` |
| Final-path control is missing | Fail even if status text looks successful |
| Final path is empty, non-MP4, or absent on disk | Fail; do not count the run toward AC6 |
| Original project manifest changes | Fail the safety audit |

## 5. Good / Base / Bad Cases

- Good: a real Daojie temporary clone reaches `idle -> tts -> media -> merge -> completed`, exposes an existing MP4 path, and leaves the original project hashes unchanged.
- Base: `npm run smoke:workflow:run:daojie` completes the stage click-through without requesting auto-video; report it as navigation evidence only.
- Bad: the UI reaches `completed` but no existing MP4 path is exposed. The command must exit non-zero and AC6 remains open.

## 6. Tests Required

- `npm test -- frontend/config/build-scripts.test.ts`
  - Assert the package script routes to the visible runner in Daojie mode.
  - Assert `--auto-video` and its environment equivalent are recognized.
  - Assert invalid mode and timeout inputs fail.
  - Assert the runner requires `completed` plus an existing final MP4.
- Run `npm run smoke:workflow:run:daojie -- --auto-video` against the packaged app.
  - Assert the durable report has the required fields and no failure arrays.
  - Hash the generated temporary MP4.
  - Compare original project JSON, exports, workflow-images, and `tts.json` manifests before and after.

## 7. Wrong vs Correct

### Wrong

```text
The stage click-through reached progress=100, so one-click auto-video passed.
```

### Correct

```text
AC6 passes only after the auto-video terminal stage is completed and the reported finalPath is an existing MP4; the real source project must remain unchanged.
```
