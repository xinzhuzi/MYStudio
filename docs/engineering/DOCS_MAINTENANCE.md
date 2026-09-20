# 文档维护清单

本文用于维护 `docs/` 的完整性。改 UI、TTS、打包、存储或工作流时，先用这份清单判断需要同步哪些文档。

## 视频工作流插件同步基线

以下文档必须共同保持同一条链路：`StoryboardItem.ttsSpokenText -> 本地 TTS/WAV -> Remotion StoryboardShot -> MLX 原文强制对齐 -> video-use 完整 EDL/字幕时间/调色/preview/self-eval -> 用户确认 -> editable-edl（默认）或 clean flat-shot-mp4 -> HyperFrames overlay/no-op -> Remotion ChapterVideo -> final-output-qc`。每章 video-use 与 HyperFrames 默认启用，任何必需阶段失败进入 `blocked`。运行时复用 `<storageBasePath>/python`、Electron 内置 Node（运行时要求 >=22） 和一组共享 FFmpeg/ffprobe；禁止独立 video-use venv。主研究、工作流、部署、设置、Python/backend、架构、存储、打包、版本和索引任一发生变更，都要同步本清单列出的对应文档。

## 路径与来源约定

文档中的仓库相对路径一律以 `<repo-root>` 为基准；例如
`docs/engineering/DOCS_MAINTENANCE.md` 是
`<repo-root>/docs/engineering/DOCS_MAINTENANCE.md`，而
`apps/frontend/electron/storage/storage-manager.ts` 是
`<repo-root>/apps/frontend/electron/storage/storage-manager.ts`。两者都是仓库源码/文档，
对已运行的应用只读；npm 命令一律在 `<repo-root>/apps` 运行。

应用会写入的路径一律写作 `<storageBasePath>` 或 `<userData>`，不把它们写成
仓库相对路径；绝对路径只用于本机证据或生成产物的精确位置。尤其要区分：

- `apps/frontend/assets/studio-manuals/` 是内置 seed 源码（应用运行时只读）；
  `<storageBasePath>/skills/` 与其 `.studio-skills-manifest.json` 是用户运行时可写
  数据。
- `<repo-root>/.agents/skills/<skill>/SKILL.md` 是项目开发/AI 指引源码；
  `~/.codex/skills/<skill>/SKILL.md` 和 `~/.agents/skills/<skill>/SKILL.md` 是工具的
  全局 runtime skill 配置。它们都不是 MYStudio 产品 `skills/` 存储。
- macOS legacy `~/Library/Application Support/toonflow/data/skills/` 只可作为 seed
  回退/迁移来源，不能写成当前用户技能目录。

## 文档分类

