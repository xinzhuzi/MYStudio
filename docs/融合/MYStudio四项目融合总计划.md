# MYStudio 四项目融合总计划

## 1. 目标与结论

MYStudio 的融合方向是：以当前 Electron + React + TypeScript + Zustand 桌面项目为主体，吸收 Toonflow-app、huobao-drama、moyin-creator、LTX-Desktop 中最适合短剧与漫剧生产的能力，形成从小说/剧本到分镜、素材、配音、字幕、剪辑、导出的本地优先工作台。

当前 MYStudio 已具备 Moyin 基底、项目级文件存储、配置中心、工作流入口、`studio-store`、`studio` 类型定义，以及 Electron main process 内的最小 FFmpeg 渲染器。融合计划不建议引入独立 Nuxt/Hono/FastAPI 后端，也不建议整套复制源项目结构；应以 MYStudio 现有代码为主线，按模块迁移可验证的能力。

核心策略：

- 保留 MYStudio/Moyin 的桌面壳、UI 组件、项目存储、API 配置、多 Key 调度和 S 级多模态工作流。
- 引入 Huobao Drama 的短剧业务模型：角色、场景、分镜、音色、TTS、字幕、单镜合成、整集拼接。
- 引入 LTX-Desktop 的专业剪辑导出核心：多轨 flatten、字幕 drawtext、PCM 音频混音、导出取消、FFmpeg 路径探测。
- 引入 Toonflow-app 的 Agent/Skill 编排思想：三层 Agent、文件化 Skill、可编程供应商、小说事件图谱、ProductionAgent 分镜/资产工作流。

## 2. 当前 MYStudio 基线

已确认的当前基线：

- 项目定位：`package.json` 中为 `manying-studio`，产品名为“漫影工作室”，描述为“本地优先的 AI 漫剧与短剧制作工作台”。
- 工作流入口：`README.md` 已定义“小说 -> Skill -> 剧本 -> 分镜 -> 剪辑 -> 配置”的 V1 边界。
- 类型主线：`src/types/studio.ts` 已包含 `NovelChapter`、`AgentWorkData`、`StoryboardItem`、`ProductionTrack`、`VideoCandidate`、`VendorConfig`、`ModelDefinition`、`ModelBinding`、`TrackRenderPlan`、`EpisodeMergePlan`。
- 状态主线：`src/stores/studio-store.ts` 已负责素材、小说章节、Agent 工作数据、分镜、制作 track、候选视频和上下文包。
- 制作逻辑：`src/lib/studio/production.ts` 已能把分镜按 `trackKey` 分组，并生成 `TrackRenderPlan` 与 `EpisodeMergePlan`。
- 本地渲染：`src/electron/main.ts` 已有 `studio-render-track-candidate`、`studio-save-material`、`studio-merge-episode` IPC，使用本机 `ffmpeg` 做图片/视频转片段、字幕烧录和候选片段拼接。

当前主要短板：

- 分镜字段仍偏简化，缺少 Huobao 风格的镜头语言、角色/场景绑定、BGM、音效、TTS、字幕样式等生产字段。
- FFmpeg 渲染器集中在 `src/electron/main.ts`，缺少可测试的导出子模块、进度、取消、多轨、音频混音和媒体探测。
- Agent/Skill 目前是上下文包和人工保存数据，尚未形成 Toonflow 风格的决策层、执行层、监督层与可编辑 Skill 工作台。
- 配置中心已有模型与供应商结构，但还没有 Toonflow 风格动态 vendor 脚本的隔离执行和能力校验。

## 3. 源项目精华抽取

### 3.1 Toonflow-app

最值得吸收：

- 三层 Agent 协作：ScriptAgent/ProductionAgent 中的决策层、执行层、监督层拆分，适合降低长链路创作失控风险。
- Skill 文件化：`data/skills` 中把剧本、分镜、资产、风格、视频提示词规范外置为 Markdown，便于用户调优。
- 可编程供应商：`data/vendor/*.ts` 与 `src/utils/vendor.ts` 的动态供应商逻辑，为私有模型、中转站和多模型能力描述提供思路。
- 小说事件图谱：章节事件提取、事件状态、按事件上下文改编，适合 MYStudio 的小说导入阶段。
- ProductionAgent 流水线：导演计划、分镜表、分镜面板、资产衍生、资产生成、分镜视频提示词分离。

融合方式：

- 不迁移 Express/Socket/SQLite 运行时。
- 抽取 Agent 编排、Skill 文档结构、供应商能力描述格式和视频提示词规范。
- 将 Toonflow 的 `storySkeleton`、`adaptationStrategy`、`scriptDraft`、`productionPlan` 思路映射到 MYStudio 现有 `AgentWorkKey`。

### 3.2 huobao-drama

最值得吸收：

- 短剧域模型完整：drama、episode、character、scene、storyboard、AI config、voice、image generation、video generation、video merge。
- 分镜字段规范：`title / shot_type / angle / movement / location / time / character_ids / action / dialogue / description / result / atmosphere / image_prompt / video_prompt / bgm_prompt / sound_effect / duration / scene_id`。
- 音色分配流程：按性别、年龄、性格、角色定位给角色分配音色，并生成试听。
- 单镜合成链路：视频 + TTS 音频 + SRT 字幕，合成后写回分镜状态。
- 整集拼接链路：只允许已合成镜头进入 merge，输出成片并记录时长。

融合方式：

- 不迁移 Nuxt/Hono/Drizzle/better-sqlite3 整套架构。
- 把业务字段和状态机吸收到 MYStudio 的 Zustand store 和类型定义。
- 把 Huobao 的 TTS、字幕、单镜合成、整集合成策略转为 Electron IPC 与本地文件存储实现。

### 3.3 moyin-creator

最值得保留：

- 当前 MYStudio 的主要基底：Electron 30、React 18、Vite、Zustand、Radix UI、Tailwind、文件型项目存储。
- API 配置与功能绑定：`VendorConfig`/provider、feature binding、多 Key 轮询、服务映射。
- AI 批处理能力：自适应分批、输入/输出 token 双约束、并发、重试、部分成功合并。
- S 级工作流：多镜头合并叙事、@Image/@Video/@Audio 引用、首帧图拼接、模型参数约束校验。
- 角色一致性、场景校准、分镜提示词、导演板块和媒体面板。

融合方式：

- 作为 MYStudio 的默认 UI、存储、设置、批处理和桌面分发基底继续演进。
- 不重复引入另一套项目壳。
- 后续新增模块应优先沿用现有组件、store、storage adapter 和 IPC 风格。

### 3.4 LTX-Desktop

最值得吸收：

- 多轨时间线模型：视频/图片/音频/字幕 clip 统一进入导出计划。
- `flattenTimeline`：按时间边界切段，高轨覆盖低轨，生成可串接的视觉 segment。
- `buildVideoFilterGraph`：生成 FFmpeg `filter_complex_script`，支持 trim、speed、reverse、flip、scale、pad、全局 fps、letterbox、drawtext 字幕。
- `mixAudioToPcm`：从音频 clip 和视频内音频提取 PCM，按时间线位置、trim、speed、reverse、volume 混音。
- `findFfmpegPath` 与 `runFfmpeg`：优先查内置环境，再回退系统 `ffmpeg`，支持活动导出进程和取消。

融合方式：

- 不引入 LTX 的 FastAPI/GPU 模型后端。
- 优先把 Electron 导出侧拆成可测试子模块，吸收 timeline flatten、filter graph、audio mix、cancel。
- UI 层只吸收专业剪辑交互原则：editorModel/session/history/projectSync 分离、selector/action 约束、热路径用 refs 或 DOM commit。

## 4. 目标架构

### 4.1 总体分层

目标架构保持单桌面应用：

```text
Renderer React UI
  -> Zustand stores
  -> studio workflow services
  -> Electron preload IPC
  -> Electron main export/render modules
  -> local files + ffmpeg
```

边界原则：

- Renderer 负责工作流 UI、状态编辑、任务触发和结果展示。
- Zustand 保存项目级创作数据和可持久化状态。
- Electron main 负责本地文件、媒体探测、FFmpeg、导出取消和安全路径处理。
- AI 供应商调用继续从现有 API 配置/worker/batch 体系演进，不引入常驻独立后端。

### 4.2 模块拆分方向

推荐后续把 `src/electron/main.ts` 中的本地 FFmpeg Renderer 拆出为导出子模块。计划文档中称为 `renderer/export` 能力域，落地路径建议使用 Electron 侧目录，例如：

- `src/electron/export/ffmpeg-utils.ts`：FFmpeg 路径探测、进程管理、取消、媒体探测。
- `src/electron/export/timeline.ts`：多轨 clip 到视觉 segment 的 flatten。
- `src/electron/export/video-filter.ts`：FFmpeg filter graph 构建。
- `src/electron/export/audio-mix.ts`：PCM 音频混音。
- `src/electron/export/export-handler.ts`：IPC 编排、临时文件、输出文件、错误处理。

这样能保留现有 IPC 兼容，同时把复杂渲染逻辑从 `src/electron/main.ts` 中拆出。

### 4.3 数据流

目标工作流：

```text
小说/剧本输入
  -> 事件提取与改编策略
  -> 角色/场景/分镜结构化
  -> 角色音色与素材绑定
  -> 分镜图片/视频/音频生成或导入
  -> 单镜候选片段
  -> 多轨剪辑时间线
  -> FFmpeg 导出成片
```

最小可落地版本：

- 先让现有“小说 -> Skill -> 剧本 -> 分镜 -> 剪辑”流程继续可用。
- 扩展分镜字段和素材引用，但保持旧字段兼容。
- 单镜合成继续使用 `studio-render-track-candidate`。
- 多轨导出作为新增能力，不阻断现有候选片段拼接。

## 5. 类型与接口规划

### 5.1 `StoryboardItem`

在当前字段基础上扩展生产字段：

- 镜头字段：`title`、`shotType`、`angle`、`movement`、`location`、`time`、`action`、`result`、`atmosphere`。
- 提示词字段：`imagePrompt`、`videoPrompt`、`bgmPrompt`、`soundEffect`。
- 绑定字段：`sceneId`、`characterIds`、`assetIds`。
- 音频字段：`voiceId`、`ttsAudioRef`、`bgmRef`、`soundEffectRefs`。
- 字幕字段：`dialogue`、`subtitleText`、`subtitleStyle`、`subtitleRef`。
- 状态字段：继续使用 `StoryboardState`，后续可细化为 `imageState`、`videoState`、`ttsState`、`composeState`。

兼容策略：

- 保留当前 `prompt`、`videoDesc`、`mediaRef`。
- 旧数据没有新字段时使用空值或从 `videoDesc` 提取。
- `videoDesc` 可作为 Toonflow 风格复合描述继续存在，但 UI 应逐步转向结构化字段。

### 5.2 `ProductionTrack`

在当前 track 分组基础上扩展：

- 多轨字段：`trackIndex`、`trackType`、`startTime`、`duration`。
- 候选字段：保留 `candidateVideoIds` 与 `selectedVideoId`。
- 生成字段：`prompt`、`referenceMediaIds`、`providerBinding`、`renderProfile`。
- 状态字段：`idle`、`queued`、`rendering`、`ready`、`failed` 继续可用。

兼容策略：

- 当前 `groupStoryboardsIntoTracks` 按 `trackKey` 分组仍作为单轨制作入口。
- 后续多轨时间线不替代制作 track，而是承接已选片段、素材和字幕。

### 5.3 新增导出计划类型

规划新增类型：

```ts
type TimelineClipKind = "video" | "image" | "audio" | "subtitle" | "gap";

interface TimelineExportClip {
  id: string;
  kind: TimelineClipKind;
  sourcePath?: string;
  startTime: number;
  duration: number;
  trimStart: number;
  speed: number;
  reversed: boolean;
  trackIndex: number;
  volume: number;
  muted: boolean;
  text?: string;
  style?: SubtitleStyle;
}

interface TimelineExportPlan {
  kind: "timeline-export";
  clips: TimelineExportClip[];
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  codec: "h264" | "prores" | "vp9";
  quality: number;
  ffmpegProfile: "timeline-filtergraph-pcm-mix";
}
```

这类类型应放在 `src/types/studio.ts` 或拆分为 `src/types/export.ts`。若拆分，`studio.ts` 只保留工作流类型，导出类型集中在 `export.ts`。

### 5.4 Electron IPC

保留兼容：

- `studio-save-material`
- `studio-render-track-candidate`
- `studio-merge-episode`

规划新增：

- `studio-probe-media`：读取媒体时长、尺寸、fps、是否含音频。
- `studio-export-timeline`：接收 `TimelineExportPlan`，执行多轨导出。
- `studio-export-cancel`：取消当前导出进程。
- `studio-extract-frame`：从视频截取封面或关键帧，用于素材库和时间线缩略图。

错误策略：

- IPC 返回 `{ success: boolean, error?: string, filePath?: string, previewUrl?: string }`。
- FFmpeg stderr 只返回最后关键错误，完整日志写入本地日志或控制台。
- 缺少 FFmpeg 时给出明确安装提示；后续打包阶段再考虑内置 FFmpeg。

### 5.5 配置中心

继续沿用当前：

- `VendorConfig`
- `ModelDefinition`
- `ModelCapabilities`
- `ModelBinding`

吸收 Toonflow 思路：

- 供应商可以声明 text/image/video/tts/vision 能力。
- video model 可声明 `imageReference`、`videoReference`、`audioReference`、`durations`、`resolutions`、`modes`。
- 动态 vendor 脚本默认先作为文档和实验能力，不直接开放无限制执行；正式实现时必须有沙箱、校验、导入导出和回滚。

## 6. 五阶段实施路线

### Phase 1: 统一生产模型

目标：把 MYStudio 当前简化工作流和 Huobao/Toonflow 的生产字段对齐。

关键工作：

- 扩展 `StoryboardItem`、`ProductionTrack` 和相关 store action。
- 建立分镜字段编辑 UI：镜头标题、景别、角度、运镜、动作、对白、BGM、音效、时长、场景/角色绑定。
- 在现有 `createStoryboardsFromChapters` 基础上生成结构化分镜草稿。
- 给旧项目数据加兼容读取逻辑，不破坏当前 `prompt`、`videoDesc`、`mediaRef`。

验收：

- 导入小说后仍能生成分镜。
- 手工编辑新字段后刷新项目仍能保留。
- 旧项目打开不报错，旧分镜仍能进入当前剪辑流程。

### Phase 2: TTS、字幕与单镜合成

目标：把 Huobao 的“视频 + 配音 + 字幕”单镜合成链路融入 MYStudio。

关键工作：

- 增加角色音色字段和音色分配 UI。
- 增加 TTS 绑定和音频素材保存流程。
- `TrackRenderPlan` 支持音频输入和字幕样式。
- 当前 `burnStudioSubtitle` 从简单 SRT 升级为可控字幕样式，先支持字号、位置、颜色、描边。
- 单镜候选片段支持视频原声、TTS、静音三种策略。

验收：

- 无对白分镜不会生成 TTS，也不会烧录空字幕。
- 有对白分镜能生成或绑定音频，并合成带字幕的候选片段。
- 合成失败时保留原素材和错误原因。

### Phase 3: 专业多轨导出

目标：把 LTX-Desktop 的导出核心融合为 MYStudio 的本地剪辑能力。

关键工作：

- 新增多轨时间线导出数据结构。
- 实现 visual flatten：按时间边界切段，高轨覆盖低轨。
- 实现 `filter_complex_script`：trim、speed、reverse、flip、scale、pad、全局 fps、letterbox、drawtext 字幕。
- 实现 PCM 音频混音：音频 clip 和视频内音频按 timelineStart、trim、speed、reverse、volume 混合。
- 增加导出取消和 FFmpeg 进程管理。

验收：

- 图片、视频、音频、字幕混合时间线能导出 h264 mp4。
- 多轨重叠时高轨画面优先。
- 音频能按时间线位置混入，静音和音量设置有效。
- 导出取消后临时文件被清理，不留下半成品状态。

### Phase 4: Agent/Skill 与供应商能力

目标：把 Toonflow 的 Agent/Skill 体系转成 MYStudio 可维护的本地工作流。

关键工作：

- 建立文件化 Skill 管理：剧本、改编、导演计划、分镜表、视频提示词、美术风格。
- `SkillContextPackage` 从只读上下文包升级为可选择任务、可保存版本、可复用模板。
- 建立三层 Agent 概念：决策层负责拆任务，执行层产出结构化内容，监督层做检查和修订建议。
- 供应商能力面板显示模型可用的输入类型、引用数量、时长、分辨率和模式。
- 动态 vendor 脚本作为高级能力，先只允许导入、静态校验和禁用状态保存。

验收：

- 用户能查看和编辑 Skill 文档。
- 同一项目能保存多轮 Agent 工作数据。
- 模型绑定能按 text/image/video/tts/vision 区分。
- 供应商能力不足时在生成前阻止，而不是请求后失败。

### Phase 5: 批处理、验收样例与分发

目标：把长链路生产从“能跑”提升到“可批量、可恢复、可验收”。

关键工作：

