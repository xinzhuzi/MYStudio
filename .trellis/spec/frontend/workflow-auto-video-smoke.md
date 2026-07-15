# Workflow Auto-Video Smoke Contract

## 1. Scope / Trigger

Use this contract whenever the Daojie background or visible workflow runner, the chapter auto-video UI action, its Electron bridge, or its durable report schema changes. It protects background focus isolation and the difference between clicking through the real-project clone and proving that the one-click path produced a real MP4.

## 2. Signatures

Primary command:

```bash
cd apps
npm run smoke:workflow:background:daojie -- --auto-video
npm run video:daojie:chapter001

MYSTUDIO_DAOJIE_TIMELINE_RUNNER=1 ./node_modules/.bin/vite-node \
  --config build/vite-node.config.ts \
  build/render-daojie-editing-timeline.ts
```

Equivalent opt-in and supported environment keys:

```bash
MYSTUDIO_WORKFLOW_AUTO_VIDEO=1 npm run smoke:workflow:background:daojie
MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS=600000 npm run smoke:workflow:background:daojie -- --auto-video
MYSTUDIO_BACKGROUND_WORKFLOW_REPORT_PATH="$PWD/output/automation/background-workflow-daojie-report.json" npm run smoke:workflow:background:daojie -- --auto-video
npm run video:daojie:chapter001:probe-providers
MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES=1 MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES_AFTER="2026-07-01T00:00:00+08:00" npm run video:daojie:chapter001
```

- `--auto-video` requires `--daojie` or `MYSTUDIO_WORKFLOW_REAL_DAOJIE=1`.
- `MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS` must be a positive number; the default is `600000`.
- `MYSTUDIO_SMOKE_DEBUG_PORT` may select a free DevTools port.
- `MYSTUDIO_SMOKE_BACKGROUND=1` is the shared Electron background contract. The visible command remains available for explicit human observation.
- `video:daojie:chapter001:probe-providers` is a non-generating provider-model probe. It must read app image settings in background mode, call only `/v1/models`, write `daojie-chapter001-provider-probe-report.json`, and report `generatedImages=0` plus `generationEndpointCalled=false`.
- Storyboard image reuse is opt-in. Both reuse keys are required, and every reused image must exist with an mtime at or after the ISO timestamp. Reuse avoids a generation request but does not relax voiceover, TTS, stream, duration, or SHA-256 gates.

## 3. Contracts

- The runner clones the real Daojie `chapter-001` project into temporary user data and must copy project `tts.json`; it must not write the original project.
- It clicks the button labeled `一键第一章成片` and records every observed `data-auto-video-stage` transition.
- The report must contain `source=real-daojie-chapter001-clone`, `runChapterAutoVideo=true`, and `chapterAutoVideo` with `stageHistory`, `terminalStage`, `statusText`, `finalPath`, `hasFinalPathButton`, and `timedOut`.
- Background reports must contain `mode=background`, `windowVisibility`, `documentHasFocus`, `focusSamples`, and `foregroundViolation=false`.
- The background branch must not call `Page.bringToFront`, `window.focus()`, or macOS `System Events`; frontmost-app samples use `lsappinfo` and any MYStudio sample fails the run.
- Success requires `chapterAutoVideo.terminalStage=completed`, `timedOut=false`, `autoVideoFailed=false`, no failed workflow stages, and no runtime problems.
- `chapterAutoVideo.finalPath` must come from the visible "open final MP4" control, end in `.mp4`, and exist on disk when the runner exits.
- A normal real-project click-through without `--auto-video` proves only workflow navigation; it does not satisfy the product one-click acceptance criterion.
- The production chapter command must derive the storyboard count from the current project storyboard table and require `storyboards > 0` plus `storyboards === storyboardSourceSegments`; `43` is fixture evidence, not a production constant.
- Every voiceover item must have non-empty `storyboardId`, `speaker`, `speakerId`, `line`, `ttsSpokenText`, and `voiceStyle`, positive `durationTarget`, and `requiresFixedVoice=true`.
- Project `tts.json` is the shared UI/CLI source for voice profiles and canonical speaker bindings. Existing bindings are read-only across reruns; missing profiles, reference text, or readable reference audio are hard failures.
- A successful final report must have `audioCount === storyboards`, complete `speakerVoiceMap` coverage, `ttsMocked=false`, no `fallback-system-voice` or `silent-visual-preview`, audio and video streams, duration at most 180 seconds, and non-empty `finalVideoEvidence.sha256`.
- `finalVideo` and `finalVideoEvidence` must come from `timelineRenderRecord.evidence`, and must match the current EditingProject ID, revision, source snapshot, timeline plan job, AutoEditingRun render job, disk SHA-256, and all required timeline artifact paths.
- Python `generated.final` and `generated.finalVideoEvidence` remain in the final report only as `legacyCompatibilityVideo` and `legacyCompatibilityVideoEvidence`. They must never satisfy the authoritative final gate.
- The TypeScript runner reads the current store after Python writeback, filters the current episode and selected production-track candidates, and uses the shared EditingProject/timeline runtime path. Runner failure exits non-zero and preserves the legacy artifact without promoting it.
- The runner report is written under `apps/output/automation/daojie-chapter001-timeline/` and includes EditingProject, AutoEditingRun, TimelineRenderPlan, progress history, TimelineRenderRecord, and artifact paths.
- Two-run fixed-voice acceptance compares each canonical speaker's `profileId`, `voiceReferenceAudioPath`, and `resolvedVoiceReferenceAudioPath`; the second run must report every binding as `match=fixed` and no AI-selected bindings.

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
| Provider probe reports `/v1/models` success | Treat as configuration evidence only; it does not prove image-generation balance or MP4 completion |
| Storyboard count is zero or differs from source segments | Fail before final acceptance; never substitute a hard-coded fixture count |
| Voiceover item is incomplete or a speaker lacks a canonical fixed binding | Fail and report the storyboard/speaker; do not synthesize or export partially |
| Binding points to a missing profile, reference text, or audio file | Fail without changing the existing binding |
| Final TTS is mock, system fallback, or silent preview | Fail even if an MP4 exists |
| Second-run profile or reference path differs | Fail the fixed-voice acceptance gate |
| Timeline runner or Vite config fails | Write a failure report and exit non-zero; never assign the Python concat path to `finalVideo` |
| Timeline record identity/revision/job/hash/artifact differs | Fail before the final report is accepted |
| Legacy compatibility MP4 exists but timeline MP4 is missing | Keep the legacy artifact for diagnosis; the command still fails |

