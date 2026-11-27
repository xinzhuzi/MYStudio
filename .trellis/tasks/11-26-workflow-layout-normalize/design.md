# 设计:节点图布局全量整治(分组互遮 / 节点出组框 / 间距过远)

Covers: R1 R2 R3 R4 R5 R6 R7 R8 R9 R10

> 1126 晚按实物复核后修订:判据由两键增至三键、写盘格式改为原样保留、蓝图映射改成逐件对照表、前端副本补全、棘轮基线时序改正、无解件处置写明、算法步骤对齐原型代码。修订依据见 `research/layout-pin-census-1126.md` 的「更正」节。
> 2026-11-27 用户裁决:Q1–Q4 与 A15 全部按推荐值定案(见 §0),裁决记录在 `grill-ledger.md` 第四节。

## 0. 参数(用户 2026-11-27 裁决:全部按推荐值定案)

| 编号 | 参数 | 裁决值 | 落点(各一处) |
|---|---|---|---|
| Q1 | 方案取向 | A 组框修复 + 保序压缩;不为长流水线大件折行重排(方案 B 不做) | 本文件 §1 |
| Q2 | 整治范围 | 除官方件 5、原件 2、收据钉死件 1 外全部 GUI 工作流(141 件)+ 子图蓝图 9 件;社区作者件、测试夹一并纳入 | `workflow_layout_normalize_campaign.py` 的 `EXCLUDE` |
| Q3 | 守门容差 | 交叉:每作用域允许增加 ≤ max(3, ⌈整治前 × 10%⌉);其余判据 0 | `workflow_layout_normalize_campaign.py` 的 `cross_tol()` |
| Q4 | 间距目标档 | 横 320 / 纵 180 | `layout_check.py` 的 `FAR_H_DEFAULT` / `FAR_V_DEFAULT`(整理层缺省值取自它) |
| A15 | 格式特殊件 `seethrough-layer-editor.json` | 接受整件重排格式:按缩进 2 把内联数组展开写回,行尾与末尾换行照原文件 | `workflow_layout_normalize_campaign.py` 的 `--apply --allow-reformat <相对键>` |

执行时只核对上表、不再讨论。日后要改其中任何一项,只改对应落点的常数与本表,算法与其余步骤不变。

## 1. 方案比较(三版;用户 2026-11-27 裁定选 A)

### 1.1 三版

| | **A 组框修复 + 保序压缩**(主推) | **B A + 大件折行重排** | **C 只修组框** |
|---|---|---|---|
| 治什么 | 分组互遮、节点出组框、贴边清零;过大的**空隙**收到目标档 | A 的全部 + 把长流水线折成两行,缩短整图 | 只有分组互遮、节点出组框、贴边 |
| 节点相对次序 | 不变(只收不推;分组必须分开处允许最小必要的推开) | **改变**:折行点之后的节点整体移到下一行 | 分组必须分开处可能有最小推开 |
| 实测效果 | 22 件主图面积减 10–74%(道劫主力件 t2i −31%、i2i −25%、img2img −68%、换脸 −47%);99 件 <10%;「整图缩放 <0.5」件数 93→92 | 大件整图缩放可翻倍(未做原型验证) | 间距零改善 |
| 风险 | 低:恒等档逐坐标恒等;每件可按 git 单独回退;代价是交叉 +0–7 对/文件 | 高:交叉数不可控、钉死面大量重锚、破坏作者手排、无原型 | 最低 |
| 依赖的用户裁决 | Q2 Q3 Q4 | Q2 Q3 + 每个大件逐件批准 | Q2 |

选 A 意味着:29 件长流水线件整治后整图缩放仍 <0.25,属已知并接受的结果,报告单列,不在本役处理。

### 1.2 三透镜(对主推方案 A)

**二阶三阶影响**
- 契约锚随行:坐标/组框哨兵要按新坐标重锚;重锚时若发现「关系」被破坏(如说明卡不再高于组框),说明整理器违了保序,回头修整理器而不是改测试。
- 生成器重跑会把布局打回旧值:生成器的 `render()` 接入整理器,并由「不动点」检查把门(§5),谁重跑谁红。
- 检查器修叉积 epsilon 后交叉数只会降;棘轮基线要与工作流**同一笔提交**更新(§6 P4)。
- 前端界面图跟着变:`h3-multiseg-template.json` 由画布件生成,画布件变了就要重生成并过 vitest(§6 P7)。
- 用户心智地图:次序不变、只是更紧,旧位置仍找得到;但习惯性的「空白处放临时节点」的位置会变。

**跨领域类比**
- 码编辑器的代码格式化(formatter):只调整空白,不改语义;幂等;有争议的样式交给配置文件。本设计同构——只动布局字段、幂等、目标档是配置。
- 电子设计自动化里的一维布局压缩:保序约束 + 最长路径求解是标准做法,可行性与确定性有成熟理论保证(差分约束 + 拓扑最长路径)。
- 约束求解器(Cassowary,Auto Layout 背后):「必须满足」与「尽量靠近原位」分级。本设计用差分约束近似;组框必须分开时的推开方向按「多数成员原方位」定。

**最强反对者**
- 「压完还是看不清,白做」——属实:保序压缩解决不了流水线长度(F13)。应对:报告里把「整治后整图缩放仍 <0.25」的件单列;用户 2026-11-27 裁定不走方案 B;不夸大效果。
- 「交叉变多违背立宪第一优先级」——属实:旗舰件 +1~+7 对。应对:这是 Q3 的取舍;容差 0(严格)时这些件只修组框不压缩,立宪不被破。
- 「用户手排被覆盖」——次序全保、只收空隙,且逐件可回退;主图 `extra.ds` 视图态会变(设为适配全图),属改善。
- 「组框被改小」——原框比成员松的会收拢到成员(立宪 §⑤ 公式),这是有意的;想保留松框的件可逐件回退。
- 「斜向摆放的远节点没人管」——管:节点对约束对每一对节点生效,斜向的远节点对会沿两轴各收到目标档;只是判据 `spacing_far` 只数同排/同列相邻对,报告数字是下界(§3)。

