# 开发者架构与代码入口

本文面向维护 MYStudio 的开发者，说明当前仓库的主要目录、关键模块和排查入口。它描述当前代码状态，不替代长期融合规划。

## 仓库主线

```text
apps/
  package.json                  # npm scripts、Electron/Vite/Vitest 入口
  build/                        # 按职责分组的构建、smoke、Daojie 与时间线工具
  frontend/                     # Electron + React + TypeScript 桌面端
  backend/                      # 本地 Python 域：TTS sidecar + engines/ 底层模型引擎层（含 ComfyUI 托管引擎）
```

常用命令都从 `apps/` 目录执行：

```bash
npm run typecheck
npm run lint
npm run test
npm run test:all    # 统一质量门禁：typecheck+lint+Vitest+smoke，macOS 再跑 build:mac 全链
npm run build:mac
```

后端测试（系统 `python3`，从 `apps/` 执行）：`PYTHONPATH=backend python3 -m unittest discover -s backend/tests`（TTS/生图等 sidecar 域）与 `PYTHONPATH=backend python3 -m pytest backend/engines/comfyui/tests`（ComfyUI 引擎层：bridge/manifest/execute 等）。

桌面打包从 `apps/` 执行并复用已验证的固定 Remotion bundle。`build:mac` 会在
`electron-vite` 之前校验 bundle manifest、内容哈希和 Remotion 版本；它不会隐式运行
`npm run remotion:bundle`，并在打包后自动覆盖安装、运行 installed smoke、关闭应用后返回。
只有版本、composition 或 bundle 内容变化时，才显式运行：

```bash
cd apps
npm run remotion:bundle
npm run remotion:versions
npm run build:mac
```

## ComfyUI 引擎层（2026-09 起现行架构）

ComfyUI 托管 K2 图像、H3 视频及音乐/修复等节点工作流；本地 TTS、VLM 审核等仍有独立的受管 Python worker。不能将全部本地能力等同于 ComfyUI 节点执行。要点：

- **引擎域**：`apps/backend/engines/` 按模态分 9 包——`comfyui`（托管引擎，主力）、`tts_engine`、`audio_engine`、`sfx_engine`、`image_engine`（本地生图 sidecar，固定端口 17595，含 `comfyui_bridge.py` 工作流模板）、`depth_engine`、`upscale_engine`、`video_qc_engine`、`vlm_engine`。engines 域定位（底层模型引擎层）见 `.claude/knowledge/backend-architecture.md`。
- **ComfyUI 托管引擎**（`engines/comfyui/`）：`engine_manager.py` 负责安装/启动/健康探测，引擎「家」在 `<userData>/comfyui/`（ComfyUI 源码、独立 venv、`models/`、snapshots、默认 `<源码目录>/user/default/workflows` 用户库（可覆写 `workflowsDir`）、manifest.json、engine.lock）；引擎端口走 17xxx 动态分配（真源=引擎账本/状态，禁大众端口），`bridge_actions.py` 等提供结果回写桥。
- **my_nodes 自研节点包**：真源在仓库 `apps/backend/engines/comfyui/my_nodes/`（Python 节点 + `web/` 前端扩展），运行时由 `plugin_manager.sync_my_nodes()` 同步进引擎家。铁律：零改 ComfyUI 本体、全走官方扩展点、引擎家 git 恒 0 改动。四层定制代码位置与生效路径见 [定制代码地图](../comfyui-kb/定制代码地图.md)。
- **前端**：主导航「本地模型」（原「辅助」）= 全屏 ComfyUI 工作区（`components/panels/assist/ComfyWorkspace.tsx`，三态：ComfyUI 画布 `comfy-canvas/ComfyCanvasStudio.tsx` webview 嵌自管引擎完整前端 / TTS 配音室 / 漫影生图 `local-models/`）；「MY 工作流」的「分镜视频生成」「图像节点图」页签经 `ComfyCanvasSwap.tsx` 复用同一画布，业务载荷由 `lib/assist/image-studio/storyboard-pipeline-comfy.ts` 等桥接写入。
- **模型统一家（09-10 裁定）**：Node 侧模型路径通过 `electron/storage/model-dirs.ts` 组装为 `<storageBasePath>/comfyui/models/<family>/`；ComfyUI 引擎的实际 `modelsDir` 另允许 manifest 覆写，需核对设置页当前值；08-19 的 `<storageBasePath>/model/<family>/` 规范就此退役。设置→本地配置→ComfyUI 引擎卡「模型」页签 = `comfyui/models` 活清单。
- 旧 React Flow 画布 2026-09-01 退役删除，画布化操作全走 ComfyUI（历史参照与存续对账见 `.claude/knowledge/node-graph-architecture.md`）。导演/S级/角色/场景等内部工作区仍走云端 AI 链路（`aiManager`），与本地 ComfyUI 产线并行。

## 当前物理模块地图与数据边界

本节是工程目录职责的单一总览，以当前磁盘、启动代码和打包规则为准；它不把尚未创建的迁移目标写成现有目录。用户操作与专题配置仍以相应的设置、存储和打包文档为准。

| 当前位置 | 入口与依赖 | 职责、可写数据与运行位置 | 验证入口 | 不可越界事项 |
|---|---|---|---|---|
| `apps/frontend/` | `main.tsx`、`App.tsx`、`electron/main/main.ts`、`electron/preload/preload.ts` | React renderer、Electron main/preload、IPC、应用状态、领域服务和内置 UI 资源；构建输出为 `apps/out/` | `cd apps && npm run typecheck && npm run lint && npm run test` | renderer 不直接使用 Node 文件系统；用户 runtime 不写入源码目录 |
| `apps/backend/` | `tts.main`、`requirements.txt`、`engines/`；由 Electron 以 `PYTHONPATH` 启动/管控 | 本地 TTS、声音克隆、模型目录探测、转写和运行时 SQLite 的 sidecar 源码及依赖声明；`engines/` 为底层模型引擎层（ComfyUI 托管引擎等 9 包，见上节） | `cd apps && PYTHONPATH=backend python3 -m unittest discover -s backend/tests` | 不是远程 Web 服务；不在 import 阶段下载模型，不把生成物写进 `apps/backend/` |
| `apps/build/` | `packaging/`、`smoke/`、`chapter_video/`、`timeline/`、`shared/` | 构建、安装、smoke、章节视频(Daojie)素材/连续性工具、时间线 CLI 和共享报告辅助；构建中间产物位于 `apps/release/`，导出位置必须显式传入 | `cd apps && npm test -- frontend/config/build-scripts.test.ts`；章节视频 Python 测试在 `build/chapter_video/tests` | 不是应用运行时库；不把用户 Python、模型、缓存或第二套 FFmpeg 时间线规则塞入此目录 |
| `apps/output/` | 由生成/导出工作流显式写入 | MP4、音频、图片、报告和证据等生成产物 | 由产物生成工作流及其报告验证 | 前端和后端不得 import 其中内容；不得把它作为可提交源码模块 |
| `apps/Library/` | 不存在（本次盘面核验） | 当前没有模块责任或写入位置 | 不适用 | 不因历史习惯新建该根目录或把工具迁入其中 |

用户数据、打包资源与源码同样是边界的一部分：

