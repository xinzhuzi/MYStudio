# 调用集(交付管线·三真源地图·工具配方)
> 拆自 SKILL.md(1008 重组役);本文件为该域真源,冲突以真源地图三件为准

## 6. 工作流文件四副本与读取路径(改前追真读源,改后热覆盖)

**⭐ 唯一交付管线(1007 判图役五连修定谳+1007晚 出口销整备改序:契约前置,验证绿了才准部署;禁跳步禁凭感觉)**:

1. **改仓库真源**(唯一编辑位;生产件=带断言手术脚本,fail-closed)。
2. **契约测试(前置门,绿了才准进第 3 步)**:`pytest tests/test_qwen21_workflow_contract.py my_nodes/tests/ -q`——**零新增红;不绿=带伤部署,坏版本会流进用户画布被点运行(1007晚 实弹:reroute 手术 4304 slot 错,契约当场抓到,但部署已先行,用户窗口期执行被前端校验拒收=全节点零输出)**。既有红账如实注,零新增为准。
3. **cp 热覆盖**(按类型):.py=仓库→装机 Resources→引擎家 custom_nodes 三方;工作流 JSON=仓库→装机→引擎缓存三方**+蓝图 subgraphs 双刷**+`qi21_blueprint_sync_1001.py --check`;JS=仓库→装机→引擎家两方。
4. **生效动作**(按类型,缺这步=用户看到的永远是旧的):.py→**重启引擎**(队列==0 硬门);工作流 JSON→**画布重载文件**(关签重开或 CDP `loadGraphData`——**reload 页面只恢复会话快照≠读盘**);JS→**页面重载**(no-cache 已根治缓存)。
5. **活机读数**(无读数不得报「已生效」;只许说「盘上已改待载」):.py→`/object_info/<类>`+路由 curl;JSON→CDP `app.graph.serialize()` 读 definitions(根图恒 `app.graph`,`app.canvas.graph` 在子图视图=内层图);JS→CDP 验 DOM(`w.element/inputEl` 在场,数据层在场≠渲染在场)。探针姿势=App 带 `--remote-debugging-port=9225` 启动→`/json/list` 取 webview target→executeJavaScript。
6. **报账**:生效声明+活机读数+测试结果,三件同报。

- 四副本:①仓库真源 `apps/backend/engines/comfyui/workflows/` ②装机包种子 `/Applications/….app/Contents/Resources/backend/…` ③构建产物 `apps/release/build/…`(拿它代替验证=AGENTS 禁)④引擎家用户区 `<engine-home>/ComfyUI/user/default/workflows/`(用户另存件家;旧快照与 repo 恒 differ=用户手存非装机件)。`~/Library/漫影工作室`=软链→新家,非第五处。
- **改任何 UI/工作流前先从用户看到的界面反向追实际读取路径**,勿只改理论源头(1005 十轮白改教训):侧栏 `repo:` 叶子直载读**②装机包**非④(活机判据 `activeWorkflow.path` 形如 `workflows/<rel>`);全图见排查文档 §七。
- **画布类改动=热覆盖零打包**(1006 最高令):仓库→装机包 Resources→引擎缓存三路覆盖,涉节点 .py 再加引擎家 custom_nodes 且须引擎重启(App 首启 sync 覆写 custom_nodes——手动 cp 引擎家重启必被冲掉,持久热修=改 Resources 种子);**蓝图/子图定义改动=装机 Resources 两处同批 cp**(`my_nodes/subgraphs/` 蓝图+`workflows/` 宿主工作流——侧栏真读装机包,漏 cp=用户侧仍旧,重启经 sync_my_nodes 进 custom_nodes);md5 指纹四处全一才算同步;**打包仅用户明令才跑 build-mac.sh**。又一坑(1007 晚实勘):**用户画布还持旧态时,App 一次保存/会话收尾就把旧内存态写回用户区缓存复毒**(实测 2424 复写发生在三路修复后 15 分钟,指纹=用户区 md5 又异于仓库)——修完三路必须让用户关签重开读到新态才算闭环,只对盘不对活机=白修;修复后画布未重开前勿按保存。

- **生效矩阵(改动类型→生效动作,1007 判图役五连修定谳,照单执行禁凭感觉)**:①节点 .py(类/路由/中间件)=cp 三方+**重启引擎**(队列==0 硬门)→object_info/路由探活;②工作流 JSON(含子图定义/出口槽位/预填快照)=cp 三方+蓝图双刷+**画布重载文件**(关签重开或 CDP loadGraphData——reload 页面只恢复会话快照≠读盘)→活机 serialize() 读数;③JS 扩展=cp 两方+**页面重载**(no-cache 头已根治缓存,重启引擎非必需除非同批改了 .py)→探针验 DOM。**凡报「已生效」必须带对应活机读数;报「盘上已改待载」也算诚实**。

