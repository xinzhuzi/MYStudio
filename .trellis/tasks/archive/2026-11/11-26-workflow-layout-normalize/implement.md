# 节点图布局全量整治 执行计划

Covers: R1 R2 R3 R4 R5 R6 R7 R8 R9 R10
Verifies: AC1 AC2 AC3 AC4 AC5 AC6 AC7 AC8 AC9 AC10

## 执行指引(给用户,或用户之后派出的子代理 / 新会话)

**执行由用户自己启动,本规划阶段不跑下面第 1 步。** 照 `.trellis/workflow.md` 的顺序:

1. **启动**:五项裁决已于 2026-11-27 落账(见下表),用户说「批准,继续做」后跑
   `python3 ./.trellis/scripts/task.py start 11-26-workflow-layout-normalize`
2. **实现**(流程 2.1):主会话用 channel 派 implement 工人(命令见下「派工」)。工人按 Task 0 → Task 8 顺序做,每做完一步勾上对应复选框;Task 5(全库写盘)做完先停下向主会话回报数字,主会话转呈用户后再进 Task 6。
3. **检查**(流程 2.2):另开 `check-layout` channel 派 check 工人,问题修到通过为止。
4. **沉淀规范**(流程 3.3):`trellis-update-spec`——新判据、目标档、轻量档、检查器两处修正写回 `docs/comfyui-kb/画布布局规范.md` 与 node-graph 技能布局策略章(R13 同批),并判断要不要进 `.trellis/spec/`。
5. **提交**(流程 3.4):先跑 GitNexus `detect-changes`,再把提交计划给用户确认,按 Step 8.8 的批次路径限定提交(用 `bash apps/build/scripts/commit_gate.sh -m "<信息>" -- <路径>`;钩子被别的会话卡住就先报告,不自行 `--no-verify`)。
6. **归档与记日志**(流程 3.5):`/trellis:finish-work`,须用户同意。

检查中发现方案本身有问题(例如整理器怎么调都过不了某件的守门),按项目流程回 Phase 1 改设计、重新交用户批准,不就地放宽口径。下表五项是用户裁决,不在此列。

**用户裁决(2026-11-27,全部按推荐值定案)**:

| 编号 | 要定的事 | 裁决值 |
|---|---|---|
| Q1 | 方案取向:只做组框修复 + 保序压缩 / 另加折行重排 / 只修组框 | 组框修复 + 保序压缩;不做折行重排 |
| Q2 | 范围:上游来源件是否纳入 | 除官方件 5、原件 2、收据钉死件 1 外全部纳入(含社区作者件、测试夹、蓝图 9 件) |
| Q3 | 守门容差 | 交叉每作用域 ≤ max(3, ⌈整治前 × 10%⌉),其余判据 0 |
| Q4 | 间距目标档 | 横 320 / 纵 180 |
| A15 | 格式特殊件 `seethrough-layer-editor.json` 是否接受整件重排格式 | 接受:按缩进 2 重排写回(解析后内容不变,git 可回退) |

**与在册任务的关系**(假设 A17,用户尚未明示):本役宜先于 `11-26-image-workflow-engine-reconcile`(改 `1_图片` 工作流内容)与 `11-26-h3-leftover-ops`(含 7_测试 整理)执行;若那两个先走,开工前重跑 Step 0.2 预检并重做钉死面普查。

**派工(主会话执行;均从仓库根跑)**

```bash
TASK=.trellis/tasks/11-26-workflow-layout-normalize
LOGDIR=apps/output/automation/layout-campaign
mkdir -p "$LOGDIR"
trellis channel create impl-layout --by main --cwd "$PWD"
python3 Library/ai/fix-codex-channel-sidebar.py -- channel spawn impl-layout \
  --agent implement --provider codex --as implement \
  --file "$TASK/prd.md" --file "$TASK/design.md" --file "$TASK/implement.md" \
  --jsonl "$TASK/implement.jsonl" --cwd "$PWD" --timeout 110m --idle-timeout 0
trellis channel send impl-layout --as main --to implement --text-file "$LOGDIR/impl-brief.md" --delivery-mode requireRunningWorker
trellis channel messages impl-layout --raw --from implement --last 2     # 发简报 60–75 秒后看,须有 progress 事件
trellis channel wait impl-layout --as main --from implement --kind done,error --timeout 110m
trellis channel messages impl-layout --from implement --last 1 --raw      # 读最终回报
```

check 工人同法:channel 名 `check-layout`,`--agent check --as check`,`--jsonl "$TASK/check.jsonl"`。一次只派一个工人(implement 做完再派 check)。

- **身份**:按 `.trellis/agents/implement.md` / `check.md` 的定义;两份卡的缺省供应方是 claude,而本机 claude CLI 未登录,所以**必须显式 `--provider codex`**,并经 `Library/ai/fix-codex-channel-sidebar.py` 派发。
- **`--idle-timeout 0` 不能漏**(缺省 5 分钟会把轮间停顿的工人静默杀掉)。
- **验活**:发简报后 60–75 秒拉一次消息,只有 progress 事件才算活着;只有旧的 `turn_finished` 就是死的。
- **判完成**:`wait --kind done` 对失败的轮次和旧轮的 done 事件都会返回——必须读工人最终回报,并比对本轮指令的 seq,不能见 `done` 就当完成。
- **codex 工人爱提前交卷**:简报正文必须写明「余量全量完成,不许再提前交卷,每条验证命令必须真实跑过并全绿」。
- **简报正文**(写到 `$LOGDIR/impl-brief.md`)首行 `Active task: .trellis/tasks/11-26-workflow-layout-normalize`;随后依次写:目标(一句话)、可改范围(只限本文件「File Map」列出的文件)、逐步验证命令(退出码直读)、禁区(不提交、不推送、不打包、不写 `/Applications` 下的装机 App、不碰 `EXCLUDE` 里的工作流、不改 File Map 之外的文件、不动别的会话的在途文件)、回报格式(逐 Task 列:做了什么 / 验证命令原始输出 / 未做成的事)。容易卡的点一开始就写进简报:工人之间不共享澄清,同一个坑 respawn 后会原样再卡一次。
- **时长**:粗估工人在后台合计 8–14 小时(整理器 Task 2 与哨兵重锚 Step 6.10 最耗时),这是估计不是承诺。工人自带日志(`~/.trellis/channels/<项目桶>/impl-layout/` 下的 worker 日志);主会话每不超过 20 分钟向用户报一次进度与预计剩余。

执行要用的技能与工具:`node-graph`(布局纪律与工具)、`gitnexus-impact-analysis`(改 `_seg_int`、`check_scope`、`check_workflow`、`render` 之前跑 impact;索引是否过期先看 `python3 apps/build/scripts/gitnexus_freshness_check.py --strict`)、`python-code-style`、`python-testing-patterns`。验证命令一律从 `apps/` 跑 npm 入口、从仓库根跑 python 脚本;shell 是 zsh,取管道退出码用 `set -o pipefail`,不用 `PIPESTATUS`。

---

**Goal:** 给全部 GUI 工作流清掉分组互遮、节点出组框与贴边,把过大的节点空隙收到目标档,并立一道机器门让这几类问题以后一出现就红。

**Architecture:** 判据与算法住 node-graph 技能的 `tools/`(通用、零项目专名);全库批处理、排除清单、容差与报告住 `apps/build/scripts/` 的一支脚本;机器门是一支契约测试(默认轻量档),并挂进 `npm run test:workflow` 的契约清单。改动只落在布局字段,每件写盘前做结构对拍、幂等复核与格式还原对拍。

**Tech Stack:** Python 3.14(仓库根脚本)、Node 22 / pnpm(npm 入口从 `apps/` 执行)、pytest 9、引擎前端 1.59.6。

**分层决定:单任务 `not_required`。** 工具、批处理、同步、门禁共同实现一个行为(工作流布局归一),共享同一验证周期(全库测试 + 工作流门禁),拆开后任何一份都不能独立验收;按「规划纪律指南 §1 Keep One Plan When」不建子任务。

## Global Constraints

- 只动布局字段:`nodes[].pos`、`groups[].bounding`、文档顶层 `extra.ds`、子图定义内的 `nodes[].pos` / `groups[].bounding` / 边界槽 `pos`。拓扑、`size`、标题、`mode`、连线、控件值、Note 文本、`links` 表一律不动(R6)。
- 生产工作流禁裸手改 JSON,一律经批处理脚本或蓝图同步步骤,带前置断言、fail-closed(OPTIMIZATION ⑦)。
- `EXCLUDE` 里的 8 件不碰(官方件 5、原件 2、`flux3-道劫-t2i.json`)。
- 不向 `/Applications` 下的装机 App 直写;打包只走 `apps/build/packaging/build-mac.sh`,且须用户明令;Windows 只走 `apps/build/packaging/deploy-dual.sh`。
- 工人不提交、不推送;提交由主会话在流程 3.4 做路径限定分笔,不 `--no-verify`,不动别的会话的在途文件。
- 改共享真源前先过 `preflight_gate`(`docs/engineering/TESTING_ENTRYPOINTS.md`「preflight_gate 使用时机纪律」)。
- 改 `.agents/skills/node-graph/tools/` 后必跑「四件」:`layout_polish.py --selftest`、`layout_check.py --selftest`、`node backend/comfyui/my_nodes/tests/my_scope_probe_1018.mjs`(在 `apps/` 下)、改了 JS 才跑的 `npx esbuild <改动 js> --loader:.js=js --format=esm >/dev/null`。本任务不改 JS,第四件不适用。
- `apps/build/scripts/` 顶层新建脚本名不带日期后缀。
- 机器门的轻量档全库目标 ≤ 15 秒;超了先查是不是把线交叉/线遮也算进去了。
- 自测夹具节点一律用 `layout_check._mk_node`(尺寸 `[200,100]`、类型 `TestNode`),坐标取 ≥ 100,免得夹具自己带「负区」违规干扰断言。

## File Map

### Create
- `.agents/skills/node-graph/tools/` 下新建 `layout_normalize.py`:保序压缩(survey / normalize / strip_layout + CLI + selftest),批处理与生成器读它。
- `apps/build/scripts/` 下新建 `workflow_layout_normalize_campaign.py`:全库批处理(`--check` / `--apply` / `--write-far-baseline`),出报告。
- `apps/backend/comfyui/tests/` 下新建 `test_workflow_layout_gate.py`:全库机器门。
- `apps/backend/comfyui/tests/fixtures/` 下新建 `workflow_layout_far_baseline.json`:逐件逐作用域的 `spacing_far` 基线(只降不升用),由批处理脚本生成。

