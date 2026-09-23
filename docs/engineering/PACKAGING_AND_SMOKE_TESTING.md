# 打包、安装与 Smoke 测试

本文记录 MYStudio 当前桌面应用的本地打包、覆盖安装和 smoke 验收流程。

## 命令目录

所有 npm 命令从 `~/Project/Github/MYStudio/apps` 目录执行：

```bash
cd ~/Project/Github/MYStudio/apps
```

不要从仓库根目录直接执行 npm 脚本。

根目录没有产品依赖入口。不要在根目录运行 `npm install`、`npm test`、视频脚本或
Remotion bundler；这些命令会把临时结果写到错误位置，例如根 `node_modules/`、
`output/` 或 `backups/`。

## 标准验证顺序

需要一次性跑完整验证时，执行统一入口：

```bash
cd ~/Project/Github/MYStudio/apps
npm run test:all
```

它按固定顺序执行 AiToEarn/build-contract 聚焦测试、typecheck、lint、完整 Vitest、
`smoke:aitoearn-upgrade`；macOS 再执行 `build:mac`（包含打包、覆盖安装、hash 校验和
installed smoke）以及 packaged `smoke:desktop`。阶段报告写入
`apps/output/automation/quality-gate-report.json`，失败阶段会以非零退出；不会执行真实
平台登录、网络发布或云端 fallback。只想检查计划可用：

```bash
npm run test:all -- --plan
```

不需要打包安装时使用 `npm run test:all -- --skip-release`。

代码改动后先跑：

```bash
npm run typecheck
npm run lint
npm run test
```

涉及 Electron、启动、设置、TTS、资产、工作流或打包逻辑时，继续执行：

```bash
npm run build:mac
```

`npm run build:mac` 已包含 packaged 构建、覆盖安装和 installed smoke；如需单独复查未安装
到 `/Applications` 的 packaged 产物，再额外执行 `npm run smoke:desktop`。

涉及时间线 renderer、Remotion 依赖或打包资源时，还要执行：

```bash
npm run remotion:versions
npm run remotion:worker:smoke
npm run remotion:smoke:five-shot
```

只有在 Remotion 版本、composition 源码或 bundle 内容发生变化时，才显式执行：

```bash
npm run remotion:bundle
```

`npm run build:mac` 不会隐式重建 bundle；它只会在 `electron-vite` 前校验固定
`apps/.cache/remotion-bundle`，校验失败就停止并提示先运行上述显式命令。

## 自动打包执行约定

标准 macOS 打包命令自身就包含完整链路，不需要另行启动安装或 smoke：构建完成后由
`build-mac.sh` 覆盖安装 `/Applications/漫影工作室.app`，运行 installed smoke，等待 smoke
结束并关闭应用后才返回。`build:mac:install` 作为兼容别名保留，但不再是唯一的完整链路入口。

## Windows / Linux 本地打包

```bash
npm run build:win    # node ./build/packaging/build-desktop.mjs --win
npm run build:linux  # node ./build/packaging/build-desktop.mjs --linux
```

两者直接走 `build-desktop.mjs`（electron-vite build + electron-builder），**不含** macOS 链的覆盖安装与 installed smoke——安装与验收由各平台自行执行。CI 在 `vX.Y.Z` tag 流程中对 Windows x64 走同一命令产出 `setup.exe`（macOS 仍走 `build:mac` 全链）。

## macOS 打包

```bash
npm run build:mac
```

当前 `build:mac` 会调用：

```text
sh ./build/packaging/build-mac.sh --arm64
```

再进入 `apps/build/packaging/build-desktop.mjs`，然后继续调用
`apps/build/packaging/install-and-smoke.mjs`。脚本会：

- 先校验 `apps/.cache/remotion-bundle/manifest.json`、bundle 文件和 Remotion 版本；
  固定 bundle 缺失、损坏或版本漂移时不会继续构建。
- 校验通过后执行 `electron-vite build`。
- 使用 `apps/frontend/config/electron-builder.yml` 打包。
- 将 Electron 和 electron-builder 缓存放到 `apps/release/.cache/`。
- 先写入带时间戳的 staging 目录，完成后整理到稳定输出目录。
- 清理旧的 `apps/out`、`apps/dist-electron` 等历史中间产物。
- 使用 `ditto` 覆盖安装到 `/Applications/漫影工作室.app`，比较 packaged/installed 的
  `app.asar` hash，并运行 installed smoke。
