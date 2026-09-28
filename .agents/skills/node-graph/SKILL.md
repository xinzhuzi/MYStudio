---
name: node-graph
description: 节点图(node graph)与画布布局(canvas layout)技能——凡涉 ComfyUI 工作流构建或修改、画布布局、工作流布局、节点图搭建、连线交叉治理、线遮节点、横向排版、组框、负区、输出口位、workflow JSON 两种格式、连线与类型机制的任务先读此技能。含历次布局裁定系谱(09-19 横向铁律→0926 线不遮节点→0928 交叉立宪)与七块布局策略全谱;本技能管图结构与布局,引擎驱动与生成归 comfyui 技能。Use for any node graph / canvas layout / workflow building or editing / crossing-and-group governance task.
metadata:
  type: reference
---

# 节点图与画布布局(node graph / canvas layout)

本技能是**整合者**:地图(指路三真源)+纪律(优先级序)+速查层(脱离外部文件可用的最小操作集)。三真源(`.claude/knowledge/node-graph-architecture.md`、`docs/comfyui-kb/画布布局规范-0928.md`、`.agents/skills/comfyui/`)仍是唯一权威;**任何冲突——包括布局策略章与 0928 立宪文档的冲突——一律真源胜,然后回改本技能**。「布局策略章完整自含」(0928 用户二令)的边界:指该章不依赖外部文件即可读全布局纪律,不指权威高于真源;优先级序的第一出处仍是 0928 立宪文档。

## 头部声明(两条,先读)

1. **裁定同步钩子(R13)**:R13=本技能建档任务档的需求条款编号(全文见 `.trellis/tasks/09-28-node-graph-skill/prd.md` R13)。规矩:今后新布局裁定落账(立宪文档或生成器自查谓词变更)时,**同一战役批次内**同步本章布局策略——本技能不是写死的静态件。
2. **工具口径边界声明**:`workflow_layout.inspect()` 是**快速近似读数**(重叠盒+直线中心线交叉+边界),**非 0928 立宪口径**(无贝塞尔模型、无线遮节点检查、无间距阈值、无输出口检查);立宪判据现可用本地 `tools/layout_check.py` 跑(立宪口径的可跑实现,见 ⑥),生产权威宿主仍是生成器自查谓词。

## 何时用

- 改画布、排节点、治交叉、建/改工作流 JSON、读节点图架构之前;
- 「连线交叉」「线穿过节点」「组框罩不住」「负区/一打开就左滚」「输出口位置」类布局问题;
- 写或改 workflow JSON(两种格式、连线写法、类型匹配、转换件);
- 与 comfyui 技能分界:本技能管**图结构与布局**(排布/治理/格式/连线);跑图/模型/参数/VRAM 等引擎驱动与生成归 comfyui 技能。两域重叠的任务先本技能定结构,再 comfyui 技能执行。

## 布局策略全谱(核心章,完整自含)

> 本章数字口径以 0928 立宪与生成器自查谓词实况为准;**易变棘轮基线现值不硬编码**,取现值走 `docs/comfyui-kb/画布布局规范-0928.md` §三。

**生成器**(本章与 ④⑥⑦ 反复依赖的概念,先定义)= `apps/build/scripts/` 下三个幂等 Python 脚本,生产工作流的唯一合法产地:直接执行即「重建三件生产工作流 GUI JSON(真源落 `apps/backend/engines/comfyui/workflows/`)+跑自查谓词」一体完成——谓词写在各脚本 docstring 自查段,构建期+磁盘态双跑,EXIT=0 为绿。重跑命令:`python3 apps/build/scripts/<生成器脚本>.py`(<生成器脚本>=下述三件之一)。名单与现值基线的权威=0928 立宪文档 §三;速取(免誊代号)=`grep -l "交叉不增封顶" apps/build/scripts/*.py`,恰命中三件(三脚本文件名带项目代号,按零 IP 词纪律本文不誊写)。

### ① 排版总策略

