# 存储与数据迁移

本文说明 MYStudio 的本地数据存储、跨项目共享、导入导出和迁移方式。

## 路径记法与存储根解析

仓库相对路径从 `<repo-root>` 计算；例如
`apps/frontend/electron/storage/storage-manager.ts` 是
`<repo-root>/apps/frontend/electron/storage/storage-manager.ts` 下的产品源码，应用运行时
不向它写数据。运行时路径使用 `<storageBasePath>` 和 `<userData>` 占位符：前者是
用户选择的存储根，后者是 Electron 的 userData 根；两者都是运行时可写位置。
绝对路径只应在本机证据或生成产物位置需要精确指向时使用。

`createStorageManager()` 在 `storage-manager.ts` 中按以下顺序解析
`<storageBasePath>`：先读取 `<userData>/storage-config.json` 的
`storageConfig.basePath`，其次使用 legacy `storageConfig.projectPath` 的父目录，
最后回退为 `<userData>` 本身。`getSkillsRoot()` 随后调用
`getStudioSkillStorageRoot()`，得到 `<storageBasePath>/skills/` 并确保目录存在。
因此 `storage-config.json` 和 `skills/` 是运行时可写数据，不是仓库源码或打包 seed。

构建和 smoke 工具不能自行猜测 Electron 的 userData。调用方应注入
`MYSTUDIO_USER_DATA_DIR`（2026-08-14 起 legacy `MYSTUDIO_DAOJIE_USER_DATA_DIR` 已停用，
统一只读新名）；仅在开发环境没有注入值时才使用 macOS fallback。独立 Remotion smoke 通过同一 resolver 读取
`MYSTUDIO_REMOTION_RUNTIME_DIR`（未设置时为 `<userData>/remotion-runtime`），因此隔离
smoke 必须显式传入自己的 userData/runtime 目录。

技能 seed、用户副本和开发技能的严格区分见
[技能编辑](../panels/SKILLS_EDITOR_GUIDE.md)：内置
`apps/frontend/assets/studio-manuals/` 是应用运行时只读的产品源码，
`<storageBasePath>/skills/` 才是可编辑副本与
`.studio-skills-manifest.json` 的位置；`.agents/skills/` 或全局 Codex/Agents
skills 都不属于产品 storage。

## 默认存储位置

macOS 默认的 `<userData>` 通常解析为系统应用支持目录；文档统一使用占位符：

```text
<userData>
```

没有自定义 storage root 时，内部 legacy 项目数据根位于下方；项目注册表和应用配置由各自的 userData 解析器管理，不能一概当作此目录的子项：

```text
<storageBasePath>/projects  # 默认等于 <userData>/projects
```

常见文件名使用 `mystudio` 前缀，例如：

```text
mystudio-app-settings.json
mystudio-project-store.json
```

旧版本中的 `moyin-*` 命名会在读取时迁移到 `mystudio-*` 命名。

独立资产库位于同一个存储根目录下，但不在 `projects/` 里面：

```text
<storageBasePath>/assets/assets.db
<storageBasePath>/assets/files/{role,scene,tool,clip,audio}/
<storageBasePath>/assets/thumbs/
```

其中 `assets.db` 是 SQLite 索引，`assets/files/` 保存角色、场景、道具、视频片段和音频原文件，`assets/thumbs/` 保存图片类资产的缩略图缓存。

## userData 目录职责与历史盘面边界

2026-08-03 的只读盘面证据显示，`storage-config.json` 中 `basePath`、`projectPath`
和 `mediaPath` 都为空，因此当时 `<storageBasePath>` 等于 `<userData>`。这是历史快照，不代表本机今天的设置；下表用于理解目录职责，迁移前需重新读取实际路径，不授权移动或删除任何条目：