### Modify
- `.agents/skills/node-graph/tools/layout_check.py`:叉积 epsilon;遮挡分支排序兼容混合 id;三个选开判据;`checks=` 轻量档;CLI 四个新参数;自测加 C10–C15 与用例过滤。
- `apps/build/scripts/workflow_gate.py`:`CONTRACT_TESTS` 清单加新测试一项。
- `apps/build/scripts/sensenova_daojie_build_1126.py`:`render()` 对带 `nodes` 的对象先过 `normalize`。
- `apps/build/scripts/sn_local_inpaint_build_1126.py`:`main()` 里的本地 `render` 改为调用基模块的 `render`。
- `apps/build/scripts/qi21_local_face_mask_repair_1027.py`:`PATCHED_SHA256` 重钉。
- `apps/build/scripts/workflow_layout_baseline.json`:逐作用域数值按整治后实测更新,与工作流同一笔提交。
- `apps/build/scripts/multiseg_ui_template_build.py`:仅当界面图三个专用节点的落位不再合规时,改落位偏移。
- `apps/build/scripts/multiseg_inline_facerefine_build_1118.py`(执行期补登 1127,检查员 finding 落账):组框留白 60/80/60/120 → 立宪 30/50/60/80——旧值右留白 0 违 edge_tight,生成器重放与整治件不动点互斥。
- `apps/build/scripts/qi21_local_inpaint_build_1126.py`(执行期补登 1127):派生链悬空线剔除 + 「输出悬空线」守卫——配套修掉 qi21-局部重绘 的 HEAD 存量悬空线 26。
- `apps/backend/comfyui/my_nodes/subgraphs/` 下 9 件 `qi21-*.json` 蓝图:`definitions.subgraphs[0]` 按对照表换成宿主的整治结果。
- `apps/frontend/lib/comfyui/h3/templates/` 下 `fasth3-shot-template.json`、`pika-shot-template.json`、`pika-ref-shot-template.json`、`h3-multiseg-template.json`:前三件重拷,末一件重生成。
- 哨兵测试(只在断言变红时改数值常量):`apps/backend/comfyui/tests/test_qwen21_workflow_contract.py`、`test_qi21_local_face_contract.py`、`test_daojie_sheet_card_workflow.py`、`test_daojie_sheet_card_qwen_workflow.py`、`test_three_stage_contract.py`、`test_multiseg_full3stage_contract.py`、`apps/frontend/lib/comfyui/h3/h3-shot-video-workflow.test.ts`。
- `apps/build/scripts/scripts-hygiene-exemptions.json`:`exempt` 登记四件役产物日期名(三件 1126 局部重绘役产物 + `sensenova_daojie_build_1126.py`)。
- `docs/comfyui-kb/画布布局规范.md`、`.agents/skills/node-graph/OPTIMIZATION.md`:新判据与目标档落账(R13)。
- `docs/engineering/TESTING_ENTRYPOINTS.md`:「工作流 JSON」行补一句段 2 含布局机器门;`preflight_gate` 的共享真源举例补工作流库与蓝图夹。

### Delete
- `apps/build/scripts/qi21_huanlian_compact_1126.py`:已落后于在版件、重跑即报错、全仓无其他引用,由通用工具取代。

### Modify(经批处理脚本,不手改)
- `apps/backend/comfyui/workflows/` 下范围内的 GUI 件(141 件):`--apply` 写盘。

### Verify Only
- `docs/engineering/TESTING_ENTRYPOINTS.md` 的其余各行、`.trellis/spec/guides/verification-loop-guide.md`、`.trellis/spec/guides/implementation-planning-discipline-guide.md`:执行与验证的规矩,不改。

---

### Task 0: 定案与基线(执行前门)

**Files:**
- Modify: `.trellis/tasks/11-26-workflow-layout-normalize/design.md`
- Modify: `.trellis/tasks/11-26-workflow-layout-normalize/grill-ledger.md`
- Modify: `.trellis/tasks/11-26-workflow-layout-normalize/prd.md`
- Verify: `apps/backend/comfyui/workflows/`、`apps/backend/comfyui/my_nodes/subgraphs/`、`apps/frontend/lib/comfyui/h3/templates/`

**Interfaces:**
- Consumes: 用户 2026-11-27 的裁决(已落账于 `design.md` §0)。
- Produces: `apps/output/automation/layout-campaign/baseline/` 下的三份基线日志。

- [x] Step 0.1: 裁决落账——2026-11-27 用户答复「按照你的建议」,Q1–Q4 与 A15 全部按推荐值定案,已写入 `design.md` §0、`grill-ledger.md` 第四节与 `prd.md` 裁决记录。开工时只需核对三处与 `design.md` §0「落点」一列的常数一致。 (AC5)
- [ ] Step 0.2: 共享真源预检。(证据缺口:开工前 preflight 输出未留档,`apps/output/automation/layout-campaign/baseline/` 目录不存在;现存 preflight-report.json 为 1127 14:35 他役产物,不可代证)(候用户追认/候令,见 ac-evidence.md)
  - Run: `python3 apps/build/scripts/preflight_gate.py apps/backend/comfyui/workflows apps/backend/comfyui/my_nodes/subgraphs apps/frontend/lib/comfyui/h3/templates apps/build/scripts/workflow_gate.py apps/build/scripts/workflow_layout_baseline.json apps/build/scripts/sensenova_daojie_build_1126.py apps/build/scripts/sn_local_inpaint_build_1126.py apps/build/scripts/qi21_local_inpaint_build_1126.py apps/build/scripts/qi21_local_face_mask_repair_1027.py apps/build/scripts/scripts-hygiene-exemptions.json`
  - Expected: `GREEN`、退出码 0 才动手。静默窗红 = 查证写入者(`git log` / `git status` 对齐 mtime)后 `--force` 并记档;脏态红 = 该路径有别的会话的在途改动,呈报用户,该文件本役不碰。1126 晚实测这些路径工作树干净。
- [ ] Step 0.3: 留全量测试基线日志。(证据缺口:test-py-before.log 未落盘,全仓检索无此件)(候用户追认/候令,见 ac-evidence.md)
  - Run: `mkdir -p apps/output/automation/layout-campaign/baseline && cd apps && set -o pipefail && npm run test:py 2>&1 | tee output/automation/layout-campaign/baseline/test-py-before.log; echo "exit=$?"`
  - Expected: 日志落盘;`exit=` 后记下实际退出码与各域通过、失败数(既有红如实记为基线,不算本役引入)。
- [ ] Step 0.4: 留工作流门禁基线日志。(证据缺口:test-workflow-before.log 未落盘;现存 test-workflow-after.log 为 11-27 06:45 钉册适配前的中间态且段 2 红,不可代证)(候用户追认/候令,见 ac-evidence.md)
  - Run: `cd apps && set -o pipefail && npm run test:workflow 2>&1 | tee output/automation/layout-campaign/baseline/test-workflow-before.log; echo "exit=$?"`
  - Expected: 日志落盘;退出码 0(段 3 此时三件相对 HEAD 干净,应真跑并 `PASSED`)。
- [ ] Step 0.5: 留脚本命名 lint 基线日志。(证据缺口:lint-scripts-before.log 未落盘;RED(6 个)名单仅见于 prd.md F12 记载)(候用户追认/候令,见 ac-evidence.md)
  - Run: `cd apps && set -o pipefail && npm run lint:scripts 2>&1 | tee output/automation/layout-campaign/baseline/lint-scripts-before.log; echo "exit=$?"`
  - Expected: 输出点名 F12 的 6 件(`RED(6 个…)`)。

### Task 1: 检查器——修两处缺陷、加三个判据与轻量档(AC7)

**Files:**
- Modify: `.agents/skills/node-graph/tools/layout_check.py`

**Interfaces:**
- Consumes: 现有 `check_scope` / `check_workflow` / `_seg_int` / `_occl_box` / `_selftest`。
- Produces(后续任务依赖的精确签名;口径全文见 `design.md` §3):
```python
LAYOUT_KEYS = ("node_out_of_group", "edge_tight", "spacing_far")
GROUP_PAD = (30.0, 50.0, 30.0, 30.0)
FAR_H_DEFAULT = 320.0
FAR_V_DEFAULT = 180.0
def check_scope(name, nodes, links, sg, max_crossings=0, allow_leftward=frozenset(),
                groups=None, layout=None, checks=None)
def check_workflow(wf, max_crossings=0, allow_leftward=frozenset(), layout=None, checks=None)
```
`layout=None` 时返回值与现在逐位相同;`layout={"ht": .., "vt": ..}` 时每个作用域报告多一个 `"layout"` 键;`checks=(名字, ...)` 时只算列出的既有判据(其余不计、不进 `violations`、`counts` 里不出现)。`--selftest` 后可跟用例名(逗号分隔)只跑指定用例。

- [ ] Step 1.1 (RED): 在 `_selftest()` 现有 C9 之后加 C10「平移不变」。夹具:节点 1 `pos [0,1920] size [840,130]` 一输出扇出四线;节点 2 `pos [850,1920] size [10,30]`;节点 3 `pos [2510,2000] size [300,200]`;节点 4 `pos [1740,2460] size [300,200]`;节点 5 `pos [1740,4260] size [300,200]`;连线 `[1,1,0,2,0,"*"]`、`[2,1,0,3,0,"*"]`、`[3,1,0,4,0,"*"]`、`[4,1,0,5,0,"*"]`。断言:整体下移 dy = 0、1、2、3、4 时 `check_workflow(夹具)[0]["counts"]["crossings"]` 五个数相等。(证据缺口:RED 期失败输出未留档;C10 用例已在库,1127 补检实跑 PASS「translation-invariant (got [0, 0, 0, 0, 0])」)(候用户追认/候令,见 ac-evidence.md)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest`
  - Expected: 退出码 1,输出 `FAIL - C10 …`,末行 `selftest: 1 failure(s)`(1126 实跑现状为 `[0, 3, 0, 3, 3]`)。
- [x] Step 1.2 (GREEN): 改 `_seg_int`:四个叉积各过符号函数(`|d| ≤ 1e-7` 记 0),两侧符号严格相反才判相交。(补检 1127 实跑 selftest:C10 PASS、0 failure(s);提交 cb14001f)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest`
  - Expected: 退出码 0,末行 `selftest: 0 failure(s)`。
- [ ] Step 1.3 (RED): 加 C11「混合 id」。夹具:节点 `1` 在 `[0,0]` 尺寸 `[200,100]`(一输出)、节点 `3` 在 `[300,0]`、节点 `"a"` 在 `[600,0]`、节点 `2` 在 `[900,0]`(一输入),连线 `[1,1,0,2,0,"*"]`(水平线穿过 `3` 与 `"a"`)。断言:`check_workflow` 不抛异常且 `occlusion == 2`。(证据缺口:RED 期 TypeError 输出未留档;C11 用例已在库,1127 补检实跑 PASS)(候用户追认/候令,见 ac-evidence.md)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest C11`
  - Expected: 退出码 1(1126 实跑现状抛 `TypeError: '<' not supported between instances of 'str' and 'int'`)。
- [x] Step 1.4 (GREEN): 遮挡分支里两处 `sorted(hit)` 都改 `sorted(hit, key=str)`。(补检 1127 实跑 selftest:C11 PASS)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest`
  - Expected: 退出码 0,`selftest: 0 failure(s)`。
- [ ] Step 1.5 (RED): 加 `--selftest` 用例过滤;加 `GROUP_PAD`、`LAYOUT_KEYS` 两个常量与 C12「出组框」用例(组框 `[50,50,400,300]`,节点 `[380,100]` 尺寸 `[200,100]` → `layout={"ht": 400}` 时 `node_out_of_group == 1`)。(证据缺口:RED 期输出未留档;C12 用例已在库,1127 补检实跑 PASS)(候用户追认/候令,见 ac-evidence.md)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest C12`
  - Expected: 退出码 1,`FAIL - C12`(此时 `check_workflow` 还不认 `layout=`)。
- [x] Step 1.6 (GREEN): 实现 `node_out_of_group` 判据与 `layout=` 参数贯通(只做这一项;另外两项先恒为 0)。(补检 1127 实跑 selftest:C12 PASS `node_out_of_group == 1`)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest C12`
  - Expected: 退出码 0,`PASS - C12`。
- [ ] Step 1.7 (RED): 加 C13「贴边」用例(同组框,节点 `[70,100]` 尺寸 `[200,100]` 完整在内、左留白 20 → `edge_tight == 1` 且 `node_out_of_group == 0`)。(证据缺口:RED 期输出未留档;C13 用例已在库,1127 补检实跑 PASS)(候用户追认/候令,见 ac-evidence.md)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest C13`
  - Expected: 退出码 1,`FAIL - C13`。
- [x] Step 1.8 (GREEN): 实现 `edge_tight`。(补检 1127 实跑 selftest:C13 PASS `edge_tight == 1`)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest C13`
  - Expected: 退出码 0,`PASS - C13`。