| 分类 | 目录/文件 | 维护目标 |
|---|---|---|
| 用户操作 | `panels/APP_SHELL_OPERATIONS.md`、`panels/NAVIGATION_GUIDE.md`、`panels/PROJECT_DASHBOARD_GUIDE.md`、`panels/PROJECT_DASHBOARD_OPERATIONS.md`、`workflow/OVERVIEW_PANEL_GUIDE.md`、`workflow/OVERVIEW_PANEL_OPERATIONS.md`、`workflow/WORKFLOW_GUIDE.md`、`workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md`、`workflow/WORKFLOW_STAGE_OPERATIONS.md`、`workflow/WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md`、`workflow/WORKFLOW_ASSET_GENERATION_OPERATIONS.md`、`workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md`（现行 15 列协议与视频工作台；旧两栏界面另标历史）、`workflow/SCRIPT_FORMAT_EXAMPLE.md`、`panels/SKILLS_EDITOR_GUIDE.md`、`panels/SKILLS_EDITOR_OPERATIONS.md`、`panels/SELF_MEDIA_GUIDE.md`、`panels/LOCAL_MODELS_GUIDE.md`、`panels/ASSIST_WORKBENCH_GUIDE.md`、`panels/ASSIST_WORKBENCH_OPERATIONS.md`、`panels/ASSIST_WORKBENCH_PARAMETER_REFERENCE.md`（三篇已过时标注，2026-09-13）、`panels/MEDIA_OUTPUTS_GUIDE.md`、`panels/MEDIA_OUTPUTS_OPERATIONS.md`、`panels/EXPORT_GUIDE.md`、`panels/EXPORT_OPERATIONS.md`、`assets/VISUAL_STYLE_MANAGEMENT.md`、`assets/VISUAL_MANUAL_EDITOR_OPERATIONS.md`、`director/LEGACY_SCRIPT_WORKSPACE_GUIDE.md`、`director/TRAILER_STORYBOARD_REUSE_REFERENCE.md`、`assets/CHARACTER_GENERATION_GUIDE.md`、`director/ADVANCED_DIRECTOR_TOOLS.md`、`director/DIRECTOR_SHOT_CARD_REFERENCE.md`、`director/DIRECTOR_VOICEOVER_REFERENCE.md`、`director/ANGLE_AND_QUAD_GRID_OPERATIONS.md`、`director/SCLASS_GROUP_VIDEO_OPERATIONS.md`、`assets/SCENE_MULTIVIEW_GUIDE.md`、`assets/ASSET_LIBRARY_GUIDE.md`、`assets/ASSET_IMPORT_AND_MANAGEMENT.md`、`assets/ASSET_DETAIL_OPERATIONS.md`、`assets/PROPS_LIBRARY_OPERATIONS.md`、`assets/ASSET_AUDIO_ASSIGNMENT.md`、`assets/ROLE_AUDIO_ASSIGNMENT_REFERENCE.md` | 用户能按界面完成任务 |
| 设置与运行 | `settings/SETTINGS_PANEL_OPERATIONS.md`、`settings/COMFYUI_ENGINE_GUIDE.md`、`settings/MCP_SERVICES_GUIDE.md`、`settings/IMAGE_SIZE_GUIDE.md`、`settings/PYTHON_TTS_SETUP.md`、`settings/TTS_CONFIG_GUIDE.md`、`panels/TTS_PANEL_OPERATIONS.md`、`settings/API_SETTINGS_GUIDE.md`、`settings/API_MANAGER_OPERATIONS.md`、`settings/API_PROVIDER_MODEL_TEST_REFERENCE.md`、`settings/ADVANCED_OPTIONS_GUIDE.md`、`settings/IMAGE_HOST_CONFIG.md`、`panels/APPEARANCE_THEMES.md`、`settings/APP_UPDATE_GUIDE.md`、`settings/DEVELOPMENT_MODE.md`、`settings/SUPPORT_GUIDE.md` | 设置项、按钮、路径和状态文案与当前界面一致 |
| 工程与发布 | `engineering/DEVELOPER_ARCHITECTURE.md`、`engineering/PACKAGING_AND_SMOKE_TESTING.md`、`apps/backend/README.md`、`融合/部署打包与工程化手册.md` | 入口、脚本、打包产物、运行时目录和 smoke 流程可执行 |
| ComfyUI 产线 | `comfyui-kb/参数速查.md`、`comfyui-kb/定制代码地图.md`、`.agents/skills/comfyui/machine.md`、`.claude/knowledge/node-graph-architecture.md` | 产线参数、定制代码生效路径与引擎档案跟引擎/节点现状一致 |
| 存储与迁移 | `engineering/STORAGE_AND_DATA.md` | 维护当前数据契约；历史排查快照不在 `docs/` 中保留 |
| 覆盖审计 | `engineering/DOCS_COVERAGE_AUDIT.md` | 记录界面、源码入口和用户文档覆盖关系 |
| 规划与调查 | `融合/` | 明确“当前已实现”和“后续计划”，避免把未来方案写成现状 |

## 改动同步规则

原则：

- 总览类文档说明页面职责、概念关系和使用场景。
- 操作手册说明按钮、弹窗、状态、禁用原因和失败排查。
- 修改按钮、字段、状态文案或弹窗时，必须同步对应操作手册，不只改 README。

