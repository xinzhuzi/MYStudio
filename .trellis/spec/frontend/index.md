# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

These guidelines cover the React renderer, Zustand stores, shared TypeScript
contracts, and Electron main/preload boundary under `apps/frontend/`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Complete |
| [Component Guidelines](./component-guidelines.md) | Components, props, styling, accessibility | Complete |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks and async boundaries | Complete |
| [State Management](./state-management.md) | Zustand and project-scoped persistence | Complete |
| [Quality Guidelines](./quality-guidelines.md) | Static, unit, and smoke verification | Complete |
| [Type Safety](./type-safety.md) | Shared contracts and runtime validation | Complete |
| [Provider Integration](./provider-integration.md) | OpenAI-compatible model validation and GPT Image request contracts | Complete |
| [Workflow Auto-Video Smoke](./workflow-auto-video-smoke.md) | Real Daojie clone, one-click MP4, report, and safety contracts | Complete |
| [Editing Timeline Rendering](./timeline-rendering.md) | EditingProject compilation, typed IPC, FFmpeg execution, cancellation, and evidence | Complete |
| [Editing Workbench](./editing-workbench.md) | Four-zone editing UI, project-scoped draft actions, command controls, and typed rendering entry | Complete |
| [Editing Audio And Subtitles](./editing-audio-subtitles.md) | Audio commands, deterministic BGM ducking, subtitle exchange, and waveform preview | Complete |
| [Editing AI Proposals And Effects](./editing-ai-effects.md) | Proposal state machine, honest preview, typed effect validation, and deterministic FFmpeg mappings | Complete |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