- [ ] Step 1.9 (RED): 加 C14「间距过远」用例(节点 A `[100,100]`、B `[700,100]` 尺寸均 `[200,100]` → `layout={"ht": 320}` 时 `spacing_far == 1`;改传 `layout={"ht": 400}` → 0)。(证据缺口:RED 期输出未留档;C14 用例已在库,1127 补检实跑 PASS 双断言)(候用户追认/候令,见 ac-evidence.md)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest C14`
  - Expected: 退出码 1,`FAIL - C14`。
- [x] Step 1.10 (GREEN): 实现 `spacing_far` 与两个目标档常量 `FAR_H_DEFAULT`、`FAR_V_DEFAULT`(`layout=` 缺键时取它们)。(补检 1127 实跑 selftest:C14 PASS ht=320→1 / ht=400→0)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest C14`
  - Expected: 退出码 0,`PASS - C14`。
- [ ] Step 1.11 (RED): 加 C15「轻量档」用例(组框互遮夹具:`checks=("group_overlap",)` 时 `counts` 的键只有 `group_overlap`,`layout` 三键照常计算;不传 `checks` 时键集等于 `CHECK_KEYS`)。(证据缺口:RED 期输出未留档;C15 用例已在库,1127 补检实跑 PASS)(候用户追认/候令,见 ac-evidence.md)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest C15`
  - Expected: 退出码 1,`FAIL - C15`(此时还不认 `checks=`)。
- [x] Step 1.12 (GREEN): 实现 `checks=`(只算列出的既有判据,其余键不出现在 `counts` 里)。(补检 1127 实跑 selftest:C1–C15 全 PASS、`selftest: 0 failure(s)`)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py --selftest`
  - Expected: 退出码 0,`selftest: 0 failure(s)`(C1–C15 全过)。
- [x] Step 1.13: 加 CLI 四个参数并在真件上实跑。(补检 1127 实跑同命令:exit=0,`LAYOUT_CHECK_JSON` 作用域带 `layout` 三键、`counts` 只有 `group_overlap`)
  - Run: `python3 .agents/skills/node-graph/tools/layout_check.py "apps/backend/comfyui/workflows/0_分镜/分镜工作流.json" --layout --far-h 400 --far-v 240 --only group_overlap; echo "exit=$?"`
  - Expected: `exit=` 是 0 或 1(不是 2——2 表示有参数不被识别);末行 `LAYOUT_CHECK_JSON:` 的作用域条目带 `"layout"` 键、`counts` 只有 `group_overlap`。
- [x] Step 1.14: 真件回归与轻量档计时(从仓库根跑)。(补检 1127 实跑同脚本:三行断言输出与预期逐字一致,`light-mode files 158, 0.1s` ≤ 15s)
  - Run:
    ```bash
    python3 - <<'EOF'
    import sys, json, time, pathlib
    sys.path.insert(0, ".agents/skills/node-graph/tools")
    import layout_check as lc
    wf = json.load(open("apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", encoding="utf-8"))
    a = lc.check_workflow(wf)
    b = lc.check_workflow(wf, layout={"ht": 320, "vt": 180})
    c = lc.check_workflow(wf, layout={}, checks=("group_overlap",))
    print(sorted(a[0]), sorted(a[0]["counts"]) == sorted(lc.CHECK_KEYS))
    print(sorted(b[0]["layout"]), "counts unchanged:", b[0]["counts"] == a[0]["counts"])
    print(sorted(c[0]["counts"]), sorted(c[0]["layout"]))
    roots = [pathlib.Path("apps/backend/comfyui/workflows"), pathlib.Path("apps/backend/comfyui/my_nodes/subgraphs")]
    t = time.perf_counter(); n = 0
    for root in roots:
        for p in root.rglob("*.json"):
            d = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(d, dict) and isinstance(d.get("nodes"), list):
                lc.check_workflow(d, layout={}, checks=("group_overlap",)); n += 1
    print("light-mode files %d, %.1fs" % (n, time.perf_counter() - t))
    EOF
    ```
  - Expected:
    ```
    ['counts', 'name', 'violations'] True
    ['edge_tight', 'node_out_of_group', 'spacing_far'] counts unchanged: True
    ['group_overlap'] ['edge_tight', 'node_out_of_group', 'spacing_far']
    light-mode files 158, <秒数>s
    ```
    秒数 ≤ 15。
- [x] Step 1.15: 四件(本任务不改 JS,第四件不适用)。(补检 1127 实跑:`FOUR-GATES-OK`)
  - Run: `python3 .agents/skills/node-graph/tools/layout_polish.py --selftest && python3 .agents/skills/node-graph/tools/layout_check.py --selftest && cd apps && node backend/comfyui/my_nodes/tests/my_scope_probe_1018.mjs && echo FOUR-GATES-OK`
  - Expected: 最后打印 `FOUR-GATES-OK`,退出码 0(`layout_polish` 自测通过时逐行打印 `… ok: …`,失败则抛 AssertionError 退出码 1)。

回滚点:Task 1 只改一个文件,失败时 `git checkout -- .agents/skills/node-graph/tools/layout_check.py`。

### Task 2: 保序压缩整理器(R2 R3 R4 R5 R6)

**Files:**
- Create: `.agents/skills/node-graph/tools/` 下 `layout_normalize.py`

**Interfaces:**
- Consumes: `layout_check` 的 `GROUP_PAD`、`FAR_H_DEFAULT`、`FAR_V_DEFAULT`、`ROW_GAP_MIN`、`COL_GAP_MIN`、`POS_MIN`、`SPACING_EXEMPT_TYPES`、`est_size`、`_scopes`、`_occl_box`、`check_workflow`、`_mk_node`(夹具节点)。
- Produces(与 `design.md` §4 接口段逐字一致):
```python
PARAMS = {"H_T": FAR_H_DEFAULT, "V_T": FAR_V_DEFAULT, "H_MIN": ROW_GAP_MIN, "V_MIN": COL_GAP_MIN,
          "DIAG_MIN": 20.0, "EXEMPT_MIN": 20.0, "PAD": GROUP_PAD, "G_GAP": 60.0, "G_MIN": 50.0,
          "ORIGIN": POS_MIN, "IO_IN": 180.0, "IO_OUT": 80.0, "UNSTACK": False}
LADDER = (1.0, 1.5, 2.0, float("inf"))
def survey(wf, params=PARAMS) -> dict
def normalize(wf, params=PARAMS, ladder=LADDER, tol=None) -> tuple[dict | None, dict]
def strip_layout(wf) -> dict
def selftest(cases=None) -> int
```
`normalize` 的 `tol`:缺省 `None` = 全部判据零增量;字典 `{判据名: 允许增量}` 对所有作用域相同;可调用对象 `(作用域名, 整治前 counts) -> {判据名: 允许增量}`。返回 `(新文档 或 None, 报告)`;输入不是带 `nodes` 列表的字典 → 原样返回 `(wf, {"scopes": {}, "applied": False})`;任一作用域无解 → `(None, 报告)`。报告 = `{"applied": bool, "scopes": {作用域名: {"rung": "1"|"1.5"|"2"|"inf", "before": {判据名: 整数}, "after": {判据名: 整数}, "merges": 整数, "unresolvable": bool}}}`。`strip_layout` 剔除的路径见 `design.md` §4 接口段(不剔 `size`)。自测输出每个用例一行 `PASS - <名> <说明>` 或 `FAIL - <名> <说明>`,末行 `selftest: N failure(s)`;CLI `--selftest [N3,N5]` 只跑列出的用例。

- [x] Step 2.1 (RED): 新建文件:模块头、`PARAMS`、`LADDER`、`selftest(cases=None)` 框架与 N1 用例(`normalize({"1": {"class_type": "X"}})` 原样返回同一对象,报告为 `{"scopes": {}, "applied": False}`;列表输入同理);`normalize` 暂为桩 `return None, {"scopes": {}, "applied": False}`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest`
  - Expected: 退出码 1,`FAIL - N1`,末行 `selftest: 1 failure(s)`。
- [x] Step 2.2 (GREEN): 入口判别——输入不是带 `nodes` 列表的字典时原样返回。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N1`
  - Expected: 退出码 0,`PASS - N1`。
- [x] Step 2.3 (RED): 加 N2「strip_layout 只剔布局字段」。夹具 F:主图两节点、一个组框、`extra.ds`;一个子图定义,含一个节点、一个组框、`inputs[0].pos` 与 `outputs[0].pos`。断言:只改 `pos` / `bounding` / `extra.ds` / 槽位 `pos` 后 `strip_layout(改后) == strip_layout(F)`;改任一节点 `size` 后不相等;改 `widgets_values` 后不相等。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N2`
  - Expected: 退出码 1,`FAIL - N2`。
- [x] Step 2.4 (GREEN): 实现 `strip_layout`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N2`
  - Expected: 退出码 0,`PASS - N2`。
- [x] Step 2.5 (RED): 加 N3「恒等档逐坐标恒等」。夹具 G1:A `[100,100]`、B `[1300,100]`、C `[2500,100]`,连线 A→B→C,无组框。断言:`normalize(G1, ladder=(float("inf"),))[0]` 里三个节点的 `pos` 与输入逐一相等。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N3`
  - Expected: 退出码 1,`FAIL - N3`。
- [x] Step 2.6 (GREEN): 作用域循环(复用 `layout_check._scopes()`)+ 取整规则 + 原点平移(原最小坐标 ≥ 80 时不动)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N3`
  - Expected: 退出码 0,`PASS - N3`。
- [x] Step 2.7 (RED): 加 N16「视图态」。夹具一:单节点 `[1000,2000]`;夹具二:节点 `[100,100]` 与 `[4100,1100]`。断言(均用 `ladder=(float("inf"),)`):夹具一整治后 `extra.ds == {"scale": 1.0, "offset": [-300, -1600]}`;夹具二为 `{"scale": 0.362, "offset": [4, 215]}`;子图定义内不出现新的 `extra.ds`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N16`
  - Expected: 退出码 1,`FAIL - N16`。
- [x] Step 2.8 (GREEN): 按 `design.md` §4 第 11 步实现主图 `extra.ds`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N16`
  - Expected: 退出码 0,`PASS - N16`。
- [x] Step 2.9 (RED): 加 N4「组框重算」。夹具 G2:组「G1」`bounding [100,100,500,400]`,成员 M1 `[200,150]`、M2 `[520,150]`(右缘 720 伸出框外);组「G2」`bounding [450,250,400,300]`,成员 M3 `[600,300]`;无连线。断言(`ladder=(float("inf"),)`):结果非 `None`;`check_workflow(结果, layout={"ht": 400, "vt": 240})` 的主图 `group_overlap`、`layout` 里的 `node_out_of_group`、`edge_tight` 均为 0。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N4`
  - Expected: 退出码 1,`FAIL - N4`。
- [x] Step 2.10 (GREEN): 实现成员判定、组框重算、出框处置、组间分离(`inf` 档)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N4`
  - Expected: 退出码 0,`PASS - N4`。
- [x] Step 2.11 (RED): 加 N5「空组」。夹具 G3:组「G1」`bounding [100,100,500,400]` 含成员 M1 `[200,150]`;空组「E」`bounding [400,100,300,200]`。断言:整治后「E」的宽仍是 300、高仍是 200;`group_overlap == 0`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N5`
  - Expected: 退出码 1,`FAIL - N5`。
- [x] Step 2.12 (GREEN): 空组保持原框、作为整体参与分离。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N5`
  - Expected: 退出码 0,`PASS - N5`。