| 位置 | 当前职责 | 边界 |
|---|---|---|
| `<storageBasePath>/projects`、`media`、`assets`、`skills` | 用户项目、媒体、资产库和技能等项目存储 | 由 Electron storage bridge 和设置页管理，不由 renderer 直接写入 |
| `<storageBasePath>/python` | 设置页下载并配置的 Python 3.12 runtime | 正式 Python runtime 根目录；当前 TTS 依赖从 `apps/backend/requirements.txt` 安装到这里，video-use 只把它作为解释器来源 |
| `<userData>/comfyui/`（可由 `MYSTUDIO_COMFYUI_HOME` 覆写） | ComfyUI 引擎家：引擎源码、独立 venv、`models/`（本地模型统一家）、snapshots、默认 `<源码目录>/user/default/workflows` 用户库（可覆写 `workflowsDir`）、manifest.json、engine.lock | 引擎运行时数据，由引擎管理器安装/升级；不进安装包，不写入 `apps/` 源码区 |
| `<storageBasePath>/comfyui/models/TTS` | 默认 TTS 模型缓存（09-10 模型统一家；旧版 `model/TTS`、`tts-models` 仅作迁移兼容，`model-dirs.ts` 为拼装单源） | 运行时数据，不是源码或应用资源 |
| `<storageBasePath>/TTS/runtime` | sidecar 的状态、`tts.sqlite`、生成音频和 marker | 由 sidecar 启动参数和 Electron runtime 管理，不写入 `apps/backend/`；旧版 `<userData>/tts-runtime` 仅作迁移兼容 |
| 安装包 `out/` 与 `Resources/backend` | 应用构建输出与打包后的 sidecar 源码 | electron-builder 把 `backend` 作为资源复制，但排除 tests、文档、`backend/python/**` 和 venv；Python runtime 不随安装包分发 |

这里要明确区分两套 Python：开发/构建脚本使用开发者当前 shell 的 `python3`（或开发者自行激活的虚拟环境），安装后的 Electron 应用使用设置页下载到 `<storageBasePath>/python` 的受管理 Python 3.12。当前仓库没有提交一个可作为开发运行时的 `apps/.venv`/`apps/backend/.venv`；开发者应以当前 shell 的 `python3 --version` 检查版本；历史开发机探针不能作为产品打包依赖。

**开发态 TTS 是例外中的第二层**：即使 Electron 以 `npm run dev` 启动，TTS 按钮仍由 `tts-runtime.ts` 查找 `<storageBasePath>/python` 并用它启动 `tts.main`；开发 shell 的 `python3` 只负责直接运行 build/测试脚本，不能据此推断 TTS 会使用 shell Python。两者都不把 Python runtime 带入安装包：electron-builder 只复制 `Resources/backend` 源码与依赖声明，并排除 `backend/python/**`、`venv/**`。

2026-08-03 的只读 `storage-config.json` 证据中，`basePath`、`projectPath` 和
`mediaPath` 都为空，所以当时的 `<storageBasePath>` 与 `<userData>` 是同一物理根。
这是历史快照；今天的真实目录须重新读取配置，不据此推断当前机器仍未迁移：

源码中的路径解析是确定的：`storage-manager.ts` 在没有自定义 `basePath` 时返回
Electron `userDataPath`，`getPythonRuntimeDir()` 再拼接 `python`；`main.ts` 将同一个
`getStorageBasePath()` 传给 `tts-runtime`。该历史 macOS 配置对应的路径示例是
`~/Library/Application Support/漫影工作室/python/bin/python3`（文档中的
`<storageBasePath>/python/bin/python3` 是可迁移写法）。设置页或 video-use worker 都必须从
这个 resolver 得到路径，不能自行猜测、读取开发者 shell 的 `python3` 或写入
`apps/backend/python`。

| 当前 userData 类别 | 代码入口或所有者 | 分类与治理边界 |
|---|---|---|
| `projects/`、`media/`、`assets/`、`skills/`、`python/`、`comfyui/`（引擎家 + 模型统一家，含 `models/TTS` 等） | `storage-manager.ts` 与 `model-dirs.ts`；资产 DB 由 `studio-assets-storage.ts` 固定为 `assets/assets.db` | 产品/运行时数据，保留；模型和 Python 内部 symlink 不是逃逸数据 |
| `TTS/runtime/` | `tts-runtime.ts` 以 `<storageBasePath>` 建立 sidecar 数据根，并写入 `.deps-hash` | SQLite、音频、配置和依赖标记，保留；旧版 `<userData>/tts-runtime` 仅作迁移兼容 |
| `remotion-runtime/`、`remotion-studio/` | `remotion-runtime-manifest.ts` 与 `main.ts` | 浏览器/Studio runtime，保留 |
| `logs/diagnostics/`、`self-media/tasks.json`、`storage-config.json` | `main.ts`、self-media IPC、`storage-manager.ts` | 日志、任务和配置，保留 |
| `Cache/`、`Code Cache/`、`GPUCache/`、Dawn caches | Electron/Chromium；`storage-manager.ts` 只把前三类接入设置页缓存管理 | `rebuildable-cache`，但 governance 不自动清理，运行中不得移动 |
| Local/IndexedDB/WebStorage、Cookies、Preferences、Session/File System、Shared/Trust/Network 状态 | Electron/Chromium userData | `electron-state`，包含会话与安全状态，默认保留 |
| `DevToolsActivePort`、`.com.github.Electron.*`、`Singleton*` | Electron/Chromium DevTools 与单实例机制；`main.ts` 调用 `requestSingleInstanceLock()` | `runtime-lock-marker`，运行中保留；断链 marker 不自动算 escape |
| 顶层 `assets.db`、`assets/assets.db.bak-*`、`assets/db.json.migrated` | canonical 代码入口不读取这些路径；它们只提供 legacy/orphan、恢复或迁移证据 | 证据不足，保留，不进入清理 manifest |
| `.DS_Store` | Finder，不属于产品代码契约 | `finder-metadata`；仅普通文件可在未来人工批准的精确批次中进入废纸篓 |

`apps/build/scripts/user-data-governance.mjs` 是这张表的文件级投影。默认 scan 输出必须位于
userData 外且不得覆盖已有文件；SQLite 明确区分 `ok`、`locked`、
`corrupt-or-unreadable`，symlink 只有在 realpath 成功解析到根外时才是
`hold-symlink-escape`。`batch` 只生成 `approved=false` 的 `.DS_Store` 候选清单；
`trash` 必须收到 `mode=approved-trash`、`approved=true`、原证据未漂移和
`--confirm-app-exited`，随后才可通过显式 `/usr/bin/trash --stopOnError --verbose`
移动，并写入 pending/failed/applied recovery evidence。

`apps/backend/python` 如在本机工作区出现，是被忽略且被打包排除的 CPython/runtime 供应物，属于本地/历史运行时残留，不是 `apps/backend` 的源码模块、依赖输入或正式 runtime 候选。本任务不删除、移动或清空它；清理前须在新的核验后取得单独确认。

### 当前 build 子域与 rendering 边界

下面的 build 子域和 `rendering` renderer-neutral 边界均已落地。`apps/package.json` 是
Remotion 依赖与脚本的版本源；`apps/build/remotion/` 只负责固定 bundle、版本治理、
升级和 smoke，不承载产品运行时。

```text
apps/
├── frontend/                         # 当前桌面产品壳
│   ├── components/ stores/ lib/       # UI、状态和领域逻辑
│   ├── electron/                      # main、preload、IPC、sidecar 和文件能力
│   │   └── rendering/                 # renderer-neutral Electron 渲染运行时边界
│   │       ├── contracts/             # request、progress、evidence、浏览器状态
│   │       ├── runtime/               # Remotion-only router、队列与统一 evidence
│   │       └── plugins/remotion/      # Composition、Player、Studio、浏览器、媒体桥、renderer
│   ├── types/ config/ assets/         # 共享契约、工具配置和内置资源
├── backend/                           # 当前 sidecar 源码、测试和 requirements.txt
├── build/                             # 当前构建时执行器，不是运行时库
│   ├── packaging/                     # 打包、安装和 setup 入口
│   ├── smoke/                         # packaged/installed/workflow smoke
│   ├── chapter_video/                 # 章节视频(Daojie)编排、素材、连续性与领域测试
│   ├── timeline/                      # direct runner、Node-only vite 配置与测试
│   └── shared/                        # 构建期报告和付费请求台账辅助
└── output/                            # 当前生成结果与报告；不提供 import 模块
```

