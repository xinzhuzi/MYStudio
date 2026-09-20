"""Add current routes and preserve historical local-generation records."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]

def apply(name,pairs):
 p=ROOT/name
 old=p.read_text(); new=old
 for a,b in pairs:
  assert new.count(a)==1,(name,a[:70],new.count(a))
  new=new.replace(a,b,1)
 p.write_text(new); assert p.read_text()==new;print(name)

apply('docs/krea2.md',[
 ('> 应用内全部 Krea2 能力与 ComfyUI 工作流、模型、组装方式的对照文档。', '> 当前入口与历史实现对照（2026-09-20）：先按下节打开现行工作流；后面的旧模型清单和 React Flow 节点连线保留用于追溯，不是当前操作步骤。'),
 ('## 一、应用功能 ↔ ComfyUI 工作流映射', '''## 当前入口与仓库模板（2026-09-20）

在 `设置 → 本地配置 → ComfyUI 引擎` 准备引擎与模型，然后进入 `本地模型` 页的 ComfyUI 画布或 `漫影生图`。画布侧栏的 `repo:` 模板来自仓库，只读打开；需要改图时另存用户副本，不直接修改仓库模板。模型、input/output 与用户工作流目录以引擎 manifest 和设置页为准，不按下方历史安装目录推断。

| 用途 | 当前仓库入口（相对 `apps/backend/engines/comfyui/workflows/`） | 使用边界 |
|---|---|---|
| 画布文生图 | `1_图片/K2图像/1_文生图/K2-文生图.json` | 在 ComfyUI 画布加载，参数以该图实际节点为准 |
| Krea2 文生图桥模板 | `1_图片/K2图像/1_文生图/krea2-t2i.json` | 桥接调用的模板，不等同于用户画布存档 |
| 参考图编辑桥模板 | `1_图片/K2图像/3_改图/krea2-edit-ref.json` | 参考输入和节点参数以当前模板为准 |
| 降噪与超分 | `1_图片/K2图像/6_修复超分/K2-SeedVR2降噪后4K.json` | 先查参数速查及输入分辨率限制 |

`漫影生图` 的标准档使用 `manying_t2i` 桥，默认 8 步、可输入 1–40 步；加速档使用 `manying_t2i_fast`，固定 Krea2 Turbo 与加速 LoRA，步数只有 4/6 两档。它与自由编辑 ComfyUI 画布是两个入口。当前源码见 `apps/frontend/components/panels/assist/local-models/LocalModelStudio.tsx`。

完整模板清单见 [漫影工作流清单](./comfyui-kb/漫影工作流清单.md)，日常操作见 [本地模型页](./panels/LOCAL_MODELS_GUIDE.md)，采样与模型依赖见 [参数速查](./comfyui-kb/参数速查.md)。提示词参考资料位于 `docs/comfyui-kb/参考_提示词工程/`，不属于引擎工作流库。

## 历史功能映射与旧节点记录

> 以下一至五节保留早期工作流文件名、模型部署和旧 React Flow 组装说明。旧画布已退役，模型/端口/权重及性能未在本轮重测；使用现行模板时以其实际输入和模型清单为准。`apps/backend/image_gen/scripts/uncloth_pipeline.py` 仍存在，但文件存在不代表旧界面按钮仍可达。

### 一、历史应用功能 ↔ ComfyUI 工作流映射'''),
 ('## 二、模型清单','### 二、历史模型清单'),
 ('## 三、组装(画布上怎么连)','### 三、历史 React Flow 组装（非当前 ComfyUI 操作）'),
 ('## 四、无衣物节点参数速查','### 四、历史节点参数速查'),
 ('## 五、管线实现说明(工程师向)','### 五、历史 sidecar 实现说明(工程师向)'),
])
apply('docs/guides/LOCAL_MODEL_COST_REDUCTION.md',[
 ('# 本地模型降本指南 — 零 API 费用无限生成','# 本地模型降本指南与历史方案'),
 ('> 版本: 1.2 | 日期: 2026-09-03（策略表按当前设置页「本地配置」实际盘面核对；Phase/Trellis 章节保留 08-15 历史核验快照）','> 当前入口复核：2026-09-20。原 1.2 版（2026-09-03）及 08-15 Phase/Trellis 记录保留为历史资料。'),
 ('本指南说明如何利用本地 AI 模型替代云 API，实现零费用无限生成。','本地模型可减少按次 API 费用，但仍消耗设备、存储、电力和运行时间；可用吞吐与画质取决于模型和硬件，不能承诺零成本或无限生成。'),
 ('## 当前本地能力盘面（设置 → 本地配置，2026-09-03 核对）','''## 当前入口与职责（2026-09-20 源码核对）

| 能力 | 当前入口/职责 | 依据与边界 |
|---|---|---|
| Krea2 图像与 H3 分镜视频 | 应用托管 ComfyUI 引擎；从本地模型页或 MY 工作流画布执行 | [ComfyUI 引擎指南](../settings/COMFYUI_ENGINE_GUIDE.md)、[本地模型页](../panels/LOCAL_MODELS_GUIDE.md)；不再要求独立 ComfyUI Desktop |
| TTS 与视觉审核 | 设置 → 本地配置中的独立 worker | TTS 仍在 `apps/backend/engines/tts_engine/`；ComfyUI 接管图像/视频不等于替代全部 Python worker |
| 音乐 | 视频工作台已接入 YuE2 出谱、按谱渲染和翻唱工作流 | 源码 `apps/frontend/components/panels/studio/bgm-score.ts`、`bgm-cover.ts`；本轮仅核验接线，未运行真实音乐生成 |
| 章节输出 | StoryboardShot → video-use → 用户确认 → HyperFrames → 原生 Remotion Studio → ChapterVideo | [完整视频生产链路](../workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md)；FFmpeg 承担受控探测/处理等职责，不作为正式章节 renderer |

模型获取保持显式操作；缺少运行时或模型时按页面状态准备。缓存路径以设置页、引擎 manifest 与 [存储说明](../engineering/STORAGE_AND_DATA.md) 为准，硬件门槛以实际模型要求为准。

## 历史策略与成本估算（2026-08-15 至 2026-09-03）

> 下文保留当时的能力表、价格示例、目录树、3D 方案和任务状态。它们不代表 2026-09-20 的现行部署、生产默认或实时任务进度；“免费/零费用”只反映当时按次 API 费的估算，未计设备与能耗。旧 Music3、外部 H3 和 sidecar 操作按历史理解，现行入口以上表及专题文档为准。本轮未重测性能、获取市场价格或执行媒体生成。

### 历史本地能力盘面（2026-09-03）'''),
 ('## 核心降本策略','## 历史核心降本策略'),
 ('## 本地模型基础设施复用','## 历史基础设施复用设计'),
 ('## 降本效果估算','## 历史降本效果估算（非现价）'),
 ('## Trellis 任务追踪','## 历史 Trellis 任务快照'),
 ('在 `apps/` 目录执行当前电影级渲染入口：','以下为原方案在 `apps/` 目录记录的实验命令；不作为当前默认生产操作：'),
 ('## 实际使用流程（零成本本地生成；按已完成边界执行）','## 历史实验操作流程（不作为当前操作指南）'),
])
