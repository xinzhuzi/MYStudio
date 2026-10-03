---
name: h3-prompt-writing
description: Write MiniMax H3 video generation prompts for T2VA, I2VA, FL2VA, L2VA, and Ref2VA, including fight and action choreography. Use when rewriting multimodal requests into H3 prompt structures, composing integrated_multimodal_description, overall_soundscape, and non_diegetic_music, aligning keyframes, or defining reference labels for images, videos, and audio. Also use when a hand-fed Chinese direct draft is needed for manual, non-API generation.
compatibility: Portable to any agent that can read local files — no external API calls, MiniMax Hub tools, or proprietary runtime required. The agents/openai.yaml file only adds optional ChatGPT/Codex UI metadata; it does not restrict the skill to OpenAI agents.
---

# H3 Prompt Writing

## Workflow

1. Identify the input mode: T2VA, I2VA, FL2VA, L2VA, or full-reference Ref2VA.
2. For base text/keyframe modes, read `references/base-en.txt` and follow its final prompt structure.
3. For full-reference mode, read `references/ref-en.txt` and follow its six-section rewrite format.
4. Preserve the exact field names, section order, labels, and timing notation from the selected guide.
5. For a hand-fed Chinese direct draft (manual web/client generation or a non-API quick draft), read `references/direct-zh.md` and follow its five-element order and anaphora blacklist. The official English structure from steps 2-4 stays the default and remains the pipeline source of truth.
6. Controlled marks and numbering — `<d>[Language] ...</d>` dialogue tags, `<scenetrans>`/`<cutoff>` cut-crossing marks, `(S1)`-style global speaker IDs, and retention enums (`fully_preserved`/`partially_preserved`/`attribute_transfer`/`weak_reference`; audio: `fully_copy`/`partially_copy`/`reference`/`weak_reference`) — are fixed vocabularies defined in `references/base-en.txt` (§4.4–4.5) and `references/ref-en.txt` (§4.1–4.2, §5.2); look them up there instead of improvising marks.
7. For fight or action shots (duels, chases, standoffs, stunts), read `references/action-en.txt` before writing the action passages, and apply its choreography rules on top of the guide selected in steps 2-5.

## Base Modes

- T2VA: build the full audiovisual timeline from text.
- I2VA: start from the first frame and develop forward from it.
- FL2VA: describe the continuous path between the first and last frames.
- L2VA: infer a plausible opening and converge to the supplied last frame.

Use `integrated_multimodal_description`, `overall_soundscape`, and `non_diegetic_music` in the order shown in `references/base-en.txt`.
Fight and action scenes follow the choreography rules in `references/action-en.txt` for their actions, camera, and sound.

## Full-Reference Mode

Ref2VA rewrites use `subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`, and `non_diegetic_music` in that order. Reference labels stay consistent across all sections.

Read `references/ref-en.txt` for label rules, retention analysis, and complete examples.

## Output Rules

- Write rewrite sections in English; preserve dialogue, lyrics, and visible scene text in their original language.
- Describe each shot by composition, subjects, environment, actions, camera, sound, and the exact point where referenced content appears.
- Avoid plot summaries, unresolved reference labels, and timing that does not match the requested duration.
- Every final prompt must stand alone without its surrounding context: never rely on words like "the previous shot", "continues", "same as above", "still", or "as before"; expand every physical state into a complete, self-contained description.
## Tips for Better Results
- Always match the total duration of the description to the requested video length (5–15 seconds; matches the trained range, see `docs/comfyui-kb/参数速查.md` H3 section and `references/direct-zh.md`).
- Keep reference labels consistent (e.g. `<Picture 1>`, `<Video 1>`, `<Audio 1>`) across every section.
- Prefer concrete visual and audio details over abstract words like "cinematic" or "beautiful".
- When using keyframes (I2VA / FL2VA / L2VA), clearly state how the first and/or last frame connects to the timeline.
