#!/usr/bin/env python3
"""Apply source-verified runtime, storage and navigation documentation fixes."""
from docs_refresh_batch import ROOT, update

if __name__ == '__main__':
    update('docs/workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md', [
        ('FFmpeg 只允许作为素材 fixture 生成或 `ffprobe` 只读探针，不是正式 renderer、concat、loudnorm 或失败回退。', 'FFmpeg 可供 video-use / HyperFrames 的媒体辅助使用，并在用户显式允许 `derivedInputPolicy` 时生成可追溯派生输入；它不是正式 renderer、章节 concat、loudnorm 或失败回退。`ffprobe` 用于只读探针。'),
        ('<storageBasePath>/model/TTS/whisper-large-v3-turbo', '<storageBasePath>/comfyui/models/TTS/whisper-large-v3-turbo'),
        ('_p/<projectId>/', '<projectRoot>/'),
        ('<projectRoot>/video-use/<chapterId>/r<revision>/hyperframes-artifact.json', '<projectRoot>/hyperframes/<chapterId>/r<revision>/hyperframes-artifact.json'),
        ('单镜配置和证据自动写入项目 workspace：', '单镜配置和证据自动写入项目 workspace。`<projectRoot>` 由主进程 `project-locations.json` 解析；已注册项目直接落外部项目目录，`_p/<projectId>` 是虚拟键而非额外物理目录。未注册的 legacy 项目才回落到内部数据根的 `_p/<projectId>`：'),
        ('如果用户点击的是章节级“一键自动成片”，[`chapter-auto-video.ts`](../../apps/frontend/lib/studio/chapter-auto-video.ts) 会把上面的人工步骤编排成一条有状态的流水线：', '点击分镜面板的 `一键章视频` 后，[`chapter-auto-video.ts`](../../apps/frontend/lib/studio/chapter-auto-video.ts) 自动完成下表第 1–8 步并停在 `awaiting-review`。第 9 步需要用户确认，第 10–14 步由工作台接力完成；按钮不会自动确认 revision 或直接发布最终 MP4。'),
        ('| 顺序 | 自动阶段 | 做什么 | 失败时 |', '| 顺序 | 阶段职责（并非全部是 runner 状态枚举） | 做什么 | 失败时 |'),
        ('自动化只是替用户按顺序调用，不会绕过 validator、current-slot 或 JSON 交接边界。', '按钮自动段、人工确认与工作台后续段共用 validator、current-slot 和 JSON 交接边界；单镜重试只提交指定镜头，不触发整章审阅。'),
        ('Node 22', 'Electron 内置 Node（要求 >=22）'),
    ])
    update('docs/workflow/WORKFLOW_GUIDE.md', [
        ('每章 workspace 记录位于 `_p/<projectId>/remotion/`', '每章 workspace 记录位于 `<projectRoot>/remotion/`（由主进程项目位置表解析；`_p/<projectId>` 仅为虚拟键）'),
    ])
    update('docs/engineering/STORAGE_AND_DATA.md', [
        ('没有自定义 storage root 时，项目数据和设置文件位于：', '没有自定义 storage root 时，内部 legacy 项目数据根位于下方；项目注册表和应用配置由各自的 userData 解析器管理，不能一概当作此目录的子项：'),
        ('## 当前 userData 目录地图与治理边界', '## userData 目录职责与历史盘面边界'),
        ('和 `mediaPath` 都为空，因此当前 `<storageBasePath>` 就是 `<userData>`。下表描述的是\n当前物理形态和安全 disposition，不授权移动或删除任何条目：', '和 `mediaPath` 都为空，因此当时 `<storageBasePath>` 等于 `<userData>`。这是历史快照，不代表本机今天的设置；下表用于理解目录职责，迁移前需重新读取实际路径，不授权移动或删除任何条目：'),
        ('snapshots、`user/default/workflows/` 工作流库（`漫影/` 域分类）', 'snapshots、默认 `<源码目录>/user/default/workflows/` 用户库（可由 manifest 的 `workflowsDir` 覆盖）与只读仓库模板合并'),
        ('## 导出和导入', '## 外部项目的备份边界\n\n主进程以 `<userData>/project-locations.json` 中的项目位置为权威；renderer 的 `mystudio-project-store.json` / `Project.location` 用于展示。已注册项目的 `_p/<projectId>/...` 虚拟键会重定向到对应外部目录。\n\n下面的统一移动、导出、导入只处理内部 `getProjectDataRoot()` 及 media/assets/skills，**不会遍历外部项目位置，也不会自动携带 userData 下的项目位置表**。外部项目应单独备份完整项目夹和位置登记信息；恢复后核对应用打开的真实目录。只有内部四目录的导出包不能视为全项目备份。\n\n## 导出和导入'),
        ('当前统一导出会包含：', '当前统一导出会包含以下内部存储目录（外部项目边界见上节）：'),
        ('当前 macOS 开发机的默认 `<storageBasePath>` 与 Electron `userDataPath` 相同，设置页下载的\nPython 实际目录为', '2026-08-03 记录中的 macOS 开发机 `<storageBasePath>` 与 Electron `userDataPath` 相同，当时设置页下载的\nPython 目录示例为'),
        ('这是可迁移的当前盘面示例', '这是可迁移的历史盘面示例'),
        ('**video-use（实施目标）**', '**video-use（已接入代码路径，真实生成需独立验收）**'),
        ('<projectRoot>/video-use/<chapterId>/<revisionId>/', '<projectRoot>/video-use/<chapterId>/r<revision>/'),
    ])
    p=ROOT/'docs/engineering/DEVELOPER_ARCHITECTURE.md'
    src=p.read_text(); pairs=[
        ('HyperFrames 的应用运行时集成边界（后续 sidecar）', 'HyperFrames 的应用运行时集成边界'),
        ('本机本轮探针的 `python3` 是 `/opt/homebrew/bin/python3`（Python 3.14.4），这只是开发机事实，不是产品打包依赖。', '开发者应以当前 shell 的 `python3 --version` 检查版本；历史开发机探针不能作为产品打包依赖。'),
        ('所以当前机器的 `<storageBasePath>` 与 `<userData>` 是同一物理根。\n这不会改变路径解析契约，只表示下列目录当前共同位于 Application Support：', '所以当时的 `<storageBasePath>` 与 `<userData>` 是同一物理根。\n这是历史快照；今天的真实目录须重新读取配置，不据此推断当前机器仍未迁移：'),
        ('因此当前 macOS 运行时实际使用的是', '该历史 macOS 配置对应的路径示例是'),
        ('snapshots、`user/default/workflows` 工作流库', 'snapshots、默认 `<源码目录>/user/default/workflows` 用户库（可覆写 `workflowsDir`）'),
        ('| `<storageBasePath>/comfyui/` | ComfyUI 引擎家', '| `<userData>/comfyui/`（可由 `MYSTUDIO_COMFYUI_HOME` 覆写） | ComfyUI 引擎家'),
        ('Node 22', 'Electron 内置 Node（要求 >=22）'),
    ]
    update(p.relative_to(ROOT),[(a,b) for a,b in pairs if a in src])
    update('docs/engineering/PACKAGING_AND_SMOKE_TESTING.md', [
        ('→ 纯开发兜底 `~/.manying-dev`。', '→ 纯开发兜底 `~/.manying-dev/comfyui/`。'),
    ])
    update('docs/engineering/TROUBLESHOOTING.md', [
        ('MYSTUDIO_SMOKE_USER_DATA_DIR="<userData>" \\\n', 'MYSTUDIO_SMOKE_USER_DATA_DIR="<isolatedSmokeUserData>" \\\n'),
        ('如果 smoke 输出 `whiteRatio=0.000` 且退出码为 0，说明安装版渲染基本正常。', '使用隔离的 smoke userData，避免把真实业务数据当测试目录。只有 smoke 退出码为 0 且报告中的路由检查通过，才说明本次安装版 UI/shell 验证通过；`whiteRatio` 只是其中一个指标，不证明真实生成链通过。'),
        ('生成走的工作流模板是否在引擎家 `user/default/workflows/漫影/` 对应域', '生成模板是否来自只读 `repo:` 工作流库，或当前配置的用户工作流目录（默认 `<源码目录>/user/default/workflows/`）'),
        ('- 目录下是否存在 `projects/` 和 `media/`。', '- 内部存储目录是否存在 `projects/` 和 `media/`；外部项目还要核对 `<userData>/project-locations.json` 登记的真实目录。'),
        ('`tts-runtime/` 属于运行时下载和配置目录', '`TTS/runtime/`（旧版 `tts-runtime/` 仅兼容）属于运行时下载和配置目录'),
    ])
    update('docs/settings/SETTINGS_PANEL_OPERATIONS.md', [
        ('| `MCP 服务` | 管理 MCP（Model Context Protocol）服务接入。 | 【暂无文档】 |', '| `MCP 服务` | 登记服务器、测试连接和导入/导出 JSON。 | [MCP 服务配置](./MCP_SERVICES_GUIDE.md) |'),
        ('| `图片规格` | 配置生图输出规格。 | 【暂无文档】 |', '| `图片规格` | 默认生图引擎、画幅、分辨率和兼容重试。 | [图片规格与默认生图引擎](./IMAGE_SIZE_GUIDE.md) |'),
        ('存储四目录', '存储目录'),
        ('第二个区块继续复用原 `LocalTtsPanel`', 'TTS 区块复用 `LocalTtsPanel`'),
        ('第三个区块嵌入现有 `RenderingSettingsTab`', '视频区块嵌入 `RenderingSettingsTab`'),
        ('检查 HyperFrames 应用级 Node `>=22` sidecar，不使用 Electron 内置 Node 20。', '检查 HyperFrames 使用的 Electron 内置 Node 是否满足 `>=22`；worker 通过 `ELECTRON_RUN_AS_NODE=1` 启动。'),
        ('HyperFrames 会准备应用级 Node 22 与锁定 `hyperframes@0.7.101`', 'HyperFrames 复用 Electron 内置 Node，并准备锁定的 `hyperframes@0.7.109` profile'),
        ('HyperFrames 使用应用级 Node 22 sidecar。', 'HyperFrames 使用 Electron 内置 Node 的独立 worker/profile。'),
        ('到 `<storageBasePath>/model/TTS`（旧版 `tts-models`', '到 `<storageBasePath>/comfyui/models/TTS`（旧版 `model/TTS`、`tts-models`'),
        ('`python/` 与 `model/TTS/` 下载目录', '`python/` 与 `comfyui/models/TTS/` 下载目录'),
        ('点击 `导出` / `导入` 处理前四类数据。', '点击 `导出` / `导入` 处理前四类内部数据；外部项目目录须单独备份，见存储指南。'),
    ])
    update('docs/settings/PYTHON_TTS_SETUP.md', [
        ('到同一个 `<storageBasePath>/model/TTS`', '到同一个 `<storageBasePath>/comfyui/models/TTS`'),
        ('模型文件和缓存默认位于 `<storageBasePath>/model/TTS`', '模型文件和缓存默认位于 `<storageBasePath>/comfyui/models/TTS`'),
        ('`python/` 与 `model/TTS/`', '`python/` 与 `comfyui/models/TTS/`'),
    ])