- 复用 Moyin 的批处理：分批、并发、重试、部分成功、进度回调。
- 为图片生成、视频生成、TTS、单镜合成、整集导出建立统一任务状态。
- 增加 demo 项目或测试样例：短剧 3 到 5 个镜头，覆盖角色、场景、配音、字幕、导出。
- 打包前增加 FFmpeg 检测说明；后续评估内置 FFmpeg 或引导安装。

验收：

- 批量任务失败不会清空已成功结果。
- 用户可以重试单个失败镜头。
- demo 项目能从素材绑定走到本地导出成片。
- `npm run lint`、`npm run test`、本地 FFmpeg smoke 均通过。

## 7. 后续实现验收清单

每个实现阶段都应至少执行：

- `npm run lint`
- `npm run test`
- `ffmpeg -version`
- 单镜图片转视频 smoke
- 单镜视频 + TTS + 字幕 smoke
- 多个候选片段拼接 smoke
- LTX 风格多轨导出 smoke

文档验收：

- 本文件存在于 `docs/融合/MYStudio四项目融合总计划.md`。
- 章节包含源项目抽取、目标架构、类型/IPC、阶段路线、验收清单和许可边界。
- 文档中的路径和模块名与当前磁盘代码一致。

## 8. 许可与集成边界

已知许可信息：

- MYStudio：AGPL-3.0-or-later，并有商业许可文件。
- moyin-creator：README 和 LICENSE 显示 AGPL-3.0，并有商业许可文件。
- Toonflow-app：README 显示 Apache-2.0，并附补充商业协议说明。
- LTX-Desktop：README 显示 Apache-2.0，第三方和模型许可见 NOTICES。
- huobao-drama：README 徽标显示 CC BY-NC-SA 4.0。

集成原则：

- 优先复用设计思想、数据模型经验、工作流策略和可重新实现的算法。
- 直接复制源代码前必须单独确认许可证兼容性和归属边界。
- Huobao Drama 涉及非商业共享许可标识，商业闭源或再分发前需要额外确认。
- LTX-Desktop 的模型权重和第三方组件不纳入 MYStudio 默认分发；如需引入，需单独处理模型许可证和 NOTICES。

## 9. 不做事项

本融合计划不做以下事项：

- 不把 MYStudio 改成 Nuxt、Hono、FastAPI 或独立后端架构。
- 不直接整套搬迁 Toonflow、Huobao、Moyin 或 LTX 的目录结构。
- 不删除当前 MYStudio 的工作流入口和已有 V1 FFmpeg 能力。
- 不在没有许可确认的情况下复制 Huobao 的实现代码。
- 不把动态 vendor 脚本直接开放为默认执行能力。

## 10. 推荐下一步

下一步应先执行 Phase 1。优先改动范围是 `src/types/studio.ts`、`src/stores/studio-store.ts`、`src/lib/studio/production.ts` 和工作流 UI。Phase 1 完成后，再开始拆分 `src/electron/main.ts` 中的 FFmpeg 渲染逻辑，为 Phase 2 和 Phase 3 降低风险。

## 11. 详细对比与落地映射

本节用于把“四个源项目各自强在哪里、弱在哪里、该取什么、不该取什么、落到 MYStudio 哪些模块”讲清楚。后续实现时应优先按本节做拆解，避免因为源项目能力很多而出现盲目搬运。

### 11.1 产品定位对比

| 项目 | 核心定位 | 强项 | 弱项/不适合直接继承 | MYStudio 应吸收的结论 |
|---|---|---|---|---|
| MYStudio | 本地优先 AI 漫剧/短剧桌面工作台 | Electron 桌面壳、Zustand 项目存储、现有工作流入口、最小本地 FFmpeg | 生产模型和剪辑导出还偏 V1，Agent/Skill 尚未成体系 | 作为唯一主工程和融合宿主 |
| moyin-creator | AI 动漫/短剧分镜创作桌面工具 | 剧本、角色、场景、导演、S 级多模态、API 配置、多 Key 调度、批处理 | 不是专业 NLE，FFmpeg 合成能力较弱 | 继续作为 UI、存储、设置、批处理和 S 级工作流基底 |
| Toonflow-app | AI 短剧工厂和 Agent 工作台 | 三层 Agent、Skill 文件化、可编程供应商、小说事件图谱、ProductionAgent | Express/Socket/SQLite 运行时与 MYStudio 当前桌面架构不一致 | 只吸收 Agent/Skill/供应商/事件图谱设计 |
| huobao-drama | AI 短剧生成平台 | 短剧域模型、分镜字段、角色音色、TTS、字幕、单镜合成、整集拼接 | Nuxt/Hono/Drizzle 后端链路不适合直接并入 | 只吸收业务模型和合成链路 |
| LTX-Desktop | AI 视频生成 + 专业视频编辑桌面端 | 多轨时间线、flatten、filter graph、PCM 混音、导出取消、媒体探测 | Python/FastAPI/GPU 模型服务不是 MYStudio 当前目标 | 只吸收编辑器边界和 Electron 导出核心 |

融合后的 MYStudio 应避免“四不像”：它不是 Toonflow 的服务端工厂，不是 Huobao 的 Web 平台，也不是 LTX 的本地模型推理器；它应是 Moyin/MYStudio 桌面工作台加上短剧生产域模型、Agent/Skill 编排和专业本地导出能力。

### 11.2 技术架构对比

| 维度 | MYStudio 当前 | moyin-creator | Toonflow-app | huobao-drama | LTX-Desktop | 融合决策 |
|---|---|---|---|---|---|---|
| 桌面壳 | Electron + Vite | Electron + Vite | Electron/Node 服务混合 | Web 前后端 | Electron + Vite | 保留 MYStudio 桌面壳 |
| 前端 | React + TypeScript | React + TypeScript | 自有 Web UI/服务端路由 | Nuxt 3 + Vue | React + TypeScript | 只用 React，不引入 Vue |
| 状态 | Zustand + 项目级存储 | Zustand + 项目级存储 | SQLite/服务端状态 | SQLite/Drizzle | 编辑器 store + project bridge | Zustand 为主，吸收 LTX store 分层原则 |
| 后端 | Electron main IPC | Electron main IPC | Express + Socket + DB | Hono + DB | Electron + Python FastAPI | 不引入独立常驻后端 |
| AI 调度 | 模型配置 + dry-run/V1 | Feature Router + batch | Agent + vendor 脚本 | Agent + provider adapter | 本地模型服务 | 先复用现有配置，再加 Toonflow 风格能力描述 |
| FFmpeg | main process 简易渲染 | 非核心 | 图片轮播/字幕 | 单镜合成/整集合并 | 专业导出管线 | 以 LTX 为导出核心，以 Huobao 为短剧合成策略 |
| 数据持久化 | 文件型项目存储 | 文件型项目存储 | SQLite | SQLite | 项目文件/状态桥 | 继续文件型项目存储，不迁移 DB |

最关键的架构判断：MYStudio 的复杂度应放在“类型 + store + Electron export 模块”中，而不是新增服务端。这样能减少部署、权限、跨进程状态同步和打包风险。

### 11.3 工作流对比

| 流程阶段 | MYStudio 当前 | moyin-creator | Toonflow-app | huobao-drama | LTX-Desktop | MYStudio 目标 |
|---|---|---|---|---|---|---|
| 小说导入 | `NovelChapter` + `parseNovelChapters` | 以剧本/项目为主 | 小说事件提取、事件状态 | episode content/script | 不处理小说 | 引入事件摘要和事件状态，用于改编上下文 |
| 编剧/改编 | `AgentWorkData` 手工保存 | 剧本解析和校准 | storySkeleton、adaptationStrategy、scriptDraft | script_rewriter | 不处理编剧 | 形成三层 Agent 工作区 |
| 角色 | 基础素材/角色相关 store | 角色圣经、一致性锚点 | 资产/角色 Skill | character + voiceStyle | 资产面板 | 增加角色实体、视觉锚点、音色绑定 |
| 场景 | scene store 已存在 | 场景多视角生成 | 资产/场景 Skill | scene + location/time | 素材/时间线 | 场景实体与分镜绑定 |
| 分镜 | `StoryboardItem` 简化字段 | 分镜/导演/S 级 | storyboardItem + videoDesc | 完整镜头字段 | clip/timeline | 采用 Huobao 字段，兼容 Toonflow `videoDesc` |
| 素材生成 | 媒体和素材保存 | 图片/视频批量生成 | ProductionAgent 资产生成 | image/video generation | import assets | 统一素材库 + 生成任务状态 |
| 配音 | 尚未成体系 | 部分音频引用 | 可声明 audioReference | TTS + voice assigner | audio clip | 引入角色音色、TTS 和音频素材 |
| 单镜合成 | track candidate | S 级生成视频 | slideshow video | video + TTS + subtitle | clip export | 先增强 `studio-render-track-candidate` |
| 成片导出 | concat 候选视频 | 简易时间线 | ffmpeg compose | merge episode | native export | 最终采用 LTX 多轨导出模型 |

### 11.4 数据模型详细对比

| 概念 | MYStudio 当前字段/模块 | Toonflow 对应 | Huobao 对应 | LTX 对应 | 目标落点 |
|---|---|---|---|---|---|
| 小说章节 | `NovelChapter.id/index/title/sourceText/eventSummary/eventState` | `o_novel` 章节和事件状态 | `episodes.content/scriptContent` | 无 | 保留 `NovelChapter`，强化 `eventSummary/eventState` |
| Agent 工作数据 | `AgentWorkData.key/data/episodeId` | memory + XML 工作区节点 | Mastra Agent 结果写 DB | 无 | 扩展版本、来源、状态和审核结果 |
| 角色 | 当前 studio 类型未独立建模 | asset/role 引用 | `characters` 表含 `voiceStyle` | asset | 新增 `StudioCharacter`，绑定视觉锚点和音色 |
| 场景 | `scene-store.ts` 另有场景模型 | asset/scene 引用 | `scenes` 表含 location/time/prompt | asset | 建立 studio workflow 内的 scene 引用或桥接 scene-store |
| 分镜 | `StoryboardItem.prompt/videoDesc/mediaRef` | `storyboardItem videoDesc/prompt/track/duration` | `storyboards` 完整镜头字段 | timeline clip 来源 | 扩展 `StoryboardItem` 为完整生产字段 |
| 制作 track | `ProductionTrack.trackKey/storyboardIds/prompt/duration/candidates` | track 分组 | episode storyboards 顺序 | timeline track | 保留 production track，再新增 timeline export clip |
| 视频候选 | `VideoCandidate.provider/filePath/state` | `o_video` state | `video_generations`/`composedVideoUrl` | take/asset | 增加来源、profile、错误、缩略图、时长 |
| 字幕 | `subtitleText` 仅在 plan 中 | videoDesc 台词抽取 | `subtitleUrl` SRT | `ExportSubtitle` drawtext | 新增结构化 `SubtitleStyle` 和 per-clip 字幕 |
| 音频 | `StoryboardMediaRef.kind="audio"` | audioReference | `ttsAudioUrl` | audio clip + PCM | 新增 TTS、BGM、SFX 三类引用 |
| 导出计划 | `TrackRenderPlan/EpisodeMergePlan` | ffmpeg compose route | compose/merge service | `ExportClip/FlatSegment` | 新增 `TimelineExportPlan` |

最重要的模型取舍：`ProductionTrack` 与未来多轨时间线不能混为一个概念。`ProductionTrack` 是生成/候选阶段的“制作分组”，多轨时间线是最终剪辑阶段的“编辑文档”。二者可以互相生成，但不要共用同一套状态字段。

### 11.5 Agent/Skill 体系对比

| 维度 | MYStudio 当前 | Toonflow-app | huobao-drama | moyin-creator | 目标方案 |
|---|---|---|---|---|---|
| Skill 形态 | `SkillContextPackage` 输出 markdown | `data/skills/*.md` 可被 Agent 读取 | `skills/*/SKILL.md` 规定工具步骤 | 提示词服务和 AI core | 建立项目内 Skill 库和版本化 SkillContext |
| 决策层 | 暂无明确 Agent 层 | decisionAgent 判断任务和派发子 Agent | Mastra Agent 按技能执行 | UI 触发特定 AI 功能 | 新增 `decision` 任务记录，不直接写业务数据 |
| 执行层 | 手工保存 `AgentWorkData` | storySkeleton/adaptation/script/director/storyboard 等执行 Agent | script_rewriter/extractor/storyboard_breaker/voice_assigner | script/scene/character calibration | 执行层产出结构化 JSON/Markdown 双格式 |
| 监督层 | 暂无 | supervisionAgent 审查和修订 | 主要靠 UI/状态 | 部分校准流程 | 监督层输出问题清单，不自动覆盖用户内容 |
| 记忆 | 当前 studio store 持久化工作数据 | Memory RAG + short summary | 数据库记录 | 项目存储 | 先用项目级工作数据，后续再引入检索 |
| 工具边界 | 无明确工具协议 | Agent tools 操作项目数据 | read/save/update tools | worker bridge | 每个工具只做一类读写，禁止 Agent 任意改文件 |

Agent/Skill 的落地顺序应是：

1. 先建立 Skill 文档管理和上下文包版本。
2. 再让执行层生成结构化草稿，由用户确认写入 store。
3. 最后引入决策层和监督层。

不要一开始就让 Agent 直接自动改完整项目状态。短剧生产链路很长，直接自动写入会放大错误。

### 11.6 FFmpeg 与导出能力对比

| 能力 | MYStudio 当前 `src/electron/main.ts` | Toonflow-app | huobao-drama | LTX-Desktop | 融合目标 |
|---|---|---|---|---|---|
| 图片转视频 | 支持 loop image + scale/pad + anullsrc | 支持 Ken Burns zoompan | 依赖生成视频后合成 | 支持 image clip loop | 先保留 scale/pad，后续加入可选 Ken Burns |
| 视频规格统一 | 1920x1080 scale/pad | 1920x1080 zoompan | 取输入视频并合成字幕/音频 | width/height/fps 参数化 | 输出尺寸、fps、codec 参数化 |
| 单镜字幕 | SRT + subtitles filter | 从 `videoDesc` 抽台词后烧录 | SRT + subtitles filter，检测 filter 支持 | drawtext per subtitle | 短期用 SRT，长期用 drawtext 统一样式 |
| TTS 音频 | 当前未集成 | 可引用 audioReference | 角色 voiceStyle -> TTS -> 合成 | audio clip 混音 | Phase 2 引入 TTS，Phase 3 进入多轨混音 |
| 整集拼接 | concat list + re-encode | o_video 记录后生成 | composed 全齐后 merge | filter graph + final combine | 保留 concat 兼容，新增 timeline export |
| 多轨覆盖 | 不支持 | 不支持专业 NLE 语义 | 不支持 | 高 trackIndex 覆盖低轨 | 采用 LTX flatten |
| 音频混音 | anullsrc 或简单 map | 不完整 | 单 TTS 音轨 | PCM 混音，含视频内音频 | 采用 LTX PCM 混音 |
| 导出取消 | 不支持 | 不明确 | 不支持 | activeExportProcess kill | 新增 `studio-export-cancel` |
| FFmpeg 查找 | 系统 `ffmpeg` | 系统 `ffmpeg` | 系统 `ffmpeg` | 内置环境优先 + 系统回退 | 先系统回退，打包阶段评估内置 |
| 可测试性 | 逻辑集中 main 文件 | route 内聚 | service 文件较清楚 | 纯函数拆分清楚 | 拆成 `src/electron/export/*` |

导出模块的融合优先级：

1. 先抽出 `ffmpeg-utils`，把可用性检测、spawn、日志、取消从 main 中移出。
2. 再抽出 concat/segment 渲染，保持当前 IPC 行为不变。
3. 再新增 LTX 风格的 `timeline.ts` 和 `video-filter.ts`，用纯函数测试覆盖。
4. 最后加入 `audio-mix.ts`，因为 PCM 混音内存和边界条件更多。

### 11.7 UI 与编辑体验对比

| UI 区域 | moyin/MYStudio 当前优势 | Toonflow 可借鉴 | Huobao 可借鉴 | LTX 可借鉴 | 目标形态 |
|---|---|---|---|---|---|
| 工作流导航 | 左侧板块清楚，适合非专业用户 | ScriptAgent/ProductionAgent 工作区 | episode 生产步骤清晰 | 专业编辑器布局 | 保留工作流导航，加一个“剪辑/导出”专业区 |
| 分镜编辑 | 现有导演/S 级基础 | 分镜表和分镜面板 | 一屏完成镜头字段、视频、合成 | clip properties panel | 分镜表字段完整，右侧显示素材和候选 |
| 角色声音 | 当前弱 | audioReference | voice library + 试听 | audio track | 建立角色音色面板和试听生成 |
| 批量状态 | Moyin 有进度组件 | Agent 消息流 | compose/video status | export progress/cancel | 统一任务队列和阶段状态 |
| 剪辑 | 简单时间线 | 非重点 | 成片导出页 | 专业 timeline/source/program monitor | 先做轻量多轨，避免一次性复制完整 NLE |

UI 不应一次性变成完整专业剪辑软件。对 MYStudio 用户来说，第一屏仍应是短剧生产流；专业时间线作为后段导出增强，不应压过剧本/分镜/素材主流程。

### 11.8 源能力到 MYStudio 文件的落地映射