| 实际路径或类别 | 代码/运行时职责 | 当前 disposition |
|---|---|---|
| `projects/`、`media/`、`assets/`、`skills/` | 项目、媒体、canonical `assets/assets.db` 与资产文件、用户技能 | 产品数据，保留 |
| `python/` | 受管理的 Python runtime；内部 executable/snapshot symlink 是完整性结构 | 运行时数据，保留 |
| `comfyui/`（09-10 起现行） | **模型/引擎统一家 + ComfyUI 引擎家**：ComfyUI 引擎源码与独立 venv、`models/<family>/`（TTS/audio/sfx/图像/视频等全部本地模型，拼装单源 `electron/storage/model-dirs.ts`）、snapshots、默认 `<源码目录>/user/default/workflows/` 用户库（可由 manifest 的 `workflowsDir` 覆盖）与只读仓库模板合并、manifest.json、engine.lock；input/output 媒体目录经官方参数注入 | 产品数据（大体积模型权重/引擎）+应用运行状态，保留 |
| `model/`（08-19 旧规范，已退役） | 旧模型家 `<userData>/model/<family>/`（music3 权重、mlx-serve 二进制等）。09-10「模型统一家」裁定后由 `apps/build/scripts/model_dir_unify.py` 一次性迁平至 `comfyui/models/`，仅作迁移兼容来源；imagegen seg 模型例外仍留 `model/imagegen/` | 迁移兼容/残留，保留不动 |
| `TTS/runtime/` | sidecar SQLite、生成音频、`config.json` 与 `.deps-hash` 依赖标记（旧版 `<userData>/tts-runtime` 仅作迁移兼容） | 应用运行状态，保留 |
| `remotion-runtime/`、`remotion-studio/` | Remotion 浏览器缓存、固定 runtime manifest 与 Studio 工作区 | 应用运行状态，保留 |
| `logs/`、`diagnostics/`、`self-media/`、`storage-config.json` | 诊断日志统一家 `logs/`(见下节)、自媒体任务/凭据边界与存储配置 | 产品或审计数据，保留 |
| `Cache/`、`Code Cache/`、`GPUCache/`、`DawnGraphiteCache/`、`DawnWebGPUCache/` | Electron/Chromium 可重建缓存 | 可重建，但治理扫描器不自动清理；应用退出且有单独证据后再审阅 |
| `Local Storage/`、`IndexedDB/`、`WebStorage/`、`Cookies*`、`Preferences`、`File System/`、`Session Storage/`、`Shared Dictionary/`、`SharedStorage`、`Trust Tokens*`、`databases*/`、`blob_storage/`、`Network Persistent State`、`TransportSecurity` | 登录会话、配额、Cookie、站点数据库和网络安全状态 | Electron 状态，默认保留；运行中不得移动 |
| `DevToolsActivePort`、`.com.github.Electron.*`、`SingletonLock`、`SingletonCookie`、`SingletonSocket` | DevTools 或 Electron/Chromium 单实例锁、socket、token 标记 | 运行时锁标记，默认保留；断链不等于 symlink escape |
| 顶层 `assets.db` | 0-byte legacy/orphan 证据；产品代码的 canonical 路径不是这里 | 证据不足，保留 |
| `assets/assets.db.bak-*`、`assets/db.json.migrated` | 内容不同的历史恢复与迁移证据 | 未建立逐项恢复策略前保留 |
| 任意目录中的普通文件 `.DS_Store` | Finder 元数据，产品代码没有读写契约 | 已确认无用；仅可在未来精确 manifest 和人工批准后移入废纸篓 |

边界词义固定为：产品数据直接保留；可重建内容也不自动清理；无法证明无用的 legacy、
backup、迁移源和断链 symlink 一律保留；只有普通文件 `.DS_Store` 能获得
`trash-eligible-after-approval`，它仍不是自动删除授权。

## 日志目录统一布局（2026-08-25 起）

所有日志统一归 `<userData>/logs/`，按日志类型分模块子目录：

