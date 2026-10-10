---
name: node-graph
description: 节点图(node graph)与画布布局(canvas layout)技能——凡涉 ComfyUI 工作流构建或修改、画布布局、工作流布局、节点图搭建、连线交叉治理、线遮节点、横向排版、组框、负区、输出口位、workflow JSON 两种格式、连线与类型机制、多模式/加速档拓扑怎么搭(并行支路/节点复用/懒选择)的任务先读此技能。含拓扑结构策略章(0929:并行支路+单一选择点/单源扇出+零真重复/懒执行选择/注入式反模式;0930 补:完整功能域收装子图)、历次布局裁定系谱(09-19 横向铁律→0926 线不遮节点→0928 交叉立宪→0930 输出槽排布/节点命名/节奏常数)与布局策略全谱(①-⑦+⑧ 输出槽排布·节点命名·对称规整节奏常数);本技能管图结构与布局,引擎驱动与生成归 comfyui 技能;1006 增「节点与工作流认知」章(节点解剖/object_info 真源/子图六同步与蓝图单向/宿主槽渲染/自研节点设计纪律——含**控件vs展示框退役分界:删下拉框≠删展示框,退役令只及控件**/工作流四副本与热覆盖/mermaid 展示/交付三道门)与「工作流 JSON 配置与逻辑」章(GUI/API 双格式逐字段解剖+graphToPrompt 执行链;1006 末轮术语对照补父图/宿主/连接状态/连接参数四条问法映射+嵌套单层口径全库扫描定谳)。Use for any node graph / canvas layout / workflow building or editing / crossing-and-group governance / topology-patterning / node details / subgraph host panel / workflow-cache-path / workflow JSON fields and execution chain task.
metadata:
  type: reference
---

# 节点图与画布布局(node graph / canvas layout)

本技能是**整合者**:地图(指路三真源)+纪律(优先级序)+速查层(脱离外部文件可用的最小操作集)。三真源(`.claude/knowledge/node-graph-architecture.md`、`docs/comfyui-kb/画布布局规范.md`、`.agents/skills/comfyui/`)仍是唯一权威;**任何冲突——包括布局策略章与 0928 立宪文档的冲突——一律真源胜,然后回改本技能**。「布局策略章完整自含」(0928 用户二令)的边界:指该章不依赖外部文件即可读全布局纪律,不指权威高于真源;优先级序的第一出处仍是 0928 立宪文档。

## SKILL ROUTING(技能分流)

- 改工作流 JSON/控件/槽位/子图/画布布局 → 本技能;
- 跑图/引擎驱动/模型选型与下载 → comfyui 技能(`.agents/skills/comfyui`);
- 涉节点 py 逻辑(INPUT_TYPES/FUNCTION/RETURN/JS 扩展)→ comfyui 技能 BUILDING_NODES.md + 本技能认知章(形态/宿主面)。
- **跨技能调用(1008 用户令:本技能要可以调用 comfyui 技能)**:命中上两行任务域时**应当按名调用 comfyui 技能**(Skill 工具调 `comfyui`;无 Skill 通道的环境=等价直读 `.agents/skills/comfyui/SKILL.md` 全文),而非只读其片段;其卫星件(MODELS 索引→家族文件两读/BUILDING_NODES/NODE_LIBRARY/ADVANCED/KNOWN_ISSUES/machine.md 本机真态)按其头部「Files in this kit」与「TASK ROUTING (this repo)」按需拉取,engine 真态(端口/路径)恒以其 machine.md 现查为准;comfyui 技能反向经 TASK ROUTING 指回本技能。
- **纪律**:动手前先读对应章;记忆与实测是佐证不是替代(1008 实据=未首读而两坑各踩一发:widget 长文本双槽序列化复活/inputs 插条目槽位后移连线错指,判例见认知章 §3 与 JSON 章节点字段表后)。

## 头部声明(两条,先读)

1. **裁定同步钩子(R13)**:R13=本技能建档任务档的需求条款编号(全文见 `.trellis/tasks/archive/2026-09/09-28-node-graph-skill/prd.md`,已归档)。规矩:今后新布局裁定落账(立宪文档或生成器自查谓词变更)时,**同一战役批次内**同步本章布局策略——本技能不是写死的静态件。
2. **工具口径边界声明**:`workflow_layout.inspect()` 是**快速近似读数**(重叠盒+直线中心线交叉+边界),**非 0928 立宪口径**(无贝塞尔模型、无线遮节点检查、无间距阈值、无输出口检查);立宪判据现可用本地 `tools/layout_check.py` 跑(立宪口径的可跑实现,见优化集 OPTIMIZATION.md ⑥),生产权威宿主=「layout_check+workflow_layout_baseline.json+契约测试」三件(三生成器 1001 起退役勿重跑)。

