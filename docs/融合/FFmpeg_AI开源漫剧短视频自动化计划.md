# FFmpeg + AI 开源漫剧短视频自动化计划

## 1. 目标与结论

本计划目标是为 MYStudio 建立一条不依赖剪映/CapCut 的漫剧短视频生产链路：由 AI 生成或辅助生成素材、语音、字幕、节奏点和特效参数，由 FFmpeg 负责最终合成、混音、字幕烧录、转场和导出。

核心结论：

- FFmpeg 可以作为最终出片引擎，但不应承担 AI 生成、语义理解、自动校正和素材创作职责。
- 剪映/CapCut 的优势主要来自模板库、素材库、音效库、热门特效包装和产品化交互；开源方案可以达到类似最终效果，但需要自建模板库和素材规则。
- MYStudio 更适合走“开源 AI 能力 + JSON 时间线 + FFmpeg 渲染器 + 可复用模板库”的路线，而不是复刻一个完整剪映。
- 第一阶段不追求全功能视频编辑器，优先完成自动出片闭环：剧本/分镜 -> 素材 -> 配音 -> 字幕 -> 特效参数 -> FFmpeg 成片。

本计划不把闭源商业软件作为必要环节。商业 API 可以作为可选供应商，但主链路应保持开源、本地优先、可替换。

## 2. 边界

### 2.1 必须支持

- 批量生成漫剧短视频。
- 支持图片、视频、音频、字幕、贴纸、透明特效素材的时间线合成。
- 支持基础短视频包装：片头、片尾、字幕样式、BGM、音效、转场、闪白、震屏、推拉镜头、速度变化。
- 支持 AI 生成或辅助生成：分镜、提示词、配音、字幕、节奏点、特效时间点。
- 支持模板化：同一套模板可以批量套不同剧集和不同分镜。
- 支持本地文件项目结构，方便复跑、续跑、失败重试和人工校正。

### 2.2 暂不支持

- 不做剪映式完整素材市场。
- 不做复杂 NLE 全功能剪辑器，例如完整轨道磁吸、嵌套序列、复杂关键帧编辑。
- 不强依赖 After Effects、DaVinci、剪映、CapCut 等闭源软件。
- 不保证所有 AI 模型可商用；模型和素材的许可证需要单独校验。
- 不把 FFmpeg 当作 AI 模型运行器，FFmpeg 只负责媒体处理和最终渲染。

## 3. 总体架构

目标架构：

```text
剧本/小说/分镜
  -> AI 分镜与镜头计划
  -> 角色/场景/素材生成或导入
  -> TTS 配音
  -> ASR 字幕与校正
  -> BGM 节奏分析
  -> 特效模板匹配
  -> JSON 时间线
  -> FFmpeg 合成导出
  -> 成片 + 工程记录
```

模块分工：

```text
MYStudio UI
  -> 编辑剧本、分镜、角色、场景、模板和生成任务

AI 编排层
  -> 调用开源模型或可选 API，生成素材、字幕、配音、特效参数

模板层
  -> 管理短视频包装、字幕样式、转场、贴纸、音效、卡点规则

时间线层
  -> 把分镜、素材、字幕、特效转换为统一 JSON 时间线

FFmpeg 渲染层
  -> 根据 JSON 时间线生成 filter_complex，完成合成、混音和导出
```

## 4. 开源组件选型

### 4.1 视频与图片生成

可选组件：

- ComfyUI：作为本地 AI 图像/视频工作流编排器。
- LTX-Video / LTX-Desktop：用于文生视频、图生视频、视频编辑生成的参考实现。
- Wan / HunyuanVideo 等开源视频模型：作为图生视频或文生视频候选。
- Stable Diffusion / SDXL / Flux 系列本地图像模型：用于角色、背景、贴纸和特效素材生成。

建议：

- MYStudio 不直接深度绑定单一模型。
- 通过 provider adapter 调用 ComfyUI、LTX、本地脚本或外部 API。
- 输出统一落盘为图片、视频或透明素材，再进入 FFmpeg 时间线。

### 4.2 配音与字幕

可选组件：

- Piper：轻量本地 TTS。
- Coqui TTS / XTTS：多音色 TTS 候选。
- CosyVoice：中文 TTS 候选。
- Whisper / faster-whisper / whisper.cpp：ASR 字幕识别与时间轴生成。

建议：

- TTS 负责生成角色对白音频。
- Whisper 负责把最终音频或对白音频转成 SRT/ASS 时间轴。
- LLM 负责字幕润色、断句、错字校正和口语化压缩。
- FFmpeg 只负责烧录字幕，不负责识别或智能校正。

### 4.3 节奏点与卡点

可选组件：

- librosa：Python 音频分析库，可提取 beat/onset。
- Essentia：更专业的音频分析库。

建议：

- 对 BGM 分析节拍，输出 `beats.json`。
- 模板根据节拍插入闪白、缩放、震屏、切镜、音效。
- 允许人工覆盖节奏点，避免自动卡点破坏叙事节奏。

### 4.4 画质增强

可选组件：

- Real-ESRGAN：图片或帧放大。
- RIFE：补帧。
- Anime4K：动漫风视频增强。

建议：

- 作为后处理可选步骤，不放进 MVP 必选链路。
- 增强前保留原始输出，避免不可逆损坏。

## 5. FFmpeg 能力边界

### 5.1 FFmpeg 适合做的内容