`apps/frontend/electron/rendering/contracts` 的输入是已验证的时间线、镜头、音频、字幕和资产引用，而不是
shell、raw FFmpeg 参数、任意输出路径或命令字符串。正式路由只接受 Remotion：
`renderer-router` 先验证效果能力，未知或暂不支持的效果在浏览器、Studio、worker 启动前
以结构化 `blocked/error` 返回；Remotion 浏览器、worker、素材读取、probe 或 SHA 失败均不
自动回退到其它 renderer。

Remotion 是当前已接入的独立 rendering plugin，接收稳定的 rendering contract，将已准备
好的镜头和媒体映射为固定 Composition，并返回项目级产物/evidence 契约。它不负责小说
解析、剧本或分镜生成、资产生成、Python sidecar、用户项目 JSON 或项目存储；也不得直接
import renderer components、Zustand store 或 sidecar 源码。产品只使用 `apps/node_modules`
中的发布包，不复制 `<remotion-source-root>` 源码；`<skills-source-root>`
仅作为开发规范来源，不进入产品 runtime。

当前固定版本为 Remotion `4.0.499`，Mediabunny 为 `1.50.8`，macOS arm64 compositor
与 Remotion 同版。Player 运行在 Electron Chromium 中；MP4 导出才需要 Chrome Headless
Shell，且只允许用户在设置页主动下载/更新。Headless Shell、Bundler、CLI 和 Skills
均不进入安装包。固定 Composition bundle 由 `apps/build/remotion/bundle.mjs` 生成到
`apps/.cache/remotion-bundle`，打包后位于 `process.resourcesPath/remotion-bundle`；
运行时版本或 bundle manifest 漂移会在导出前阻止任务。旧版本保存的 FFmpeg renderer
配置只在迁移时归一化为 Remotion，不再成为可选生产路径。

### HyperFrames 的应用运行时集成边界

HyperFrames 与 Remotion 都可以通过 npm 安装，但不能因此把它们加载进同一个 Electron
renderer。当前锁文件中的 Electron `43.4.0` 内置 Node 为 `24.18.1`，满足
`hyperframes@0.7.109` 的 Node.js `>=22` 门槛；产品仍使用独立 worker/profile，隔离 CLI、
Chrome、临时组合和失败清理，不把 HyperFrames 依赖并入 renderer 图。正确接线是：

```text
MYStudio UI 按钮/文本/确认
  -> typed preload IPC（projectId/chapterId/revisionId/effect plan）
  -> Electron main 校验路径、Electron 内置 Node（要求 >=22）、Chrome、共享 FFmpeg/ffprobe
  -> Electron Node 模式承载的独立 HyperFrames worker/profile（不可见，无用户终端）
  -> lint/check/preview/render
  -> overlay manifest + MP4/WebM + ffprobe + SHA
  -> MYStudio adapter / derived asset 校验
  -> EditingProject / TimelineRenderPlan 的 overlay clip
  -> Remotion ChapterVideo 正式渲染（requested=actual=remotion）
```

集成时必须同时满足以下边界：

- `hyperframes` 可以精确锁定在 `apps/package.json` 供开发和 CI 使用，但生产运行不能由
  Electron renderer 或 Electron main 直接 `import`；Electron 内置 Node（要求 >=22） worker/runtime 应作为经过筛选的
  `extraResources` 独立资源（或等价的受控运行时）提供，不能仅放在 `app.asar` 中。
- HyperFrames 的 HTML/CSS/JS 源码、Node 依赖、诊断和浏览器缓存与 Remotion bundle
  分开；不把全部 19 个 Agent Skill 复制进生产包，不把其 composition 注册为
  `TimelineRendererId`，也不改变当前 Remotion fail-closed router。
- HyperFrames 依赖可 seek 的 Headless Chrome/Puppeteer。不能把 Electron Chromium“看起来能打开页面”
  当作兼容证据；启动前必须探测 sidecar 实际使用的 Chrome/Headless Shell 版本、可执行权限和
  渲染能力。当前探针执行固定 CLI 的 `doctor --json`（要求 `ok=true`）和 `browser path`，
  再由真实透明层 render/alpha probe 完成最终门禁；只有真实 `preview/render` smoke 证明兼容后，
  才允许复用 Remotion 已验证的 Headless Shell。
- FFmpeg/ffprobe 由 MYStudio 统一预检并注入同一组共享绝对路径，禁止 HyperFrames 自己下载或写入
  `node_modules`、`userData/ffmpeg`、Skill 缓存或章节目录。
- sidecar 只写当前项目/章节/revision 的隔离工作区；主进程必须对输出做绝对路径、尺寸、fps、时长、
  alpha、媒体流、版本和 SHA 校验，再登记为 derived asset。sidecar 的 MP4、日志、预览或
  `publish` 结果不能直接成为 MYStudio 正式 evidence。

因此 HyperFrames 是“动效素材生成 sidecar”，不是第二个正式 renderer：用户只在 MYStudio UI
中预览和确认；任何 `npx hyperframes ...` 命令只属于开发、CI smoke 或诊断文档。

## 视频工作流插件的数据与状态边界

跨层主链固定为：

```text
StoryboardItem.ttsSpokenText
  -> managed Python TTS WAV + shot-scoped audio binding
  -> Remotion StoryboardShot
  -> MLX 0.4.1 canonical-text alignment
  -> video-use chapter run（EDL / 字幕时间 / 调色 / preview / self-eval）
  -> 用户确认
  -> editable-edl（默认）或 clean flat-shot-mp4（高级）
  -> HyperFrames overlay/no-op
  -> Remotion ChapterVideo
  -> final-output-qc（只读）
```

video-use 与 HyperFrames 每章默认启用。章节 revision 状态为 `preparing`、`aligning`、`editing`、`previewing`、`evaluating`、`awaiting-review`、`applying`、`ready`、`blocked`；任一必需输入、对齐、EDL、preview/self-eval、用户确认、overlay 或 evidence 失败都只能进入 `blocked`，不能静默继续或切换 renderer。重试从失败阶段恢复，但正式渲染必须使用新鲜 accepted revision。

`VideoUseChapterRunV1` 负责 `projectId/chapterId/revisionId`、`shots[]`、`ttsSpokenText`、`audioRef`、`videoRef`、输入 SHA、feature flags 和 runtime/tool manifest；`VideoUseChapterArtifactV1` 负责 word/character alignment、sentence cues、EDL、字幕、grade、overlay slots、preview、self-eval、mode、state 和输出 evidence。video-use 原始秒制保留在 evidence，adapter 校验后转换为 `TimelineTimeUs`。普通字幕由 Remotion track 合成，动效字幕由 HyperFrames 透明素材合成；`flat-shot-mp4` 必须保留独立字幕/overlay metadata，禁止二次烧录。无动效时也要提交 HyperFrames `no-op` artifact。

