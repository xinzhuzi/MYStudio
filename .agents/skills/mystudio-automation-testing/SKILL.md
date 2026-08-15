---
name: mystudio-automation-testing
description: Use when validating, packaging, installing, or smoke-testing MYStudio after code changes. Covers the project-specific TypeScript, Vitest, Electron build, packaged desktop smoke, installed app smoke, and no-backup install flow.
---

# MYStudio Automation Testing

Use this skill for MYStudio release confidence after code changes, especially when the user asks to self-test, self-verify, package, install, check white-screen regressions, or prove the installed app is the latest build.

## Path dictionary

- `<repo-root>` means `/Users/zhengbingjin/Project/Github/MYStudio`. This `SKILL.md` and all paths under it are repository source/instructions, read-only to the running product.
- Run npm commands from `<repo-root>/apps`; the frontend, backend, build, and documentation roots are `<repo-root>/apps/frontend`, `<repo-root>/apps/backend`, `<repo-root>/apps/build`, and `<repo-root>/docs`. They are repository source, not application runtime write targets.
- The packaged macOS app is emitted under `<repo-root>/apps/release/build/mac-arm64/mac-arm64/漫影工作室.app` (generated, writable build output); the default packaged smoke report is `<repo-root>/apps/output/automation/desktop-smoke-report.json` (generated, writable runtime/output evidence).
- `<userData>` is Electron's per-user application-data directory. `<storageBasePath>` is the configured runtime-writable storage root resolved from `<userData>/storage-config.json`; product-editable skills live at `<storageBasePath>/skills/`.
- `<repo-root>/apps/frontend/assets/studio-manuals/` is the read-only bundled seed source. `<repo-root>/.agents/skills/<skill>/SKILL.md`, `~/.codex/skills/<skill>/SKILL.md`, and `~/.agents/skills/<skill>/SKILL.md` are AI/development instructions, not product skill storage.

## Ground Rules

- Work from `/Users/zhengbingjin/Project/Github/MYStudio`.
- Do not run git commands unless the user explicitly asks.
- Use `apps/` as the command working directory for npm commands.
- Do not create `/Applications/*.backup-*` app backups. Install by overwriting `/Applications/漫影工作室.app`.
- Before any Electron packaged, visible, or installed smoke test, close all existing MYStudio instances first. The smoke scripts do this automatically by default; do not disable it unless you are deliberately debugging with `MYSTUDIO_SMOKE_SKIP_PREKILL=1`.
- Packaged and workflow automation runs in background by default with `MYSTUDIO_SMOKE_BACKGROUND=1`. Do not foreground MYStudio unless the user explicitly asks to watch the run.
- For "自动打包后安装" requests, delegate the full package/install/smoke chain to a worker sub-agent when sub-agents are available. The main agent should supervise, avoid duplicating the same long-running commands, and verify or summarize the worker's evidence before reporting.
- Treat old command output as stale; rerun the relevant check before claiming it passes.
- If a command starts a long-running Electron process, wait for it to exit before ending the turn.
- Report exact failing command, exit code, and the highest-signal error line when a gate fails.

## Decision Tree

- Pure logic or store change: run the focused Vitest file first, then `typecheck`, `lint`, and full `test`.
- Electron main/preload/build config change: run `typecheck`, `lint`, full `test`, `build:mac`, and packaged `smoke:desktop`.
- UI route, startup, settings, TTS, workflow, asset, or shell change: run full gate through packaged `smoke:desktop`.
- Release/install request: use a worker sub-agent to run the full `npm run test:all` gate. Its macOS release stages already overwrite `/Applications/漫影工作室.app`, compare `app.asar` hashes, and run installed app smoke with an isolated temp user data dir. If sub-agents are unavailable, run the same single entry locally.
- White-screen or packaged-only bug: do not rely on dev server. Run packaged or installed `smoke:desktop` and inspect console output from that run.

## Unified Quality Gate

For a complete repository verification, use the single aggregate entry from
`<repo-root>/apps`; do not manually reassemble the stages:

```bash
cd /Users/zhengbingjin/Project/Github/MYStudio/apps
npm run test:all
```

`test:all` runs the curated AiToEarn/build-contract tests, `typecheck`,
`lint`, the full Vitest suite, local-only upgrade smoke, and on macOS the
packaging/overwrite-install and packaged desktop smoke in fixed fail-fast
order. It writes `apps/output/automation/quality-gate-report.json`. Use
`npm run test:all -- --plan` to inspect the current stages, or
`npm run test:all -- --skip-release` for a non-packaging iteration.

When a change has a focused test, run that narrow test first; the aggregate
entry remains the final repository gate:

```bash
cd apps
npm test -- path-or-name.test.ts
npm run test:all
```

## Standard Gate

The underlying commands remain available for focused debugging or failure
triage:

```bash
cd apps
npm run typecheck
npm run lint
npm run test
npm run build:mac
npm run smoke:desktop
```

`npm run smoke:desktop`, `npm run smoke:installed`, `npm run smoke:workflow:open`, and `npm run smoke:workflow:run` must start from a clean app-process state. Their scripts should quit the app by bundle id and kill stale `漫影工作室` / helper processes before launching the tested instance.

Use the background workflow commands for unattended checks:

```bash
npm run smoke:workflow:background
npm run smoke:workflow:background:project
npm run smoke:workflow:background:project -- --auto-video
npm run video:chapter001:probe-providers
```

These commands must keep the Electron window hidden, avoid `System Events`/Accessibility focus control, and fail if focus evidence reports MYStudio as the foreground app. Use `smoke:workflow:run*` only for explicit visible inspection.

