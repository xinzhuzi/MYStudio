# MiniMax H3 reference: weights, quants, acceleration, tooling

Everything verified against the source repositories on **2026-08-06**.
**2026-10-15 addendum**: the fixed line now runs the lightx2v **v1.2** FL2V turbo LoRA (full-rank),
swapped from the v1.1 rank-28 community resize — see the production-stack section below. The larryvrh
and lightx2v-v0.1 paragraphs below are kept as historical context; version currency lives in the
`docs/comfyui-kb/LoRA库存台账.md` ledger (rows #22 retired / #29 current). Sizes are read from the HuggingFace repo
trees, node facts from the node code, not from summaries.

## What ships, and what does not

The open release is **H3-Base only**, generating at **768p**. Two of the three official modules stay hosted:
**H3-Context-IR** (the multi-stage prompt and context refiner MiniMax calls "critical to the quality of the final
output") and **H3-Regenerate-2K** (the 2K pass). Locally you replace the first with your own prompt discipline
(the three-field format in SKILL.md, optionally expanded by a local LLM) and the second with an ordinary
upscaler or the two-pass latent route below. A hosted result looking more finished than your local one is the
missing IR, not your settings.

Architecture, from the official card: the text and visual encoder is the **full Qwen3-VL-32B**, tapped at its
**50th layer**; video and audio have separate VAEs; the Omni-Transformer predicts video and **stereo** audio
latents jointly.

## Official weights (`Comfy-Org/MiniMax-H3`, `diffusion_models/`)

Two task families. **FL2VA** covers text-to-video, image-to-video and first/last frame. **Ref2VA** is the
omni-reference variant.

| File | Size |
|---|---|
| `minimax_h3_{fl2va,ref2va}_bf16.safetensors` | 66.28 GB |
| `minimax_h3_{fl2va,ref2va}_pruned_bf16.safetensors` | **40.23 GB** |
| `minimax_h3_{fl2va,ref2va}_int8_convrot.safetensors` | 34.04 GB |
| `minimax_h3_{fl2va,ref2va}_pruned_int8_convrot.safetensors` | 20.97 GB |
| `minimax_h3_{fl2va,ref2va}_pruned_fp8_scaled.safetensors` | 20.96 GB |

Sizes re-read from the HF blob listing 2026-08-09; the `pruned_bf16` row was missing from this table before
that date. **Pruned is a different axis from precision:** it drops weights rather than narrowing them, so
`pruned_bf16` at 40.23 GB is full precision on a smaller network, while `pruned_int8_convrot` stacks both and
is the smallest thing here that still runs the real model.

Plus `text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`,
`vae/minimax_h3_video_vae_fp16.safetensors` and `vae/minimax_h3_audio_vae_fp32.safetensors`.

**Where they go on disk.** The repo paths mirror the ComfyUI model tree, so under your ComfyUI base directory:
`models\diffusion_models\` for the fl2va / ref2va checkpoint, `models\text_encoders\` for the Qwen3-VL
encoder, `models\vae\` for both VAEs. On a Desktop install the base directory is the one in Settings > Server
Config, not necessarily next to `main.py`. **The fastest first run is not hand-wiring the graph**: open the
shipped template `video_minimax_h3_t2v` from the template browser and swap the checkpoint if needed.

The **pruned fp8 variant is the same 21 GB as the pruned int8** and is worth trying when int8 misbehaves on a
given card. These are Comfy-Org's own conversions.

## Community quants (`Abiray/MiniMax-H3-GGUF`)

GGUF builds for both task families, sizes read from the repo tree:

| Quant | UNet size |
|---|---|
| Q3_K_S / Q3_K_M | **15.6 GB** |
| Q4_0 | 18.6 GB |
| Q4_K_S / Q4_K_M | 19.9 GB |
| Q5_0 | 22.8 GB |

Paired text encoder `text_encoders/qwen3vl_32b_minimax_h3-Q4_K_M.gguf` at **14.6 GB**, and a non-GGUF
`qwen3vl_32b_minimax_h3_int4_convrot.safetensors` at 15.0 GB. Q3 plus the Q4_K_M encoder is the smallest
credible full stack. **GGUF needs a loader that core does not have**: install `city96/ComfyUI-GGUF` and use its
UNet / CLIP loaders in place of `UNETLoader` and `CLIPLoader`. Two things this repo does not answer, so test
before committing a download: whether that pack has been updated for the H3 architecture, and whether the Turbo
LoRA below key-matches a GGUF UNet at all, since it was converted for the pruned safetensors layout. Wanting
both "fits in VRAM" and "runs in 4 steps" may not be satisfiable on the same stack today. Other community authors publishing H3 quants: Merserk, DeepBeepMeep, Gluttony10,
lilcheaty, tsolful, ethanfel. kijai publishes no H3 *weights* (checked all 73 of his HF repos), so credit for the
official conversions belongs to Comfy-Org, but he **does** ship an H3 node inside KJNodes, see below.

## In production now (2026-10-15): the fixed-line stack

The production fixed line (`2_固定线/社区-480P生成-SolAttn加速-480P直出.json` and its 960P sibling) runs
**four acceleration layers together**, all active (mode=0), sampler `simple`/euler at **8 steps** on the
4-step-distilled LoRA (over-spec on purpose — quality choice; ModelTC's own spec recommends 4):

1. `SolAttnPatch` (Sol-Attn, MPS build `ComfyUI-SolAttn-MPS`) — sparse-attention kernel;
2. `MiniMaxH3BlockCacheT8` (T8 pack) — block caching across steps;
3. `ModelPreviewOverrideKJ` + `vae_approx/taeh3.safetensors` — TAEH3 fast preview decode;
4. turbo LoRA **`minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors`** (lightx2v, 1,956,193,000 B,
   md5 4b60019912eca2ffc6f95441c582c3f7, strength 1.0) on the pruned bf16 base.

**2026-10-15 swap record**: replaced `...v1.1_768p_comfyui_resized_avg_rank_28_bf16` (394 MB community
rank-compressed derivative) across 6 files / 11 references (2 固定线, 3 社区模板 incl. TTS, and the
frontend assembler template `h3-shot-template.json`). Old file + its HF cache metadata moved to
`<engine-home>/模型备份.已升级-h3-2026-10-14/` (outside `models/` — ComfyUI's `folder_paths.py` os.walk
would re-list backups inside the tree), manifest `h3_upgrade_1014.manifest.jsonl` (9 lines, md5s).
Upgrade script: archived 2026-10-16 to `apps/build/scripts/retired/h3_upgrade_1014.py` (campaign closed; idempotent, resumable — recover via `git log --follow` if ever rerun).

**First live-fire (interrupted, half-receipt)**: v1.2 loaded cleanly (38.4 GB full load, zero validation /
node errors), stack ran with Sol-Attn chaining + BlockCache logging, sampling at ~49.5 s/it at 480p when
globally interrupted to yield the machine to parallel sessions. Full-clip receipt pending a quiet window.

**Known latent issue (not introduced by the swap)**: the self-managed `extra_model_paths.yaml` has **no
`vae_approx` mapping**, so `taeh3.safetensors` is invisible to `ModelPreviewOverrideKJ.tiny_vae` (options
resolve to `['none']` only) — the fixed line fails validation as saved; canvas runs hit the same wall.
Preview-only impact (output goes through the real VAEDecode). Proper fix belongs in the app-side yaml
generator (one line, needs repack); bypass for API firing: set `tiny_vae="none"`.

## Turbo LoRA: four steps instead of twenty

Original by **larryvrh** (`larryvrh/MiniMax-H3-Turbo-Lora`), converted for ComfyUI's pruned/curve-form
checkpoint by **drbaph** (`drbaph/MiniMax-H3-Turbo-Lora-ComfyUI`, Apache-2.0). The conversion exists because the
original tensor keys target the full-model layout, not the pruned one.

**Four files, not two.** The `ckpt500` pair is further-trained beyond the initial preview and is what the
converter recommends starting from:
- `minimax_h3_turbo_4step_ckpt500_pruned_comfyui.safetensors` - start here
- `minimax_h3_turbo_4step_ema_ckpt500_pruned_comfyui.safetensors` - EMA, for comparison
- `minimax_h3_turbo_4step_pruned_comfyui.safetensors` and its `_ema_` twin - the earlier preview versions

**non-EMA** is described as sharper with stronger fast-motion behaviour; **EMA** as smoother, time-averaged, and
in the initial release softer because the EMA had not matured. A ready workflow ships alongside:
`fl_minimax_h3_turbo_lora_example_workflow.json`, wired for first-and-last-frame with the LoRA attached.

**Read the original author's own caveat before trusting the speedup.** The Turbo LoRA is an *early preview from
an in-progress training run*: under-trained, EMA not fully matured, "quality is not representative of a
completed run". The claim is roughly **4 sampling steps instead of ~20, about a 5x cut in sampling wall-clock**.
Treat it as a fast draft mode, not a free quality-neutral win.

**A second, independent Turbo family from lightx2v, and it is the one that covers Ref2VA.** The larryvrh /
drbaph pair above is first-and-last-frame only. `lightx2v/Minimax-h3-Turbo` on HuggingFace (last modified
2026-08-13, file list read from the HF API on 2026-08-15) ships both task families, and the files whose names
end `_comfyui_` are the ones already in ComfyUI's key layout:

- `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` - **reference-to-video in 4 steps**, and as of
  this reading the only public 4-step checkpoint for that task.
- `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors` - FL2V at 4 steps, v1.0, trained at 768p.
- `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` - FL2V at 8 steps, for when 4 is too lossy.
- Non-`comfyui` twins of each are the Diffusers-layout weights; do not load those into ComfyUI.

Note the version gap: FL2V is at **v1.0**, Ref2V is still **v0.1**. Expect the reference path to be rougher.
Same caveat as the section above applies: a distilled step-cut is a draft mode, not a free win.

## Refining small faces: `Carasibana/ComfyUI-H3-FaceRefine`

H3 renders distant or small faces as mush. This pack fixes it the way a compositor would: track the face,
crop it so it fills the canvas, regenerate it with H3 at native resolution, composite it back. Modelled on
Impact Pack's FaceDetailer but built for temporal consistency across frames rather than one still.

**Six nodes, all `CATEGORY = "MiniMax H3/Face Refine"`** (read from the pack's `nodes.py`):
`H3FaceTrackCrop`, `H3FaceStitch`, `H3InjectVideoLatent`, `H3PerFrameDenoise`, `H3FaceMaskSAM`,
`H3FaceTransformInfo`.

**The chain:**
- **`H3FaceTrackCrop`** (display "H3 Face Track + Crop") takes `images` plus a `detector`, and returns SIX
  outputs in this order: `crops` (IMAGE), **`transform` (a custom `H3FACEXFORM` type)**, `preview` (IMAGE),
  `report` (STRING), `canvas_w` (INT), `canvas_h` (INT). The `transform` is the part that matters: it carries
  the per-frame geometry, and `H3FaceStitch` cannot put the face back without it.
- Send `crops` through an H3 pass. `H3InjectVideoLatent` ("H3 Inject Video Latent (img2img)") takes
  `av_latent` + `images` + `vae` and returns a LATENT, which is how you get the crops into an existing AV
  latent for an img2img-style refine.
- **`H3FaceStitch`** ("H3 Face Stitch Back") takes `base_images`, `refined_crops` and `transform` -> IMAGE.
- `H3FaceMaskSAM` returns MASK for a tighter paste; `H3FaceTransformInfo` just prints the transform.

**Defaults worth knowing before you turn dials:** `crop_factor` 2.5 (crop side as a multiple of detected face
HEIGHT), `canvas_width`/`canvas_height` 512 with a `canvas_mode` of `manual` / `auto_no_downscale` /
`auto_capped_768` (the tooltip names 768 as H3's native size, so 512 is the cheap setting, not the good one),
`smooth_window` 21 frames on the crop CENTRE and `size_smooth_window` 51 on the crop SIZE (size wants more
smoothing than position), `smooth_method` gaussian, `size_mode` per_frame. On stitch: `paste_region`
`face_only`, `mask_dilation` 16, `feather` 6, `colour_match` 1.0, and `undetected_frames` `fade_out`, which
is what stops a hard pop on frames where the subject turns away.

**Holding one person through a crowd:** connect a clear face image to the optional `identity_reference` and
leave `identity_track` on; `identity_threshold` 0.28 is the minimum cosine similarity to accept a face as
that person. Without a reference it falls back to the `select` combo (`largest` / `most_central`).

Two example graphs ship: `H3_Face_Refine.json` and `H3_Face_Refine_SAM.json`. Confirmed by reading the pack's
`nodes.py` and listing `example_workflows/` on 2026-08-15; not run here.

## Long sequences on a small card: `vizart-vj/ComfyUI-MiniMax-H3-LongMedia`

A node pack aimed at long H3 sequences on limited VRAM. Its own description names streamed Sol attention,
compressed KV, adaptive VRAM guards, and chunked MLP and final output. Reported to let 16 GB cards hold heavy
resolutions and long packed sequences, with hybrid auto modes, first and last frame anchors, loop generation
and video reference editing. **Repository existence and description confirmed 2026-08-15; the node names and
wiring were NOT read**, so treat this as a pointer, not a recipe, and read its `NODE_CLASS_MAPPINGS` before
building on it.

## Sol-Attn: skip most KV blocks instead of quantising all of them

Two packs, both created 2026-08-03, both aimed at H3, and **they are not the same implementation** even though
community posts describe them as one. Paper: arXiv **2607.24027**, "Sol-Attn: Accelerating Video Generation
Inference via On-the-Fly Attention Sparsification".

- **`kijai/ComfyUI-SolAttn_triton`** is the one to reach for. Own Triton kernels, no `flex_attention`. Node
  **`SolAttnPatch`** ("Patch Sol-Attn", category `sol_attn`, EXPERIMENTAL), MODEL to MODEL. Widgets: `tau`
  (default **1.3**; its own hint reads 1.0 keeps about 16 percent of blocks exact, 1.5 about 7, 2.0 about 2.7),
  `start_percent` 0.2, `end_percent` 0.9, `min_tokens` 4096, `int8_qk` true, `sink_conditioning`
  (`exact_kv` / `exact_kv_and_rows` / `off`, default `exact_kv_and_rows`), `morton`, `morton_curve`, `int8_pv`,
  `verbose`, `use_tma`, `tau_profile`, `dense_blocks`. Second node `SolAttnBlockProbe`. **No licence file at
  all**, which is fine for personal use and a problem for anything else.
- **`KingGore/ComfyUI_sol-attn_Blackwell`** (Apache-2.0) is the `flex_attention` plus `torch.compile` one, node
  `SolAttnMiniMaxH3Patcher`, category `model_patches/optimization`, `tau` default **1.0**. **`tau` does not
  transport between the two packs**, do not copy a value across.
- **It composes with the Sage patch below rather than replacing it.** Sol-Attn only runs between
  `start_percent` and `end_percent`, so the first 20 and last 10 percent of steps still use whatever attention
  backend you already have. Different mechanisms: SageAttention quantises **dense** attention, Sol-Attn
  **discards most KV blocks** and quantises what survives.
- **The "Blackwell only, SM120 only" line that circulates with these packs is a README claim, not a code gate.**
  Checked all three execution paths in the KingGore pack: the eligibility checks are `ndim == 4`,
  `head_dim == 128`, `bfloat16`, CUDA. The `sm in [90, 100, 120]` list is read only by an informational node
  that prints text. kijai's own readme says tested on **RTX 4090**, which is Ada SM89. In his kernels the only
  capability check picks pointer kernels over TMA below SM90, and pointer kernels are the default anyway.
  **So it loads and takes the sparse path on Ampere.** What you lose on non-SM120 is the warmup, which sits
  behind an `if sm == 120`, so the first call pays compilation.
- **Inferred, not measured:** whether that translates into wall-clock gain on a 3090. The published 9x at 32k
  tokens was taken on SM120 where `flex_attention` lowers into FlashAttention-3-class kernels; on Ampere
  inductor emits an ordinary Triton kernel and the win will be smaller. Nobody in either issue tracker has
  reported a 30-series result. Run it with `verbose=true` and check whether the log shows the sparse path or
  `dense_fallback`, then time it against the node bypassed.
- **Known defect in the KingGore pack:** its advertised three-level fallback is two levels. In
  `minimax_h3_patch.py` the name `_sol_attn_fallback_fn` is assigned without being declared `global`, so the
  module-level value stays `None` and the Triton-reference tier is unreachable. Generation still survives via
  an outer handler, so this costs speed, not runs.

## TAE preview: watch the sampling instead of guessing at it

H3 samples slowly, and the default latent preview is unreadable. A **tiny autoencoder** fixes that for about
10 MB. `Kijai/MiniMax-H3-TAE` ships `vae_approx/taeh3.safetensors` (9 791 388 bytes), and kijai's own card says
madebyollin has since trained a better one that works with the same node, so **take madebyollin's**
(`madebyollin/taehv`, same filename).

**This is NOT a VAE for the real decode and it never touches `VAEDecode`.** Put the file in
`ComfyUI\models\vae_approx\`, then insert **`ModelPreviewOverrideKJ`** ("Model Preview Override", category
`KJNodes/sampling`) into the MODEL line: it is a MODEL to MODEL patcher that wraps the sampler, and its
`tiny_vae` combo is populated from the `vae_approx` folder. Setting `tiny_vae` overrides both Latent2RGB and
the node's optional `vae` input. Quality is approximate by design; the card's own wording is that it still
beats latent2rgb for preview.

## kijai's VRAM patch (KJNodes)

`kijai/ComfyUI-KJNodes` ships **`MiniMaxH3MemoryEfficientSageAttentionPatch`** ("MiniMax H3 Mem Eff Sage
Attention Patch", category `KJNodes/minimax`, **EXPERIMENTAL**). A **MODEL patcher** like Spectrum, so the two
chain in one graph: this one swaps a custom SageAttention into H3's self-attention across every transformer
block **to reduce peak VRAM**, while Spectrum reduces step count. It hard-errors rather than degrading if
sageattention is too old, if the ComfyUI build has no H3 support, or if the model is not a `MiniMaxH3Model`.
This is the "kijai patch" that shows up in community reference-to-video test configs.

**Name collision:** `MiniMaxRemover` (`zibojia/minimax-remover`) is an unrelated video object-removal model that
kijai wires into `ComfyUI-WanVideoWrapper`. Searching his repositories for "minimax" returns it, which is why a
quick search can wrongly suggest either that he has H3 weights or that he has nothing H3 at all.

## Spectrum: forecast solver steps instead of computing them

`xmarre/ComfyUI-Spectrum-MiniMax-H3` (GPL-3.0). One node, **`SpectrumApplyMiniMaxH3`**, category
`sampling/spectrum`. It is a **MODEL patcher, not a replacement sampler**: MODEL in, MODEL out, so it sits
between `UNETLoader` and everything downstream. Widely repeated instructions to "replace the sampler with a
Spectrum Sampler" are wrong; the pack contains exactly one node class.

What it does, in the author's own accounting over 20 steps:

| Sampler | Actual steps | Forecast | Forecast at | Fewer transformer calls |
|---|---|---|---|---|
| Euler | 13 | 7 | 5, 7, 9, 11, 13, 15, 17 | ~35% |
| RES multistep / CFG++ | 14 | 6 | 5, 7, 9, 11, 13, 15 | ~30% |

Those are **solver-step counts, not wall clock**. The README is explicit that end-to-end gain also depends on
output-head cost, CPU transfers, offload, references, CFG branching, latent size and hardware, so circulating
"1.5x" figures describe one machine.

- **Supported:** `sample_euler`, `sample_res_multistep`, `sample_res_multistep_cfg_pp`.
- **Deliberate fallbacks to native:** ancestral samplers (injected noise breaks the smooth trajectory the
  forecaster fits) and multi-GPU parallel sampling. RES also **keeps its last three solver steps native**, a
  floor that overrides a smaller `tail_actual_steps`.
- **Knobs:** `blend_weight` 0.5, `degree` 4, `ridge_lambda` 0.1, `window_size` 2.0, `flex_window` 0.75,
  `warmup_steps` 5, `tail_actual_steps` 1, `max_history` 8, `debug`, optional `history_storage` =
  `system_ram` (default) or `vram`. VRAM history measured at **~2.2 GiB more peak** for a small, variable
  timing gain, so it is an option for spare VRAM, not a guaranteed win.
- **The version trap.** It pins to ComfyUI a ComfyUI build newer than the v0.30.0 release. Release **v0.30.0 was
  tagged the same day at 03:48 UTC, about 17 hours earlier, and does not contain it** (a commit comparison puts
  the release two commits behind). As of 2026-08-06 no tagged release carries the API, so the pack needs a
  master build. "Update to 0.30.0 or newer" is the advice going around and it leaves you on a build that fails.
  The node validates the contract at apply time and errors loudly rather than drifting.
- **Author's quality note:** fast action can follow a different trajectory, and fast-moving or briefly visible
  detail can degrade. Qualitative, varies with prompt, motion, sampler, resolution and references.

## Latent upscaler: a real two-pass at higher resolution

`Tr1dae/ComfyUI-MiniMaxH3_LatentUpscaler` (no licence file). Node **`MiniMaxH3LatentUpscaleCombined`**, category
`latent/minimax_h3`. It exists because stock `LatentUpscaleBy` and `AddNoise` **break on H3's packed
`NestedTensor` latent**, which carries video `[B,24,T,H/16,W/16]` and audio `[B,32,2,T_audio]` together. This is
interpolation plus correct re-noising of that structure, not a learned upscaler.

**Wiring.** First split the schedule: one `BasicScheduler` into a **`SplitSigmas`**, HIGH half to pass 1, LOW
half to both the Combined node and pass 2. Nothing else produces the "high" and "low" sets this recipe needs.
Then `SamplerCustomAdvanced` #1 runs the high half at low resolution, take its **`denoised_output`** (not the
plain output), feed the Combined node with the same conditioning as pass 1 plus `RandomNoise`, the LOW sigmas
and the model, build a **new `BasicGuider` from its returned `positive` / `negative`**, then
`SamplerCustomAdvanced` #2 with **DisableNoise**, the low sigmas and the Combined latent.

- **`audio_denoise` defaults to 1.0**, a full audio re-noise at `sigmas[0]`. `0` locks pass-1 audio; the author
  recommends **0.25 to 0.5**. If audio garbles above 0, **run more of the schedule in pass 1, because audio
  settles late**. Poor results at defaults are the expected behaviour of that default, not a broken node. **Inferred, not tested
  here:** that this is the cause of the poor community results is the most likely reading, not a measurement.
- **Why the conditioning outputs matter:** `minimax_refs` carry per-reference `latent_h` / `latent_w`. Grow the
  canvas 2x and references sized for the old canvas sit at the wrong relative scale and RoPE row layout, which is
  the classic identity warp. The node rescales reference latents and metadata together, so the guider must be
  rebuilt from its outputs.
- **Constraint:** MiniMax's DiT patch size is `(1, 2, 2)` and the conditioning patchify does not pad, so upscaled
  **height and width must stay even**. Avoid forced cache-empty or model-unload nodes between the two passes,
  especially with `--disable-dynamic-vram` plus a quantized H3 and SageAttention.

## Where to look for what is new

`github.com/wildminder/awesome-minimax-H3` is a maintained index of checkpoints, LoRAs, quants, VAE splits,
custom node packs and guides, updated daily during the current burst. Community workflow collections:
`reverentelusarca/minimax-h3-comfyui-workflows` on HuggingFace. Prefer these over chasing individual posts,
but verify any node or file name against its own repository before wiring it.

## Community performance reports (anecdote, not measured here)

- RTX 4090 Laptop, 16 GB VRAM + 32 GB RAM: 960x540, 5 s, 20 steps, pruned INT8 + NVFP4, **~182 s**.
- RTX 4080: 608x352, ~5.2 s of video, **~157 s**, peak VRAM **~9.5 GiB** with offload plus pruned INT8.
- RTX 5090 + 96 GB RAM running `ref2va_pruned_int8_convrot` with SageAttention for reference-to-video.
- Repeated reports that **20 steps can drop to 15** with little visible loss.
- **RTX 5090 + 64 GB RAM: 2 megapixels, 7 s of video, 20 steps, i2v on the FULL model and FULL encoder, the
  stock template graph with no accelerators: ~35 minutes.** A second user on the same thread reported ~23
  minutes. Both figures are the price of refusing every optimisation on this page at once, and they are the
  useful counterweight to the ~182 s laptop figure above, which is a small frame at low resolution on pruned
  INT8. Field reports, 2026-08-11; not measured here.

Low VRAM peaks depend on offload settings that trade speed for memory; none of this was measured here.

## Content behaviour

The safety guardrails described on the model card are part of the **hosted** pipeline (automated moderation of
submitted material and enhanced prompts). The open weights carry no such filter, and anatomical fidelity holds
in the image and reference paths. The licence's acceptable-use terms still govern what you generate; MiniMax
claims no rights over outputs and places responsibility on the user.

## 2026-10-30 定谳:带音频出产标准 = 28 步纯净 bf16(全档位横扫结论)

用户终裁「这版音频最好…没有什么杂音」——**凡要片内原生音频的出片,一律以此为准**:

- **标准配置**:UNET=`minimax_h3_fl2va_pruned_bf16` + BasicScheduler `simple/steps=28/denoise=1` + KSamplerSelect `res_multistep` + BasicGuider(CFG-1)+ RandomNoise(seed 固定可比);**禁挂任何加速件**(turbo LoRA/SolAttnPatch/T8 块缓存/SplitSigmas 蒸馏配线全摘)。图样=`MYStudio/apps/output/pipeline-full-run/trial-mac-bf16/trial-009-s28-api.json`(21 节点)。
- **死判档位**(音频头受害,两次实证):fastvideo int8+8步蒸馏=非中文怪腔;lightx2v turbo 4stepLoRA@8步=用户判「根本不行」。步数蒸馏砍采样进度=饿死音频头(SKILL「audio settles late」实锤)。
- 20 步版已可听(词句全对含尾句)但自然度差一档;28 步=杂音清零。耗时参考:Mac M4 Max 608x352 约 2.2s/帧(9.4s 镜 2244s)。
- 机器旁证口径:whisper-small(zh)对烂音频有「脑补归一」倾向,**不能**当音频质量区分器;字级时间轴(词句完整性)可用。台账:`MYStudio/.trellis/tasks/10-30-ch1-batch-closeout/research/h3-native-audio-path-1030.md`。

### 平台验证范围(2026-10-30 钉死;用户将换卡,换卡后须按下表复验)

| 平台 | 硬件 | 已验结论 |
|---|---|---|
| **Mac(MPS)** | Apple M4 Max 40核 Metal4,128GB 统一内存 | **28步纯净bf16=音频标准在此平台验定**(009 镜三档 A/B:8步蒸馏❌→20步⭕→28步✅);耗时 2244s/9.4s镜(≈2.4s/帧@608x352);20步=1576s 可听但差一档 |
| **Win(CUDA)** | **NVIDIA RTX 4060 Ti 8GB**,driver 610.88 | **只验过死判档**:fastvideo int8+8步蒸馏(音频非中文怪腔,19镜全量+机检15/15)与 h3_edition 草稿档(兄弟产线同病)。**28步标准未在 Win 验**——现状 8GB VRAM 装 bf16(40GB)物理不可行 |
| **Win(RTX PRO 4000 Blackwell 24G)**,driver 596.71 | **1101 实弹已验**:①QAD 8步 R2V 首发片 success 419s(NVFP4 内核+TE reference-vision 一炮通,fl2va 仓 nvfp4_awq 服务 ReferenceToVideo 成立);②bf16 28步 009@seed42 **350s**(40G 走 offload,较 Mac M4Max 2244s **快 6.4×**,出产标准档 Win 承接成立);双臂产物 608x352/226帧/aac32k 与 Mac 标准件同时长。**音频听感终裁候用户亲耳**(产物 apps/output/rtx4000-qad-verify-1031/) |

台账全档:`MYStudio/.trellis/tasks/10-30-ch1-batch-closeout/research/h3-native-audio-path-1030.md`(含各试验耗时/产物路径)。

## 2026-10-30 增补:Sol-VAE(蒸馏快解码器)定位与采用条件

- **是什么**:Efficient-Large-Model(SolAttn 同门)HF 仓库 `Sol-H3-VAE` — 24 层非因果解码器(1.62B)蒸馏自官方 36 层视频 VAE 解码器;PSNR 45.4dB(近无损但非恒等);**音频解码器不动**(音频标准安全)。
- **不是 drop-in**:不能直接 VAELoader 加载 — 需 Python 封装/自定义节点(NVIDIA Sana 仓 sol-engine 分支 `Sol-H3-ComfyUI` 集成);依赖 **PyTorch CUDA 13 + Triton + FlashAttention-4 + QuACK**(RTX 5090/SM120 实测;Ada 卡内核疑不兼容,有 engine="ref" 慢速回退);VRAM:720p 5s 片 ~24GiB、2K ~48GiB、首解 ~25s 编译。
- **本产线采用条件定谳**:Mac(MPS)= **无缘**(纯 CUDA);Win 4060Ti 8G = **无缘**(VRAM+内核双卡死);**RTX Pro 4000(Blackwell 24G)换卡后=候选** — 但 608x352 短片 VRAM 需求远低于 720p 口径,可行。**序位:换卡复验清单第②步(标准 28 步过验)之后**,同 seed A/B 试:解码耗时+画质对比;过则 Win 产线解码段提速,败则留档。
- 另线:ComfyUI 官方博客原生 H3 VAE 优化(编码 2.2x/解码 1.4-2.7x,核心代码级)= 引擎升级附带收益,与 Sol-VAE 二选一或叠加,候换卡后引擎维护窗统一评。

## 2026-10-31 增补:FastH3 QAD NVFP4(RTX Pro 4000 Blackwell 线)

**1101 用户终裁:QAD 线清退**(实弹两发 419s/414s 均慢于 bf16 350s+社区口碑动作/音频保真受损;模型件已卸,产线件已退役,本节留作知识档)。

- **是什么**:FastVideo 的 QAD(Quantization-Aware Distillation,量化感知蒸馏)+ NVFP4 量化单文件 Comfy 版
  `fasth3_omniref_qad_nvfp4_comfy.safetensors`(13,773,998,700B,sha256 `bf25ee58df65b4df…`,1030 役已落 Windows
  E: 盘三方对账毕)。**NVFP4 加速需 Blackwell 硬件**(RTX Pro 4000 ✓);其它架构官方口径用 BF16/FP8 件。
  **只有 omniref(R2V 参考线)有 Comfy 单文件版**——fl2va(t2v/i2v 主线)的 QAD-v2 仅 Diffusers 格式,Comfy 用不了;
  产线 I2V 主形态不走 QAD(勿找 fl2va QAD 件,不存在)。
- **官方口径**(FastH3-Omni-NVFP4-QAD-Comfy README+VALIDATION,魔搭镜像 1031 实拉):8 步/Euler/simple/
  guidance 1.0/**video shift 12.0/audio shift 3.0**(与 fl2va 8step-v2 的 [10,3] 不同!)/`MiniMaxH3ReferenceToVideo`
  节点/参考标签 `<Picture N>`/`<Video N>`/`<Audio N>`;验证环境=ComfyUI b1a247c9+comfy-kitchen 0.2.39+PyTorch 2.9
  nv25.09+CUDA 13+GB200(832x480/124 帧)。**VSA/BlockSparseAttention 不挂**——VSA 是 fl2va 8step-v2 专用训练口径,
  QAD 官方未提及;注意力走 pytorch(NVFP4 加速在权重内核层)。
- **TE 疑点(实弹裁决)**:QAD README 要求 TE 带 **reference-vision 支持**,配套仓 `FastVideo/FastH3-OmniRef-Comfy`
  (HF,169GB,魔搭无镜像)。现用 Q2=`qwen3vl_32b_minimax_h3_nvfp4_awq`(fl2va 仓/Comfy-Org 同名件,Win 在位)与原生
  ref2va 线共用一套 TE 是 Comfy-Org 官方设计,大概率同件可用——**未实弹证实**,败则从 OmniRef-Comfy 仓补 TE(HF 通路)。
- **本仓接入(1031 rtx-pro-4000 换卡役)**:repo 真源 `2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-r2v.json`
  (30 节点,母体=34 节点 Mac R2V 骨架四删 3/17/43/48)+ 前端模板对 `fasth3-ref-shot-template{,.api}.json` +
  recipe `my-fasth3-r2v-30`(unverified)+ 组装器 `buildShotH3RefApiWorkflow`(六段式 buildShotH3RefPrompt,分镜帧恒占
  Picture 1,角色/场景卡 refs 注入 110-113)+ 契约测试 `test_fasth3_qad_workflow_contract.py`(7 用例)。生成器
  `apps/build/scripts/fasth3_qad_workflows_1031.py`(幂等);三对齐表 Q1-Q4 在生成器头注。
- **音频风险(未验)**:QAD=蒸馏(8步)+NVFP4 双加速。官方 VALIDATION 只对比 NVFP4 vs BF16 同 QAD 母版(audio corr
  仅 0.33/0.45=量化本身对音频扰动不小),绝对音质无任何数据。按 1030 定谳(步数蒸馏饿死音频头),**QAD 定位=快速档/
  参考图特化,禁以 QAD 件出产带音频成片**;出产音频标准仍=28 步纯净 bf16(Mac 验定,Win 复验清单候)。
- **Win 全承接缺口件(候令下载)**:`minimax_h3_fl2va_pruned_bf16`(40.23G,魔搭 sha256 `a32572fb…`)+ 
  `minimax_h3_video_vae_fp16`(5.2G)——28 步出产标准档 DiT/VAE,Win 落位后音频标准才有 Win 着落;E: 余量足(286G)。

## 2026-11-01 用户裁定:视频产线机器分工

**「不再选择 Mac 作为视频生成的机器」— Win RTX Pro 4000 = 唯一视频生成产线机**(28步标准 425s/9.4s镜,19镜≈2.2h)。Mac 退位视频线(试验引擎 17001 已停,视频模型留盘但非产线);Mac 侧车图像线不受此裁定影响。28步纯净bf16 标准配置不变(机器无关),标准图在任务 rescued/ 直用。此前「标准仅 Mac 验定」的平台范围声明就此作废 — Pro4000 机检三门已过(字级五段对齐+尾句在),用户以本裁定终裁采信。