| 改动类型 | 必须检查 |
|---|---|
| 应用外壳、项目头部、侧栏折叠或保存状态变化 | `panels/APP_SHELL_OPERATIONS.md`、`panels/NAVIGATION_GUIDE.md`、`panels/PROJECT_DASHBOARD_OPERATIONS.md` |
| 设置页结构、按钮、文案变化 | `settings/SETTINGS_PANEL_OPERATIONS.md`、`settings/API_SETTINGS_GUIDE.md`、`settings/API_MANAGER_OPERATIONS.md`、`settings/API_PROVIDER_MODEL_TEST_REFERENCE.md`、`settings/PYTHON_TTS_SETUP.md`、`settings/TTS_CONFIG_GUIDE.md`、`settings/ADVANCED_OPTIONS_GUIDE.md`、`settings/IMAGE_HOST_CONFIG.md`、`engineering/STORAGE_AND_DATA.md`、`settings/APP_UPDATE_GUIDE.md`、`settings/DEVELOPMENT_MODE.md`、`engineering/TROUBLESHOOTING.md` |
| Python/TTS runtime 变化 | `settings/PYTHON_TTS_SETUP.md`、`settings/TTS_CONFIG_GUIDE.md`、`panels/TTS_PANEL_OPERATIONS.md`、`apps/backend/README.md`、`engineering/STORAGE_AND_DATA.md`、`panels/voicebox-voice-cloning-flow.md`、`engineering/DEVELOPER_ARCHITECTURE.md` |
| 高级生成选项变化 | `settings/ADVANCED_OPTIONS_GUIDE.md`、`settings/API_SETTINGS_GUIDE.md`、`workflow/WORKFLOW_GUIDE.md`、`engineering/TROUBLESHOOTING.md` |
| 图床平台、默认启用项或上传字段变化 | `settings/IMAGE_HOST_CONFIG.md`、`settings/API_SETTINGS_GUIDE.md`、`engineering/TROUBLESHOOTING.md` |
| 支持作者、联系二维码或商业授权联系入口变化 | `settings/SUPPORT_GUIDE.md`、`settings/LICENSE_GUIDE.md`、`README.md` |
| 应用更新、版本清单或下载地址变化 | `settings/APP_UPDATE_GUIDE.md`、`engineering/STORAGE_AND_DATA.md`、`README.md` |
| 角色音色、资产音频、自动分配变化 | `assets/ASSET_LIBRARY_GUIDE.md`、`assets/ASSET_AUDIO_ASSIGNMENT.md`、`assets/ROLE_AUDIO_ASSIGNMENT_REFERENCE.md`、`panels/voicebox-voice-cloning-flow.md`、必要时更新历史排查说明 |
| 资产添加、详情弹窗、多图、批量删除或道具目录变化 | `assets/ASSET_IMPORT_AND_MANAGEMENT.md`、`assets/ASSET_LIBRARY_GUIDE.md`、`assets/ASSET_DETAIL_OPERATIONS.md`、`assets/PROPS_LIBRARY_OPERATIONS.md`、`panels/MEDIA_OUTPUTS_GUIDE.md`、`engineering/TROUBLESHOOTING.md` |
| 技能编辑或技能存储变化 | `panels/SKILLS_EDITOR_GUIDE.md`、`panels/SKILLS_EDITOR_OPERATIONS.md`、`engineering/STORAGE_AND_DATA.md`、`engineering/DEVELOPER_ARCHITECTURE.md`；同时回读 `apps/frontend/components/panels/skills/index.tsx`、`electron/preload/preload.ts`、`electron/ipc/assets/studio-content-ipc.ts`、`electron/storage/studio-skills-storage.ts` 与 `electron/storage/storage-manager.ts` 的相对路径、`studio-skill-*` 通道和 storage root 解析 |
| 「本地模型」页（ComfyUI 画布/配音室/漫影生图）或 ComfyUI 引擎卡变化 | `panels/SELF_MEDIA_GUIDE.md`、`panels/LOCAL_MODELS_GUIDE.md`、`settings/COMFYUI_ENGINE_GUIDE.md`、`engineering/DEVELOPER_ARCHITECTURE.md`（ComfyUI 引擎层节）、`engineering/TROUBLESHOOTING.md`（引擎排障节）、`comfyui-kb/参数速查.md`、`comfyui-kb/定制代码地图.md`、`settings/SETTINGS_PANEL_OPERATIONS.md`、`settings/TTS_CONFIG_GUIDE.md`；旧 `panels/ASSIST_WORKBENCH_*` 三篇已过时标注，不再随改 |
| ComfyUI 引擎/my_nodes/工作流模板/桥变化 | `comfyui-kb/定制代码地图.md`、`.claude/knowledge/node-graph-architecture.md`、`.agents/skills/comfyui/machine.md`、`engineering/DEVELOPER_ARCHITECTURE.md`、`engineering/PACKAGING_AND_SMOKE_TESTING.md`（引擎资源边界节） |
| 自媒体账号、发布能力或定时任务变化 | `panels/SELF_MEDIA_GUIDE.md`、`engineering/self-media-aitoearn-integration.md` |
| 产物页上传、文件夹、预览、导出变化 | `panels/MEDIA_OUTPUTS_GUIDE.md`、`panels/MEDIA_OUTPUTS_OPERATIONS.md`、`engineering/STORAGE_AND_DATA.md`、`engineering/TROUBLESHOOTING.md` |
| 导出页或成片导出变化 | `panels/EXPORT_GUIDE.md`、`panels/EXPORT_OPERATIONS.md`、`workflow/WORKFLOW_GUIDE.md`、`engineering/PACKAGING_AND_SMOKE_TESTING.md` |
| 时间线 renderer、Remotion 版本/浏览器、媒体桥、bundle、播放器或 evidence 变化 | `settings/SETTINGS_PANEL_OPERATIONS.md`、`settings/API_SETTINGS_GUIDE.md`、`workflow/WORKFLOW_GUIDE.md`、`workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md`、`panels/EXPORT_GUIDE.md`、`engineering/DEVELOPER_ARCHITECTURE.md`、`engineering/PACKAGING_AND_SMOKE_TESTING.md`、`engineering/TROUBLESHOOTING.md`、`.trellis/spec/frontend/timeline-rendering.md`、`.trellis/tasks/archive/2026-07/07-25-mystudio-remotion-renderer-plugin/implement.md` |
| Remotion、HyperFrames、video-use、Seedance Prompt Skill 的版本、来源、锁文件、sidecar 或 Prompt Profile 更新 | `融合/参考/四个视频Skill与MYStudio版本更新与升级方案.md`、`融合/参考/四个视频Skill与MYStudio融合研究.md`、`融合/部署打包与工程化手册.md`、`engineering/DEVELOPER_ARCHITECTURE.md`、`engineering/PACKAGING_AND_SMOKE_TESTING.md`、`docs/README.md`、`融合/README.md`、`融合/参考/README.md` |
| 默认风格、我的风格、视觉手册或 AI 提取风格词变化 | `assets/VISUAL_STYLE_MANAGEMENT.md`、`assets/VISUAL_MANUAL_EDITOR_OPERATIONS.md`、`assets/ASSET_LIBRARY_GUIDE.md`、`workflow/WORKFLOW_GUIDE.md`、`engineering/DEVELOPER_ARCHITECTURE.md` |
| 打包、安装、smoke 脚本变化 | `engineering/PACKAGING_AND_SMOKE_TESTING.md`、`融合/部署打包与工程化手册.md`、`.agents/skills/mystudio-automation-testing/SKILL.md` |
| 存储 key、目录、迁移逻辑变化 | `engineering/STORAGE_AND_DATA.md`、`engineering/DEVELOPER_ARCHITECTURE.md`，并确认 `assets/`、`python/`、`comfyui/`（引擎家+模型统一家）、`comfyui/models/TTS/`（旧版 `model/TTS`、`tts-models/` 仅作迁移兼容）、video-use profile marker 是否在导入/导出/移动范围内；禁止新增独立 video-use venv |
| 工作流阶段、按钮、状态或主导航变化 | `panels/NAVIGATION_GUIDE.md`、`workflow/WORKFLOW_GUIDE.md`、`workflow/WORKFLOW_STAGE_OPERATIONS.md`、`workflow/WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md`、`workflow/WORKFLOW_ASSET_GENERATION_OPERATIONS.md`、`workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md`、`README.md`、`docs/README.md` |
| 内部 `script`/`characters`/`scenes`/`director`/`sclass` 跳转变化 | `panels/NAVIGATION_GUIDE.md`、`director/LEGACY_SCRIPT_WORKSPACE_GUIDE.md`、`assets/CHARACTER_GENERATION_GUIDE.md`、`director/ADVANCED_DIRECTOR_TOOLS.md`、`assets/SCENE_MULTIVIEW_GUIDE.md`、`panels/MEDIA_OUTPUTS_GUIDE.md`、`engineering/DEVELOPER_ARCHITECTURE.md` |
| 旧剧本编辑、AI 校准、预告片挑选变化 | `director/LEGACY_SCRIPT_WORKSPACE_GUIDE.md`、`director/TRAILER_STORYBOARD_REUSE_REFERENCE.md`、`workflow/WORKFLOW_GUIDE.md`、`panels/NAVIGATION_GUIDE.md`、`director/ADVANCED_DIRECTOR_TOOLS.md`、`director/SCLASS_GROUP_VIDEO_OPERATIONS.md`、`engineering/DEVELOPER_ARCHITECTURE.md` |
| 角色生成、三视图、衣橱变体或角色库跳转变化 | `assets/CHARACTER_GENERATION_GUIDE.md`、`assets/ASSET_LIBRARY_GUIDE.md`、`assets/ASSET_AUDIO_ASSIGNMENT.md`、`engineering/DEVELOPER_ARCHITECTURE.md` |
| 导演分镜、S级组级生成、视角切换、四宫格或分镜口播变化 | `director/ADVANCED_DIRECTOR_TOOLS.md`、`director/DIRECTOR_SHOT_CARD_REFERENCE.md`、`director/DIRECTOR_VOICEOVER_REFERENCE.md`、`director/ANGLE_AND_QUAD_GRID_OPERATIONS.md`、`director/SCLASS_GROUP_VIDEO_OPERATIONS.md`、`workflow/WORKFLOW_GUIDE.md`、`panels/MEDIA_OUTPUTS_GUIDE.md`、`panels/TTS_PANEL_OPERATIONS.md`、`engineering/DEVELOPER_ARCHITECTURE.md` |
| 场景单图、联合图、四视图或批量四视图变化 | `assets/SCENE_MULTIVIEW_GUIDE.md`、`assets/ASSET_LIBRARY_GUIDE.md`、`panels/NAVIGATION_GUIDE.md`、`engineering/DEVELOPER_ARCHITECTURE.md` |
| 项目首页、项目卡片、复制/删除/重命名变化 | `panels/PROJECT_DASHBOARD_GUIDE.md`、`panels/PROJECT_DASHBOARD_OPERATIONS.md`、`panels/NAVIGATION_GUIDE.md`、`engineering/STORAGE_AND_DATA.md` |
| 概览页、故事核心、分集目录变化 | `workflow/OVERVIEW_PANEL_GUIDE.md`、`workflow/OVERVIEW_PANEL_OPERATIONS.md`、`workflow/WORKFLOW_GUIDE.md`、`panels/NAVIGATION_GUIDE.md` |
| 新增融合方案或调查文档 | `docs/融合/README.md`、必要时更新 `docs/README.md` |
| 新增用户操作文档或覆盖范围变化 | `engineering/DOCS_COVERAGE_AUDIT.md`、`docs/README.md`、`README.en.md`、`panels/NAVIGATION_GUIDE.md` |

