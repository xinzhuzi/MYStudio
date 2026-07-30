# 漫影工作室基本工作流教程

本文说明当前 `工作流` 页面从小说原文到 Remotion 章节成片的基础流程。更细的按钮、状态、弹窗和数据关系见 [工作流阶段操作手册](./WORKFLOW_STAGE_OPERATIONS.md)。小说导入、事件分析和策划编剧细节见 [小说导入与策划编剧操作参考](./WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md)，剧本资产提取和剧本资产管理细节见 [剧本资产管理操作参考](./WORKFLOW_ASSET_GENERATION_OPERATIONS.md)，分镜面板与视频工作台细节见 [分镜面板与视频工作台操作参考](./WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md)。安装、配置和排错入口见 [文档中心](../README.md)。

如果需要从“第一步”一直看到最终 MP4 的数据交接、节点职责、JSON 边界和 Remotion 原生渲染细节，请先读 [从分镜到最终视频的完整链路](./WORKFLOW_FULL_VIDEO_PIPELINE.md)。

> 当前正式链（2026-07-30）是 `AI 物料 -> Remotion StoryboardShot MP4 -> 原生 Remotion Studio -> Remotion ChapterVideo MP4`。FFmpeg 不再是正式 renderer、concat、loudnorm 或 Remotion 失败回退；`ffprobe` 仅做只读证据校验。每章分镜数量为动态 M，不受示例数量限制；一次只处理一个 active project/chapter。

## 流程总览

```text
风格与导演
  -> 小说导入
  -> 策划编剧
  -> 剧本资产提取
  -> 剧本资产管理
  -> 分镜面板（每镜 Remotion 配置与 shot jobs）
  -> 视频工作台（原生 Remotion Studio）
  -> ChapterVideo 章节 MP4
```

工作流页本身按阶段推进。每一章按当前阶段输入、生成和验收，完成一章后再进入下一章。整体重心参考 Toonflow 的 `策划 -> 编剧 -> 分镜 -> 出片`：策划编剧负责故事骨架、改编策略和结构化剧本；剧本资产管理负责导演规划、衍生资产和分镜表；分镜面板负责逐镜物料审核、配置和 `StoryboardShot` 生成；视频工作台负责托管原生 Studio 并由 `ChapterVideo` 输出章节视频。

## 准备配置

开始前先完成必要设置：

1. 进入 `设置 -> API 管理 -> 模型服务`，添加供应商、Base URL、API Key 和模型列表。
2. 进入 `设置 -> API 管理`，在 `服务映射` 区域为文本、图片、视频、TTS、视觉理解等能力绑定模型。
3. 进入 `设置 -> API 管理 -> Agent 配置`，为通用AI、剧本草稿、事件分析、分镜分析、视觉提示词润色等任务绑定模型。
4. 如果要使用本地 TTS、声音克隆或角色试听，进入 `设置 -> Python 配置`，点击 `开始配置`。
5. 如果视频接口需要公网图片 URL，进入 `设置 -> 图床配置` 配置图床服务。

Python 和 TTS 依赖不会在应用启动时自动配置。详细说明见 [Python 与本地 TTS 配置](../settings/PYTHON_TTS_SETUP.md)。

## 1. 风格与导演

进入 `工作流 -> 风格与导演`。

先选择视觉手册和导演手册。视觉手册决定画风、角色和场景资产的基础美术语言；导演手册决定镜头、构图、运镜和生产约束。后续策划编剧、导演计划、剧本资产管理、分镜面板和生图生视频都会读取这里的配置。

## 2. 小说导入

进入 `工作流 -> 小说导入`。

1. 点击 `导入原文`。
2. 粘贴小说原文，或选择 `.txt/.md` 文件。
3. 选择 `追加导入` 或 `覆盖导入`。
4. 点击 `确认导入`。
5. 根据需要先做事件分析，让后续策划编剧有结构化上下文。

导入后，流程推进会显示已导入的章节数量。

## 3. 策划编剧

进入 `工作流 -> 策划编剧`。

每章剧本通常按这个顺序生成：

1. `故事骨架`
2. `改编策略`
3. `剧本草稿`
4. `剧本审核`

页面会显示前置阶段是否完成。缺少故事骨架或改编策略时，不建议直接生成剧本草稿。

也可以在 `Skill 对话任务` 中生成上下文包，保存人工整理的骨架、策略、剧本草稿或制作计划。

剧本导入格式和对白写法见 [剧本导入格式示例](./SCRIPT_FORMAT_EXAMPLE.md)。

## 4. 剧本资产提取

进入 `工作流 -> 剧本资产提取`。

1. 选择剧本来源。
2. 点击 `提取资产`。
3. 系统会从剧本中提取角色、场景和道具。
4. 页面会标记资产库是否已有对应资产。
5. 对缺失资产，可以跳转到资产生成或在资产库中补齐。

如果角色需要对白或旁白，进入 `资产 -> 角色库`，在角色详情里点击 `音色`，从资产库音频中选择可克隆的音频样本。也可以在角色库顶部使用 `自动分配音频`。详见 [资产库音色分配](../assets/ASSET_AUDIO_ASSIGNMENT.md)。

## 5. 剧本资产管理

