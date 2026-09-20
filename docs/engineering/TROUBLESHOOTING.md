# 常见故障排查

本文汇总 MYStudio 常见问题的排查顺序。

## 应用白屏或页面加载异常

优先使用安装版 smoke 验证，不要只看开发服务器：

```bash
cd <repo-root>/apps
MYSTUDIO_SMOKE_APP_BIN="/Applications/漫影工作室.app/Contents/MacOS/漫影工作室" \
MYSTUDIO_SMOKE_USER_DATA_DIR="<isolatedSmokeUserData>" \
MYSTUDIO_SMOKE_DEBUG_PORT=9361 \
npm run smoke:desktop
```

使用隔离的 smoke userData，避免把真实业务数据当测试目录。只有 smoke 退出码为 0 且报告中的路由检查通过，才说明本次安装版 UI/shell 验证通过；`whiteRatio` 只是其中一个指标，不证明真实生成链通过。

需要看前端报错时，打开 [开发模式与控制台](../settings/DEVELOPMENT_MODE.md)。

## Python 配置失败

进入：

```text
设置 → 本地配置 -> Python 运行环境
```

检查：

- 是否点击了 `开始配置`。
- `Python 使用路径` 是否显示实际路径。
- `安装明细` 是否有失败项。
- 下载源是否可访问。
- 磁盘空间是否足够。

Python 不会在应用启动时自动配置。详细说明见 [Python 与本地 TTS 配置](../settings/PYTHON_TTS_SETUP.md)。

## TTS 后端启动失败

检查：

- Python 配置是否完成。
- `TTS Python 依赖` 是否已安装。
- `17593` 端口是否被占用。
- 是否有残留 TTS 后端进程。

可用命令检查残留进程：

```bash
pgrep -fl "漫影工作室|python.*tts" || true
```

如果当前 macOS 环境无法使用进程列表命令，可以改用“活动监视器”搜索 `漫影工作室`、`python` 或 `tts`。

## ComfyUI 引擎问题（本地生图/视频产线）

本地生成产线（K2 图像 / H3 视频 / 音乐工作流）跑在自管 ComfyUI 引擎上（引擎家 `<userData>/comfyui/`）。常见排查顺序：

- **引擎卡一直转 / 引擎未就绪**：先看 `设置 → 本地配置 → ComfyUI 引擎` 的状态与端口；引擎端口走 17xxx 动态分配，全应用寻址真源是引擎状态里的 `port`。报「更新失败」时先核 `comfyui/manifest.json` 的 version 与正在运行的引擎——更新本体常已成功。
- **疑似孤儿进程占口**：现象=CPU 飙高/无限重启。配方：进程普查（`pgrep -fl`）→ 按 PPID 分组（PPID=1 即孤儿）→ `lsof -i :<port>` 找占口者，杀掉孤儿后再从引擎卡启动。历史事故：孤儿 sidecar 占 17595 导致绑定失败无限重启。
- **无新日志 = spawn 没触发**：引擎日志看 `<userData>/logs/sidecars/`（`comfy-*` 等模块捕获）与引擎家内日志；完全没有新日志说明启动链没走到 spawn，先查引擎卡状态机与 `engine.lock`（双实例互斥锁）。
- **插件 import 失败**：ComfyUI 启动日志的 `collect_import_failures` 会点名具体插件；生态插件升级走引擎卡更新页对应插件行「更新」，或 ComfyUI 内 Manager → Install Custom Nodes → 自身 Try update；不要用 pip 手装、不要点 Manager 的 RESTART Engine（走引擎卡）。
- **改了 my_nodes 前端没生效**：`my_nodes` 真源在仓库 `apps/backend/engines/comfyui/my_nodes/`，运行时同步进引擎家；引擎 spawn 用 Resources 覆写引擎家——改 `manying.js` 等文件后必须重新打包才进安装版（开发双家另见 `.agents/skills/comfyui/machine.md`）。
- **webview 白屏/黑屏**：先确认引擎健康（引擎卡状态=运行中）与 webview 端口一致；云端节点 Sign in 遮罩等界面问题见 [定制代码地图](../comfyui-kb/定制代码地图.md)。

引擎布局/端口/启动方式档案见 `.agents/skills/comfyui/machine.md`；K2/H3 产线参数排障见 [参数速查](../comfyui-kb/参数速查.md) 与 [排障 runbook](../comfyui-kb/K2上色/runbook_画稿上色_错误应对.md)。

## Remotion 渲染失败

正式分镜和章节视频只使用 Remotion。`renderMedia` 直接生成 MP4；`ffprobe` 与 SHA-256
只用于只读证据校验，不执行 FFmpeg 拼接、loudnorm、二次编码或失败回退。

如果提示浏览器未准备好：