- [x] Step 2.13 (RED): 加 N6「两框交叠、成员分属两行」。夹具 G4(尺寸均 `[200,100]`):组「G1」`bounding [70,100,1160,300]`,组「G2」`bounding [360,250,780,150]`;节点 A1 `[100,130]`、A2 `[650,130]`(只在 G1 内)、B1 `[400,270]`、B2 `[900,270]`(两框内都有,归面积小的 G2)。断言:`group_overlap == 0`、`node_out_of_group == 0`;A1 仍在 A2 左侧;B1 仍在 B2 左侧;A 行底边不高于 B 行顶边。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N6`
  - Expected: 退出码 1,`FAIL - N6`。
- [x] Step 2.14 (GREEN): 方位投票(票数相同优先横向,顺序 左、右、上、下)+ 跨组沿分离轴放开次序约束。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N6`
  - Expected: 退出码 0,`PASS - N6`。
- [x] Step 2.15 (RED): 加 N11「边界槽重钉」。夹具 SG:子图定义 `name "S"`,节点 1 `[500,100]`(一入一出)、节点 2 `[900,100]`(一入一出),字典形连线 入边界(-10)→1→2→出边界(-20);`inputs[0].pos [1000, 900]`、`outputs[0].pos [1300, 950]`(都是过期值)。断言(`ladder=(float("inf"),)`):整治后 `inputs[0].pos == [320, 125]`、`outputs[0].pos == [1180, 125]`;`check_workflow` 作用域 `sub:S` 的 `leftward == 0`、`output_rightmost == 0`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N11`
  - Expected: 退出码 1,`FAIL - N11`。
- [x] Step 2.16 (GREEN): 边界槽重钉(x 取成员最小 x − 180 / 最大右缘 + 80;y 保留槽间间隔、对齐到成员最小 y + 25)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N11`
  - Expected: 退出码 0,`PASS - N11`。
- [x] Step 2.17 (RED): 加 N12「原点补负区」。夹具同 SG,节点 1 改到 `[20,100]`、节点 2 改到 `[520,100]`。断言(`ladder=(float("inf"),)`):整治后节点 1 `pos == [80, 100]`、节点 2 `pos == [580, 100]`、`inputs[0].pos == [-100, 125]`、`outputs[0].pos == [860, 125]`;`negative_region` 整治前 1、整治后 0。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N12`
  - Expected: 退出码 1,`FAIL - N12`。
- [x] Step 2.18 (GREEN): 原最小坐标 < 80 时整体平移到最小坐标 = 80(只看节点,边界槽不算)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N12`
  - Expected: 退出码 0,`PASS - N12`。
- [x] Step 2.19 (RED): 加 N7「远间距收到目标档」。夹具:A `[100,100]`(一输出)、B `[1300,100]`(一输入),连线 A→B。断言(`ladder=(1.0,)`):B 的 `pos == [620, 100]`;`est_spacing == 0`、`est_overlap == 0`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N7`
  - Expected: 退出码 1,`FAIL - N7`。
- [x] Step 2.20 (GREEN): 节点对约束(每一对、每轴;`design.md` §4 第 6 步)与求解器(强连通缩点 + 最长路径)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N7`
  - Expected: 退出码 0,`PASS - N7`。
- [x] Step 2.21 (RED): 加 N8「只收不推」。夹具同 N7,B 改到 `[500,100]`(原可视净隙 200)。断言:B 的 `pos` 仍是 `[500, 100]`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N8`
  - Expected: 退出码 1,`FAIL - N8`。
- [x] Step 2.22 (GREEN): `pair_gap` 的下限规则(est 下限 + 外溢 / 外溢 / `DIAG_MIN` / `EXEMPT_MIN`)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N8`
  - Expected: 退出码 0,`PASS - N8`。
- [x] Step 2.23 (RED): 加 N9「同列对齐保持」。夹具:A `[100,100]`、B `[100,1300]`,无连线。断言(`ladder=(1.0,)`):B 的 `pos == [100, 380]`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N9`
  - Expected: 退出码 1,`FAIL - N9`。
- [x] Step 2.24 (GREEN): 投影交叠轴的刚性约束。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N9`
  - Expected: 退出码 0,`PASS - N9`。
- [x] Step 2.25 (RED): 加 N10「守门挡回新增线遮」。夹具:S `[100,100]`(一输出)、M `[1100,1400]`、T `[6100,4100]`(一输入),连线 S→T(整治前 `crossings == 0`、`occlusion == 0`,先在用例里断言这个前提)。断言(缺省档位梯子):结果非 `None`;主图 `after["occlusion"] <= before["occlusion"]`、`after["crossings"] <= before["crossings"]`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N10`
  - Expected: 退出码 1,`FAIL - N10`(压缩后连线从 M 身上穿过,`after["occlusion"]` 变 1)。
- [x] Step 2.26 (GREEN): 守门比对 + 档位梯子 + 线遮修补。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N10`
  - Expected: 退出码 0,`PASS - N10`。
- [x] Step 2.27 (RED): 加 N13「并组是最后手段」。夹具(尺寸 `[200,100]`,U、L 行尺寸 `[200,60]`):节点 1 `[500,400]`(一输出)、2 `[1000,400]`(一入一出)、3 `[1500,400]`(一输入);节点 4 `[900,250]`(一入一出)、5 `[1350,250]`(一输入);节点 6 `[900,590]`(一入一出)、7 `[1350,590]`(一输入);连线 1→2、2→3、4→5、6→7;组「G1」`bounding [970,350,260,180]`(只罩住 2)、组「G2」`bounding [470,350,1260,180]`(罩住 1、2、3)。先断言整治前 `crossings`、`occlusion`、`est_overlap` 都是 0。断言(`ladder=(float("inf"),)`):结果非 `None`;报告 `merges >= 1`;结果的 `groups` 只剩 1 个且标题含 `+`;整治后 `group_overlap == 0`,各判据不增。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N13`
  - Expected: 退出码 1,`FAIL - N13`。若实现找到了一条过守门的分离方式(`merges == 0`),先核对那条分离是否真的没新增交叉、线遮、est 重叠、左向线;确实合规就把上下两条线各挪近 20px 后再用,不放宽断言。
- [x] Step 2.28 (GREEN): 四个分离方向轮试 + 并组重试。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N13`
  - Expected: 退出码 0,`PASS - N13`。
- [x] Step 2.29 (RED): 加 N14「无解不出半成品」。断言:`normalize(G2 夹具, ladder=())` 返回 `(None, 报告)`,报告 `applied` 为假、主图 `unresolvable` 为真。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N14`
  - Expected: 退出码 1,`FAIL - N14`。
- [x] Step 2.30 (GREEN): 无解路径返回 `None` 并填 `unresolvable`。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N14`
  - Expected: 退出码 0,`PASS - N14`。
- [x] Step 2.31 (RED): 加 N15「幂等」。对 N3–N13 用到的每个夹具:`r1 = normalize(x)`;`r1[0]` 非 `None` 时 `r2 = normalize(r1[0])`,断言 `r2[0]` 与 `r1[0]` 深度相等且 `r2[1]["applied"]` 为假。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N15`
  - Expected: 退出码 1,`FAIL - N15`(挑出第一处不幂等的地方)。
- [x] Step 2.32 (GREEN): 修到幂等(取整、原值沿用、框重算三处最容易破坏幂等)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N15`
  - Expected: 退出码 0,`PASS - N15`。
- [x] Step 2.33 (RED): 加 N17「survey 口径」与 N18「真重叠只报不拆」。N17 夹具:组「G」`bounding [100,100,600,400]`;节点 a `[120,150]`(在内、左留白 20)、b `[650,150]`(右缘 850 伸出框外)、c `[1100,150]`(框外)。断言 `survey(夹具)["main"] == {"node_out_of_group": 1, "edge_tight": 1, "spacing_far": 1, "visual_overlaps": 0}`。N18 夹具:p `[200,200]`、q `[300,250]`。断言 `survey(...)["main"]["visual_overlaps"] == 1`;缺省 `normalize` 结果非 `None` 且 p、q 的可视盒仍然相交(没有被拆开)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N17,N18`
  - Expected: 退出码 1,`FAIL - N17`、`FAIL - N18`。
- [x] Step 2.34 (GREEN): 实现 `survey`(判据部分直接调 `check_workflow(..., layout=...)`,不自写一套)。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest`
  - Expected: 退出码 0,末行 `selftest: 0 failure(s)`(N1–N18 全过)。
- [x] Step 2.35: CLI:`<wf.json>` 默认只读报告;`--apply` 写回时,若路径含 `comfyui/workflows` 或 `comfyui/my_nodes/subgraphs` 且没有 `--allow-prod` 则拒绝并退出 3。
  - Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --help && python3 .agents/skills/node-graph/tools/layout_normalize.py "apps/backend/comfyui/workflows/0_分镜/分镜工作流.json" --apply; echo "exit=$?"`
  - Expected: 用法段列出 `--check`(默认)、`--apply`、`--allow-prod`、`--ht`、`--vt`、`--json`、`--selftest`;后一条 `exit=3` 且文件未被改动。
- [x] Step 2.36: 零项目专名自查(注释里也不许出现)。
  - Run: `grep -c -E "qi21|daojie|道劫|qwen|Qwen|sensenova|SenseNova|krea|K2|h3|H3|manying|漫影" .agents/skills/node-graph/tools/layout_normalize.py`
  - Expected: 输出 `0`(无命中时 grep 退出码 1,属正常)。
- [x] Step 2.37: 四件(命令同 Step 1.15)。
  - Expected: `FOUR-GATES-OK`。

回滚点:Task 2 是新文件,失败时删除该文件即可。

### Task 3: 机器门测试与批处理拒写测试(先红)(R7;AC2 AC3 AC4 AC6)

**Files:**
- Create: `apps/backend/comfyui/tests/` 下 `test_workflow_layout_gate.py`

**Interfaces:**
- Consumes: `layout_check.check_workflow(..., layout=, checks=)`、`layout_normalize.normalize`;Task 4 的批处理模块(按路径 `importlib` 载入,取 `EXCLUDE`、`iter_gui_files`、`apply_one`、`merge_far_baseline`——本任务先内联同一份 `EXCLUDE`,Task 4 Step 4.3 起改为从批处理模块导入;载入放在只供单个测试使用的 fixture 里,载入失败只让那一条失败)。
- Produces: 测试名 `test_group_overlap_is_zero`、`test_nodes_inside_groups`、`test_spacing_far_not_worse_than_baseline`、`test_campaign_refuses_structural_drift`、`test_far_baseline_ratchet`、`test_files_are_fixed_points`。

- [ ] Step 3.1 (RED): 写 session 级 fixture(对两个根下、剔除 `EXCLUDE` 的 GUI 件各算一次 `check_workflow(wf, layout={}, checks=("group_overlap",))` 并缓存)与两个测试:`test_group_overlap_is_zero`(每件每作用域 `counts["group_overlap"] == 0`)、`test_nodes_inside_groups`(`layout["node_out_of_group"] == 0` 且 `layout["edge_tight"] == 0`)。(证据缺口:RED 期「2 failed」输出未留档;两用例已在库,1127 补检实跑布局门 8 passed, 1 skipped)(候用户追认/候令,见 ac-evidence.md)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k "group_overlap or nodes_inside"`
  - Expected: `2 failed`;失败信息点名现有互遮、出组框、贴边的件(调研档口径:互遮 13 件 36 对、出组框 93 件 470 节点、贴边 298)。