- **横向流水线**:列=阶段(加载器→编码→采样→解码→保存),数据恒左→右(09-19 铁律)。
- **分层行结构**:层内横向一条链,并行层从上到下堆叠,层间距 **dy=720**。0925 调和定谳:这是「分层行」不是「纵塔」——并行链垂直堆叠是 09-19 铁律的合法形态,纵向深链单列塔才是违令形态。
- **零负区**:所有节点 **pos≥80**(现行值;演化注:0925 W6 时为 pos≥40,0926 收口升级 80;0925 W6=2026-09-25 战役第 6 工作段的时点编号)。嵌套子图摊平后须整图归一,手法=**平移归一**(x/y 最小值归一到阈值,子图行带同步下移)。

### ② 防重叠体系(两套体系分清,防混装)

**本项目生产工作流恒用 est 制**(est=按槽位/控件数估的节点渲染足迹):

- 节点矩形零重叠:主图+子图所有节点两两盒不交;
- est 间距:同行横距 **≥200**、同列纵距 **≥80**(Reroute/Note 豁免间距阈值,但 est 盒重叠**不豁免**);
- 子图行排版:按 y 分行(行数=阶段数),Reroute 拐点**不占行**,**行间净距≥100**,行内 x 严格递增;
- **禁两节点同 pos**。
- est 足迹估算(自查/估尺寸用):高=标题 36+槽位行数×24(行数=max(输入数,输出数))+控件数×30+垫高 28,预览类节点(SaveImage/LoadImage 等)再+260;宽=max(250,声明宽),高不低于声明高(声明宽/高=节点 JSON 的 `size[0]`/`size[1]`;size 缺省时 est 宽自 250 起步、高按公式)。公式出处=本技能 `tools/workflow_layout.py`(归因副本;上游同步以 comfyui 技能原件为准)的 `est_size()`。备察:`est_size` 较生成器自查段内联 est 式为**超集**(预览类节点再 +260 高度并取整);est 类检查已对三件生产件实跑与生成器绿零分歧——差异系口径来源不同,非移植失真(立宪检查器 est 盒按 R14 明文复用 est_size;R14=同任务档 prd.md 的「通用代码入技能」条款——0928 三令「通用性的代码设计,是需要在这个技能中的」所落,与头部 R13 同档相邻条)。
- 三个纵向数的适用面(勿混):**dy=720**=分层行的层间距(整条并行链换层时用);**同列纵距≥80**=est 制同列相邻节点最小净距(主图+子图通用);**行间净距≥100**=子图行排版中阶段行之间的净距。

**非项目临时图/通用件**才可用 comfyui 技能的 y 游标+列宽起步法(列宽=最宽节点+80、列内纵距 60)或 `auto_layout`(H_GAP=120/V_GAP=70)——常量低于项目阈值,**不得用于本项目生产件**。

### ③ 流向纪律

- **恒向右**:每条连线 `target.x > origin.x`(含 Reroute 段;子图边界线以 IO 槽 pos 为端点)。
- **左向线=冻结豁免,三防线钉死**:①生成器谓词锁「左向线恰 1 条且端点钉死」;②契约测试同步钉同一端点;③论证在档(替代方案均违已批裁定)。通用方法论:**豁免必须钉死(数量+端点双锁),不接受无名扩散豁免**。先例实据:某生产件子图内恰 1 条冻结回流线(link34,[141]→[40].提示词),端点由生成器谓词与契约测试 `test_horizontal_layout_no_vertical_tower` 双钉——查实例=到生成器(名单速取见本章开头「生成器」条)docstring 自查段搜「左向」。
- **子图 IO 三段位**:输入口最左→机器居中→输出口钉死最右:输出接口 **x≥全子图最大节点 x−50**(容差 50),右列纵向堆叠。先例实证(时点值):K2 图(K2=本仓 K2 图像产线,工作流住 `apps/backend/engines/comfyui/workflows/1_图片/`)输出槽 x=5231,比全子图最大节点 x 还靠右逾四百像素。
- **通道 Reroute 手法**:共享总线(MODEL/VAE 等)走顶缘正区通道带;Reroute 拐点不占行,不破坏行排版判定。