- **⭐ 落点总表(一次修改到底要落几个地方,1007 晚出口销战役五修无效后全量定谳,照单落点禁凭记忆)**:
  - **节点 .py = 3 盘上落点**:①仓库真源 ②装机 Resources(`Resources/backend/engines/comfyui/my_nodes/`)③引擎家 `custom_nodes/my-nodes/`(引擎重启被 sync 从②覆写=手动只改③不持久);生效=重启引擎(队列==0)。
  - **JS 扩展 = 3 盘上落点**:同上三路(web/ 目录);生效=页面重载(no-cache 已根治缓存)。
  - **工作流 JSON = 3 盘上 + 3 会话层 = 6 落点(最复杂,少一个=「改了没变」)**:①仓库真源 ②装机 Resources(**侧栏 repo: 叶子真读这份**)③用户区缓存 `user/default/workflows/`(脏画布 autosave 会写回=复毒源)④**webview 草稿** localStorage `Comfy.Workflow.Draft.v2:personal:<path哈希>`(恢复优先级草稿>盘上,quit 时被活画布态回写)⑤已开标签内存态(workflow.content/changeTracker,关签即清、存档期写回④)⑥子图定义 uuid 注册表(会话内注册:节点布局随重载同步,**出口销等播种字段不跟**)。**子图定义改动另加蓝图** `my_nodes/subgraphs/*.json` 仓库+装机两刷(引擎家经 sync)=合计 7-9 落点。
  - **覆盖分工**:①②③=canvas_deploy.mjs 部署+`--audit` 全量对账(机器门);④⑤⑥=零动作交付配方(直推+换草稿+就地板)+渲染源读数+**截图**(唯一视觉铁证);子图布局另有契约锚=pytest `test_subgraph_row_layout_top_to_bottom`(带成员/带内 x 递增/链序)。
  - **App 前端(tsx/css)= 仓库 1 处+重打包**(asar 无热修,打包仅用户明令)。
- 活机自验:`node apps/build/scripts/comfy-canvas-verify.mjs`(**整跑 prekill 全家,用户开着 App 时禁跑**)或一次性 CDP 探针(连 9222-9231 活实例读 activeWorkflow.path/宿主 inputs/组框标题+截图,不杀 App)。
- **一键交付工具(1007 收尾固化,本管线 2~4 步的代码化)**:`node apps/build/scripts/canvas_deploy.mjs <文件...> [--verify-only]`——判型(py/js/subgraphs json/workflows json)→cp 热覆盖→生效动作→活机读数→PASS/FAIL 即交付结论(exit code=verdict);`--verify-only`=只读验收零部署。报「已生效」引用它的读数即可。三坑已内治:扩展 URL=WEB_DIRECTORY 内容平铺进 `/extensions/<节点目录>/` 无 web/ 段(从 `/extensions` 注册表反查,勿拼路径)/lsof 的 `-i` 与 `-p` 是 OR 关系必须加 `-a`(否则扫全系统监听面抓到别的进程的口)/py 类提取按顶格 `^class`(勿要求缩进)。
- **指纹门=机器门,散文对账作废(1007晚 复毒事故立宪)**:报「同步完成/指纹一致/零漂移」前必跑 `node apps/build/scripts/canvas_deploy.mjs --audit`——全量扫 workflows+my_nodes 三副本 md5(装机=必须同;用户区=存在必须同,缺席=NOTE 零回灌基线非漏;tests=豁免),FAIL 点名文件,exit code=verdict。**理由:三处对账规则在库三处(本件/排查文档§五.5/记忆四副本图),两任执行人仍各漏一次——门在散文里靠自觉逐条对=必漏,只验自己改过的件=验不全;机器门一键全量+反事实自证(弄漂一份必红)后才算门。**交接胶囊转来的哈希数不算数,接手验收必须自己重跑门。

## 7. 展示与交付纪律

- **展示节点图/拓扑/数据流一律用 mermaid graph 代码块**(graph LR/TB+subgraph 分层+节点标签带编号短名+分支带标签连线 `-->|"条件"|`),**禁字符画箭头图**(用户终端错位难读,1002 裁定)。
- **交付三道门**(画布/节点 UI 类改动,不过不报完成):①指纹三处(仓库+装机包+引擎缓存)md5 同一;②相关 pytest 绿;③活机对账+截图 AI 亲眼看渲染。禁拿用户当测试仪(1005 问责立宪)。
- **诊断顺序**:活机探针>读前端源码(Comfy-Org/ComfyUI_frontend)>同仓参照件逐字段 diff>才轮到假设;禁凭记忆编序列化格式。

## 三真源地图(什么情况读哪个、读到哪节)