| 源能力 | 源项目参考 | MYStudio 目标文件/区域 | 落地动作 | 验收方式 |
|---|---|---|---|---|
| 完整分镜字段 | `huobao-drama/skills/storyboard_breaker/SKILL.md`、`backend/src/db/schema.ts` | `src/types/studio.ts`、`src/stores/studio-store.ts` | 扩展 `StoryboardItem` 和增删改 action | 旧分镜兼容，新字段可持久化 |
| 角色音色 | `huobao-drama/skills/voice_assigner/SKILL.md`、`characters.voiceStyle` | `src/types/studio.ts`、工作流 UI | 新增角色音色字段和试听引用 | 角色能绑定 voiceId，分镜对白能找到声音 |
| TTS + 字幕单镜合成 | `huobao-drama/backend/src/services/ffmpeg-compose.ts` | `src/electron/main.ts` -> `src/electron/export/*` | 增加 audio input、字幕样式和无对白跳过规则 | 有对白/无对白分镜 smoke |
| 整集合并 | `huobao-drama/backend/src/services/ffmpeg-merge.ts` | `src/lib/studio/production.ts`、`src/electron/export/export-handler.ts` | 保留 `EpisodeMergePlan`，补状态和错误 | 只选 ready 候选进入合并 |
| 多轨 flatten | `LTX-Desktop/electron/export/timeline.ts` | `src/electron/export/timeline.ts` | 实现纯函数，按边界和 trackIndex 生成 segment | 单元测试覆盖重叠、gap、相邻合并 |
| 字幕 drawtext | `LTX-Desktop/electron/export/video-filter.ts` | `src/electron/export/video-filter.ts` | 生成 filter graph，支持 per-subtitle style | 字幕位置、颜色、背景 smoke |
| PCM 混音 | `LTX-Desktop/electron/export/audio-mix.ts` | `src/electron/export/audio-mix.ts` | 提取、变速、反转、音量、按 timelineStart 混合 | 双音轨叠加和静音测试 |
| 导出取消 | `LTX-Desktop/electron/export/ffmpeg-utils.ts` | `src/electron/export/ffmpeg-utils.ts`、preload | 保存 active process 并 kill | 取消后进程停止、临时文件清理 |
| 三层 Agent | `Toonflow-app/src/agents/*Agent/index.ts` | `src/lib/studio/context.ts`、studio store、未来 Agent UI | 增加 decision/execution/supervision 工作数据类型 | 每层输出可追踪，不自动覆盖 |
| Skill 文件化 | `Toonflow-app/data/skills`、`huobao-drama/skills` | `docs` 或应用内 Skill 目录 | 设计 Skill 管理 UI 和模板导入 | 用户能查看、复制、编辑、恢复默认 |
| 动态供应商 | `Toonflow-app/data/vendor/*.ts`、`src/utils/vendor.ts` | `src/stores/studio-config-store.ts` 或配置中心 | 先做能力描述，动态脚本置于高级禁用态 | 能力不足时前置阻断 |
| 批处理 | `moyin-creator/src/lib/ai/batch-processor.ts` | 现有 `src/lib/ai/batch-processor.ts` | 复用双预算分批、重试、部分成功 | 批次失败不影响成功项 |

### 11.9 能力优先级

| 优先级 | 能力 | 为什么先做/后做 | 不做会怎样 |
|---|---|---|---|
| P0 | 文档与类型对齐 | 后续所有 UI、Agent、FFmpeg 都依赖统一字段 | 每个模块各造字段，后续迁移困难 |
| P0 | 旧数据兼容 | 现有项目不能被新字段破坏 | 用户打开旧项目报错或数据丢失 |
| P1 | 分镜字段和角色/场景绑定 | 这是短剧生产质量的核心 | AI 生图/视频无法保持连续性 |
| P1 | TTS + 字幕单镜合成 | 可立即提升成片可用性 | 只有画面，没有声音/字幕，不像成片 |
| P1 | FFmpeg 模块拆分 | 当前 main 文件承担太多导出逻辑 | 后续多轨导出难测试、难回滚 |
| P2 | LTX 多轨导出 | 复杂但价值高，适合在单镜合成稳定后做 | 时间线只能拼接，无法专业混音和叠轨 |
| P2 | Agent/Skill 管理 | 需要产品交互配合，不能抢在模型稳定前 | 继续依赖人工复制提示词 |
| P3 | 动态 vendor 脚本 | 安全边界高，必须谨慎 | 不能像 Toonflow 一样快速接私有模型 |
| P3 | 内置 FFmpeg | 打包和许可证需评估 | 用户需要自行安装 FFmpeg |

### 11.10 风险对比与控制

| 风险 | 来源 | 具体表现 | 控制方式 |
|---|---|---|---|
| 架构膨胀 | 同时吸收四项目 | 引入 Web 后端、DB、Python 服务后打包复杂 | 明确只保留 Electron + Renderer + IPC |
| 字段膨胀 | Huobao 分镜字段多 | UI 变复杂、store 难维护 | 字段分组：镜头、提示词、绑定、音频、字幕、状态 |
| 旧项目迁移 | MYStudio 已有持久化项目 | 新字段默认值缺失导致 UI 崩 | store merge 时补默认值，类型字段可选 |
| FFmpeg 转义 | 字幕、路径、filter graph | 路径含空格、冒号、中文、单引号时失败 | 使用 filter script 文件，统一 escape 工具 |
| 音频内存 | PCM 混音 | 长视频多音轨占用大内存 | 第一版限制导出时长和音轨数，后续分块混音 |
| 动态脚本安全 | Toonflow vendor | 用户脚本访问本机文件或网络不可控 | 默认禁用执行，只做静态能力描述；执行前做沙箱 |
| 许可边界 | Huobao/LTX/Toonflow/Moyin | 直接复制代码可能触发许可不兼容 | 优先重写设计，复制前单独审查许可证 |
| Agent 误写 | 三层 Agent 自动化 | 错误覆盖用户剧本/分镜 | Agent 先输出草稿，用户确认后写入 |
| 导出进程残留 | FFmpeg 取消/失败 | 临时文件堆积、进程未停 | active process + finally cleanup + 状态回滚 |

### 11.11 目标版本分层

| 版本 | 目标 | 包含能力 | 不包含能力 |
|---|---|---|---|
| V1.1 生产模型增强 | 让分镜数据足够支撑短剧生产 | 完整分镜字段、角色/场景绑定、旧数据兼容、分镜表 UI | 多轨导出、动态 vendor |
| V1.2 单镜成片增强 | 让单个镜头接近可发布片段 | TTS、字幕样式、音频素材、单镜合成、候选片段状态 | 专业 timeline 混音 |
| V1.3 本地剪辑导出 | 让多个镜头组成可控成片 | LTX flatten、filter graph、PCM 混音、导出取消、媒体探测 | 本地 AI 视频模型推理 |
| V1.4 Agent/Skill 工作台 | 让长链路创作可编排、可审查 | Skill 管理、三层 Agent 记录、监督问题清单、供应商能力校验 | 默认执行任意动态脚本 |
| V1.5 高级供应商与分发 | 提升私有化与打包体验 | 动态 vendor 沙箱、能力导入导出、可选内置 FFmpeg | 无许可确认的第三方代码复制 |

### 11.12 推荐的第一批实施清单

第一批不要从 FFmpeg 或 Agent 开始，应先让数据模型稳住：

1. 扩展 `src/types/studio.ts` 的 `StoryboardItem`，新增镜头、提示词、绑定、音频、字幕字段，全部设为可选以保证旧数据兼容。
2. 扩展 `src/stores/studio-store.ts` 的 `addStoryboard` 默认值和 `updateStoryboard` 逻辑，确保新字段能持久化。
3. 给 `src/lib/studio/production.ts` 增加结构化字幕提取优先级：`subtitleText` -> `dialogue` -> `videoDesc`。
4. 在工作流 UI 中增加“分镜详情”字段组，不改变现有创建分镜和本地合成按钮。
5. 添加最小测试：旧分镜对象、新分镜对象、从章节创建分镜、结构化字幕提取。

第一批完成后，文档中的 Phase 2 才适合开始。否则 TTS、字幕、合成会继续依赖 `videoDesc` 字符串解析，后续成本会变高。

## 12. 各软件流程逐步对比

前面的章节已经按能力和模块做了对比，本章改用“用户从打开软件到导出成片”的流程视角，把五套软件的实际生产链路拆开。结论是：MYStudio 不应复制任何一个项目的完整路径，而应把 Moyin 的前段创作效率、Huobao 的短剧业务闭环、Toonflow 的 Agent/Skill 编排、LTX 的专业导出流程合成一条更清晰的桌面端生产线。

### 12.1 五套流程总览

| 软件 | 典型流程 | 流程本质 | 最强阶段 | 对 MYStudio 的启发 |
|---|---|---|---|---|
| MYStudio 当前 | 小说导入 -> Skill 上下文包 -> 剧本草稿 -> 分镜表 -> track 候选 -> FFmpeg 拼接 -> 配置中心 | 桌面端最小生产闭环 | 项目级文件存储、Electron 本地合成、Moyin 基底 | 保留主壳和 store，把字段、TTS、字幕、多轨导出补齐 |
| moyin-creator | 配置服务商 -> 导入/创作剧本 -> AI 场景/分镜/角色校准 -> 生成场景/角色 -> 导演/S 级 -> 图片/视频批量生成 | AI 多模态生成工作流 | 提示词校准、多 Key 调度、Seedance 多镜头分组 | 继续作为 MYStudio 前段创作和多模态生成主线 |
| Toonflow-app | 供应商配置 -> 新建项目/导入原著 -> 章节事件提取 -> ScriptAgent 改编 -> ProductionAgent 无限画布 -> 分镜图精调 -> 拼接导出 | Agent 驱动的小说影视化工作台 | 事件图谱、三层 Agent、Skill 文件化、可编程供应商 | 借鉴编排思想，不迁移 Nuxt/后端结构 |
| huobao-drama | 剧本生成/解析 -> 角色/场景提取 -> 分镜拆解 -> 音色分配 -> 角色/场景/分镜图片 -> 视频生成 -> TTS -> 单镜合成 -> 整集拼接 | 短剧业务对象驱动的自动化流水线 | 角色/场景/分镜/音色/TTS/字幕/整集状态 | 作为 MYStudio 短剧业务模型和单镜成片链路蓝本 |
| LTX-Desktop | 配置本地/API 模式 -> 生成或导入媒体 -> 视频编辑器时间线 -> gap fill/retake -> 多轨编辑 -> FFmpeg 原生导出 | 视频生成 + 专业剪辑导出工具 | 多轨时间线、媒体探测、导出取消、音频混音 | 只吸收导出层和时间线规则，不迁移 Python/FastAPI 后端 |

融合后的 MYStudio 应采用一条“前段像 Moyin、业务像 Huobao、编排像 Toonflow、导出像 LTX”的流程：

1. 用 Moyin/MYStudio 的配置中心和多 Key 机制管理模型。
2. 用 Toonflow 的事件图谱和 Skill 文件化增强长文本改编。
3. 用 Huobao 的角色、场景、分镜、音色、TTS、字幕模型补齐短剧对象。
4. 用 LTX 的 timeline flatten、PCM mix、export cancel 补齐后段导出。

### 12.2 输入与项目初始化流程对比

| 维度 | MYStudio 当前 | moyin-creator | Toonflow-app | huobao-drama | LTX-Desktop | 融合选择 |
|---|---|---|---|---|---|---|
| 用户第一步 | 打开工作流，导入小说或粘贴正文 | 先配 API，再进剧本板块 | 登录后配置供应商，新建项目并导入原著 | 部署/启动后进入短剧项目，准备脚本和配置 | 首次启动选择本地/API 模式，配置 API Key 或本地模型 | MYStudio 保留桌面端无登录默认入口，先做配置健康检查 |
| 输入对象 | `.txt/.md`、文本、素材路径 | 剧本正文或 AI 创作剧本 | 原著章节、项目、供应商 | 剧本、角色图、场景图、生成资源 | prompt、图片、视频、音频、编辑项目 | `ProjectSource` 统一记录小说、剧本、媒体三类输入 |
| 系统动作 | 生成项目状态和工作流数据 | 解析剧本并准备校准 | 抽章节事件，保存改编上下文 | 写入数据库，建立角色/场景/分镜记录 | 建立 app data、模型和项目目录 | 不引入独立 DB，全部落到项目文件和 Zustand store |
| 输出产物 | novel/script/storyboard/track | scenes/shots/characters/prompts | chapter events、script draft、canvas nodes | characters/scenes/storyboards/assets | media clips、timeline project | MYStudio 输出应分为 source、derived、generated、export 四层 |
| 主要短板 | 初始校验和资产目录规范不足 | 更偏 AI 生成，项目源数据边界较弱 | 依赖账号/后端概念，流程较重 | Web 全栈和数据库部署复杂 | 不解决小说/剧本改编 | 桌面端只保留本地目录、配置检查、项目元数据和导入向导 |

MYStudio 的初始化流程建议：

1. 创建项目时固定生成 `project.json`、`assets/`、`renders/`、`exports/`、`cache/` 的逻辑分区，是否真实建子目录由项目存储层统一处理。
2. 打开项目时先做三类探测：配置中心是否有可用模型绑定、本机 FFmpeg 是否可用、项目旧数据是否需要补默认字段。
3. 导入小说或剧本时保留原文快照，所有 AI 拆解都写成派生产物，避免覆盖用户源文本。
4. 媒体导入不直接进入分镜字段，应先成为 `AssetReference`，再由角色、场景、分镜引用。

### 12.3 文本结构化与改编流程对比

| 软件 | 用户动作 | 系统动作 | 产物 | 弱点 | MYStudio 融合方式 |
|---|---|---|---|---|---|
| MYStudio 当前 | 导入小说，生成 Skill 上下文包，保存剧本草稿 | 将正文、摘要、人工工作数据整理成上下文 | `SkillContextPackage`、`ScriptDraft` | 缺事件图谱和可审查的改编链路 | 保留上下文包，新增事件、人物、冲突、场景索引 |
| moyin-creator | 粘贴或 AI 创作剧本，再触发结构化分析 | 拆场景、分镜、角色、对白，并进入校准 | 场景表、分镜提示词、角色描述 | 对小说长文本改编的事件追踪较弱 | 复用剧本解析和校准思路，作为改编后剧本的标准化步骤 |
| Toonflow-app | 导入原著后执行章节事件提取，再进入 ScriptAgent | 从章节抽事件图谱，再生成故事骨架、改编策略和结构化剧本 | chapter events、story skeleton、adaptation strategy、script | 系统复杂度高，Agent 输出需要审查 | 借鉴“先事件、再改编、再剧本”的顺序 |
| huobao-drama | 提供小说/剧本，由 `script_rewriter` 改写 | 将长文本整理成短剧格式，再交给 extractor/storyboard breaker | 格式化剧本、角色/场景候选 | 更偏短剧自动化，原文证据链较少 | 借鉴短剧格式和章节拆集规则 |
| LTX-Desktop | 输入 prompt 或媒体，不处理长文本 | prompt enhancement 或 text encoding | 生成 prompt embedding/任务参数 | 不覆盖文本改编 | 不参与前段改编，只提供后段 prompt/媒体能力 |

目标 MYStudio 文本流程应拆成四步：

1. `Source Import`：保存原文、章节边界、导入时间、来源格式。
2. `Event Extraction`：生成章节事件、角色出场、地点、关键冲突、可视化动作。
3. `Adaptation Draft`：由 Skill/Agent 产出短剧集数、每集目标、剧情压缩策略。
4. `Script Standardization`：把改编稿转成可解析剧本，进入 Moyin 的场景、分镜、角色校准流程。

这样做的好处是，后续任何分镜、角色、字幕都能反查到“来自哪段原文/哪个事件/哪版改编策略”，不会只剩一段不可追踪的 AI 剧本。

### 12.4 角色、场景、音色与素材流程对比

| 软件 | 角色流程 | 场景流程 | 音色流程 | 素材管理 | MYStudio 取舍 |
|---|---|---|---|---|---|
| MYStudio 当前 | 可在工作流里保存角色相关工作数据，但字段较轻 | 可保存素材路径和分镜描述 | 尚未形成角色音色主线 | track 上挂素材路径 | 扩展角色/场景/音频引用，不改项目主壳 |
| moyin-creator | AI 角色校准，生成角色外观描述和参考图 | AI 场景校准，生成环境、光影、氛围提示词 | S 级可收集 @Audio 引用，但不是角色音色库 | 生成图/视频后分配到分镜 | 保留校准和批量生成，补充稳定 ID 和引用关系 |
| Toonflow-app | 角色可作为画布节点和 Agent 上下文 | 场景、素材、视频节点可自由组织 | 有 audioReference 思路 | 无限画布组织节点和回流 | 借鉴节点关系，不把 UI 改成完整无限画布 |
| huobao-drama | 角色提取、去重、生成角色图、上传角色图 | 场景提取、场景图生成、场景绑定分镜 | `voice_assigner` 分配音色，支持试听 | 本地资源库和任务状态 | 直接作为短剧业务字段蓝本 |
| LTX-Desktop | 以媒体 clip 和 prompt 控制一致性 | 场景由视频/图片素材体现 | 支持音频输入和音轨处理 | editor project 管理 clips | 只吸收媒体 clip 元数据和音频轨道概念 |

MYStudio 目标流程：