- [ ] Step 3.2 (RED): 写 `test_spacing_far_not_worse_than_baseline`:读 `apps/backend/comfyui/tests/fixtures/` 下的基线件 `workflow_layout_far_baseline.json`(Task 5 产出),每件每作用域 `spacing_far` ≤ 基线;基线缺失或某件不在基线里按上限 0 断言,失败信息提示「先跑 `--apply --only <路径>` 再 `--write-far-baseline`」。(证据缺口:RED 期「1 failed 基线缺失」输出未留档;基线件已建 149 件,1127 补检实跑该用例 PASS)(候用户追认/候令,见 ac-evidence.md)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k spacing_far`
  - Expected: `1 failed`,失败信息含「基线缺失」。
- [ ] Step 3.3 (RED): 写 `test_campaign_refuses_structural_drift`(用 `monkeypatch` 让批处理模块的 `normalize` 返回删掉一个节点的文档;对 `apps/output/` 下临时拷贝的一件工作流调用 `apply_one`;断言文件字节未变、返回结果 `written` 为假且 `reason` 为 `"strip_mismatch"`)与 `test_files_are_fixed_points`(环境变量 `LAYOUT_GATE_FIXED_POINT=1` 时对每件断言 `normalize(读入件)` 的结果与读入件深度相等;未设置时 `pytest.skip`,跳过原因写明「全库不动点检查约 5 分钟,由批处理脚本 --check 或本环境变量开启」)。(证据缺口:RED 期「1 failed, 1 skipped」输出未留档;两用例已在库,1127 补检实跑 PASS/skip 口径与现版一致)(候用户追认/候令,见 ac-evidence.md)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k "refuses or fixed_points"`
  - Expected: `1 failed, 1 skipped`(失败的是拒写测试,原因是批处理模块尚不存在)。
- [ ] Step 3.4 (RED): 写 `test_far_baseline_ratchet`:对批处理模块的 `merge_far_baseline(旧, 新)` 断言——新值调低则更新、新件则加入、新值调高则抛 `ValueError`、两次合并结果字节相同。(证据缺口:RED 期输出未留档;用例已在库,1127 补检实跑 PASS)(候用户追认/候令,见 ac-evidence.md)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k ratchet`
  - Expected: `1 failed`(批处理模块尚不存在)。

### Task 4: 全库批处理脚本(R1 R5 R6;AC1 AC5 AC6)

**Files:**
- Create: `apps/build/scripts/` 下 `workflow_layout_normalize_campaign.py`
- Modify: `apps/backend/comfyui/tests/` 下 `test_workflow_layout_gate.py`(改为从批处理模块导入 `EXCLUDE` 与 `iter_gui_files`)

**Interfaces:**
- Consumes: `layout_normalize.survey / normalize / strip_layout`;`layout_check.check_workflow`。
- Produces:
```python
ROOTS = (REPO / "apps/backend/comfyui/workflows", REPO / "apps/backend/comfyui/my_nodes/subgraphs")
EXCLUDE = {   # 相对 apps/backend/comfyui/ 的路径;8 件不碰
    "workflows/1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_t2i.json",
    "workflows/1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_image_edit.json",
    "workflows/1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_background_removal.json",
    "workflows/1_图片/SenseNova/0_官方模板/image_sensenova_u16_t2i.json",
    "workflows/1_图片/SenseNova/0_官方模板/image_sensenova_u16_image_edit.json",
    "workflows/2_视频/H3视频/8_数字人/340-H3数字人V6-萝卜原件.json",
    "workflows/2_视频/H3视频/8_数字人/340-H3无限时长V6-萝卜原件.json",
    "workflows/1_图片/Flux.3/flux3-道劫-t2i.json",
}
REPORT_JSON = REPO / "apps/output/automation/workflow-layout-report.json"
REPORT_MD = REPO / "apps/output/automation/workflow-layout-report.md"
FAR_BASELINE = REPO / "apps/backend/comfyui/tests/fixtures/workflow_layout_far_baseline.json"
BLUEPRINT_HOSTS = {   # 蓝图文件名 → (宿主文件相对 apps/backend/comfyui/ 的路径, 子图名);子图名跨工作流重名,只能逐件对照
    "qi21-提示词类型优化子图.json": ("workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", "[6] 文本提示词类型优化子图"),
    "qi21-提示词类型优化子图-i2i.json": ("workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json", "[6] 文本提示词类型优化子图"),
    "qi21-提示词类型优化子图-edit.json": ("workflows/1_图片/QwenImage2.1/2_图生图/qi21-edit.json", "[6] 文本提示词类型优化子图"),
    "qi21-道劫-加速子图.json": ("workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", "道劫·加速子图"),
    "qi21-道劫-加速子图-i2i.json": ("workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json", "道劫·加速子图"),
    "qi21-道劫-加速子图-edit.json": ("workflows/1_图片/QwenImage2.1/2_图生图/qi21-edit.json", "道劫·加速子图"),
    "qi21-道劫-超分-SeedVR2.json": ("workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", "道劫·超分·SeedVR2"),
    "qi21-道劫-洗底-透明除渣.json": ("workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", "道劫·④b·洗底·透明除渣"),
}
def cross_tol(before: dict) -> dict:        # {"crossings": max(3, ceil(before["crossings"] * 0.1))}
def iter_gui_files() -> list[tuple[str, pathlib.Path]]
def dump_like(text: str, doc: dict) -> str  # 按原文本的格式序列化:缩进(1/2/4)、单行、CRLF、末尾换行
def merge_far_baseline(old: dict, new: dict) -> dict   # 只增新件或调低;调高抛 ValueError
def sync_blueprints() -> list[dict]        # 每件 {"blueprint", "written", "reason"};reason 取 None | "unchanged" | "pre_drift" | "strip_mismatch"
def apply_one(path: pathlib.Path, tol=cross_tol) -> dict
#   -> {"written": bool, "reason": None | "unchanged" | "unresolved" | "format_special" | "reformatted" | "strip_mismatch" | "not_idempotent",
#       "report": <normalize 报告>, "before_sha256": str, "after_sha256": str}
```
报告 JSON 顶层 = `{"generatedAt", "params", "summary", "files", "lists"}`;`summary` 含 `gui_total`、`in_scope`、`overlap_before/after`、`out_before/after`、`tight_before/after`、`far_before/after`、`non_fixed_point`、`written`;`files[相对键]` 含 `scopes`、`written`、`reason`、`before_sha256`、`after_sha256`、`area_before/after`、`zoom_before/after`;`lists` 含 `groups_only`、`merged`、`unresolved`、`format_special`(逐件标明是「未写」还是「已按裁决重排写入」)、`still_tiny` 五张清单。`sync_blueprints` 逐件顺序:前置断言(蓝图现行定义与 `git show HEAD:<宿主路径>` 里的同名定义除 `id`、`state`、`last_link_id` 外 canonical 全等)→ 换成工作树宿主定义的深拷贝(`id` 用蓝图原来的,蓝图独有键原值保留,不新增宿主没有的键)→ 结构对拍(`strip_layout({"definitions": {"subgraphs": [定义]}})` 新旧相等)→ 新旧深度相等则不写 → 否则 `dump_like` 写回。CLI:`--check`(默认,恒退出 0)、`--apply`(完整性失败才退出码 1;无解件、格式特殊件只进清单,不算失败)、`--only <相对键>`(可重复)、`--write-far-baseline`(恒处理全库,不受 `--only` 影响)、`--sync-blueprints`(按 `BLUEPRINT_HOSTS` 同步蓝图;任一件 `pre_drift` 或 `strip_mismatch` 则退出码 1)、`--allow-reformat <相对键>`(格式特殊件经用户同意重排时用;现已同意 1 件 `workflows/1_图片/SeeThrough/seethrough-layer-editor.json`——该件跳过格式还原对拍,按缩进 2 把内联数组展开写回,行尾与末尾换行照原文件)、`--ht N`、`--vt N`、`--strict`(容差全 0)、`--json`。

- [x] Step 4.1: 写骨架:`ROOTS`、`EXCLUDE`、参数解析、`iter_gui_files`;`--check` 单件可跑(调 `survey` 与试算 `normalize`,结果打到标准输出)。(补检 1127 实跑同命令:exit=0,单行含件名与三个问题数;提交 73a4e69c)
  - Run: `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --check --only "workflows/0_分镜/分镜工作流.json"; echo "exit=$?"`
  - Expected: `exit=0`;打印一行含 `分镜工作流.json` 与三个问题数。
- [x] Step 4.2: 实现 `dump_like` 与「格式还原对拍」,`--check` 把还原不了的件列进 `lists.format_special`。(补检 1127 实跑还原对拍:`149 []`——seethrough 重排后全库逐字节可还原;计划 150/1 件,现范围 149 系 flux3-文生图.json 1127 补登记收据钉死豁免,见脚本 :61-73 注释)
  - Run:
    ```bash
    python3 - <<'EOF'
    import importlib.util, json
    s = importlib.util.spec_from_file_location("camp", "apps/build/scripts/workflow_layout_normalize_campaign.py")
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
    files = m.iter_gui_files(); bad = []
    for key, p in files:
        raw = p.read_bytes()
        if m.dump_like(raw.decode("utf-8"), json.loads(raw.decode("utf-8"))).encode("utf-8") != raw:
            bad.append(key)
    print(len(files), bad)
    EOF
    ```
  - Expected: `150 ['workflows/1_图片/SeeThrough/seethrough-layer-editor.json']`。
- [x] Step 4.3: 把 Task 3 测试里内联的 `EXCLUDE` 与文件遍历改为从批处理模块导入 `EXCLUDE`、`iter_gui_files`。(补检:测试经 `_load_campaign()` 导入单一真源,1127 实跑布局门通过)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k "group_overlap or nodes_inside or spacing_far"`
  - Expected: `3 failed`(仍因现状问题与基线缺失而红,不再是导入错误)。
- [x] Step 4.4 (GREEN): 实现 `apply_one` 的 fail-closed 链(顺序见 `design.md` §5 第 3–4 点)。(补检 1127 实跑 `test_campaign_refuses_structural_drift` PASS)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k refuses`
  - Expected: `1 passed`。
- [x] Step 4.5 (GREEN): 实现 `merge_far_baseline` 与 `--write-far-baseline`。(补检 1127 实跑 `test_far_baseline_ratchet` PASS)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k ratchet`
  - Expected: `1 passed`。
- [x] Step 4.6: 实现报告 JSON 与 MD(逐件逐作用域:整治前后数字、档位、并组次数、未写原因;MD 里五张清单各成一个二级标题,标题用清单的中文名:只修组框未压缩 / 并组过 / 无解未写 / 格式特殊未写 / 整治后整图缩放仍偏小)。(补检 1127:报告顶层五键、`lists` 五清单齐,MD 恰 5 个中文二级标题)
  - Run: `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --check --only "workflows/0_分镜/分镜工作流.json" && python3 -c "import json; d=json.load(open('apps/output/automation/workflow-layout-report.json',encoding='utf-8')); print(sorted(d), sorted(d['lists']))" && grep -c '^## ' apps/output/automation/workflow-layout-report.md`
  - Expected: 第一段打印 `['files', 'generatedAt', 'lists', 'params', 'summary'] ['format_special', 'groups_only', 'merged', 'still_tiny', 'unresolved']`;第二个数字 ≥ 5。
- [ ] Step 4.7: 实现 `sync_blueprints` 与 `--sync-blueprints`。整治前宿主还没动,这一步此时应是无操作——正好验证前置断言在现状上能过。(证据缺口:开工期「8 行 unchanged、exit=0」输出未留档,补检亦未复跑该子命令以免写盘;当前等效证据=蓝图锚用例通过+subgraphs/ 工作树净,提交 afd3a375/31f969f1 已同步过蓝图)(候用户追认/候令,见 ac-evidence.md)
  - Run: `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --sync-blueprints; echo "exit=$?"; git status --short -- apps/backend/comfyui/my_nodes/subgraphs | wc -l`
  - Expected: 打印 8 行,每件 `written` 为假、`reason` 为 `unchanged`;`exit=0`;最后的数字是 `0`(蓝图没有任何改动)。若出现 `pre_drift`,说明该蓝图在整治前就已与宿主的已提交版本不一致——记下件名呈报,该件本役不强行同步。
