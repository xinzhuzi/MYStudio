# Journal - xinzhuzi (Part 1)

> AI development session journal
> Started: 2026-07-07

---

## 2026-07-08 - Workflow node chrome cleanup

- Task: `.trellis/tasks/07-08-07-08-workflow-node-chrome-cleanup`
- Status: completed without archive/commit because project instructions forbid git operations unless explicitly requested.
- Scope: workflow production node chrome only.
- Changes: hid raw node ids and ready status chips, limited edit action to writable nodes (`script`, `scriptPlan`, `storyboardTable`), preserved stage entry, converted metrics to quiet text, and removed repeated descriptions for ready nodes.
- Validation passed:
  - `cd apps && npm test -- frontend/components/panels/studio/workflow-tabs.test.ts frontend/components/panels/studio/workflow-node-previews.test.tsx frontend/components/panels/studio/useWorkflowNodeEditor.test.tsx`
  - `cd apps && npm run typecheck`
  - `cd apps && npm run lint`


## Session 1: 清理 docs 不需要内容

**Date**: 2026-07-10
**Task**: 清理 docs 不需要内容
**Branch**: `-`

### Summary

完成 docs 全量审计与保守清理：79 个文件收口为 77 个 Markdown，合并 GPT 图片测试说明并补齐融合索引。

### Main Changes

- 删除 `docs/.DS_Store`。
- 将 `docs/融合/GPT图片生成标准适配说明.md` 的有效内容合并进 `docs/API_PROVIDER_MODEL_TEST_REFERENCE.md` 后删除孤立文件。
- 在 `docs/融合/README.md` 中补入两份仍被未完成任务使用的 Toonflow 审计资料。
- 最终验证：77 个 Markdown；非 Markdown、链接缺失、根索引缺口、融合索引缺口、完全重复组和过时图片 dry-run 表述均为 0。
- 定向 Vitest：4 个测试文件、31 个测试通过；未执行任何 git / worktree 操作。


### Git Commits

(No commits - project no-git workflow)

### Testing

- [OK] 文档门禁全部为 0 缺口；4 个 Vitest 文件、31 个测试通过。

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Remotion 混合音频链路当前源码复验

**Date**: 2026-08-01
**Task**: 07-31-remotion-hybrid-audio-pipeline
**Branch**: `-`

### Summary

继续验证当前源码：非发布质量门 `17:36:03Z` 为 `ok=true`，全量 Vitest
549/2722；backend 30/30；Electron build 与 Remotion bundle 通过。17:29Z
shot/chapter M=2/M=3 是最新 direct Remotion H.264/AAC fixture 证据。

### Evidence boundary

- shot 仅含 voice/SFX；chapter 仅含 BGM/ambience，chapter report
  `ffmpegPostProcess=false`；ffprobe 仅读取并确认 H.264/AAC。
- 17:09Z package/install 与 app.asar `3c4a23be…636b0` 归为 retry 修复前的
  历史 UI/安装证据；本次未重复覆盖安装，遵守 no-overwrite 约束。
- 未执行 live provider TTS/network；任务保持 active，等待 human review。

### Status

[OK] **Current source gates complete; task remains active for human review**

## Session 7: Remotion runtime 设置入口补齐

**Date**: 2026-07-29
**Task**: 07-28-remotion-workbench-canvas-stability
**Branch**: `main` (no-git)

### Summary

补齐 Remotion Headless Shell 未准备时的可点击设置入口。工作台状态条显示“打开渲染设置”，导航先记录一次性 `rendering` 标签请求，再切换到设置页；设置页消费请求并保持只读状态检查，不触发自动下载。

### Testing

- 聚焦：17 tests passed；工作流/渲染模型：46 tests passed。
- 全量：522 test files passed, 1 skipped；2522 tests passed, 3 skipped。
- `npm run typecheck` passed；`npm run lint -- --quiet` passed；`task.py validate` passed。
- Fresh Remotion evidence remains valid: 4.0.499, Remotion → Remotion, 1080×1920, 5.333333s, H.264/AAC, SHA-256 independently matched, loudness acceptance passed。
- Fresh canvas evidence remains valid: `workflow-zoom-performance-0729-final.json` passed。

### Status

[OK] **Implementation and verification complete; keep task in_progress until user approves archive**

## Session 8: 当前盘面最终门禁复验