| 子目录 | 内容 | 写入方 | 保留策略 |
|---|---|---|---|
| `logs/diagnostics/` | 主事件流 `diagnostics-YYYY-MM-DD.jsonl`（10 类 category 混写按天滚动，`operationId` 跨模块串联）；导出包 `diagnostics-bundle-*.json` | `electron/diagnostics/diagnostics-log.ts` | 30 天保留 + 单文件 10MB 轮换 |
| `logs/remotion-queue/` | 渲染队列事件 `queue-events.jsonl`（08-25 从 `projects/_remotion/queue/` 一次性迁入；`queue-state.json` 运行态快照仍留数据根原位） | `remotion-render-queue.ts` | 暂无上限（轮换另立任务） |
| `logs/sidecars/` | 子进程输出 `<module>-<yyyyMMdd-HHmmss>.log`：`tts-backend`/`music3`/`image-gen`/`depth`/`upscale`/`audio-gen`/`sfx-gen` 长驻捕获 + `hyperframes`/`remotion-worker` 失败落盘 | `electron/diagnostics/sidecar-log-capture.ts`（main.ts 一次配置） | 单文件 10MB 封顶停写；同 module 14 天清扫 |
| `logs/pipeline-bundles/` | 三段链路取证包 `video-pipeline-bundle-*.json`（08-25 从 `exports/` 迁入；`exports/` 继续只放音频/成歌等媒体产物） | `depth-ipc.ts` 的 `video-pipeline-export-log-bundle` | 手动导出，无自动清理 |

排查口径：应用行为看 `diagnostics/`（jq 按 `category`/`level` 过滤）；渲染队列看
`remotion-queue/`；Python/worker 子进程输出看 `sidecars/`。项目侧 `video-use/`、
`hyperframes/`、`remotion/` 下的 job 产物是 SHA 溯源数据契约（门禁/UI 回读），
不是日志，不迁入 `logs/`，取证时由 pipeline-bundle 聚合导出。

## 入口

```text
设置 -> 存储
```

存储页包含：

- 资源共享
- 存储位置
- 数据恢复
- 缓存管理
- 应用更新

应用更新的检查、忽略版本和版本清单字段见 [应用更新](../settings/APP_UPDATE_GUIDE.md)。

## 资源共享

可以分别控制以下资源是否跨项目共享：

- 角色库
- 场景库
- 素材库

关闭共享后，对应资源只在当前项目可见。

## 更改存储位置

在 `设置 -> 存储 -> 存储位置` 点击 `选择`，可以选择新的数据目录。

应用会尝试把现有用户数据复制到新目录、确认新根后再按现有安全策略处理旧根，并自动创建：

```text
projects/
media/
assets/
skills/
```

当前 `设置 -> 存储` 的移动逻辑会复制 `projects/`、`media/`、`assets/` 和 `skills/` 四类用户数据，并把存储根目录切到新位置。Python runtime `python/`、TTS 模型缓存 `comfyui/models/TTS/`（旧版 `model/TTS`、`tts-models/` 仅作迁移兼容）与 Electron sidecar 的 `<storageBasePath>/TTS/runtime`（SQLite、生成音频、依赖 hash marker 与 runtime config）不属于本次复制范围；ComfyUI 引擎家固定锚在 `<userData>/comfyui/`，不随存储根迁移移动。旧版 `<userData>/tts-runtime` 仅作为迁移兼容目录保留。video-use 的独立 profile marker 也属于运行时元数据，不进入这四类用户数据复制；迁移后由 worker 环境检查决定复用当前 managed Python，冲突则恢复已验证组合并保持 `blocked`。迁移后建议重启应用，并检查：

- 项目是否能正常打开。
- `assets/` 是否已在新存储根目录下包含原有资产库。
- `设置 → 本地配置 -> Python 运行环境` 中的 Python 使用路径是否指向新存储根目录。
- `<存储根目录>/comfyui/models/TTS` 是否需要重新下载或手动迁移（旧版 `model/TTS`、`tts-models` 仅作迁移兼容）。
- `<storageBasePath>/TTS/runtime` 是否仍适合保留；它不等同于项目数据或 Python runtime，不能假定会随存储根目录移动。

## 外部项目的备份边界

主进程以 `<userData>/project-locations.json` 中的项目位置为权威；renderer 的 `mystudio-project-store.json` / `Project.location` 用于展示。已注册项目的 `_p/<projectId>/...` 虚拟键会重定向到对应外部目录。