## 2. 架构与边界

```text
┌─ 判据层(技能工具)  .agents/skills/node-graph/tools/layout_check.py
│   新增 node_out_of_group / edge_tight / spacing_far(选开);checks= 轻量档;
│   修叉积 epsilon 与混合 id;留白与目标档常量的单一真源
├─ 整理层(技能工具)  .agents/skills/node-graph/tools/layout_normalize.py
│   纯函数:survey / normalize / strip_layout;零项目专名;CLI 只读默认
├─ 批处理层(项目脚本)  apps/build/scripts/workflow_layout_normalize_campaign.py
│   扫两个根 → 逐件 normalize → 结构对拍 → 幂等复核 → 原格式写回;出报告;fail-closed
├─ 同步层             生成器 render() 接入 normalize;蓝图/前端副本/守护 SHA/基线/哨兵随行
└─ 门禁层             apps/backend/comfyui/tests/test_workflow_layout_gate.py
                      轻量档(默认常开)+ 不动点全量档(环境变量开启);挂进 workflow_gate 段 2
```

职责边界:
- 判据层与整理层**不含**任何项目专名(模型名、文件名、目录名),参数全部由调用方传入——0928 R14「通用代码入技能」。
- 批处理层持有项目事实:两个根、排除清单、容差、报告路径、写盘格式。
- 整理层不写盘;批处理层不实现算法。

整治对象(「GUI 件」)= 下列两个根下带非空 `nodes` 列表的文件;下文路径键一律相对 `apps/backend/comfyui/`:
- `workflows/` 下 149 件(主图 + 子图定义,共 201 个作用域);
- `my_nodes/subgraphs/` 下 9 件 qi21 子图蓝图(顶层 1 个实例节点 + 1 个子图定义,共 18 个作用域)。

## 3. 判据口径(新增三个,选开;既有判据与 `counts` 键集不变)

既有消费者(`workflow_gate.py`、`qi21_local_face_mask_repair_1027.py`、各契约测试)直接遍历 `counts`;新增判据放进每个作用域报告的独立键 `layout`,**只在调用方传入 `layout=` 参数时才计算**,既有消费者行为逐位不变。

| 判据 | 计数单位 | 口径 |
|---|---|---|
| `node_out_of_group` | 违规节点数 | 对每个非 Reroute 节点 N(可视盒 = `layout_check._occl_box()`:声明 `size`,Reroute 固定 60×30,缺 size 回落 220×120)与每个带 `bounding` 的组框 G:两者相交且 N 未完整落在 G 内 → N 计 1(对多个组框相交仍只计 1)。明细列出节点 id 与组框标题 |
| `edge_tight` | 贴边节点数 | 对每个非 Reroute 节点 N 与它完整落在其中的组框 G:任一侧留白小于 `GROUP_PAD`(左 30 / 上 50 / 右 30 / 下 30)→ N 计 1 |
| `spacing_far` | 过远相邻对数 | 非 Reroute / MarkdownNote 节点(同 `est_spacing` 的豁免口径 `SPACING_EXEMPT_TYPES`)。「同排相邻」= 纵向投影有交叠、且 B 是 A 右侧最近的非豁免节点;「同列相邻」= 横向投影有交叠、且 B 是 A 下方最近的。可视净隙 > `ht`(同排)或 > `vt`(同列)计 1;等于阈值不计。斜向的远节点对不计入 |

`spacing_far` 的验收是**不动点**(文件 = `normalize(文件)`),不是清零:同排两端隔着整条流水线的节点对(研究档 §4.3)在保序压缩下必然仍「远」,这是流水线长度不是空隙。

守门(逐作用域,整治前 vs 整治后):`crossings` 增量 ≤ Q3 容差;`occlusion`、`leftward`、`est_overlap`、`est_spacing`、`negative_region`、`output_rightmost` 增量 = 0;整治后 `group_overlap`、`node_out_of_group`、`edge_tight` 均为 0。

检查器修正:
- **叉积 epsilon**:`_seg_int` 四个叉积先过 `sign_eps(d)`(`|d| ≤ 1e-7` 记 0);两侧符号严格相反才计相交。效果:共线/端点相切的线对不再被浮点噪声判成交叉;计数只会降。实据:5 节点 4 线的最小夹具整体下移 0–4px,现状交叉数 `[0, 3, 0, 3, 3]`,修正后应恒为 0。
- **混合 id**:遮挡分支 `sorted(hit)` 改 `sorted(hit, key=str)`;节点 id 的字符串/整数混用不再抛错。

接口(`layout_check.py`):
```python
LAYOUT_KEYS = ("node_out_of_group", "edge_tight", "spacing_far")
GROUP_PAD = (30.0, 50.0, 30.0, 30.0)          # 左 上 右 下;立宪 §⑤ 组框公式的单一真源
FAR_H_DEFAULT = 320.0                          # 同排目标档缺省值(Q4 裁决落点)
FAR_V_DEFAULT = 180.0                          # 同列目标档缺省值

def check_scope(name, nodes, links, sg, max_crossings=0, allow_leftward=frozenset(),
                groups=None, layout=None, checks=None)
def check_workflow(wf, max_crossings=0, allow_leftward=frozenset(), layout=None, checks=None)
```
- `layout=None`(缺省):三个新判据不算,作用域报告 = `{"name", "counts", "violations"}`,与现在逐位相同。
- `layout={"ht": 320, "vt": 180}`:作用域报告多一个 `"layout": {"node_out_of_group": n, "edge_tight": n, "spacing_far": n}`;`ht` / `vt` 缺省取 `FAR_H_DEFAULT` / `FAR_V_DEFAULT`。
- `checks=None`(缺省):算全部既有判据。`checks=("group_overlap",)`:只算列出的既有判据,其余既不计也不进 `violations`、`counts` 里不出现——机器门的轻量档靠它(全库只算线交叉/线遮要 47.5 秒,只算组框与三个新判据预计数秒)。
- CLI 新增 `--layout`(开启新判据)、`--far-h N`、`--far-v N`、`--only a,b,c`(轻量档)。带 `--layout` 时末行 `LAYOUT_CHECK_JSON:` 每个作用域条目多一个 `"layout"` 键;不带时末行逐字节不变。`--selftest` 后可跟用例名(逗号分隔)只跑指定用例。