## 何时用

- 改画布、排节点、治交叉、建/改工作流 JSON、读节点图架构之前;
- 「连线交叉」「线穿过节点」「组框罩不住」「负区/一打开就左滚」「输出口位置」类布局问题;
- 写或改 workflow JSON(两种格式、连线写法、类型匹配、转换件);
- 与 comfyui 技能分界:本技能管**图结构与布局**(排布/治理/格式/连线);跑图/模型/参数/VRAM 等引擎驱动与生成归 comfyui 技能。两域重叠的任务先本技能定结构,再 comfyui 技能执行。
- 定图结构:多模式/加速档/参数互斥切换怎么搭(并行支路 vs 注入式)、节点复用、懒选择——先读优化集 OPTIMIZATION.md「拓扑结构策略」章再进布局策略;**结构先定、布局后排,错拓扑用布局治理只治标**(0928 布局轮坐标-only 重排未能治好注入式加速区的观感混乱,即为例证)。
- 节点详情/子图宿主面板(输入点不渲染/错名/widget 丢失)/「改了没生效」缓存疑云/自研节点设计与展示——先读认知集 COGNITION.md「节点与工作流认知」章;宿主槽排查与缓存路径全图的专文见三真源地图(调用集 INVOCATION.md)。

## 本技能文件集(按需拉取;判例与配方细节全走卫星件,本路由器只留分流与钩子)

| 文件 | 何时读 |
| --- | --- |
| `ERRORS.md` 错题集 | 带日期判例/实弹红/翻案问责——自研节点设计纪律(控件vs展示框分界+DOM 输入控件三陷阱)、交付管线反例存档、排障思路序(第-1~6步)、「执行了没显示」三病速判、四根因与 JS 缓存根治、五树指纹扫立宪、CDP 取证与 Draft.v2 全录、第六层缴械+视觉改动两铁律、widget 双槽序列化复活(1008);[401] py-DOM 同构破案全录住优化集布局④1b |
| `OPTIMIZATION.md` 优化集 | 「怎么做好」配方全谱——拓扑结构策略章(并行支路/单源扇出/懒选择/收装子图铁则)+布局策略全谱①-⑨(est 足迹公式/流向纪律/五层优先级序/组框/对拍验证/落地链/节奏常数/市面印证)+构建流程骨架(MIT 借鉴) |
| `INVOCATION.md` 调用集 | 交付与调用——唯一交付管线六步(契约前置门)/工作流四副本与热覆盖/生效矩阵/落点总表/指纹门/一键工具 canvas_deploy/三真源地图 14 行指路表/mermaid 展示与交付三道门/tools 工具配方(workflow_layout.py+layout_check.py) |
| `COGNITION.md` 认知集 | 节点与工作流认知章 §1-§4(节点解剖三处挂接/object_info 唯一真源/子图六同步/宿主面板槽渲染)+工作流 JSON 章(GUI/API 双格式逐字段/术语对照问法映射/widget 三态/graphToPrompt 执行链) |

> 最小排障入口:「改了没生效」先错题集排障思路序+三病速判;改任何多副本存身内容先跑五树指纹扫(错题集);修改落点照调用集落点总表;布局验证跑 `tools/layout_check.py`(配方见调用集)。

## 纪律钩子

- 未提交真源(如 0928 立宪文档)只读引用不改;确需改共享真源,先过静默门并单独报备。静默门=改前 `stat` 目标文件 mtime,距今≥30 分钟(判定无并行会话正在写它)才动手;不满 30 分钟=可能有人正在写,等满或挂起。
- 速查层与真源冲突:真源胜,回改本技能;新布局裁定落账时按头部同步钩子同批更新。
- 子图对象格式与边界 links 登记等契约域:见 comfyui 技能 Subgraphs 章与 `apps/backend/engines/comfyui/tests/`。
- 生产工作流只读铁律与生成器路线:见优化集 OPTIMIZATION.md ⑦ 落地链。