下面的统一移动、导出、导入只处理内部 `getProjectDataRoot()` 及 media/assets/skills，**不会遍历外部项目位置，也不会自动携带 userData 下的项目位置表**。外部项目应单独备份完整项目夹和位置登记信息；恢复后核对应用打开的真实目录。只有内部四目录的导出包不能视为全项目备份。

## 导出和导入

### 导出

点击 `导出`，选择目标目录，将当前数据导出到该目录。

当前统一导出会包含以下内部存储目录（外部项目边界见上节）：

- `projects/`
- `media/`
- `assets/`
- `skills/`

Python runtime `python/`、TTS 模型缓存 `comfyui/models/TTS/`（旧版 `model/TTS`、`tts-models/` 仅作迁移兼容）、`<storageBasePath>/TTS/runtime` 和 video-use profile marker 不在当前统一导出范围内；ComfyUI 引擎家 `<userData>/comfyui/`（引擎+模型统一家+工作流库）同样不随导出携带。

### 导入

点击 `导入`，选择已有导出目录，将数据导入当前存储位置。

导入后应用会清理旧的浏览器存储缓存，并重新加载文件存储数据。

当前统一导入会按导入来源中存在的目录类别覆盖 `projects/`、`media/`、`assets/` 和 `skills/`；来源中不存在的类别会保留当前数据。导入前会备份现有的对应类别，失败时回滚。Python runtime、模型缓存和 sidecar runtime 数据不会因导入而恢复；需要时分别在设置页重新配置或按其独立数据边界处理。

迁移前可生成只读治理清单（输出文件必须位于 userData 之外，且不能覆盖已有文件）：

```bash
node apps/build/scripts/user-data-governance.mjs \
  --user-data "<userData>" \
  --output "/tmp/mystudio-user-data-manifest.json"
```

清单对每个文件记录 `path`、`type`、`bytes`、`mtimeMs`、SHA-256、`category`、
`classificationEvidence` 和建议 `disposition`，并附带 JSON、SQLite 或 symlink 专属证据。
只有 realpath 成功解析到 `<userData>` 外的链接才标为 `hold-symlink-escape`；断链链接会标为
`hold-unresolved-symlink`，已知锁标记还会记录 `markerKind`，不会因无法解析就误判逃逸。

SQLite 只读 probe 使用 `status=ok|locked|corrupt-or-unreadable`：`locked` 表示当前连接或
pragma 被运行中的应用占用，不是损坏；integrity 不是 `ok` 或其它读取失败才进入
`corrupt-or-unreadable`。扫描器只分类和取证；`batch` 只生成 `approved=false` 的
`.DS_Store` 候选清单，不移动真实数据。只有人工把同一批次变为
`mode=approved-trash`/`approved=true`、确认应用已退出，并通过 `trash` 命令时，才会
按原路径、类型、字节数、mtime 和 SHA-256 重新核对后调用
`/usr/bin/trash --stopOnError --verbose`。执行前后会保留 `pending`/`failed`/`applied`
evidence 和 macOS Trash recovery 路径；任何证据漂移或非 Finder 元数据目标都会停止。

## 指向已有数据目录

换设备或重装系统后，如果已经有完整数据目录，可以使用：

```text
设置 -> 存储 -> 数据恢复 -> 指向已有数据目录
```

选择包含 `projects/`、`media/`、`assets/` 或 `skills/` 子目录的数据目录。操作完成后重启应用。

## 缓存管理

存储页会显示缓存大小，可以手动清理缓存，也可以开启自动清理。

缓存清理不会替代项目数据备份。清理前仍建议确认生成中的任务已经完成。

## 应用更新

存储页底部的 `应用更新` 用于查看当前版本、手动检查更新、开启或关闭启动时自动检查更新，以及恢复被忽略版本提醒。

更新检查只打开 GitHub 或百度网盘等下载链接，不会自动替换本机已安装应用。详细说明见 [应用更新](../settings/APP_UPDATE_GUIDE.md)。

## 与 Python/TTS/video-use 的关系

MYStudio 要区分“开发脚本 Python”和“安装后应用 Python”，并继续区分运行时目录。当前应用运行时位置是：

