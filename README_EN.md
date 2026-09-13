<p align="center">
  <img src="apps/frontend/assets/brand/manying-studio-icon.png" width="120" alt="MYStudio Logo" />
</p>

<h1 align="center">MYStudio · 漫影工作室</h1>

<p align="center">
  <strong>Local-first AI animated drama and short-film production workbench</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/xinzhuzi/MYStudio/releases"><img src="https://img.shields.io/github/v/release/xinzhuzi/MYStudio" alt="Release" /></a>
  <a href="https://github.com/xinzhuzi/MYStudio/stargazers"><img src="https://img.shields.io/github/stars/xinzhuzi/MYStudio" alt="Stars" /></a>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="docs/README.en.md">Current English Docs</a> | <a href="docs/README.md">Docs Center</a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#license">License</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Overview

**MYStudio** is a local-first desktop production tool for AI animated dramas, short films, and novel-to-film adaptation. It keeps scripts, storyboards, assets, voice-over, video candidates, and local Remotion rendering in one traceable workflow. Local generation pipelines (Krea2 image, MiniMax H3 video, music) run on a managed ComfyUI engine inside the app, side by side with cloud AI providers.

> **Style & Director → Novel Import → Script Stage → Script Assets → Storyboard Video Generation (ComfyUI canvas) → Storyboard Panel → Video Workbench**

The current documentation is maintained under [docs/README.en.md](docs/README.en.md). This root English README is kept as a compatibility entry.

## Features

### Workflow Workbench
- Novel import for `.txt` / `.md` source text and chapter-level adaptation.
- Script planning for story skeletons, adaptation strategy, script drafts, and review output.
- Script asset management for extracting characters, scenes, and props from scripts.
- Production generation for director planning and missing character, scene, and prop images.
- Storyboard video generation on a ComfyUI node canvas (chapter stage chain + storyboard grid); per-shot images run on local pipelines (K2 image / H3 video) or cloud AI.
- Storyboard panel: a card grid over all shots for review, media binding, voice assignment, and one-click chapter video.
- Video workbench hosting a native Remotion Studio that renders shot candidates and chapter videos via `renderMedia`; FFmpeg/ffprobe serve only as shared tooling for media preparation and read-only QC.

### App Shell & Navigation
- Main navigation: Overview, MY Workflow, Skills, Assets, Local Models, Export, Outputs, Self-Media, plus Settings at the bottom.
- The Local Models page and the workflow canvas tabs switch to an immersive fullscreen layout with a floating orb as the single navigation hub.
- The Outputs page is an artifact center with two tabs: workflow artifacts (chapter tree) and the media library.

### Local Models Workspace (ComfyUI)
- The `Local Models` page (formerly `Assist`) is a fullscreen ComfyUI workspace hosting the managed engine's full frontend: a ComfyUI canvas for local production pipelines (K2 image, H3 video, music), a TTS voice booth, and a quick image-generation form (pick a checkpoint + prompt).
- Local models are managed centrally from `Settings -> Local Configuration -> ComfyUI Engine` (the Models tab is a live view of `comfyui/models`).
- The engine home (ComfyUI source, venv, models, workflow library) lives under the user-data directory and is installed/updated on demand — never bundled with the installer.
- The app ships a self-developed `manying_nodes` custom node package (prompt / reference / generated / shot / stage / cloud-image nodes), synced into the engine at runtime; ComfyUI itself is never patched — all customization goes through official extension points.
- Generated results flow into the media asset panel (imported = input, generated = output) and the media library.

### Asset Library
- Production assets include roles, scenes, props, audio, and compatible clip records.
- The asset library uses a separate SQLite-backed store under `<storageBasePath>/assets`.
- Audio assets can be assigned to roles as cloneable voice references for local TTS.
- Built-in and custom art styles are available from the asset page.

### Local TTS And Voice
- Python 3.12 and TTS dependencies are configured manually from `Settings -> Python Configuration`.
- The app does not download Python or start the local TTS backend during startup.
- Local TTS is exposed as the built-in `manying-local-tts` provider.
- The default TTS feature binding is `qwen-tts-1.7B`.

### Multi-Provider AI Configuration
- Model services manage provider names, Base URLs, API keys, and model lists.
- Model mappings bind text, image, video, TTS, and vision capabilities to models.
- Agent configuration binds workflow tasks such as universal AI, event analysis, script generation, and prompt polishing.
- Image host configuration supports video providers that require public image URLs.

## Quick Start

### Requirements

