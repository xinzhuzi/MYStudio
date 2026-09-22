---
name: qwen-image-prompt-en
description: Write and improve prompts for Qwen-Image-2.1, Alibaba's open-weight image generation and editing model. Use whenever the user wants to generate or edit images with Qwen-Image / Qwen-Image-2.1 / Qwen-Image-Edit, asks for help prompting any Qwen image model, needs readable text rendered inside an image (posters, signs, UI mockups, infographics), wants to combine several reference images into one, or asks about aspect ratios, styles, or camera settings for Qwen image generation — even when they are only choosing an image model for a text-heavy graphic and have not named the model yet.
---

# Qwen-Image-2.1 Prompt Guide

Qwen-Image-2.1 (released 2026-09-20) is a 7B unified model: text-to-image generation, image editing, multi-reference compositing, transparent (RGBA) output, and best-in-class text rendering, at native 2K resolution. It is prompted with **fluent natural language**, not Stable Diffusion-style tag lists.

## Core rules (always apply)

1. **Natural sentences, never tag lists.** Qwen image models ignore SD-style tags and `(term:1.5)` weight syntax. Emphasize by description instead: "with vibrant, striking red hair".
2. **Write descriptive prompts in English**, whatever language the user speaks. Only text that must appear *inside* the image keeps its original script (Japanese stays Japanese, Chinese stays Chinese).
3. **Front-load the subject.** The transformer weights early, concrete tokens heavily — subject first, then environment, style, composition, lighting.
4. **Any string that must appear in the image goes in double quotes, verbatim.** `a neon sign that reads "GRAND OPENING"`. Case and punctuation are reproduced as written.
5. **Edit prompts state the edit + a preserve clause.** "Change X to Y. Keep everything else unchanged." One logical edit per pass; chain small passes for big changes.
6. **Pass aspect ratio / resolution as a parameter** (`wh_ratio`, `size`, or your UI's ratio picker) — never write "16:9" or "4K" inside the prompt text.
7. **No quality boosters.** "masterpiece", "8K", "highly detailed", "award-winning" are officially discouraged for 2.1 — describe what is visible instead.

## Routing

| The user wants… | Read before writing |
|---|---|
| A fresh image from a text description | `references/text-to-image.md` |
| To modify, restyle, or combine existing images | `references/image-editing.md` |
| Readable text *inside* the image (posters, signs, UI, charts) | `references/text-rendering.md` (plus the T2I or editing page) |
| Transparent PNG, sticker, or subject cutout | `references/capabilities.md` → Transparent images |
| Aspect ratios, negative prompts, CFG, seed, steps, or how to run the model | `references/capabilities.md` |
| Concrete prompts that are known to work | `references/examples.md` |

## Workflow

1. Identify the mode: **generate**, **edit**, or **composite**. If readable in-image text is involved, the text-rendering rules apply on top of the mode's rules.
2. Read the matching reference file. Do not write from memory — the official style rules are detailed and counterintuitive in places (e.g. long observational paragraphs for layouts, preserve-clauses for edits).
3. Draft the prompt in English. Check it against the core rules above.
4. Choose the aspect ratio semantically (portrait subject → 2:3, presentation → 16:9, badge/icon → 1:1) and pass it as a parameter. Default 3:2 landscape / 2:3 portrait.
5. If the user reports a failure (garbled text, wrong subject, drifted face), consult the failure-pattern table in `references/capabilities.md` before rewriting.

## Minimal templates

```text
Simple generation:
A neon shop sign that reads "QWEN IMAGE 2.1", rainy night, reflections on wet pavement

Simple edit:
Change the background to a sunset beach. Keep the subject, pose, and lighting unchanged.

Transparent sticker:
This is an RGBA image with transparency. A cute cartoon dragon sticker.
The image has alpha channel and the background is transparent.
```

For anything with multiple elements, precise placement, or several text blocks, escalate to the long-form style in `references/text-to-image.md` — short prompts underperform on layouts and posters.