- 视频拼接和转码。
- 图片转视频片段。
- 视频、图片、透明 PNG、透明 WebM 叠加。
- 字幕烧录，支持 drawtext、subtitles、ass。
- BGM、配音、音效混音。
- 淡入淡出、交叉转场、闪白、黑场。
- 缩放、平移、推拉镜头、Ken Burns 效果。
- 模糊、锐化、调色、亮度、对比度、色相变化。
- 绿幕/蓝幕抠像。
- 简单震屏、抖动、速度变化。
- 输出多规格版本，例如 9:16、16:9、1:1。

### 5.2 FFmpeg 不适合单独做的内容

- 自动理解剧情。
- 自动生成镜头画面。
- 自动修正字幕错字。
- 自动设计热门包装。
- 复杂粒子系统创作。
- 复杂角色骨骼动画。
- 复杂遮罩跟踪和物体移除。

这些能力需要由 AI、素材库、模板规则或人工校正提供，FFmpeg 只执行最终渲染。

## 6. 模板系统设计

### 6.1 模板分层

模板分为四层：

```text
项目模板
  -> 定义画幅、风格、默认字体、默认 BGM、片头片尾

剧集模板
  -> 定义单集结构、开场钩子、结尾悬念、字幕节奏

镜头模板
  -> 定义镜头内推拉、字幕、贴纸、转场、音效

特效模板
  -> 定义闪白、震屏、速度线、烟尘、剑气、爆点、弹幕等具体效果
```

### 6.2 模板文件建议

模板建议使用 JSON 或 YAML，方便 UI 编辑和脚本读取。

示例结构：

```json
{
  "id": "vertical_drama_fast_cut_v1",
  "name": "竖屏快节奏漫剧模板",
  "canvas": {
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "subtitle": {
    "font": "SourceHanSansSC-Bold",
    "fontSize": 54,
    "primaryColor": "#FFFFFF",
    "outlineColor": "#000000",
    "outlineWidth": 4,
    "position": "bottom"
  },
  "effects": [
    {
      "type": "flash",
      "trigger": "beat",
      "duration": 0.08,
      "opacity": 0.7
    },
    {
      "type": "camera_punch",
      "trigger": "scene_turning_point",
      "duration": 0.18,
      "scale": 1.08
    }
  ]
}
```

### 6.3 特效资产库

建议建立可复用资产库：

```text
effects/
  flash/
  smoke/
  fire/
  sword_light/
  speed_lines/
  impact/
  particles/
stickers/
  emotion/
  title_cards/
  platform_style/
audio/
  hits/
  whoosh/
  risers/
  ambience/
fonts/
```

资产格式建议：

- 透明图片：PNG 序列。
- 透明视频：WebM alpha 或 ProRes 4444。
- 音效：WAV 或高质量 MP3。
- 字幕字体：本地字体文件，并记录许可证。

## 7. JSON 时间线设计

FFmpeg 不直接理解业务分镜，必须通过统一时间线描述。

建议时间线结构：

```json
{
  "version": 1,
  "canvas": {
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "tracks": [
    {
      "id": "video_main",
      "type": "video",
      "clips": []
    },
    {
      "id": "voice",
      "type": "audio",
      "clips": []
    },
    {
      "id": "subtitles",
      "type": "subtitle",
      "clips": []
    },
    {
      "id": "effects",
      "type": "effect",
      "clips": []
    }
  ],
  "output": {
    "path": "exports/episode_001.mp4",
    "codec": "h264",
    "quality": "high"
  }
}
```

单个 clip 示例：

```json
{
  "id": "shot_001",
  "type": "image",
  "source": "assets/shots/shot_001.png",
  "start": 0,
  "duration": 4.2,
  "transform": {
    "scaleFrom": 1.0,
    "scaleTo": 1.08,
    "x": "center",
    "y": "center"
  },
  "transitionOut": {
    "type": "fade",
    "duration": 0.25
  }
}
```

## 8. 最小可行版本

### 8.1 MVP 目标

第一版目标是完成一条可复跑的自动出片链路：

```text
分镜 JSON
  -> 输入图片/视频素材
  -> 输入 TTS 音频
  -> 输入字幕 SRT/ASS
  -> 输入模板 JSON
  -> 输出 9:16 MP4
```

MVP 必须完成：

- 图片转视频片段，支持推拉镜头。
- 视频片段拼接。
- 字幕烧录。
- BGM + 配音 + 音效混音。
- 透明贴纸/特效叠加。
- 基础转场：fade、flash、cut、zoom punch。
- 输出渲染日志和失败原因。

MVP 暂不要求：

- 完整 UI 时间线编辑器。
- 自动热门模板推荐。
- 自动生成所有特效素材。
- 多模型自动调度。
- 复杂关键帧曲线编辑。

### 8.2 MVP 输入输出

输入：

- `script.md`：剧本或分镜文本。
- `storyboard.json`：结构化分镜。
- `template.json`：视频包装模板。
- `assets/`：图片、视频、音频、贴纸、特效素材。

输出：

- `timeline.json`：最终渲染时间线。
- `subtitles.ass`：字幕文件。
- `render.log`：渲染日志。
- `episode.mp4`：成片。

## 9. 实施阶段

### 阶段一：FFmpeg 自动合成核心

目标：

- 建立 timeline JSON 到 FFmpeg filter graph 的转换能力。
- 支持单轨视频、字幕、BGM、配音、音效、贴纸。
- 输出稳定 MP4。

验收：

- 给定 5 个图片镜头、1 条 BGM、5 段配音、1 个字幕文件，可以生成一条完整竖屏视频。
- 输出视频无黑屏、无音频错位、无字幕明显越界。

### 阶段二：短视频模板库

目标：

- 建立模板 JSON 格式。
- 实现字幕样式、片头片尾、基础转场、节奏点特效。
- 建立第一批可复用特效素材目录。

验收：

