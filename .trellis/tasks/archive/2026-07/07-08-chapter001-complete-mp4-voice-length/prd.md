# Chapter 001 Complete MP4 Voice Length

## Goal

Strengthen the real Daojie chapter-001 MP4 generation chain so the final video keeps exactly 43 storyboard shots, uses real multi-speaker TTS, and raises total spoken narration/dialogue from the current 324 effective Chinese characters to a production target of 400-500 effective Chinese characters.

## Requirements

- Scope is limited to the chapter-001 Daojie generation chain and its validation script.
- Keep exactly 43 storyboard shots. Do not add, remove, reorder, or split storyboard entries.
- Expand existing spoken text in small increments across the 43 shots, with a target near 430 effective Chinese characters.
- Preserve the existing scene order, speaker identities, asset references, image workflow behavior, and 3-5 second shot rhythm.
- Do not burn subtitles into the frame. The storyboard image prompt still forbids visible text/watermarks/titles.
- Use real TTS. Mock, fallback system voice, and silent preview modes cannot satisfy final acceptance.
- Keep Daojie project data in the project disk path and project-scoped stores; do not package Daojie content into the MYStudio app bundle.

## Acceptance Criteria

- [ ] `npm run video:daojie:chapter001` exits 0 from `apps/`.
- [ ] `apps/output/automation/daojie-chapter001-video-report.json` reports `storyboards === 43` and `storyboardSourceSegments === 43`.
- [ ] The report has `spokenTextChars >= 400 && spokenTextChars <= 500` and `scriptTextChars >= 400`.
- [ ] The report has `ttsMocked === false`, a non-empty `ttsBackend`, and at least 5 distinct `speakerVoiceMap[*].voiceReferenceAudioPath` values.
- [ ] The report has `generatedFrameImages === 43`, `framesWithRealAssetImages === 43`, complete storyboard media manifests, and no missing image assets.
- [ ] The final MP4 exists, has video and audio streams, has nonzero duration, stays within the 180 second target, and records `finalVideoEvidence.sha256`.
- [ ] `npm run smoke:workflow:run:daojie` passes against the real chapter-001 project data, not an empty smoke template.

## Notes

- Current baseline before this task: 43 storyboards, 324 spoken characters, 12 speakers/voice references, `ttsBackend=qwen-mlx`, final video duration about 169.7 seconds.