## 4. 保序压缩算法(`layout_normalize.py`)

对每个作用域独立执行;作用域划分与命名直接复用 `layout_check._scopes()`(`main` 与 `sub:<子图名>`)。差分约束与求解的推导、原型试验见 `research/opcc-feasibility-1126.md`;下列取整、原点、边界槽、视图态四条取自原型里实测过的写法。

1. **盒模型**:可视盒 = `layout_check._occl_box()`;est 盒 = `workflow_layout.est_size`。外溢 `over(i, 轴)` = max(0, est 尺寸 − 可视尺寸)。
2. **解叠(默认关,`PARAMS["UNSTACK"]=False`)**:开启时,可视盒真重叠的节点对沿侵入最浅的轴把连线少的挪到最近合法空位。默认只在 `survey` 里报出真重叠对数(假设清单 A11)。
3. **成员判定**(与画布前端同口径——节点完整落在组框内才算组员),对所有节点一视同仁(含 Reroute、Note):
   - 完整落在恰好一个组框内 → 该组成员;
   - 完整落在多个组框内(两组本就互遮)→ 归面积最小的组;
   - 不完整落在任何组框内、但可视盒**中心**落在某个组框内 → 收编为该组成员(落在多个里取面积最小的组);
   - 其余 → 无组节点。
   Reroute 只在判据 `node_out_of_group` / `edge_tight` 里豁免;作为组成员时照常随组移动、计入组框。
4. **组框重算**(修 R2、R3 的第一步):每个组的框 = 成员可视盒包围盒 + `GROUP_PAD`。出框与贴边随之消失;原本画得比成员松的框收拢到成员(立宪 §⑤ 公式)。没有任何成员的空组:框保持原样,作为一个整体参与第 7 步的不重叠分离。
5. **出框处置**:无组节点与某个组框相交 → 推到框外(净隙 ≥ 0 的最小位移,离哪侧近往哪侧),不编组(第 3 步已把「视觉上在组里」的收编,剩下的本是框外的)。
6. **节点对约束**(每轴;对**每一对**节点,含 Reroute 与 Note——它们必须跟着邻件走,否则线会被拉歪;只在压缩档位加,`inf` 档不加):
   - 该轴上 A 在 B 左(或上):`B ≥ A + A 的该轴可视尺寸 + min(原可视净隙, max(目标, 下限))`。取小 = 只收不推。
   - 下限保证 est 不新增违规,按 est 盒关系取:该轴 est 净距 ≥ 立宪下限(`ROW_GAP_MIN` 200 / `COL_GAP_MIN` 80)→ 下限 = 立宪下限 + 外溢;est 净距在 [0, 下限) → 下限 = 外溢(不变成 est 重叠);两轴都分开(斜向对,est 规则不管)→ 下限 = `DIAG_MIN`(20);任一方是 Reroute / MarkdownNote(`SPACING_EXEMPT_TYPES`,est 间距豁免)→ 下限 = `EXEMPT_MIN`(20)。
   - 该轴上两盒投影交叠:相对位置刚性保持(双向不等式)——同列对齐、行内错位因此原样保留。
7. **组约束**:
   - 组与组互遮:按多数成员对的方位所在轴加分离约束(票数相同优先横向,顺序 左、右、上、下;空组没有成员对,按两个框中心的相对方位定),被推开的是该方位上「靠后」的那一组(整组平移),净隙 ≥ `G_MIN`(50)。**这是全算法唯一允许「推」的地方**(R2 要求零互遮,而两组的框都由成员决定)。
   - 成员互相穿插的组对(两轴都交叠、各有成员在对方另一侧):先放开这两组成员之间沿分离轴的次序约束(两组之间的相对次序允许改变,组内次序不变),仍不可解才并组(第 9 步)。
   - 非成员与组:保持原间距(只收不推);被留白外扩卷入的非成员按第 5 步推出。
8. **求解与线遮修补**:强连通缩点 + 最长路径(最小不动点);正环 = 不可解。解后新增「线穿节点」时**不挪被穿节点**(1127 返工:首版照「推到线下方」实现,线的端点随被推的刚性块一起下移,形成追赶,把 fasth3 两件摊到 4.6 倍、道劫设定卡 i2i 摊到 2.9 倍),改为把该线两端点与被穿节点三者的相对位置**冻结**(双向刚性约束,取整治前偏移)——整治前不穿,相对位置不变就不穿;解不出、或冻结后仍有新增线穿,则本作用域升一档。
9. **档位梯子(逐作用域)**:目标档 × `(1, 1.5, 2, inf)`,取第一个过第 10 步守门的档。`inf` 档 = 不压缩,只做第 3–5、7 步(修组框与出框)。四档都不过 → 换分离方向:其余三个方位各跑一轮梯子(只在作用域里恰有一对组需要分离时穷举;多对同时冲突时按投票方位定,不穷举);四个方向都不过 → 对冲突的组对并组(标题「A + B」)后从最紧档重试一轮;仍不过 → 该作用域记「无解」。`ladder` 为空 → 直接记「无解」。**压缩档的结果在任一轴上的节点包围尺寸都不得超过只修组框档的结果**(「只收不推」的作用域级硬约束,1127 返工新增;只修组框档先解,作为压缩档的上限)。
10. **守门**:按 §3 口径逐作用域比对整治前后。
11. **收尾**:
   - 取整:解出的坐标与原坐标相同(误差 < 1e-6)时沿用原值(整数、浮点都保持原样),否则向上取整;组框写成 `[floor(左), floor(上), ceil(宽), ceil(高)]`。
   - 原点:求解时每个变量以 `ORIGIN`(80)为下界,解完整体平移——原最小坐标 ≥ 80 时平移回原最小值(不动);原最小坐标 < 80 时让最小坐标 = 80。只看节点坐标,边界槽不算。
   - 子图边界槽重钉(随成员整体平移,槽间原有的纵向间隔保留):入口 x = 成员最小 x − `IO_IN`(180),出口 x = 成员最大右缘 + `IO_OUT`(80);入口、出口各自的 y 序列 = 原 y 序列减去该序列最小值,再加上成员最小 y + 25。没有原 `pos` 的槽不补。
   - 主图 `extra.ds` 设为「打开即见全貌」(子图定义内的 `extra.ds` 不动)。取主图节点可视盒的包围盒(左上角 `(x0, y0)`,宽 `W`,高 `H`):`scale = round(min(1, 1520 / W, 820 / H), 3)`;`offset = [round((1600 − W × scale) / 2 − x0 × scale), round((900 − H × scale) / 2 − y0 × scale)]`。现有文件里该字段的形态是 `{"scale": 数值, "offset": [x, y]}`(102 件有、45 件没有、2 件为空对象),照此形态写。