`HyperFramesOverlayRequestV1` 只接受最终时间线的微秒窗口、effect/template 参数、宽高/fps、alpha/format 要求、源 revision 和 overlay SHA；`VideoWorkflowPluginStatusV1` 记录 app code version、上游 URL/commit/license、managed Python/profile、Electron 内置 Node（要求 >=22）、浏览器、FFmpeg/ffprobe、model cache 和 compatibility result。两类字段都进入 revision/evidence，不直接写入最终 MP4。

所有跨层调用都通过 typed IPC/worker adapter 传递 project/chapter/revision 与 SHA，不让 renderer 直接读取 video-use 原始 JSON。`apps/backend/requirements.txt` 继续只归 TTS/STT；video-use 复用 managed Python/site-packages，但使用独立 `requirements-video-use.lock`/profile marker，禁止 `video-use-runtime` venv。FFmpeg/ffprobe 只使用 MYStudio 统一预检出的同一组共享绝对路径。

应用代码、Remotion/HyperFrames/video-use worker revisions 随 MYStudio 应用升级；设置页只准备运行时并由用户手动应用。自动检查不能代替应用更新，任一新组合校验失败都恢复最近一次 verified manifest，并让章节保持 `blocked`。Seedance Prompt Skill 本轮暂缓，不参与运行时 readiness 或证据门禁。

### 首轮代码落点与当前实现边界（2026-08-09）

下列代码已经进入当前应用源码，并由同一条主进程链路使用：

| 代码落点 | 当前行为 | 明确限制 |
|---|---|---|
| `apps/frontend/electron/rendering/contracts/video-workflow.ts`、`video-workflow-ipc.ts` | 统一契约、运行时状态、EDL 秒制到 `TimelineTimeUs` 的边界和 IPC 校验 | 不接受 renderer 直接传 shell 命令或未验证 JSON |
| `apps/frontend/electron/rendering/plugins/video-workflow/video-workflow-runtime.ts` | 解析 `<storageBasePath>/python`、独立 video-use profile、Electron 内置 Node（要求 >=22）、共享 FFmpeg/ffprobe，并执行版本、profile、依赖和 HyperFrames `doctor --json`/`browser path` 探针 | 探针不会偷偷下载依赖或浏览器，也不会创建 `video-use-runtime` venv；缺少已验证浏览器路径保持 `blocked` |
| `apps/frontend/electron/rendering/plugins/video-use/video-use-adapter.ts`、`apps/backend/video_use/worker.py` | 使用 managed Python 运行固定 checkout、MLX 原文对齐、EDL/字幕/调色/preview/self-eval worker；运行时或 pinned upstream 缺失时返回 `blocked`，不伪造 artifact | 应用安装态的一章真实媒体验收仍需单独记录，代码路径不能替代真实证据 |
| `apps/frontend/electron/rendering/plugins/hyperframes/hyperframes-adapter.ts`、`hyperframes-worker.ts` | 有 overlay 窗口时要求 Electron 内置 Node（要求 >=22）、已验证浏览器和共享 FFmpeg，生成透明 HTML overlay 并做 alpha/codec probe；无窗口时写入可审计 `noop` | 缺少 `doctor.ok`、browser path 或透明层 probe 时明确 `blocked`；不调用隐式 `browser ensure` |
| `apps/frontend/electron/rendering/plugins/video-workflow/video-workflow-artifact-store.ts`、`video-workflow-chapter-service.ts` | 按 `project/chapter/revision` 读取并校验双 artifact，统一调用章节 gate | 缺失、损坏或 identity/hash 漂移不会回读旧 revision |
| `apps/frontend/electron/main/main.ts` 与 `remotion-chapter-renderer.ts` | Remotion 原生 Studio 入队前、ChapterVideo worker 启动前各执行一次 gate；accepted HyperFrames 的透明输出经同一 MediaBridge capability URL 注入 ChapterVideo | gate 未通过时不创建正式章节 render job；overlay 文件/SHA/alpha 不可读时也阻塞；no-op 不注册媒体 |
| `apps/frontend/components/panels/settings/PluginSettingsTab.tsx`、`PythonSettingsTab.tsx`、`comfy-engine/ComfyEngineSettingsSection.tsx`、`apps/frontend/components/panels/tts/LocalTtsPanel.tsx` | 统一「本地配置」页，当前区块顺序为 Python → ComfyUI 引擎（含「模型」页签） → 视觉审核(VLM) → TTS → 音效(SFX) → 视频插件(video-use/HyperFrames/Remotion)；顶部按优先级准备按钮复用现有 hook | 用户不使用 CLI；TTS 模型写入 `<storageBasePath>/comfyui/models/TTS`（09-10 统一家；旧版 `model/TTS`、`tts-models` 仅作迁移兼容）；未就绪或下载失败时显示阻塞原因，不创建独立 venv 或第二份 FFmpeg |

因此，当前交付是“代码边界、契约、持久化和正式渲染门禁已接入”，不是“已经下载并运行上游 video-use/HyperFrames 的真实媒体生成闭环”。真实一章仍须在 macOS Apple Silicon 上按[完整视频链路](../workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md)完成本地 TTS、MLX 对齐、上游 worker、用户确认、透明层探针和 Remotion evidence 验收后，才能把相应插件状态标为 `ready`。

## 前端入口

| 文件/目录 | 作用 |
|---|---|
| `apps/frontend/App.tsx` | 应用根组件 |
| `apps/frontend/main.tsx` | React renderer 启动入口 |
| `apps/frontend/components/Layout.tsx` | 主布局、侧栏、头部和页面容器 |
| `apps/frontend/components/Dashboard.tsx` | 项目入口/首屏 |
| `apps/frontend/components/panels/SettingsPanel.tsx` | 设置页、外观、API、统一本地配置、存储、开发入口 |
| `apps/frontend/components/panels/studio/index.tsx` | MY 工作流主面板（八页签，含两个 ComfyUI 画布页签） |
| `apps/frontend/components/panels/assist/ComfyWorkspace.tsx` | 「本地模型」全屏 ComfyUI 工作区（画布 / 配音室 / 漫影生图三态） |
| `apps/frontend/components/panels/assets/` | 资产库、角色详情、音色分配 |
| `apps/frontend/components/panels/tts/LocalTtsPanel.tsx` | 本地 TTS 管理面板 |
| `apps/frontend/components/UpdateDialog.tsx` | 应用更新提示弹窗 |

当前左侧主导航由 `mainNavItems` 提供，主要入口是 `概览`、`MY 工作流`、`技能`、`资产`、`本地模型`（原「辅助」，全屏 ComfyUI 工作区）、`导出`、`产物`、`自媒体`，底部为 `设置`（TTS 一级页已撤，面板内嵌于 设置→本地配置；配音室在「本地模型」页）。沉浸视图（本地模型、工作流画布页签）无侧栏无头部，导航走全局悬浮球 `AppOrb`。

`script`、`characters`、`scenes`、`director`、`sclass` 仍在 `Layout.tsx` 和 `media-panel-store.ts` 中保留，用于旧链路和内部跳转。例如产物页的 `智能切割` 会 `setActiveTab('director')`，旧剧本面板可以跳到 `characters`、`scenes` 或 `director`。修改这些兼容工作区时，需要同时确认主导航文档是否要说明入口边界。

内部高级工作区的主要维护入口：

