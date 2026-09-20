"""Mark historical designs precisely, preserving dated evidence and original bodies."""
from docs_refresh_batch import ROOT, update
folder=ROOT/'docs/融合'
paths={p.name:p for p in folder.glob('*.md')}
for p in paths.values():
 if p.name=='README.md':continue
 text=p.read_text(); title=text.splitlines()[0]
 if p.name in ['MoYin_资产生成_技术调查.md','ToonFlow_剧情产物生成_技术调查.md']:
  note='> 资料性质（2026-09-20 复核）：外部项目源码调查，原调查日期未在文首注明；下文路径、API、数量及能力归属于被调查项目的当时版本，不能作为 MYStudio 当前实现。当前用户入口见[工作流教程](../workflow/WORKFLOW_GUIDE.md)。'
 else:
  note='> 适用范围（2026-09-20 复核）：本文为按原日期保留的融合设计、计划或审计记录；“当前”“本轮”、版本、路径、测试数及任务状态均属于对应历史时点。方案、示例类型和错误码不自动构成现行实现。当前操作与门禁查[完整视频链路](../workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md)、[开发架构](../engineering/DEVELOPER_ARCHITECTURE.md)及[打包指南](../engineering/PACKAGING_AND_SMOKE_TESTING.md)，字段以现有源码类型/schema 为准。'
 update(p.relative_to(ROOT),[(title+'\n',title+'\n\n'+note+'\n')])
update(paths['小说到成片·统一工作流计划.md'].relative_to(ROOT),[
 ('统一工作流计划（固定标准）','统一工作流计划（融合设计与历史阶段）'),
 ('**唯一标准工作流**','**融合目标工作流**'),
 ('后续所有相关开发以本文为准。','当前 UI 的八页签与实现边界以现行工作流指南及源码为准；本篇十四阶段是概念职责拆分，不是十四个产品页签。'),
])
update(paths['数据模型与接口规范.md'].relative_to(ROOT),[
 ('**权威主文档** = `小说到成片·统一工作流计划.md`。本文档为落地层数据规范，存量内容与主文档冲突处**一律以主文档为准**', '**历史设计主文档** = `小说到成片·统一工作流计划.md`。以下为 2026-05-30 的设计对齐记录；当前字段冲突以 `apps/frontend/types/` 及运行时 schema 为准'),
 ('## 0.1 当前实现边界（2026-06-09）','## 0.1 历史实现边界（2026-06-09）'),
])
update(paths['部署打包与工程化手册.md'].relative_to(ROOT),[
 ('> 状态：当前基线 + 后续规划','> 状态：2026-08 历史基线 + 后续规划；非当前安装操作手册'),
 ('## 1. 当前构建基线','## 1. 历史构建基线（2026-08）'),
])
update(paths['README.md'].relative_to(ROOT),[
 ('当前产品主线以根目录用户手册为准：','当前八页签以 `workflow-tabs.ts` 和[工作流教程](../workflow/WORKFLOW_GUIDE.md)为准：'),
 ('风格与导演 -> 小说导入 -> 策划编剧 -> 剧本资产 -> ProductionAgent -> 分镜面板 -> 视频工作台','风格与导演 -> 小说导入 -> 剧本生产阶段 -> 剧本资产管理\n-> 分镜视频生成 -> 分镜面板 -> 图像节点图 -> 视频工作台'),
 ('Node 22 sidecar','Electron 内置 Node sidecar（要求 >=22）'),
 ('本轮（2026-08-09）已按该策略','历史记录（2026-08-09，当时验收，非本轮重跑）已按该策略'),
 ('## 当前权威入口','## 当前操作与历史设计入口'),
 ('## 当前审计资料','## 历史审计资料（2026-07）'),
 ('当前 Toonflow 对照缺口、未迁移能力、优先级和六个 Trellis 目标','2026-07 Toonflow 对照缺口、优先级和六目标记录（正文已标完成，非当前待办）'),
 ('当前 Toonflow 差距状态与六目标推进入口','当时的差距状态与六目标追溯'),
 ('新工作流阶段名必须使用：`策划编剧`、`ProductionAgent`、`分镜面板`、`视频工作台`。','新文档使用源码中的八页签名称；ProductionAgent 是内部生产职责，不是独立页签。'),
])
for p in sorted((ROOT/'docs/research').glob('*.md')):
 text=p.read_text(); title=text.splitlines()[0]
 update(p.relative_to(ROOT),[(title+'\n',title+'\n\n> 历史研究/交接记录（2026-09-20 适用范围复核）：保留文件名和文内日期对应的判断、未决项与实验结果，未重新执行原实验。旧路径、外部项目能力和当时任务状态仅供追溯；现行操作查[工作流教程](../workflow/WORKFLOW_GUIDE.md)、[开发架构](../engineering/DEVELOPER_ARCHITECTURE.md)。\n')])
update('docs/research/UNIFIED_SEARCH_PLAN_2026-08-21.md',[
 ('权威 SOP = `.trellis/spec/guides/search-sop-guide.md`(已完整读取)。它已经很强:', '当时读取的旧 SOP = `.trellis/spec/guides/search-sop-guide.md`；现行权威为 [`.claude/knowledge/search-sop.md`](../../.claude/knowledge/search-sop.md)。以下保留最初差距分析，不能当作新 SOP 的现状：'),
])
update('docs/local/minimax-h3-local-setup-plan.md',[
 ('- 定位：**零成本草图/选镜工具**，不进生产管线、不接 MYStudio（成本裁定不变）', '- 历史定位（2026-08-22）：本地草图/选镜工具，当时不接 MYStudio；该部署定位已被 2026-09 托管引擎与 H3 分镜接线取代。当前按[ComfyUI 引擎指南](../settings/COMFYUI_ENGINE_GUIDE.md)与[分镜 H3 产线](../comfyui-kb/分镜H3视频产线.md)操作。下文独立 Comfy Desktop 路径、下载清单与测量均按原日期留档，不是今天的安装指令。'),
])
update('docs/guides/CINEMATIC_PLAYBOOK.md',[
 ('> 适用: MYStudio Remotion + video-use + HyperFrames 三段链路', '> 适用: 2026-08 实验性 3D 方案记录；本轮未重跑所列实验或测试。旧 `apps/backend/depth_estimation/` 是历史路径，现引擎包在 `apps/backend/engines/depth_engine/`。'),
 ('自 2026-08-14 起，产品出片主线为 2D panZoom + 特效路线；', '2026-08-14 当时产品选择 2D panZoom + 特效路线；2026-09 又加入 H3 动态素材，不能将本篇静态图实验当作当前唯一主线。'),
])