性质(自测覆盖):相对次序全保(第 7 步明许的除外);恒等档逐坐标恒等;幂等;只动布局字段;不可解时返回 `None` 而不是半成品。

接口(`layout_normalize.py`):
```python
from layout_check import (GROUP_PAD, FAR_H_DEFAULT, FAR_V_DEFAULT, ROW_GAP_MIN, COL_GAP_MIN,
                          POS_MIN, SPACING_EXEMPT_TYPES, est_size, _scopes, _occl_box, check_workflow)

PARAMS = {"H_T": FAR_H_DEFAULT, "V_T": FAR_V_DEFAULT, "H_MIN": ROW_GAP_MIN, "V_MIN": COL_GAP_MIN,
          "DIAG_MIN": 20.0, "EXEMPT_MIN": 20.0, "PAD": GROUP_PAD, "G_GAP": 60.0, "G_MIN": 50.0,
          "ORIGIN": POS_MIN, "IO_IN": 180.0, "IO_OUT": 80.0, "UNSTACK": False}
LADDER = (1.0, 1.5, 2.0, float("inf"))

def survey(wf, params=PARAMS) -> dict
#   只读。{"<作用域名>": {"node_out_of_group": n, "edge_tight": n, "spacing_far": n, "visual_overlaps": n}}
def normalize(wf, params=PARAMS, ladder=LADDER, tol=None) -> tuple[dict | None, dict]
#   tol:None = 全部判据零增量(立宪严格);
#        dict = {判据名: 允许增量},对所有作用域相同;
#        callable = (作用域名, 整治前 counts) -> {判据名: 允许增量}。
#   返回 (新文档 或 None, 报告)。输入不是带 nodes 列表的字典 → 原样返回 (wf, {"scopes": {}, "applied": False})。
#   任一作用域无解 → (None, 报告),不出半成品。
def strip_layout(wf) -> dict
def selftest(cases=None) -> int
```
报告结构(逐作用域):
```python
{"applied": bool,                       # 结果与输入有差异(已是不动点时为 False)
 "scopes": {"<作用域名>": {"rung": "1" | "1.5" | "2" | "inf",
                           "before": {判据名: 整数},   # 既有 counts ∪ layout 三键
                           "after": {判据名: 整数},
                           "merges": 整数,              # 并组次数
                           "unresolvable": bool}}}
```
`strip_layout` 剔除的路径(其余任何差异都会被结构对拍拦下):`nodes[].pos`、`groups[].bounding`、文档顶层 `extra.ds`、`definitions.subgraphs[].nodes[].pos`、`definitions.subgraphs[].groups[].bounding`、`definitions.subgraphs[].inputs[].pos`、`definitions.subgraphs[].outputs[].pos`。**不剔除 `size`**:本役不改 `size`,由对拍保证。

CLI:`<wf.json>` 默认只读报告;`--apply` 写回时,若路径含 `comfyui/workflows` 或 `comfyui/my_nodes/subgraphs` 且没有 `--allow-prod` 则拒绝并退出 3;另有 `--ht`、`--vt`、`--json`、`--selftest [用例名,…]`。

## 5. 数据流与文件契约

两个根:`apps/backend/comfyui/workflows/` 与 `apps/backend/comfyui/my_nodes/subgraphs/`。

1. `workflow_layout_normalize_campaign.py --check`:扫两个根,取 GUI 件,剔除 `EXCLUDE`;逐件 `survey` + 试算 `normalize`(不写盘);出 `apps/output/automation/workflow-layout-report.json` 与同名 `.md`。报告逐件逐作用域列整治前后数字、所选档位、并组次数,并单列五张清单:「只修组框未压缩」(档位 `inf`)、「并组过」、「无解未写」、「格式特殊未写」、「整治后整图缩放仍 <0.25」。整图缩放 = `min(1600 / W, 900 / H)`,W、H 取主图节点可视盒与组框并集包围盒的宽高(与调研档同一算法),整治后重算。
2. **不动点**(R4 的验收口径):`normalize(读入件)` 的结果与读入件**解析后深度相等**。`--check` 报出「非不动点 N 件」。
3. `--apply`,逐件:
   - `normalize` 返回 `None` → 不写,进「无解未写」;
   - `strip_layout(新) == strip_layout(旧)`,不等 → 不写,报红;
   - 再 `normalize(新)` 须与 `新` 深度相等(幂等),不等 → 不写,报红;
   - 新旧深度相等 → 不写(没有改动就不碰文件);
   - 写盘前对**原文件**做格式还原对拍(第 4 点),还原不了且未获准重排 → 不写,进「格式特殊未写」;已获准重排的件(带 `--allow-reformat`)跳过还原对拍,按第 4 点重排写入;
   - 写盘,读回后 `json.loads` 与新文档深度相等。
   退出码:`--apply` 遇完整性失败(结构对拍不等、幂等不成立、读写异常)或内部异常 → 1,其余 → 0。无解件与格式特殊件不算失败,照常进清单——它们由机器门和不动点检查接着盯,不让一次婉拒把以后每次 `--apply` 都染红。`--check` 恒退出 0(只读)。