| 工作区 | 主要文件 | 用户文档 |
|---|---|---|
| 剧本 | `apps/frontend/components/panels/script/` | [兼容剧本编辑工作区](../director/LEGACY_SCRIPT_WORKSPACE_GUIDE.md) |
| 角色 | `apps/frontend/components/panels/characters/` | [角色生成与衣橱](../assets/CHARACTER_GENERATION_GUIDE.md) |
| 导演 | `apps/frontend/components/panels/director/` | [高级导演与 S级镜头](../director/ADVANCED_DIRECTOR_TOOLS.md) |
| S级 | `apps/frontend/components/panels/sclass/`、`components/features/storyboard/quad-grid/`、`components/features/storyboard/angle-switch/` | [高级导演与 S级镜头](../director/ADVANCED_DIRECTOR_TOOLS.md) |
| 场景多视角 | `apps/frontend/components/panels/scenes/generation-panel.tsx` | [场景库多视角与四视图](../assets/SCENE_MULTIVIEW_GUIDE.md) |

UI 样式和主题主要分布在：

| 文件/目录 | 作用 |
|---|---|
| `apps/frontend/components/ui/` | 通用 UI 组件 |
| `apps/frontend/components/InteractionEffects.tsx` | 点击、动态反馈和音效相关体验 |
| `apps/frontend/lib/sound/interaction-sound.ts` | 交互音效逻辑 |
| `apps/frontend/lib/constants/visual-styles.ts` | 内置视觉风格配置 |
| `apps/frontend/assets/studio-manuals/` | 视觉手册和风格资产 |
| `apps/frontend/components/panels/assets/DefaultStylesGrid.tsx` | 默认风格列表和视觉手册查看 |
| `apps/frontend/components/panels/assets/CustomStylesGrid.tsx` | 我的风格、新建风格和复制默认风格 |
| `apps/frontend/components/panels/assets/VisualManualEditorDialog.tsx` | 视觉手册模块编辑 |

组件目录按“通用原语、跨面板业务控件、设置专属控件”分层：

```text
apps/frontend/components/
├── ui/                                      # 无业务状态的视觉/交互原语
├── features/
│   ├── visual-style/style-picker/            # 视觉风格业务控件
│   ├── cinematography/cinematography-profile-picker/
│   └── playback/audio-player.tsx             # 播放 store/事件契约适配
└── panels/settings/
    └── image-host/                            # 设置专属图床对话框
```

`components/features/<domain>/` 允许依赖对应领域的 store 或类型契约，
但应保持跨面板复用；`components/panels/settings/<domain>/` 只承载设置页
范围内的控制器组合和对话框。`components/ui/` 不应重新接入 provider、生成、
播放或持久化状态。当前图床设置的控制器和标签页仍由
`panels/settings/ImageHostSettingsContainer.tsx` 与
`ImageHostSettingsTab.tsx` 负责，专属 Add/Edit 对话框位于
`panels/settings/image-host/`；store、上传适配器和 Electron IPC 继续留在
各自的状态、lib 和 electron 分层。

`apps/frontend/components/WardrobeModal.tsx` 已完成当前源码引用核验，当前
无 import/reference；本批保留文件，不在未取得单独授权前删除。核验记录见
`.trellis/tasks/archive/2026-07/07-25-frontend-components-modularization/research/wardrobe-modal-reference-audit.json`。

风格管理用户文档见 [视觉风格管理](../assets/VISUAL_STYLE_MANAGEMENT.md)。

## Electron 主进程与 IPC

| 文件 | 作用 |
|---|---|
| `apps/frontend/electron/main/main.ts` | Electron main process、窗口、IPC、文件、FFmpeg、TTS 控制 |
| `apps/frontend/electron/preload/preload.ts` | renderer 暴露的安全桥接 API |
| `apps/frontend/electron/tts/tts-runtime.ts` | Python 配置、TTS sidecar 启停、token 注入、模型缓存路径 |
| `apps/frontend/electron/storage/storage-paths.ts` | 用户数据和项目存储路径 |
| `apps/frontend/electron/storage/storage-manager.ts` | `storage-config.json`、统一 storage base path 与 `projects`/`media`/`skills` 根目录 |
| `apps/frontend/electron/storage/studio-assets-storage.ts` | 资产库 SQLite/文件存储 |
| `apps/frontend/electron/storage/studio-skills-storage.ts` | 项目 skills 文件存取 |
| `apps/frontend/electron/storage/studio-visual-manuals-storage.ts` | 视觉手册读写 |
| `apps/frontend/types/update.ts` | 应用更新版本清单和检查结果类型 |

Renderer 不能直接访问 Node 能力。需要新增桌面能力时，通常按这个顺序接线：

```text
renderer component
  -> window.<preload API>
  -> ipcRenderer.invoke(...)
  -> ipcMain.handle(...)
  -> Electron main/helper module
```

新增 IPC 后，同步更新：

- `apps/frontend/electron/preload/preload.ts`
- `apps/frontend/types/electron.d.ts`
- 对应的 main process handler
- focused Vitest 覆盖

### 自媒体（AiToEarn 集成）

独立的 `自媒体` 工作区，账号/发布链路全部走 Electron main，renderer 只拿脱敏摘要。
`apps/frontend/electron/aitoearn/` 是唯一的 AiToEarn 主进程集成根目录，也是上游快照升级的唯一边界；renderer-facing 的 `self-media` 类型、面板、store、持久化用户数据目录和 IPC 通道名称不随物理目录迁移。

| 文件 | 作用 |
|---|---|
| `apps/frontend/types/self-media.ts` | provider/account/draft/task/progress 归一化契约 |
| `apps/frontend/lib/self-media/` | 运行时校验、能力描述、任务状态机、IPC 契约 |
| `apps/frontend/stores/self-media/` | 项目级 drafts/tasks/history 与脱敏账号摘要 |
| `apps/frontend/components/panels/self-media/` | 账号 / 编辑发布 / 任务 / 历史面板 |
| `apps/frontend/electron/ipc/self-media/self-media-ipc.ts` | handler 注册、进度事件扇出、任务生命周期 |
| `apps/frontend/electron/aitoearn/provider-registry.ts` | provider 注册与路由；无 bridge 时 provider 保持 `enabled: false` |
| `apps/frontend/electron/aitoearn/providers/aitoearn-local/` | MYStudio 自有适配层：登录/发布编排、资产安全、兼容 shim |
| `apps/frontend/electron/aitoearn/vendor/aitoearn-core/` | 只读、版本锁定的上游快照，**禁止就地修改** |
| `apps/build/scripts/sync-aitoearn-core.mjs` | 上游快照 `check` / `dry-run` / `apply` 守卫 |

边界规则：

- 上游快照只读。修复兼容问题时在 `providers/aitoearn-local/compatibility/` 加具名 shim + 回归测试，不改 `vendor/`；shim 通过 `apps/frontend/config/electron-vite.config.ts` 的 `sharedAlias` 生效。
- 原生模块禁止进入 main bundle。上游 `sharp` 只用来读图片宽高，已由 `compatibility/sharp.ts` 用纯 JS 实现替换；否则打包版会在启动时报 `Could not load the "sharp" module` 并直接崩溃。
- 凭据走 `safeStorage` 凭据保险库，不落 renderer 状态、项目文件和诊断上下文。
- `aitoearn-local` 是唯一 provider；失败不做静默回退，也不伪造成功。
- 升级前先跑 `node ./build/scripts/sync-aitoearn-core.mjs check` 与 `dry-run`，写集必须只落在 vendor 车道。

详见 [自媒体 / AiToEarn 集成边界](./self-media-aitoearn-integration.md)。

### 技能编辑：如何从 UI 读到磁盘

下面所有 `apps/...` 都是 `<repo-root>/apps/...` 下的产品源码，应用运行时不在
源码树写入技能；运行时可写目标是 `<storageBasePath>/skills/`。真实调用链为：

