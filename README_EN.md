<p align="center">
  <img src="apps/frontend/assets/brand/manying-studio-icon.png" width="120" alt="MYStudio Logo" />
</p>

<h1 align="center">MYStudio · 漫影工作室</h1>

<p align="center">
  <strong>Local-first AI animated drama and short-film production workbench</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/zhengbingjin/MYStudio/releases"><img src="https://img.shields.io/github/v/release/zhengbingjin/MYStudio" alt="Release" /></a>
  <a href="https://github.com/zhengbingjin/MYStudio/stargazers"><img src="https://img.shields.io/github/stars/zhengbingjin/MYStudio" alt="Stars" /></a>
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

**MYStudio** is a local-first desktop production tool for AI animated dramas, short films, and novel-to-film adaptation. It keeps scripts, storyboards, assets, voice-over, video candidates, and local compositing in one traceable workflow.

> **Novel Import → Script Planning → Asset Extraction → Production Generation → Storyboard Table → Editing Workbench**

The current documentation is maintained under [docs/README.en.md](docs/README.en.md). This root English README is kept as a compatibility entry.

## Features

### Workflow Workbench
- Novel import for `.txt` / `.md` source text and chapter-level adaptation.
- Script planning for story skeletons, adaptation strategy, script drafts, and review output.
- Script asset management for extracting characters, scenes, and props from scripts.
- Production generation for director planning and missing character, scene, and prop images.
- Storyboard table for duration, dialogue, visual asset, and shot-level review.
- Editing workbench for local FFmpeg candidate rendering and final stitching.

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
- macOS Apple Silicon or Windows with a CUDA-capable NVIDIA GPU for local AI features

### Install & Run

```bash
# Clone the repository
git clone https://github.com/xinzhuzi/MYStudio.git
cd MYStudio

# Install dependencies and desktop setup helpers
bash apps/build/setup.sh

# Start development mode
cd apps
npm run dev
```

### Configure API Key

After launching, go to **Settings → API Management** and configure model services, model mappings, and Agent bindings. See the current documentation entry at [docs/README.en.md](docs/README.en.md).

Python 3.12 and local TTS dependencies are configured on demand from **Settings → Python Configuration**. The app does not download Python or start the local TTS backend during startup.

### Build

```bash
# macOS
cd apps && npm run build:mac

# Windows
cd apps && npm run build:win
```

## Architecture

| Layer | Technology |
|-------|-----------|
| Desktop Framework | Electron 30 |
| Frontend | React 18 + TypeScript |
| Build Tool | electron-vite (Vite 5) |
| State Management | Zustand 5 |
| UI Components | Radix UI + Tailwind CSS 4 |
| AI Core | `@opencut/ai-core` (prompt compilation, character bible, task polling) |

### Project Structure

```
manying-studio/
├── apps/
│   ├── build/             # Desktop build, setup, and smoke scripts
│   ├── backend/           # Local backend and TTS sidecar source
│   └── frontend/
│       ├── electron/      # Electron main process and preload bridge
│       ├── components/    # React UI components and panels
│       ├── stores/        # Zustand state stores
│       ├── lib/           # AI, TTS, storage, and workflow utilities
│       ├── config/        # Vite, Electron Builder, TypeScript, ESLint config
│       ├── assets/        # Brand, manuals, style references, images
│       └── types/         # Shared TypeScript types
├── docs/                  # User docs, setup guides, and fusion plans
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
- 🐙 GitHub: [https://github.com/zhengbingjin/MYStudio](https://github.com/zhengbingjin/MYStudio)

---

<p align="center">MYStudio · 漫影工作室</p>