4. **写盘格式 = 原样保留每件自己的格式**(1126 实测 149 件的分布:缩进 1 空格 26 件、2 空格 112 件、单行 11 件;CRLF 3 件;无末尾换行 77 件;蓝图 9 件都是缩进 2):
   - 多行件:`json.dumps(doc, ensure_ascii=False, indent=<原缩进>)`,原缩进 = 文件第 2 行前导空格数,须为 1、2、4 之一;
   - 单行件(全文只有一个非空行):`json.dumps(doc, ensure_ascii=False, separators=(",", ":"))`;
   - 原文件含 `\r\n` 则把 `\n` 全部换成 `\r\n`;原文件末尾有换行才补一个换行;
   - **格式还原对拍**:先用同一套规则把原文件读入再写出,须与原字节逐字节相等。实测 158 件里 157 件可还原;唯一还原不了的是 `workflows/1_图片/SeeThrough/seethrough-layer-editor.json`(缩进 2 但数组内联写成一行;它只有间距问题:9 节点、无组框)。用户 2026-11-27 裁决接受这一件整件重排:`--apply` 时带 `--allow-reformat <相对键>`,按缩进 2 把内联数组展开写回(行尾、末尾换行照原文件;只动空白,解析后内容只差布局字段),报告里仍列进「格式特殊」清单并注明「已按裁决重排写入」。其余格式特殊件(现为 0 件)仍不写、单列呈报。
5. `--write-far-baseline`:把整治后逐件逐作用域的 `spacing_far` 写进 `apps/backend/comfyui/tests/fixtures/workflow_layout_far_baseline.json`;只增新件或调低既有值,调高即报错(只降不升)。
6. 随后执行 §6 的钉死面同步,再跑全量测试。

布局字段白名单(R6)= `strip_layout` 剔除的路径(§4 接口段)。

## 6. 钉死面同步(按 `research/layout-pin-census-1126.md`)

| 类 | 同步动作 |
|---|---|
| P1 生成器重导出(`sn-道劫` 4 件、`sn-局部重绘` 2 件) | `sensenova_daojie_build_1126.py` 的 `render(obj)`:对象是带非空 `nodes` 列表的字典时先 `normalize(obj, tol=<与批处理同式的容差>)`,取到 `None` 用原对象;API 件无 `nodes`,原样。`sn_local_inpaint_build_1126.py` 的 `main()` 里本地 `render` 改为 `return g.render(obj)`。契约测试「文件字节 == `gen.render(obj)`」与「两次构建字节相同」不用改 |
| P3 守护脚本已审 SHA(换脸件) | 把 `qi21_local_face_mask_repair_1027.py` 的 `PATCHED_SHA256` 换成整治后文件的 sha256(小写十六进制) |
| P4 棘轮基线(qi21 三件) | `workflow_gate.py` 段 3 从**已提交版本**取数、三件有未提交改动时整段跳过。所以基线必须与工作流**同一笔提交**更新:按报告里整治后的逐作用域实测数改 `workflow_layout_baseline.json` 的 `files`(降了照降;按 Q3 容差升的照升,并在该文件顶层加 `"ruling"` 键写明「用户裁决 + 日期」——段 3 只读 `files`,多一个键无影响)。提交前跑 `npm run test:workflow` 只能看到段 3 SKIP,提交后才真跑 |
| P5 坐标/组框哨兵 | 跑测试,逐条看红的断言:「关系」仍成立只是数值变 → 改测试里的数值常量,行尾注「布局整治重锚」;「关系」不成立 → 回整理器修。测试文件:`test_qwen21_workflow_contract.py`(83 处)、`test_qi21_local_face_contract.py`、`test_daojie_sheet_card_workflow.py`、`test_daojie_sheet_card_qwen_workflow.py`、`test_three_stage_contract.py`、`test_multiseg_full3stage_contract.py`、`apps/frontend/lib/comfyui/h3/h3-shot-video-workflow.test.ts` |
| P6 蓝图 ↔ 宿主子图定义 | 子图名在多个工作流里重名(「道劫·加速子图」在 6 件里都有定义),**不能按名字找宿主**,按下面的对照表逐件同步 |
| P7 前端副本 | 同字节副本 3 件 + 生成件 1 件,见下 |
| P8 生成器属主 | `qi21-局部重绘.json` 自 `qi21-edit.json` 派生:`qi21-edit.json` 整治后重跑 `qi21_local_inpaint_build_1126.py`,再 `--apply --only` 该件;其余生成器(`moss_daojie_build_1108.py`、设定卡生成器)只重导出数据、不钉画布字节,靠不动点检查兜底 |
| R10 脚本命名(非钉死面,顺带列此) | `scripts-hygiene-exemptions.json` 登记;`git rm` 落后的脚本 |

**P6 蓝图同步对照表**(「取哪个宿主」= 把该宿主文件里同名的子图定义拷进蓝图):

| 蓝图(`my_nodes/subgraphs/`) | 取哪个宿主 | 钉它的测试 |
|---|---|---|
| `qi21-提示词类型优化子图.json` | `qi21-道劫-t2i.json` | `test_blueprint_definition_matches_host_subgraph` |
| `qi21-提示词类型优化子图-i2i.json` | `qi21-道劫-i2i.json` | `test_qi21_i2i_host_widgets.py`(结构) |
| `qi21-提示词类型优化子图-edit.json` | `qi21-edit.json` | 无按名测试;照命名对应同步 |
| `qi21-道劫-加速子图.json` / `-i2i` / `-edit` | `qi21-道劫-t2i.json` / `qi21-道劫-i2i.json` / `qi21-edit.json` | `TestAccelBlueprintAnchors1016` |
| `qi21-道劫-超分-SeedVR2.json` | `qi21-道劫-t2i.json` 与 `qi21-道劫-i2i.json`(两宿主须一致) | `TestUpscaleBlueprintAnchors1017` |
| `qi21-道劫-洗底-透明除渣.json` | 同上两宿主 | `WASH_BP` 相关断言 |
| `qi21-道劫-二采精修子图.json` | **库里无同名宿主定义** | 只受「groups 恒空」断言约束;由批处理直接整治 |