- 进入设置页的渲染页签，主动下载或更新匹配当前 Remotion 版本的 Chrome Headless Shell。
- `not-installed` 或 `update-required` 会阻止 MP4 导出，但不影响 Electron Chromium 中的 Player 预览。
- 应用不会在导出时隐式下载浏览器，也不会把 Remotion 运行失败静默回退为其它 renderer。

如果提示效果不支持、bundle 漂移、缺少分镜或 evidence 不一致：

- 先回到分镜面板修复对应 `StoryboardShot` 的物料、配置或审核状态。
- 确认当前项目/章节的 bundle hash、revision、input fingerprint 和 Headless Shell 版本一致。
- 不要用历史 `VideoCandidate`、旧 concat MP4 或旧工作台记录替代当前 slot；修复后从队列重试。

## 自动分配音频不准确

检查：

- 音频文件名是否包含年龄、性别、气质等线索。
- 音频详情是否有说话内容。
- `设置 → 云端AI -> Agent 配置 -> 通用AI` 是否配置。
- 如果 AI 未配置，系统会使用本地规则分配。

详细说明见 [资产库音色分配](../assets/ASSET_AUDIO_ASSIGNMENT.md)。

## 图片或视频生成失败

先分清链路（两条并行，互不影响）：

**本地 ComfyUI 产线**（「本地模型」页漫影生图 / ComfyUI 画布 / MY 工作流的分镜视频生成、图像节点图页签）：

- `设置 → 本地配置 → ComfyUI 引擎` 引擎是否运行中、端口是否就绪。
- 「模型」页签里对应家族（checkpoints/LoRA 等）是否就位（`comfyui/models/` 活清单）。
- 生成模板是否来自只读 `repo:` 工作流库，或当前配置的用户工作流目录（默认 `<源码目录>/user/default/workflows/`）（参数口径见 [参数速查](../comfyui-kb/参数速查.md)）。

**云端 AI 链路**（资产/导演/S级等内部工作区）：

- `设置 → 云端AI -> 模型服务` 是否配置了服务商。
- `设置 → 云端AI -> 模型映射` 是否给图片/视频功能绑定了模型。
- API Key 和 Base URL 是否可用。
- 需要公网图片 URL 的视频接口是否已配置图床。

详细说明见 [设置与云端AI配置](../settings/API_SETTINGS_GUIDE.md)。

## 图床上传失败

检查：

- `设置 -> 图床配置` 是否启用可用图床。
- 当前网络是否能访问对应图床。
- API Key 是否正确。
- 如果使用自定义图床，确认接口返回中包含可用 URL。

## 项目数据看起来丢失

进入：

```text
设置 -> 存储
```

检查：

- 当前存储位置是否指向正确目录。
- 内部存储目录是否存在 `projects/` 和 `media/`；外部项目还要核对 `<userData>/project-locations.json` 登记的真实目录。
- 是否误指向了空目录。
- 是否需要使用 `指向已有数据目录` 恢复。

详细说明见 [存储与数据迁移](./STORAGE_AND_DATA.md)。

## 资产库内容丢失或缩略图不显示

独立资产库不在 `projects/` 里面，先检查当前存储根目录下是否存在：

```text
assets/assets.db
assets/files/role/
assets/files/scene/
assets/files/tool/
assets/files/clip/
assets/files/audio/
```

图片类资产缩略图在 `assets/thumbs/`，缩略图缺失时应用会尝试异步重新生成；原文件缺失时需要从旧存储目录恢复 `assets/files/`。

如果刚刚更改过 `设置 -> 存储` 的存储位置，当前统一导出/导入/移动会覆盖 `projects/`、`media/`、`assets/` 和 `skills/`。`python/`、`comfyui/models/TTS/`（旧版 `model/TTS`、`tts-models/` 仅作迁移兼容）与 `TTS/runtime/`（旧版 `tts-runtime/` 仅兼容）属于运行时下载和配置目录，不随该操作复制。

添加、批量删除、多图、重新出图和音频说话内容识别的操作说明见 [资产导入与管理](../assets/ASSET_IMPORT_AND_MANAGEMENT.md)。

## 打包后不是最新版本

覆盖安装后比对 `app.asar`：

```bash
shasum -a 256 \
  "<repo-root>/apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/app.asar" \
  "/Applications/漫影工作室.app/Contents/Resources/app.asar"
```

两个 hash 必须一致。完整流程见 [打包、安装与 Smoke 测试](./PACKAGING_AND_SMOKE_TESTING.md)。

## 仍然无法定位

收集以下信息再排查：

- 发生问题的页面。
- 刚点击的按钮或操作路径。
- 控制台错误。
- smoke 输出。
- 本地配置页的 Python 运行环境安装明细。
- `<userData>/logs/sidecars/` 下对应模块日志（TTS / ComfyUI 引擎 / image-gen 等）与 ComfyUI 引擎家的 `manifest.json`。
- 当前存储位置。