进入 `工作流 -> 剧本资产管理`。

这一阶段用于把结构化剧本、角色、场景和道具转成可用于分镜与视频生成的制作资料。它对应 Toonflow 生产链路中的导演规划、衍生资产预划、衍生资产分析/生成、剧集圣经锁定，以及后续分镜表的前置准备。

常见操作：

- 运行导演计划。
- 根据导演计划分析并生成必要的衍生资产。
- 为角色、场景、道具润色提示词，生成或补齐参考图。
- 使用已配置的视觉风格和导演手册约束提示词。
- 对未匹配资产进行单个生成或批量生成。

剧本资产管理之后不是直接出片，而是进入分镜面板：用导演计划和资产库构建分镜表，写入分镜面板，绑定角色/场景/道具，生成分镜图，并按需要处理角色音色和配音。

如果提示没有可规划的剧本，先回到 `策划编剧` 生成剧本草稿。

## 6. 分镜面板

进入 `工作流 -> 分镜面板`。

1. 点击 `运行 AI 分镜计划`，基于章节剧本、导演计划和资产库生成分镜表。
2. 检查每条分镜的场景、角色、动作、对白、时长和画面素材。
3. 必要时点击 `添加分镜` 手动补充。
4. 为分镜绑定图片或视频素材，生成或补齐分镜图。
5. 按角色音色生成或试听分镜配音。

工作流状态会检查是否已经落地分镜，以及分镜是否绑定画面素材。

素材导入、媒体引用、AI 分镜表 14 列协议和时长计算见 [分镜表与剪辑工作台操作参考](./WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md)。

角色音色分配可在这里的角色列表或 `资产 -> 角色库` 角色详情中完成；本地 TTS 配置仍在设置页。

## 7. 视频工作台（原生 Remotion Studio）

进入 `工作流 -> 视频工作台`。

这里不是第二套自研时间线，而是当前章节的原生 Remotion Studio 宿主：

1. 等待当前章动态 M 个 `StoryboardShot` jobs 都有 current MP4/evidence。
2. 点击 `准备 Remotion 章节工程`，系统将同章 shot slots 编译成 `EditingProjectV1` 和静态 TSX projection。
3. 应用托管一个 loopback 动态端口 Studio server；同项目切章复用 server，切项目先释放 A 的 session/page/watcher/media/port。
4. 在 Remotion 原生 Timeline、Inspector、Preview、Render 中编辑本章；MYStudio 只显示 job、blocked/error、revision 和 evidence。
5. Studio 的 Render 通过 queue bridge 创建唯一 `ChapterVideo` job。Remotion `renderMedia` 直接生成章节 MP4，失败保持 blocked/error，不转 FFmpeg。

每章 workspace 记录位于 `_p/<projectId>/remotion/`：chapter manifest、shot/chapter jobs、evidence、current outputs 和 queue state 分开保存。新版只有在 probe、SHA、revision、input fingerprint 和 bundle identity 全部通过后才替换 current；失败/取消保留旧 current。完整字段和验收见 [从分镜到最终视频的完整链路](./WORKFLOW_FULL_VIDEO_PIPELINE.md)。

## 兼容与高级入口

当前主流程集中在 `工作流` 页面。项目里仍保留一些内部工作区，用于旧数据链路和高级生产：

| 入口 | 说明 |
|---|---|
| [视觉风格管理](../assets/VISUAL_STYLE_MANAGEMENT.md) | 默认风格、我的风格、视觉手册编辑和 AI 提取风格词 |
| [兼容剧本编辑工作区](../director/LEGACY_SCRIPT_WORKSPACE_GUIDE.md) | 三栏剧本编辑、AI 校准、预告片挑选和角色/场景/导演跳转 |
| [角色生成与衣橱](../assets/CHARACTER_GENERATION_GUIDE.md) | 角色定妆图、三视图、表情设定和造型变体 |
| [高级导演与 S级镜头](../director/ADVANCED_DIRECTOR_TOOLS.md) | 单张图片切割、首尾帧、视角切换、四宫格和 Seedance 组级生成 |
| [场景库多视角与四视图](../assets/SCENE_MULTIVIEW_GUIDE.md) | 场景单图、联合图、四视图和批量四视图 |

新项目不需要先进入这些内部页面；只有当主流程中的按钮跳转过去，或需要做精修、兼容旧数据时再使用。

## 常见问题

### 下一步按钮不可用

回到当前工作流阶段查看页面内的缺失提示。通常是前置阶段未完成，例如未导入小说、未生成剧本草稿、未提取资产或分镜未绑定素材。

### 资产提取为空

确认当前章节有剧本草稿。没有剧本时，`剧本资产提取` 无法提取角色、场景和道具。

### 分镜不能生成 Remotion shot

确认分镜已经绑定图片或视频素材、音频路径和当前审核门禁。纯音频素材不会作为
`StoryboardShot` 的视觉输入；缺少素材、审核 receipt 或不支持效果时，队列会保持
`blocked/error`，不会生成旧候选片段。

### 角色试听没有声音

确认：

- `设置 -> Python 配置` 已完成。
- `设置 -> TTS 配置` 可以启动本地 TTS。
- 角色已分配音色。
- 音频样本路径仍然存在。