- 同一批分镜可切换 2-3 套模板导出不同风格。
- 模板不需要改代码即可调整字幕、转场、音效和特效强度。

### 阶段三：AI 辅助时间线

目标：

- LLM 根据剧本和分镜生成镜头节奏建议。
- Whisper 生成字幕时间轴。
- librosa/Essentia 生成 BGM beat 点。
- AI 根据剧情节点选择模板特效。

验收：

- 生成的 timeline JSON 可以解释每个特效为什么出现。
- 人工可以在 UI 或 JSON 中删除、修改、禁用特效。

### 阶段四：开源视频生成接入

目标：

- 接入 ComfyUI / LTX / 其他开源视频模型作为素材生成后端。
- 统一输出图片、视频、透明素材引用。
- 支持失败重试和结果替换。

验收：

- 每个分镜可以选择已有素材或 AI 生成素材。
- 模型输出落盘后进入同一条 FFmpeg 时间线，不影响后续导出。

### 阶段五：批量生产与质量检查

目标：

- 支持多集批量出片。
- 支持基础质量检查：黑屏、静音、字幕越界、素材缺失、时长异常。
- 支持失败任务复跑。

验收：

- 10 集短视频可以连续导出。
- 单集失败不会阻断全部任务。
- 每集有可追踪日志、输入摘要和输出路径。

## 10. 与 MYStudio 现有融合方向

MYStudio 已经有“小说 -> Skill -> 剧本 -> 分镜 -> 剪辑 -> 配置”的生产方向，本计划应作为本地渲染与开源自动化出片能力补强。

建议融合点：

- 剧本板块：输出结构化分镜和对白。
- AI 校准：补充镜头语言、画面提示词、视频提示词、字幕节奏。
- 角色/场景板块：沉淀角色、场景、音色和视觉一致性信息。
- 导演/S 级板块：生成镜头图片或视频素材。
- 剪辑/导出板块：把分镜素材转成 timeline JSON，再由 FFmpeg 出片。
- 设置板块：配置 FFmpeg 路径、开源模型路径、TTS、ASR、字幕字体、模板库路径。

## 11. 风险与约束

### 11.1 效果风险

开源链路可以实现类似剪映的最终包装，但不会天然拥有剪映的热门模板和素材库。短期效果取决于模板库质量、音效库质量和素材质量。

缓解：

- 先做 3-5 套高频模板，不追求大而全。
- 每套模板用真实样片验收。
- 把常用特效做成可复用规则，而不是每次手工写 FFmpeg 命令。

### 11.2 许可证风险

开源代码、模型权重、字体、音效、贴纸、背景音乐的许可证不同，不能默认可商用。

缓解：

- 每个模型、字体、素材包记录来源和许可证。
- 导出项保留 dependency notice。
- 商用发布前做单独 license audit。

### 11.3 工程复杂度风险

FFmpeg filter graph 一旦复杂，调试成本会快速上升。

缓解：

- 不直接拼超长命令，优先生成 filter script 文件。
- 每个 clip、effect、audio mix 单独可测试。
- 每次渲染保留 timeline JSON、filter graph、日志和临时文件索引。

### 11.4 质量风险

自动生成的视频可能出现字幕遮挡、音频错位、黑帧、卡顿、画面拉伸。

缓解：

- 导出后做自动 QA。
- 检查视频时长、音频峰值、黑帧比例、字幕区域边界。
- 提供快速重渲染和局部替换能力。

## 12. 推荐优先级

优先级从高到低：

1. FFmpeg timeline JSON 渲染器。
2. 字幕、音频、贴纸、基础转场。
3. 模板 JSON 与模板库。
4. Whisper 字幕时间轴。
5. TTS 配音接入。
6. BGM 节奏点分析。
7. 开源视频生成接入。
8. 画质增强与补帧。
9. 批量任务队列与自动 QA。

不建议优先做：

- 完整剪辑器 UI。
- 全量复刻剪映模板生态。
- 同时接入过多视频模型。
- 过早做复杂粒子编辑器。

## 13. 最终目标形态

最终希望 MYStudio 形成如下能力：

```text
用户导入小说/剧本
  -> MYStudio 生成分镜、角色、场景、对白
  -> AI 生成图片/视频/配音/字幕
  -> 模板系统匹配短视频包装
  -> FFmpeg 自动合成
  -> 自动 QA
  -> 用户少量人工校正
  -> 批量导出成片
```

这条路线不会依赖剪映，但可以吸收剪映的产品经验：模板化、素材化、节奏化、低门槛。工程上应坚持可复跑、可替换、可审计，避免把关键生产链路绑死在闭源软件或单一商业平台上。

## 14. Pixelle-Video 调研补充

### 14.1 项目定位

Pixelle-Video 是一个开源 AI 自动短视频引擎，定位不是传统剪辑器，而是“输入主题或固定文案 -> 自动写文案 -> 生成配图/视频 -> 合成语音 -> 添加 BGM -> 一键合成视频”的流水线工具。

它对 MYStudio 的参考价值主要有三点：

- 证明“FFmpeg + AI + 模板”可以形成不依赖剪映的自动出片链路。
- 证明 HTML 模板可以作为短视频包装层，不需要用户进入完整剪辑器。
- 证明 ComfyUI 工作流可以作为图片、视频、TTS、分析能力的统一插件层。

### 14.2 Pixelle-Video 使用的主要技术

已从官方 GitHub README、`pyproject.toml`、配置示例和核心源码确认，Pixelle-Video 的主要技术如下：