- smoke 默认后台运行，结束时关闭本次启动的应用；标准脚本强制不保留打开窗口。

当前 macOS ARM64 产物目录：

```text
apps/release/build/mac-arm64
```

Remotion 打包边界：固定 composition bundle 从 `apps/.cache/remotion-bundle` 复制到
`Contents/Resources/remotion-bundle`；`@remotion/compositor-darwin-arm64` 必须以同版
解包资源存在。`@remotion/bundler`、`@remotion/cli`、Chrome Headless Shell、项目
`.agents/.codex` Skills 和 `skills-lock.json` 不得进入安装包 runtime。核验命令为：

```bash
npm run remotion:versions
node ./build/remotion/verify-packaged-remotion.mjs \
  "./release/build/mac-arm64/mac-arm64/漫影工作室.app"
node ./build/remotion/verify-packaged-remotion.mjs \
  "/Applications/漫影工作室.app"
```

Player 使用 Electron Chromium；Headless Shell 只由设置页主动下载，不随安装包分发。
因此安装 smoke 可以验证 Player 和 renderer 选择，但未准备 Headless Shell 时 Remotion
MP4 导出必须保持明确阻止。

Python 打包边界同样要单独记录：开发/构建命令使用开发者当前 shell 的 `python3`，这份
Python 及其 site-packages 不进入 `app.asar` 或 `Resources`；安装包只携带 `Resources/backend`
源码和依赖清单，并排除 `backend/python/**`、`venv/**`。安装后的应用在用户进入
`设置 → 本地配置 -> Python 运行环境` 并点击 `开始配置` 时，才下载 CPython 3.12 到
`<storageBasePath>/python`，再安装 TTS 依赖。因而 packaged/installed smoke 的通过不能证明
Python runtime 已配置，也不能把开发机 `python3` 当作安装版 runtime 证据。

安装版的 video-use 必须从设置页下载的 `<storageBasePath>/python`（当前 macOS
示例为 `~/Library/Application Support/漫影工作室/python`）获取解释器；
默认复用该 managed Python 3.12 的 site-packages，并使用独立
`requirements-video-use.lock`/profile marker。禁止创建 `video-use-runtime` venv；兼容冲突时设置页恢复最近一次已验证组合并把章节置为 `blocked`。video-use 与 HyperFrames 每章默认启用，真实验收必须单独记录“开发 helper smoke”和“安装版 UI 配置后 worker smoke”，不能用一次 packaged smoke 代替两者。

应用目录：

```text
apps/release/build/mac-arm64/mac-arm64/漫影工作室.app
```

构建脚本可能提示未找到有效 Developer ID 签名证书。当前 GitHub Release 第一版允许发布未签名包，
但正式分发仍建议后续接入代码签名和 notarization。

## 覆盖安装（非标准产物独立复核）

以下命令仅用于排障时对非标准 packaged 产物做独立复核；标准
`npm run test:all` → `build:mac` 已自动执行覆盖安装、hash 校验和 installed
smoke，正常质量门禁结束后不要再次手动覆盖安装。

安装到 macOS 应用目录时，直接覆盖：

```bash
ditto "<repo-root>/apps/release/build/mac-arm64/mac-arm64/漫影工作室.app" "/Applications/漫影工作室.app"
```

项目当前约定是不创建 `/Applications/*.backup-*` 备份目录。

## 安装一致性校验

覆盖安装后，比对打包版和安装版 `app.asar`：

```bash
shasum -a 256 \
  "<repo-root>/apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/app.asar" \
  "/Applications/漫影工作室.app/Contents/Resources/app.asar"
```

两个 hash 必须一致，才能说明 `/Applications/漫影工作室.app` 是刚打出来的版本。

## 安装版 smoke

使用真实用户数据目录测试安装版：

```bash
MYSTUDIO_SMOKE_APP_BIN="/Applications/漫影工作室.app/Contents/MacOS/漫影工作室" \
MYSTUDIO_SMOKE_USER_DATA_DIR="<userData>" \
MYSTUDIO_SMOKE_DEBUG_PORT=9361 \
npm run smoke:desktop
```