同步规则(每件):蓝图 `definitions.subgraphs[0]` 换成宿主里同名定义的深拷贝;`id` 用蓝图原来的;蓝图独有的键(如 `category`)原值保留;**不新增宿主没有的键**。蓝图顶层 `nodes[0]`(实例节点)不动。写盘按 §5.4 的原格式规则。蓝图文件先由批处理直接整治(结果与宿主确定性一致),再做本步,保证「除 id 外全等」。本步由批处理脚本的 `--sync-blueprints` 子命令执行,不手改、不用临时脚本:每件先做前置断言(蓝图现行定义与**已提交版本**的宿主定义除 `id`、`state`、`last_link_id` 外全等;不等则该件不写并报 `pre_drift`),同步后做结构对拍(剔除布局字段后新旧相等),再按原格式写回;重复执行结果为「无变化」。

**P7 前端副本**:

| 仓库件 | 前端件 | 同步方式 | 钉它的测试 |
|---|---|---|---|
| `fasth3-单镜视频-i2v.json` | `apps/frontend/lib/comfyui/h3/templates/fasth3-shot-template.json` | 逐字节复制 | `test_fasth3_pipeline_wiring.py` |
| `pika-单镜视频-fl2v.json` | `…/templates/pika-shot-template.json` | 逐字节复制 | `test_pika_mainline_contract.py` |
| `pika-单镜视频-ref2v.json` | `…/templates/pika-ref-shot-template.json` | 逐字节复制 | `test_pika_ref2va_contract.py` |
| `一镜到底-分段.json` | `…/templates/h3-multiseg-template.json` | 重跑 `apps/build/scripts/multiseg_ui_template_build.py` | `test_workflow_template_sync.py`、`h3-shot-video-workflow.test.ts` |