1. `CharacterProfile` 从剧本/事件中抽取，包含姓名、别名、外观锚点、服饰、性格、voiceId、referenceAssetIds。
2. `SceneProfile` 从剧本场景中抽取，包含地点、时代、氛围、光线、可复用背景图、sceneAssetIds。
3. `AssetReference` 统一管理图片、视频、音频、字幕文件，记录来源、用途、绑定对象和生成任务 ID。
4. 角色音色不直接写死在分镜上，分镜只保存对白角色和可覆盖的 voiceId；默认从角色继承。
5. 场景图、角色图、首帧、尾帧、视频候选都走同一套资产引用，避免路径字符串散落在不同字段。

### 12.5 分镜生成、校准与审查流程对比

| 软件 | 分镜来源 | 校准方式 | 人工干预点 | 状态流转 | MYStudio 融合方式 |
|---|---|---|---|---|---|
| MYStudio 当前 | 用户维护分镜表，含 track、时长、素材、台词 | 依赖用户手工和部分上下文 | 分镜字段、素材路径、候选选择 | track -> candidate -> selected | 增加镜头语言字段和审查状态，保留手动可控 |
| moyin-creator | 剧本结构化后加载到导演/S 级 | 场景校准、分镜校准、角色校准 | 首帧、尾帧、视频提示词、时长、风格 | prompt -> image -> video | 作为分镜提示词质量增强主流程 |
| Toonflow-app | ScriptAgent 输出后由 ProductionAgent 组织 | Agent 在画布中生成、修订、回流 | 节点精调、分镜图修改、画布编排 | script node -> storyboard node -> asset/video node | 借鉴“分镜是可追踪节点”，但 UI 先用表格和详情面板 |
| huobao-drama | `storyboard_breaker` 把剧本拆成分镜序列 | 场景描述、镜头设计、帧类型、宫格图提示词 | 分镜图片、首尾帧、视频生成、合成状态 | pending -> image -> video -> composed -> merged | 采用其短剧分镜字段和单镜状态链 |
| LTX-Desktop | 用户在编辑器中放置 clip | clip 属性、retake、gap fill | timeline 位置、轨道、裁剪、覆盖 | clip -> timeline segment -> export | 只用于成片时间线，不负责前段分镜拆解 |

MYStudio 分镜流程应从“简单表格”升级为“表格 + 详情 + 状态”的结构：

1. 分镜创建：由剧本解析、Agent 改编或用户手动创建，必须有稳定 `storyboardId`。
2. 分镜校准：写入景别、镜头运动、构图、主体动作、情绪、对白、字幕文本、角色/场景绑定。
3. 分镜审查：监督层或规则层输出问题清单，例如角色不一致、场景缺失、对白过长、时长不足。
4. 分镜生成：按分镜生成首帧、尾帧、视频候选、TTS、字幕。
5. 分镜锁定：用户选择候选并锁定后，才进入整集拼接或多轨导出。

### 12.6 多模态生成流程对比

| 软件 | 图片生成 | 视频生成 | 多模态引用 | 批处理 | MYStudio 融合方式 |
|---|---|---|---|---|---|
| MYStudio 当前 | V1 主要保存配置和 dry-run，部分能力来自 Moyin 基底 | 本地 FFmpeg 可把素材变候选，不直接跑模型 | track 上可挂素材路径 | 还需要统一任务队列 | 保留 dry-run 保护，按模型绑定逐步开启真实执行 |
| moyin-creator | 单镜生成或合并生成，结果自动分配分镜 | 图片完成后批量图生视频 | S 级自动收集 @Image/@Video/@Audio | 多 Key 轮询和分批 | 作为 MYStudio AI 生成主流程 |
| Toonflow-app | 通过供应商脚本接入多模型 | ProductionAgent 产出视频节点 | Agent 根据上下文调用资产 | Agent 任务编排 | 借鉴供应商能力描述和任务编排 |
| huobao-drama | 角色图、场景图、宫格图、分镜图 | 图生视频/文生视频任务 | 分镜绑定角色/场景/帧类型 | 任务进度追踪 | 借鉴任务状态和分镜素材分配 |
| LTX-Desktop | text/image/audio/video-to-video | 本地或 API 生成，支持 retake | 以媒体 clip 和 prompt 组合 | 后端任务管理 | 不迁移后端，只借鉴生成结果进入编辑器的方式 |

MYStudio 的生成流程需要统一为 `GenerationJob`：

1. `job.kind` 区分 `image`、`video`、`tts`、`compose`、`export`、`probe`。
2. `job.inputRefs` 引用角色图、场景图、首帧、尾帧、音频、上一版视频。
3. `job.modelBindingId` 使用现有配置中心，不在业务对象里写死供应商。
4. `job.outputAssetIds` 产出统一资产，再回填到角色、场景、分镜或候选片段。
5. `job.status` 记录 queued/running/succeeded/failed/canceled，给批处理、重试和 UI 进度统一使用。

### 12.7 TTS、字幕与单镜合成流程对比

| 软件 | TTS | 字幕 | 单镜合成 | 对白来源 | MYStudio 融合方式 |
|---|---|---|---|---|---|
| MYStudio 当前 | 未形成完整链路 | 当前 FFmpeg 可处理 SRT/subtitles filter | 可把图片或视频生成候选片段 | `dialogue` 或 `videoDesc` | 新增结构化字幕和音频输入，保留旧字段兼容 |
| moyin-creator | S 级支持 @Audio 引用 | 更偏提示词和唇形同步约束 | 主要生成视频，不是 FFmpeg 合成主线 | 剧本对白、提示词融合 | 把对白用于 TTS 和视频提示词双通道 |
| Toonflow-app | 有 audioReference 概念 | 可在出片阶段引用台词 | 更偏 Agent 生产节点 | Agent 上下文 | 借鉴音频作为资产节点的思路 |
| huobao-drama | 角色 voiceStyle -> TTS 生成 | TTS 后生成字幕并烧录 | FFmpeg 合成视频 + 音频 + 字幕 | 分镜对白和角色 | 作为 Phase 2 直接蓝本 |
| LTX-Desktop | 音频输入和音频轨处理强 | drawtext/filter graph 可样式化字幕 | 时间线导出阶段完成叠加 | timeline subtitle/clip | Phase 3 用 drawtext 统一样式和多轨导出 |

单镜合成在 MYStudio 中应分两级：

1. `render track candidate`：兼容当前 `studio-render-track-candidate`，把单个图片/视频素材转成一个候选片段，可选叠加字幕和 TTS。
2. `compose storyboard shot`：面向短剧业务，输入分镜、角色音色、字幕样式、候选视频，输出可审核的单镜成片。

结构化优先级应明确为：`subtitleText` 高于 `dialogue`，`dialogue` 高于从 `videoDesc` 中猜测台词。无对白镜头不应生成空字幕；无 TTS 时应保留原视频声音或填充静音，具体由导出计划决定。

### 12.8 剪辑、拼接与导出流程对比

| 软件 | 剪辑模型 | 拼接策略 | 多轨能力 | 取消/探测 | MYStudio 融合方式 |
|---|---|---|---|---|---|
| MYStudio 当前 | 分镜 track 和候选片段 | 选择候选后 concat 成片 | 暂无 | 当前较弱 | 保留简单拼接作为快速成片路径 |
| moyin-creator | 以分镜生成结果为主 | 批量生成后进入成片流程 | 不是专业剪辑重点 | 主要由生成任务控制 | 继续提供“分镜顺序导出”入口 |
| Toonflow-app | 工作台节点回流后出片 | 分镜/视频节点拼接 | 非专业 NLE | 依赖出片流程 | 借鉴素材回流和节点可追踪 |
| huobao-drama | 单镜 composed 后整集合并 | 全部分镜完成后 merge | 不做复杂叠轨 | 任务状态可追踪 | 作为短剧整集拼接的业务规则 |
| LTX-Desktop | 视频编辑器 timeline | flatten 后生成 filter graph | 高轨覆盖低轨、音频混音 | ffmpeg 路径探测、active process cancel | 作为专业导出模块蓝本 |

MYStudio 导出应提供两条路径：

1. 快速导出：按分镜顺序使用已选择候选片段 concat，适合短剧粗剪和批量验收。
2. 专业导出：把分镜候选、BGM、旁白、字幕、贴片都转成 timeline clips，使用 LTX 风格 flatten 和 FFmpeg filter graph 输出。

快速导出不应被专业导出替代。短剧生产大量镜头需要快速查看整集节奏，复杂 timeline 只应在精修阶段启用。

### 12.9 失败恢复、批处理与重试流程对比

| 软件 | 批处理方式 | 失败记录 | 重试粒度 | 取消能力 | MYStudio 融合方式 |
|---|---|---|---|---|---|
| MYStudio 当前 | 基础工作流和本地渲染 | 候选片段状态有限 | track/candidate | 导出取消待增强 | 建立统一任务队列和可取消导出 |
| moyin-creator | 多 Key 轮询、合并生成、批量视频 | 批次内部分成功 | 图片/视频生成项 | 主要依赖任务控制 | 复用多 Key 调度和部分成功策略 |
| Toonflow-app | Agent 分层执行 | 监督层反馈和记忆 | Agent step | 取决于任务编排 | 借鉴执行记录和审查反馈 |
| huobao-drama | 数据库任务状态 | 每个角色/场景/分镜/合成状态 | 单镜、单资源、整集 | 不突出 | 借鉴细粒度状态字段 |
| LTX-Desktop | 本地/后端任务 + Electron 导出 | 日志、进程状态、导出错误 | clip/export | 支持 active export cancel | 采用导出取消、日志和临时文件清理 |

MYStudio 的失败恢复原则：

1. AI 生成失败不影响已成功素材，失败项可单独重试。
2. TTS 失败不阻塞视频候选存在，但会阻塞“带对白单镜合成”的完成状态。
3. 单镜合成失败不影响其他镜头，整集拼接只使用 ready 或用户强制选择的候选。
4. timeline 导出失败必须保留 FFmpeg 命令摘要、输入资产列表和最后日志，便于复现。
5. 取消导出后状态应回到 canceled，不把半成品标记为 failed 或 ready。

### 12.10 UI 操作流程对比

| 阶段 | MYStudio 当前 UI | Moyin UI | Toonflow UI | Huobao UI | LTX UI | MYStudio 目标 UI |
|---|---|---|---|---|---|---|
| 前期配置 | 配置页保存中转站、模型、绑定 | 设置、API 配置、服务映射、图床 | 设置中心供应商和 Skill | YAML/后台配置 + Web UI | Settings、本地/API 模式 | 保留配置页，增加健康检查和能力标签 |
| 文本创作 | 工作流小说/Skill/剧本 | 剧本板块 | ScriptAgent | 剧本改写 Agent | prompt 输入 | 小说、事件、改编、剧本四个视图 |
| 分镜生产 | 分镜表 | 导演/S 级左侧分镜 | ProductionAgent 画布 | 分镜管理页 | editor clips | 分镜表 + 详情面板 + 候选区 |
| 资产管理 | 素材路径挂在 track | 图片/视频生成结果 | 画布节点 | 素材库 | media bin | 统一素材库，支持角色/场景/分镜反查 |
| 成片导出 | 剪辑页 FFmpeg | 生成视频后成片 | 拼接导出 | 单镜合成和整集合并 | 时间线导出 | 快速拼接 + 专业时间线双入口 |

UI 融合原则：

1. 第一屏仍是 MYStudio 的“工作流”，不改成 LTX 的专业剪辑器，也不改成 Toonflow 的完整无限画布。
2. 剧本、角色、场景、分镜、剪辑必须能按顺序走完，也能单独进入某个板块修补。
3. 所有 AI 输出先进入“候选/草稿/问题清单”，用户确认后才写入正式字段。
4. 分镜详情面板应把 Huobao 的短剧字段呈现出来，但默认折叠高级项，避免干扰快速生产。
5. 专业时间线只在“剪辑/导出”阶段出现，不反向污染剧本和分镜页面。

### 12.11 数据流交接表

| 流程阶段 | 输入 | 系统处理 | 输出 | 下游使用 |
|---|---|---|---|---|
| 配置健康检查 | `VendorConfig`、`ModelDefinition`、`ModelBinding`、FFmpeg 路径 | 检查模型能力、Key、FFmpeg 可执行性 | 配置状态、能力标签、阻断原因 | 生成任务、导出任务 |
| 原文导入 | 小说/剧本/媒体文件 | 保存源快照、识别章节或场景 | `ProjectSource`、章节索引 | 事件提取、剧本解析 |
| 事件提取 | 原文和章节索引 | 提取事件、角色、地点、冲突、动作 | `NovelEvent`、事件图谱 | 改编策略、剧本生成 |
| 改编策略 | 事件图谱、目标集数、风格 | 生成故事骨架、集纲、压缩策略 | `AdaptationPlan` | 剧本草稿 |
| 剧本标准化 | 改编稿或导入剧本 | 解析场景、对白、动作、角色 | `ScriptDraft`、scene/shot candidates | 分镜生成、角色/场景提取 |
| 角色场景提取 | 剧本和事件 | 去重、补描述、绑定源证据 | `CharacterProfile`、`SceneProfile` | 生图、分镜绑定、TTS |
| 分镜拆解 | 剧本场景、角色、场景 | 生成镜头语言、时长、对白、提示词 | `StoryboardItem[]` | 图片/视频/TTS/字幕 |
| 多模态生成 | 分镜、资产、模型绑定 | 生成图、视频、音频候选 | `AssetReference`、`ProductionTrack` | 单镜合成、人工选择 |
| 单镜合成 | 视频候选、TTS、字幕样式 | FFmpeg 合成音频和字幕 | composed candidate | 快速拼接、时间线 |
| 整集导出 | 已选单镜、BGM、字幕、导出参数 | concat 或 timeline filter graph | export file、export log | 发布、回看、返修 |

### 12.12 融合后的推荐端到端流程

融合后的 MYStudio 推荐采用以下端到端流程：

1. `项目创建`：用户选择短剧、漫剧或视频剪辑项目模板，系统创建项目元数据并检查配置。
2. `能力检查`：系统检查文本、图片、视频、TTS、图床、FFmpeg 的绑定和可用性。
3. `原文导入`：用户导入小说、剧本或直接创建空白剧本，系统保留源文件快照。
4. `事件抽取`：借鉴 Toonflow，先抽章节事件、人物、地点和冲突，形成可追踪上下文。
5. `改编计划`：Agent/Skill 生成故事骨架、集数拆分、每集看点和压缩策略。
6. `剧本标准化`：借鉴 Moyin 和 Huobao，把改编稿转成标准剧本结构。
7. `角色场景库`：抽取角色、场景，生成或导入参考图，并为角色分配音色。
8. `分镜拆解`：生成完整 `StoryboardItem`，包含镜头语言、角色、场景、对白、字幕、音频意图。
9. `AI 校准`：执行场景校准、分镜校准、角色校准，生成更稳定的首帧、尾帧和视频提示词。
10. `素材生成`：批量生成角色图、场景图、首帧、尾帧、分镜视频，所有结果进入候选资产。
11. `TTS 和字幕`：按角色音色生成对白音频，按字幕样式生成结构化字幕。
12. `单镜合成`：借鉴 Huobao，用 FFmpeg 合成单镜视频、TTS、字幕，产出 composed candidate。
13. `镜头选择`：用户在分镜候选区选择最佳片段，必要时重生、替换、锁定。
14. `快速成片`：按分镜顺序 concat 已选候选，得到整集粗剪。
15. `专业导出`：需要精修时进入 LTX 风格时间线，加入 BGM、旁白、字幕样式、多轨覆盖和混音。
16. `质量回看`：监督层检查缺镜头、缺音频、字幕越界、时长异常、导出日志错误。
17. `发布导出`：输出最终视频、工程摘要、素材清单和可复现导出参数。

这条流程允许新手只走“导入 -> 分镜 -> 生成 -> 快速成片”，也允许高级用户进入“事件图谱 -> Agent 改编 -> 多轨导出”的完整链路。

### 12.13 各项目流程取舍矩阵

| 流程能力 | 直接保留 | 选择性迁移 | 不迁移 |
|---|---|---|---|
| MYStudio/Moyin 的 Electron + React + Zustand 主壳 | 保留 | 无 | 无 |
| MYStudio 当前本地 FFmpeg 候选渲染 | 保留兼容 | 拆到 `src/electron/export/*` | 不保留 main 文件继续膨胀 |
| Moyin 的 API 配置、服务映射、多 Key 调度 | 保留 | 增加能力标签和健康检查 | 不重写为后端配置中心 |
| Moyin 的 AI 校准、导演/S 级流程 | 保留为前段主线 | 和新 `StoryboardItem` 字段对齐 | 不让提示词散落成无结构字符串 |
| Toonflow 的章节事件图谱 | 不直接复制代码 | 迁移流程和数据设计 | 不迁移登录/后端/完整画布架构 |
| Toonflow 的三层 Agent | 不直接自动执行 | 先记录 decision/execution/supervision 输出 | 不允许 Agent 自动覆盖正式剧本和分镜 |
| Toonflow 的动态 vendor 脚本 | 不默认开启执行 | 先做能力描述和高级模式设计 | 不默认运行用户脚本 |
| Huobao 的角色/场景/分镜/音色模型 | 作为业务字段蓝本 | 改写为 MYStudio 类型和 store action | 不搬 Hono/Drizzle/SQLite 后端 |
| Huobao 的 TTS + 字幕 + 单镜合成 | 作为 Phase 2 主线 | 改写到 Electron export 子模块 | 不依赖服务端路径和数据库状态 |
| LTX 的 timeline flatten/export cancel/probe | 作为 Phase 3 主线 | 改写为纯函数和 IPC | 不迁移 Python/FastAPI/GPU 模型后端 |
| LTX 的专业视频编辑器 UI | 不直接复制 | 借鉴剪辑页布局和 clip 属性面板 | 不让 MYStudio 变成纯剪辑软件 |