```text
<storageBasePath>/python
<storageBasePath>/comfyui/models/TTS
<storageBasePath>/TTS/runtime
```

2026-08-03 记录中的 macOS 开发机 `<storageBasePath>` 与 Electron `userDataPath` 相同，当时设置页下载的
Python 目录示例为 `~/Library/Application Support/漫影工作室/python`。
这是可迁移的历史盘面示例，不是写死给所有用户的路径；应用和 video-use 都必须通过
`getStorageBasePath()`/`pythonRuntimeDir` 解析，不能把这个示例复制成固定常量。

- **开发/构建 Python**：`apps/build/**/*.py`、后端 unittest 和审计脚本由开发者 shell 的 `python3`（或其自行激活的开发虚拟环境）执行。当前仓库没有提交 `apps/.venv` 或 `apps/backend/.venv`；这份 Python 只用于开发/CI，不会被 electron-builder 复制进安装包，也不是 Electron TTS 的候选路径。
- **安装后应用 Python**：设置页首次点击 `开始配置` 时，Electron 下载并解压 CPython 3.12 到 `<storageBasePath>/python`，再把 `apps/backend/requirements.txt` 安装到该 runtime。开发模式的 Electron 也遵循这个路径启动 TTS；它不会因为 `npm run dev` 就改用 shell 的 `python3`。
- `<storageBasePath>/python`：设置页下载的 Python 3.12 runtime；`apps/backend/requirements.txt` 的依赖安装到这里。
- `<storageBasePath>/comfyui/models/TTS`：默认 TTS 模型缓存（09-10 模型统一家，拼装单源 `model-dirs.ts`）；旧版 `<storageBasePath>/model/TTS`、`tts-models` 仅作迁移兼容。
- `<storageBasePath>/TTS/runtime`：Electron sidecar 的 SQLite、生成音频、依赖 hash marker 和 runtime config；旧版 `<userData>/tts-runtime` 仅作迁移兼容。
- **video-use（已接入代码路径，真实生成需独立验收）**：开发态可用开发者 Python 验证 helper；应用运行态必须从同一个 `pythonRuntimeDir` 使用 `<storageBasePath>/python`（当前 macOS 示例为 `~/Library/Application Support/漫影工作室/python`）作为解释器来源。默认复用该 managed Python 3.12 的 site-packages，并使用独立 `requirements-video-use.lock`/profile marker、`pip check`、import/fixture smoke 和 TTS 全量回归；禁止创建 `video-use-runtime` venv。共享依赖发生硬冲突时，当前组合进入 `blocked` 并恢复最近一次已验证组合。video-use 依赖不得直接写入 `apps/backend/requirements.txt` 或 `<storageBasePath>/TTS/runtime`，其项目输出应写到当前 project/chapter revision 工作区，不属于 Python runtime 本体。

Electron 从 `apps/backend` 或打包后的 `Resources/backend` 取得 sidecar 源码与 `PYTHONPATH`，但只使用 `<storageBasePath>/python` 启动它。`apps/backend/python` 不是正式 runtime 位置：它被 `.gitignore` 忽略并由打包规则排除；本任务没有删除或移动该本地遗留目录。

因此更改存储根目录后，Python runtime、模型缓存、TTS runtime 和 video-use profile marker 会改从新根目录寻址，但当前移动/导出/导入不会自动携带它们或旧版 `<userData>/tts-runtime`。相关配置见 [Python 与本地 TTS 配置](../settings/PYTHON_TTS_SETUP.md) 和 [四个视频 Skill 与 MYStudio 融合研究](../融合/参考/四个视频Skill与MYStudio融合研究.md)。

视频章节 artifact 仍写入 `<projectRoot>/video-use/<chapterId>/r<revision>/`，不写入 Python runtime。主链是 `StoryboardItem.ttsSpokenText -> managed Python TTS WAV binding -> Remotion StoryboardShot -> MLX 0.4.1 原文强制对齐 -> video-use 完整 EDL/字幕时间/调色/preview/self-eval -> 用户确认 -> editable-edl（默认）或 clean flat-shot-mp4（高级） -> HyperFrames overlay/no-op -> Remotion ChapterVideo -> final-output-qc`。每章 video-use/HyperFrames 默认启用；`preparing`、`aligning`、`editing`、`previewing`、`evaluating`、`awaiting-review`、`applying`、`ready`、`blocked` 是唯一章节状态。原始秒制 EDL 只在 evidence 保存，adapter 转换为 `TimelineTimeUs`；flat 模式必须保存独立字幕/overlay metadata，禁止二次烧录。

