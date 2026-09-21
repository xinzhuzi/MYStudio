---
name: anime-character-sheet-prompter
description: Use when creating or refining anime character design sheet prompts for Niji or Midjourney, especially turnarounds, three-view sheets, expression sheets, outfit detail sheets, animation model sheets, or style-consistent character references across animation projects.
---

# Anime Character Sheet Prompter

## Purpose

Create reusable Niji/Midjourney prompts for anime production character sheets: front/side/back turnarounds, head close-ups, eye close-ups, clothing and equipment details, expression rows, and faction-consistent design boards.

Use this for animation projects where the character must stay usable for later storyboard, image generation, or video production.

## Source Priority

Before writing a prompt, use the strongest available sources:

1. User's current direction and corrections
2. Project bible or character canon
3. Visual bible / art direction docs
4. Existing character test images or style references
5. Existing prompt iteration notes

If existing character images are provided, inspect them before writing the prompt. Match their sheet format, line weight, cel shading, body proportions, and level of detail.

## Core Workflow

1. Lock the character function first.
   - Role in story, faction, pressure, emotional wound, audience first impression.
   - Avoid starting from hair and clothes alone.

2. Lock the visual contrast.
   - Ensure the character does not collide with existing cast silhouettes, hair colors, eye colors, or costume language.
   - State the distinguishing signal in one sentence.

3. Build the design prompt front-loaded.
   - Put the character and sheet type first.
   - Then face, hair, eyes, outfit, details, layout, style, parameters.

4. Preserve style consistency.
   - Use project-specific style words from existing character sheets.
   - Prefer concrete production terms: `anime character design sheet`, `2D cel animation`, `clean lineart`, `crisp cel shading`, `front side back turnaround`.

5. Make details operational.
   - Include close-up panels that help later animation: head, eyes, collar, gloves, belt device, boots, insignia, weapon/equipment.
   - Describe what each detail communicates.

6. Add parameters at the end.
   - For Niji character sheets, default to:
   - `--niji 7 --ar 16:9 --s 150`
   - Choose one numeric stylize value, such as 120, 150, or 220; never put a range like `--s 120-220` in a runnable prompt.
   - Lower stylize is a starting point for adherence; higher values allow more aesthetic interpretation. These are iteration suggestions, not tested guarantees.
   - Add optional parameters only after checking support for the selected model. Do not automatically inherit Midjourney V7 quality or reference settings into Niji 7.

## Model and Reference Compatibility

- Treat Niji 7 and Midjourney V7 as distinct model targets. Keep the user's selected model.
- Front-load the exact character role and sheet type for clarity. Use concrete visual descriptions and avoid overloaded clauses.
- Niji 7 does not support `--cref`. Do not substitute `--oref`: Omni Reference is documented for Midjourney V7 only.
- For a Niji 7 character reference, use an ordinary Image Prompt plus explicit identity traits. In Discord, place its image URL before the text. Niji 7 image weight is `--iw 0` through `--iw 2`, default 1. This guides the result; it does not lock identity.
- Use `--sref` for style consistency when the user provides a style reference image or known style code. Style Reference does not preserve a character's identity.
- Only when the user chooses Midjourney V7 (`--v 7`), use `--oref` for a supplied character/object reference. Do not silently switch models to enable it.
- When Raw is supported by the selected model, prefer the documented `--raw` syntax. Leave quality at the model default unless a supported override is requested; omitting `--q 2` here is a conservative default, not a claim that it is unsupported.
- Describe the final image, not editing instructions.
- See the dated official sources in `references/niji-character-sheet-patterns.md`; recheck when compatibility is uncertain.

## Prompt Shape

Use this order:

```text
[character role + sheet type],
[identity and visual read],
[face / hair / eyes],
[outfit and silhouette],
[props / equipment / detail panels],
[sheet layout],
[project style],
[parameters]
```

For a single strong result, avoid mixing unrelated aesthetics. Use one main style family.

## Common Fixes

- Too generic: front-load story role, faction, and first-impression phrase.
- Not beautiful enough: explicitly add `stunning anime beauty`, `bishoujo`, and distinctive eyes or face language.
- Too 3D: add `2D cel animation`, `clean lineart`, `crisp cel shading`, `anime production model sheet`; lower `--s`.
- Too much cosplay: specify institutional material logic, rank marks, functional closures, equipment, and silhouette.
- Weak design sheet: demand `front view, side view, back view, head close-up, expression row, clothing detail close-ups`.
- Style drift from project: read existing character tests and reuse their sheet structure, line quality, and finish.

## References

For reusable prompt patterns and templates, read `references/niji-character-sheet-patterns.md`.