### 12.14 流程落地的先后依赖

| 先做 | 后做 | 原因 |
|---|---|---|
| 统一 `StoryboardItem` 字段 | TTS/字幕/单镜合成 | 没有结构化对白、角色、字幕样式，合成只能继续猜字符串 |
| 统一 `AssetReference` | 多模态生成和时间线导出 | 图片、视频、音频必须先有稳定引用，FFmpeg 才能可靠取输入 |
| 统一任务状态 | 批量生成和失败重试 | 批处理需要知道每个分镜、素材、导出任务的状态 |
| 保留快速 concat | 引入专业 timeline | 快速成片是短剧生产的高频路径，专业 timeline 是精修路径 |
| 配置健康检查 | 真正执行模型调用 | 先阻断缺 Key、缺模型、缺 FFmpeg，避免用户跑到中途才失败 |
| Agent 输出草稿 | Agent 自动编排 | 先建立审查和确认机制，再提高自动化程度 |

最关键的依赖是数据模型。只要角色、场景、分镜、资产、音频、字幕和候选片段能在 MYStudio store 中稳定表达，四个源项目的精华能力才能逐步接进来；如果直接先搬 FFmpeg 或 Agent，后续会被字段不一致拖住。

## 13. 可融合流程与软件特殊流程边界

本章把所有流程按融合价值重新分类。分类标准不是“哪个项目更好”，而是看它能否自然进入 MYStudio 当前 Electron/React/Zustand/本地 FFmpeg 架构，能否服务“小说/剧本 -> 分镜 -> 多模态生成 -> 单镜合成 -> 整集导出”的主线。

### 13.1 分类原则

| 分类 | 定义 | 处理方式 | 例子 |
|---|---|---|---|
| 直接融合流程 | 和 MYStudio 现有主线一致，改动数据字段或 IPC 后即可接入 | 进入 Phase 1-3 优先实现 | 分镜字段扩展、TTS 字幕单镜合成、快速拼接 |
| 条件融合流程 | 价值高，但依赖安全、UI、模型能力或数据模型成熟 | 先文档化和类型预留，后续灰度实现 | 三层 Agent、动态 vendor、专业 timeline |
| 特色保留流程 | 是某个软件的独特优势，但不应成为 MYStudio 默认路径 | 作为高级模式、参考设计或可选视图 | Toonflow 无限画布、LTX retake/gap fill |
| 暂不迁移流程 | 强绑定源项目架构、部署方式、商业模式或许可证边界 | 不进入 MYStudio 当前融合计划 | Huobao Web 后端数据库整套迁移、LTX Python GPU 后端 |

判断一个流程是否能融合，应看四个问题：

1. 是否能用 MYStudio 的项目文件和 store 表达，而不是必须引入独立数据库。
2. 是否能通过 Electron IPC 或 renderer 内部状态完成，而不是必须新增常驻 Web 后端。
3. 是否能和现有 `VendorConfig`、`ModelDefinition`、`ModelBinding` 对齐。
4. 是否能在用户确认前保持草稿/候选状态，而不是自动覆盖正式内容。

### 13.2 可以融合进 MYStudio 主线的公共流程

| 可融合流程 | 来源软件 | 融合级别 | 进入 MYStudio 的位置 | 需要改造点 | 优先级 |
|---|---|---|---|---|---|
| API 服务商、模型能力、任务绑定配置 | MYStudio/Moyin | 直接融合 | 配置中心 | 增加能力标签、健康检查、缺能力阻断 | P0 |
| 多 Key 轮询和批量生成 | Moyin | 直接融合 | AI 任务队列 | 和 `GenerationJob` 状态统一 | P1 |
| 剧本解析为场景、角色、对白、分镜 | Moyin/Huobao | 直接融合 | 剧本/分镜模块 | 输出结构化字段，不只生成提示词 | P0 |
| 场景校准、分镜校准、角色校准 | Moyin | 直接融合 | 分镜详情和校准面板 | 校准结果写入可追踪版本 | P1 |
| 角色、场景、分镜业务模型 | Huobao | 直接融合 | `src/types/studio.ts`、store | 改为可选字段，兼容旧项目 | P0 |
| 角色音色、TTS 试听、对白音频 | Huobao | 直接融合 | 角色面板、分镜音频区 | 增加 voiceId、audioAssetId、试听任务 | P1 |
| 字幕文本、字幕样式、字幕烧录 | Huobao/LTX | 直接融合 | 单镜合成和导出模块 | 短期 SRT，长期 drawtext/filter graph | P1-P2 |
| FFmpeg 单镜合成 | MYStudio/Huobao | 直接融合 | `src/electron/export/*` | 支持视频、TTS、字幕、静音策略 | P1 |
| 已选候选片段快速拼接 | MYStudio/Huobao | 直接融合 | 剪辑页 | 保留 concat 快速路径 | P1 |
| FFmpeg 路径探测、日志、取消 | LTX | 直接融合 | Electron export IPC | 新增 `studio-export-cancel`、`studio-probe-media` | P2 |
| 多轨 flatten 和音频混音 | LTX | 条件融合 | 专业导出页 | 先做纯函数和 smoke，再接 UI | P2 |
| Skill 文件化 | Toonflow/Huobao | 条件融合 | Skill 管理和 Agent 上下文 | 先内置模板，后开放编辑 | P2-P3 |
| 章节事件图谱 | Toonflow | 条件融合 | 小说/改编模块 | 先做章节事件和证据链，不做完整记忆系统 | P2 |
| Agent 输出草稿和监督问题清单 | Toonflow | 条件融合 | Agent 工作台 | 先只写草稿/问题，不自动覆盖 | P3 |

这些流程的共同点是：它们都能被压缩进 MYStudio 的单机项目模型里，不要求用户理解另一套部署系统。实现时应优先改“数据结构和状态流”，再接模型和 UI。

### 13.3 只适合条件融合的高级流程

| 高级流程 | 来源软件 | 价值 | 不适合直接融合的原因 | 推荐处理 |
|---|---|---|---|---|
| Toonflow 三层 Agent 自动编排 | Toonflow | 让长链路任务可拆解、可审查、可迭代 | 自动化越高，误写剧本/分镜的风险越大 | 先记录 decision/execution/supervision 三类输出，用户确认后写入 |
| Toonflow 可编程供应商脚本 | Toonflow | 私有模型和非标准 API 接入很灵活 | 动态脚本有本地文件、网络、安全沙箱风险 | 默认只做能力描述；脚本执行放高级模式并隔离 |
| Toonflow 持久化记忆/RAG | Toonflow | 长篇改编能保持上下文连续 | 引入向量索引和记忆策略后复杂度上升 | 先做项目级事件图谱，再评估检索 |
| Toonflow 无限画布生产工作台 | Toonflow | 节点组织自由，适合探索式创作 | 会改变 MYStudio 主 UI 心智，开发量大 | 借鉴节点关系，默认仍用表格和详情面板 |
| Huobao 宫格图生成、切分、分配 | Huobao | 批量分镜图效率高 | 依赖具体绘图模型能力和图片切分规范 | 作为“批量分镜图”可选工具，不作为默认 |
| Huobao 全自动一键短剧流水线 | Huobao | 速度快，适合批量生产 | 自动链路容易放大错误，用户难以中途修正 | 拆成可暂停的阶段任务 |
| LTX gap fill | LTX | 时间线空白处自动补镜头 | 更偏专业视频编辑，不是短剧基础生产必要项 | 专业 timeline 稳定后再做 |
| LTX retake/video edit generation | LTX | 对已有视频局部重生成有价值 | 依赖模型后端和编辑语义 | 先作为候选重生成概念，不迁移后端 |
| LTX 本地 GPU 模型管理 | LTX | 可离线生成视频 | 需要 Python、模型下载、GPU、许可证确认 | 不进入当前 MYStudio 融合主线 |

条件融合流程的共同策略是：先保留“概念”和“数据接口”，不急着搬实现。等基础短剧链路跑通后，再按用户价值逐项打开。

### 13.4 各软件的特殊流程

#### MYStudio 当前特殊流程

| 特殊流程 | 是否融合 | 原因 | 目标处理 |
|---|---|---|---|
| V1 dry-run 模型执行边界 | 保留 | 当前能避免模型调用未成熟时造成错误成本 | 作为开发/测试模式保留 |
| 工作流左侧入口：小说、Skill、剧本、分镜、剪辑、配置 | 保留 | 已符合桌面短剧生产的低门槛路径 | 后续只扩展，不推翻 |
| `studio-render-track-candidate` 单候选渲染 | 保留兼容 | 已有 IPC 和用户路径可能依赖 | 迁到 export 子模块，但接口兼容 |
| 文件型项目存储 | 保留 | 是 MYStudio 和 Moyin 基底优势 | 不改成 Web 后端数据库 |

MYStudio 的特殊流程是“轻量桌面闭环”。它不是功能最全，但适合作为融合底座，因此应保留入口和存储方式。

#### moyin-creator 特殊流程

| 特殊流程 | 是否融合 | 原因 | 目标处理 |
|---|---|---|---|
| 剧本 -> AI 场景校准 -> API 分镜校准 -> AI 角色校准 | 融合 | 这是提升生成质量的关键链路 | 变成 MYStudio 分镜校准主线 |
| 导演板块逐镜头生成 | 融合 | 适合精细控制 | 保留为“逐镜生成”模式 |
| S 级 Seedance 2.0 多镜头分组 | 条件融合 | 依赖具体视频模型能力 | 作为模型能力支持时的高级生成模式 |
| @Image/@Video/@Audio 多模态引用 | 融合 | 和目标 AssetReference 一致 | 统一成结构化引用，不只写在 prompt |
| 图床配置流程 | 条件融合 | 只有部分模型需要公网素材 URL | 作为 provider 能力要求，不成为全局必填 |

Moyin 的特殊流程本质是“提示词和多模态生成效率”。它应该成为 MYStudio 前段生成能力的核心，但要把 prompt 内隐引用升级成结构化资产引用。

#### Toonflow-app 特殊流程

| 特殊流程 | 是否融合 | 原因 | 目标处理 |
|---|---|---|---|
| 章节事件提取后再改编 | 融合 | 长篇小说改编必须先有事件图谱 | 新增事件/证据链流程 |
| ScriptAgent 生成故事骨架、改编策略、结构化剧本 | 条件融合 | 价值高，但需要审查机制 | 先输出草稿和版本，不自动覆盖 |
| ProductionAgent 无限画布组织分镜、素材、视频节点 | 特色保留 | 画布强但会重塑 UI | 借鉴节点关系和回流机制 |
| 三层 Agent：决策、执行、监督 | 条件融合 | 能提升自动化质量 | 先做记录和问题清单 |
| 持久化 Agent 记忆 | 条件融合 | 对长项目有价值 | 先用项目级上下文，后续再做 RAG |
| 可编程供应商 TypeScript | 条件融合 | 接私有模型很强 | 默认禁用执行，仅保留能力描述 |
| 登录/账号默认入口 | 不迁移 | MYStudio 是本地优先桌面工具 | 不引入登录作为默认前置 |

Toonflow 的特殊流程适合解决“长文本改编”和“Agent 编排”，不适合直接接管 MYStudio 的 UI 和运行方式。

#### huobao-drama 特殊流程

| 特殊流程 | 是否融合 | 原因 | 目标处理 |
|---|---|---|---|
| `script_rewriter` 小说改短剧 | 融合 | 和 MYStudio 短剧目标一致 | 作为改编 Skill 模板 |
| `extractor` 提取角色和场景 | 融合 | 是短剧生产的基础对象 | 写入角色/场景库 |
| `storyboard_breaker` 分镜拆解 | 融合 | 分镜字段完整 | 改成 MYStudio `StoryboardItem` |
| `voice_assigner` 音色分配 | 融合 | 补齐 MYStudio 当前弱项 | 角色 voiceId + 试听 |
| grid prompt 和宫格图切分 | 条件融合 | 可提升批量图效率，但不是必需 | 放入批量生图高级工具 |
| TTS + 字幕 + 单镜 FFmpeg 合成 | 融合 | 是短剧从片段到可看成片的关键 | Phase 2 主线 |
| 整集拼接导出 | 融合 | 和 MYStudio 当前剪辑目标一致 | 保留快速 concat |
| Nuxt/Hono/Drizzle/SQLite 全栈结构 | 不迁移 | 和 MYStudio 本地桌面架构冲突 | 只迁移业务模型和流程思想 |

Huobao 的特殊流程最适合作为“短剧业务闭环”来源。能融合的是业务对象和成片链路，不是它的 Web 全栈架构。

#### LTX-Desktop 特殊流程

| 特殊流程 | 是否融合 | 原因 | 目标处理 |
|---|---|---|---|
| Text/Image/Audio/Video-to-video 生成入口 | 条件融合 | 依赖 LTX 模型或 API | 抽象成通用 video generation job |
| Video Editor Interface | 特色保留 | 专业剪辑 UI 价值高但成本大 | 借鉴剪辑页布局，不替代工作流 |
| timeline gap fill | 特色保留 | 适合专业编辑，不是短剧基础必需 | 专业 timeline 后续增强 |
| retake/video edit generation | 条件融合 | 需要视频编辑模型支持 | 作为重生成候选，不迁移后端 |
| timeline flatten 规则 | 融合 | 多轨导出的核心算法 | Phase 3 引入纯函数 |
| drawtext 字幕和 filter graph | 融合 | 比 SRT 更适合样式化导出 | 字幕样式稳定后引入 |
| PCM 音频混音 | 融合 | 多轨 BGM/对白/旁白必需 | Phase 3 引入并限制时长 |
| export cancel、probe、ffmpeg path | 融合 | 桌面导出体验必需 | 加 Electron IPC |
| Python/FastAPI/GPU 模型后端 | 不迁移 | 打包、依赖、硬件门槛过高 | 不进入当前融合计划 |

LTX 的特殊流程是“生成模型桌面端 + 专业剪辑器”。MYStudio 只需要它的导出工程能力，不需要复制模型部署体系。

### 13.5 推荐融合后的流程拼装

最终 MYStudio 不应把五套流程并排放给用户选择，而应拼成一条主流程和三条可选支路。

主流程：

1. `配置检查`：沿用 MYStudio/Moyin。
2. `原文/剧本导入`：沿用 MYStudio，增强 Toonflow 事件抽取。
3. `改编与剧本标准化`：融合 Toonflow ScriptAgent 思路、Huobao script_rewriter、Moyin 剧本解析。
4. `角色/场景/分镜结构化`：以 Huobao 业务模型为主，以 Moyin 校准为增强。
5. `图片/视频生成`：以 Moyin 多模态和多 Key 批处理为主。
6. `TTS/字幕/单镜合成`：以 Huobao 为主，FFmpeg 执行落到 MYStudio Electron。
7. `快速拼接`：保留 MYStudio 当前 concat 路径。
8. `专业导出`：引入 LTX timeline、混音、取消、媒体探测。

可选支路：

1. `长篇改编支路`：开启 Toonflow 风格事件图谱、改编策略、监督问题清单。
2. `S 级多镜头支路`：开启 Moyin/Seedance 风格多镜头分组和 @Image/@Video/@Audio 引用。
3. `专业剪辑支路`：开启 LTX 风格多轨时间线、BGM、旁白、字幕样式和音频混音。

不进入默认流程的内容：

1. 不把 Huobao 的 Web 后端、数据库和部署脚本搬进 MYStudio。
2. 不把 LTX 的 Python/FastAPI/GPU 模型管理搬进 MYStudio。
3. 不把 Toonflow 的登录、完整无限画布和动态脚本执行放到默认入口。
4. 不让任何 Agent 在用户确认前覆盖正式剧本、分镜、角色或导出设置。

### 13.6 一句话边界

| 软件 | 最应该融合的流程 | 最应该保留为特殊流程的部分 | 当前不应迁移的部分 |
|---|---|---|---|
| MYStudio | 桌面壳、项目存储、工作流入口、FFmpeg 快速候选 | dry-run 和轻量闭环 | 无，作为底座保留 |
| moyin-creator | 配置中心、多 Key、AI 校准、导演/S 级生成 | Seedance 2.0 多镜头能力 | 与 MYStudio 重复或旧版实现 |
| Toonflow-app | 事件图谱、Skill 文件化、Agent 草稿/监督 | 无限画布、持久记忆、动态 vendor | 登录/后端/默认动态脚本执行 |
| huobao-drama | 角色/场景/分镜/音色/TTS/字幕/单镜合成 | 宫格图、全自动流水线 | Nuxt/Hono/Drizzle/SQLite 整套架构 |
| LTX-Desktop | timeline flatten、probe、cancel、drawtext、PCM mix | gap fill、retake、专业编辑器 UI | Python/FastAPI/GPU 模型后端 |

