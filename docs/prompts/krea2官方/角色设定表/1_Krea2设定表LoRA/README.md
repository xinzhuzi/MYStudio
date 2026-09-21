---
license: other
license_name: civitai-model-license
license_link: https://civitai.red/models/2764727/tripleview
pipeline_tag: image-to-image
tags:
  - lora
  - comfyui
  - flux.2
  - flux.2-klein-9b
  - krea-2
  - character-sheet
  - character-design
  - image-editing
  - multi-view
  - experimental
---

# CharacterSheet — TripleView, QuadView & DynamicCharacterSheet LoRAs

CharacterSheet is a collection of image-editing LoRAs that converts an existing character image into a clean, multi-view reference sheet. The models are designed to preserve the character's identity, clothing, proportions, and overall appearance across the generated views.

The collection was trained on approximately 300 character-sheet examples. Its main training focus was human characters, although anime, cartoon, animal, creature, and other stylized subjects can also work. Results outside the primary training distribution may be less consistent.

The newest addition, **DynamicCharacterSheet**, is an experimental evolution of the concept: instead of a fixed front/side/back layout, it generates a full "entity sheet" — hero pose, turnaround, action poses, silhouette study, expression/state study, and detail crops — for humans, stylized characters, animals, creatures, robots, vehicles, and objects alike. See the [dedicated section](#dynamiccharactersheet-experimental) below for details.

The generated sheets are useful for:

- Character design and turnarounds
- Front, side, and back reference views
- Character dataset preparation
- CharacterID workflows
- LTX identity-reference pipelines
- Further manual or generative refinement

> These are LoRAs, not standalone checkpoints. Use each file with its matching base model and workflow.

## Available models

| File | Base model | Output layout | Included workflow |
| --- | --- | --- | --- |
| `TripleView_klein9b_v1.safetensors` | FLUX.2 Klein 9B | Front, side, and back full-body views | `workflows/TripleView_klein9b_v1.json` |
| `QuadView_klein9b_v1.safetensors` | FLUX.2 Klein 9B | Face close-up plus front, side, and back full-body views | `workflows/QuadView_klein9b_v1.json` |
| `QuadView_krea2_v1.safetensors` | Krea 2 | Face close-up plus front, side, and back full-body views | `workflows/QuadView_krea2_v1.json` |
| `DynamicCharacterSheet_krea2_v1.safetensors` | Krea 2 | **Experimental.** Full dynamic entity sheet: name/metadata block, hero view, front/side/back turnaround, action poses, silhouette study, expression/state study, and detail-crop study | `workflows/DynamicCharacterSheet_krea2_v1.json` |

## Usage in ComfyUI

1. Download the LoRA that matches your base model.
2. Place it in `ComfyUI/models/loras/`.
3. Open the corresponding JSON file from the `workflows` folder in ComfyUI.
4. Load a clear reference image of the character.
5. In the LoRA Loader node, select the downloaded file. The filename stored in the workflow may differ from the filename in this repository.
6. Use the prompt for the selected layout, then queue the workflow.

### Trigger captions

**TripleView — FLUX.2 Klein 9B**

```text
Convert the character in the image to a Character Sheet showing front, side and back full body views
```

**QuadView — FLUX.2 Klein 9B**

```text
Convert the character in the image to a Character Sheet showing a face close-up, front, side and back full body views
```

**QuadView — Krea 2**

```text
Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views
```

## DynamicCharacterSheet (experimental)

`DynamicCharacterSheet_krea2_v1.safetensors` generalizes the CharacterSheet idea from a fixed front/side/back layout into a full, dynamic "entity sheet": a name/metadata block, a large hero pose, a front/side/back turnaround, action poses (or functional configurations for objects/vehicles), a silhouette study, an expression or state/function study, and a detail-crop study of the most identity-critical features. It was trained on top of the previous 4 Views (QuadView) model, so it inherits that model's versatility.

### About this version

This version is highly experimental, and the text generation on the sheet is still far from perfect. Testing many different configurations, the best results came from using the **LCM sampler** with the **Simple scheduler**.

You can also try increasing the resolution to 2048×1365, 3072×2048, or even 4096×2736. The default resolution is 1536×1024, and higher resolutions can improve text quality slightly — even so, don't expect perfect results yet.

Consistency between views is not 100%, although it tends to be a bit better when using LCM. Overall this was a successful experiment, and it will keep improving in future updates. If you find a better way to improve the text generation, feel free to leave a comment on the [Civitai listing](https://civitai.red/models/2764727/tripleview) or open a discussion here — findings are welcome.

The model is also quite versatile: since it was trained using the previous 4 Views model as its foundation, you are not limited to the included prompt template. Feel free to customize it, or even reuse prompts from the original 4 Views / TripleView / QuadView workflows, to generate different styles and layouts of character sheets. Experimenting with different prompt structures can produce surprisingly good results.

### Prompt format

Unlike the short trigger captions used by TripleView/QuadView, DynamicCharacterSheet expects a structured, bracketed prompt. At a high level, each prompt:

1. Opens with a task header — `[TASK: ENTITY_SHEET_GENERATION]`, `[TEMPLATE: MULTI_ANGLE_ENTITY_SHEET_V1]`, an `[ENTITY_TYPE: ...]` (one of `HUMAN`, `STYLIZED_CHARACTER`, `ANIMAL`, `CREATURE`, `ROBOT`, `VEHICLE`, or `OBJECT`), and an `[ENTITY_ID: ...]` slug.
2. Instructs the model to treat the reference image as the sole identity/design source and to preserve it exactly, without redesigning, beautifying, or simplifying it.
3. Defines the fixed landscape sheet layout: metadata column, hero view, turnaround row, action-pose row, silhouette study, expression/state study, and detail study.
4. Lists 4–7 **identity locks** — concrete, verifiable visual traits (colors, markings, materials, asymmetries) read directly from the reference image.
5. Closes with visible-text rules (English-only, no invented lore) and a negative-constraints block.

The prompt must follow this specific format to get consistent results. You can write it manually if you want, but the included workflow ships with a **VLM prompt-generation node** (Qwen3-VL, preloaded with the full template and worked examples for every entity type) — feed it your reference image and it writes a matching, correctly structured prompt for you. Using the VLM is the recommended path, since it's easy to get the exact structure wrong by hand. Full worked examples for each entity type are included directly in `workflows/DynamicCharacterSheet_krea2_v1.json`.

> **Tip — fidelity dial:** the workflow exposes a `ref_boost` value (on the Krea2 Edit Model Patch node) that controls how strongly the model follows your reference image. `1.0` is closer to the classic, more creative behavior; higher values (around `4.0`) push for much stronger face/body likeness and more reliable edits; pushing it too far (`>10`) can make removals/replacements start failing. Values below `1.0` suppress the reference for more creative freedom.

## Recommended starting settings

These values match the included workflows and are intended as practical starting points.

| Variant | Resolution | Steps | CFG | Sampler | Scheduler | LoRA strength |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| TripleView — FLUX.2 Klein 9B | 1536×1024 | 8 | 1 | Euler | beta57 | 1.0 |
| QuadView — FLUX.2 Klein 9B | 1536×1024 | 8 | 1 | Euler | simple | 1.0 |
| QuadView — Krea 2 Turbo | 1536×1024 | 10 | 1 | Euler | simple | 1.0 |
| DynamicCharacterSheet — Krea 2 Turbo (experimental) | 1536×1024 (up to 4096×2736) | 10 | 1 | LCM | simple | 1.0 |

For Krea 2 Turbo, the included workflow notes that 8 steps can favor stronger composition or instruction adherence, while 12 steps can improve facial detail. When using Krea 2 Raw instead of Turbo, start around 40 steps with CFG 3–4.

## Examples

### QuadView — Krea 2

The examples below show the reference input and generated QuadView result using the Krea 2 variant.

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00115_.png" alt="Krea 2 QuadView sample 1" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00116_.png" alt="Krea 2 QuadView sample 2" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00117_.png" alt="Krea 2 QuadView sample 3" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00120_.png" alt="Krea 2 QuadView sample 4" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00123_.png" alt="Krea 2 QuadView sample 5" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00128_.png" alt="Krea 2 QuadView sample 6" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00131_ (1).png" alt="Krea 2 QuadView sample 7" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00132_.png" alt="Krea 2 QuadView sample 8" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/ComfyUI_temp_mlgmd_00136_.png" alt="Krea 2 QuadView sample 9" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/krea2_identity_edit_00293_.png" alt="Krea 2 QuadView sample 10" width="100%">
</p>

### DynamicCharacterSheet — Krea 2 (experimental)

The examples below were generated with `DynamicCharacterSheet_krea2_v1.safetensors` using the LCM sampler and Simple scheduler, with prompts written by the included VLM node from each reference image.

<p align="center">
  <img src="samples/krea2/DynamicCharacterShett_1.png" alt="DynamicCharacterSheet sample — Grit, a creature/animal character sheet" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/DynamicCharacterShett_2.png" alt="DynamicCharacterSheet sample — Mushroom Scout, a stylized character sheet" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/DynamicCharacterShett_3.png" alt="DynamicCharacterSheet sample — Luna, a stylized character sheet" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/DynamicCharacterShett_4.png" alt="DynamicCharacterSheet sample — Miko Ward, a stylized character sheet" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/DynamicCharacterShett_5.png" alt="DynamicCharacterSheet sample — Miku, a stylized character sheet" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/DynamicCharacterShett_6.png" alt="DynamicCharacterSheet sample — Clefia, a stylized character sheet" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/DynamicCharacterShett_7.png" alt="DynamicCharacterSheet sample — Vivian Edge, a stylized character sheet" width="100%">
</p>

<p align="center">
  <img src="samples/krea2/DynamicCharacterShett_8.png" alt="DynamicCharacterSheet sample — Mizu, a stylized character sheet" width="100%">
</p>

## Limitations

- The model can introduce differences in anatomy, facial features, clothing, accessories, or proportions between views.
- Side and back views may require additional generations or manual cleanup.
- Human characters were the primary training focus; stylized characters and non-human subjects may be less predictable.
- Detailed accessories, asymmetric designs, hands, and complex garments can be difficult to preserve exactly.
- A clear, well-framed input image generally produces a more consistent sheet.
- `DynamicCharacterSheet_krea2_v1.safetensors` is highly experimental: on-sheet text generation is still far from perfect, view-to-view consistency is not 100%, and results depend heavily on following the required prompt format (see the [DynamicCharacterSheet section](#dynamiccharactersheet-experimental) above).

## License and source

Usage permissions follow the [original Civitai model listing](https://civitai.red/models/2764727/tripleview). Review that page before redistribution or commercial use.

If this project is useful to you, you can [support continued model development](https://buymeacoffee.com/nrdx).