| 层级 | 技术 | 用途 |
|------|------|------|
| 运行语言 | Python 3.11+ | 主服务、流水线、AI 编排、媒体处理 |
| Web UI | Streamlit | 本地 Web 操作界面，默认 8501 |
| API 服务 | FastAPI + Uvicorn | 可独立暴露视频生成 API，默认 8000 |
| LLM | OpenAI SDK compatible API | 支持通义千问、GPT、DeepSeek、Ollama 等兼容接口 |
| AI 工作流 | ComfyUI + ComfyKit | 调用本地或云端工作流，统一图像、视频、TTS、分析能力 |
| 云端工作流 | RunningHub | 作为 ComfyUI 工作流云端执行选项 |
| TTS | edge-tts + ComfyUI TTS workflow | 本地 Edge TTS 或 ComfyUI TTS，如 Index-TTS |
| 视频/图片生成 | ComfyUI workflows | `image_flux`、`image_qwen`、`image_nano_banana`、`video_wan2.1_fusionx` 等 |
| 模板系统 | HTML + CSS + Playwright Chromium | 把 HTML 模板渲染成图片帧或透明叠加层 |
| 媒体合成 | FFmpeg + ffmpeg-python + MoviePy | 拼接、配音合并、BGM、图片转视频、视频叠加 |
| 数据模型 | dataclass Storyboard/Frame/Config | 保存分镜、音频、图像、视频、片段路径和时长 |
| 任务隔离 | task_id + output 目录 | 每个任务独立目录，便于续跑、审计和调试 |
| 部署 | uv + Docker | Python 依赖管理、整合包和容器部署 |
| 浏览器自动化 | Playwright | 渲染 HTML 模板，要求 Chromium 和字体依赖 |

关键依赖包括：

- `fastmcp`
- `pydantic`
- `loguru`
- `pyyaml`
- `edge-tts`
- `ffmpeg-python`
- `httpx`
- `pillow`
- `streamlit`
- `openai`
- `fastapi`
- `uvicorn`
- `comfykit`
- `beautifulsoup4`
- `moviepy`
- `playwright`

### 14.3 Pixelle-Video 的核心流水线

Pixelle-Video 的标准流水线可以概括为：

```text
输入主题或固定文案
  -> LLM 生成标题
  -> LLM 生成或拆分 narration
  -> LLM 生成每段画面提示词
  -> 创建 Storyboard
  -> 逐帧处理
       -> TTS 生成音频
       -> ComfyUI 生成图片或视频
       -> HTML 模板合成标题/字幕/画面包装
       -> FFmpeg 生成单镜视频片段
  -> FFmpeg 拼接所有片段
  -> FFmpeg 添加 BGM
  -> 保存最终视频和历史记录
```

它的 `LinearVideoPipeline` 使用模板方法模式，把流程拆成固定生命周期：

```text
setup_environment
  -> generate_content
  -> determine_title
  -> plan_visuals
  -> initialize_storyboard
  -> produce_assets
  -> post_production
  -> finalize
```

这个设计很适合 MYStudio 参考。MYStudio 不一定要照搬 Python 后端，但可以吸收“固定生命周期 + 每一步可替换 provider + 统一上下文对象”的结构。

### 14.4 Pixelle-Video 的分镜数据模型

Pixelle-Video 的分镜模型很轻，但工程价值明确：

```text
StoryboardConfig
  -> media_width / media_height
  -> task_id
  -> narration 字数约束
  -> image_prompt 字数约束
  -> video_fps
  -> tts_inference_mode / voice_id / tts_workflow / ref_audio
  -> media_workflow
  -> frame_template / template_params

StoryboardFrame
  -> index
  -> narration
  -> image_prompt
  -> audio_path
  -> media_type
  -> image_path
  -> video_path
  -> composed_image_path
  -> video_segment_path
  -> duration

Storyboard
  -> title
  -> config
  -> frames
  -> final_video_path
  -> total_duration
```

对 MYStudio 的启发：

- 分镜不能只保存提示词，必须保存每一步产物路径。
- 每个镜头都要有 `audio_path`、`image_path/video_path`、`composed_path`、`segment_path`。
- `duration` 应优先来自 TTS 音频，视频生成时把音频时长作为目标时长传给视频工作流。
- 每个任务必须有独立 `task_id` 和输出目录，避免批量任务互相污染。

### 14.5 Pixelle-Video 的 HTML 模板策略

Pixelle-Video 没有把 HTML 当最终视频引擎，而是把 HTML 当“画面包装模板”：

- HTML/CSS 定义竖屏、横屏、方屏版式。
- 模板文件名区分类型：`static_*.html`、`image_*.html`、`video_*.html`。
- 模板目录区分尺寸：`1080x1920`、`1080x1080`、`1920x1080`。
- 模板内用 `{{title}}`、`{{text}}`、`{{author=...}}` 等占位符注入内容。
- 模板内用 meta 标记声明 AI 媒体生成尺寸，例如 `template:media-width`、`template:media-height`。
- Playwright Chromium 渲染 HTML，输出图片帧。
- 如果是图片模板，HTML 直接合成完整画面。
- 如果是视频模板，HTML 渲染成透明覆盖层，再用 FFmpeg overlay 到视频上。

这点需要修正我们前面的判断：HTML 不适合作为漫剧视频的全部主线，但非常适合作为“字幕卡、标题卡、包装层、台词层、模板预览层”。  
MYStudio 可以采用同样原则：HTML/React 只负责静态或半静态包装，不负责最终视频编辑；最终仍交给 FFmpeg。

### 14.6 Pixelle-Video 的 FFmpeg 使用方式

Pixelle-Video 的 `VideoService` 是轻量 FFmpeg 封装，支持：