这就是融合边界：公共生产链路进入 MYStudio 主流程，强绑定源项目架构的流程只取设计，不搬运行时；高度自动化和高风险流程先作为高级模式，不进入默认路径。

## 14. 按项目流程的融合判断

本章按项目逐个判断：哪些流程应该并入 MYStudio 主流程，哪些流程虽然优秀但更适合做成独立模块，哪些流程属于源项目特有路径，不适合迁移。

### 14.1 判断口径

| 判断类型 | 含义 | 进入 MYStudio 的形态 |
|---|---|---|
| 主流程融合 | 这条流程是短剧/漫剧生产的必经环节，应该进入默认工作流 | 放入工作流导航、store 类型、常规 UI 和验收清单 |
| 单独模块融合 | 流程优秀，但不是所有项目都需要，适合做成独立工具或高级面板 | 做成“事件图谱”“TTS 合成”“专业导出”等模块 |
| 能力抽象融合 | 不搬 UI 和实现，只把能力抽象成接口、类型或策略 | 例如模型能力标签、Skill 模板、导出计划 |
| 只做参考 | 源项目流程强绑定自身架构或产品定位，不适合进入 MYStudio | 只保留设计经验，不写入默认路线 |

### 14.2 MYStudio 当前流程判断

| 当前流程 | 判断 | 原因 | 融合方式 |
|---|---|---|---|
| 小说导入 `.txt/.md` 或粘贴正文 | 主流程融合 | 是 MYStudio 创作入口，和 Toonflow 长文本改编可衔接 | 保留入口，增加章节索引、源快照、事件抽取入口 |
| Skill 上下文包生成 | 主流程融合 | 是连接人工创作和 Agent/Skill 的桥 | 升级为版本化 SkillContext，能引用事件、角色、分镜 |
| 剧本草稿保存 | 主流程融合 | 后续分镜、角色、对白都依赖剧本 | 增加版本、来源、结构化解析结果 |
| 分镜表维护 track、时长、素材、台词 | 主流程融合 | 是短剧生产核心数据 | 扩展为完整 `StoryboardItem` |
| 本地 FFmpeg 生成候选片段 | 主流程融合 | 已经是 MYStudio 的本地成片能力 | 拆成 export 子模块，保持 IPC 兼容 |
| 选中候选后拼接成片 | 主流程融合 | 快速看整集节奏很重要 | 保留 concat 快速导出 |
| 配置中心保存 vendor/model/binding | 主流程融合 | 是所有 AI 任务调度入口 | 增加能力标签、健康检查、多 Key 运行状态 |
| V1 dry-run 执行边界 | 单独模块融合 | 对开发和低成本试运行有价值，但不是最终用户主流程 | 作为“模拟执行/结构校验”模式保留 |

判断结论：MYStudio 当前流程是融合底座，不应被任何源项目替换。它需要增强字段、任务状态、导出能力，而不是改成 Web 平台或专业剪辑器。

### 14.3 moyin-creator 流程判断

| Moyin 流程 | 判断 | 原因 | 融合方式 |
|---|---|---|---|
| API 服务商配置、多 Key 轮询 | 主流程融合 | 批量生成效率依赖多 Key 调度 | 合并进 MYStudio 配置中心和任务队列 |
| 服务映射：文生图、图生视频、文生视频 | 主流程融合 | 不同任务需要明确模型绑定 | 沿用 `ModelBinding`，增加能力校验 |
| 图床配置 | 能力抽象融合 | 只有部分供应商需要公网 URL | 作为 provider capability，不设为全局必填 |
| 剧本导入或 AI 创作 | 主流程融合 | 是 MYStudio 剧本入口的直接增强 | 保留导入和 AI 创作两种模式 |
| 剧本结构化分析 | 主流程融合 | 场景、分镜、角色、对白是后续数据源 | 输出标准 scene/shot/dialogue/character |
| AI 场景校准 | 主流程融合 | 直接提升场景参考图质量 | 写入 `SceneProfile` 和分镜场景字段 |
| API 校准分镜 | 主流程融合 | 镜头语言、构图、运动需要专业化 | 写入 `StoryboardItem.camera` 等字段 |
| AI 角色校准 | 主流程融合 | 角色一致性是短剧质量关键 | 写入 `CharacterProfile` |
| 导演板块逐镜头生成 | 主流程融合 | 适合人工控制质量 | 作为分镜详情中的逐镜生成模式 |
| 合并生图、自动分配图片 | 单独模块融合 | 很优秀，但依赖模型批量输出格式 | 做成“批量图片生成与分配”工具 |
| S 级 Seedance 2.0 多镜头分组 | 单独模块融合 | 价值高，但强绑定具体视频模型能力 | 做成“多镜头叙事生成”高级模块 |
| @Image/@Video/@Audio 引用 | 主流程融合 | 和资产引用模型高度一致 | 转成 `AssetReference`，不只写在 prompt |

判断结论：Moyin 的普通创作流应并入主线；S 级和合并生图属于优秀流程，应单独模块化融合，作为高级生成能力。

### 14.4 Toonflow-app 流程判断

| Toonflow 流程 | 判断 | 原因 | 融合方式 |
|---|---|---|---|
| 登录后进入项目 | 只做参考 | MYStudio 是本地优先桌面工具，不应默认登录 | 不迁移 |
| 供应商配置 | 能力抽象融合 | 思路有价值，但动态执行风险高 | 吸收能力描述，不默认执行脚本 |
| 新建项目并导入原著 | 主流程融合 | 和 MYStudio 小说导入一致 | 增加原著章节索引和源证据 |
| 章节事件提取 | 单独模块融合 | 对长篇小说改编特别优秀，但短项目不一定需要 | 做成“事件图谱”模块，可从小说入口开启 |
| ScriptAgent 生成故事骨架 | 单独模块融合 | 适合长篇改编和集数规划 | 做成“改编计划”模块，输出草稿 |
| ScriptAgent 生成改编策略 | 单独模块融合 | 能降低长文本丢失和剧情跑偏 | 写入 `AdaptationPlan` |
| 结构化剧本生成 | 主流程融合 | 可接入 MYStudio 剧本和分镜流程 | 输出到剧本草稿，用户确认后入库 |
| ProductionAgent 无限画布 | 只做参考 | UI 范式和 MYStudio 工作流差异大 | 只借鉴节点关系和资产回流 |
| 分镜图节点化精调 | 单独模块融合 | 对单镜质量有价值 | 做成分镜详情中的“精调/重生”能力 |
| 三层 Agent：决策、执行、监督 | 单独模块融合 | 很优秀，但自动化风险高 | 做成 Agent 工作台，默认只输出建议和问题清单 |
| 持久化 Agent 记忆 | 单独模块融合 | 长项目有价值，短项目可不用 | 先用项目级记忆，后续可加检索 |
| Skill 文件化配置 | 主流程融合 | 有利于提示词版本管理和用户调优 | 建立 MYStudio Skill 模板库 |
| 可编程供应商 TypeScript | 单独模块融合 | 私有化接入很强，但有安全边界 | 高级供应商模块，默认禁用脚本执行 |

判断结论：Toonflow 的优秀点不在 FFmpeg 或 UI，而在“长文本改编、Agent 编排、Skill 文件化”。这些适合单独模块融合，不应整体替换 MYStudio 工作流。

### 14.5 huobao-drama 流程判断

| Huobao 流程 | 判断 | 原因 | 融合方式 |
|---|---|---|---|
| 剧本生成/小说改剧本 | 主流程融合 | 和短剧生产目标一致 | 作为改编 Skill 和剧本标准化能力 |
| `script_rewriter` | 单独模块融合 | 可作为独立的“小说转短剧”工具 | 输出改编稿和剧本草稿 |
| `extractor` 角色/场景提取 | 主流程融合 | 角色和场景是分镜一致性的基础 | 写入 `CharacterProfile`、`SceneProfile` |
| 角色图生成、上传、管理 | 主流程融合 | 角色一致性强依赖参考图 | 并入资产库和角色面板 |
| 角色音色分配与试听 | 主流程融合 | MYStudio 当前缺口明显 | 建立 voiceId、试听、TTS job |
| `storyboard_breaker` 分镜拆解 | 主流程融合 | 字段完整，适合短剧业务 | 改写为 MYStudio `StoryboardItem` |
| 场景描述和镜头设计 | 主流程融合 | 是生成高质量视频的基础 | 作为分镜详情核心字段 |
| 宫格图生成、切分、分配 | 单独模块融合 | 批量出图效率高，但不是所有模型通用 | 做成“宫格图批量分镜”高级工具 |
| 帧类型选择：首帧/尾帧/分镜板 | 主流程融合 | 和图生视频链路强相关 | 写入分镜资产引用 |
| 图生视频自动生成 | 主流程融合 | 是短剧生产主能力 | 接 MYStudio 生成任务队列 |
| TTS 配音生成 | 主流程融合 | 让视频从素材变成成片 | 接角色音色和对白字段 |
| FFmpeg 单镜头合成 | 主流程融合 | 视频 + 音频 + 字幕是短剧单镜成片核心 | Phase 2 落到 Electron export |
| 整集拼接导出 | 主流程融合 | 和 MYStudio 快速剪辑一致 | 保留 concat 并增加 ready 校验 |
| Nuxt/Hono/Drizzle/SQLite 架构 | 只做参考 | 和 MYStudio 本地桌面项目存储冲突 | 不迁移，只吸收业务模型 |

判断结论：Huobao 的短剧业务流程最适合进入 MYStudio 主线，尤其是角色/场景/分镜/音色/TTS/字幕/单镜合成。它的 Web 后端架构不融合。

### 14.6 LTX-Desktop 流程判断

| LTX 流程 | 判断 | 原因 | 融合方式 |
|---|---|---|---|
| 首次启动选择本地/API 模式 | 只做参考 | MYStudio 不做 LTX 模型专用运行时 | 不迁移 |
| 模型下载、本地 GPU 推理 | 只做参考 | 打包、硬件、Python 依赖过重 | 不进入当前计划 |
| text-to-video/image-to-video/audio-to-video | 能力抽象融合 | 这些是通用生成能力，不应绑定 LTX | 抽象为 `GenerationJob.kind=video` |
| Video edit generation/Retake | 单独模块融合 | 对返修很有价值，但依赖模型能力 | 做成“候选片段重生成/局部重做”高级能力 |
| Video Editor Interface | 单独模块融合 | 专业剪辑体验优秀，但不应替换主流程 | 做成剪辑页高级模式 |
| timeline gap fill | 单独模块融合 | 可以补空镜头，但不是基础必需 | 放在专业时间线后续能力 |
| timeline flatten | 主流程融合 | 是多轨导出的核心算法 | Phase 3 做纯函数模块 |
| drawtext 字幕/filter graph | 主流程融合 | 字幕样式化和复杂导出需要 | 从 SRT 过渡到 drawtext |
| PCM 音频混音 | 主流程融合 | BGM、对白、旁白叠加必需 | 限制时长和音轨数逐步接入 |
| FFmpeg 路径探测 | 主流程融合 | 桌面导出必须稳定 | Electron export utils |
| 导出取消 | 主流程融合 | 长导出必须可取消 | 新增 IPC 和 active process 管理 |
| 媒体 probe | 主流程融合 | 时间线和合成都需要知道时长/尺寸/音轨 | 新增 `studio-probe-media` |
| Python/FastAPI 后端 | 只做参考 | 和 MYStudio 当前架构冲突 | 不迁移 |

判断结论：LTX 的生成模型运行时不融合；它的“导出工程能力”必须融合。timeline、probe、cancel、drawtext、PCM mix 是优秀且可单独拆成 `renderer/export` 模块的能力。

### 14.7 优秀流程的单独融合清单

这些流程不一定进入默认主线第一屏，但值得做成独立模块或高级能力：

| 独立模块 | 来源 | 为什么优秀 | 接入 MYStudio 的模块名建议 | 前置依赖 |
|---|---|---|---|---|
| 事件图谱模块 | Toonflow | 解决长篇小说上下文丢失 | `novel-events` | 原文导入、章节索引 |
| 改编计划模块 | Toonflow | 能把原著压缩成短剧集纲 | `adaptation-plan` | 事件图谱、SkillContext |
| Skill 模板库 | Toonflow/Huobao | 提示词可版本化、可调优、可复用 | `skill-library` | SkillContext 版本 |
| Agent 审查模块 | Toonflow | 决策/执行/监督分层能降低自动化风险 | `agent-review` | 草稿版本和问题清单 |
| 批量图片生成与分配 | Moyin/Huobao | 能显著提升分镜图生产效率 | `batch-image-assignment` | AssetReference、StoryboardItem |
| S 级多镜头叙事 | Moyin | 多镜头合并能提升连贯叙事 | `multi-shot-generation` | 模型能力标签、多模态引用 |
| 角色音色和 TTS 工作台 | Huobao | 让角色声音成为可管理资产 | `voice-tts-workbench` | CharacterProfile、dialogue |
| 单镜合成器 | Huobao/MYStudio | 将画面、声音、字幕合成可审片段 | `shot-composer` | TTS、字幕、FFmpeg |
| 宫格图切分分配 | Huobao | 对批量分镜首帧很高效 | `grid-image-splitter` | 图片生成、分镜映射 |
| 专业导出引擎 | LTX | 多轨、混音、字幕、取消是最终成片关键 | `timeline-exporter` | AssetReference、ExportPlan |
| 媒体探测工具 | LTX | 合成前知道时长、尺寸、音轨，减少失败 | `media-probe` | FFmpeg/ffprobe |
| 候选片段重生成/Retake | LTX | 对不满意片段局部返修有价值 | `clip-retake` | 候选片段、模型能力 |

这些模块的共同特点是：可以独立上线、独立验收，不需要一次性重构 MYStudio 全流程。

### 14.8 不建议融合的流程清单

| 不建议融合流程 | 来源 | 不融合原因 | 替代方案 |
|---|---|---|---|
| 完整 Nuxt + Hono + Drizzle + SQLite 后端 | Huobao | 会把 MYStudio 从桌面本地工具变成 Web 全栈系统 | 只复用业务字段和流程 |
| 完整 Python + FastAPI + GPU 模型后端 | LTX | 打包和硬件门槛高，偏离当前 Electron 主线 | 只抽象视频生成 job 和导出能力 |
| 登录账号作为默认入口 | Toonflow | 本地优先工具不应强制登录 | 保留本地项目入口 |
| 完整无限画布替代工作流 | Toonflow | UI 心智变化过大，会压过剧本/分镜主流程 | 只借鉴节点关系和资产回流 |
| 默认执行用户 TypeScript vendor 脚本 | Toonflow | 安全边界高，可能访问本机文件和网络 | 高级模式，默认禁用执行 |
| 全自动一键生成全剧且自动覆盖数据 | Huobao/Toonflow | 错误会贯穿剧本、分镜、素材和导出 | 所有 AI 输出先进入草稿/候选 |
| LTX 专用模型下载和许可证流程 | LTX | 强绑定 LTX 产品和 Hugging Face 模型条款 | 保留通用供应商模型配置 |

### 14.9 最终判断结论

| 项目 | 适合并入主流程 | 适合单独融合 | 不适合迁移 |
|---|---|---|---|
| MYStudio | 桌面壳、项目存储、工作流入口、配置中心、本地 FFmpeg 快速成片 | dry-run、结构校验、开发模式 | 无 |
| moyin-creator | API 配置、多 Key、剧本解析、AI 校准、导演生成、多模态引用 | S 级多镜头、合并生图、图床能力 | 与 MYStudio 重复的旧实现 |
| Toonflow-app | 原著导入、事件抽取思想、Skill 文件化、结构化剧本输出 | 事件图谱、改编计划、三层 Agent、动态 vendor、记忆 | 登录、完整后端、完整无限画布默认化 |
| huobao-drama | 角色/场景/分镜/音色/TTS/字幕/单镜合成/整集合并 | 宫格图、全自动流水线、短剧 Agent 模板 | Nuxt/Hono/Drizzle/SQLite 运行架构 |
| LTX-Desktop | FFmpeg 探测、导出取消、timeline flatten、drawtext、PCM mix、媒体 probe | 专业编辑器、gap fill、retake | Python/FastAPI/GPU 本地模型后端 |

最终融合路线应是：主流程吸收 Huobao 的短剧业务闭环和 Moyin 的生成校准，长文本和 Agent 能力作为 Toonflow 风格的独立增强模块，专业剪辑导出作为 LTX 风格的独立后段模块。这样 MYStudio 的默认体验仍然简单，但高级能力可以按模块逐步接入。

## 15. 各项目优势深化与单独融合价值

前面的章节已经判断了流程能否融合。本章进一步说明每个项目“为什么有优势”，这些优势应该进入 MYStudio 的哪一层，以及哪些优秀能力值得单独做成模块，不必强行塞进默认主流程。

### 15.1 优势判断维度

