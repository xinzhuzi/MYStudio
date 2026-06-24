<div align="center">

<img src="../apps/frontend/assets/brand/manying-studio-icon.png" alt="MYStudio" width="140" height="140" />

# MYStudio · 漫影工作室

**A local-first AI workbench for animated dramas and short films**

From novel to final cut — scripts, storyboards, assets, voice-over, and editing in one traceable workflow.

<p>
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-React%20%2B%20TypeScript-47848F.svg" alt="Electron" />
  <img src="https://img.shields.io/badge/AI-MLX%20%7C%20Qwen%20%7C%20SenseVoice-ff6f00.svg" alt="AI" />
</p>

[简体中文](../README.md) · [文档中心](./README.md) · [Commercial License](../COMMERCIAL_LICENSE.md)

</div>

---

## Overview

MYStudio is a desktop production tool for AI-driven animated series, short dramas, and novel-to-film adaptation. It brings long-text adaptation, screenplay editing, character and scene assets, storyboard production, video candidate generation, local editing/compositing, and project configuration together into a single, traceable workflow.

The project emphasizes a local-first approach with creator control: assets, project data, and generation records are stored on the user's machine first; AI output enters the project as drafts, candidates, and editable data rather than overwriting final content directly; local video compositing is done via FFmpeg, making it easy to quickly produce previewable, reviewable, and re-editable clips and final cuts on the desktop.

### Core Positioning

- A unified workbench for novel adaptation, AI animated drama, short-drama storyboarding, and local final cuts.
- A structured workflow that carries the full production process from text to video.
- Project-level storage for source text, scripts, storyboards, assets, candidate videos, and configuration.
- Local FFmpeg support for turning image/video assets into candidate clips and stitching full episodes.
- A configuration center for managing models, provider capabilities, and per-task model bindings.

### Production Pipeline

The core pipeline is:

```text
Novel Import -> Script Planning -> Asset Extraction -> Production Generation -> Storyboard Table -> Editing Workbench
```

The pipeline supports phased progress: you can stop at scripts and storyboards, or continue to bind assets, generate candidate clips, and produce a full video via local compositing. Each stage keeps a manual revision entry point, so creators retain control when AI output quality is unstable.

### Architecture

- Desktop app: runs on Electron, suited for managing local assets, calling native capabilities, and exporting files.
- Frontend workbench: built with React and TypeScript.
- State management: Zustand manages project workflow, assets, storyboards, candidates, and configuration state.
- File-based storage: aimed at personal creative projects, reducing database deployment and backend maintenance cost.
- Asset library storage: production assets use a separate SQLite-backed library under `<storageBasePath>/assets`, while project JSON data stays under `<storageBasePath>/projects`.
- Local compositing: the Electron main process invokes FFmpeg for candidate clip rendering, subtitle burn-in, and stitched output.

### Design Goals

- Maintain clear reference relationships among novels, scripts, storyboards, assets, and video candidates.
- Make AI output reviewable, revertible, and replaceable rather than a one-shot black box.
- Progressively structure the characters, scenes, voices, subtitles, and shot states needed for short-drama production.
- Let casual users complete a final cut by following the workflow, while advanced users dive into finer storyboard, editing, and configuration steps.
- Keep current project data intact when later extending to TTS, subtitle styling, multi-track export, and Agent/Skill orchestration.

## Built-in Art Styles

**60 built-in** art styles covering 2D animation, 3D rendering, stop-motion, and live-action imagery — applied with one click during storyboard production.

<table>
  <tr>
    <td align="center" width="25%"><img src="../apps/frontend/assets/studio-manuals/art_skills/2d_ghibli/images/1.png" width="180" /><br/><sub><b>2D Hand-drawn</b></sub></td>
    <td align="center" width="25%"><img src="../apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/images/style_ref.png" width="180" /><br/><sub><b>Ink Guofeng</b></sub></td>
    <td align="center" width="25%"><img src="../apps/frontend/assets/studio-manuals/art_skills/3D_clay_stopmotion/images/1.png" width="180" /><br/><sub><b>Clay Stop-motion</b></sub></td>
    <td align="center" width="25%"><img src="../apps/frontend/assets/studio-manuals/art_skills/real_wuxia/images/1.png" width="180" /><br/><sub><b>Live-action Wuxia</b></sub></td>
  </tr>
