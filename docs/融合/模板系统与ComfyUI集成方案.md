# 模板系统与ComfyUI集成方案

> **版本**: v1.0.0  
> **最后更新**: 2026-05-27  
> **状态**: 草案  
> **目标读者**: 前端/后端开发人员、模板设计者

---

## 1. 文档目的与范围

### 1.1 定位

本文档是 MYStudio 融合项目中**模板系统与 ComfyUI 工作流集成**的权威技术方案，涵盖：

- 模板四层分层体系与 MYStudio 各板块的对接点
- JSON 模板与 HTML 模板的文件规范、参数类型、占位符语法
- 三层资源覆盖机制的设计与实现
- 模板预览、参数自动发现、单帧渲染的工程方案
- 特效资产库的目录结构与许可证管理
- ComfyUI 工作流的集成架构、参数映射、错误处理
- 模板与工作流相关 UI 面板的交互规范
- 与 MYStudio 现有代码的对接路径

### 1.2 参考来源

本文档核心技术决策参考自 Pixelle-Video 开源项目（GitHub: AIDC-AI/Pixelle-Video）的以下设计：

- HTML 模板作为画面包装层（非视频编辑引擎）
- ComfyUI 工作流作为能力插件（按文件前缀分类）
- 三层资源覆盖机制（默认 / 用户 / 项目）
- 模板参数从 HTML 占位符自动发现

### 1.3 与其他文档的关系

| 文档 | 关系 |
|------|------|
| `数据模型与接口规范.md` | 本文档涉及的 IPC 通道和数据结构以该文档为准 |
| `FFmpeg_AI开源漫剧短视频自动化计划.md` | 本文档是第6/14/15节的落地实施方案 |
| `配置中心升级与供应商能力方案.md` | ComfyUI 连接配置复用配置中心体系 |

---

## 2. 模板系统架构

### 2.1 四层模板分层

模板按粒度从大到小分为四层，每层定义不同维度的视频样式参数：

```text
项目模板 (Project Template)
  └─ 定义：画幅尺寸、整体风格、默认字体、默认 BGM、片头片尾包装
  └─ 作用域：整个项目生命周期
  └─ 示例：竖屏快节奏漫剧、横屏电影感叙事、方形口播

剧集模板 (Episode Template)
  └─ 定义：单集结构、开场钩子样式、结尾悬念模板、字幕节奏、转场默认值
  └─ 作用域：单集所有镜头
  └─ 示例：悬疑开场、热血战斗集、日常过渡

镜头模板 (Shot Template)
  └─ 定义：镜头内推拉方式、字幕位置、贴纸布局、转场类型、音效触发
  └─ 作用域：单个分镜
  └─ 示例：左推近景、底部字幕、闪白转场

特效模板 (Effect Template)
  └─ 定义：闪白参数、震屏参数、速度线、烟尘、剑气、爆点等具体效果
  └─ 作用域：单个效果叠加层
  └─ 示例：短闪白(0.08s)、中度震屏(scale 1.08)、横向速度线
```

层间关系：

```text
项目模板
  └─ 包含 1..N 个剧集模板
       └─ 包含 1..N 个镜头模板
            └─ 引用 0..N 个特效模板
```

上层参数作为下层默认值，下层可覆盖上层。例如项目模板定义 `subtitle.fontSize: 54`，镜头模板可覆盖为 `subtitle.fontSize: 36`。

### 2.2 模板与 MYStudio 工作流的对接点

模板在 MYStudio 四个核心板块中各有关键作用：