| 维度 | 判断问题 | 对 MYStudio 的意义 |
|---|---|---|
| 产品优势 | 这个项目最适合哪类用户和场景 | 决定它应成为默认流程还是高级模块 |
| 流程优势 | 哪个生产环节最成熟 | 决定它应接入小说、剧本、分镜、生成、合成还是导出 |
| 数据优势 | 是否有清晰对象和状态 | 决定它是否能落到 `src/types/studio.ts` 和 store |
| AI 优势 | 是否有好的 Agent、Skill、prompt、批处理策略 | 决定它是否进入 Skill/Agent/任务队列 |
| 工程优势 | 是否有可复用的本地执行、FFmpeg、IPC、纯函数模块 | 决定它是否适合直接改写到 Electron |
| 风险边界 | 是否强绑定后端、登录、动态脚本、GPU 或许可证 | 决定它只取思想还是迁移实现 |

融合时不能只看“功能多不多”。真正应该优先融合的是：能提升 MYStudio 成片质量、能降低人工重复操作、能保持本地桌面架构简单、能被单独验收的优势。

### 15.2 MYStudio 当前优势

| 优势 | 具体表现 | 为什么重要 | 融合方式 |
|---|---|---|---|
| 本地优先桌面壳 | Electron + React + TypeScript + Zustand | 用户不用部署 Web 后端，适合个人创作和桌面素材管理 | 作为所有融合能力的承载层 |
| 文件型项目存储 | 项目数据、素材路径、工作流数据可本地保存 | 避免引入数据库迁移和服务维护成本 | 所有新模型字段先兼容旧项目 |
| 工作流入口清晰 | 小说、Skill、剧本、分镜、剪辑、配置 | 对非专业用户可理解，不像专业 NLE 那样复杂 | 保持默认路径，后续只做增强 |
| 已有 FFmpeg 候选渲染 | Electron main process 可调用本机 FFmpeg | 已经具备“素材变候选、候选拼接成片”的基础 | 拆成 `src/electron/export/*`，保持 IPC 兼容 |
| Moyin 基底已融合 | 配置中心、AI 批处理、S 级工作流方向已存在 | 不需要从零重建 AI 创作系统 | 扩展而不是重写 |
| dry-run 边界 | V1 可结构校验而不真实执行模型 | 适合开发、排错、低成本检查 | 保留为“模拟执行/验收模式” |

MYStudio 的核心优势不是某个单点功能最强，而是“适合作为融合容器”。它应该保留轻量桌面入口，再把其他项目的强项模块化接进来。

适合进入主流程的 MYStudio 优势：

1. 桌面壳和本地项目存储。
2. 工作流入口和配置中心。
3. 本地 FFmpeg 快速候选渲染和拼接。
4. dry-run 和结构校验能力。

适合单独增强的 MYStudio 优势：

1. `export` 子模块：把现有 FFmpeg 能力从 main 拆出。
2. `project-health` 模块：打开项目时检查模型、FFmpeg、旧数据迁移。
3. `dry-run-report` 模块：生成任务前输出将要调用的模型、素材、字幕、导出参数。

### 15.3 moyin-creator 优势

| 优势 | 具体表现 | 为什么优秀 | 融合方式 |
|---|---|---|---|
| 配置和服务映射成熟 | API 服务商、多 Key、文生图/图生视频/文生视频映射 | AI 创作工具最容易失败在配置和模型错配，Moyin 已有基础 | 并入 MYStudio 配置中心主流程 |
| 多 Key 并发和批处理 | Key 越多并发越高，批量生成速度更好 | 短剧有大量分镜，批处理能力直接影响效率 | 接入统一 `GenerationJob` 队列 |
| 剧本结构化入口 | 剧本可拆成场景、分镜、角色、对白 | 是所有后续生图、生视频、TTS 的数据基础 | 作为剧本标准化主流程 |
| AI 二次校准 | 场景校准、分镜校准、角色校准 | 不是简单生成 prompt，而是先提高输入质量 | 作为分镜详情的质量增强步骤 |
| 导演/S 级板块 | 首帧、尾帧、视频提示词和多镜头叙事 | 适合把短剧镜头做得更可控、更连贯 | 导演模式进主流程，S 级做高级模块 |
| 多模态引用 | @Image/@Video/@Audio | 能把参考图、视频、音频纳入生成上下文 | 转为结构化 `AssetReference` |
| Worker/AI core 思路 | AI worker、task queue、provider abstraction | 长任务不应阻塞 UI，provider 要可替换 | 吸收为任务队列和 provider 能力描述 |

Moyin 最大优势是“AI 生成前段”。它解决的是从剧本到高质量提示词、再到批量图/视频生成的问题。

应并入主流程：

1. 配置中心和服务映射。
2. 多 Key 批处理。
3. 剧本结构化。
4. 场景、分镜、角色校准。
5. 导演逐镜头生成。

优秀但适合单独融合：

| 单独模块 | 来源优势 | 独立原因 | 目标形态 |
|---|---|---|---|
| `multi-shot-generation` | S 级 Seedance 多镜头叙事 | 依赖具体模型能力，不适合所有项目默认开启 | 分镜分组、引用收集、约束校验、批量视频生成 |
| `batch-image-assignment` | 合并生图并自动分配 | 批量图格式和切分规则需要单独验收 | 多分镜合并生图、结果自动映射 |
| `prompt-calibration-lab` | 三类 AI 校准 | 高级用户会调校准模板 | 保存不同校准版本并比较输出 |

不应迁移的部分：

1. 与 MYStudio 已重叠的旧 UI 和旧 store 结构。
2. 强绑定特定服务商的临时代码。
3. 只存在于 prompt 字符串里的隐式素材引用，应改成结构化引用。

### 15.4 Toonflow-app 优势

| 优势 | 具体表现 | 为什么优秀 | 融合方式 |
|---|---|---|---|
| 长文本改编能力 | 章节事件提取、事件图谱、原著上下文调用 | 小说改短剧最容易丢事件和人物动机，事件图谱能压住长文本 | 做成 `novel-events` 独立模块 |
| ScriptAgent | 故事骨架、改编策略、结构化剧本 | 先规划再写剧本，比直接让 AI 写整剧更稳 | 做成 `adaptation-plan` 和剧本草稿版本 |
| ProductionAgent | 分镜、资产、视频节点组织 | 能把分镜生产过程变成可追踪节点 | 借鉴节点关系，接入分镜详情和资产库 |
| 三层 Agent | 决策层、执行层、监督层 | 把“要做什么、怎么做、做得对不对”分开 | 做成 Agent 工作台，不自动覆盖数据 |
| Skill 文件化 | `data/skills/*.md` 和题材 Skill | 提示词可维护、可版本化、可按题材复用 | 建立 MYStudio Skill 模板库 |
| 可编程供应商 | `data/vendor/*.ts`、设置中更新代码 | 私有模型和特殊 API 接入能力强 | 先做能力描述，高级模式再做沙箱执行 |
| Agent 记忆 | 本地记忆和语义召回 | 长项目多轮创作需要连续性 | 先用项目级记忆和事件证据链替代 |

Toonflow 最大优势是“长篇改编和 Agent 编排”。它不是 MYStudio 默认 UI 的替代品，而是 MYStudio 在长篇小说项目中的增强层。

应并入主流程：

1. 原著导入后保留章节和事件证据。
2. Skill 文件化和可版本化上下文包。
3. 结构化剧本输出进入 MYStudio 剧本草稿。

优秀但适合单独融合：

| 单独模块 | 来源优势 | 独立原因 | 目标形态 |
|---|---|---|---|
| `novel-events` | 章节事件图谱 | 短视频剪辑项目不需要长文本事件图谱 | 章节、事件、人物、地点、冲突、原文证据 |
| `adaptation-plan` | ScriptAgent 改编策略 | 属于创作规划，不应混在普通剧本编辑里 | 集数拆分、主线压缩、节奏建议 |
| `agent-review` | 三层 Agent 监督 | 自动写入风险高 | 输出问题清单、修订建议、差异对比 |
| `skill-library` | Skill 文件化 | 需要 UI 管理和版本 | 默认 Skill、题材 Skill、用户自定义 Skill |
| `vendor-lab` | 动态 vendor | 安全风险高 | 能力描述、测试请求、沙箱执行预留 |

不应迁移的部分：

1. 登录账号作为默认入口。
2. 完整无限画布替代工作流。
3. 未隔离的动态 TypeScript 供应商脚本执行。
4. 让 Agent 直接覆盖正式项目数据。

### 15.5 huobao-drama 优势

| 优势 | 具体表现 | 为什么优秀 | 融合方式 |
|---|---|---|---|
| 短剧业务对象完整 | 角色、场景、分镜、音色、素材、状态 | MYStudio 当前最缺的是短剧对象的完整字段 | 作为 `studio.ts` 类型扩展蓝本 |
| Agent 分工清晰 | `script_rewriter`、`extractor`、`storyboard_breaker`、`voice_assigner`、`grid_prompt_generator` | 每个 Agent 只负责一个业务环节，便于拆分和验收 | 转成 MYStudio Skill 模板和任务类型 |
| 角色管理成熟 | 生成角色图、上传角色图、角色图管理 | 短剧角色一致性强依赖角色资产 | 并入角色库和资产引用 |
| 音色流程明确 | 角色音色分配与试听 | 视频成片必须有角色声音，MYStudio 当前短板明显 | 进入主流程 |
| 分镜字段贴近成片 | 场景描述、镜头设计、帧类型、分镜图片 | 直接服务图生视频和单镜合成 | 扩展 `StoryboardItem` |
| TTS + 字幕 + 单镜合成 | FFmpeg 合成视频、音频、字幕 | 这是从“视频素材”到“可审片段”的关键 | Phase 2 主线 |
| 整集拼接 | composed 全齐后 merge | 适合短剧批量生产 | 保留快速 concat 并加状态校验 |
| 宫格图流程 | grid prompt、宫格图切分与分配 | 可以降低批量分镜首帧成本 | 做成高级批量工具 |

Huobao 最大优势是“短剧业务闭环”。它最适合补齐 MYStudio 从分镜到有声成片之间缺失的对象和状态。

应并入主流程：

1. 角色/场景/分镜业务模型。
2. 角色音色和 TTS。
3. 字幕结构和字幕样式。
4. 单镜合成。
5. 整集快速拼接。

优秀但适合单独融合：

| 单独模块 | 来源优势 | 独立原因 | 目标形态 |
|---|---|---|---|
| `short-drama-agents` | 五个业务 Agent | 需要先和 MYStudio SkillContext 对齐 | 每个 Agent 输出草稿，用户确认写入 |
| `voice-tts-workbench` | 音色分配和试听 | 音频工作流可独立验收 | 角色 voiceId、试听、批量 TTS |
| `shot-composer` | 单镜 FFmpeg 合成 | 可独立于 AI 生图/视频先实现 | 视频 + TTS + 字幕 -> composed candidate |
| `grid-image-splitter` | 宫格图切分分配 | 模型和图片布局不固定 | 切分、预览、映射到分镜 |

不应迁移的部分：

1. Nuxt 3 + Hono + Drizzle + SQLite 全栈运行结构。
2. 数据库自动迁移和服务端资源路径。
3. 与商业部署绑定的环境配置方式。

### 15.6 LTX-Desktop 优势

| 优势 | 具体表现 | 为什么优秀 | 融合方式 |
|---|---|---|---|
| 专业时间线思维 | Video Editor Interface、timeline project | MYStudio 需要从简单拼接升级到可控导出 | 做成剪辑页高级模式 |
| 多轨 flatten | 高轨覆盖低轨、生成最终可见片段 | 多轨导出的核心，不然只能线性 concat | Phase 3 纯函数实现 |
| 字幕 drawtext/filter graph | 字幕可样式化、可和视频滤镜合成 | 比简单 SRT 更适合最终发布 | 字幕样式稳定后接入 |
| PCM 音频混音 | 多音轨叠加、音量、时间偏移 | BGM、旁白、角色对白都需要混音 | 限制时长后逐步实现 |
| FFmpeg 工程化 | 路径探测、spawn、日志、active export process | 导出是长任务，必须可观察、可取消、可复现 | 改写进 `src/electron/export/*` |
| 媒体 probe | 获取时长、尺寸、音轨 | 合成前探测能减少导出失败 | 新增 `studio-probe-media` |
| retake/gap fill | 片段返修和时间线空白补齐 | 对精修很有价值 | 作为专业剪辑后续模块 |

LTX 最大优势是“导出工程和专业剪辑后段”。它不是小说/短剧业务源头，而是 MYStudio 最终成片质量和导出稳定性的来源。

应并入主流程：

1. FFmpeg 路径探测。
2. 导出取消。
3. 媒体 probe。
4. timeline flatten。
5. 字幕 filter graph。
6. PCM 音频混音。

优秀但适合单独融合：

| 单独模块 | 来源优势 | 独立原因 | 目标形态 |
|---|---|---|---|
| `timeline-exporter` | 多轨导出 | 需要等 AssetReference 和 ExportPlan 稳定 | 轨道、clip、字幕、BGM、混音、导出 |
| `media-probe` | ffprobe/媒体信息 | 可先独立实现并服务多个模块 | 时长、分辨率、fps、音轨、错误诊断 |
| `clip-retake` | retake/video edit | 依赖模型能力，不是基础导出 | 对候选片段做局部重生成 |
| `gap-fill` | timeline gap fill | 需要专业时间线 UI | 对空白段生成补镜头 |

不应迁移的部分：

1. Python/FastAPI 后端。
2. LTX 专用 GPU 模型下载和本地推理环境。
3. LTX 专用 API Key 作为 MYStudio 必填项。
4. 让专业时间线替代默认短剧工作流。

### 15.7 各项目优势对照表

| 能力领域 | 最强项目 | 第二参考 | MYStudio 融合策略 |
|---|---|---|---|
| 桌面壳和本地项目 | MYStudio | Moyin | 保留 MYStudio 当前架构 |
| API 配置和多 Key | Moyin | MYStudio | 并入配置中心和任务队列 |
| 剧本结构化 | Moyin | Huobao | Moyin 解析 + Huobao 短剧字段 |
| 长篇小说改编 | Toonflow | Huobao | Toonflow 事件图谱 + Huobao 短剧改写 |
| Skill 文件化 | Toonflow | Huobao | 建立 MYStudio Skill 模板库 |
| Agent 编排 | Toonflow | Huobao | Toonflow 三层监督 + Huobao 业务 Agent |
| 角色/场景模型 | Huobao | Moyin | Huobao 字段为主，Moyin 校准增强 |
| 分镜字段 | Huobao | Moyin/Toonflow | Huobao 业务字段 + Moyin 镜头校准 + Toonflow 节点追踪 |
| 多模态生成 | Moyin | LTX | Moyin 主线，LTX 作为通用 video job 抽象 |
| TTS 和角色音色 | Huobao | Moyin | Huobao 主线，Moyin @Audio 引用结构化 |
| 字幕合成 | Huobao | LTX | Huobao 先 SRT，LTX 后 drawtext |
| 单镜合成 | Huobao | MYStudio | Huobao 合成链路落到 MYStudio Electron |
| 快速拼接 | MYStudio/Huobao | Toonflow | 保留 concat |
| 专业多轨导出 | LTX | MYStudio | LTX export 工程化改写 |
| 导出取消和媒体探测 | LTX | MYStudio | 直接进入 Electron export |

### 15.8 单独融合模块优先级

| 优先级 | 模块 | 来源优势 | 为什么这个顺序 |
|---|---|---|---|
| P0 | `studio-data-model` | MYStudio + Huobao | 统一类型是所有流程前提 |
| P0 | `project-health` | MYStudio + Moyin + LTX | 先检查配置、模型、FFmpeg，减少中途失败 |
| P1 | `voice-tts-workbench` | Huobao | 立刻补齐短剧声音能力 |
| P1 | `shot-composer` | Huobao + MYStudio | 让单镜真正成为可审片段 |
| P1 | `batch-generation` | Moyin | 短剧镜头多，必须批量执行 |
| P2 | `novel-events` | Toonflow | 长篇改编质量提升明显，但可作为可选模块 |
| P2 | `skill-library` | Toonflow + Huobao | Agent/Skill 之前先把模板管理好 |
| P2 | `timeline-exporter` | LTX | 单镜稳定后再做专业多轨 |
| P2 | `media-probe` | LTX | 服务合成、导出和错误诊断 |
| P3 | `agent-review` | Toonflow | 需要草稿版本、差异和确认机制 |
| P3 | `multi-shot-generation` | Moyin | 依赖模型能力，适合高级模式 |
| P3 | `vendor-lab` | Toonflow | 动态供应商安全边界最高，最后做 |
| P3 | `clip-retake/gap-fill` | LTX | 专业剪辑增强，等 timeline 稳定后做 |

### 15.9 优势融合后的产品分层

融合后 MYStudio 应形成四层产品能力：

1. `基础生产层`：MYStudio/Moyin 提供项目、配置、剧本、分镜、批量生成。
2. `短剧成片层`：Huobao 提供角色、场景、音色、TTS、字幕、单镜合成、整集拼接。
3. `长篇改编层`：Toonflow 提供事件图谱、改编计划、Skill、Agent 审查。
4. `专业导出层`：LTX 提供 timeline、probe、cancel、drawtext、PCM mix。

这四层不能混成一个复杂页面。默认用户只看到基础生产层和短剧成片层；长篇改编层和专业导出层作为高级模式展开。

### 15.10 最终优势取舍结论