</table>

👉 [Browse all 60 art styles →](./art-styles.en.md)

## Entry Points

After opening a project, open `Workflow` on the left:

1. `Novel Import`: import `.txt/.md` files or paste the source text.
2. `Script Planning`: generate the story skeleton, adaptation strategy, script draft, and review report.
3. `Script Asset Management`: extract characters, scenes, and props from scripts and match them with the asset library.
4. `Production Generation`: run director planning and fill missing character, scene, and prop images.
5. `Storyboard Table`: generate storyboard rows and maintain duration, dialogue, and visual assets.
6. `Editing Workbench`: render candidate clips with local FFmpeg and stitch selected clips into a final cut.

## Current Documentation Map

Most detailed guides are currently maintained in Chinese. Use these entry points for the current product surface:

| Guide | Scope |
|---|---|
| [Documentation Center](./README.md) | Full Chinese docs index |
| [App Shell Operations](./APP_SHELL_OPERATIONS.md) | Chinese guide for sidebar collapse, project header, back button, episode breadcrumb, and save status |
| [Navigation](./NAVIGATION_GUIDE.md) | Main navigation, settings tabs, workflow tabs, and internal compatibility workspaces |
| [Skills Editor Operations](./SKILLS_EDITOR_OPERATIONS.md) | Chinese guide for skill editor buttons, file states, create/delete/restore behavior |
| [Project Dashboard](./PROJECT_DASHBOARD_GUIDE.md) | Create, open, duplicate, rename, and delete projects |
| [Project Dashboard Operations](./PROJECT_DASHBOARD_OPERATIONS.md) | Chinese guide for sidebar toggle, selection mode, inline create, card menu, dialogs, and batch delete |
| [Project Overview](./OVERVIEW_PANEL_GUIDE.md) | Story core, worldbuilding, production settings, and episode list |
| [Project Overview Operations](./OVERVIEW_PANEL_OPERATIONS.md) | Chinese guide for workflow cards, inline editing, episode catalog, and right-side metadata summaries |
| [Workflow Guide](./WORKFLOW_GUIDE.md) | Novel import, script planning, asset generation, storyboard, and editing workflow |
| [Workflow Stage Operations](./WORKFLOW_STAGE_OPERATIONS.md) | Detailed Chinese reference for workflow stage buttons, status, dialogs, and data flow |
| [Novel Import and Script Planning Operations](./WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md) | Chinese reference for manual selection, chapter import, event analysis, staged script generation, review, and repair |
| [Script Asset and Generation Operations](./WORKFLOW_ASSET_GENERATION_OPERATIONS.md) | Chinese reference for script asset extraction, asset matching, prompt polishing, missing asset generation, and role voice entry points |
| [Storyboard and Editing Operations](./WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md) | Chinese reference for material binding, storyboard fields, AI storyboard table protocol, track grouping, local rendering, and final stitching |
| [Assist Workbench Operations](./ASSIST_WORKBENCH_OPERATIONS.md) | Chinese guide for image/video/cinema/TTS assist workbench controls and history |
| [Assist Workbench Parameter Reference](./ASSIST_WORKBENCH_PARAMETER_REFERENCE.md) | Chinese reference for image/video/Veo upload/cinema/TTS assist workbench fields |
| [Media Outputs Operations](./MEDIA_OUTPUTS_OPERATIONS.md) | Chinese guide for media upload, folders, context menus, export, and director shortcuts |
| [Export Operations](./EXPORT_OPERATIONS.md) | Chinese guide for export source selection, sequence strip, progress display, disabled states, and secondary cards |
| [Visual Style Management](./VISUAL_STYLE_MANAGEMENT.md) | Default styles, custom styles, visual manual editing, and AI style-token extraction |
| [Visual Manual Editor Operations](./VISUAL_MANUAL_EDITOR_OPERATIONS.md) | Chinese guide for visual manual Markdown modules, reference images, directory access, preview, and save behavior |
| [Legacy Script Workspace](./LEGACY_SCRIPT_WORKSPACE_GUIDE.md) | Internal three-column script editor, AI calibration, trailer shot selection, and compatibility jumps |
| [Trailer Storyboard Reuse Reference](./TRAILER_STORYBOARD_REUSE_REFERENCE.md) | Chinese reference for trailer shot selection, Shot-to-director-scene reuse, S-Class trailer generation, and clearing behavior |
| [Character Generation and Wardrobe](./CHARACTER_GENERATION_GUIDE.md) | Internal character generation, character sheets, AI calibration data, and outfit variations |
| [Advanced Director Tools](./ADVANCED_DIRECTOR_TOOLS.md) | Internal director workspace, S-level group generation, angle switching, and quad-grid variants |
| [Director Shot Card Reference](./DIRECTOR_SHOT_CARD_REFERENCE.md) | Chinese reference for director shot card fields, first/end frames, references, prompts, video generation, and audio controls |
| [Director Voiceover Reference](./DIRECTOR_VOICEOVER_REFERENCE.md) | Chinese reference for shot voice-over lines, voice profiles, single-shot generation, and batch retry/missing generation |
| [Angle and Quad Grid Operations](./ANGLE_AND_QUAD_GRID_OPERATIONS.md) | Chinese guide for start/end-frame angle switching, quad-grid generation, result application, copying to other shots, and failures |
| [S-Class Group Video Operations](./SCLASS_GROUP_VIDEO_OPERATIONS.md) | Chinese guide for Seedance 2.0 grouped generation, single-shot generation, @references, AI calibration, extension, and editing |
| [Scene Multi-view and Orthographic Views](./SCENE_MULTIVIEW_GUIDE.md) | Scene single-image, contact-sheet, orthographic-view, splitting, and batch generation workflows |
| [Asset Library](./ASSET_LIBRARY_GUIDE.md) | Roles, scenes, props, audio assets, styles, and storage |
| [Asset Import and Management](./ASSET_IMPORT_AND_MANAGEMENT.md) | Add roles/scenes/props, batch manage assets, edit detail data, manage multiple images, and transcribe audio samples |
| [Asset Detail Operations](./ASSET_DETAIL_OPERATIONS.md) | Chinese guide for asset preview, image actions, prompt polish, one-click generation, audio transcription, role voices, and deletion |
| [Props Library Operations](./PROPS_LIBRARY_OPERATIONS.md) | Chinese guide for local prop folders, folder create/rename/delete, and prop move/rename/delete behavior |
| [Voice Assignment](./ASSET_AUDIO_ASSIGNMENT.md) | Assign asset audio samples to roles for local voice cloning |
| [Role Audio Assignment Reference](./ROLE_AUDIO_ASSIGNMENT_REFERENCE.md) | Chinese reference for role voice dialog fields, automatic matching rules, AI semantic matching, preview playback, and transcription failures |
| [Settings Panel Operations](./SETTINGS_PANEL_OPERATIONS.md) | Chinese guide for settings tabs, desktop-only controls, storage/update/development/support actions |
| [Python and Local TTS](./PYTHON_TTS_SETUP.md) | Manual Python 3.12 setup, dependency installation, and TTS backend startup |
| [API Manager Operations](./API_MANAGER_OPERATIONS.md) | Chinese guide for providers, model sync/test, thinking mode, feature mapping, and Agent bindings |
| [API Provider and Model Test Reference](./API_PROVIDER_MODEL_TEST_REFERENCE.md) | Chinese reference for provider add/edit fields, model sync behavior, model test protocols, and errors |
| [TTS Configuration](./TTS_CONFIG_GUIDE.md) | Local TTS backend status, model cache, model downloads, and voice profiles |
| [TTS Panel Operations](./TTS_PANEL_OPERATIONS.md) | Chinese guide for local TTS status, model folders, download tasks, model detail dialog, and voice profiles |
| [Storage and Migration](./STORAGE_AND_DATA.md) | Storage base path, import/export, recovery, and legacy migration |
| [App Updates](./APP_UPDATE_GUIDE.md) | Manual update checks, startup checks, ignored versions, and manifest fields |
| [Packaging and Smoke Testing](./PACKAGING_AND_SMOKE_TESTING.md) | macOS build, no-backup install, app hash check, and desktop smoke |
| [Troubleshooting](./TROUBLESHOOTING.md) | White screen, Python, TTS, API, image host, storage, and build issues |
| [Documentation Coverage Audit](./DOCS_COVERAGE_AUDIT.md) | Chinese maintenance map from current UI/source entry points to user docs and remaining priorities |