```text
┌─────────────────────────────────────────────────────┐
│                    MYStudio 工作流                     │
├──────────┬──────────┬──────────┬──────────┬──────────┤
│ 剧本板块  │ 导演板块  │ 剪辑板块  │ 设置板块  │ 导出板块  │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│输出结构化 │生成镜头图片│模板应用到 │配置模板库 │应用输出   │
│分镜和对白 │或视频素材  │timeline  │路径和资源 │codec参数  │
│          │          │  JSON    │覆盖优先级 │quality   │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

各板块对接细节：

| 板块 | 模板对接方式 | 涉及模板层 |
|------|-------------|-----------|
| **剧本板块** | 输出结构化分镜时，每条分镜携带 `templateKey` 和 `templateParams`，引用镜头模板 | 镜像模板 |
| **导演/S级板块** | 生成镜头图片或视频素材时，读取镜头模板的画幅和媒体尺寸；图片/视频生成完成后应用 HTML 模板包装 | 镜像模板 + 特效模板 |
| **剪辑/导出板块** | 将模板参数应用到 timeline JSON 的 clip 级别，控制字幕样式、转场、特效叠加 | 全部四层 |
| **设置板块** | 配置模板库路径、三层资源覆盖优先级、默认项目模板 | 项目模板 |

---

## 3. 模板文件规范

### 3.1 JSON 模板格式

JSON 模板用于定义视频合成的结构化参数，供 FFmpeg 渲染管线直接读取。

**顶层结构**：

```json
{
  "id": "模板唯一标识",
  "name": "显示名称",
  "version": "语义版本号",
  "canvas": { },
  "subtitle": { },
  "effects": [ ],
  "output": { }
}
```

**canvas（画布配置）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| width | number | 是 | 1080 | 画布宽度(px) |
| height | number | 是 | 1920 | 画布高度(px) |
| fps | number | 是 | 30 | 帧率 |
| backgroundColor | string | 否 | "#000000" | 背景颜色 |

**subtitle（字幕配置）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| font | string | 是 | - | 字体名称，需在字体库中存在 |
| fontSize | number | 是 | 54 | 字号(px) |
| primaryColor | string | 否 | "#FFFFFF" | 主颜色 |
| outlineColor | string | 否 | "#000000" | 描边颜色 |
| outlineWidth | number | 否 | 4 | 描边宽度(px) |
| position | string | 否 | "bottom" | 位置：top/center/bottom |
| maxLines | number | 否 | 2 | 单屏最大行数 |
| lineSpacing | number | 否 | 8 | 行间距(px) |

**effects（特效列表）**：

每个特效对象包含：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | 特效类型：flash/camera_punch/shake/speed_lines/smoke等 |
| trigger | string | 是 | 触发条件：beat/scene_turning_point/dialogue_end/custom |
| duration | number | 是 | 持续时间(秒) |
| opacity | number | 否 | 透明度(0-1)，用于 flash 等 |
| scale | number | 否 | 缩放系数，用于 camera_punch |
| intensity | string | 否 | 强度：light/medium/heavy |
| assetPath | string | 否 | 自定义资产路径（覆盖默认资产） |

**output（输出配置）**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| codec | string | 否 | "h264" | 编码器：h264/h265/prores |
| quality | string | 否 | "high" | 质量：low/medium/high/ultra |
| pixelFormat | string | 否 | "yuv420p" | 像素格式 |
| bitrate | string | 否 | auto | 比特率，如 "8M" |

### 3.2 完整 JSON 模板示例

竖屏快节奏漫剧模板：

```json
{
  "id": "vertical_drama_fast_cut_v1",
  "name": "竖屏快节奏漫剧模板",
  "version": "1.0.0",
  "canvas": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "backgroundColor": "#000000"
  },
  "subtitle": {
    "font": "SourceHanSansSC-Bold",
    "fontSize": 54,
    "primaryColor": "#FFFFFF",
    "outlineColor": "#000000",
    "outlineWidth": 4,
    "position": "bottom",
    "maxLines": 2,
    "lineSpacing": 8
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
    },
    {
      "type": "shake",
      "trigger": "impact",
      "duration": 0.12,
      "intensity": "medium"
    },
    {
      "type": "speed_lines",
      "trigger": "custom",
      "duration": 0.3,
      "assetPath": "effects/speed_lines/horizontal_white.png"
    }
  ],
  "output": {
    "codec": "h264",
    "quality": "high",
    "pixelFormat": "yuv420p"
  }
}
```

### 3.3 HTML 模板格式

HTML 模板用于定义画面包装层（字幕卡、标题卡、竖屏包装、透明覆盖层）。参考 Pixelle-Video 设计，HTML 模板不做最终视频编辑，只负责静态或半静态包装，最终合成交给 FFmpeg。

#### 3.3.1 文件命名前缀分类

| 前缀 | 含义 | 渲染方式 |
|------|------|---------|
| `static_*` | 纯文字/静态包装 | 直接渲染为完整画面帧 |
| `image_*` | AI 图片驱动模板 | 图片嵌入 HTML，渲染为完整画面帧 |
| `video_*` | AI 视频驱动模板 | HTML 渲染为透明覆盖层(overlay)，FFmpeg 叠加到视频上 |

#### 3.3.2 尺寸按目录分组

```text
templates/
  1080x1920/          # 竖屏（漫剧主尺寸）
    static_default.html
    image_cartoon.html
    video_default.html
    ...
  1080x1080/          # 方形（社交媒体封面、口播）
    static_excerpt.html
    image_fashion_vintage.html
    ...
  1920x1080/          # 横屏（电影感、PC端）
    static_default.html
    image_elegant.html
    video_healing.html
    ...