## Python/TTS 运行时边界核对

涉及 Settings 下载、Electron sidecar、`requirements.txt`、模型目录、sidecar 数据目录或 Daojie HTTP-TTS 直跑时，除更新对应操作手册外，逐项确认：

- `设置 → 本地配置 -> Python 运行环境 -> 开始配置` 仍把 Python 3.12 与 `apps/backend/requirements.txt` 安装到 `<storageBasePath>/python`。
- 开发/构建脚本使用开发者当前 `python3`，安装后 Electron 使用设置页下载的 CPython 3.12；开发 Python 不进入安装包，开发模式 TTS 仍按代码查找 `<storageBasePath>/python`。
- `storage-manager.ts` 的 `getPythonRuntimeDir()`、storage IPC 的 `pythonRuntimeDir` 与 `tts-runtime.ts` 必须继续指向同一运行时；当前 macOS 盘面的展开路径为 `/Users/zhengbingjin/Library/Application Support/漫影工作室/python`，这是 video-use 应复用的受管理 Python 来源，不得写成固定常量或改用 shell `python3`。
- `tts-runtime.ts` 仍只从 `<storageBasePath>/python` 解析 Python；`apps/backend` 或打包后的 `Resources/backend` 只作为 sidecar 源码、工作目录和 `PYTHONPATH`。
- `<storageBasePath>/comfyui/models/TTS`（09-10 模型统一家；旧版 `model/TTS`、`tts-models` 仅作迁移兼容）与 `<userData>/tts-runtime` 的职责、迁移和导入/导出范围已同步到 `engineering/STORAGE_AND_DATA.md`。
- video-use 已接入，维护时必须记录 `apps/backend/video_use`（源码）、`<storageBasePath>/python` 的独立共享 profile marker，以及项目 revision 输出三者边界；冲突时进入 `blocked` 并恢复已验证组合，不能创建第二环境、把依赖追加到 TTS requirements 或复用 TTS 的单一 marker。
- Daojie 直跑是否仍只由显式 `MANYING_TTS_USE_HTTP=1` 触发、缺失 runtime 时是否指向设置页，以及默认视频链是否改变，均已按实际代码更新。
- `apps/backend/python` 只能写为被忽略、被打包排除的遗留本地供应物；除非另有已批准的清理任务，不得写成正式 runtime、已删除或已移动。