## 5. Good / Base / Bad Cases

- Good: a real Daojie temporary clone reaches `idle -> planning -> voiceover -> binding -> tts -> media -> render -> editing -> rendering -> probing -> completed`, exposes an existing timeline MP4 path, and leaves the original project hashes unchanged.
- Base: `npm run smoke:workflow:run:daojie` completes the stage click-through without requesting auto-video; report it as navigation evidence only.
- Bad: the UI reaches `completed` but no existing MP4 path is exposed. The command must exit non-zero and AC6 remains open.
- Good: two current-code chapter runs keep all canonical speaker profiles and reference paths identical, produce one real local-TTS audio file per storyboard, and emit a final MP4 with audio/video streams and SHA-256 evidence.
- Good: the second direct timeline run reports `reusedExistingDraft=true`, keeps the EditingProject revision/source snapshot stable, creates a new render job, and reproduces the same MP4 SHA-256.
- Bad: a rerun silently replaces a bound voice, generates fewer audio files than storyboards, or passes with a silent preview. The command must exit non-zero.
- Bad: the Python concat MP4 exists and is reported as `finalVideo` after the typed timeline runner failed.

## 6. Tests Required

- `npm test -- frontend/config/build-scripts.test.ts`
  - Assert the package script routes to the visible runner in Daojie mode.
  - Assert `--auto-video` and its environment equivalent are recognized.
  - Assert invalid mode and timeout inputs fail.
  - Assert the runner requires `completed` plus an existing final MP4.
- Run `npm run smoke:workflow:background:daojie -- --auto-video` against the packaged app.
  - Assert the durable report has the required fields and no failure arrays.
  - Assert `foregroundViolation=false` and no focus sample names MYStudio.
  - Hash the generated temporary MP4.
  - Compare original project JSON, exports, workflow-images, and `tts.json` manifests before and after.
- Run `npm run smoke:workflow:run:daojie` only when visible human inspection is explicitly required; it must preserve the existing `frontmostApp=漫影工作室` evidence.
- Run `npm run video:daojie:chapter001:probe-providers` when checking configured image providers without spending generation quota; verify the report contains no API keys and `generationEndpointCalled=false`.
- Run the focused voiceover, storyboard, TTS persistence, auto-video, readiness, and build-script tests; assert dynamic 2-shot/43-shot fixtures, canonical identity errors, fixed binding reuse, complete voiceover fields, and hard failures for missing voice assets.
- Run `npm run video:daojie:chapter001` twice on current code. Preserve both reports and compare the complete canonical speaker profile/reference map, not only display names or a single sample.
- Run `npm test -- build/render-daojie-editing-timeline.test.ts frontend/config/build-scripts.test.ts`; assert the Node-only Vite config, explicit runner handshake, supported path schemes, current store shape, authoritative final fields, and forbidden legacy fallback.
- Run the direct timeline command against the current store before the provider-heavy full command. Verify `reusedExistingDraft`, EditingProject/plan/record identity, progress stages, MP4 streams/dimensions/duration, disk hash, snapshot hash, and every artifact path.

## 7. Wrong vs Correct

### Wrong

```text
The stage click-through reached progress=100, so one-click auto-video passed.
```

### Correct

```text
AC6 passes only after the auto-video terminal stage is completed and the reported finalPath is an existing MP4; the real source project must remain unchanged.
```

```text
Wrong: An older successful report proves the current runner, or one unchanged speaker sample proves every fixed voice stayed stable.
Correct: Run the current command twice, compare all canonical speaker profile/reference paths, and independently assert every final media gate.
```

```text
Wrong: finalVideo = generated.final when the timeline runner fails or is skipped.
Correct: finalVideo = timelineResult.timelineRenderRecord.evidence.path; generated.final is legacyCompatibilityVideo only.
```