- **Node.js** >= 18
- **npm** >= 9
- Cloud AI mode (image/video/LLM via cloud APIs + local Remotion rendering) runs on any common desktop configuration.
- Local AI mode requires a local GPU: Apple Silicon on macOS (MLX-based capabilities such as local full-song generation and VLM review are Apple-Silicon-only; Music3 bf16 requires 48 GB+ unified memory), or an NVIDIA CUDA GPU on Windows for local TTS. The managed ComfyUI engine and local models are downloaded on demand — image-generation weights can reach tens of GB.

### Install & Run

```bash
# Clone the repository
git clone https://github.com/xinzhuzi/MYStudio.git
cd MYStudio

# Install dependencies and desktop setup helpers
bash apps/build/packaging/setup.sh

# Start development mode
cd apps
npm run dev
```

### Configure API Key

After launching, go to **Settings → Cloud AI（云端AI）** and configure model services, model mappings, and Agent bindings. See the current documentation entry at [docs/README.en.md](docs/README.en.md).

Python 3.12 and local TTS dependencies are configured on demand from **Settings → Local Configuration（本地配置）**. The app does not download Python or start the local TTS backend during startup. The managed ComfyUI engine is likewise installed on demand from **Settings → Local Configuration → ComfyUI Engine**; pipeline parameters and customization boundaries live in the [ComfyUI knowledge base](docs/comfyui-kb/参数速查.md).

### Build

```bash
# macOS
cd apps && npm run build:mac

# Windows
cd apps && npm run build:win
```

Run packaging commands from `apps/`. `npm run build:mac` goes through `build-mac.sh` and performs
fixed-bundle validation, packaging, overwrite installation, installed smoke, and app shutdown.
It reuses the verified fixed Remotion bundle instead of rebuilding it on every package. After
changing the Remotion version or composition, run `cd apps && npm run remotion:bundle` and
`cd apps && npm run remotion:versions` before the target packaging command. See [packaging,
installation, and smoke testing](docs/engineering/PACKAGING_AND_SMOKE_TESTING.md).

## Architecture

| Layer | Technology |
|-------|-----------|
| Desktop Framework | Electron 43 |
| Frontend | React 18 + TypeScript |
| Build Tool | electron-vite (Vite 5) |
| State Management | Zustand 5 |
| UI Components | Radix UI + Tailwind CSS 4 |
| AI Core | `apps/frontend/lib/ai/core/` (prompt compilation, character bible, task polling) |
| Local Generation | Managed ComfyUI engine + self-developed `manying_nodes` custom nodes (`apps/backend/engines/comfyui`) |

### Project Structure

```
MYStudio/
├── apps/
│   ├── build/             # Modular desktop build, smoke, Remotion bundle, and timeline tools
│   │   ├── packaging/     # Desktop packaging, install, and setup entrypoints
│   │   ├── smoke/         # Packaged, installed, and workflow smoke runners
│   │   ├── remotion/      # Remotion fixed-bundle build and version verification
│   │   ├── chapter_video/ # Chapter video build helpers
│   │   ├── scripts/       # Build-time scripts, audits, and request ledgers
│   │   ├── timeline/      # Direct timeline runner and Node-only config
│   │   └── shared/        # Build-time reports and shared fixtures
│   ├── backend/           # Local backend: TTS sidecar + engines/ model-engine layer (managed ComfyUI engine et al.)
│   └── frontend/
│       ├── electron/      # Electron main process and preload bridge
│       ├── components/    # React UI components and panels
│       ├── stores/        # Zustand state stores
│       ├── lib/           # AI, TTS, storage, and workflow utilities
│       ├── config/        # Vite, Electron Builder, TypeScript, ESLint config
│       ├── assets/        # Brand, manuals, style references, images
│       └── types/         # Shared TypeScript types
├── docs/                  # User docs, engineering guides, and the ComfyUI knowledge base (comfyui-kb)
└── README.md
```

## License

This project uses a **dual licensing** model:

### Open Source — AGPL-3.0

This project is open-sourced under the [GNU AGPL-3.0](LICENSE) license. You are free to use, modify, and distribute it, but any modified code must be open-sourced under the same license.

### Commercial Use

If you need closed-source usage or integration into commercial products, please contact us for a [Commercial License](COMMERCIAL_LICENSE.md).

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) for details.

## Contact

- 📧 Email: [1487842110@qq.com](mailto:1487842110@qq.com)
- 🐙 GitHub: [https://github.com/xinzhuzi/MYStudio](https://github.com/xinzhuzi/MYStudio)

---

<p align="center">MYStudio · 漫影工作室</p>