| 项目 | 最大优势 | 融合结论 |
|---|---|---|
| MYStudio | 本地桌面融合底座 | 保留为主架构，不被其他项目替换 |
| moyin-creator | AI 生成前段和多 Key 批处理 | 进入主流程，S 级能力单独模块化 |
| Toonflow-app | 长文本改编、Agent/Skill、动态供应商 | 做成长篇改编和 Agent 高级模块 |
| huobao-drama | 短剧业务闭环、TTS、字幕、单镜合成 | 大量进入主流程，是短剧成片层核心 |
| LTX-Desktop | 专业导出、时间线、混音、FFmpeg 工程化 | 做成后段导出引擎，不迁移模型后端 |

一句话：MYStudio 负责承载，Moyin 负责生成效率，Toonflow 负责长篇智能编排，Huobao 负责短剧业务闭环，LTX 负责专业导出质量。融合时要让它们各司其职，而不是把五套产品形态硬拼在一个页面里。

## 16. 源码级核验与进一步融合判断

本章基于当前磁盘源码继续核验，不只依据 README。目标是把“优势判断”落到可追踪的源文件、字段、函数和模块边界上。

### 16.1 MYStudio 当前源码基线与缺口

| 源文件 | 当前能力 | 已经适合保留 | 明确缺口 |
|---|---|---|---|
| `src/types/studio.ts` | 已定义 `NovelChapter`、`AgentWorkData`、`StoryboardItem`、`ProductionTrack`、`VideoCandidate`、`VendorConfig`、`ModelDefinition`、`TrackRenderPlan`、`EpisodeMergePlan` | 说明 MYStudio 已有小说、Agent 工作数据、分镜、候选视频、模型配置和 FFmpeg plan 的基本骨架 | `StoryboardItem` 只有 `prompt/videoDesc/mediaRef/state` 等轻字段，缺角色、场景、镜头语言、音频、字幕样式、首尾帧、生成任务引用 |
| `src/stores/studio-store.ts` | 可导入小说、保存 Agent 工作数据、创建分镜、绑定素材、重建 track、管理候选视频 | Zustand + 项目级持久化适合作为融合主存储 | 没有角色库、场景库、音色库、字幕对象、导出任务队列和迁移默认值 |
| `src/lib/studio/context.ts` | `SkillContextPackage` 能把章节原文、事件摘要、已有工作数据打成 markdown | 可作为 Toonflow/Huobao Skill 文件化的基础 | 缺 Skill 版本、章节事件结构、角色/场景/分镜引用和 Agent 审查问题清单 |
| `src/lib/studio/production.ts` | 能把分镜按 `trackKey` 分组，生成 track render plan 和 episode merge plan | 快速 concat 逻辑可以继续保留 | 字幕仍从 `videoDesc` 猜测，缺 `subtitleText/dialogue` 优先级；merge 只收 ready filePath，没有多轨 ExportPlan |
| `src/electron/main.ts` | 已有 `studio-render-track-candidate`、`studio-merge-episode`、SRT 字幕烧录、图片/视频转段、concat | 本地 FFmpeg 路径已经跑通，是 Phase 2/3 的承载点 | FFmpeg 逻辑集中在 main，缺 process cancel、ffprobe/probe、timeline export、音频混音、filter script 文件化 |
| `src/electron/preload.ts` | 暴露 `studioRenderer.renderTrackCandidate` 和 `studioRenderer.mergeEpisode` | 兼容当前 UI 调用 | 还缺 `studio-export-timeline`、`studio-export-cancel`、`studio-probe-media`、`composeStoryboardShot` |
| `src/stores/studio-config-store.ts` | 已有 vendor/model/binding 和格式校验 | 能承接 Moyin 配置和 Toonflow vendor 能力描述 | 当前提示“V1 不会执行模型请求”，还缺真实 feature router、多 Key 轮询、能力阻断和健康检查 |

源码判断：

1. MYStudio 不是空白项目，已经有融合底座。
2. 最先要补的是类型和 store，不是直接迁移 UI。
3. 当前 `videoDesc` 承担了过多语义，应拆成结构化字段。
4. 当前 Electron FFmpeg 能力可保留，但必须模块化，否则 LTX 多轨导出无法安全接入。

### 16.2 Toonflow-app 源码级优势

| 源文件 | 核验到的优势 | 对 MYStudio 的启发 | 融合判断 |
|---|---|---|---|
| `src/agents/scriptAgent/index.ts` | `runDecisionAI` 使用 `script_agent_decision.md`，并调度 `storySkeleton`、`adaptationStrategy`、`script`、`supervision` 子 Agent | 改编流程应拆为“决策 -> 执行 -> 监督”，不要一个 prompt 写完整剧本 | 单独融合为 `agent-review` 和 `adaptation-plan` |
| `src/agents/scriptAgent/tools.ts` | 工具能读取 `get_novel_events`、`get_novel_text`、`get_planData`、`get_script_content` | 长篇改编必须能查章节事件、原文、已有工作区数据 | 直接借鉴为 MYStudio Agent 工具协议 |
| `src/agents/productionAgent/index.ts` | ProductionAgent 拆出 derive assets、generate assets、director plan、storyboard gen、storyboard panel、storyboard table、supervision | 后段生产不是单一“生成视频”，而是一组可审查子任务 | 单独融合为 Production 工作台，不进入默认自动流程 |
| `src/agents/productionAgent/tools.ts` | `flowDataSchema` 包含 script、scriptPlan、assets、storyboardTable、storyboard；工具可增删资产、生成衍生资产、生成分镜 | 分镜和资产应作为可操作对象，不应只存 prompt 字符串 | 直接影响 `AssetReference` 和分镜详情设计 |
| `data/skills/*.md`、`data/skills/production_skills/*.md` | Skill 以 markdown 文件组织，且有题材/艺术/生产技能分层 | MYStudio Skill 不应硬编码在组件里 | 主流程融合 Skill 模板库 |
| `src/utils/vendor.ts` | 使用 sucrase 将 TypeScript vendor 代码转为 JS 并通过 VM 获取 vendor/models | 动态 vendor 能力强，适合私有模型接入 | 只做高级 `vendor-lab`，默认不执行用户脚本 |

Toonflow 源码证明它的优势是“Agent 工具化”和“Skill/vendor 可扩展”，不是单纯有更多页面。MYStudio 迁移时应保留三条边界：

1. Agent 只能产出草稿、候选、问题清单，不能直接覆盖正式分镜。
2. Skill 文件可编辑，但要有默认模板和版本恢复。
3. 动态 vendor 先作为能力描述和测试面板，脚本执行要后置并隔离。

### 16.3 huobao-drama 源码级优势

| 源文件 | 核验到的优势 | 对 MYStudio 的启发 | 融合判断 |
|---|---|---|---|
| `backend/src/db/schema.ts` | `characters` 含 `appearance/personality/voiceStyle/referenceImages/voiceSampleUrl`；`scenes` 含 `location/time/prompt/status`；`storyboards` 含 `shotType/angle/movement/action/result/atmosphere/imagePrompt/videoPrompt/bgmPrompt/soundEffect/dialogue/firstFrameImage/lastFrameImage/videoUrl/ttsAudioUrl/subtitleUrl/composedVideoUrl/status` | Huobao 的字段几乎正好覆盖 MYStudio 缺失的短剧生产对象 | 作为 `StoryboardItem`、`CharacterProfile`、`SceneProfile` 扩展主参考 |
| `skills/storyboard_breaker/SKILL.md` | 明确每镜头单一动作、10-15 秒，并要求 title、time、location、shot_type、angle、movement、action、dialogue、result、atmosphere、image_prompt、video_prompt、bgm_prompt、sound_effect、scene_id、character_ids | 分镜拆解应从“描述”升级为“镜头对象” | 主流程融合 |
| `skills/voice_assigner/SKILL.md` | 音色按性别、年龄、性格、角色定位分配，并通过 list/get/assign 工具闭环 | 角色声音应成为角色资产，不应只在分镜临时生成 | 主流程融合为 voice/TTS 工作台 |
| `backend/src/services/ffmpeg-compose.ts` | `composeStoryboard` 从分镜视频、对白、角色 voiceStyle 生成 TTS，生成 SRT，检测 subtitles filter，再合成视频 + 音频 + 字幕；过滤无对白/环境音 | 单镜合成要有“无对白跳过、角色音色继承、已有 TTS 复用、字幕 filter 兼容”规则 | Phase 2 重点融合 |
| `backend/src/services/ffmpeg-merge.ts` | merge 前要求所有 storyboard 都已有 composedVideoUrl；写 merge 记录，生成 concat list，输出 h264/aac，并记录 duration | 整集合并要先检查 ready 数量，不应静默跳过缺镜头 | 快速导出主流程融合 |
| `assets/image_generations/video_generations/video_merges` 相关表 | 生成任务有 status、taskId、errorMsg、localPath、completedAt | 任务状态和错误信息应成为 MYStudio 任务队列的一等数据 | 融合为 `GenerationJob` |

Huobao 源码证明它最适合补 MYStudio 的“短剧业务对象”和“单镜成片链路”。迁移时要重写为 MYStudio 本地 store 和 Electron IPC，不迁移 Drizzle/SQLite/Hono。

### 16.4 LTX-Desktop 源码级优势

| 源文件 | 核验到的优势 | 对 MYStudio 的启发 | 融合判断 |
|---|---|---|---|
| `electron/export/timeline.ts` | `flattenTimeline` 按时间边界切段，高 `trackIndex` 覆盖低轨，生成 gap，并合并相邻同源片段 | 多轨导出应先做纯函数，独立测试重叠、gap、相邻合并 | Phase 3 主融合 |
| `electron/export/video-filter.ts` | `buildVideoFilterGraph` 纯构造输入和 filter script，支持 gap 黑帧、图片 loop、视频 trim/speed/reverse/flip、letterbox、drawtext 字幕 | FFmpeg filter graph 应从 main 拆成纯函数，避免字符串散落 | Phase 3 主融合 |
| `electron/export/audio-mix.ts` | 提取原始 PCM，按 timelineStart、trim、speed、reverse、volume 混音到 Float64，再 clamp 成 Int16 | 复杂音频不能靠简单 concat；BGM/旁白/对白需要 mixdown | Phase 3 主融合，但需时长和内存限制 |
| `electron/export/ffmpeg-utils.ts` | 查找 imageio_ffmpeg 或系统 ffmpeg，记录 stderr，保存 activeExportProcess，支持 `stopExportProcess`，能检测视频是否有音轨 | MYStudio 需要 ffmpeg path、日志、取消、音轨检测等工程化能力 | 直接改写为 `src/electron/export/ffmpeg-utils.ts` |
| `electron/export/export-handler.ts` | 导出分三步：视频-only filter export、PCM audio mixdown、组合视频+音频；有路径校验、临时文件清理、codec 分支和 cancel handler | 专业导出应独立为 timeline export handler，不应塞进当前 main | 单独融合为 `timeline-exporter` |

LTX 源码证明它的优势不是短剧业务，而是“导出工程质量”。MYStudio 应把它拆成 export 子模块，先保留快速 concat，再新增专业 timeline export。

### 16.5 moyin-creator 源码级优势

| 源文件 | 核验到的优势 | 对 MYStudio 的启发 | 融合判断 |
|---|---|---|---|
| `src/lib/ai/batch-processor.ts` | 自适应批处理有 input/output 双预算、60K hard cap、单批重试、指数退避、并发执行、失败隔离、部分成功合并 | MYStudio 批量生成分镜图/视频/TTS 时不能一条失败拖垮整批 | 主流程融合为 `batch-generation` |
| `src/packages/ai-core/api/task-queue.ts` | 有优先级队列、最大并发、任务类型 handler、重试、取消 pending、统计和 idle 判断 | MYStudio 需要统一 `GenerationJob` 队列，不应每个 UI 自己管理任务 | 主流程融合 |
| `src/lib/ai/feature-router.ts` | feature -> provider/model 绑定，支持多模型轮询、Key manager、fallback 默认平台、统一 `callFeatureAPI` | MYStudio 当前 config store 只有绑定数据，还缺执行路由 | 主流程融合到配置中心下一阶段 |
| `src/packages/ai-core/api/task-poller.ts`、`src/lib/ai/worker-bridge.ts` | 代码中已有取消、轮询、worker bridge 思路 | 长任务需要 worker/bridge 和取消机制 | 条件融合 |
| 多个 Zustand stores | `script-store`、`director-shot-store`、`sclass-store`、`media-store`、`character-library-store` 等拆分职责 | MYStudio 后续 store 不应无限膨胀在一个 studio-store | 作为 store 拆分参考 |

Moyin 源码证明它的优势是“AI 任务调度和前段生成效率”。MYStudio 应优先迁移批处理、feature router、任务队列思想，再接真实模型执行。

### 16.6 源码证据后的融合优先级修正

| 修正项 | 原判断 | 源码核验后判断 | 原因 |
|---|---|---|---|
| `StoryboardItem` 扩展 | Phase 1 重要 | Phase 1 最高优先级 | Huobao schema 和 storyboard skill 显示短剧生产字段非常完整，而 MYStudio 当前字段明显不足 |
| `SkillContextPackage` | 作为上下文包即可 | 必须版本化并引用结构化对象 | Toonflow Agent 工具能查事件、原文、工作区，MYStudio 只打 markdown 不够 |
| `studio-config-store` | 保留配置即可 | 必须接 feature router 和健康检查 | Moyin feature-router 显示执行前必须能按功能找 provider/model/key |
| FFmpeg 模块拆分 | Phase 3 前做 | Phase 2 前就应开始 | Huobao 单镜合成和 LTX 导出都需要共同的 ffmpeg-utils |
| 字幕实现 | 先 SRT 后 drawtext | Phase 2 SRT、Phase 3 drawtext | Huobao compose 适合单镜 SRT，LTX drawtext 适合专业导出 |
| 导出取消 | Phase 3 | 可以和 export utils 一起提前设计 | LTX active process 很轻量，接口应提前预留 |
| 任务队列 | Phase 5 | 应提前到 Phase 1/P1 | Moyin 批处理和 Huobao generation status 都说明任务状态是核心基础 |
| Agent 自动化 | Phase 4 | 仍保持 Phase 4，但 Phase 1 要预留草稿/问题清单类型 | Toonflow Agent 输出多层工作区数据，不预留类型后续会反复迁移 |

### 16.7 源码级落地映射

| MYStudio 目标模块 | 主要参考源码 | 首次落地内容 | 验收方式 |
|---|---|---|---|
| `src/types/studio.ts` 生产模型 | Huobao `schema.ts`、MYStudio `studio.ts` | `CharacterProfile`、`SceneProfile`、扩展 `StoryboardItem`、`AssetReference`、`GenerationJob` | 旧项目可打开，新字段默认值完整 |
| `src/stores/studio-store.ts` 拆分/扩展 | MYStudio store、Moyin 多 store | 角色/场景/资产/任务状态 action | 新增、更新、绑定、删除不破坏现有分镜 |
| `src/lib/studio/context.ts` | Toonflow script tools、MYStudio context | SkillContext 引用事件、角色、场景、分镜、候选 | 生成上下文可追踪源数据 |
| `src/lib/studio/tasks.ts` | Moyin batch processor、task queue | 统一任务状态、失败隔离、重试、进度 | 单批失败不影响成功项 |
| `src/electron/export/ffmpeg-utils.ts` | LTX `ffmpeg-utils.ts`、MYStudio main | path 探测、spawn、stderr 日志、active process、cancel | `ffmpeg -version` 可探测，取消能停止进程 |
| `src/electron/export/shot-compose.ts` | Huobao `ffmpeg-compose.ts` | TTS 音频输入、SRT 生成、字幕过滤、无对白跳过 | 有对白/无对白单镜 smoke |
| `src/electron/export/episode-concat.ts` | Huobao `ffmpeg-merge.ts`、MYStudio concat | ready 检查、concat list、duration 获取 | 缺镜头时阻断，ready 全齐时输出 |
| `src/electron/export/timeline.ts` | LTX `timeline.ts` | flatten 纯函数 | 单测覆盖重叠、gap、相邻合并 |
| `src/electron/export/video-filter.ts` | LTX `video-filter.ts` | filter graph 和 drawtext | filter script 生成快照测试 |
| `src/electron/export/audio-mix.ts` | LTX `audio-mix.ts` | PCM 混音最小版 | 双音轨混合 smoke |
| `src/electron/preload.ts` | LTX export handler、MYStudio preload | 新增 `probeMedia`、`exportTimeline`、`cancelExport` | renderer 可调用并收到错误/成功 |

### 16.8 继续调查后的结论

1. `Huobao` 的源码字段最适合直接指导 MYStudio 类型扩展，尤其是分镜、角色、音色、TTS、字幕、单镜合成。
2. `LTX` 的源码模块最适合直接指导 Electron export 拆分，尤其是 flatten、filter graph、PCM mix、cancel。
3. `Moyin` 的源码最适合指导 AI 任务调度，尤其是批处理、feature router、多模型轮询、重试和部分成功。
4. `Toonflow` 的源码最适合指导 Agent/Skill 高级层，尤其是章节事件工具、子 Agent 编排、Skill 文件化、动态 vendor 能力描述。
5. `MYStudio` 当前已有融合容器，但字段、任务、导出模块都需要先打基础；不应先做 UI 大改。