**Date**: 2026-07-29
**Task**: 07-28-remotion-workbench-canvas-stability
**Branch**: `main` (no-git)

### Testing

- [OK] 主线程 `npm run typecheck`。
- [OK] 主线程 `npm run lint -- --quiet`。
- [OK] 主线程全量 `npm test`：522 个测试文件通过、1 个跳过；2525 个测试通过、3 个跳过。
- [OK] 主线程 focused：6 个文件、77 个测试通过；包含同一 revision 连续两次渲染计划导出字节一致、`validateTimelineRenderPlan` 接受、取消保存静默、Remotion 未准备设置导航和画布缩放/适配回归。
- [OK] 当前 packaged 画布报告仍为 15 轮通过、透明帧 0、近黑横带 0、固定控件 25%/100%/200% 与窗口返回通过。
- [OK] 当前 Remotion 4.0.499 five-shot 产物、H.264/AAC、1080×1920、5.333333s、bundle hash、独立 SHA 和响度验收一致。

### Status

[OPEN] **Source and Remotion evidence passed, but packaged canvas evidence is stale versus the latest source; R2/P1 remain open pending rebuilt packaged verification.**

## Session 9: 当前源码与 packaged 证据边界复核

**Date**: 2026-07-29
**Task**: 07-28-remotion-workbench-canvas-stability
**Branch**: `main` (no-git)

### Testing

- [OK] 主线程 `npm run typecheck`。
- [OK] 主线程 `npm run lint -- --quiet`。
- [OK] 主线程全量 `npm test`：522 个测试文件通过、1 个跳过；2529 个测试通过、3 个跳过。
- [OK] 修复 TB 自动排版的 Handle 方向：画布向节点传递 source/target position，主线与分支连线在 TB 下不再固定为左右方向；新增回归测试。
- [OK] `task.py validate 07-28-remotion-workbench-canvas-stability`：implement/check context 均通过。
- [OK] Remotion five-shot 当前报告仍为 `requested=remotion`、`actual=remotion`、4.0.499、1080×1920、5.333333s、H.264/AAC，独立 SHA 一致。
- [OPEN] 最新源码（`WorkflowNodeCanvas.tsx` 03:55:12、`WorkflowProductionNode.tsx` 03:55:27）晚于 packaged app.asar（00:19:18）；较新的 zoom 报告针对旧包出现一次 `241.4ms` 长帧并标记 `passed=false`。此前 15 轮通过报告只能作为历史证据，R2 需在重建 packaged binary 后复验。
- [OK] Remotion five-shot、bundle manifest、MP4、ffprobe、loudness 与独立 SHA 仍为同一 03:17 运行批次，`requested=actual=remotion`、4.0.499、1080×1920、H.264/AAC。

### Status

[OPEN] **源码/UI/Remotion 证据已复核；当前任务继续 `in_progress`，不得把旧 packaged 报告标为当前源码通过，也不执行归档。**

## Session 10: 打包覆盖安装与当前源码画布门禁

**Date**: 2026-07-29
**Task**: 07-28-remotion-workbench-canvas-stability
**Branch**: `main` (no-git)

### Testing

- [OK] Trellis 默认 check worker 因 Claude 未登录未执行命令；按自动化技能的 fallback 使用本地 worker，未重复触发打包。
- [OK] `cd apps && npm run build:mac`：exit 0；通过唯一 `build/packaging/build-mac.sh` 入口完成 arm64 构建、覆盖安装和 installed desktop smoke。
- [OK] packaged 与 `/Applications` 的 `app.asar` SHA-256 一致：`8b78d2bfb698bd62d624eb4174bb7be2e4f0a3b72c22e557a829ae53b61adbb5`。
- [OK] `smoke:workflow:background:daojie`：exit 0；`ok=true`、`result.source=real-daojie-chapter001-clone`、43/43 storyboards 完成且 43/43 media/workflow/ready。
- [OK] 当前 packaged 15 轮缩放探针：`passed=true`；透明帧 0、近黑横带 0、几何失败 0、>100ms 长帧 0，max 41.6ms、p95 9.2ms；窗口返回、平移、25%/100%/200% 控件和 resize 均通过。
- [OK] Phase 3.3 spec 同步完成：记录生产 ReactFlow 静态背景、可取消自动 fit、固定控件层与 packaged 15 轮验收合同。

### Status

[OK] **R2 packaged current-source gate and P1 dependency closed; implementation remains `in_progress` only because archive requires explicit user approval.**

