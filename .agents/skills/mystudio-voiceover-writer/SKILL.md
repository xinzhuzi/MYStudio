---
name: mystudio-voiceover-writer
description: Plan and validate MYStudio storyboard voiceover with canonical speaker IDs, fixed character and narrator voice bindings, TTS-ready spoken text, duration targets, and final-video gates. Use when generating or repairing per-shot narration/dialogue, preparing a chapter for automatic video production, checking speaker-to-voice coverage, or preventing fixed voices from changing across reruns.
---

# MYStudio Voiceover Writer

## Overview

Produce one TTS-ready voiceover item for every storyboard while keeping character identity and voice bindings stable. Treat novel text as read-only source evidence and keep spoken copy separate from image-generation prompts.

## Required inputs

- Load the target episode's latest director plan and storyboard table.
- Load target-episode character entities with exact `characterId`, `name`, and `aliases`.
- Load current project voice bindings, voice profiles, and available audio assets.
- Load the target chapter text only as read-only context; never write voiceover edits back into it.

Stop and report missing inputs before producing output. Do not infer field names, IDs, or paths.

## Output contract

Return one item per source storyboard, in source order:

```json
{
  "storyboardId": "sb-chapter-001-001",
  "index": 1,
  "speaker": "旁白",
  "speakerId": "narrator",
  "line": "傍晚，金水河码头被太一宗火印压醒。",
  "ttsSpokenText": "傍晚，金水河码头被太一宗火印压醒。",
  "durationTarget": 4.2,
  "voiceStyle": "电影级中文旁白，厚重、克制、停顿自然。",
  "requiresFixedVoice": true
}
```

Require every field above. Keep `durationTarget` positive and keep `requiresFixedVoice` exactly `true`.

## Workflow

1. Preserve the source storyboard count and order. Never add a fixed expected count such as 43.
2. Parse `角色名：内容` or `角色名:内容` into `speaker` and `line`.
3. For an empty/no-dialogue shot, set `speaker=旁白` and write one short narration line grounded in the visual action. Do not use `无台词`, `—`, or empty text.
4. Resolve narrator labels `旁白`, `VO`, `画外音`, and `解说` to `speakerId=narrator`.
5. Resolve a character by exact entity `name` first, then exact declared alias. Emit `speakerId=character:{characterId}` only when exactly one entity matches.
6. Fail on zero or multiple character matches. Never use fuzzy display-name guessing as identity.
7. Normalize `ttsSpokenText` for speech without changing meaning. Remove stage directions, Markdown, speaker prefixes, and visual-only annotations.
8. Set `voiceStyle` from the fixed voice profile and the scene emotion; do not replace the profile.
9. Validate voice binding coverage before approving the plan.

## Fixed voice rules

- Reuse an existing binding and profile without changing `profileId`, reference audio path, or profile timestamps.
- Select an audio asset only when the canonical speaker has no binding. Persist the new binding immediately; all later runs treat it as fixed.
- Give narrator its own fixed binding. Never substitute narrator audio for a character or a character voice for narrator.
- Fail if a binding points to a missing profile, lacks reference text, or references a missing/unreadable audio file.
- Fail if any speaker lacks a fixed profile after the missing-binding selection step.
- Never use mock TTS, system-voice fallback, or silent preview for a final video.

## Text boundaries

- Do not modify the novel chapter, source script, director plan, or storyboard visual description while planning voiceover.
- Do not insert subtitles, captions, watermarks, title cards, typography, UI text, or readable words into an image prompt.
- Keep `line` and `ttsSpokenText` in the audio contract only.
- Default to local processing. Do not upload text or reference audio to a cloud TTS service without explicit authorization.

## Final validation

- Assert output count equals the source storyboard count and both are greater than zero.
- Assert every item has non-empty `speaker`, `speakerId`, `line`, `ttsSpokenText`, and `voiceStyle`.
- Assert every item has positive `durationTarget` and `requiresFixedVoice=true`.
- Assert every unique `speakerId` exists in the fixed voice map.
- Assert every storyboard has a real audio path before final rendering.
- Report exact storyboard IDs and reasons for all failures; do not approve a partial plan as complete.