### ④ 五层优先级序+判定口径+治理手法(0928 立宪)

优先级序(高→低,冲突时高位胜):

1. **线不交叉**(线-线交叉对数越少越好,治理目标 0);
2. **线不遮节点**(0926 铁律:线不得从非端点节点身上穿过);
3. **恒向右/横向排版**(09-19 铁律;左向线=冻结豁免项钉死);
4. est 零重叠 / 横距≥200 纵距≥80 / 零负区(pos≥80)/ 输出口最右;
5. **组框美观**:为观感服务,不为组框而组框;**消交叉可打破本层任何约束**(契约锚随行同步)。

判定口径(统一,勿各说各话):

- 线=三次贝塞尔:P0=输出槽(节点右缘,`top+25+origin_slot×20`)、P3=输入槽(左缘,同式;top=节点 pos 的 y,slot=该节点槽序号、0 起算);P1=(P0.x+k, P0.y)、P2=(P3.x−k, P3.y),**k=clamp(|dx|/2, 40, 200)**。
- **交叉**:两线各 **24 点**采样为折线,线段两两求交(叉积同侧法),每对线至多计 1 次。
- **遮挡**:**41 点**采样,任采样点落入非端点节点盒(±2 容差)即遮挡;节点盒=普通节点 size(缺省 [220,120])、Reroute 60×30。
- −10/−20 子图边界线:id 为 −10/−20 的连线,端点是子图 IO 边界槽而非真实节点(无节点盒),故交叉与遮挡两口径同跳过。来历:这是 GUI JSON 子图 links 表专用的两个保留负 id(负数域不与真实节点正 id 相撞;−10=输入侧、−20=输出侧),只出现在 `definitions.subgraphs[].links`,顶层 `links` 端点恒为正 id;数值为前端子图表示法的既定约定(本仓按上游实证件抄型),非推导所得。

治理手法与棘轮:

- 手法优先级:**挪位置/并线 > 垫 Reroute**(垫脚石本身计入交叉预算——只是把交叉换个地方,不是消交叉);允许为消交叉调整组框边界/拆并组框/打破组框单行。
- **交叉不增封顶+单向棘轮**:生成器自查段以现值基线封顶,超基线即红(防改动让交叉变多);每次治理后把基线降到新现值,只降不升。**现值基线与生成器名单见 0928 立宪文档 §三,本章不硬编码**(防过期账)。

### ⑤ 组框策略

- **一阶段一框**:group 各框罩单一阶段行的全部节点;bounding 全罩、边缘到边缘无一外露,公式 `[minX−30, minY−50, (maxX+w)−minX+60, (maxY+h)−minY+80]`(顶部留标题栏高度)。
- **预算**:主图 **≤4**、子图 **≤4**;框**两两不相交**。
- 组框标题 **≤20 字**;颜色编码按阶段(加载器灰/条件蓝/采样绿/解码保存紫/后处理橙)。
- **画布禁功能横幅**(0915 裁定:文件名已说明功能;MarkdownNote 与组框标题不在此列)。

### ⑥ 验证纪律

- **判布局读坐标,禁截图**(截图烧 token,且各客户端同样读不了画布)。
- `tools/layout_check.py`=**0928 立宪口径的可跑实现**:贝塞尔交叉/线遮节点/est 盒零重叠/est 间距/零负区/输出口最右/左向线七判据(与工具 `CHECK_KEYS` 七项一致)逐式移植自生成器自查段,对拍过三件生产件基线(交叉数逐值相等:t2i 件主图 78/子图 7、i2i 件主图 74/子图 10、edit 件主图 84——数字按 scope 分记「主图/子图」,edit 件无子图 scope 故只有一个数);任何 GUI 格式工作流(生产件/用户区/临时图)都可独立跑,不依赖生成器;棘轮基线不内置(生产棘轮仍驻生成器)。
- `workflow_layout.inspect()`=**快速近似读数**(口径边界见头部声明;立宪判据现可用本地 layout_check 跑):`overlaps` 必须为 0;`crossings` 仅作粗计参考。
- **生产权威与棘轮宿主=生成器自查谓词**(贝塞尔交叉/遮挡/est 间距/零负区/输出口最右/封顶棘轮),写在生成器自查段,构建期+磁盘态双跑;契约测试面见 `apps/backend/engines/comfyui/tests/`。
- `auto_layout` 只用于非项目临时图(间距常量低于项目阈值,见 ②);生产件禁 `--apply`。
- 负区治理=整图平移归一(见 ①)。