如果 `9361` 被占用，可以换成其他端口。

`smoke-desktop.mjs` 默认使用 `MYSTUDIO_SMOKE_LAUNCH_MODE=auto`：macOS 直接启动在
AppKit 注册阶段以 `134/SIGABRT` 退出时，会自动改用 LaunchServices 重试；也可以显式
使用 `MYSTUDIO_SMOKE_LAUNCH_MODE=launch-services`。这只改变 smoke 的启动方式，不会
改变应用运行时或真实媒体生成链。

## GitHub Actions 自动打包与 Release

仓库的 `.github/workflows/build.yml` 是 GitHub 云端打包入口，不是本地 git hook：

- Pull Request 和普通 push 执行 `npm ci`、`typecheck`、`lint`、Vitest 与
  `electron-vite build`，用于快速发现代码回归。
- 手动运行 `workflow_dispatch` 时可填写 `version`；留空则使用当前
  `apps/package.json` 版本。手动运行只保留 Actions Artifact，不创建公开 Release。
- 推送 `vX.Y.Z` 标签时，workflow 校验稳定版 semver（不含预发布/构建后缀），在临时 runner 工作区同步
  `apps/package.json` / `apps/pnpm-lock.yaml`，生成固定 Remotion bundle，然后构建
  macOS ARM64 与 Windows x64。
- macOS 使用 `npm run build:mac`，包含固定 bundle 预检、打包、覆盖安装和 installed
  smoke；Windows 使用 `npm run build:win`。
- 两个平台先分别上传 Artifact，最后由单一 `publish-release` job 创建或更新同名
  GitHub Release，避免两个构建 job 并发写 Release。相同 tag 重跑会覆盖同名资产。
- Release 资产包括 macOS `.dmg`、`.zip` 和 Windows `*setup.exe`；第一版仍是未签名包，
  首次安装可能需要系统安全提示中手动确认。

### GitHub 仓库设置

1. 打开 `Settings → Actions → General`，确认 Actions 可使用 `GITHUB_TOKEN`，并将
   workflow permissions 设为 `Read and write permissions`。
2. 不需要为第一版创建 Secrets；发布 job 只使用仓库自动提供的 `GITHUB_TOKEN`，并在
   workflow 中单独声明 `contents: write`，其余 job 仅 `contents: read`。
3. 首次正式发布使用 `v0.0.1`；后续版本标签必须是 `vX.Y.Z` 形式的稳定版 semver。
   缺少 `v`、前导零、预发布/构建后缀等非法标签会在版本解析阶段失败。
4. 后续接入签名时，再把 Apple Developer ID / notarization 与 Windows 证书放到
   Actions Secrets（如 `CSC_LINK`、`CSC_KEY_PASSWORD` 及 Apple 凭据），禁止把证书写入
   仓库或上传到 Artifact。