```text
apps/frontend/components/panels/skills/index.tsx
  -> apps/frontend/electron/preload/preload.ts
  -> apps/frontend/electron/ipc/assets/studio-content-ipc.ts
  -> apps/frontend/electron/storage/studio-skills-storage.ts
  -> apps/frontend/electron/storage/storage-manager.ts
```

| 入口 | 责任 |
|---|---|
| `components/panels/skills/index.tsx` 的 `SkillsView` | 显示列表和编辑器；只将 `relativePath` 传给 `window.studioSkills`。 |
| `electron/preload/preload.ts` | 将 `list`、`readText`、`writeText`、`createText`、`deleteText`、`restoreText` 分别桥接到 `studio-skill-list`、`studio-skill-read-text`、`studio-skill-write-text`、`studio-skill-create-text`、`studio-skill-delete-text`、`studio-skill-restore-text`。 |
| `electron/ipc/assets/studio-content-ipc.ts` 的 `registerStudioContentIpcHandlers()` | 注册 `studio-skill-*` handler；读写前取得 `getSkillsRoot()`，同步 seed，并交给存储模块。 |
| `electron/storage/studio-skills-storage.ts` 的 `getStudioSkillStorageRoot()`、`resolveStoredStudioSkillPath()` | 前者返回 `<storageBasePath>/skills`；后者规范化相对路径、拒绝绝对路径与 `../` 逃逸，并保证结果仍在 storage root 内。裸 `foo.md` 会写为 `agent_skills/foo.md`。 |
| `electron/storage/storage-manager.ts` 的 `createStorageManager()`、`getSkillsRoot()` | 读取 `<userData>/storage-config.json`，按 `storageConfig.basePath`、legacy `projectPath` 的父目录、`<userData>` 的顺序解析 storage base path，再追加 `skills`。 |

内置技能约定的分类相对前缀为 `agent_skills/`、`art_skills/`、`story_skills/` 与
`production_skills/`；它们决定 UI 的分类标签。UI 和 IPC 实际允许 storage root
内任意相对 `.md` 路径，未知的嵌套前缀会显示为 `other`；裸 `foo.md` 才会在
规范化时自动写为 `agent_skills/foo.md`。任何绝对路径、`../` 越界路径或非 `.md`
路径都会被拒绝。

内置 seed 来自 `apps/frontend/assets/studio-manuals/`（产品源码、应用运行时只读）；
开发态由 `main.ts` 在 `APP_ROOT/frontend/assets/studio-manuals`、
`app.getAppPath()/frontend/assets/studio-manuals` 中选择可用副本（`APP_ROOT` 为
electron-vite 的 `apps/`，对应 `out/main` 的 `../..`）；打包后优先使用
`process.resourcesPath/studio-manuals`（`electron-builder` extraResources 从
`frontend/assets/studio-manuals` 复制）。macOS 的
`~/Library/Application Support/toonflow/data/skills/` 只是只读 legacy 回退/迁移 seed，
不是当前用户存储。用户副本和 `.studio-skills-manifest.json` 只在
`<storageBasePath>/skills/`。项目开发技能
`<repo-root>/.agents/skills/<skill>/SKILL.md` 与全局
`~/.codex/skills/<skill>/SKILL.md`、`~/.agents/skills/<skill>/SKILL.md` 只指导
AI/开发工具，不是产品 `skills/`。

## 状态和存储

| 文件 | 作用 |
|---|---|
| `apps/frontend/lib/storage/indexed-db-storage.ts` | Electron fileStorage 与浏览器 local/idb fallback |
| `apps/frontend/lib/storage/project-storage.ts` | 项目级 split storage |
| `apps/frontend/lib/storage/storage-migration.ts` | 单体存储到项目文件的启动期迁移 |
| `apps/frontend/lib/project/project-duplication.ts` | 项目文件复制与 payload 重写 |
| `apps/frontend/lib/project/project-switcher.ts` | 多 store 项目切换编排 |
| `apps/frontend/lib/media/` | 图片/视频存取、图床、远程图片和媒体处理 |
| `apps/frontend/lib/sound/` | AudioContext 音效与交互音效意图 |
| `apps/frontend/lib/events/event-bus.ts` | 跨面板事件总线 |
| `apps/frontend/stores/app/app-settings-store.ts` | 外观、侧栏、存储等应用设置 |
| `apps/frontend/stores/ai/api-config-store.ts` | API 服务商、模型映射、Agent 绑定、本地 TTS provider |
| `apps/frontend/stores/tts/tts-store.ts` | TTS profile、角色 speaker 绑定、分镜语音行 |
| `apps/frontend/stores/media/media-store.ts` | 媒体/素材面板状态 |
| `apps/frontend/stores/library/character-library-store.ts` | 角色库状态 |
| `apps/frontend/stores/library/scene-store.ts` | 场景库状态 |

项目数据保存在：

```text
<storageBasePath>/projects
```

独立资产库和运行时缓存不在项目 JSON 里：

```text
<storageBasePath>/assets
<storageBasePath>/python
<storageBasePath>/comfyui/models/TTS
```

当前 `设置 -> 存储` 的统一导入/导出/移动覆盖 `projects/`、`media/`、`assets/` 和 `skills/`；Python runtime 与 TTS 模型缓存会按新的 `<storageBasePath>` 重新寻址，但不随数据迁移、导入或导出自动复制。

旧 `moyin-*` 文件会在读取时迁移到 `mystudio-*` 命名。文档见 [存储与数据迁移](./STORAGE_AND_DATA.md)。

## 本地 TTS 与 Python

| 文件 | 作用 |
|---|---|
| `apps/backend/tts/main.py` | sidecar 启动薄壳（转发 `server.py`） |
| `apps/backend/tts/server.py` | TTS sidecar HTTP API 与路由 |
| `apps/backend/tts/storage.py` | `tts.sqlite` profile/generation 存储 |
| `apps/backend/tts/generation_routes.py`、`model_routes.py` | 生成与模型管理路由（旧 `engine.py`/`catalog.py`/`model_cache.py` 已重构并入） |
| `apps/backend/tts/model_inventory.py`、`runtime_state.py` | 模型目录探测与运行时状态 |
| `apps/backend/requirements.txt` | Python 依赖清单 |

### 两套 Python 的运行边界

| 环境 | 由谁选择 | 典型用途 | 是否进入安装包 | 依赖安装位置 |
|---|---|---|---|---|
| 开发/构建 Python | 开发者 shell 的 `python3` 或显式激活的开发环境；仓库没有固定 `.venv` | `apps/build/**/*.py`、后端 unittest、只读审计和 CI 辅助脚本 | 否 | 开发者自己的 Python site-packages/虚拟环境；不写入 `apps/backend/` |
| 应用运行 Python | Electron 设置页下载/校验的 CPython 3.12；路径为 `<storageBasePath>/python` | TTS sidecar、Daojie 显式 HTTP-TTS 直跑，以及 video-use 的共享 profile | 否；安装包只带源码 | TTS 与 video-use 都复用该 managed Python/site-packages；各自使用独立 lock/marker，冲突时 blocked 并恢复已验证组合 |

安装包“再配置一套 Python”的准确含义是：安装包本身不携带这份解释器，首次在设置页点击 `开始配置` 时，Electron 从配置/默认 URL 下载 CPython 3.12 压缩包到 `<storageBasePath>`，解压为 `python/`，校验版本后再安装 `apps/backend/requirements.txt`。`setup.sh`/`setup-win.ps1` 只安装 Node 依赖并提示用户稍后配置，不负责把 Python 写进源码目录。

当前原则：

