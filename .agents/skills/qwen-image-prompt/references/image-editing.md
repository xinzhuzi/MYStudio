# Editing, restyling, and compositing

Qwen-Image-2.1 unifies editing and generation: the same model takes one input image (edit), several reference images (composite), or none (generate). Editing prompts are **short imperatives** — the opposite of long generation prompts.

## The governing principle: attribute disentanglement

Name only the attributes that should change, and lock everything else with an explicit preserve clause. The two failure modes are symmetric:

- **Leakage** — the edit bleeds into things you didn't name ("make it night" also restyles the coat).
- **Under-editing** — the output is indistinguishable from the input.

A preserve clause locks *content*, it does not weaken the edit. Always include one.

```text
Replace the sign text with 'GRAND OPENING'. Keep the original font, size,
color, and perspective. Leave the background and signboard unchanged.
```

## Rules

- **Short imperative sentences.** "Change the background to a sunset beach." / "Remove the parked car." / "Add a wool scarf around her neck." / "Rotate the shoe to show the sole."
- **Name preserves by role or position, never re-describe their appearance.** Re-describing a preserved element reads as a generation instruction and causes drift. Prefer one blanket clause ("Keep everything else unchanged") over many specific ones.
- **Identity is the hardest invariant.** Faces, characterizing accessories, product design, and rendering medium (photo / anime / illustration / 3D) survive every edit unless explicitly targeted. When identity comes from a reference image, point to it with an image tag — describing it in words degrades the likeness.
- **In-image text is literal.** Every readable string that should appear in the output is committed exactly, in quotes. No paraphrasing, no summarizing. Keep the typography and language of the input. Never add text you cannot read in the source.
- **Affirmative phrasing.** "Keep the background unchanged", not "Don't change the background."
- **Decisive wording.** No hedges, no unresolved alternatives ("maybe", "or") — ambiguity splits the edit.
- **Single paragraph, no newlines.** Only characters to be *drawn* get double quotes. Ratio and resolution never appear in the text (see below).
- **Chain small edits.** Split ambitious changes into 2–3 sequential passes (edit → inspect → next edit) instead of one overloaded instruction. A canonical composite recipe (e.g. placing a product onto a new surface) still counts as one logical change even though it touches several regions. Keep chains short — every pass re-encodes the whole image, so identity and label fidelity erode as passes pile up; re-verify them after each pass.

## Multi-reference compositing (2–10 images)

With two or more input images, the official 2.1 rewriter makes **tag references mandatory**:

- Refer to inputs as `<image1>`, `<image2>`, … — never "the first image", "image A", "图1".
- With a single input image, do *not* use tags.
- Assign each image a role — which is the **canvas** (base to modify) and which are **donors** (supply the person, product, background, or style).
- Spatial language still decides layout inside the canvas: "facing each other", "on the left / on the right".

Canonical recipes:

| Task | Prompt shape |
|---|---|
| Person into scene | `Place <image1>'s character in the forest camp of <image2>. Keep hairstyle, clothing, and facial features identical.` |
| Product into setting | `Put the product from <image2> onto the marble counter in <image1>. Preserve the product's shape, materials, and label text exactly.` |
| Background replace | `Replace the background of <image1> with the scenery from <image2>. Keep the subject, pose, and lighting direction unchanged.` |
| Style transfer | `Re-render <image1> in the art style of <image2>. Preserve subject identity, clothing, and layout.` |
| Group composite | `The characters from <image1>, <image2>, and <image3> are sitting around a campfire in a forest.` (2.1 official example) |

## Language layering

Two independent language decisions — do not conflate them:

1. **Description language**: English is the safe default for the edit instruction (the official rewriter outputs Chinese for Chinese requests and English otherwise). One exception: the Japanese text-tracing pass is proven with a Japanese instruction — see `text-rendering.md`.
2. **In-image text language**: (a) an explicit user instruction wins; otherwise (b) the dominant text language of the input image; otherwise (c) the instruction's language. Rendered text stays **monolingual** — no mixed scripts in one string.

## Output size

- Default: **follow the input image's ratio** (`ratio_follow: "<image1>"` in the rewriter's schema). Setting `wh_ratio` and `ratio_follow` together is invalid — they are mutually exclusive.
- Exception — "new scene generation" (photo-shoot scenes, cosplay, fresh settings): choose the ratio semantically, like generation.
- Keyword→ratio conventions used by the official rewriter: square/avatar → 1:1, landscape/PPT → 16:9, poster → 2:3, ID photo / Xiaohongshu → 3:4, panorama → 2:1, business card → 9:5, A4 → 5:7 / 7:5, iPhone screen → 18:39, Android → 9:20, cinemascope → 21:9.
- "2K/4K/8K" are quality descriptors, not ratio hints — output is always ~2K; never infer a ratio from them.
- Outpainting: infer the new ratio from the expansion direction (expect +30–50% added area).

## Local edits

2.1 replaces the old ControlNet-style conditioning with in-canvas annotation: draw a circle around, paint over, or mask the region to edit, then write the instruction scoped to that region — "Within the red box, replace … Leave everything else unchanged."