`npm run video:chapter001:probe-providers` is a non-generating provider-model probe. It may verify hidden app configuration and `/v1/models` reachability, but it is not a balance proof and must not be reported as a successful real MP4 generation.

For a focused regression test, use:

```bash
cd apps
npm test -- path-or-name.test.ts
```

Useful focused tests:

- Build scripts and desktop smoke contract: `npm test -- build-scripts.test.ts`
- TTS runtime/install behavior: `npm test -- tts-runtime.test.ts`
- Studio workflow readiness: `npm test -- workflow-readiness.test.ts`
- Startup/white-screen guards: `npm test -- renderer-startup.test.ts app-lifecycle.test.ts main-startup.test.ts`

## Build Script Contract

`apps/frontend/config/build-scripts.test.ts` protects the automation surface. If build or smoke scripts change, update tests with the behavior being protected, not only snapshots of strings. It currently checks:

- `build:mac` routes through `sh ./build/packaging/build-mac.sh --arm64`.
- setup scripts do not install Python into `backend`.
- `smoke:desktop` exists in `package.json`.
- `smoke-desktop.mjs` checks project entry, route verification, screenshots, timeout handling, and DOM visual fallback.

## Installed App Smoke (independent re-check only)

The standard `npm run test:all` path already invokes `build:mac`, which owns
packaging, overwrite installation, hash verification, and installed smoke. Use
the commands below only when independently re-checking a non-standard packaged
artifact; do not repeat them after a normal quality-gate run.

Install the packaged app without making a backup:

```bash
ditto "/Users/zhengbingjin/Project/Github/MYStudio/apps/release/build/mac-arm64/mac-arm64/漫影工作室.app" "/Applications/漫影工作室.app"
```

Verify the installed app matches the packaged app:

```bash
shasum -a 256 "/Users/zhengbingjin/Project/Github/MYStudio/apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/app.asar"
shasum -a 256 "/Applications/漫影工作室.app/Contents/Resources/app.asar"
```

Then smoke the installed app with an isolated temp user data dir:

```bash
cd apps
MYSTUDIO_SMOKE_APP_BIN="/Applications/漫影工作室.app/Contents/MacOS/漫影工作室" \
MYSTUDIO_SMOKE_DEBUG_PORT=9361 \
npm run smoke:desktop
```

Use a different `MYSTUDIO_SMOKE_DEBUG_PORT` if the port is busy.

## Smoke Coverage

`apps/build/smoke/smoke-desktop.mjs` is the packaged desktop smoke runner. It checks:

- App starts without a white screen.
- Dashboard/project entry renders.
- Core routes render: 工作流, 资产, TTS, 设置.
- 工作流 route renders without the removed `制作流程推进` rail.
- 设置 includes `Python 配置`.
- Screenshot visual stats or DOM fallback reports `whiteRatio`.

If screenshot capture times out but the script exits `0` with DOM visual stats, treat the smoke as passed and report the fallback.

## Failure Triage

- `package.json` missing: the command was probably run from repo root; rerun from `apps/`.
- Packaged app missing: run `npm run build:mac` before `npm run smoke:desktop`.
- Debug port unavailable: change `MYSTUDIO_SMOKE_DEBUG_PORT`.
- Route text missing: inspect `CORE_ROUTE_CHECKS` in `apps/build/smoke/smoke-desktop.mjs` and verify the route label or expected text changed intentionally.
- High `whiteRatio` or root not rendered: treat as a white-screen regression. Use the smoke console logs before editing.
- Screenshot timeout with exit `0`: acceptable only when DOM fallback still reports valid route checks and low `whiteRatio`.
- Hash mismatch after install: reinstall with `ditto`, then rerun both `shasum` commands before smoke.

## Reporting Format

Keep the final report short and evidence-based:

- Mention changed files only when relevant.
- List fresh verification commands and results.
- For install verification, include the matching `app.asar` hash.
- If any step was skipped, say exactly why.

---

## 现行视频工作流事实（2026-08-14 起）

唯一正式链路（所有验证以此为准）：

1. `npm run remotion:chapter001:shots`（`render-shot-slots.ts`）— 43 镜 StoryboardShot MP4，**TTS 配音烘进每镜**（经 `bind-voice-audio.ts` + `update-storyboards-voice.ts` 完成 manifest/storyboard 绑定后重渲生效）。门禁开关：`MYSTUDIO_REQUIRE_HUMAN_APPROVAL=0`、`MYSTUDIO_CONTINUITY_POLICY=skip`（测试用途；正式发布仍需人工批准）。
2. `npm run video:full-pipeline`（`run-full-pipeline.ts`）— video-use runChapter → accept → applyAcceptedArtifact（HyperFrames 透明特效层）→ chapter gate → 字幕归属校验（道劫 chapter-001 为 source-embedded：分镜图内嵌字幕，HyperFrames 禁文字模板、Remotion text clip=0）→ ChapterVideo 渲染。

已删除的旧入口（不要再引用）：`render-remotion-timeline.ts`、`render-editing-timeline.ts`、`render-derived-chapter.ts`、`video:chapter001:remotion`。旧 `MYSTUDIO_CHAPTER_VIDEO_*` 环境变量已改名 `MYSTUDIO_*`（项目专属的仅存于 `apps/build/chapter_video/`）。

成片验收最低顶（smoke 之外）：逐镜抽帧 vs 源 SSIM ≥ 0.90、有声（mean_volume > -60dB）、blackdetect 0 黑段、时长与 EDL 一致（1 帧容差）。QC 参考实现：`.trellis/tasks/archive/2026-08/08-14-three-plugin-chapter-video/research/three-plugin-fresh-qc.py`。