- 检查系统是否安装 FFmpeg。
- 视频拼接：concat demuxer 或 concat filter。
- 获取视频和音频时长。
- 判断视频是否有音轨。
- 合并音频和视频。
- 音频替换或混音。
- 视频比音频短时冻结最后一帧补齐。
- 视频比音频长时裁剪。
- 透明图片覆盖视频。
- 图片 + 音频生成视频片段。
- 拼接后追加 BGM。

它的路线是“先逐镜生成 segment，再 concat 成片”。这比一开始就构造复杂多轨 filter graph 更容易落地，但表达能力有限。

对 MYStudio 的建议：

- MVP 可以先采用 Pixelle-Video 式逐镜 segment 方案，降低实现风险。
- 第二阶段再升级为 LTX-Desktop 式多轨 timeline/filter graph 方案，支持更复杂的轨道叠加和精细音频混音。
- 保留每个 segment 的中间产物，便于单镜重渲染。

### 14.7 Pixelle-Video 的 ComfyUI 工作流策略

Pixelle-Video 把 ComfyUI 工作流当成能力插件：

- `workflows/selfhost`：本地 ComfyUI 工作流。
- `workflows/runninghub`：RunningHub 云端工作流包装。
- `image_*.json`：图像生成工作流。
- `video_*.json`：视频生成工作流。
- `tts_*.json`：语音生成工作流。
- `analyse_*.json`：图片/视频分析工作流。

它通过统一 `MediaService` 扫描 `image_` 和 `video_` 前缀，通过 `TTSService` 扫描 `tts_` 前缀。  
这说明 MYStudio 的 provider 不必只按“模型名”组织，也可以按“工作流文件”组织。

建议 MYStudio 引入类似结构：

```text
workflows/
  selfhost/
    image_*.json
    video_*.json
    tts_*.json
    analyse_*.json
  cloud/
    runninghub_*.json
templates/
  1080x1920/
  1080x1080/
  1920x1080/
```

但需要注意：MYStudio 当前是 Electron/React 主体，不建议照搬 Pixelle 的 Streamlit/FastAPI 运行时。更合适的是吸收其工作流文件规范、任务目录规范和 HTML 模板规范。

### 14.8 Pixelle-Video 对 MYStudio 的可吸收设计

建议吸收：

1. **轻量自动短视频流水线**
   - 输入主题或固定文案。
   - 自动拆成 narration 段落。
   - 每段生成画面提示词、TTS、媒体和片段。

2. **任务目录隔离**
   - 每个任务有独立 `task_id`。
   - 每个镜头保存 audio、media、composed、segment。
   - 成片、日志、时间线、参数落在同一任务目录。

3. **HTML 模板作为包装层**
   - 用 HTML/CSS 做标题卡、字幕卡、竖屏包装。
   - 用 Playwright 渲染为 PNG 或透明 overlay。
   - 用 FFmpeg 合成到图片或视频上。

4. **模板命名规范**
   - `static_*.html`：纯文字/静态包装。
   - `image_*.html`：AI 图片驱动模板。
   - `video_*.html`：AI 视频驱动模板。
   - 尺寸按目录分组。

5. **ComfyUI 工作流插件**
   - selfhost 与 cloud 分开。
   - 按 `image_`、`video_`、`tts_`、`analyse_` 前缀分类。
   - UI 自动扫描可用工作流。

6. **TTS 时长驱动视频生成**
   - 先生成音频。
   - 读取音频时长。
   - 视频生成或图片成片按音频时长对齐。
   - 减少后期补帧、裁剪和黑屏。

7. **渐进式 FFmpeg 路线**
   - 先逐镜出 segment。
   - 再 concat 成片。
   - 复杂需求再进入多轨 timeline。

不建议照搬：

- 不建议照搬 Streamlit UI，MYStudio 已有 Electron/React 主体。
- 不建议照搬 FastAPI 常驻后端，除非后续确实需要远程队列或多人协作。
- 不建议只使用它的单镜 segment 方案作为最终架构，因为漫剧后期会需要多轨、音效密集叠加和局部重排。
- 不建议依赖 RunningHub 作为主链路，它可以作为可选云端工作流。

### 14.9 对本计划的修订结论

结合 Pixelle-Video，本计划应调整为“两级渲染架构”：

```text
一级：逐镜自动出片
  -> 参考 Pixelle-Video
  -> 每个分镜独立生成 audio/media/composed/segment
  -> FFmpeg concat 成片
  -> 适合 MVP 和批量口播/解说/轻漫剧

二级：多轨精剪出片
  -> 参考 LTX-Desktop
  -> 多轨 timeline + filter graph + audio mix
  -> 适合复杂漫剧、战斗、密集音效、叠加特效
```

MYStudio 的 MVP 应优先实现一级方案，因为它更容易验证、失败可重试、单镜可替换。  
等一级方案稳定后，再把同一批镜头、字幕、音频、特效映射到二级多轨 timeline。

### 14.10 调研来源

- Pixelle-Video GitHub: https://github.com/AIDC-AI/Pixelle-Video
- README: https://github.com/AIDC-AI/Pixelle-Video/blob/main/README.md
- `pyproject.toml`: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pyproject.toml
- `config.example.yaml`: https://github.com/AIDC-AI/Pixelle-Video/blob/main/config.example.yaml
- 标准流水线: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/pipelines/standard.py
- 线性流水线基类: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/pipelines/linear.py
- 分镜模型: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/models/storyboard.py
- HTML 模板渲染: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/services/frame_html.py
- 单帧处理器: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/services/frame_processor.py
- FFmpeg 视频服务: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/services/video.py
- ComfyUI 基础服务: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/services/comfy_base_service.py
- 媒体生成服务: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/services/media.py
- TTS 服务: https://github.com/AIDC-AI/Pixelle-Video/blob/main/pixelle_video/services/tts_service.py