## Session 3: Wave151 SQLite lifecycle cleanup

**Date**: 2026-07-25
**Task**: Continue code-health refactor within the frozen media boundary

### Summary

Closed the three read-only SQLite handles in the Daojie workflow helper with
`contextlib.closing`. This removed the aggregate Python suite's
`ResourceWarning` without running or changing any provider/media workflow.

### Testing

- [OK] `PYTHONWARNINGS=error::ResourceWarning` Python suite: 129 tests.
- [OK] Typecheck, lint, full Vitest: 398 files / 1855 tests (1 file / 3 tests
  skipped, 1 todo).
- [OK] Trellis manifests: 434 implement / 439 check entries.

### Status

[OPEN] Two real-media acceptance items remain frozen; the late-event
cancellation product decision is also intentionally unresolved.

## Session 4: Wave152 media acceptance rerun

**Date**: 2026-07-25
**Task**: Freshly attempt the two remaining code-health acceptance items

### Testing

- [BLOCKED] Background Daojie auto-video: six stages and 43/43 storyboards
  observed, then continuity guard failed with 172 issues; empty final path and
  no timeline evidence.
- [BLOCKED] Direct Daojie video: preflight reported 0 approved / 43 pending /
  0 rejected / 0 stale and stopped before provider execution.
- [OK] Fresh durable reports were written; no guard or approval was bypassed.
- [OK] Stale Trellis manifest paths were mapped to current modules; validation
  passes with 435 implement / 440 check entries.

### Status

[OPEN] Both acceptance items remain open pending legitimate storyboard review
writeback and a subsequent real-media run.


## Session 2: Close paid retry review without Git

**Date**: 2026-07-19
**Task**: Close paid retry review without Git
**Branch**: `main`

### Summary

Archived the paid retry and visual-review closure task without Git. Revalidated the paid ledger, shot 008 human rejection receipt, zero-cost workflow gates, full tests, packaged smoke, and installed-app smoke; real MP4 remains intentionally blocked by 43 pending/stale storyboard reviews.

### Main Changes

- Archived `07-17-paid-retry-closure-review` with `task.py archive --no-commit`.
- Rebased the two archived manifest references to the archive path and revalidated both context files.
- Preserved the final audit, Mikoto billing reconciliation, and immutable shot 008 rejection receipt.

### Git Commits

(No commits - planning session)

### Testing

- [OK] Python regressions 12/12; build-script contract 71/71; full Vitest 1,488 passed.
- [OK] Typecheck, lint, zero-cost pilot/probe, packaged smoke, and installed-app smoke passed.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 归档 Remotion 打包与根目录清理任务

**Date**: 2026-07-26
**Task**: 归档 Remotion 打包与根目录清理任务
**Branch**: `main`

### Summary

归档 07-26-mystudio-remotion-packaging-root-cleanup；固定 Remotion bundle、build-mac.sh 构建覆盖安装 installed smoke 通过，根目录 node_modules/output/backups 已清理。保留边界：全仓 typecheck 与 Vitest 仍被既有 TTS 测试阻塞；本次不修改 TTS 文件。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Archive AC11 local visual review slice

**Date**: 2026-07-26
**Task**: Archive AC11 local visual review slice
**Branch**: `main`

### Summary

Archived the completed local AC11 visual review slice with no-git mode. Added design and implement/check manifests, added stale storyboard and boundary navigation regressions, and verified full Vitest 487 files/2301 tests, typecheck, lint, Python 49 tests, and py_compile. The production visual preflight remains intentionally blocked at approved=0,pending=43,rejected=0,stale=43; no provider request or real generation was performed.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 统一项目路径规划归档确认

**Date**: 2026-07-27
**Task**: 统一项目路径规划归档确认
**Branch**: `no-git-user-managed`

### Summary

统一项目路径任务已位于 archive/2026-07，状态 completed；最终扫描、测试、typecheck、lint 与 Trellis validate 均通过；未执行 git/worktree。

### Main Changes

- Target task: .trellis/tasks/archive/2026-07/07-26-unified-project-paths
- Archive check: task.json status=completed, no children/subtasks, worktree_path=null, meta.no_git=true.
- Active task guard: current active task is .trellis/tasks/07-26-aitoearn-electron-self-media-integration, unrelated and not archived.
- Validation evidence from final pass: source/docs/Trellis hardcoded path scans passed, affected tests passed, npm run typecheck passed, npm run lint passed, task.py validate passed.
- No git commands and no worktree operations were executed for this archive confirmation.


### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: AiToEarn 本地自媒体质量门禁收口

**Date**: 2026-07-27
**Task**: AiToEarn 本地自媒体质量门禁收口
**Branch**: `-`

### Summary

完成 14 平台 Electron 自媒体集成与本地边界收口；统一入口 npm run test:all 七阶段全通过（521 个测试文件，2485 个测试，3 个 skipped），MCP/remote 全量扫描为空，macOS 打包覆盖安装与 desktop smoke 通过；已按 no-commit 归档 07-27-aitoearn-local-only-hardening。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: 用户数据路径治理 Phase A 收口

**Date**: 2026-08-02
**Task**: 用户数据路径治理 Phase A 收口
**Branch**: `main`

### Summary

完成 userData/Remotion 路径契约统一、storage 事务回滚、只读 governance manifest；fresh Vitest/typecheck/lint/Python、packaged/installed smoke 和真实目录只读复验全部通过。M1 物理目录迁移保留为需单独批准的阻塞项；任务已 no-commit 归档。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## 2026-08-07 产物模块定位按钮 + 内容预览修复(续)

### 根因(两个独立 bug)

1. **内容预览崩溃 "无效的物理文件引用"**: `ref` 是 React 保留 prop 名。`<RefPreview ref={x}>` 时 React 把 x 绑到 `fiber.ref`(DOM ref 语义),不透传 props。函数组件 `function Comp({ref: physicalRef})` 收到 `physicalRef === undefined`。**修复**: prop 改名 `physicalRef`(`RefPreview.tsx` + 调用点 `artifact-detail/index.tsx`)。

2. **定位按钮无效**: stale closure。`handleRevealRef` 闭包捕获组件作用域 `artifact`,按钮 onClick 是某次旧 render 的闭包,那次 `artifact` 为 null/空 → guard `!artifact?.projectId` 提前 return,IPC 从未发出。**修复**: `useRef` 持有最新 artifact,handler 读 `artifactRef.current` 而非闭包 artifact(`artifact-detail/index.tsx` L88-94, L103-107)。

### 调试陷阱(重要,避免重蹈)

- **contextBridge wrapper 陷阱**: `window.projectFiles`/`window.electronAPI` 是 preload `contextBridge.exposer` 暴露的**只读冻结代理**。在 renderer 里 `o[k] = wrappedFn` **不会真正修改它**(静默失败或不生效),导致 IPC 调用计数器永远为空,造成"handler 没调用 IPC"的**假象**。验证 IPC 是否真正执行,应改用:① 在 handler 内 `console.warn` 打每步 + 用 CDP `Runtime.consoleAPICalled` 捕获并 `JSON.stringify` 对象(CDP 默认把对象显示为 "Object" 丢内容);② 或在 main 进程侧 `ipcMain.handle` 加日志。
- **CDP `consoleAPICalled` 对象丢内容**: 第二参数对象只显示 "Object"。需在 renderer 侧 patch `console.warn` 把对象 `JSON.stringify` 后存到 `window.__warns`,再读回。

### 验证(已安装 app,真实数据 道劫/scenes.json)

- 内容预览: CodeMirror 渲染 `{state:{scenes:[{name:"道口镇"...}`,无"无效的物理文件引用",无崩溃。
- 定位按钮: `getAbsolutePath`→绝对路径,`showItemInFolder`→`{success:true}`(Finder 打开)。

### 验证命令

- 打包: `cd apps && npm run build:mac:install`(skill 脚本,打包+覆盖安装+smoke,非裸命令)
- typecheck: `npm run typecheck`;lint: `npx eslint <file> --config frontend/config/eslint.cjs`
- CDP 调试: `open -a "/Applications/漫影工作室.app" --args --remote-debugging-port=9361`


## Session 8: 归档视频工作流插件融合任务

**Date**: 2026-08-10
**Task**: 归档视频工作流插件融合任务
**Branch**: `main`

### Summary

完成插件配置统一入口、旧导航文案清理与最终回归；598 files/3210 tests、typecheck、lint、文档链接和 Trellis validate 通过。已按 no-git 规则归档 08-08-video-workflow-plugin-docs；未修改真实用户 Python/Node/FFmpeg/model runtime。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
