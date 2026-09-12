# Your machine

**This file is yours, not the kit's.** It holds the facts about THIS install: where ComfyUI lives, what GPUs
are in the box, how to start the server when it is down. Pre-filled on 2026-09-04 from the local install;
values marked `<todo>` were not verifiable at install time — confirm them on the first real task
(`GET /system_stats`, `GET /object_info`) and rewrite.

- **ComfyUI**: MYStudio-managed engine (app 漫影工作室; no longer Comfy Desktop — that install at
  `/Users/zhengbingjin/Project/ComfyUI` was retired 2026-09-10, kept on disk read-only as archive).
  Home = **`/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui`** (isolated layout:
  `ComfyUI/` engine source v0.35.0 torch 2.14, `venv/` private runtime, `models/`, `workflows/` legacy,
  `manifest.json` config). Engine source & custom_nodes live at `<home>/ComfyUI` — ComfyUI only loads
  custom_nodes from INSIDE the source dir in this layout (manifest.py 09-08 fix), do not drop plugins at
  `<home>/custom_nodes`. API at **`http://127.0.0.1:17001`** (port from manifest.json; engine is spawned
  on demand by `apps/backend/engines/comfyui/engine_manager.py` and does NOT listen while idle — verify
  with `lsof -nP -iTCP:17001 -sTCP:LISTEN`). Launch args from manifest: gpu-only + reserve-vram 16 +
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
  - **Video line = MiniMax H3**: BF16 FL2VA DiT + Heretic 32B Q4_K_M GGUF TE + mmproj (same files as the
    retired install) + turbo LoRAs (4step v1.1 + 8step v1.0). Fixed routes: 480P direct (daily),
    960P direct (final), SeedVR2 for 2K upscale (slow — use selectively). Music3 line also present.
- **GUI workflows folder**: `<home>/ComfyUI/user/default/workflows/漫影/` — everything lives under the
  `漫影/` group with domain-first nesting (2026-09-10 reorg): `1_图片/` (K2图像 with 1_文生图…6_修复超分,
  分镜 with 1_总览 chapter overviews + 2_单镜图 per-shot migrated flows), `2_视频/` (H3视频: 1_漫影自研
  empty home for in-house workflows, 2_固定线 … 6_社区模板), `3_声音/` (音乐), `4_参考_提示词工程/`.
  New app-generated workflows always land under `漫影/` in the matching domain.
- **Launch command**: managed by MYStudio — start/restart via the app (engine_manager spawns
  `<home>/venv/bin/python <home>/ComfyUI/main.py --listen 127.0.0.1 --port 17001 ...`). A verified
  headless manual relaunch recipe does NOT exist for this engine yet — do not reuse the retired
  Desktop command line. If the engine dies, prefer asking the owner to restart it from the app.
- **Restart discipline**: batch custom-node changes, restart ONCE; engine restarts go through MYStudio.
  After installing new nodes the engine must restart before registration (same as before).
- **Known local quirks**:
  - Apple-Silicon attention patch (SolAttn-MPS) is applied; measured 1.435x end-to-end on H3.
  - Uncensored TE swap is deliberate (image line). Prompting follows long natural-language flows, not tag stacks.
  - Network: PyPI via Tsinghua mirror (large wheels break ≥20MB — use curl from Aliyun with resume);
    HuggingFace via hf-mirror.com (HF_ENDPOINT set; Clash needs no_proxy).
  - One model per production line (image=K2, video=H3) — do not introduce a second model into a line.