### ⑦ 落地链(生产件改动与出生路线)

- **固定工作流 AI 禁手改 JSON(09-14 只读铁律)**:生产件布局治理走**生成器幂等脚本路线**——改的是生成器脚本里的坐标/拓扑,谓词写在其自查段,重跑生成器即重排重验(幂等:重跑产物逐字节一致);生成器定义与重跑命令见本章开头。
- **新生产工作流的出生路线**同走生成器:新写(或复制改造)一个幂等生成器,谓词入自查段,产物落 `apps/backend/engines/comfyui/workflows/` 对应域子夹(1_图片/2_视频/3_声音);临时/实验图可手写,经 ⑥ 验图,不入库。
- 用户可自由改画布,但须**另存用户区**(引擎家用户目录,别存回仓库件名);要把用户区改动变成正式版=**留账回写**:经生成器路线吸收进仓库真源并提交留痕,用户区件不自动回流;**画布旧标签保存=覆盖威胁**(在旧标签上保存会静默覆盖仓库真源件)。
- 改完必 **lint**:契约测试 `python3 -m pytest apps/backend/engines/comfyui/tests -q`(布局锚如 `test_qwen21_workflow_contract.py` 的画布归一/横向排版用例)。
- 改完必**装机同步**:统一走打包覆盖安装唯一入口 `apps/build/packaging/build-mac.sh`(构建+覆盖安装+installed smoke 一体完成,**不单独手跑 rsync/手动拷贝**绕过该入口)。

## 三真源地图(什么情况读哪个、读到哪节)

| 症状/任务 | 去处 |
| --- | --- |
| 节点图是什么/范式/图论/求值/端口类型 | `.claude/knowledge/node-graph-architecture.md` §1-§4 |
| 自动布局算法原理 | 同上 §5 |
| ComfyUI 内核/旧 React Flow/undo/持久化/错误语义 | 同上 §6-§10 |
| 本项目画布架构/桥/工作流库/迁移 | 同上第二部分 §13-§20 |
| 「改 X 去哪」/不可协商裁定/历史坑 | 同上第三/四/五部分 |
| 布局优先级序与交叉治理(立宪) | `docs/comfyui-kb/画布布局规范-0928.md` |
| 工作流构建/连线/类型/Subgraph/参数化 | `.agents/skills/comfyui/SKILL.md` 的「Compose a NEW workflow from pieces」「Workflow JSON」「Subgraphs」章 |
| 布局工具三函数 | `.agents/skills/comfyui/workflow_layout.py` |
| 本地捆绑工具(排布+est 口径+立宪检查) | 本技能 `tools/workflow_layout.py`(归因副本)与 `tools/layout_check.py`(立宪口径检查器);配方见「工具调用配方」章 |
| 孤儿节点/节点清单 | `.agents/skills/comfyui/tools/find_orphan_nodes.py` 与 `node_inventory.py` |
| 契约测试锚(布局谓词的测试面) | `apps/backend/engines/comfyui/tests/`(如 test_qwen21_workflow_contract.py) |
| 生产工作流生成器(自查谓词宿主;重跑=重建+自查一体) | `apps/build/scripts/`(三件,文件名带项目代号,名单见 0928 立宪文档 §三) |

> 路径失效时按文件名在 `docs/comfyui-kb/` 与 `.claude/knowledge/` 下重找(真源改名容错)。

## 工作流 JSON 速查

**两种格式,何时写哪种**:

- **GUI 格式**(画布加载与「保存」产出):顶层 `nodes`(各含 `id/type/pos/size/widgets_values/inputs/outputs`)+`links`+`groups`;写它=给人打开看(桥)。
- **API 格式**(`/prompt` 运行):`{ "<id>": { "class_type", "inputs" } }`;写它=headless 跑。
- 双格式产出者:手建图时你自己(构建一次两格式都写:GUI 给画布/桥看,API 给 `/prompt` headless 跑——此纪律出自 comfyui 技能);本仓生产件真源=GUI 格式(生成器产出,引擎侧栏以 `repo:` id 只读合并消费)。

**连线与类型机制**:

- API 格式连线:每个输入=字面值**或** `["<源节点id>", <输出槽序号>]` 二项引用(槽号=源节点匹配输出的 index)。
- GUI 格式连线:`links` 每项 `[link_id, src_node, src_slot, dst_node, dst_slot, type]`;节点 `inputs[].link`/`outputs[].links` 挂接这些 id。
- **类型必须匹配**(IMAGE/LATENT/MODEL/CLIP/VAE/CONDITIONING/MASK/CONTROL_NET…);缝上类型不同就插转换件:`VAEEncode`(IMAGE→LATENT)、`VAEDecode`(LATENT→IMAGE)、`CLIPTextEncode`(text→CONDITIONING)、`ImageScale`(尺寸)。绝不 IMAGE 直塞 LATENT 输入。
- 节点真实输入输出以 `/object_info/<NodeType>` 实查(`input.required`/`output`),不猜。

**子图(Subgraph)GUI JSON 速记**(仅骨架,够独立读懂与改对;构建侧契约真源仍=comfyui 技能 Subgraphs 章+契约测试):

- 容器:`definitions.subgraphs[]`;每个子图含 `nodes`(普通节点表)、`links`(**对象形** `{id, origin_id, origin_slot, target_id, target_slot, type}`——与顶层数组形是两制)、`inputs`/`outputs`(IO 槽表,槽含 `name/type/pos/linkIds`)。
- 宿主:主图以一个普通节点代表子图,其 `type` 与 `properties.subgraph` 均填子图 uuid;外部经宿主输入/输出槽接线。
- 边界线:子图内 `origin_id=−10` 取自 `inputs[origin_slot]`、`target_id=−20` 送到 `outputs[target_slot]`(来历见 ④);IO 槽自带 `pos` 布局坐标(输出口最右判据以它为端点)。
- 布局:layout_check 对顶层与每个子图分 scope 独立跑全套判据(scope 名 `sub:<子图名>`)。

## 构建流程骨架(思想借鉴 mckruz/comfyui-expert,MIT)

1. **意图解析**:输出类型(图/视频/音频)、源材料(文/图/既有图)、质量档、特殊要求。
2. **查本机清单**:`/object_info` 实查可用节点与模型(本机事实)。调法=引擎运行时 `GET http://<host>:port>/object_info/<NodeType>`(本仓引擎恒走 **17xxx 自家端口段,禁 8188 上游默认口**;本机现值与启动法见 comfyui 技能 `machine.md`),或用 comfyui 技能的 MCP/客户端工具;模板库与节点参考亦指路 comfyui 技能,不建 inventory 新机制。
3. **选模式**:按任务族选管线模式。八模式全清单(借鉴 mckruz/comfyui-expert,MIT:github.com/mckruz/comfyui-expert):T2I 文生图/身份保持(InstantID·PuLID)/LoRA 角色/图生视频(Wan·AnimateDiff 两路)/说话头/放大(UltimateSDUpscale)/重绘(Inpaint)。选定后按 ①-⑤ 排布。
4. **生成**:写 JSON(双格式);节点类型与输入先对 `/object_info` 验。
5. **验证**:类型全匹配;每输入=字面值或有效引用;有承载意图的输入节点+输出保存节点;先小图低分辨率试线再全量;布局按 ⑥ 验。

## 工具调用配方(本地 tools/ 两件;孤儿/清单两件仍驻 comfyui 技能)