应用代码随 MYStudio 更新，Python/Node 22/浏览器/共享 FFmpeg 运行时由设置页一键准备并由用户手动应用；自动检查只产生提示。更新或迁移后的组合必须写 manifest，验证失败恢复最近一次 verified combination，相关章节继续保持 `blocked`，不能用旧 MP4 冒充当前 revision evidence。

Daojie chapter-001 仅在显式设置 `MANYING_TTS_USE_HTTP=1` 时启动 HTTP TTS；默认视频自动链不设置该变量。该直跑分支按 `MYSTUDIO_STORAGE_BASE_PATH`、`<userData>/storage-config.json`、macOS development fallback 的顺序解析 `<storageBasePath>/python`，缺失时要求用户回到设置页完成 Python 与依赖配置，不会使用 `apps/backend/python`。

## 排查

### 项目数据看起来丢失

先检查：

- `设置 -> 存储` 中的当前存储位置是否正确。
- 目录下是否存在 `projects/`。
- 是否误指向了空目录。

### 旧 moyin 文件是否还可读

可以。当前存储层保留 legacy key 迁移逻辑，会把旧 `moyin-*` 文件迁移到 `mystudio-*`。

### 更换路径后 TTS 不能启动

进入 `设置 → 本地配置 -> Python 运行环境`，确认 `Python 使用路径` 指向新存储目录下的 Python，并刷新安装明细。


## 项目实体目录地图（2026-08-17 全量版，权威代码锚点 chapter-paths.ts / project-storage.ts）

项目实体=注册表 `project-locations.json` location 指向的目录（如 `IP/MA/`），**懒创建**：创建项目只建根目录，其余按首次使用逐个出现。

### 根目录文件（各域 zustand persist，`{state,version}` 信封，首次使用该域时创建）
| 文件 | 作用 | 创建时机 |
|---|---|---|
| `studio-workflow/`（目录，见下节） | 工作流主数据的**分片持久化**（08-17 起的新布局，manifest 驱动） | 任意工作流写操作 |
| `studio-workflow-store.json` | （旧布局）工作流主数据单文件：章节列表、事件分析结果、原著圣经缓存、剧本计划、分镜、资产版本、媒体任务（v10）。分片化后首次写盘即改名 `*.bak-sharded-<ts>` 保留不删 | 任意工作流写操作（已停写，仅回退读取） |
| `characters.json` | 角色库：角色卡、别名、外观设定，供剧本/生图引用 | 首次建角色条目 |
| `scenes.json` | 场景库：场景卡与环境设定 | 首次建场景条目 |
| `props.json` | 道具库：道具设定 | 首次建道具条目 |
| `script.json` | 剧本域：章节剧本草稿与阶段产物索引 | 剧本首次保存 |
| `director.json` | 导演域：导演规划与镜头语言设定 | 导演规划首次保存 |
| `tts.json` | 配音域：音色绑定、配音任务与家族配置 | 首次配音操作 |
| `sclass.json` | 自媒体/短剧域配置 | 该域首次使用 |
| `self-media.json` | 自媒体账号与发布任务 | 首次使用 |
| `editing.json` | 剪辑域：剪辑工程（clips/revision） | 剪辑首次保存 |
| `media.json` | 媒体库条目：导入媒体的索引与 `local-image://` 地址映射 | 首次导入媒体 |
| `*.bak-*`（protagonist/voice/bible-* 等） | store 手术/迁移前的自动备份副本 | 确认稳定后可手动清理 |