以上是 Python/TTS 专题的维护边界；模块地图和跨模块架构只维护在 `engineering/DEVELOPER_ARCHITECTURE.md`。

## 验证命令

从仓库根目录执行：

```bash
python3 apps/build/scripts/docs_current_audit.py \
  --output .trellis/tasks/09-20-docs-current-alignment/research/audit.json \
  --check-links
```

脚本使用仓库已安装的 markdown-it 解析 Markdown 与 HTML 本地链接，并输出逐篇清单、不可达文档、源码路径和 npm 命令待核项；不抓取外部链接，也不验证标题锚点。上例输出属于本轮任务，后续维护改为对应任务的 research 路径。历史路径、外部项目路径和示例命令须逐项裁定，不能一律视为坏链；旧正则会误认节点编号及含括号的图片路径，已不作为验收入口。

过时关键词扫描：

```bash
rg -n "memecalculate@gmail\\.com|API Configuration|Settings → API Configuration|设置 → API 配置|设置 -> API 配置|tts-runtime/venv|src/backend|MYStudio/frontend|npm run package|package:mac|package:win|package:linux|rm -rf|app-resources|dist/\\*\\*|插件配置|设置 [-→>] API ?管理|API 管理|API管理" README.md README_EN.md docs apps/backend/README.md -g '*.md'
```

允许保留的命中：

- `moyin-*`：只允许出现在 legacy 迁移说明中。
- `MoYin`：只允许作为融合来源项目名称出现。
- `voicebox/backend/routes`：只允许出现在说明“当前不是旧外部 Voicebox routes”的上下文中。
- `src/electron`、`src/types`、`src/stores`、`src/lib`：只允许出现在历史融合规划或“早期规划路径映射到 `apps/frontend/*`”的说明中。
- `app-resources`：只允许出现在未来目标资源模型或历史规划中，不能写成当前已落地目录。
- `插件配置`：只允许出现在设置页改名历史说明（2026-08-14 起「插件配置」→「本地配置」、「API管理」→「云端AI」）中；作为当前设置页入口名出现即为过时。
- `API 管理` / `API管理`：只允许出现在 `api-manager/` 等代码目录描述、改名历史说明或早期融合规划存档中；作为当前设置页入口名出现即为过时。

## 索引覆盖

- `docs/README.md` 应覆盖 `docs/` 根目录下所有非 README 文档。
- `docs/融合/README.md` 应覆盖 `docs/融合/` 下所有计划和调查文档。
- 历史快照可以放在“历史排查资料”下，但要明确日期和当前适用边界。
