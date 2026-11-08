# Model capabilities, parameters, and running

## Identity snapshot (as of 2026-09-21)

- **Qwen-Image-2.1** — released 2026-09-20. 7B single-stream DiT (MMDiT family), Qwen3-VL 8B text encoder, 64-channel RGBA VAE, flow matching. Unified generation + editing.
- Official prompt rewriters: **PE-T2I** and **PE-I2I** (9.4B each) expand short requests into the styles this skill documents.
- Serving: open weights on Hugging Face / ModelScope; Diffusers (recommended), ComfyUI, vLLM-Omni, SGLang, LightX2V. HF Space demo exists. **Not yet on Alibaba Cloud Model Studio (Bailian) API as of 2026-09-21.**
- Lineage note: Qwen-Image-3.0 / 3.0-Pro (2026-07) are newer but closed API-only; 2.1 is the current open-weights flagship.

## Aspect ratios and resolution (native 2K)

| Ratio | Pixels | | Ratio | Pixels |
|---|---|---|---|---|
| 1:1 | 2048×2048 | | 3:2 | 2528×1696 |
| 4:3 | 2400×1792 | | 16:9 | 2752×1536 |
| 3:4 | 1792×2400 | | 2:3 | 1696×2528 |
| — | — | | 9:16 | 1536×2752 |

- The official rewriter may also emit 2:1, 21:9, 9:21, 4:5, 3:1, 5:4, 1:3, 18:39, 9:20, 7:3, 9:5, 5:7 — map to the nearest supported resolution in your pipeline.
- vLLM-style APIs accept `"size": "1024x1024"` strings directly.

## Generation parameters

- **Steps**: 40 (official default). Text-bearing generation or edits: 50 — the first value to raise when text garbles (see `text-rendering.md`).
- **CFG / negative prompts**: the Diffusers pipeline exposes `negative_prompt` + `true_cfg_scale` (default 4.0; true CFG active when >1 *and* a negative is given). Distillation-style serving at guidance 1 ignores negatives entirely — check your runtime before promising negative-prompt behavior. For garbled in-image text, raise true_cfg to 6–8 with a text-repair negative; that overrides the 4.0 default.
- **Seed**: full control (`torch.Generator(...).manual_seed(n)`, `--seed` on vLLM). Fix the seed across prompts to hold a product/character series consistent.
- Useful hand-repair negative: `extra fingers, deformed hands`. Text-repair negative: `misspelled text, garbled letters, unreadable font`.

## Transparent images (RGBA)

Official template — use verbatim, substituting only the description:

```text
This is an RGBA image with transparency. <your description>.
The image has alpha channel and the background is transparent.
```

Also powers subject cutout and transparent-layer editing.

## Multi-reference input

Up to **10 reference images** (ComfyUI nodes accept 16). Tag-reference rules (`<image1>`, …) are in `references/image-editing.md`.

## Minimal run snippets

```python
# Diffusers (recommended)
from diffusers import QwenImage21Pipeline
pipe = QwenImage21Pipeline.from_pretrained("Qwen/Qwen-Image-2.1", torch_dtype=torch.bfloat16)
image = pipe(prompt, negative_prompt=" ", true_cfg_scale=4.0,
             height=1536, width=2752, num_inference_steps=40).images[0]
```

```text
vLLM: qwen-image-2.1 endpoint — {"prompt": "...", "size": "1024x1024", "seed": 42}
```

When no negative is intended, pass a single space (`" "`), not an empty string.

## Known failure patterns → fixes

| Symptom | Fix |
|---|---|
| Tag-style or weighted syntax ignored | Rewrite as fluent natural sentences |
| Wrong or ambiguous subject | Move subject to sentence start; add specifics |
| Composition muddled on a long prompt | Compress to 1–3 sentences, front-loaded — **except layouts/posters/text-heavy images**, where the long form is correct and the real cause is usually unspecified positions or too many unplaced elements |
| Garbled in-image text | Quote verbatim; raise true_cfg to 6–8; steps to 35–50; simplify numerics; Japanese → edit-tracing route |
| Edit bleeds into untouched regions | Add/expand preserve clause; split into smaller chained edits |
| Face or identity drifts | "Preserve face/clothing features"; point at reference by tag, not description |
| Fingers/hands broken | Negative + affirmative posture phrase |
| Noisy output, stiff action poses | Day-one 2.1 reports; no established fix yet — retry with a new seed, reduce prompt length |

## License — read before shipping anything commercial

Qwen-Image-2.1 ships under the **Qwen Research License Agreement** (not Apache 2.0 like the first generation):

- Free use is limited to **research and evaluation (non-commercial)**. Commercial use requires a separate license (model-business@notice.qwencloud.com).
- Redistribution must include the license, flag modified files, and attribute.
- Training other AI models on the outputs requires a "Built with Qwen" notice; derivative names must not lead with "Qwen".