### studio-workflow/ 分片布局（08-17 起；08-18 升级为章优先目录分层，权威代码 `lib/storage/studio-workflow-shards.ts`）
单 JSON ≤512KB 的分片持久化投影（store 语义与 migrate(v10) 不变），**章优先目录分层**：每章数据住自己的子目录，一章的增删改只动一章的目录：
| 路径 | 内容 |
|---|---|
| `manifest.json` | `{layout:"studio-workflow-shards-v1", version:<store版本>, shards:[相对路径]}`——唯一读盘清单（路径限根层或 `chapters/<id>/<file>` 两形态，段级防穿越） |
| `chapters/<chapterId>/<slug>-NNN-<stamp>.json` | **每章独立目录**：novel-chapters(按 id)/storyboards/script-plans/episode-outlines/media-tasks/production-tracks/agent-work-data/entity-extractions 按 episodeId\|chapterId 归章；image-workflows 经 target.storyboard、video-candidates 经 trackId 间接归章；章内超 512KB 续 `-NNN` |
| `<slug>-shared-NNN-<stamp>.json`（根层） | 无法归章的条目（如自由画布工作流） |
| `core-<stamp>.json`（溢出续 `core-002-*`…） | 小域合并：workflowConfig/两圣经/事件图/记忆 + 空数组 + 未知键 |
| `agent-runs-*`、`assets-versions-*`、`materials-*` | 非章节数组域（项目级数据），按大小批切，单片裸名、多片 `-NNN` |
- 每片仍是 `{state:{域子集},version}` 信封（asset inventory 的 zustand 解码器兼容），**分片与 manifest 均格式化多行存储**（2 空格缩进；512KB 预算按格式化后字节计量）
- 文件名 stamp=内容 djb2 前 8 hex：写序=先写变化分片→manifest 最后换新→清孤儿（渲染进程用 listDirs+listKeys 嵌套扫描，未引用章目录整目录回收），进程中途死时旧 manifest 仍指向完整旧代
- **增量写（08-18）**：渲染进程保存与上一代逐片比对「名+内容」，未变分片零重写（改一章只写一章）；完全无变化的保存零磁盘写入；重启/切项目首存退化为全量
- **CPU 增量+窗口化（08-18 store-scale 收口）**：保存序列化=域引用 diff+条目 WeakMap 缓存（500 章 21.6→7.0ms）；启动=窗口读（manifest.chapterIndex+激活章，恒定 3 片，与总章数无关），非激活章轻索引项（无 sourceText）不落片、切章装载（switchChapter）；归档章分片名抄录保命；读链损坏空态覆写守卫（hydrationDamaged）
- 无损保证：章节域按「同章连续段(run)」切文件，manifest 顺序=数组原序，合并 concat 精确还原（章交错也保序）
- 读端三级回退：分片 manifest → 项目级旧单文件 → 根级 legacy 键（未迁移项目/冒烟夹具零损）；旧代布局（平铺章前缀、大小批切）按旧 manifest 照常可读，下次保存自动升级为章目录布局
- 目录自述：仓内权威模板 `apps/frontend/assets/docs/studio-workflow/README.md` 逐字分发——创建项目即写入，每次分片保存 md5 校验，缺失/被手改自动覆盖修复（08-18 四裁定；渲染进程纯 md5 实现，CLI/孪生 node:crypto）
- 旧单文件迁移=改名 `studio-workflow-store.bak-sharded-<ts>`（渲染进程经 IPC 落盘为 `.../studio-workflow-store.bak-sharded-<ts>.json`，CLI 直写为 `.../studio-workflow-store.json.bak-sharded-<ts>`，两者均保留不删）

