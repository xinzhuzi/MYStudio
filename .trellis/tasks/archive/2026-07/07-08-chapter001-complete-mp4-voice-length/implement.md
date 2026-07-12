# Implement

## Steps

1. Read the current 43 chapter-001 shot tuples and compute current effective spoken length.
2. Expand selected spoken text fields by about 90-120 effective Chinese characters total, distributed across Sc1-Sc4.
3. Add strict validation constants to the automation wrapper for exact 43 storyboards and 400-500 spoken characters.
4. Run a lightweight local count check before real generation.
5. Start the Trellis task with `task.py start`.
6. Run `npm run video:daojie:chapter001` from `apps/`.
7. Inspect the generated report for all PRD acceptance criteria.
8. Run `npm run smoke:workflow:run:daojie` from `apps/`.
9. If the app bundle must be refreshed for manual inspection, run `npm run build:mac:install` and then installed app smoke.

## Validation Commands

```bash
cd apps
npm run video:daojie:chapter001
npm run smoke:workflow:run:daojie
```

When code changes are complete, also run focused syntax/quality checks:

```bash
python3 -m py_compile ../Library/build_daojie_chapter001_workflow.py
node --check ./build/automate-daojie-chapter001-video.mjs
```

## Rollback Notes

The only code edits should be small text changes in the chapter-001 shot spec and additive validation checks in the wrapper. If a generated MP4 fails timing or TTS validation, reduce the expanded lines while keeping the 400-character minimum.

## Validation Results

2026-07-10 fresh validation:

- `cd apps && npm run video:daojie:chapter001` passed after resuming with existing project storyboard images because the external image provider returned `fetch failed` / `502 Upstream service temporarily unavailable` while regenerating shot 019. The successful run used `MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES=1 MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES_AFTER=2000-01-01T00:00:00`.
- Report: `apps/output/automation/daojie-chapter001-video-report.json`, `generatedAt=2026-07-10T13:05:03.369Z`, `ok=true`.
- Report acceptance values: `storyboards=43`, `storyboardSourceSegments=43`, `scriptTextChars=423`, `spokenTextChars=423`, `dialogueCoverageRatio=1`, `generatedFrameImages=43`, `framesWithRealAssetImages=43`, `ttsMode=local-tts-direct`, `ttsBackend=qwen-mlx`, `ttsMocked=false`, `tracks=4`, `videoCandidates=5`, `finalVideoDuration=171.374349`, `finalAudioMeanVolumeDb=-12.6`.
- Final MP4: `/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0/exports/chapter-001/道劫_EP01_断剑夜访道口镇_toonflow_workflow.mp4`.
- Final MP4 evidence: `sizeBytes=24223257`, `sha256=e09955bf4ffb84432b0705671572a6291763d707629abb6006eae54e95b661cf`.
- `cd apps && npm run smoke:workflow:run:daojie` passed after the video generation writeback. Report: `apps/output/automation/visible-workflow-daojie-report.json`, `generatedAt=2026-07-10T13:07:16.122Z`, `ok=true`, `source=real-daojie-chapter001-clone`, `progress=100`, `completed=true`, `storyboards=43`, `storyboardImageWorkflowsReady=43`, `derivedImageWorkflowsReady=3`, `videoCandidates=5`, `failedStages=[]`, `runtimeProblems=[]`.