本技能 `tools/` 捆绑两件通用工具:`workflow_layout.py`(归因副本,上游 SlavaSexton/ComfyUI-Agent-Kit,Apache-2.0;上游更新时以 comfyui 技能原件为准重新拷贝)与 `layout_check.py`(本技能自有立宪检查器)。入参 `wf`=GUI 格式工作流 dict(顶层含 `nodes`/`links`,即 `json.load` 读文件的结果;不是文件路径):

```python
import sys; sys.path.insert(0, "<repo>/.agents/skills/node-graph/tools")
import workflow_layout as wl
wl.inspect(wf)           # 报重叠/交叉/边界(近似读数,口径边界见头部声明)
wl.auto_layout(wf)       # 依赖深度左→右排布(仅非项目临时图;生产件禁 --apply)
wl.fit_group(wf, "组名")  # 加一个全罩组框(先排布后调用)
```

- `inspect()` 返回 `summary`(nodes/edges/overlaps/crossings/bounds)与明细;`overlaps` 必须为 0,`crossings` 只作粗计参考(立宪判据用 layout_check)。
- workflow_layout CLI 等价:`python3 .agents/skills/node-graph/tools/workflow_layout.py 图.json` 只读检查(打印 BEFORE 摘要);`--apply` 是就地重排旗标,仅限非项目临时图,生产件禁。

`tools/layout_check.py`=0928 立宪口径的可跑实现(数学逐式移植自生成器自查段,对拍过三件生产件基线;判定口径见 ④,验证定位见 ⑥):

```bash
python3 .agents/skills/node-graph/tools/layout_check.py 图.json            # 按域分报检查
python3 .agents/skills/node-graph/tools/layout_check.py 图.json --json     # 机读违规明细
python3 .agents/skills/node-graph/tools/layout_check.py --selftest         # 内嵌合成用例自测
```

- 检查项=④ 判定口径全集(贝塞尔交叉/线遮节点/est 盒零重叠/est 间距/零负区/输出口最右/左向线——七项,与工具 `CHECK_KEYS` 一致);顶层=scope main,`definitions.subgraphs[]` 每个=独立 scope(`sub:<名>`);−10/−20 边界线在交叉与遮挡两口径同跳过。
- **末行硬契约**:无论是否违规,最后一行恒打印 `LAYOUT_CHECK_JSON: {"scopes":[{"name":"main","crossings":N},...]}`——对拍脚本靠这行取数;`--json` 时各 scope 条目另含 `counts` 分项违规数明细。
- 参数:`--max-crossings N`=每 scope 交叉封顶(默认 0=立宪治理目标;棘轮现值**不内置**,生产棘轮驻生成器自查段);`--allow-leftward id1,id2`=左向线豁免清单(冻结回流线用,豁免须钉死见 ③)。违规 exit 1 并逐项打印;输入/用法错误 exit 2(不与违规混淆)。
- 孤儿节点与节点清单两件未捆绑,仍在 comfyui 技能原地调用:`python3 .agents/skills/comfyui/tools/find_orphan_nodes.py <工作流.json> [--prune]`(--prune 另出 .cleaned.json 不动原件;Note/广播/SetGet 类只报不剪)与 `python3 .agents/skills/comfyui/tools/node_inventory.py`(重生成节点目录 markdown,需引擎在线)。

## 纪律钩子

- 未提交真源(如 0928 立宪文档)只读引用不改;确需改共享真源,先过静默门并单独报备。静默门=改前 `stat` 目标文件 mtime,距今≥30 分钟(判定无并行会话正在写它)才动手;不满 30 分钟=可能有人正在写,等满或挂起。
- 速查层与真源冲突:真源胜,回改本技能;新布局裁定落账时按头部同步钩子同批更新。
- 子图对象格式与边界 links 登记等契约域:见 comfyui 技能 Subgraphs 章与 `apps/backend/engines/comfyui/tests/`。
- 生产工作流只读铁律与生成器路线:见 ⑦ 落地链。
