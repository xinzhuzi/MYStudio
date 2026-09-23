# Your machine

**This file is yours, not the kit's.** It holds the facts about THIS install: where ComfyUI lives, what GPUs
are in the box, how to start the server when it is down. Pre-filled on 2026-09-04 from the local install;
values marked `<todo>` were not verifiable at install time — confirm them on the first real task
(`GET /system_stats`, `GET /object_info`) and rewrite.

- **ComfyUI**: MYStudio-managed engine (app 漫影工作室; no longer Comfy Desktop — that install at
  `~/Project/ComfyUI` was retired 2026-09-10, kept on disk read-only as archive).
  Home = **`~/Library/Application Support/漫影工作室/comfyui`** (isolated layout:
  `ComfyUI/` engine source v0.35.0 torch 2.14, `venv/` private runtime, `models/`, `workflows/` legacy,
  `manifest.json` config). Engine source & custom_nodes live at `<home>/ComfyUI` — ComfyUI only loads
  custom_nodes from INSIDE the source dir in this layout (manifest.py 09-08 fix), do not drop plugins at
  `<home>/custom_nodes`. API at **`http://127.0.0.1:17000`** (port from manifest.json; engine is spawned
  on demand by `apps/backend/engines/comfyui/engine_manager.py` and does NOT listen while idle — verify
  with `lsof -nP -iTCP:17000 -sTCP:LISTEN`). Launch args from manifest: gpu-only + reserve-vram 16 +
  pytorch-cross-attention (same discipline as the retired Desktop line). Check: `GET /system_stats` -> 200.
- **GPUs**: 1x Apple M4 Max, unified memory 128GB, device `mps`. No CUDA — CUDA-only speedups
  (SageAttention etc.) do not apply.
- **Models installed** (query live, never hardcode): `GET /object_info/UNETLoader`,
  `/object_info/CheckpointLoaderSimple`, `/object_info/CLIPLoader`, `/object_info/VAELoader`.
  Model root: `<home>/models` (manifest `modelsDir`; engine_manager writes `extra_model_paths.yaml`
  pointing there). Two production lines live here (verified on disk 2026-09-10):
  - **Image line = Krea 2 (K2)**: turbo bf16 DiT (`diffusion_models/`) + uncensored (Heretic) 4B TE
    (`text_encoders/qwen3-vl-4b-heretic`) + LoRAs under `loras/Krea2-NSFW`, `loras/Krea2-功能`.
    K2's VAE file is `qwen_image_vae` — it belongs to K2, do not treat as leftover.
    **09-24 退役,权重已删,恢复=外置盘(卷名=真名不入仓,完整路径见本地档案 ~/.zcode/mystudio-local/external-drive-path.txt)/AI/Krea2 按 manifest-retired-0923.jsonl
    从 models/ 下拷回,工作流 JSON 保留存档。**
  - **Video line = MiniMax H3**: BF16 FL2VA DiT + Heretic 32B Q4_K_M GGUF TE + mmproj (same files as the
    retired install) + turbo LoRAs (4step v1.1 + 8step v1.0). Fixed routes: 480P direct (daily),
    960P direct (final), SeedVR2 for 2K upscale (slow — use selectively). Music3 line also present.
- **GUI workflows folder**: `<home>/ComfyUI/user/default/workflows/漫影/` — everything lives under the
  `漫影/` group with domain-first nesting (2026-09-10 reorg): `1_图片/` (K2图像 with 1_文生图…6_修复超分,
  分镜 with 1_总览 chapter overviews + 2_单镜图 per-shot migrated flows), `2_视频/` (H3视频: 1_漫影自研
  empty home for in-house workflows, 2_固定线 … 6_社区模板), `3_声音/` (音乐), `4_参考_提示词工程/`.
  New app-generated workflows always land under `漫影/` in the matching domain.
- **Launch command**: managed by MYStudio — start/restart via the app (engine_manager spawns
  `<home>/venv/bin/python <home>/ComfyUI/main.py --listen 127.0.0.1 --port 17000 ...`). A verified
  headless manual relaunch recipe does NOT exist for this engine yet — do not reuse the retired
  Desktop command line. If the engine dies, prefer asking the owner to restart it from the app.
- **Restart discipline**: batch custom-node changes, restart ONCE; engine restarts go through MYStudio.
  After installing new nodes the engine must restart before registration (same as before).