`h3-multiseg-template.json` 的坑:界面图 = 画布件原件 + App 专用三节点(#9、#103、#800),生成器按固定偏移落这三件并加宽 17 号组框罩住 #103。vitest 要求:画布件每个节点坐标与界面图逐一相等;组框除 17 号宽度外与画布件相同;三个专用节点都在某个组框内且上缘留 40;四条专用连线向右。画布件整治后这三件的落位可能不再满足 → **改的是界面图生成器里的落位偏移,不改画布件迁就**;生成器调不出合规落位 → 该画布件退到只修组框(档位 `inf`)后重试,仍不行则呈报用户。

## 7. 兼容性

- 老前端(≤1.51.x)把 `pos` / `size` 写成字符串键字典:`_pos` / `_size_wh` 已兼容;整理层写回统一写成列表。
- 节点 id 字符串/整数混用:整理层所有按 id 的排序用 `key=str`,映射用原值。
- `widgets_values_named`、`links` 表、`mode`、`flags` 一律原样(结构对拍把门)。
- 子图边界槽 `pos` 是装载时重算的装饰字段(COGNITION §3 ④),重钉只影响检查器的「输出口最右 / 恒向右」判据。
- 顶层 `extra.ds`:既有测试与前端代码都不读它(`rg 'extra\.ds|"ds"'` 零命中)。
- 文件格式逐件保留(§5.4),不给没改动的文件制造格式差异。

## 8. 取舍

| 取舍 | 选 | 代价 / 理由 |
|---|---|---|
| 可视盒 vs est 盒定组框与间距 | 可视盒 | est 偏大一倍(UNETLoader 84 vs 172),按 est 定会把紧凑列撑开;est 只守下限 |
| 最小不动点(整体贴左上)vs 最小位移 | 最小不动点 + 刚性保持 | 实现简单、确定性;刚性保持补上「不吸平作者手排」;组框必须分开处才推开 |
| 组框重算 vs 只外扩不收拢 | 重算 | 立宪 §⑤ 是等式不是下限;松框会挡住组间压缩;代价是作者的松框被收拢(可逐件回退) |
| 节点对约束管每一对 vs 只管同排同列对 | 每一对 | 斜向的远节点对也要收拢;同排同列之外的次序关系同样保住 |
| 线带约束单列 vs 不单列 | 不单列 | 原型的线带约束(节点不进入原本在其上/下的线带)被「每一对的次序约束 + 刚性」蕴含:节点与端点纵向投影交叠则偏移刚性、不相交则次序约束把它隔在端点之外。守门兜底:若推导有漏,新增线遮会被守门挡下并升档 |
| 整件统一档 vs 逐作用域选档 | 逐作用域 | 一个子图过不了守门不再拖累整个文件(原型缺陷 f) |
| 新判据进 `counts` vs 独立 `layout` 键 | 独立且选开 | 既有消费者零行为变化 |
| 机器门默认跑全量 vs 轻量档 | 轻量档常开 + 全量档按需 | 全量 47.5 秒/次太重;轻量档只守三类问题,线交叉/线遮仍归棘轮与批处理脚本 |
| 不动点检查进默认 pytest vs 环境变量开启 | 环境变量开启 | 全库 normalize 原型实测 5 分钟/轮;默认跑会拖垮 `test:py`;批处理脚本 `--check` 每次都报 |
| 无解件写半成品 vs 不写 | 不写、呈报 | R2/R3 与守门不可兼得时由用户取舍,不替用户定 |
| 修检查器 epsilon 随本役做 | 是 | 不修则守门与棘轮都带 ±3 噪声;计数只降,可逆 |
| 解叠默认开 vs 关 | 关 | 社区件常把闲置节点堆成一摞,拆开撑大 79%;由用户定(A11) |

## 9. 回滚与运维

- 整治前先出清单:`--check` 报告落盘;`--apply` 对将改动的每件在报告里记路径与整治前 sha256(`before_sha256`)。
- 回滚单位 = 一个文件:`git checkout -- <路径>`;整批还原 `git checkout -- apps/backend/comfyui/workflows apps/backend/comfyui/my_nodes/subgraphs apps/frontend/lib/comfyui/h3/templates`。提交按路径分笔(判据层 / 整理层 / 批处理 / 门禁 / 整治与钉死面同步 / 命名与规范),每笔可独立 revert;工作流与棘轮基线、蓝图、前端副本必须同一批提交(否则对应测试红)。
- 装机回滚 = 用上一个发布包覆盖安装;本役不直接写装机 App(P11)。
- 外部状态变化只发生在:`--apply` 写仓库文件;其后的测试/基线/蓝图/模板同步都在仓库内。打包与 Windows 部署须用户明令。
- 运维:新增工作流、重跑生成器或改动布局后跑 `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --check`;红了跑 `--apply --only <路径>` 再 `--write-far-baseline`。新增布局裁定(目标档、留白、组间距)只改 `layout_check` 的常量与 `layout_normalize.PARAMS`,并按 R13 同批更新技能布局策略章与立宪文档。

## 10. 1127 返工:压缩放大缺陷

- **现象**:首版执行后按实物对拍(只算节点),全库包围面积 238983→251920 万像素(+5%),缩小 ≥10% 仅 7 件、变大 13 件(fasth3-单镜视频-i2v/t2v 685→3164、道劫-角色设定卡-i2i 6672→19430),相邻过远对 1497→1518。互遮/出框/贴边三项收敛,但「间距」没解决——违反 R4「只收不推」。
- **根因**:第 8 步首版修补把被穿节点往线下方推,落点取该线在节点竖列内的最低点;线端点属于同一刚性块随之下移,修补追着推(上限 12 轮);第 10 步守门不查尺寸,放行。对照实验:fasth3 件只修组框档不动,开压缩档下半区整块下移 5624px。
- **修法(第一轮,1127 晚)**:最小反例(2 节点+1 空组框+0 连线即复现)推翻「线遮修补」主因定谳——真因=压缩档把**空组框当绝对常量**,给其右/下方的节点挂绝对坐标下界,自由节点向原点收拢、被锚节点不动,收尾整体平移把被锚侧甩出(类似:一排人手拉手左移,几个人被绑在柱子上,对齐左端后被绑者被拉出老远)。修法=空组框改为同相对坐标系的刚体伪节点一起收拢;`_finish_with_gate` 加 `ceiling`(只修组框档的节点包围尺寸)硬上限;`_ladder_round` 先解只修组框档当基准;线遮修补虽非主因也一并改为「不挪被穿节点、冻结线端点相对位置」。
- **第一轮实测(dry-newtool.json,149 件只读)**:全库面积 −3.2%(原 +5%),applied 141、无解 8、并组 16 件/34 次;**仍放大 12 件**(单镜-pi-H3 +33%、社区-H3小脸修复-矩形 +89%、sn-局部重绘 +17%、社区-Easy-两段精修 +20%、K2-NSFW旧版 +12% 等),放大全部发生在只修组框基准内(出框推开/组分离平移/并组/空框伴飞边),压缩档被 ceiling 拦住。
- **修法(第二轮)**:逐对投票改为**按互搭连通分量的一维扫掠**——每分量沿一轴按原中心序依次推开(每次只清掉已放置的框,G_MIN 间隙),两轴×两向四变体取总平移最小;`forced` 可钉死方向;`_push_dir` 废弃删除。第一版钉轴不钉向+空组框记入分离对,分别修(N20 最小推自测、空推边跳过)。第三轮试过「变体键=分量包围盒增量」并**回退**:分量局部最优导致全局更差(单镜-pi-H3 +0%→+33%),维持总平移键并留档注释。第二轮的 `_push_dir` 最小推在两段精修上与线遮零新增冲突(下推 36px 会压线),由扫掠+守门+梯子自然处理。
- **放大件定谳(逐件归因,1127 晚)**:仍放大的件全部对应整治前的 R2/R3/负区存量——出框节点 1–26 个、互遮 1–2 对、负坐标节点 2–35 个(如 社区-H3小脸修复-矩形:11 个出框+19 个负坐标,推开 835px 是最浅侵入;K2-NSFW旧版0901:4 组框挤 1467px 窄带+2 对互遮+6 出框,重算必纵向铺开;单镜-pi-H3:组框原画不准,重算收拢/扩框改变互搭关系,扫掠整组下移 2690)。**这些是修互遮/出框的必要代价,不是工具缺陷**;逐件数字见 dry 报告,呈报用户判定。
- **验收口径(修订)**:全库主图总面积不增;放大件逐件注明归因(出框推开/组分离/并组/负区平移)并留「整治前三类存量」证据;主力件(道劫 t2i/i2i/edit、单镜、一镜到底、换脸)全部不放大。
- **验收补充**(AC4 追加):逐件实测整治前后节点包围面积与整图缩放,任一件任一轴不得大于只修组框档;全库总面积不得大于整治前。

### §10.1 返工终态数字(dry-final2 + 提交后,2026-11-27)

- 互遮 28→7、出框 143→26、贴边 755→91(余量全在 8 无解件);全库主图面积 −4.5%(229.4→219.0 亿像素²);缩小 ≥10% 7 件(pika-ref2v −48%、moss-图像编辑 −37%、道劫 t2i −30%、换脸 −29%、道劫 i2i −15% 等);放大 10 件逐件归因为 R2/R3/负区必要推开(见 §10);主力件全部不放大(edit/一镜到底 0%、单镜 −1%)。
- 139 件写入;fasth3-i2v/t2v 解 12 轮迭代不收敛 → 幂等闸 fail-closed 保留原状,钉册登记(现状只降不升);8 件无解照旧。
- 提交:a44a5029(工具返工)+ 笔2(36 件重跑产物与同步);提交后 test:workflow 段 2/3/4 全 PASSED(棘轮含 t2i 加速子图 43 容差内收录)。

### §10.2 返工行为规范(1127 落账;与 `docs/comfyui-kb/画布布局规范.md` §六第 8 条、`.agents/skills/node-graph/OPTIMIZATION.md` 布局策略 ⑪ 返工口径段三处同笔,冲突以本节为准)

返工定稿的六条行为,规范与技能两处已同口径落账;实现=`.agents/skills/node-graph/tools/layout_normalize.py` 与 `apps/build/scripts/workflow_layout_normalize_campaign.py`,终态数字见 §10.1:

1. **空组框并入求解坐标系**:压缩档里空组框不再当绝对锚,作为与真实节点**同一相对坐标系的刚体伪节点**一起收拢(伪节点尺寸=原框,解出的位置写回组框 bounding,收尾平移同帧随行;成员框与空框之间由净隙边保持间距)。首版把空框当绝对常量、给其右/下方节点挂绝对坐标下界——两套坐标系互相甩,自由节点向原点收拢而被锚侧不动,收尾平移把被锚侧甩出(fasth3 两件摊到 4.6 倍),已废。本条修订 §4 第 4 步「空组保持原框」的执行方式:框尺寸仍保持原值,但位置进求解系。
2. **压缩档不放大硬约束(ceiling)**:每个作用域**先解只修组框档(inf)**,其节点包围尺寸作为压缩档的硬上限;压缩档结果任一轴超限即弃该档(inf 档自身无解时以整治前布局为上限)。「只收不推」由节点对约束升格为作用域级硬约束。
3. **组间分离=按互搭连通分量的一维扫掠**:重算后的组框会形成逐对推开不可合成的互搭链/三角(首版逐对投票会收在 95 交叉的乱局,已废)。按互搭(重叠)图的连通分量:沿一轴按原中心序依次推开,每次只清掉已放置的框(净隙 ≥ `G_MIN`);两轴 × 两向四变体,**变体键=总平移最小**(第三轮试过「分量包围盒增量」键并回退——分量局部最优致全局更差,单镜-pi-H3 +0%→+33%,留档注释在代码);方向穷举的 override 钉死分量变体;扫掠整组平移后再补一轮出框推开(无组节点可能被扫进平移后的框内)。
4. **线遮修补冻结线端点相对位置**:解后新增「线穿节点」时**不挪被穿节点**(首版照「推到线下方」实现,线端点随被推的刚性块一起下移、修补追着推,把 fasth3 两件摊到 4.6 倍、道劫设定卡 i2i 摊到 2.9 倍,已废),改为把该线两端点与被穿节点三者的相对位置**冻结**(双向刚性约束,取整治前偏移)——整治前不穿,相对位置不变就不穿;解不出、或冻结后仍有新增线穿,则本作用域升一档(放大另被第 2 条 ceiling 硬拦)。
5. **不收敛件 12 轮后自动退只修组框档(rung=fallback-inf)**:整理解对自身输出迭代至不动点(带环检测:双稳态振荡取环上质量最优态);罩到 12 轮上限仍未收敛(单向漂移永不复现,实测空组框伪节点链在分数锚点上组宽每轮 +1)时,对末态再解一次 `ladder=(inf,)` 只修组框档(该档实测幂等)并返回该结果,报告该作用域 `rung` 标 **`fallback-inf`**(区别于正常协商出的 `inf`;兜底也无解时保留末态,交批处理幂等闸 fail-closed)。终态实录:fasth3-单镜视频-i2v/t2v 两件主图按此收编(`apps/output/automation/workflow-layout-report.json`)。
6. **批处理 `--relax` 参数与 `--only` 不覆盖全库报告**:`--relax 判据=增量`(可重复,后写覆盖先写)放宽守门容差——可放宽=走容差的七判据(`crossings/occlusion/est_overlap/est_spacing/negative_region/output_rightmost/leftward`),放宽键覆盖缺省(交叉的 max(3,⌈10%⌉) 亦一并被覆盖);`group_overlap/node_out_of_group/edge_tight` 是 R2/R3 硬零门,恒不可放宽;与 `--strict` 互斥;`--only` 与全库模式均生效。`--only` 是单件运维操作,**不写全库报告**(全库 summary 与并组史是役级台账;1127 晚单件 apply 曾把全库报告洗成 1 件并使 MD 汇总对上一份报告的并集键取值崩掉);`--write-far-baseline` 恒处理全库,不受 `--only` 影响。

### §10.3 收编裁决与放宽键值落账(1127 用户令「按照你的建议去做完」批准)

- **裁决**:用户在主会话批准按建议收编 4 件无解件并保持 2 件原样(「按照你的建议去做完」,/workflow 执行)。放宽键值与实测增量:
  - `K2-图像编辑-整合流.json`:--relax est_spacing=5(实测 est_spacing +1,est_overlap −2、negative_region −84 均改善)
  - `社区-480P生成-960P精修-SolAttn加速-960P直出.json`:--relax est_spacing=5(实测 est_spacing +1,其余改善)
  - `社区-H3终极三采v2版.json`:--relax est_spacing=5(实测 est_spacing +2,其余改善)
  - `K2-角色设定-道劫.json`:--relax occlusion=2 --relax est_overlap=1(实测 occlusion +2、est_overlap +1,crossings +18 在 Q3=24 内,est_spacing −3 改善;组框 6→3 并组为 §4 第 9 步许可;包围盒 h +640px/+12.3% 归因=出框 2/贴边 5 的 R3 必要推移+并组,原三类存量钉在已删除的 UNRESOLVED_PINS 条目)
- **副作用候追认**:K2-角色设定-道劫 spacing_far(main)34→35(+1 对),收编布局的连带代价,未在批准的放宽键值内;间距基线重建路径(删除 fixture 重生成,同步员受命执行)使 merge_far_baseline 的只降不升守卫未触发。维持收编=追认 +1;不接受=回退该件到收编前并从收编清单除名。
- **保持原样 2 件**:K2-风格扩展流(需左向线 +3,违零左向线规矩)、K2-无审查全家桶(需多项同时放宽,收益 118 负坐标/7 互遮/11 出框清零 vs 代价线遮+2/估算重叠+10/左向线+1)。