## License

This project uses a dual-licensing model:

- The community edition is released under the [GNU Affero General Public License v3.0](../LICENSE) (AGPL-3.0) by default.
- If you modify or distribute this project, or provide a service to network users based on it, you must comply with AGPL-3.0 requirements such as open-sourcing and retaining copyright notices.
- If you want to integrate this project into a closed-source commercial product, closed-source SaaS, or a commercial scenario where modifications are not disclosed, you need a commercial license.

For commercial licensing, closed-source use, and enterprise support, see [COMMERCIAL_LICENSE.md](../COMMERCIAL_LICENSE.md).

## Minimum System Requirements

The project's AI features (TTS voice cloning, speech recognition, image/video generation, etc.) rely on local model inference and **require a dedicated GPU**. Integrated graphics cannot meet the compute requirements.

### macOS (Apple Silicon)

| Item | Minimum | Recommended |
|------|---------|-------------|
| Chip | **Apple Silicon M1** (built-in GPU) | M2 Pro / M3 or higher |
| OS | macOS 13 Ventura | macOS 14 Sonoma+ |
| Unified Memory | 16 GB | 32 GB+ |
| Disk | 20 GB free | 50 GB+ SSD |

> ⚠️ **Intel-based Macs are not supported** (no MLX GPU acceleration).