- **Known local quirks**:
  - Apple-Silicon attention patch (SolAttn-MPS) is applied; measured 1.435x end-to-end on H3.
  - Uncensored TE swap is deliberate (image line). Prompting follows long natural-language flows, not tag stacks.
  - Network: PyPI via Tsinghua mirror (large wheels break ≥20MB — use curl from Aliyun with resume);
    HuggingFace via hf-mirror.com (HF_ENDPOINT set; Clash needs no_proxy).
  - Parallel image lines since 09-23 (user verdict): image = K2 **and** Qwen-Image-2.1 (Q2-1)
    share this engine queue-serially — ComfyUI's smart memory management swaps weights between
    runs, which does NOT violate the no-second-model-process rule; video = H3. Repo workflows:
    `1_图片/K2图像/` + `1_图片/Q2-1图像/` (qwen21-t2i / qwen21-edit, engine-openable canvas format).
  - (09-24) Q2-1 daojie i2i workflow `1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json` (4th Q2-1
    piece; generate-and-refine-are-one architecture — image input IS instruction editing, no
    denoise repaint): edit skeleton + nine-type assembly subgraph [40] (directive occupies ①
    layer) + LoRA speed slot bypassed by default (`models/loras/Qwen-Image-2.1-viggle-turbo-
    4step-lora-r64.safetensors` 339.8MB installed; when enabled set KSampler steps to 4); TE-Speed
    slot deliberately NOT in this piece (plugin absent = red node; R26.4 wiring round). Idempotent
    generator `apps/build/scripts/qi21_daojie_i2i_0924.py`; contract = TestI2IContract.
  - (09-23) Q2-1 line weights (bf16, MPS path — int8_convrot is CUDA-only, never on this Mac):
    `diffusion_models/qwen_image_2.1_bf16.safetensors` (14.23GB) + `text_encoders/qwen3vl_8b_bf16.safetensors`
    (17.53GB, CLIPLoader type=qwen_image) + `vae/qwen_image_2.1_vae_bf16.safetensors` (0.68GB) —
    zero file overlap with the K2 triple (Engineer-V1 ≠ qwen3vl_8b; HDR gen-1 VAE ≠ 2.1 RGBA VAE).
  - (09-23) T2I PE (prompt-enhancer) weight = ONE bf16 file `text_encoders/
    qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors` (~19GB, self-converted from the full bf16
    original via `apps/build/scripts/qwen21_pe_bf16_convert_0923.py`): the Comfy-Org int8_convrot
    PE loads fine but dies at the first matmul on MPS (`aten::_int_mm` has no MPS kernel).
  - (09-23) PE-I2I weight = `text_encoders/qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors`
    (18,819,722,392 B, 自转件 via `apps/build/scripts/qwen21_pe_i2i_bf16_convert_0923.py`),
    Edit 流 PE 用 (qwen21-edit [12],看图改写;语言随输入——中文进中文出,edit 系统提示词决策A)。
  - (09-21) Engine upgraded past the pre-fill: v0.37.0 now (subgraphs + hash-based workflow restore).
  - (09-21) **Subgraph groups MUST carry an `id` field each** (any increasing int): without id only
    `groups[0]` loads, the rest are silently dropped. Cost a full debug round on the 道劫 [90] matrix.
- (09-21) Repo workflows (`apps/backend/engines/comfyui/workflows/`) reach the engine through TWO
  copies that must be synced: repo file (truth) → app
  `/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/workflows/` (install seed).
  The engine-home userdata (`<home>/ComfyUI/user/default/workflows/`) stays ZERO workflow files BY
  CHARTER (`docs/comfyui-kb/工作流落位规范.md`, audit item 2 in
  `apps/build/scripts/workflow_placement_audit.py`) — never rsync repo copies into it. The native
  ComfyUI workflow browser reads ONLY that userdata area, so for the user the MY library opens via the
  漫影 app sidebar (repo: read-only merge through the sidecar `/comfy/workflows`), not via the
  engine's own browser. Pitfall (09-21 incident): after emptying userdata, a still-open ComfyUI
  window keeps its client-persisted tree (persistedWorkflows) AND the engine v2 API kept serving
  empty dir shells — both look like "workflows that can't be opened". Cure: page reload +
  `find <userdata>/workflows -mindepth 1 -type d -empty -delete`.
- (09-21) **Node-graph / node knowledge lives IN THIS SKILL DIR (flat layout, files are all here)** —
  user verdict "节点图/node 认知完全没有" was a LOADING failure, not a missing-files failure. Any
  node question: read `NODE_LIBRARY/_INDEX.md` first (per-category map: core/loaders/samplers/
  conditioning-1/2/latent/image-1/2/advanced/video/audio/…, 183 curated entries), the 547-node master
  catalog is `NODE_LIBRARY/_INVENTORY.md`, live I/O truth is ALWAYS `GET /object_info/<NodeType>`.
  Connection mechanics + dual JSON formats + subgraph JSON anatomy: SKILL.md §"Compose a NEW
  workflow" / §"Collapse a stage" — subgraph inner graph = `definitions.subgraphs[]`, exposed params =
  `properties.proxyWidgets`. Writing/modifying a custom node pack: `BUILDING_NODES.md` (widget order ==
  widgets_values order; combo validation rejects unknown values with HTTP 400; IS_CHANGED NaN trick).
  Knowledge baseline of these files = 2026-06-30 / ComfyUI 0.25.1 — this engine is v0.37.0, so newer
  nodes (FastH3, YuE2 900s, video concatenate, layered image compositing, Generic Loops, subgraph
  blueprints) exist beyond the docs; authoritative reference = docs.comfy.org built-in-nodes index
  (`https://docs.comfy.org/_llms/en/built-in-nodes/nodes.md`, 1059 pages, model/partner groups, has
  `/_llms/zh/` Chinese twin) + the `/changelog` page. Official reusable subgraph bricks:
  Comfy-Org/workflow_templates `blueprints/` (117 files); blueprint distribution mechanism = a
  `subgraphs/` folder inside any custom-node pack, surfaced via `/global_subgraphs` (docs.comfy.org/
  custom-nodes/subgraph_blueprints).