## 15. 本地 Pixelle-Video 代码复核补充

本节基于本地代码目录 `/Users/zhengbingjin/Project/Github/Pixelle-Video` 复核。  
本地版本确认包含比前面 GitHub 抽样更完整的 Web pipeline、API、模板和工作流集合。

### 15.1 本地目录结构

本地项目主要目录：

```text
api/
  routers/
  schemas/
  tasks/
pixelle_video/
  config/
  models/
  pipelines/
  prompts/
  services/
  utils/
web/
  components/
  i18n/
  pages/
  pipelines/
  state/
  utils/
templates/
  1080x1080/
  1080x1920/
  1920x1080/
workflows/
  runninghub/
  selfhost/
bgm/
docs/
packaging/
resources/
```

对 MYStudio 的意义：

- `pixelle_video/` 是核心能力层，可以参考服务划分。
- `web/` 是 Streamlit 产品化 UI，可以参考交互流程，但不应照搬到 Electron。
- `api/` 提供了异步任务、资源发现、模板预览和生成接口，可以参考接口边界。
- `templates/` 和 `workflows/` 是最值得吸收的插件化资产结构。

### 15.2 本地模板资产

本地模板共覆盖三类尺寸：

- `1080x1920`：竖屏短视频主力尺寸，模板最多。
- `1920x1080`：横屏模板。
- `1080x1080`：方形模板。

本地竖屏模板包含：

```text
asset_default.html
image_blur_card.html
image_book.html
image_cartoon.html
image_default.html
image_elegant.html
image_excerpt.html
image_fashion_vintage.html
image_full.html
image_healing.html
image_health_preservation.html
image_life_insights.html
image_life_insights_light.html
image_long_text.html
image_modern.html
image_neon.html
image_psychology_card.html
image_purple.html
image_satirical_cartoon.html
image_simple_black.html
image_simple_line_drawing.html
static_default.html
static_excerpt.html
video_default.html
video_healing.html
```

这说明 Pixelle-Video 的“短视频风格”主要来自 HTML 模板，而不是来自复杂时间线。  
MYStudio 应优先做模板管理、模板预览、模板参数编辑，而不是先做完整剪辑器。

### 15.3 本地工作流资产

本地 `workflows/runninghub` 已包含：

```text
af_scail.json
analyse_image.json
digital_combination.json
digital_customize.json
digital_image.json
i2v_LTX2.json
image_Z-image.json
image_flux.json
image_flux2.json
image_qwen.json
image_qwen_chinese_cartoon.json
image_sd3.5.json
image_sdxl.json
tts_edge.json
tts_index2.json
tts_spark.json
video_Z_image_wan2.2.json
video_qwen_wan2.2.json
video_understanding.json
video_wan2.1_fusionx.json
video_wan2.2.json
```

本地 `workflows/selfhost` 已包含：

```text
analyse_image.json
analyse_video.json
image_flux.json
image_nano_banana.json
image_qwen.json
tts_edge.json
tts_index2.json
video_wan2.1_fusionx.json
```

值得吸收的命名规则：

- `image_`：图片生成。
- `video_`：视频生成。
- `i2v_`：图生视频。
- `tts_`：语音合成。
- `analyse_`：图像/视频理解。
- `digital_`：数字人相关流程。
- `af_`：动作迁移相关流程。

MYStudio 的供应商配置可以从“模型配置”升级为“能力工作流配置”：同一个能力允许多个 workflow，UI 自动扫描并呈现。

### 15.4 Web Pipeline 插件机制

本地 `web/pipelines/base.py` 定义了 `PipelineUI` 和注册表：

```text
PipelineUI
  -> name
  -> icon
  -> display_name
  -> description
  -> render(pixelle_video)

register_pipeline_ui()
get_pipeline_ui()
get_all_pipeline_uis()
```

`web/pages/1_🎬_Home.py` 通过 tab 渲染全部 pipeline。  
本地可见 pipeline 包括：

- `standard`：主题/固定文案自动视频。
- `asset_based`：基于用户素材的视频。
- `i2v`：图生视频。
- `digital_human`：数字人口播/商品口播。
- `action_transfer`：动作迁移。

对 MYStudio 的启发：

- 工作流入口应插件化，而不是把所有能力堆进一个页面。
- 每个 pipeline 应自带输入面板、参数面板、输出预览。
- UI pipeline 不应直接绑定具体模型，而应选择 workflow。

### 15.5 图生视频、数字人、动作迁移模块

本地代码确认 Pixelle-Video 已把通用自动短视频扩展到三个独立模块。

#### 图生视频

`web/pipelines/i2v.py` 的逻辑：

- 上传一张或多张图片。
- 输入提示词。
- 扫描 `i2v_*.json` workflow。
- 调用 ComfyKit 执行工作流。
- 下载返回视频到任务目录 `final.mp4`。

适合 MYStudio 吸收为“分镜图片 -> 单镜视频”的轻量能力。

#### 数字人

`web/pipelines/digital_human.py` 的逻辑：

- 上传人物图。
- 可上传商品图。
- 输入商品/口播文本。
- 支持 `digital` 与 `customize` 两种模式。
- 使用三段 workflow：`digital_image`、`digital_combination`、`digital_customize`。

适合 MYStudio 吸收为“角色口播/旁白/营销短视频”模块，但不应放在漫剧核心链路第一阶段。

#### 动作迁移

`web/pipelines/action_transfer.py` 的逻辑：