Artifact 是某次 workflow 的临时下载物，不等于公开 Release；Release 只有 tag 流程在
macOS 与 Windows 都成功后才会创建。GitHub 官方参考：
[Workflow syntax](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)、
[Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。

## Smoke 覆盖内容

`apps/build/smoke/smoke-desktop.mjs` 会检查：

- 应用能启动。
- 根节点有渲染内容，不是白屏。
- 项目入口或 dashboard 可见。
- 核心路由可切换（经悬浮球/侧栏导航）：
  - MY 工作流
  - 资产
  - 本地模型（全屏 ComfyUI 工作区，DOM 锚 `[data-comfy-swap]`）
  - 设置
- 设置页包含唯一 `本地配置` 入口，并按 Python → ComfyUI 引擎（含「模型」页签） → 视觉审核 → TTS → 音效 → 视频工作流插件区块显示。
- `本地配置` 可见 Python 3.12、`<storageBasePath>/comfyui/models/TTS/whisper-large-v3-turbo`（09-10 模型统一家；旧版 `model/TTS`、`tts-models` 仅作迁移兼容）、Node 22、浏览器和共享 FFmpeg/ffprobe 状态，以及按优先级准备、单项检查/安装/更新/修复/回滚入口；Whisper 准备复用现有 TTS runtime，不创建独立 Python 环境。
- 截图或 DOM 视觉统计显示低白屏比例。

如果截图采集超时，但脚本退出码为 0，并且 DOM 回退统计正常，例如：

```text
whiteRatio=0.000
```

可以按 smoke 通过处理。

## 进程收尾检查

Smoke 后确认没有残留应用、TTS 后端或 ComfyUI 引擎进程：

```bash
pgrep -fl "漫影工作室|python.*tts|comfyui" || true
```

无输出表示没有残留匹配进程。

## ComfyUI 引擎资源边界（2026-09 起）

安装包**不携带** ComfyUI 引擎本体与本地模型：引擎按需安装进 `<userData>/comfyui/`（源码+独立 venv+models+工作流库），由引擎管理器在设置页触发下载/更新。仓库内的 `apps/backend/engines/comfyui/my_nodes/`（自研节点包）随包分发，运行时由 `plugin_manager.sync_my_nodes()` 同步进引擎家——改 my_nodes 后重新打包才进安装版。改动生效路径详见 [定制代码地图](../comfyui-kb/定制代码地图.md)。

开发态引擎家解析顺序（`manifest.py`）：`MYSTUDIO_COMFYUI_HOME` 环境变量 → 应用用户数据目录 `<userData>/comfyui/` → 纯开发兜底 `~/.manying-dev/comfyui/`。`sync_my_nodes` 在引擎启动链自动执行（`engine_manager.py`），dev 改完**重启引擎即生效、无需打包**；重打包约束只针对安装版（引擎 spawn 用 Resources 覆写引擎家）。

## 常见失败

### 找不到 package.json

命令目录错了。切到 `apps/` 后重跑。

### 打包产物不存在

先确认当前目录是 `apps/`，再执行 `npm run remotion:versions`。如果提示固定 bundle
缺失、manifest 无效或版本漂移，显式执行 `npm run remotion:bundle` 后重新运行
`npm run build:mac`；打包流程不会替你重新 bundle。

### 安装版 hash 不一致

重新执行 `ditto` 覆盖安装，再重新比对 hash。

### Smoke 白屏

不要只用开发服务器验证。直接看安装版 smoke 控制台输出，优先定位启动错误、资源路径错误和 renderer 异常。

### TTS 后端启动失败

先确认 [Python 与本地 TTS 配置](../settings/PYTHON_TTS_SETUP.md) 已完成，再在 `设置 → 本地配置 -> TTS 运行时与模型` 检查 `17593` 端口和安装明细。

## 视频工作流运行验证清单

以下清单是 packaged smoke 之外的安装版 UI/worker 验收，首版只在 macOS Apple Silicon 执行。每项都要保存 project/chapter/revision、输入 SHA、状态和输出 evidence；不得把 smoke 通过写成真实媒体链已完成。

| 场景 | 必须验证 | 失败判定 |
|---|---|---|
| 真实一章主链 | `ttsSpokenText -> TTS WAV binding -> StoryboardShot -> MLX 0.4.1 alignment -> video-use EDL/字幕时间/调色/preview/self-eval -> 用户确认 -> HyperFrames -> Remotion ChapterVideo -> final-output-qc` | 任一必需输入或 artifact 缺失为 `blocked` |
| `editable-edl` | EDL 秒值经 adapter 转为 `TimelineTimeUs`，字幕/overlay 仍是独立可编辑 metadata | 时间单位、revision 或字幕责任不一致为 blocked |
| `flat-shot-mp4` | clean MP4 不烧录普通字幕/overlay，独立字幕和 overlay metadata 可回交 | 发现重复烧录或 metadata 丢失为 blocked |
| 失败与重试 | 注入对齐、EDL、preview、self-eval、overlay 任一失败，重试从失败阶段恢复 | 静默继续、旧 revision 冒充成功或 fallback 为失败 |
| 更新与回滚 | 设置页先检查，用户手动应用新组合；失败后恢复最近已验证 manifest | 自动静默更新或无回滚证据为失败 |
| no-op overlay | 无动效章节仍生成通过校验的 HyperFrames `no-op` artifact | 缺少 no-op evidence 为失败 |