- [x] Step 4.8: 只读全库试算一次,拿真实数字对账(后台跑并写日志,预计 5–15 分钟)。(补检 1127:`rework/dry-final3.json` 全库对账 149 件、总面积 −4.6%、139 秒;`gui_total` 158 ✓、`in_scope` 实为 149=158−9,flux3-文生图.json 补登记豁免,非计划口径的 150)
  - Run: `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --check > apps/output/automation/layout-campaign/check-dryrun.log 2>&1; echo "exit=$?"; python3 -c "import json; s=json.load(open('apps/output/automation/workflow-layout-report.json',encoding='utf-8'))['summary']; print({k: s[k] for k in ('gui_total','in_scope','overlap_before','overlap_after','out_before','out_after','tight_before','tight_after','far_before','far_after','non_fixed_point')})"`
  - Expected: `exit=0`;打印的字典里 `gui_total` 158、`in_scope` 150;`overlap_before`、`out_before`、`tight_before`、`far_before` 与 `research/layout-survey-1126.md` 同量级(叉积 epsilon 修正后互遮只少不多);`non_fixed_point` 等于范围内件数减去本就无需整治的件数。把「无解」「格式特殊」两张清单连同数字一并记下来,Step 5.3 呈报用户。

回滚点:`--apply` 改动的每个文件都可 `git checkout -- <路径>` 单独还原;报告 JSON 里有整治前 sha256。

### Task 5: 全库整治(R1 R2 R3 R4 R5 R6;AC1–AC6)

**Files:**
- Modify(经脚本): `apps/backend/comfyui/workflows/`、`apps/backend/comfyui/my_nodes/subgraphs/` 下范围内 GUI 件
- Create: `apps/backend/comfyui/tests/fixtures/` 下 `workflow_layout_far_baseline.json`

**Interfaces:**
- Consumes: Task 4 的 `--apply`。
- Produces: 整治后的文件;`apps/output/automation/` 下的 `workflow-layout-report.json` 与 `workflow-layout-report.md`;间距基线件。

- [x] Step 5.1: 写盘(后台跑并写日志)。(证据:`rework/apply-final.log` 末行「范围内 149;组遮 28->7,出框 143->26,贴边 755->91,远距 1822->1815,非不动点 10,写入 139」;补检 1127 复跑还原对拍 `149 []`;后续 264b0c69 再收编 4 件+补写 5 件)
  - Run: `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --apply --allow-reformat "workflows/1_图片/SeeThrough/seethrough-layer-editor.json" > apps/output/automation/layout-campaign/apply.log 2>&1; echo "exit=$?"; tail -3 apps/output/automation/layout-campaign/apply.log`
  - Expected: `exit=0`;若为 1,说明有完整性失败(结构对拍或幂等不成立),停下排查,不往下做。无解件不会被写,照常进清单。末行「已整治 N 件,只修组框 M 件,并组 K 件,无解未写 N1 件,格式特殊未写 N2 件」,其中 N2 应为 0(那 1 件已按裁决重排写入)。随后复跑 Step 4.2 的还原对拍命令,应打印 `150 []`(该件重排后已能逐字节还原)。
- [x] Step 5.2: 核对道劫主力件的档位(线遮修补在真件上是否奏效的证据)。(补检 1127 读报告:t2i main 档 1 线遮 12→12、edit 档 1 12→12、i2i 档 2 12→12——i2i 升档按本步口径原样呈报,不算失败)
  - Run: `python3 -c "import json; f=json.load(open('apps/output/automation/workflow-layout-report.json',encoding='utf-8'))['files']; [print(k.split('/')[-1], s, v['scopes'][s]['rung'], v['scopes'][s]['before']['occlusion'], '->', v['scopes'][s]['after']['occlusion']) for k,v in f.items() if k.endswith(('qi21-道劫-t2i.json','qi21-道劫-i2i.json','qi21-edit.json')) for s in ('main',)]"`
  - Expected: 三件主图各打印一行(件名、`main`、档位、线遮 整治前→整治后)。原厂数据里这三件最紧档都可达、只是线遮修补没修完,所以档位应为 `1` 且线遮不增;哪一件升了档,就把它的报告行原样呈报,不算失败。
- [x] Step 5.3: 把 Step 5.1 的 N、M、K、N1、N2、五张清单和 Step 5.2 的三行**呈报用户**,等用户点头再进 Task 6。 (AC1 AC4 AC5)(证据:`design.md` §10/§10.1 呈报与用户返工令在档;264b0c69 提交信息记「4 件无解件按已批放宽收编」)
- [x] Step 5.4: 写间距基线(全库)。(证据:`write-far-baseline-1127b.log`「间距棘轮基线已写 149 件」+补检实数 149;计划 150 → 实际 149,同 flux3-文生图 补登记)
  - Run: `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --check --write-far-baseline && python3 -c "import json; d=json.load(open('apps/backend/comfyui/tests/fixtures/workflow_layout_far_baseline.json',encoding='utf-8')); print(len(d['files']))"`
  - Expected: 打印 `150`。
- [x] Step 5.5: 机器门转绿(默认轻量档)。(补检 1127 实跑 `python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q`:8 passed, 1 skipped, exit=0)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q`
  - Expected: 清单里无解件为 0 时 `5 passed, 1 skipped`;有无解件时对应用例失败并点名该件——如实记录,连同数字一起呈报。
- [x] Step 5.6: 全库不动点(环境变量开启,后台跑,约 5 分钟)。(补检 1127 实跑 `LAYOUT_GATE_FIXED_POINT=1`:9 passed, 70.7s——钉册件按口径跳过,其余全为不动点)
  - Run: `cd apps && LAYOUT_GATE_FIXED_POINT=1 python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k fixed_points`
  - Expected: `1 passed`。若失败并点名 `sn-` 系或 `qi21-局部重绘.json`,属生成器属主件,到 Task 6 Step 6.3、6.4 处理,这里如实记录。

回滚点:整批还原 `git checkout -- apps/backend/comfyui/workflows apps/backend/comfyui/my_nodes/subgraphs`。

### Task 6: 钉死面同步(R8;AC8)

**Files:**
- Modify: `apps/build/scripts/sensenova_daojie_build_1126.py`
- Modify: `apps/build/scripts/sn_local_inpaint_build_1126.py`
- Modify: `apps/build/scripts/qi21_local_face_mask_repair_1027.py`
- Modify: `apps/build/scripts/workflow_layout_baseline.json`
- Modify(经 `--sync-blueprints` 子命令): `apps/backend/comfyui/my_nodes/subgraphs/` 下 8 件蓝图(对照表见 `design.md` §6)
- Modify: `apps/frontend/lib/comfyui/h3/templates/fasth3-shot-template.json`、`pika-shot-template.json`、`pika-ref-shot-template.json`、`h3-multiseg-template.json`
- Modify(仅当需要): `apps/build/scripts/multiseg_ui_template_build.py`
- Modify(只在断言变红时): File Map 列出的哨兵测试

**Interfaces:**
- Consumes: Task 2 的 `normalize`、Task 4 的 `dump_like`。
- Produces: 生成器重导出 == 文件字节;蓝图 == 宿主子图定义(除 id);前端副本 == 仓库件;既有测试全绿。

- [ ] Step 6.1 (RED): 接入前先跑一次生成器对拍,确认现状。(证据缺口:接入前的对拍输出未留档,无法复核当时红/不红的实况)(候用户追认/候令,见 ac-evidence.md)
  - Run: `cd apps/backend && python3 -m pytest comfyui/tests/test_sensenova_daojie_workflow_contract.py -q`
  - Expected: 若 Task 5 的压缩改动了 `sn-` 画布件,「文件字节 == `gen.render(obj)`」一条失败(这是接入前的预期 RED);若一条没红,记下「`sn-` 系未被压缩改动」,Step 6.2、6.3 照做即可。
- [x] Step 6.2: 生成器接入。`sensenova_daojie_build_1126.py` 的 `render(obj)`:`obj` 是带非空 `nodes` 列表的字典时先 `normalize(obj, tol=<与批处理同式的容差>)`,取到 `None` 用原对象;需要 `sys.path` 指到 `.agents/skills/node-graph/tools`。`sn_local_inpaint_build_1126.py` 的 `main()` 里本地 `render` 改为 `return g.render(obj)`。(补检:`sensenova_daojie_build_1126.py:618-633` 已接入 normalize、`sn_local_inpaint_build_1126.py:158-161` 委托 g.render;1127 实跑 test:workflow 段1 generators=passed)
  - Run: `cd apps/backend && python3 -m pytest comfyui/tests/test_sensenova_daojie_workflow_contract.py -q`
  - Expected: 退出码 0,失败 0。
- [x] Step 6.3: 重导出,并核对生成器产物与批处理写下的字节逐字节相同。(证据:`rework/sn-before.sha` 前后哈希留档;补检 1127 实跑 test:workflow 段1 generators=passed=重导出与盘上字节一致)
  - Run: `(cd "apps/backend/comfyui/workflows/1_图片/SenseNova" && shasum -a 256 sn-*.json) > apps/output/automation/layout-campaign/sn-before.sha && python3 apps/build/scripts/sensenova_daojie_build_1126.py && python3 apps/build/scripts/sn_local_inpaint_build_1126.py && (cd "apps/backend/comfyui/workflows/1_图片/SenseNova" && shasum -a 256 sn-*.json) | diff - apps/output/automation/layout-campaign/sn-before.sha && echo SAME-BYTES`
  - Expected: 两个脚本各自打印构建完成,最后打印 `SAME-BYTES`。若 `diff` 有输出,说明两处容差或参数不一致——回头对齐,不手改 JSON。
- [x] Step 6.4: 派生件同步。(证据:提交 afd3a375 含派生链悬空线剔除与「输出悬空线」守卫;补检 1127 实跑 `test_qwen21_workflow_contract.py`(含 qi21-局部重绘 锚)通过)
  - Run: `python3 apps/build/scripts/qi21_local_inpaint_build_1126.py && python3 apps/build/scripts/workflow_layout_normalize_campaign.py --apply --only "workflows/1_图片/QwenImage2.1/2_图生图/qi21-局部重绘.json"; echo "exit=$?"`
  - Expected: 两步退出码均 0。
- [x] Step 6.5: 换脸件守护 SHA 重钉。(补检 1127:换脸件现行 sha256=2d021349… 与脚本 `P2_BANNER_SHA256` 逐字一致(守护接受 P2 横幅变体,原 `PATCHED_SHA256` 为横幅前钉值);`test_qi21_local_face_contract.py` 283 件批内 PASS)
  - Run: `shasum -a 256 "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-换脸-局部重绘.json" | cut -d' ' -f1`
  - Expected: 64 位小写十六进制。写进 `qi21_local_face_mask_repair_1027.py` 的 `PATCHED_SHA256` 后跑 `cd apps/backend && python3 -m pytest comfyui/tests/test_qi21_local_face_contract.py -q`,退出码 0。
- [x] Step 6.6: 蓝图按对照表同步(用批处理脚本的子命令,规则见 `design.md` §6)。(补检 1127:蓝图锚用例(`test_qwen21_workflow_contract.py` blueprint 系列)通过、`my_nodes/subgraphs/` 工作树净;「second-run-unchanged」二次幂等未复跑以免写盘)
  - Run: `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --sync-blueprints; echo "exit=$?"; python3 apps/build/scripts/workflow_layout_normalize_campaign.py --sync-blueprints | python3 -c "import sys; print('second-run-unchanged' if all('unchanged' in l for l in sys.stdin if l.strip()) else 'NOT-IDEMPOTENT')"; cd apps/backend && python3 -m pytest comfyui/tests/test_qwen21_workflow_contract.py -q -k "blueprint or Blueprint"`
  - Expected: 第一遍 8 行、`exit=0`(某件的宿主定义被整治改动过,该件 `written` 为真;没改动过的为 `unchanged`);第二遍打印 `second-run-unchanged`;蓝图锚相关用例全部通过,失败 0。若出现 `pre_drift`,该件不动、把件名呈报用户。

- [x] Step 6.7: 前端副本——三件重拷。(补检 1127 实跑 cmp:fasth3/pika/pika-ref 三对全部 SAME)
  - Run: `T=apps/frontend/lib/comfyui/h3/templates; W="apps/backend/comfyui/workflows/2_视频/H3视频/6_视频重制"; cp "$W/fasth3-单镜视频-i2v.json" "$T/fasth3-shot-template.json" && cp "$W/pika-单镜视频-fl2v.json" "$T/pika-shot-template.json" && cp "$W/pika-单镜视频-ref2v.json" "$T/pika-ref-shot-template.json" && cd apps && python3 -m pytest backend/comfyui/tests/test_fasth3_pipeline_wiring.py backend/comfyui/tests/test_pika_mainline_contract.py backend/comfyui/tests/test_pika_ref2va_contract.py -q`
  - Expected: 退出码 0,失败 0。
- [x] Step 6.8: 前端副本——界面图重生成。(补检 1127 实跑:`test_workflow_template_sync.py` 2 passed+7 subtests;vitest `h3-shot-video-workflow.test.ts` 82 passed,均 exit=0)
  - Run: `python3 apps/build/scripts/multiseg_ui_template_build.py && cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_template_sync.py -q && npx vitest run --config frontend/config/vite.config.ts lib/comfyui/h3/h3-shot-video-workflow.test.ts`
  - Expected: 三条退出码均 0。若 vitest 报 #9、#103、#800 不在组框内 / 上缘不足 40 / 专用连线向左:改 `multiseg_ui_template_build.py` 里的落位偏移后重跑,不改画布件迁就;生成器调不出合规落位 → 把 `一镜到底-分段.json` 退到只修组框后重试,仍不行则呈报用户。
- [x] Step 6.9: 棘轮基线与工作流同批更新(先看差异,再手改)。(补检:`workflow_layout_baseline.json` 顶层 `ruling` 键在档(t2i 加速子图 39→43,Q3 容差 max(3,⌈39×10%⌉)=4 内收录);1127 实跑 test:workflow 段3 layout=passed(502ms))
  - Run:
    ```bash
    python3 - <<'EOF'
    import sys, json
    sys.path.insert(0, ".agents/skills/node-graph/tools")
    import layout_check as lc
    B = json.load(open("apps/build/scripts/workflow_layout_baseline.json", encoding="utf-8"))
    for rel in B["files"]:
        cur = {s["name"]: {"crossings": s["counts"]["crossings"], "occlusion": s["counts"]["occlusion"]}
               for s in lc.check_workflow(json.load(open(rel, encoding="utf-8")))}
        for scope, v in cur.items():
            base = B["files"][rel]["scopes"].get(scope)
            if base != v:
                print(rel.split("/")[-1], scope, base, "->", v)
    EOF
    ```
  - Expected: 只打印有变化的作用域(`旧值 -> 新值`)。按输出改 `workflow_layout_baseline.json` 的 `files`:降了照降;升了必须在 Q3 容差内,并在该文件顶层加一个 `ruling` 键,值写「交叉容差上调经用户裁决」加执行当天的日期。超出容差的升幅说明 Task 5 的守门没生效,回 Task 2 查,不改基线迁就。
- [x] Step 6.10: 哨兵重锚。逐条看红断言:「关系」仍成立只是数值变 → 只改断言里的数值常量,行尾注「布局整治重锚」;「关系」不成立(例如说明卡不再高于组框、加速框罩不住成员)→ 回 Task 2 修整理器,不改测试。(补检 1127 实跑同命令:283 passed, exit=0)
  - Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_qwen21_workflow_contract.py backend/comfyui/tests/test_qi21_local_face_contract.py backend/comfyui/tests/test_daojie_sheet_card_workflow.py backend/comfyui/tests/test_daojie_sheet_card_qwen_workflow.py backend/comfyui/tests/test_three_stage_contract.py backend/comfyui/tests/test_multiseg_full3stage_contract.py -q`
  - Expected: 退出码 0,`failed 0`。