### novel/（小说域）
| 路径 | 时机 | 作用 |
|---|---|---|
| `novel/chapters/<chapterId>.md` | 导入/更新章节 | 正文镜像（卷/源ID/修订+事件分析） |
| `novel/source-memory/MEMORY.md` | 保存原著圣经 | **单一常驻层**（≤4000 字符）注入全部文本管线，动作级现读；记忆库链路对其只读 |
| `novel/source-bible.md` | （旧路径，已停写） | 只读兼容回退 |
| `novel/source-memory/{index.sqlite,records.jsonl,manifest.json,build-state.json,staging/,README.md}` | 事件分析批次自动重建 + 记忆库界面显式重建 | FTS5+CJK bigram 档案检索层（BM25×实体命中加权、SHA 溯源，SQLite 可重建）。L2 起 records.jsonl 含 AI 抽取的 11 类结构化记录（人物/别名/关系/事件/时间线/世界规则/术语/地点/物件/伏笔/改编红线，全文存储）；manifest SHA 对比实现增量——只重抽变化章节，未变章记录复用；build→stage-records→commit-build 两阶段提交，构建期间正文再变则 commit 拒绝（sources-changed）；AI 失败保留 raw 检索、状态 partial 不伪报。状态/重建/检索自测入口=小说 tab「原著记忆库」 |

### 制片产物
| 路径 | 时机 | 作用 |
|---|---|---|
| `workflow-images/[<chapterId>/]<workflowId>/` | 生图工作流产出 | 分镜/资产图像（章节作用域见 chapter-paths.ts） |
| `video-use/<chapterId>/r<rev>/` | video-use 审修 | **video-use 插件**逐镜视频修订工件（主进程 owner） |
| `hyperframes/<chapterId>/r<rev>/` | HyperFrames 特效渲染 | **HyperFrames 插件**独立工作区（08-18 起；曾寄居 video-use 修订目录）：hyperframes-request/-overlay/-artifact |
| `remotion/{audio,chapters,outputs,jobs,evidence}/` | 渲染时 | **Remotion 渲染插件**专属工作区/manifest/成片/任务/证据 |
| `music/` | （写入方已退役，2026-09-13 核验）原工作台「音乐生成」tab；现行音乐链=本地音频生成 sidecar（`engines/audio_engine`，设置→本地配置 音频区块）→ 章节共享音频导入 BGM，及 ComfyUI 工作流库 `漫影/3_声音/` | 历史 **MiniMax-Music3 整曲产物** WAV（`bgm3-mlxserv-*.wav`，44.1kHz 立体声，同描述+同种子=同一文件）；旧 `music3-gen-runtime-generate`/`music3-gen-music-dir` IPC 已从代码移除。存量文件保留，仍可经 视频工作台→章节共享音频→导入BGM 挂章节音轨 |
| `assets/files/` | 资产入库 | 资产文件存储 |
| `continuity-bibles/<chapterId>/` | 视觉连续性锁定 | 章节连续性圣经 |
| `backups/`（统一备份家，见其 README） | 关键手术前 | 七类：continuity/章节连续性快照、storyboard-flow/分镜流、visual-continuity/晋升整库快照、store/手术备份(.bak-sharded 等)、remotion/ 与 video-use/ 工作区文件备份、legacy-pipeline/旧试点管线归档（08-18 起全部写入点收口于此；旧 visual-continuity-backups/ 仍兼容识别） |
| `editing/` | 剪辑 | 剪辑域产物（store 侧 editing.json 见上） |
| `scripts/` | 项目侧维护脚本 | 道劫 MA 同步/迁移脚本（个人资产，不入应用包） |

> **exports/ 已归档（08-18）**：当前 Remotion 工作流输出在 `remotion/outputs/`、绑定音频在 `remotion/audio/`（活数据 audioRef/manifest 音频源/mediaRef 零引用 exports/）。项目根 `exports/` 是 08-15 前旧 chapter_video 试点管线产物，已整体移入 `backups/legacy-pipeline/exports/`；render-first-shot / bind-voice-audio 两处遗留读取点已改道归档位置。

> 复制项目（Dashboard 副本）：store 文件走 `_p/{新pid}/` 键复制，`novel/` 子树经 `project-folder-copy-novel` 整体随行（`.lock` 与 `source-memory/staging/` 临时产物除外，源无 novel 为合法空操作，目标非空拒绝覆盖）。

### `_p/{projectId}/` 虚拟键（非真实目录）
IPC 四通道（file-storage、project-file 文本/二进制）统一经 `redirectProjectScopedKey` 查注册表直达项目目录；仅未注册位置的 legacy 项目回退 `userData/projects/_p/`。
