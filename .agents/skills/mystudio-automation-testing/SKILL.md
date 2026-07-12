---
name: mystudio-automation-testing
description: Use when validating, packaging, installing, or smoke-testing MYStudio after code changes. Covers the project-specific TypeScript, Vitest, Electron build, packaged desktop smoke, installed app smoke, and no-backup install flow.
---

# MYStudio Automation Testing

Use this skill for MYStudio release confidence after code changes, especially when the user asks to self-test, self-verify, package, install, check white-screen regressions, or prove the installed app is the latest build.

## Ground Rules

- Work from `/Users/zhengbingjin/Project/Github/MYStudio`.
- Do not run git commands unless the user explicitly asks.
- Use `apps/` as the command working directory for npm commands.
- Do not create `/Applications/*.backup-*` app backups. Install by overwriting `/Applications/漫影工作室.app`.
- Before any Electron packaged, visible, or installed smoke test, close all existing MYStudio instances first. The smoke scripts do this automatically by default; do not disable it unless you are deliberately debugging with `MYSTUDIO_SMOKE_SKIP_PREKILL=1`.
- For "自动打包后安装" requests, delegate the full package/install/smoke chain to a worker sub-agent when sub-agents are available. The main agent should supervise, avoid duplicating the same long-running commands, and verify or summarize the worker's evidence before reporting.
- Treat old command output as stale; rerun the relevant check before claiming it passes.
- If a command starts a long-running Electron process, wait for it to exit before ending the turn.
- Report exact failing command, exit code, and the highest-signal error line when a gate fails.

## Decision Tree

- Pure logic or store change: run the focused Vitest file first, then `typecheck`, `lint`, and full `test`.
- Electron main/preload/build config change: run `typecheck`, `lint`, full `test`, `build:mac`, and packaged `smoke:desktop`.
- UI route, startup, settings, TTS, workflow, asset, or shell change: run full gate through packaged `smoke:desktop`.
- Release/install request: use a worker sub-agent to run the full gate, overwrite `/Applications/漫影工作室.app`, compare `app.asar` hashes, then run installed app smoke with an isolated temp user data dir. If sub-agents are unavailable, run the same chain locally.
- White-screen or packaged-only bug: do not rely on dev server. Run packaged or installed `smoke:desktop` and inspect console output from that run.

## Standard Gate

Run the narrow test first when a change has a focused test, then run the full gate:

```bash
cd apps
npm run typecheck
npm run lint
npm run test
npm run build:mac
npm run smoke:desktop
```

`npm run smoke:desktop`, `npm run smoke:installed`, `npm run smoke:workflow:open`, and `npm run smoke:workflow:run` must start from a clean app-process state. Their scripts should quit the app by bundle id and kill stale `漫影工作室` / helper processes before launching the tested instance.

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

- `build:mac` routes through `sh ./build/build-mac.sh --arm64`.
- setup scripts do not install Python into `backend`.
- `smoke:desktop` exists in `package.json`.
- `smoke-desktop.mjs` checks project entry, route verification, screenshots, timeout handling, and DOM visual fallback.

## Installed App Smoke

After `npm run build:mac` and `npm run smoke:desktop` pass, install the packaged app without making a backup:

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

`apps/build/smoke-desktop.mjs` is the packaged desktop smoke runner. It checks:

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
- Route text missing: inspect `CORE_ROUTE_CHECKS` in `apps/build/smoke-desktop.mjs` and verify the route label or expected text changed intentionally.
- High `whiteRatio` or root not rendered: treat as a white-screen regression. Use the smoke console logs before editing.
- Screenshot timeout with exit `0`: acceptable only when DOM fallback still reports valid route checks and low `whiteRatio`.
- Hash mismatch after install: reinstall with `ditto`, then rerun both `shasum` commands before smoke.

## Reporting Format

Keep the final report short and evidence-based:

- Mention changed files only when relevant.
- List fresh verification commands and results.
- For install verification, include the matching `app.asar` hash.
- If any step was skipped, say exactly why.