- 上传参考视频。
- 上传目标图片。
- 输入提示词。
- 扫描 `af_*.json` workflow。
- 读取参考视频时长，最多取 30 秒。
- 调用工作流生成动作迁移视频。

适合 MYStudio 后续做“角色动作参考 -> 漫剧角色动态化”，但 MVP 不建议优先实现，因为质量和一致性依赖模型能力。

### 15.6 API 设计可借鉴点

本地 `api/routers/video.py` 提供：

- `/video/generate/sync`：同步生成。
- `/video/generate/async`：异步生成，返回 task_id。

本地 `api/routers/tasks.py` 提供：

- 列出任务。
- 查询任务。
- 取消任务。

本地 `api/routers/resources.py` 提供：

- 列出 TTS workflows。
- 列出 media workflows。
- 列出 image workflows。
- 列出 templates。
- 列出 BGM。

本地 `api/routers/frame.py` 提供：

- 渲染单帧预览。
- 解析模板自定义参数。

这些 API 边界对 MYStudio 很有用。即使 MYStudio 不引入 FastAPI，也应在 Electron IPC 层形成类似能力：

```text
studio:list-workflows
studio:list-templates
studio:get-template-params
studio:render-template-preview
studio:create-generation-task
studio:get-generation-task
studio:cancel-generation-task
studio:render-segment
studio:merge-episode
```

### 15.7 任务管理设计

本地 `api/tasks/manager.py` 是内存任务管理器：

- 使用 UUID 作为 API task id。
- 保存任务状态：pending、running、completed、failed、cancelled。
- 支持异步执行、进度更新、取消。
- 定时清理旧任务。
- 当前是内存存储，注释中明确后续可替换 Redis。

MYStudio 建议不要只用内存任务。桌面项目更适合：

- 内存保存运行态。
- 磁盘保存任务记录、输入参数、输出路径和日志。
- 应用重启后可恢复已完成和失败任务。
- 正在运行任务重启后标记为 interrupted，不假装继续成功。

### 15.8 资源覆盖机制

本地 `pixelle_video/utils/os_util.py` 和 `template_util.py` 显示 Pixelle-Video 支持默认资源与用户资源合并：

- 默认资源来自项目内 `templates/`、`workflows/`、`bgm/`。
- 自定义资源来自 `data/templates/`、`data/workflows/`、`data/bgm/`。
- 列表接口会合并默认和自定义资源。
- 自定义资源可以覆盖默认同名文件。

这个设计非常适合 MYStudio：

```text
app-resources/
  templates/
  workflows/
  bgm/
  effects/
user-data/
  templates/
  workflows/
  bgm/
  effects/
project/
  templates/
  workflows/
  bgm/
  effects/
```

建议优先级：

```text
project > user-data > app-resources
```

这样既能提供内置模板，又允许用户和项目覆盖，不需要改代码。

### 15.9 模板参数发现

本地 `frame_html.py` 支持从 HTML 中解析参数：

```text
{{param}}
{{param=value}}
{{param:type}}
{{param:type=value}}
```

支持类型：

- `text`
- `number`
- `color`
- `bool`

本地 `api/routers/frame.py` 暴露 `/frame/template/params`，用于读取模板参数和 media 尺寸。  
MYStudio 应吸收这个机制，让模板作者只写 HTML，UI 自动生成参数面板。

建议 MYStudio 模板参数扩展：

```text
text
number
color
bool
select
image
audio
font
position
```

第一阶段先实现 Pixelle-Video 的四种基础类型。

### 15.10 对 MYStudio 计划的进一步修订

结合本地代码复核，MYStudio 的实施顺序建议调整为：

1. **资源发现与模板预览**
   - 扫描 templates/workflows/bgm/effects。
   - 支持默认、用户、项目三层覆盖。
   - 支持 HTML 模板参数解析和单帧预览。

2. **逐镜 segment 渲染**
   - 每个分镜生成独立任务目录。
   - 保存 audio/media/composed/segment。
   - 支持图片模板、视频模板、静态模板三类。

3. **工作流插件接入**
   - 先接 ComfyUI selfhost。
   - 再接 RunningHub 或其他云端工作流。
   - 按 `image_`、`video_`、`i2v_`、`tts_`、`analyse_`、`af_`、`digital_` 分类。

4. **任务系统**
   - 支持 queued/running/succeeded/failed/cancelled/interrupted。
   - 任务信息落盘。
   - 支持失败重试和单镜重跑。

5. **整集拼接**
   - 先 concat segment。
   - 再添加 BGM。
   - 再做基础 QA。

6. **多轨精剪**
   - 在逐镜方案稳定后再做。
   - 引入更完整 timeline/filter graph/audio mix。

这比直接做完整多轨编辑器更稳，也更符合“AI 漫剧短视频自动化”的目标。

## 16. 映射到 MYStudio 当前代码

本节基于 `/Users/zhengbingjin/Project/Github/MYStudio` 当前代码复核。

### 16.1 当前已有基础

MYStudio 当前已经具备最小闭环：

- `src/types/studio.ts` 已定义 `StoryboardItem`、`ProductionTrack`、`VideoCandidate`、`TrackRenderPlan`、`EpisodeMergePlan`。
- `src/lib/studio/production.ts` 已能把分镜按 `trackKey` 分组，生成 track render plan 和 episode merge plan。
- `src/stores/studio-store.ts` 已保存小说章节、Agent 工作数据、分镜、production tracks、video candidates。
- `src/components/panels/studio/index.tsx` 已有小说、Skill、剧本、分镜、剪辑、配置六个 tab。
- `src/electron/main.ts` 已有 `studio-render-track-candidate`、`studio-save-material`、`studio-merge-episode` 三个 IPC。
- 当前 FFmpeg renderer 已能把图片或视频素材转为片段、烧录简单字幕、拼接成片。