### Task 7: 脚本命名合规(R10;AC10)

**Files:**
- Modify: `apps/build/scripts/scripts-hygiene-exemptions.json`
- Delete: `apps/build/scripts/qi21_huanlian_compact_1126.py`

**Interfaces:** 无。

- [ ] Step 7.1 (RED): `cd apps && npm run lint:scripts` → Expected: 点名 F12 的 6 件。(证据缺口:RED(6 个)当期输出未留档——Step 0.5 基线日志缺;6 件名单仅见于 prd.md F12)(候用户追认/候令,见 ac-evidence.md)
- [x] Step 7.2: 在 `exempt` 里按既有理由格式登记四件——`qi21_edit_accel_fix_1126.py`、`qi21_local_inpaint_build_1126.py`、`sn_local_inpaint_build_1126.py`、`sensenova_daojie_build_1126.py`;理由照既有格式「战役脚本日期名(2026-11-26 役产物;铁律5 顶层禁日期名的既存豁免通道,布局整治役随役登记)」。(补检 1127 实跑同对拍:`213 True`)
  - Run: `python3 -c "import json; d=json.load(open('apps/build/scripts/scripts-hygiene-exemptions.json',encoding='utf-8')); print(len(d['exempt']), all(k in d['exempt'] for k in ('qi21_edit_accel_fix_1126.py','qi21_local_inpaint_build_1126.py','sn_local_inpaint_build_1126.py','sensenova_daojie_build_1126.py')))"`
  - Expected: `213 True`(原 209 件 + 4 件)。
- [x] Step 7.3: 删除落后脚本。Run: `git rm apps/build/scripts/qi21_huanlian_compact_1126.py && git status --short -- apps/build/scripts/qi21_huanlian_compact_1126.py` → Expected: 一行 `D  apps/build/scripts/qi21_huanlian_compact_1126.py`。(补检 1127:文件已不在;`git show --stat e9ff0760` 含该件删除 309 行——删除已成事实,仅当期 git rm 输出未留档)
- [x] Step 7.4 (GREEN): `cd apps && npm run lint:scripts; echo "exit=$?"` → Expected: 输出只剩 `mistake_notebook_consolidate_1126.py` 一件(不属本役,单列呈报);本役五件(四件登记 + 一件删除)不再被点名。(补检 1127 实跑:`RED(1 个,…) [MMDD] mistake_notebook_consolidate_1126.py`,exit=1——仅剩不属本役 1 件,符合预期口径)

### Task 8: 全范围验证、规范沉淀、提交与交付(R7 R8 R9;AC7 AC8 AC9)

**Files:**
- Modify: `apps/build/scripts/workflow_gate.py`(`CONTRACT_TESTS` 加 `backend/comfyui/tests/test_workflow_layout_gate.py`)
- Modify: `docs/comfyui-kb/画布布局规范.md`
- Modify: `.agents/skills/node-graph/OPTIMIZATION.md`
- Modify: `docs/engineering/TESTING_ENTRYPOINTS.md`

**Interfaces:** 无。

- [x] Step 8.1: 把新测试挂进 `workflow_gate.py` 的 `CONTRACT_TESTS`。(补检:`workflow_gate.py:96` 清单已含新测试;1127 实跑 test:workflow 四段 GREEN——工作流已提交,段3 实跑 PASSED 而非 SKIP)
  - Run: `cd apps && set -o pipefail && npm run test:workflow 2>&1 | tee output/automation/layout-campaign/test-workflow-after.log; echo "exit=$?"`
  - Expected: 段 1、2、4 `PASSED`,段 2 的 pytest 清单含新测试;段 3 `SKIPPED`(三件主力件相对 HEAD 有未提交改动,属预期);退出码 0。
- [ ] Step 8.2: 全量 Python 域。(证据缺口:整治后全量六域 test:py 日志未留档;最近一份 python-tests-report.json 为 11-27 14:26、早于终笔提交 15:08 且 my_nodes 域红。补检 1127 抽跑 my_nodes 域:963 passed / 8 failed——失败均在并行役(11-26-image-workflow-engine-reconcile)在途范围内(该役正改 image_gen/server.py、pipeline.py、comfyui_bridge.py、qwen21.py 及 my_nodes 多个测试文件;抽查 test_qi21_charsheet_six_zone 失败断言为 positive_text≠rgba_positive,提示词内容问题,与布局无关);全量留主脚本 world.run 复跑)(候用户追认/候令,见 ac-evidence.md)
  - Run: `cd apps && set -o pipefail && npm run test:py 2>&1 | tee output/automation/layout-campaign/test-py-after.log; echo "exit=$?"`
  - Expected: 退出码 0,六个域齐全,失败数不高于 Step 0.3 的基线。
- [x] Step 8.3: 卫生域。Run: `cd apps && npm run hygiene; echo "exit=$?"` → Expected: 七项里 `scripts-hygiene` 只剩不属本役的 1 件红(单列呈报,不算本役通过);其余六项全绿。(补检 1127 实跑:`scripts-hygiene` 红=仅 `mistake_notebook_consolidate_1126.py`(不属本役)✓;其余六项中五项 PASS,`file-size` 另红 1 件 `VisualContinuityReviewPanel.tsx`(834 行,非本役文件、本役未改任何 tsx,系他役在途)——偏离「其余六项全绿」的字面,如实记档)
- [x] Step 8.4: 模板同步门与前端界面图测试。Run: `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_template_sync.py -q && npx vitest run --config frontend/config/vite.config.ts lib/comfyui/h3/h3-shot-video-workflow.test.ts` → Expected: 两条退出码 0。(补检 1127 实跑:2 passed+7 subtests;82 passed,均 exit=0)
- [x] Step 8.5: 批处理脚本终检。Run: `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --check; echo "exit=$?"; python3 -c "import json; s=json.load(open('apps/output/automation/workflow-layout-report.json',encoding='utf-8'))['summary']; print(s['overlap_after'], s['out_after'], s['tight_after'], s['non_fixed_point'])"` → Expected: `exit=0`;四个数依次是 `0 0 0 0`(无解件为 0 时;若 Step 5.3 呈报后用户保留了无解件,`non_fixed_point` 等于那些件数,须与清单一致)。(补检 1127 实跑:exit=0;四数 `7 18 58 6`——属本步括号内预见的「用户保留无解件」终态:钉册 6 件(4 无解+2 fasth3 拒写,264b0c69/b8f16fb6 已批),非不动点 6 与钉册清单一致,余量互遮 7/出框 18/贴边 58 全在钉册件内)
- [x] Step 8.6: 全库不动点终检(后台跑,约 5 分钟)。Run: `cd apps && LAYOUT_GATE_FIXED_POINT=1 python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q` → Expected: `6 passed`。(补检 1127 实跑:`9 passed in 70.72s`——测试数 6→9 系 1127 返工补的三个回归用例,含 fixed_points 全过)
- [x] Step 8.7: 规范落账:`docs/comfyui-kb/画布布局规范.md` 补「1126 布局整治」一节(三个新判据、目标档、组框重算、检查器两处修正、无解件处置);`.agents/skills/node-graph/OPTIMIZATION.md` 布局策略章同口径补一段;`docs/engineering/TESTING_ENTRYPOINTS.md` 的「工作流 JSON」行补「段 2 含全库布局机器门」,`preflight_gate` 共享真源举例补「工作流库与蓝图夹」。(补检:`画布布局规范.md` 含布局整治节、`TESTING_ENTRYPOINTS.md:14` 段 2 表述与 `:26` 共享真源举例均在档;提交 2be6b294;hygiene docs 类检查无新增红)
  - Run: `cd apps && npm run hygiene; echo "exit=$?"`
  - Expected: 与 Step 8.3 同(`docs-current-audit` 等文档类检查不因本步新增红项)。