- 应用启动不自动配置 Python。
- `设置 → 本地配置 -> Python 运行环境 -> 开始配置` 才会配置 Python 3.12 和依赖。
- TTS 后端不随应用启动自动拉起。
- 安装包不应携带大型 `backend/python`。
- 正式 runtime 根目录只有 `<storageBasePath>/python`；Electron 以其中的平台 Python 启动 sidecar，并以 `<storageBasePath>/comfyui/models/TTS` 和 `<storageBasePath>/TTS/runtime` 管理模型与 sidecar 数据（旧版 `model/TTS`、`tts-models` 与 `<userData>/tts-runtime` 仅作迁移兼容）。
- 如果工作区里存在 `apps/backend/python`，它是本地/历史 runtime 残留，不是本地开发需要的第二套正式 Python，不得被源码、构建脚本或新测试当作可选 runtime；打包配置继续排除它。
- Daojie 的显式 HTTP-TTS 直跑按 `MYSTUDIO_STORAGE_BASE_PATH`、`<userData>/storage-config.json`、macOS development fallback 的顺序解析受管理的 `<storageBasePath>/python`；默认 `video:chapter001` 自动链不会注入 `MANYING_TTS_USE_HTTP=1`，因此不会把该兼容路径当作默认视频链的一部分。
- video-use 的开发 worker 可以使用开发者当前 Python 做本地测试，但打包应用运行期间必须从同一个 `pythonRuntimeDir` 使用受管理的 `<storageBasePath>/python`（当前 macOS 为 `~/Library/Application Support/漫影工作室/python`）作为解释器来源。当前实现目标是在准备时复用该 managed Python 的 site-packages，使用独立 `requirements-video-use.lock`、profile marker、`pip check`/import/fixture smoke、TTS 全量回归和整套 runtime 回滚；禁止创建 `video-use-runtime` venv。冲突时章节保持 `blocked` 并恢复最近一次已验证组合，不能把 video-use 依赖直接追加到 TTS requirements，也不能让现有 TTS 安装器误装 video-use。

相关文档：

- [Python 与本地 TTS 配置](../settings/PYTHON_TTS_SETUP.md)
- [本地 TTS 声音克隆与音色分配流程](../panels/voicebox-voice-cloning-flow.md)
- [本地 TTS 后端参考](../../apps/backend/README.md)

## AI 与生成链路

| 文件/目录 | 作用 |
|---|---|
| `apps/frontend/lib/ai/ai-manager.ts` | AI 统一入口 |
| `apps/frontend/lib/ai/config/store-adapter.ts` | AI 运行代码访问 API 配置 Zustand store 的唯一适配边界 |
| `apps/frontend/lib/ai/core/` | AI 类型、Worker 协议、队列、轮询、提示词和 provider 契约 |
| `apps/frontend/lib/ai/core/providers/` | provider 类型、默认配置、模型能力分类、品牌映射和 endpoint 路由 |
| `apps/frontend/lib/ai/core/services/` | API key 解析、脱敏、轮换、黑名单和 provider manager |
| `apps/frontend/lib/ai/workers/` | AI Worker 入口、运行生命周期和 Worker 辅助模块 |
| `apps/frontend/lib/ai/feature-router.ts` | 功能到 provider/model 的路由 |
| `apps/frontend/lib/ai/image-generator.ts` | 图片生成封装 |
| `apps/frontend/lib/network/cors-fetch.ts` | 浏览器开发代理与 Electron 直连封装 |
| `apps/frontend/lib/media/remote-image-fetch.ts` | 远程图片大小、超时和 data URL 转换 |
| `apps/frontend/lib/media/image-host.ts` | 外部图床上传适配 |
| `apps/frontend/lib/ai/prompt-polisher.ts` | 提示词润色 |
| `apps/frontend/components/api-manager/` | API 管理 UI |

`apps/frontend/lib/ai/` 是前端可复用 AI 代码的唯一源码模块。旧的
`apps/frontend/app/` 是未接线的 Next 风格残留，已删除；图片 URL 转换统一
复用 `apps/frontend/lib/network/cors-fetch.ts` 与 `apps/frontend/lib/media/remote-image-fetch.ts`，
不再依赖 `/api/proxy-image`。旧的 `apps/frontend/lib/api-key-manager.ts` 兼容
re-export 已移除(实现现位于 `apps/frontend/lib/ai/core/services/api-key-manager.ts`);
新代码必须从 `apps/frontend/lib/ai/core/`
导入 provider、模型路由和 API key 服务。

AI 运行模块及图床等相邻生成辅助模块读取供应商、模型绑定、端点元数据和并发设置时，统一经过
`apps/frontend/lib/ai/config/store-adapter.ts`；`stores/ai/api-config-store.ts`
仍是 Zustand 持久化、迁移和状态变更的唯一所有者。这样可以避免在多个 AI
运行文件中散落对 Zustand store 的直接依赖。

本地 TTS provider 默认在 `api-config-store.ts` 中注册为：

```text
manying-local-tts
```

配置中心默认绑定模型是：

```text
qwen-tts-1.7B
```

注意：部分新建 profile 或未绑定分镜的内部 fallback 仍可能使用轻量 `0.6B` 作为交互默认；涉及默认模型体验时要同时核对 `api-config-store.ts`、`model-catalog.ts`、`tts-store.ts` 和相关 UI。

## 剪辑与时间线成片链

当前自动成片和章节工作台共用同一条权威链：

```text
AI storyboard materials + current shot slots + director plan
  -> buildChapterEditingProject
  -> EditingProjectV1 / static Studio projection
  -> TimelineRenderPlan (validated, schema=1)
  -> native Remotion Studio (Timeline / Inspector / Preview / Render)
  -> Remotion queue (StoryboardShot or ChapterVideo)
  -> renderMedia (fixed bundle + Headless Shell)
  -> current MP4 + ffprobe + SHA-256 + Remotion evidence
```

主要入口：

| 文件 | 作用 |
|---|---|
| `apps/frontend/lib/studio/editing/chapter-editing-pipeline.ts` | UI 自动链、剪辑工作台和 CLI 共用的 EditingProject/typed render 编排 |
| `apps/frontend/lib/studio/editing/timeline-render-compiler.ts` | 将当前 EditingProject revision 编译为 `TimelineRenderPlan` |
| `apps/frontend/electron/rendering/contracts/timeline-renderer.ts` | schema-1 request、progress、Remotion evidence 与迁移兼容校验 |
| `apps/frontend/electron/rendering/runtime/renderer-router.ts` | Remotion-only 能力校验；未知/不支持效果 fail closed |
| `apps/frontend/electron/rendering/plugins/remotion/composition/` | Player 与固定 bundle 共用的 composition、音频、字幕、HyperFrames `overlayClips`、panZoom 和转场 |
| `apps/frontend/electron/rendering/plugins/remotion/browser/` | `<userData>/remotion-runtime` 浏览器状态、主动下载和版本状态 |
| `apps/frontend/electron/rendering/plugins/remotion/media-bridge/` | `127.0.0.1` capability URL、白名单、Range/CORS 与 session 生命周期 |
| `apps/frontend/electron/rendering/plugins/remotion/renderer/` | 独立 Electron utility worker、取消、raw MP4 和 Remotion adapter |
| `apps/frontend/electron/rendering/plugins/remotion/queue/` | shot/chapter 持久队列、取消、重试、依赖和项目切换门禁 |
| `apps/frontend/electron/rendering/plugins/remotion/studio/` | loopback Studio server、动态端口、AST 投影/回写和原生 Render bridge |
| `apps/frontend/stores/editing/editing-store.ts` | 项目级 EditingProject、Remotion job 与 evidence 持久化 |
| `apps/build/timeline/run-full-pipeline.ts`（正式全链路：video-use → HyperFrames → gate → authority） | 使用同一已验证 plan 的独立 Remotion 第一章入口 |
| `apps/build/chapter_video/automate-chapter001-video.mjs` | Python 素材生成后调用 timeline runner，并汇总最终验收报告 |
| `apps/build/chapter_video/` | 《道劫》Python 素材生成、连续性审核与 Toonflow fixture 构建工具；生产模块在 `pipeline/`，Python 测试在 `tests/`，Node 辅助测试与编排脚本同域；与 timeline runner 同属构建时边界 |