```

#### 3.3.3 模板内占位符语法

模板 HTML 文件中使用双花括号占位符声明可注入参数：

| 语法 | 含义 | 示例 |
|------|------|------|
| `{{param}}` | 无类型无默认值，默认为 text | `{{title}}` |
| `{{param=value}}` | 有默认值的 text 类型 | `{{author=匿名}}` |
| `{{param:type}}` | 指定类型，无默认值 | `{{bgColor=color}}` |
| `{{param:type=value}}` | 指定类型和默认值 | `{{fontSize:number=54}}` |

占位符在 HTML 中的使用示例：

```html
<!DOCTYPE html>
<html>
<head>
  <meta name="template:media-width" content="1080">
  <meta name="template:media-height" content="1920">
  <style>
    .container {
      width: 1080px;
      height: 1920px;
      position: relative;
      background: {{bgColor=color=#1a1a2e}};
      font-family: {{fontFamily=text=SourceHanSansSC-Bold}};
    }
    .title {
      font-size: {{titleSize:number=72}}px;
      color: {{titleColor=color=#FFFFFF}};
      text-align: center;
    }
    .subtitle {
      font-size: {{subSize:number=36}}px;
      color: {{subColor=color=#CCCCCC}};
    }
    .narration {
      font-size: {{textSize:number=42}}px;
      color: {{textColor=color=#FFFFFF}};
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="title">{{title}}</div>
    <div class="subtitle">{{subtitle=}}</div>
    <div class="narration">{{text}}</div>
    <div class="author">{{author=匿名}}</div>
  </div>
</body>
</html>
```

`meta[name=template:media-width]` 和 `meta[name=template:media-height]` 声明 AI 媒体生成的目标尺寸，供 ComfyUI 工作流读取。

### 3.4 模板参数类型

#### 3.4.1 基础 4 种（参考 Pixelle-Video）

| 类型 | UI 控件 | 解析规则 | 示例 |
|------|---------|---------|------|
| text | 文本输入框 | 直接替换为字符串 | `{{title}}` |
| number | 数字输入框 | 替换为数字字符串，支持 min/max 约束 | `{{fontSize:number=54}}` |
| color | 颜色选择器 | 替换为 CSS 颜色值 | `{{bgColor=color=#000000}}` |
| bool | 开关/复选框 | true 替换为 "true"，false 替换为 "false" | `{{showBorder:bool=true}}` |

#### 3.4.2 MYStudio 扩展 5 种

| 类型 | UI 控件 | 用途 | 示例 |
|------|---------|------|------|
| select | 下拉选择器 | 枚举选项 | `{{style:select=modern\|classic\|minimal}}` |
| image | 图片上传+预览 | 替换为图片 URL 或 base64 | `{{background:image}}` |
| audio | 音频上传+预览 | 替换为音频文件路径 | `{{bgm:audio}}` |
| font | 字体选择器 | 从字体库选择，替换为字体名 | `{{titleFont:font=SourceHanSansSC-Bold}}` |
| position | 坐标点选择器 | 拖拽定位，替换为 CSS 坐标 | `{{logoPos:position=center-top}}` |

> **实施建议**：第一阶段先实现基础 4 种类型，确保模板参数自动发现和 UI 面板生成正常工作。扩展 5 种在第二阶段逐步加入。

---

## 4. 三层资源覆盖机制

### 4.1 设计背景

参考 Pixelle-Video 的默认资源与用户资源合并机制，MYStudio 设计三层资源目录，实现"应用内置、用户全局、项目专属"三级覆盖，无需改代码即可替换任何资源。

### 4.2 三层目录结构

```text
app-resources/                    # 应用内置（随应用分发，只读）
  templates/
    1080x1920/
    1080x1080/
    1920x1080/
  workflows/
    selfhost/
    cloud/
  bgm/
  effects/
  fonts/

user-data/                        # 用户全局（跨项目共享，读写）
  templates/
    1080x1920/
    1080x1080/
    1920x1080/
  workflows/
    selfhost/
    cloud/
  bgm/
  effects/
  fonts/

project/                          # 项目级（单项目专属，读写）
  templates/
    1080x1920/
    1080x1080/
    1920x1080/
  workflows/
    selfhost/
    cloud/
  bgm/
  effects/
  fonts/
```

### 4.3 覆盖优先级

```text
project/  >  user-data/  >  app-resources/
  (最高)                        (最低)
```

含义：

- 当三层中存在**同名文件**时，高优先级层覆盖低优先级层
- 当高优先级层**不存在**某文件时，自动降级使用低优先级层的文件
- 资源**列表合并**时，先收集所有层的文件，然后按优先级去重

### 4.4 资源发现扫描实现

资源扫描函数位于 `src/lib/studio/resources.ts`，核心逻辑：

```typescript
// 伪代码：三层资源发现
interface ResourceEntry {
  name: string;           // 文件名（含相对路径）
  fullPath: string;       // 完整绝对路径
  source: 'app' | 'user' | 'project';  // 来源层
  priority: number;       // 0=最高(project), 1=user, 2=app
}

function discoverResources(
  subDir: string,         // 如 "templates/1080x1920"
  appDir: string,         // app-resources 绝对路径
  userDir: string,        // user-data 绝对路径
  projectDir: string      // project 绝对路径
): ResourceEntry[] {
  const layers = [
    { base: projectDir, source: 'project', priority: 0 },
    { base: userDir,    source: 'user',    priority: 1 },
    { base: appDir,     source: 'app',     priority: 2 },
  ];

  const map = new Map<string, ResourceEntry>();

  // 从低优先级到高优先级扫描，高优先级覆盖
  for (const layer of layers.reverse()) {
    const targetDir = path.join(layer.base, subDir);
    if (!fs.existsSync(targetDir)) continue;

    // 递归扫描目录下所有文件
    const files = recursiveScan(targetDir);
    for (const file of files) {
      const relativePath = path.relative(targetDir, file);
      map.set(relativePath, {
        name: relativePath,
        fullPath: file,
        source: layer.source,
        priority: layer.priority,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
```

### 4.5 列表接口合并逻辑

不同资源类型的列表合并规则：

| 资源类型 | 合并方式 | 说明 |
|---------|---------|------|
| templates | 按相对路径去重 | `image_cartoon.html` 在三层都存在时只返回 project 层的 |
| workflows | 按文件名去重 | `image_flux.json` 在 selfhost/cloud 各目录分别扫描 |
| bgm | 按文件名去重 | 同名 BGM 高优先级覆盖 |
| effects | 按资产相对路径去重 | `flash/white_0.08.png` 同名覆盖 |
| fonts | 按字体名去重 | 同名字体高优先级覆盖 |

列表返回时每个条目携带 `source` 标识，UI 可显示来源（内置/用户/项目），帮助用户理解覆盖关系。

---

## 5. 模板预览实现

### 5.1 HTML 模板预览方案

HTML 模板预览需要将 HTML 渲染为图片。两种可行方案：

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **Playwright 截图** | 无需额外窗口、支持无头模式、API 成熟 | 需要安装 Chromium (~200MB) | 后台批量预览、CI 环境 |
| **Electron BrowserWindow 离屏渲染** | 已在 Electron 进程内、无需额外依赖 | 需要 Electron 环境 | 实时预览、开发调试 |

**推荐方案**：主链路使用 Electron BrowserWindow 离屏渲染（因为 MYStudio 本身就是 Electron 应用），CLI / CI 场景降级为 Playwright。

#### Electron BrowserWindow 离屏渲染实现

```typescript
// 伪代码：src/electron/studio-render/template-renderer.ts
async function renderTemplatePreview(
  htmlPath: string,
  params: Record<string, string>,
  outputPath: string,
  width: number,
  height: number
): Promise<string> {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: { offscreen: true },
  });

  // 将 params 注入 HTML 占位符
  let html = fs.readFileSync(htmlPath, 'utf-8');
  for (const [key, value] of Object.entries(params)) {
    // 匹配 {{key}}、{{key=default}}、{{key:type}}、{{key:type=default}}
    html = html.replace(
      new RegExp(`\\{\\{${key}(?::[^=}]*)?(?:=[^}]*)?\\}\\}`, 'g'),
      value
    );
  }

  // 加载并等待渲染完成
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise(r => setTimeout(r, 500)); // 等待字体和资源加载

  // 截图保存
  const image = await win.webContents.capturePage();
  fs.writeFileSync(outputPath, image.toPNG());
  win.close();

  return outputPath;
}
```

### 5.2 模板参数自动生成 UI 面板

从 HTML 模板解析 `{{param}}` 占位符，自动生成参数编辑表单。

**参数解析逻辑**（位于 `src/lib/studio/template.ts`）：

```typescript
// 伪代码：从 HTML 解析参数定义
interface TemplateParam {
  name: string;
  type: 'text' | 'number' | 'color' | 'bool'
       | 'select' | 'image' | 'audio' | 'font' | 'position';
  defaultValue?: string;
  options?: string[];    // select 类型的选项列表
}

function parseTemplateParams(html: string): TemplateParam[] {
  const regex = /\{\{(\w+)(?::(\w+))?(?:=([^}]*))?\}\}/g;
  const params: TemplateParam[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = regex.exec(html)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const type = (match[2] as TemplateParam['type']) || 'text';
    const defaultValue = match[3];

    params.push({ name, type, defaultValue });
  }

  return params;
}
```

**UI 面板自动生成**：

前端根据 `TemplateParam[]` 自动渲染对应的输入控件：

| type | 渲染控件 | 默认值处理 |
|------|---------|-----------|
| text | `<input type="text">` | 使用 defaultValue 或空字符串 |
| number | `<input type="number">` | 使用 defaultValue 或 0 |
| color | `<input type="color">` | 使用 defaultValue 或 "#000000" |
| bool | `<Switch>` | 使用 defaultValue === "true" |
| select | `<Select>` | 选项来自 options 数组 |
| image | 图片上传组件 | 无默认值 |
| audio | 音频上传组件 | 无默认值 |
| font | 字体选择器（从字体库读取列表） | 使用 defaultValue |
| position | 拖拽定位组件 | 使用 defaultValue 或 "center" |

### 5.3 单帧预览渲染流程

完整的模板预览流程：

```text
用户在模板选择面板点击模板
  ↓
前端调用 IPC: studio-get-template-params
  ↓
主进程读取 HTML 文件 → parseTemplateParams() → 返回参数列表
  ↓
前端自动渲染参数编辑表单（使用默认值填充）
  ↓
用户修改参数 → 前端防抖 300ms → IPC: studio-render-template-preview
  ↓
主进程 renderTemplatePreview() → 替换占位符 → BrowserWindow 离屏渲染 → 截图
  ↓
返回截图路径 → 前端显示预览图
```

---

## 6. 特效资产库规范

### 6.1 目录结构

```text
effects/
  flash/                    # 闪白效果
    white_light.png         # 白色闪光叠加层
    golden_flash.png        # 金色闪光
    ...
  smoke/                    # 烟尘效果
    smoke_rise_01.png       # 上升烟雾（PNG序列帧或静态）
    smoke_burst_01.webm     # 爆发烟雾（透明视频）
    ...
  fire/                     # 火焰效果
  sword_light/              # 剑气/刀光效果
  speed_lines/              # 速度线效果
  impact/                   # 冲击波/碰撞效果
  particles/                # 粒子效果（散落、飘散）
stickers/
  emotion/                  # 情绪贴纸（汗滴、怒火、惊叹号等）
  title_cards/              # 标题卡装饰元素
  platform_style/           # 平台风格装饰（TikTok风格、抖音风格等）
audio/
  hits/                     # 打击音效
  whoosh/                   # 嗖嗖/飞行音效
  risers/                   # 上升音效（紧张铺垫）
  ambience/                 # 环境音
  bgm/                      # 背景音乐
fonts/                      # 字体文件
  SourceHanSansSC-Bold.ttf
  ...
```

### 6.2 资产格式要求

| 资产类型 | 推荐格式 | 说明 |
|---------|---------|------|
| 透明图片叠加 | PNG（带 alpha 通道）或 PNG 序列帧 | 用于 flash、smoke、speed_lines 等静态或序列效果 |
| 透明视频叠加 | WebM (VP8/VP9 alpha) 或 ProRes 4444 | 用于动态烟雾、火焰、粒子等 |
| 音效 | WAV (无损) 或 MP3 (高质量 320kbps) | WAV 用于短音效，MP3 用于 BGM |
| 字体 | TTF / OTF / WOFF2 | 必须记录许可证信息 |

资产命名规范：

```text
{类别}_{描述}_{变体编号}.{扩展名}

示例：
flash_white_light_01.png
smoke_rise_slow_01.webm
audio_hits_heavy_01.wav
```

### 6.3 许可证记录格式

每个资产目录必须包含 `LICENSE.md` 文件，记录所有资产的版权信息：

```markdown
# [目录名] 资产许可证

## 资产列表

| 文件名 | 来源 | 许可证 | 作者 | 备注 |
|--------|------|--------|------|------|
| white_light.png | self-made | CC0 | 张三 | 自制，无限制 |
| smoke_rise_01.webm | pixabay.com | Pixabay License | - | 免费商用 |
| fire_burst_02.png | purchased | Commercial License | 素材商店A | 已购买商用授权 |

## 使用限制

- [ ] 仅限本项目内部使用
- [x] 可用于所有 MYStudio 用户项目
- [ ] 需要额外署名
```

---

## 7. ComfyUI 工作流集成

### 7.1 架构概览

MYStudio 支持两种 ComfyUI 执行模式：

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| **自托管 (Self-Host)** | 用户本地运行 ComfyUI 服务 | 开发调试、隐私敏感、无网络依赖 |
| **云端 (Cloud)** | 通过 RunningHub 等云端平台执行工作流 | 无 GPU 设备、批量任务、需要高端模型 |

架构分层：

```text
┌─────────────────────────────────────────────┐
│                MYStudio UI 层                │
│  (工作流选择面板、参数面板、任务状态显示)       │
├─────────────────────────────────────────────┤
│              ComfyKit 封装层                  │
│  (统一 API、参数映射、结果解析)                │
├──────────────┬──────────────────────────────┤
│  Self-Host   │       Cloud Provider         │
│  ComfyUI     │  (RunningHub / 自建API)       │
│  localhost   │   api.runninghub.cn          │
│  :8188       │                              │
└──────────────┴──────────────────────────────┘
```

### 7.2 工作流文件命名规范

工作流文件使用 JSON 格式，按前缀分类：

| 前缀 | 能力 | 示例 |
|------|------|------|
| `image_*` | 图片生成 | `image_flux.json`、`image_qwen.json`、`image_sdxl.json` |
| `video_*` | 视频生成 | `video_wan2.1_fusionx.json`、`video_wan2.2.json` |
| `i2v_*` | 图生视频 | `i2v_LTX2.json` |
| `tts_*` | 语音合成 | `tts_edge.json`、`tts_index2.json`、`tts_spark.json` |
| `analyse_*` | 图像/视频理解 | `analyse_image.json`、`analyse_video.json` |
| `digital_*` | 数字人（后续） | `digital_combination.json`、`digital_customize.json` |
| `af_*` | 动作迁移（后续） | `af_scail.json` |

工作流文件存放位置（三层资源覆盖）：

```text
app-resources/workflows/selfhost/      # 内置本地工作流
app-resources/workflows/cloud/         # 内置云端工作流
user-data/workflows/selfhost/          # 用户自定义本地工作流
user-data/workflows/cloud/             # 用户自定义云端工作流
project/workflows/selfhost/            # 项目专属本地工作流
project/workflows/cloud/               # 项目专属云端工作流
```

### 7.3 工作流参数映射机制

每个 ComfyUI 工作流 JSON 内部使用节点 ID 引用参数。MYStudio 需要一个映射层，将业务参数映射到工作流节点参数。

**映射方式**：在工作流 JSON 同级目录放置同名 `*.meta.json` 文件：

```text
workflows/selfhost/
  image_flux.json           # ComfyUI 工作流定义
  image_flux.meta.json      # MYStudio 参数映射元数据
```

**meta.json 格式**：

```json
{
  "name": "Flux 图片生成",
  "description": "使用 Flux 模型生成高质量图片",
  "category": "image",
  "tags": ["高质量", "通用", "SDXL"],
  "provider": "selfhost",
  "inputs": [
    {
      "key": "prompt",
      "label": "正面提示词",
      "type": "text",
      "required": true,
      "nodeId": 6,
      "field": "text"
    },
    {
      "key": "negative_prompt",
      "label": "负面提示词",
      "type": "text",
      "required": false,
      "default": "",
      "nodeId": 7,
      "field": "text"
    },
    {
      "key": "width",
      "label": "宽度",
      "type": "number",
      "default": 1024,
      "nodeId": 5,
      "field": "width"
    },
    {
      "key": "height",
      "label": "高度",
      "type": "number",
      "default": 1920,
      "nodeId": 5,
      "field": "height"
    },
    {
      "key": "seed",
      "label": "随机种子",
      "type": "number",
      "default": -1,
      "nodeId": 3,
      "field": "seed"
    }
  ],
  "outputs": [
    {
      "key": "image",
      "label": "生成图片",
      "type": "image",
      "nodeId": 9
    }
  ]
}
```

**映射逻辑**：

```typescript
// 伪代码：将业务参数注入工作流 JSON
function injectParams(workflow: object, meta: WorkflowMeta, params: Record<string, any>): object {
  const result = JSON.parse(JSON.stringify(workflow));

  for (const input of meta.inputs) {
    const value = params[input.key] ?? input.default;
    if (value === undefined && input.required) {
      throw new Error(`缺少必填参数: ${input.key}`);
    }
    // 定位到 ComfyUI 节点的指定字段
    result[String(input.nodeId)].inputs[input.field] = value;
  }

  return result;
}
```

### 7.4 ComfyKit 封装调用规范

ComfyKit 是 ComfyUI 的 Python SDK。MYStudio 通过以下方式调用：

```text
MYStudio (Electron/Node)
  → child_process / HTTP 请求
    → ComfyUI API (localhost:8188 或云端地址)
      → 工作流执行
        → 返回结果（图片URL、视频URL、音频文件）
```

核心调用流程：

```typescript
// 伪代码：ComfyKit 调用封装
interface ComfyUIConfig {
  mode: 'selfhost' | 'cloud';
  baseUrl: string;           // http://localhost:8188 或云端 API
  apiKey?: string;           // 云端模式需要
  timeout?: number;          // 超时毫秒数，默认 300000 (5分钟)
}

async function executeWorkflow(
  config: ComfyUIConfig,
  workflowJson: object,
  onProgress?: (progress: number) => void
): Promise<WorkflowResult> {
  // 1. 提交工作流
  const promptId = await submitPrompt(config, workflowJson);

  // 2. 轮询进度（WebSocket 或 HTTP polling）
  while (true) {
    const status = await pollStatus(config, promptId);
    if (status.status === 'completed') break;
    if (status.status === 'failed') throw new Error(status.error);
    onProgress?.(status.progress);
    await sleep(1000);
  }

  // 3. 获取输出结果
  const outputs = await fetchOutputs(config, promptId);
  return outputs;
}
```

### 7.5 工作流扫描与 UI 呈现

**扫描逻辑**：

```typescript
// 伪代码：扫描所有可用工作流
interface WorkflowEntry {
  id: string;               // 文件相对路径作为 ID
  name: string;             // 显示名称（来自 meta.json）
  category: string;         // image/video/i2v/tts/analyse/digital/af
  tags: string[];           // 能力标签
  provider: string;         // selfhost / cloud
  metaPath: string;         // meta.json 完整路径
  workflowPath: string;     // 工作流 JSON 完整路径
  source: 'app' | 'user' | 'project';
}

function scanWorkflows(resourceDirs: string[]): WorkflowEntry[] {
  // 1. 使用三层资源发现扫描 workflows/ 目录
  // 2. 对每个 *.json 文件检查同名 *.meta.json
  // 3. 解析 meta.json 获取 name/category/tags
  // 4. 无 meta.json 的工作流标记为 "未配置"，仍可使用但参数面板需手动输入 nodeId
  // 5. 按前缀分组返回
}
```

**UI 呈现分组**：

```text
工作流选择面板
  ├─ 图片生成 (image_*)
  │   ├─ Flux 高质量图片      [高质量] [通用]
  │   ├─ Qwen 中文卡通        [中文] [卡通]
  │   └─ SDXL 标准图片        [标准] [快速]
  ├─ 视频生成 (video_*)
  │   ├─ Wan2.1 FusionX       [动态] [通用]
  │   └─ Wan2.2               [最新] [高质量]
  ├─ 图生视频 (i2v_*)
  │   └─ LTX2                 [图生视频]
  ├─ 语音合成 (tts_*)
  │   ├─ Edge TTS              [免费] [快速]
  │   ├─ Index TTS             [高质量]
  │   └─ Spark TTS             [中文优化]
  └─ 图像分析 (analyse_*)
      ├─ 图片理解              [分析]
      └─ 视频理解              [分析]
```

### 7.6 错误处理与重试策略

| 错误类型 | 检测方式 | 重试策略 | 最大重试 |
|---------|---------|---------|---------|
| ComfyUI 连接失败 | HTTP 连接错误 | 指数退避：2s → 4s → 8s | 3次 |
| 工作流执行超时 | 超过 timeout 毫秒 | 不重试，提示用户检查模型 | 0次 |
| GPU 内存不足 | ComfyUI 返回 OOM 错误 | 降级重试：减小分辨率/批次 | 1次 |
| 输出质量异常 | NSFW filter / 黑图 | 换种子重试 | 2次 |
| 云端 API 限流 | HTTP 429 | 等待 Retry-After 后重试 | 3次 |
| 云端余额不足 | HTTP 402 | 不重试，提示用户充值 | 0次 |

每个重试操作记录日志：

```typescript
interface RetryLog {
  taskId: string;
  attempt: number;
  maxAttempts: number;
  error: string;
  nextAction: 'retry' | 'abort';
  timestamp: number;
}
```

### 7.7 与 MYStudio GenerationJob 的对接

MYStudio 现有 `GenerationJob` 概念（分镜级别的生成任务）。ComfyUI 工作流执行作为 GenerationJob 的一个步骤接入：

```text
GenerationJob (分镜级)
  ├─ Step 1: TTS 语音生成
  │   └─ 选择 tts_* 工作流 → 输入 narration → 输出 audioPath
  ├─ Step 2: 图片/视频生成
  │   └─ 选择 image_*/video_* 工作流 → 输入 prompt → 输出 mediaPath
  ├─ Step 3: HTML 模板包装（如使用模板）
  │   └─ 输入 mediaPath + templateParams → 输出 composedImagePath
  └─ Step 4: FFmpeg segment 渲染
      └─ 输入 composedImagePath + audioPath → 输出 segmentPath
```

GenerationJob 扩展字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| ttsWorkflowId | string | 使用的 TTS 工作流 ID |
| mediaWorkflowId | string | 使用的图片/视频工作流 ID |
| mediaType | "image" \| "video" | 媒体类型 |
| templateKey | string | 使用的 HTML 模板 key |
| templateParams | Record<string, string> | 模板参数 |
| audioPath | string | TTS 输出音频路径 |
| mediaPath | string | 生成的图片/视频路径 |
| composedImagePath | string | 模板包装后的合成图片路径 |
| segmentPath | string | 最终单镜视频片段路径 |
| renderTaskId | string | 关联的任务 ID |
| renderLogPath | string | 渲染日志路径 |

---

## 8. UI 交互规范

本节描述模板与工作流相关面板的 wireframe 规范，指导前端组件开发。

### 8.1 模板选择面板

**布局**：左侧分类树 + 右侧预览网格

```text
┌──────────────────────────────────────────────────┐
│  模板选择                                    [×]  │
├───────────────┬──────────────────────────────────┤
│ 分类          │  预览网格                          │
│               │                                   │
│ ▼ 竖屏 1080×1920│  ┌─────┐ ┌─────┐ ┌─────┐      │
│   静态模板     │  │ 预览 │ │ 预览 │ │ 预览 │      │
│   图片模板     │  │ 图1  │ │ 图2  │ │ 图3  │      │
│   视频模板     │  │     │ │     │ │     │      │
│ ▼ 方形 1080×1080│  └─────┘ └─────┘ └─────┘      │
│   静态模板     │  ┌─────┐ ┌─────┐ ┌─────┐      │
│   图片模板     │  │ 预览 │ │ 预览 │ │ 预览 │      │
│ ▼ 横屏 1920×1080│  │ 图4  │ │ 图5  │ │ 图6  │      │
│   静态模板     │  │     │ │     │ │     │      │
│   图片模板     │  └─────┘ └─────┘ └─────┘      │
│   视频模板     │                                   │
│               │  来源: ●内置 ○用户 ○项目           │
├───────────────┴──────────────────────────────────┤
│                              [取消]  [选择此模板]  │
└──────────────────────────────────────────────────┘
```

**交互**：

- 左侧分类树按尺寸 → 前缀类型二级展开
- 右侧网格每个卡片显示模板预览缩略图 + 模板名称
- 点击卡片进入预览 + 参数编辑（见 8.2）
- 底部来源筛选：内置/用户/项目 三选一或全部
- 缩略图在首次加载时后台渲染缓存，后续直接读取

### 8.2 模板参数编辑面板

**布局**：左侧参数表单 + 右侧实时预览

```text
┌──────────────────────────────────────────────────┐
│  模板参数编辑 - image_cartoon               [×]  │
├─────────────────────┬────────────────────────────┤
│ 参数                │  实时预览                    │
│                     │                             │
│ 标题 [___________]  │  ┌─────────────────────┐    │
│ 副标题 [__________] │  │                     │    │
│ 正文 [___________]  │  │    渲染预览图         │    │
│       [___________] │  │    (实时更新)         │    │
│ 作者 [匿名_______]  │  │                     │    │
│                     │  │                     │    │
│ 背景色 [#1a1a2e] 🎨 │  │                     │    │
│ 标题字号 [72____]   │  └─────────────────────┘    │
│ 标题颜色 [#FFFFFF] 🎨│                             │
│ 正文字号 [42____]   │  画布: 1080×1920            │
│ 正文颜色 [#FFFFFF] 🎨│  来源: ●内置                │
│                     │                             │
│ [恢复默认值]        │                             │
├─────────────────────┴────────────────────────────┤
│                         [取消]  [应用参数并确认]   │
└──────────────────────────────────────────────────┘
```

**交互**：

- 左侧表单由 `parseTemplateParams()` 自动生成，无需手写 UI
- 参数变更后防抖 300ms 触发预览重渲染
- "恢复默认值" 重置为模板 `{{param=default}}` 中的默认值
- 预览图下方显示画布尺寸和资源来源

### 8.3 工作流选择面板

**布局**：按能力类型分组 + 能力标签

```text
┌──────────────────────────────────────────────────┐
│  工作流选择                                 [×]  │
├──────────────────────────────────────────────────┤
│ 筛选: [全部▼]  执行方式: [全部▼]  来源: [全部▼]   │
├──────────────────────────────────────────────────┤
│                                                   │
│ 📷 图片生成                                       │
│  ┌────────────────────────────────────────────┐  │
│  │ Flux 高质量图片  [高质量] [通用]  ●内置     │  │
│  │ Qwen 中文卡通    [中文] [卡通]    ●内置     │  │
│  │ SDXL 标准图片    [标准] [快速]    ●内置     │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│ 🎬 视频生成                                       │
│  ┌────────────────────────────────────────────┐  │
│  │ Wan2.1 FusionX  [动态] [通用]    ●内置     │  │
│  │ Wan2.2          [最新] [高质量]   ○云端     │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│ 🎤 语音合成                                       │
│  ┌────────────────────────────────────────────┐  │
│  │ Edge TTS        [免费] [快速]    ●内置     │  │
│  │ Index TTS       [高质量]         ○用户     │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
├──────────────────────────────────────────────────┤
│                              [取消]  [选择工作流]  │
└──────────────────────────────────────────────────┘
```

**交互**：

- 顶部三个筛选器：能力类型（全部/图片/视频/图生视频/TTS/分析）、执行方式（全部/本地/云端）、来源（全部/内置/用户/项目）
- 每个工作流卡片显示：名称、能力标签（来自 meta.json tags）、来源标识
- 选中工作流后展开显示参数输入面板（同样从 meta.json inputs 自动生成）

### 8.4 资源库浏览面板

**布局**：目录树 + 文件列表 + 来源标识

```text
┌──────────────────────────────────────────────────┐
│  资源库浏览                                 [×]  │
├───────────────┬──────────────────────────────────┤
│ 目录          │  文件列表                          │
│               │                                   │
│ ▼ templates   │  名称           来源    大小      │
│   ▼ 1080x1920 │  image_cartoon  ●内置   12KB     │
│   ▼ 1080x1080 │  image_default  ●内置   8KB      │
│   ▼ 1920x1080 │  video_default  ○用户   15KB     │
│ ▼ workflows   │  static_custom  ◉项目   6KB      │
│   ▼ selfhost  │                                   │
│   ▼ cloud     │  来源图例:                        │
│ ▼ bgm         │  ● 内置 (app-resources)           │
│ ▼ effects     │  ○ 用户 (user-data)               │
│   ▼ flash     │  ◉ 项目 (project)                 │
│   ▼ smoke     │                                   │
│   ▼ audio     │  同名覆盖: ◉ > ○ > ●             │
│ ▼ fonts       │                                   │
├───────────────┴──────────────────────────────────┤
│  [导入到用户目录]  [导入到项目目录]                 │
└──────────────────────────────────────────────────┘
```

**交互**：

- 左侧目录树展示三层资源的合并目录结构
- 右侧文件列表每个条目显示来源标识（内置/用户/项目）
- 同名文件高优先级覆盖低优先级，低优先级的变灰但仍可见
- "导入到用户目录" / "导入到项目目录" 按钮允许用户上传自定义资源

---

## 9. 与 MYStudio 现有代码的对接

### 9.1 新增能力域文件结构

建议在 MYStudio 中新增以下能力域文件：

```text
src/
  lib/
    studio/
      resources.ts            # 三层资源发现扫描
      template.ts             # HTML 模板参数解析
      segment-plan.ts         # 分镜到单镜渲染计划
      task.ts                 # 任务状态、持久化模型
      workflow.ts             # 工作流 meta 解析与参数映射
  electron/
    studio-render/
      ffmpeg.ts               # FFmpeg 命令封装（从 main.ts 拆出）
      template-renderer.ts    # HTML 模板渲染为图片
      segment-renderer.ts     # 单镜 segment 渲染
      episode-renderer.ts     # 整集拼接渲染
      resource-discovery.ts   # Electron 侧资源扫描 IPC handler
      workflow-runner.ts      # ComfyUI 工作流执行器
```

### 9.2 resources.ts：资源扫描实现

**职责**：实现三层资源发现扫描（详见第 4 节）

**导出接口**：

```typescript
// 资源扫描入口
export function discoverResources(
  subDir: string,
  options?: { sources?: Array<'app' | 'user' | 'project'> }
): ResourceEntry[];

// 模板列表
export function listTemplates(size?: string): TemplateEntry[];

// 工作流列表
export function listWorkflows(
  category?: string,
  provider?: string
): WorkflowEntry[];

// BGM 列表
export function listBgm(): BgmEntry[];

// 特效资产列表
export function listEffects(category?: string): EffectEntry[];

// 字体列表
export function listFonts(): FontEntry[];
```

### 9.3 template.ts：模板解析实现

**职责**：解析 HTML 模板的尺寸、参数、类型（详见第 3.3、5.2 节）

**导出接口**：

```typescript
// 解析模板参数
export function parseTemplateParams(html: string): TemplateParam[];

// 获取模板元信息
export function getTemplateMeta(htmlPath: string): {
  size: string;                    // "1080x1920"
  width: number;
  height: number;
  type: 'static' | 'image' | 'video';
  mediaWidth: number;              // template:media-width
  mediaHeight: number;             // template:media-height
  params: TemplateParam[];
};

// 注入参数到 HTML
export function injectParams(
  html: string,
  params: Record<string, string>
): string;
```

### 9.4 template-renderer.ts：模板渲染实现

**职责**：将 HTML 模板渲染为图片（详见第 5.1 节）

**导出接口**：

```typescript
// 渲染模板预览
export async function renderTemplatePreview(options: {
  htmlPath: string;
  params: Record<string, string>;
  outputPath: string;
  width: number;
  height: number;
}): Promise<string>;

// 渲染视频模板透明覆盖层
export async function renderVideoOverlay(options: {
  htmlPath: string;
  params: Record<string, string>;
  outputPath: string;
  width: number;
  height: number;
  transparent: true;
}): Promise<string>;
```

### 9.5 IPC 通道定义

参考 Pixelle-Video API 设计，映射为 Electron IPC 通道：

| IPC 通道 | 方向 | 请求参数 | 返回值 | 说明 |
|---------|------|---------|--------|------|
| `studio-list-templates` | renderer→main | `{ size?: string }` | `TemplateEntry[]` | 列出可用模板 |
| `studio-get-template-params` | renderer→main | `{ templateId: string }` | `TemplateParam[]` | 获取模板参数定义 |
| `studio-render-template-preview` | renderer→main | `{ templateId: string, params: Record<string, string> }` | `{ imagePath: string }` | 渲染模板预览 |
| `studio-list-workflows` | renderer→main | `{ category?: string, provider?: string }` | `WorkflowEntry[]` | 列出可用工作流 |
| `studio-list-resources` | renderer→main | `{ type: string, subDir?: string }` | `ResourceEntry[]` | 列出指定类型资源 |
| `studio-create-render-task` | renderer→main | `SegmentRenderPlan` | `{ taskId: string }` | 创建渲染任务 |
| `studio-get-render-task` | renderer→main | `{ taskId: string }` | `TaskStatus` | 查询任务状态 |
| `studio-cancel-render-task` | renderer→main | `{ taskId: string }` | `{ success: boolean }` | 取消任务 |

### 9.6 渐进式落地建议

分阶段实施，每阶段独立可验证：

| 阶段 | 目标 | 涉及文件 |
|------|------|---------|
| **P1：资源发现** | 实现三层资源扫描 + IPC + 简单列表 UI | `resources.ts`、`resource-discovery.ts` |
| **P2：模板预览** | 实现 HTML 参数解析 + BrowserWindow 预览 + 参数面板 UI | `template.ts`、`template-renderer.ts` |
| **P3：工作流接入** | 实现 meta.json 解析 + ComfyUI 调用 + 工作流选择 UI | `workflow.ts`、`workflow-runner.ts` |
| **P4：单镜渲染** | 实现完整的 GenerationJob 流程（TTS→媒体→模板→segment） | `segment-plan.ts`、`segment-renderer.ts` |
| **P5：整集拼接** | 实现 segment concat + BGM + 基础 QA | `episode-renderer.ts`、`ffmpeg.ts` |
| **P6：特效系统** | 实现特效叠加、音效混音、多轨精剪 | `task.ts`、扩展 `segment-renderer.ts` |

---

## 10. 附录

### 10.1 术语表

| 术语 | 说明 |
|------|------|
| segment | 单个分镜渲染后的视频片段 |
| overlay | 透明叠加层，用于在视频上叠加特效或字幕 |
| meta.json | 工作流参数映射元数据文件 |
| ComfyKit | ComfyUI 的 Python SDK |
| GenerationJob | MYStudio 中分镜级别的生成任务单元 |
| timeline JSON | MYStudio 中描述多轨视频时间线的 JSON 结构 |
| BrowserWindow | Electron 的浏览器窗口组件 |
| RunningHub | ComfyUI 工作流云端执行平台 |

## 附录：交叉引用

| 关联文档 | 关联内容 |
|----------|----------|
| MYStudio四项目融合总计划.md | 第12.4节（角色场景音色素材流程）、第12.7节（TTS字幕合成） |
| FFmpeg_AI开源漫剧短视频自动化计划.md | 第6节（模板系统设计）、第14节（Pixelle-Video调研） |
| 数据模型与接口规范.md | AssetReference（资产管理）、IPC资源发现接口 |
| 配置中心升级与供应商能力方案.md | ComfyUI作为AI供应商的能力声明 |
| 错误处理与测试策略.md | 模板/工作流错误码 E_TEMPLATE_* / E_WORKFLOW_* |
| 部署打包与工程化手册.md | 模板与资源打包策略（ASAR内vs外部） |

---

### 10.2 参考资料

| 资料 | 链接 |
|------|------|
| Pixelle-Video GitHub | https://github.com/AIDC-AI/Pixelle-Video |
| Pixelle-Video 模板渲染源码 | `pixelle_video/services/frame_html.py` |
| Pixelle-Video FFmpeg 服务源码 | `pixelle_video/services/video.py` |
| Pixelle-Video ComfyUI 基础服务 | `pixelle_video/services/comfy_base_service.py` |
| Pixelle-Video API 路由 | `api/routers/frame.py`、`api/routers/resources.py` |
| MYStudio 数据模型规范 | `数据模型与接口规范.md` |
| MYStudio 融合总计划 | `MYStudio四项目融合总计划.md` |
| FFmpeg AI 漫剧自动化计划 | `FFmpeg_AI开源漫剧短视频自动化计划.md` |