- [ ] Step 8.8: 图变更分析与提交计划。Run: `python3 apps/build/scripts/gitnexus_freshness_check.py --strict && node .gitnexus/run.cjs detect-changes --scope all --repo .` → Expected: 新鲜检查通过;`detect-changes` 不报 `partial` / `truncated`(报了就重跑)。然后把提交计划(文件清单、每笔的修改原因、验证结果、剩余不确定性)呈交用户,**等用户确认**后按下列批次提交——工作流与其全部钉死面必须同一笔,拆开会让中间提交测试红:
  1. 技能工具:`.agents/skills/node-graph/tools/layout_check.py`、`layout_normalize.py`
  2. 批处理脚本:`apps/build/scripts/` 下 `workflow_layout_normalize_campaign.py`
  3. 整治与钉死面同步(一笔):`apps/backend/comfyui/workflows/`、`apps/backend/comfyui/my_nodes/subgraphs/` 下实际有改动的件;`apps/frontend/lib/comfyui/h3/templates/` 四件;`apps/build/scripts/` 下 `multiseg_ui_template_build.py`、`sensenova_daojie_build_1126.py`、`sn_local_inpaint_build_1126.py`、`qi21_local_face_mask_repair_1027.py`、`workflow_layout_baseline.json`;哨兵测试
  4. 机器门:`test_workflow_layout_gate.py`、`workflow_layout_far_baseline.json`、`apps/build/scripts/workflow_gate.py`、`docs/engineering/TESTING_ENTRYPOINTS.md`
  5. 脚本命名:`scripts-hygiene-exemptions.json`、删除 `qi21_huanlian_compact_1126.py`
  6. 规范:`docs/comfyui-kb/画布布局规范.md`、`.agents/skills/node-graph/OPTIMIZATION.md`
  (补检 1127:六笔批次提交在 git log(e9ff0760 / cb14001f / 73a4e69c / afd3a375 / 34587403 / 2be6b294),路径切分与本计划一致;证据缺口:freshness/detect-changes 当期输出未留档,呈交用户确认的对话记录不在仓库内)
- [x] Step 8.9: 提交后复验棘轮(段 3 只有提交后才会真跑)。Run: `cd apps && npm run test:workflow; echo "exit=$?"` → Expected: 四段全 `PASSED`,退出码 0。(补检 1127 实跑(终笔提交 264b0c69 之后):汇总 GREEN——generators/contract/layout/placement 四段全 passed,exit=0)
- [x] Step 8.10: 打包与装机(**须用户明令「打包」才跑**;打包前用户已退出应用)。1127 装机日志已记录覆盖安装、smoke 与 Launch Services 启动通过，见[续做复核](research/closeout-verification-1127.md)。
  - Run: `MANYYING_ALLOW_APP_LAUNCH=1 bash apps/build/packaging/build-mac.sh`
  - Expected: 末段打印 `Installed app verified: smoke passed and app opens via Launch Services`。
- [x] Step 8.11: 装机独立复核。Run: `cd apps && npm run verify:installed; echo "exit=$?"` → Expected: 退出码 0,`verify-installed-report.json` 两向 asar 哈希相等。1127 的 17:27 回执 `ok=true`，打包与装机 asar 指纹相等，见[装机对拍](research/installed-layout-audit-1127.json)。
- [x] Step 8.12: 装机副本抽查三件主力件。Run: `for f in "1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json" "1_图片/QwenImage2.1/2_图生图/qi21-edit.json" "2_视频/H3视频/6_视频重制/fasth3-单镜视频-i2v.json"; do cmp "apps/backend/comfyui/workflows/$f" "/Applications/漫影工作室.app/Contents/Resources/backend/comfyui/workflows/$f" && echo "SAME $f"; done` → Expected: 三行 `SAME …`。1127 以 Python `read_bytes()` 独立复核三件仓库与装机副本，退出 0，逐字节相等，见[归档预检](research/archive_precheck_20261127.md)。
- [ ] Step 8.13: Windows(**须用户明令才跑**;前提是 Step 8.8 的提交已按用户同意推送到 origin/main——Windows 侧只拉已提交代码)。Run: `bash apps/build/packaging/deploy-dual.sh --skip-mac` → Expected: 末行 `🎉 双机部署完成`。工作树因别的会话在途文件而脏、且用户明令立即部署时,才按脚本头注用 `DEPLOY_ALLOW_DIRTY=1` 越过脏树检查。之后请用户在两台机器的应用里各打开几件工作流亲眼确认(判定权在用户)。 (AC9)(候用户明令 Windows 部署,未跑;且前提「Step 8.8 提交已推送 origin/main」尚未发生——本役提交仅在本地 main)

## 验证表(验收 ↔ 命令 ↔ 预期)

| AC | 命令 | 预期 |
|---|---|---|
| AC1 | `python3 apps/build/scripts/workflow_layout_normalize_campaign.py --check` 后看 `apps/output/automation/` 下的 `workflow-layout-report.md` | 两个根下 GUI 件逐件在册;每件有三类问题整治前后数字或未写原因 |
| AC2 | `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k group_overlap` | 通过 |
| AC3 | 同上 `-k nodes_inside_groups` | 通过 |
| AC4 | 报告每件的档位 + Step 8.5 的 `non_fixed_point` + Step 8.6 | 每件有档位;未达最紧档的件写明拦截判据;不动点检查通过 |
| AC5 | 报告逐作用域 `before` / `after` 对照 `cross_tol` | 交叉增量不超容差,其余判据零新增;超容差的件不会被写入 |
| AC6 | `cd apps && python3 -m pytest backend/comfyui/tests/test_workflow_layout_gate.py -q -k refuses` + `git diff --stat -- apps/backend/comfyui/workflows apps/backend/comfyui/my_nodes/subgraphs` | 前者通过;后者的改动件数 = 报告里 `written` |
| AC7 | `python3 .agents/skills/node-graph/tools/layout_check.py --selftest && python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest && cd apps && npm run test:workflow` | 两条 `selftest: 0 failure(s)`;段 2 清单含 `test_workflow_layout_gate.py` |
| AC8 | `cd apps && npm run test:py && npm run test:workflow && npm run hygiene` | 前两条退出码 0;`hygiene` 的 `scripts-hygiene` 只剩不属本役的 1 件 |
| AC9 | Step 8.11、8.12、8.13;用户目检 | 逐字节相等;用户确认 |
| AC10 | `cd apps && npm run lint:scripts` | 不再点名本役五件(四件登记 + 一件删除) |

## Execution Checkpoint Matrix

| Checkpoint | 证据 | 放行条件 |
|---|---|---|
| Pre-change | Q1–Q4 与 A15 已于 2026-11-27 定案并写入 `design.md` §0;Task 0 三份基线日志在 `apps/output/automation/layout-campaign/baseline/`;preflight 已过 | 用户说「批准,继续做」并跑了 `task.py start` |
| RED | Step 1.1、1.3、1.5、1.7、1.9、1.11、2.1–2.33 各 RED 步、3.1–3.4、7.1 的失败输出 | 失败原因都是目标行为缺失,不是语法、路径或环境 |
| GREEN | 各任务标 GREEN 的步骤输出;Step 5.5、6.10 | 当前任务的实现证据闭合 |
| Mid-campaign review | Step 4.8 与 Step 5.3 的数字和五张清单 | 用户看过数字与清单后再进 Task 6 |
| Per-task review | check 工人的 VERIFICATION REPORT | Critical / Important 已修复并复核 |
| Full-scope verification | Step 8.1–8.7 的 fresh 输出;`python3 ./.trellis/scripts/task.py analyze .trellis/tasks/11-26-workflow-layout-normalize` | 各命令退出码符合预期;analyze 无结构问题 |
| Human review | Step 8.8 的提交计划;Step 8.10 之前用户在应用里看过的布局预览 | 用户明确批准后才提交;打包与 Windows 部署各须用户明令 |

---

### Task 9(1127 返工):修「压缩放大」缺陷并全库重跑

**Files:**
- Modify: `.agents/skills/node-graph/tools/layout_normalize.py`(线遮修补改冻结;`_ladder_round` 加不放大上限;自测加 N19)
- Modify(经脚本): `apps/backend/comfyui/workflows/`、`apps/backend/comfyui/my_nodes/subgraphs/`、`apps/frontend/lib/comfyui/h3/templates/`(先还原到整治前 `d2e10566`,再用修正后的工具重跑)
- Modify: 钉死面同步各件(同 Task 6 清单)

**Interfaces:** Consumes: 修正后的 `normalize`(对外签名不变)。Produces: 零放大的整治结果。

- [ ] Step 9.1 (RED): 加自测 N19「压缩不放大」(N10 夹具:整治后各轴节点包围尺寸 ≤ 整治前)。Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest N19` → Expected: 退出码 1,`FAIL - N19`(首版会把节点推到线下方,尺寸变大)。(证据缺口:RED 期 `FAIL - N19` 输出未留档;N19 用例已在库,1127 补检实跑 PASS)(候用户追认/候令,见 ac-evidence.md)
- [x] Step 9.2 (GREEN): 空组框改同框架刚体伪节点 + `ceiling` 上限 + 线遮冻结 + `_push_dir` 最小推开。Run: `python3 .agents/skills/node-graph/tools/layout_normalize.py --selftest` → Expected: 退出码 0,N1–N19 全过。(补检 1127 实跑:N1–N22 全 PASS、`selftest: 0 failure(s)`、exit=0——用例数已超 N1–N19,系两轮返工续加;提交 a44a5029)
- [x] Step 9.2a: 对仍放大件逐一归因(出框推开/组分离/空框伴飞边/并组),可避免放大按归因再修;自测补最小反例。Expected: 全库只读实测(dry-newtool.json)放大件 0 或逐件注明 R2/R3 必要推开;全库面积不增。
- [x] Step 9.3: 四件(同 Step 1.15)。Expected: `FOUR-GATES-OK`。
- [x] Step 9.4: 把 145 件布局文件还原到整治前(`git checkout d2e10566 -- <B3 提交里的布局件>`;先核这些路径在 `d2e10566..HEAD` 间除本役提交外无他人提交),再跑 `--check`。Expected: 退出码 0;逐件实测「整治后各轴 ≤ 整治前或 ≤ 只修组框档」,零放大。
- [x] Step 9.5: `--apply --allow-reformat workflows/1_图片/SeeThrough/seethrough-layer-editor.json`,再 `--check --write-far-baseline`。Expected: 两条退出码 0。
- [x] Step 9.6: 钉死面重同步(Step 6.2–6.10 同法):生成器三件重导出并核 SAME-BYTES、`--sync-blueprints`、守护 SHA 与契约上限、棘轮基线、前端三副本重拷、界面图重生成与 vitest、哨兵测试。
- [x] Step 9.7: 验证:`npm run test:workflow`、`npm run test:py -- --domain backend_unittest`、全库不动点(`LAYOUT_GATE_FIXED_POINT=1`)、模板同步门、`--check` 非不动点数 = 无解件数。
- [x] Step 9.8: 两笔路径限定提交(工具修复;重跑产物与钉死面同步),提交后复验 `npm run test:workflow` 四段。
- [x] Step 9.9: 实物前后对照(节点包围面积、整图缩放、变大件数)写进 `design.md` §10 并呈报用户。