Renderer UI 通过 typed preload IPC 调 Remotion queue、Studio session 和 runtime bridge；direct
CLI 使用本地 `vite-node` 加载同一套 Remotion composition/worker。Remotion Player 只接收
media-bridge capability URL；MP4 导出由独立 utility worker 使用固定 bundle，`renderMedia`
直接发布 H.264/AAC。宿主只执行只读 `ffprobe`、SHA-256 和 current-slot 原子发布，不做
FFmpeg concat、loudnorm、二次编码或失败回退。

`TimelineRenderRecord` 必须匹配当前项目、episode、EditingProject ID、revision 和 source snapshot。
人工编辑提升 revision 后，旧 record 只保留审计价值，不再证明当前版本已成片。历史
`VideoCandidate`、旧 track/concat 产物和旧 renderer 配置只能作为迁移审计数据，不能被工作流、
Studio 或 queue 重新选择。

## 资产库与角色音色

| 文件 | 作用 |
|---|---|
| `apps/frontend/components/panels/assets/StudioAssetLibrary.tsx` | 资产库列表 |
| `apps/frontend/components/panels/assets/AddAssetDialog.tsx` | 添加角色、场景、道具等资产 |
| `apps/frontend/components/panels/assets/StudioAssetDetailDialog.tsx` | 资产/角色详情 |
| `apps/frontend/components/panels/assets/PropsLibrary.tsx` | 本地道具目录视图 |
| `apps/frontend/components/panels/assets/RoleVoiceAssignDialog.tsx` | 角色音色分配弹窗 |
| `apps/frontend/components/panels/assets/role-audio-auto-assign.ts` | 自动分配音频 |
| `apps/frontend/lib/studio/voice-assigner.ts` | 声音匹配辅助逻辑 |
| `apps/frontend/lib/studio/voice-sync.ts` | 角色声音同步 |

角色音色绑定链路：

```text
角色ID
  -> character:<角色ID>
  -> ProjectVoiceBinding
  -> VoiceProfile
  -> referenceAudioPath/referenceText
```

用户文档见 [资产库使用与存储](../assets/ASSET_LIBRARY_GUIDE.md)、[资产导入与管理](../assets/ASSET_IMPORT_AND_MANAGEMENT.md) 和 [资产库音色分配](../assets/ASSET_AUDIO_ASSIGNMENT.md)。

## 打包与安装测试

| 文件 | 作用 |
|---|---|
| `apps/build/packaging/setup.sh` | macOS/Linux 依赖准备 |
| `apps/build/packaging/setup-win.ps1` | Windows 依赖准备 |
| `apps/build/packaging/build-mac.sh` | macOS 打包入口 |
| `apps/build/packaging/build-desktop.mjs` | 桌面构建辅助脚本 |
| `apps/build/smoke/smoke-desktop.mjs` | packaged/installed app smoke |
| `apps/build/remotion/bundle.mjs` | 固定 Remotion composition bundle 与 manifest |
| `apps/build/remotion/bundle-preflight.mjs` | 打包前固定 bundle、版本和内容哈希校验 |
| `apps/build/remotion/verify-packaged-remotion.mjs` | bundle、arm64 compositor 和禁止内容核验 |
| `apps/build/remotion/upgrade.mjs` | 同大版本 Remotion/Mediabunny/Skills/bundle 升级链 |
| `apps/frontend/config/electron-builder.yml` | Electron Builder 配置 |

`build-desktop.mjs` 会把 Electron/Vite 中间产物和 Electron/electron-builder 缓存放到 `apps/release/` 下，并将临时 staging 产物整理到 `apps/release/build/<target>-<arch>`。macOS 当前入口是：

```text
npm run build:mac -> sh ./build/packaging/build-mac.sh --arm64 -> node ./build/packaging/build-desktop.mjs --mac --arm64
  -> node ./build/packaging/install-and-smoke.mjs -> ditto 覆盖安装 -> installed smoke -> 关闭应用
```

发布前至少跑：

```bash
cd apps
npm run typecheck
npm run lint
npm run test
npm run build:mac
```

`build:mac` 已包含覆盖安装与 installed smoke；`npm run smoke:desktop` 仅在需要单独检查
packaged 产物时追加执行。

Remotion 相关发布前检查还包括：

```bash
cd apps
npm run remotion:versions
npm run remotion:smoke:five-shot
npm run remotion:worker:smoke
npm run smoke:installed
```

`npm run remotion:bundle` 是显式重建命令，不是每次打包的隐式步骤。若打包前置校验报告
bundle 缺失、manifest 无效或版本漂移，先运行该命令，再重新运行 `remotion:versions`
和目标打包命令。

`npm run remotion:upgrade -- <4.x.x>` 只接受精确的同大版本目标；5.x 会在修改依赖前拒绝，
并要求新建独立 Trellis 迁移任务。Headless Shell 不随安装包分发，安装态只在设置页主动
下载后才允许 MP4 导出；Player 在未准备 Headless Shell 时仍可预览。

安装和 smoke 流程见 [打包、安装与 Smoke 测试](./PACKAGING_AND_SMOKE_TESTING.md)。

## 重要测试入口

| 范围 | 命令 |
|---|---|
| TypeScript 类型 | `cd apps && npm run typecheck` |
| ESLint | `cd apps && npm run lint` |
| Vitest 全量 | `cd apps && npm run test` |
| TTS runtime | `cd apps && npm test -- tts-runtime.test.ts` |
| 打包脚本契约 | `cd apps && npm test -- build-scripts.test.ts` |
| 启动/白屏 guard | `cd apps && npm test -- renderer-startup.test.ts app-lifecycle.test.ts main-startup.test.ts` |
| 后端契约 | `cd apps && PYTHONPATH=backend python3 -m unittest discover -s backend/tests` |

## 修改文档时的同步点

- 设置页结构变更：同步 `SETTINGS_PANEL_OPERATIONS.md`、`WORKFLOW_GUIDE.md`、`API_SETTINGS_GUIDE.md`、`PYTHON_TTS_SETUP.md`。
- 时间线 renderer、Remotion 版本/浏览器、媒体桥、bundle 或 evidence 变化：同步 `SETTINGS_PANEL_OPERATIONS.md`、`WORKFLOW_GUIDE.md`、`WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md`、`EXPORT_GUIDE.md`、`PACKAGING_AND_SMOKE_TESTING.md`、`TROUBLESHOOTING.md` 与 `.trellis/spec/frontend/timeline-rendering.md`。
- TTS/Python 行为变更：同步 `PYTHON_TTS_SETUP.md`、`voicebox-voice-cloning-flow.md`、`apps/backend/README.md`。
- 存储 key 或迁移逻辑变更：同步 `STORAGE_AND_DATA.md` 和 `ASSET_LIBRARY_GUIDE.md`。
- 打包脚本或安装路径变更：同步 `PACKAGING_AND_SMOKE_TESTING.md` 和 `docs/融合/部署打包与工程化手册.md`。
- UI 外观/主题变更：同步 `APPEARANCE_THEMES.md`。