也就是说，MYStudio 不需要从零开始。Pixelle-Video 的能力应作为现有 Studio 工作流的增强，而不是另起一个独立系统。

### 16.2 当前 FFmpeg Renderer 的限制

当前 `src/electron/main.ts` 的 renderer 仍是最小实现：

- 输出分辨率硬编码为 `1920x1080`，不适合竖屏漫剧主场景。
- 图片转视频只是静帧，尚未实现推拉镜头、缩放、平移。
- 字幕只支持单条 SRT 和固定样式。
- 没有 HTML 模板包装层。
- 没有 TTS 音频输入，当前用 `anullsrc` 生成静音音轨。
- 没有 BGM 和音效混音。
- 没有透明贴纸/特效 overlay。
- 没有逐镜任务目录，临时目录会在渲染后删除。
- 没有模板参数、工作流、BGM、特效资源扫描。
- 没有任务状态落盘和中断恢复。

这些限制正好对应 Pixelle-Video 可借鉴的部分。

### 16.3 当前数据模型需要扩展的字段

`StoryboardItem` 当前字段偏少：

```text
id
episodeId
index
trackKey
trackId
duration
prompt
videoDesc
assetIds
mediaRef
state
reason
```

建议新增或演进：

```text
narration
dialogue
subtitleText
imagePrompt
videoPrompt
audioPath
ttsWorkflow
mediaWorkflow
templateKey
templateParams
composedImagePath
segmentPath
renderTaskId
renderLogPath
```

`TrackRenderPlan` 当前只有 source input 和 subtitleText。建议演进为：

```text
TrackRenderPlan
  -> canvas width/height/fps
  -> templateKey/templateParams
  -> inputs[]
       -> source image/video
       -> audioPath
       -> duration
       -> subtitleText
       -> effects[]
  -> bgmPath
  -> outputProfile
```

但不要一次性大改。第一阶段可以新增一个并行的 `SegmentRenderPlan`，保持旧 plan 兼容。

### 16.4 建议新增能力域

建议在 MYStudio 中新增以下能力域：

```text
src/lib/studio/resources.ts
  -> 扫描模板、工作流、BGM、特效资源

src/lib/studio/template.ts
  -> 解析 HTML 模板尺寸、参数、类型

src/lib/studio/segment-plan.ts
  -> 分镜到单镜渲染计划

src/lib/studio/task.ts
  -> 任务状态、任务目录、任务持久化模型

src/electron/studio-render/
  -> ffmpeg.ts
  -> template-renderer.ts
  -> segment-renderer.ts
  -> episode-renderer.ts
  -> resource-discovery.ts
```

当前 `src/electron/main.ts` 已经很长，后续不建议继续把复杂 FFmpeg、模板、任务逻辑堆进去。  
应逐步拆出 Electron 侧 studio-render 模块，同时保持 IPC 名称兼容。

### 16.5 建议新增 IPC

参考 Pixelle-Video API，但映射成 Electron IPC：

```text
studio-list-resources
studio-list-workflows
studio-list-templates
studio-get-template-params
studio-render-template-preview
studio-create-render-task
studio-get-render-task
studio-cancel-render-task
studio-render-segment
studio-render-episode
```

保留当前已有：

```text
studio-render-track-candidate
studio-save-material
studio-merge-episode
```

迁移策略：

- 老 IPC 继续用于当前剪辑 tab。
- 新 IPC 先服务模板预览和逐镜 segment。
- 等新链路稳定后，老 IPC 内部可以调用新 renderer。

### 16.6 与 Pixelle-Video 的融合优先级

结合 MYStudio 当前代码，优先级应调整为：

1. **竖屏输出支持**
   - 先让当前 FFmpeg renderer 支持 `1080x1920`。
   - 不继续硬编码 `1920x1080`。

2. **资源扫描**
   - 加入 templates/workflows/bgm/effects 资源发现。
   - 支持内置、用户、项目三层覆盖。

3. **HTML 模板预览**
   - 使用 Playwright 或 Electron BrowserWindow 截图。
   - 解析 `{{param:type=default}}`。
   - 输出 PNG 预览。

4. **逐镜 segment 渲染**
   - 对齐 Pixelle-Video：audio/media/composed/segment。
   - 每个镜头保留中间产物。

5. **TTS 与音频时长**
   - 先支持导入音频。
   - 再接 TTS workflow。
   - 用音频时长驱动画面时长。

6. **BGM/音效/贴纸**
   - 增加基础混音。
   - 增加透明 overlay。
   - 增加模板化特效。

7. **ComfyUI workflow 接入**
   - 首先支持自托管 ComfyUI。
   - RunningHub 可作为可选云端。

8. **多轨 timeline**
   - 最后再做 LTX-Desktop 式复杂 timeline/filter graph。

### 16.7 最小实施闭环

建议第一个实际里程碑不要做大而全，只做下面这个闭环：

```text
选择一个 1080x1920 HTML 模板
  -> 解析模板参数
  -> 上传一张图片
  -> 上传一段音频
  -> 输入字幕
  -> 渲染 HTML 包装图
  -> FFmpeg 生成一个单镜 segment.mp4
  -> 多个 segment concat 成 episode.mp4
```

这个闭环一旦成功，就已经覆盖：

- 模板系统。
- 音频时长驱动画面。
- 字幕/包装。
- 单镜复跑。
- 成片拼接。

之后再把图片/音频来源替换成 AI 生成即可，不需要先解决所有 AI 模型问题。
