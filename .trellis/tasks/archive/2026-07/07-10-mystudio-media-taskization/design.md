# MYStudio media taskization - design

## Scope

This child task connects existing media writeback paths to the run-kernel task ledger already present in `studio-store`.

It does not replace current image/TTS/FFmpeg implementations. It records item-level evidence when those implementations write results back.

## Task ledger

`MediaGenerationTask` is the evidence contract:

- `storyboardImage` for storyboard image workflow output
- `ttsAudio` for storyboard audio refs
- `modelVideo` for provider video candidates
- `ffmpegTrack` for local track candidates
- `finalExport` for episode export evidence

Failures remain retryable through `retryMediaTask` / `retryFailedMediaTasks`.

## Writeback integration

- `applyImageWorkflowResultToStoryboard` records successful per-shot image tasks.
- `bindStoryboardMedia` records image/audio media refs.
- `addVideoCandidate` records initial video candidate task state.
- `updateVideoCandidate` finishes or fails the matching video task.
- `saveAgentWorkData("productionPlan", ...)` records final export evidence when the production plan contains a local export path.

## Boundary

Advanced media provider settings that are not executed remain outside this child task. Tests continue to prevent legacy outer action IDs from silently generating images outside the dedicated workflow path.