### Windows

| Item | Minimum | Recommended |
|------|---------|-------------|
| OS | Windows 10 64-bit | Windows 11 |
| GPU | **NVIDIA dedicated GPU, 8 GB VRAM** (CUDA-capable) | NVIDIA RTX series, 16 GB+ VRAM |
| RAM | 16 GB | 32 GB+ |
| Disk | 20 GB free | 50 GB+ SSD |

> ⚠️ **An NVIDIA dedicated GPU is required.** Integrated graphics (Intel UHD / AMD iGPU) and non-CUDA GPUs cannot run local AI inference.

### Common

- Node.js >= 18 (latest LTS recommended)
- Python 3.12 (configured on demand from the desktop app before using local TTS)

## Development Setup

### Prerequisites

- Node.js >= 18
- macOS (Apple Silicon) / Windows 10+ (NVIDIA GPU) / Linux x86_64

### One-Click Setup

**macOS / Linux:**

```bash
git clone https://github.com/xinzhuzi/MYStudio.git
cd MYStudio
bash apps/build/setup.sh
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/xinzhuzi/MYStudio.git
cd MYStudio
powershell -ExecutionPolicy Bypass -File apps\build\setup-win.ps1
```

The script automatically:
1. Installs Node.js dependencies
2. Keeps the Python runtime out of the installer and backend source directory
3. Lets users manually configure Python later from `Settings -> Python Configuration`

Python 3.12 and TTS dependencies are configured on demand from the desktop app. The app does not download Python or start the local TTS backend during startup. See [Python and local TTS setup](./PYTHON_TTS_SETUP.md) for the current Chinese guide.

### Run

```bash
cd apps && npm run dev
```

### Build

```bash
# macOS
cd apps && npm run build:mac
# Windows
cd apps && npm run build:win
```