| 症状/任务 | 去处 |
| --- | --- |
| 节点图是什么/范式/图论/求值/端口类型 | `.claude/knowledge/node-graph-architecture.md` §1-§4 |
| 自动布局算法原理 | 同上 §5 |
| ComfyUI 内核/旧 React Flow/undo/持久化/错误语义 | 同上 §6-§10 |
| 本项目画布架构/桥/工作流库/迁移 | 同上第二部分 §13-§20 |
| 「改 X 去哪」/不可协商裁定/历史坑 | 同上第三/四/五部分 |
| 布局优先级序与交叉治理(立宪) | `docs/comfyui-kb/画布布局规范.md` |
| 宿主面板不渲染/槽错名/widget 丢失/六同步清单/缓存路径全图 | `docs/comfyui-kb/子图宿主面板排查.md` |
| 子图 linkIds 症状三连/装载机理/收装惯例/蓝图件 | `docs/comfyui-kb/子图工作流工程契约.md` |
| 工作流构建/连线/类型/Subgraph/参数化 | `.agents/skills/comfyui/SKILL.md` 的「Compose a NEW workflow from pieces」「Workflow JSON」「Subgraphs」章 |
| 布局工具三函数 | `.agents/skills/comfyui/workflow_layout.py` |
| 本地捆绑工具(排布+est 口径+立宪检查) | 本技能 `tools/workflow_layout.py`(归因副本)与 `tools/layout_check.py`(立宪口径检查器);配方见「工具调用配方」章 |
| 孤儿节点/节点清单 | `.agents/skills/comfyui/tools/find_orphan_nodes.py` 与 `node_inventory.py` |
| 契约测试锚(布局谓词的测试面) | `apps/backend/engines/comfyui/tests/`(如 test_qwen21_workflow_contract.py) |
| 生产工作流生成器(**1001 起退役勿重跑**=史档)与基线真源 | `apps/build/scripts/`(生成器三件+`workflow_layout_baseline.json` 单源;账见 0928 立宪文档 §三) |

> 路径失效时按文件名在 `docs/comfyui-kb/` 与 `.claude/knowledge/` 下重找(真源改名容错)。

## 工具调用配方(本地 tools/ 两件;孤儿/清单两件仍驻 comfyui 技能)

本技能 `tools/` 捆绑两件通用工具:`workflow_layout.py`(归因副本,上游 SlavaSexton/ComfyUI-Agent-Kit,Apache-2.0;上游更新时以 comfyui 技能原件为准重新拷贝)与 `layout_check.py`(本技能自有立宪检查器)。入参 `wf`=GUI 格式工作流 dict(顶层含 `nodes`/`links`,即 `json.load` 读文件的结果;不是文件路径):

```python
import sys; sys.path.insert(0, "<repo>/.agents/skills/node-graph/tools")
import workflow_layout as wl
wl.inspect(wf)           # 报重叠/交叉/边界(近似读数,口径边界见路由器头部声明)
wl.auto_layout(wf)       # 依赖深度左→右排布(仅非项目临时图;生产件禁 --apply)
wl.fit_group(wf, "组名")  # 加一个全罩组框(先排布后调用)
```

- `inspect()` 返回 `summary`(nodes/edges/overlaps/crossings/bounds)与明细;`overlaps` 必须为 0,`crossings` 只作粗计参考(立宪判据用 layout_check)。
- workflow_layout CLI 等价:`python3 .agents/skills/node-graph/tools/workflow_layout.py 图.json` 只读检查(打印 BEFORE 摘要);`--apply` 是就地重排旗标,仅限非项目临时图,生产件禁。

`tools/layout_check.py`=0928 立宪口径的可跑实现(数学逐式移植自生成器自查段,对拍过三件生产件基线;判定口径见优化集 OPTIMIZATION.md ④,验证定位见优化集 ⑥):

```bash
python3 .agents/skills/node-graph/tools/layout_check.py 图.json            # 按域分报检查
python3 .agents/skills/node-graph/tools/layout_check.py 图.json --json     # 机读违规明细
python3 .agents/skills/node-graph/tools/layout_check.py --selftest         # 内嵌合成用例自测
```

- 检查项=优化集 OPTIMIZATION.md ④ 判定口径全集(贝塞尔交叉/线遮节点/est 盒零重叠/est 间距/零负区/输出口最右/左向线——七项,与工具 `CHECK_KEYS` 一致);顶层=scope main,`definitions.subgraphs[]` 每个=独立 scope(`sub:<名>`);−10/−20 边界线在交叉与遮挡两口径同跳过。
- **末行硬契约**:无论是否违规,最后一行恒打印 `LAYOUT_CHECK_JSON: {"scopes":[{"name":"main","crossings":N},...]}`——对拍脚本靠这行取数;`--json` 时各 scope 条目另含 `counts` 分项违规数明细。
- 参数:`--max-crossings N`=每 scope 交叉封顶(默认 0=立宪治理目标;棘轮现值**不内置**,生产棘轮驻生成器自查段);`--allow-leftward id1,id2`=左向线豁免清单(冻结回流线用,豁免须钉死见优化集 OPTIMIZATION.md ③)。违规 exit 1 并逐项打印;输入/用法错误 exit 2(不与违规混淆)。
- 孤儿节点与节点清单两件未捆绑,仍在 comfyui 技能原地调用:`python3 .agents/skills/comfyui/tools/find_orphan_nodes.py <工作流.json> [--prune]`(--prune 另出 .cleaned.json 不动原件;Note/广播/SetGet 类只报不剪)与 `python3 .agents/skills/comfyui/tools/node_inventory.py`(重生成节点目录 markdown,需引擎在线)。
