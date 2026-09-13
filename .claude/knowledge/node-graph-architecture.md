# 节点图知识文档(通用原理 + 本项目架构)

> **本文件为节点图领域权威知识文档**(2026-09-07 建立,2026-09-10 换代重写):第一部分是节点图行业通用知识(范式/图论/求值模型/布局算法/ComfyUI/React Flow 内核/undo/持久化/错误语义),第二部分是本项目 **ComfyUI 换代终态**架构,第三部分是"改 X 去哪"任务地图,第四部分是已生效裁定,第五部分是已知坑与存疑。**任何涉及画布、节点、工作流库、存量迁移、生成的任务,动手前先读本文件**;锚点以符号名为准,行号过期以代码实况为准。
>
> 路径约定:`FE/` = `apps/frontend/`,`BE/` = `apps/backend/`。

---

# 第一部分:通用知识(行业共识)

> 所有来源 2026-09 实际抓取核验(官方文档/源码/论文/RFC),文末附 URL;网络误传勘误表见 §12。

## 1. 节点图范式 = dataflow programming 的图形化

**一句话内核**:程序被建模为"数据在操作之间流动的有向图"——节点是黑盒操作,边显式声明数据依赖;执行顺序由图拓扑而非语句顺序决定。

- 点火规则:"An operation runs as soon as all of its inputs become valid"——天然无隐藏状态、天然可并行。
- 理解捷径:**把节点图看成"自动排好调用顺序的函数调用网"**——节点=函数调用,边=实参传递。
- 优点:依赖显式可审计、易并行、子图可复用;缺点:大图可读性差——业界用 group/subgraph/minimap/折叠缓解。
- 同一思想的非图形化身:spreadsheet 单元重算、makefile 依赖、TensorFlow/Flink/Spark 计算图。

## 2. 图论基础:DAG / 拓扑排序 / 环检测

**一句话内核**:可执行节点图几乎总是 DAG;拓扑排序给出合法求值顺序,排序失败即有环——"禁止回连"的数学根据。

- **拓扑序**:每条边 (u,v) 满足 u 在 v 前;非唯一(并列分支可互换)。
- **Kahn 算法** O(V+E):入度 0 入队 → 出队删出边 → 新入度 0 入队;有剩余 = 有环。
- **DFS 算法** O(V+E):临时标记进入/永久标记完成,输出 reverse post-order;遇临时标记 = back edge = 环。
- 工程共识:环检测在**连线瞬间**完成,不是执行时才炸;反馈语义用显式特殊节点建模(UE Timeline、ComfyUI 子图展开)。

## 3. 求值模型:pull / push / 脏传播 / 输出缓存 / 增量计算

**一句话内核**:pull(lazy)从输出端按需回拉上游(Houdini cook、ComfyUI),push(eager)从变更点向前点火;实际系统=混合("脏标记 push 式打标 + 按需 pull 式求值")。

- 脏传播:参数变更→该节点脏;上游结果变→下游全脏;求值"只重做变了的"。
- **增量计算理论谱系**(理解缓存的深层模型):
  - **Adapton**(PLDI 2014):demand-driven + thunk memo + 依赖图,输入变更只把受影响 thunk 标 dirty 局部重算;
  - **Salsa / red-green**(出自 rustc 增量编译):查询=依赖图节点;green=结果仍有效,red=须重算;重算后 hash 不变则 **early cutoff** 截断级联——"验证比重算便宜"是全部收益来源;
  - **Build Systems à la Carte**(ICFP 2018;不是 "Carter"):rebuilding 精确性 × 依赖静态性两轴,Make/Shake/Bazel 都是坐标系中的点;
  - **ComfyUI 输入签名缓存** = 无版本计器的 Salsa:签名(全祖先内容哈希)扮演 revision,memo 命中即 green;`NaN`=永远重算;`IS_CHANGED`=自定义验证钩子。
- 与本项目对照:本项目是"用户手触发 + 单点 pull"——点「生成/执行」才回拉上游,无自动脏传播;衍生过期 staleSince 是轻量脏标记。

## 4. 端口类型系统(Socket/Handle Types)

**一句话内核**:端口类型 = 视觉编码(颜色/形状)+ 连线时类型检查与自动转换;Blender color-coded socket 是最完整范本。

- Blender:Geometry=绿、Float=蓝、Int=柠檬绿、Boolean=紫红;未连接=空心、连接后=实心;multi-input socket 可接多线。
- 类型检查位置:ComfyUI 在验证阶段做 received_type vs input_type。
- 自动转换:Blender/UE 在兼容类型间自动转换(UE 自动插 autocast 节点);不兼容拒连。

## 5. DAG 自动布局算法

**一句话内核**:主流"自动排版"= Sugiyama framework 五步流水线(去环→分层→虚拟节点→消叉→坐标),核心子问题全是 NP-hard 所以全用启发式;**手工泳道是把"分层"语义化后交给人类,其余阶段简化掉**。

- 五步:① cycle removal(最小 feedback arc set,NP-complete,贪心);② layer assignment;③ 跨层边拆 dummy vertices;④ crossing reduction(barycenter/median heuristic);⑤ coordinate assignment(Brandes–Köpf 线性,每边最多 2 拐点)。
- **longest-path layering**:按"出发最长路径长度"定层,Mirsky 定理保证最少层数;一遍拓扑序完成;缺点=层宽不受控。
- **Coffman–Graham layering**:每层 ≤W,层数 ≤ 最优的 2−2/W 倍;适用"列宽受控"。
- **dagre**(MIT):骨架=Gansner et al.(Graphviz dot 论文);速度优先于最优。**elkjs**(⚠️ EPL-2.0):GWT 转译非原生 JS,耗时建议 Web Worker。
- 泳道 vs 自动布局取舍:泳道列=语义阶段、结果可预测;全自动"好看但不可预测"且每次重排破坏用户心智地图。工程折中=只自动化语义最强的分层阶段+列内受控排序。

## 6. ComfyUI 执行引擎(本仓画布的现行内核)

**一句话内核**:节点=注册进 NODE_CLASS_MAPPINGS 的 Python 类(INPUT_TYPES/RETURN_TYPES/FUNCTION 协议);执行分"验证→执行"两阶段;靠输入签名+IS_CHANGED 输出缓存跳过未变子图。

- 验证阶段:递归 validate_inputs(必填/类型匹配/字面量范围/自定义 VALIDATE_INPUTS)。
- 执行阶段:从 OUTPUT_NODE 拉取,ExecutionList 迭代调度;先广播 execution_cached 让前端置灰缓存节点。
- 错误语义:节点异常组装 `error_details{node_id, exception_type, traceback, current_inputs}` 回传,**错误标注到具体节点**;上游已完成输出保留在缓存,下游不再执行。
- 用户目录:引擎未传 `--user-directory` 时默认 `<引擎源码>/user`,前端工作流库读写 `<user>/default/workflows`——**本项目工作流库统一的根据**(§16)。

## 7. React Flow / xyflow(已退役内核,知识备查)

**一句话内核**:React Flow 是"内部 zustand store + d3-zoom/d3-drag 视口 + ResizeObserver 测量"的三层机器;受控模式=你的 state 经 props 与内部 store 双向同步。

- 09-09 换代批6/批8 后本项目画布不再使用 React Flow(§13);此节保留作史案与迁移器维护参考。
- v12 起:测量值一律在 `node.measured`;`onlyRenderVisibleElements` "可能提速也可能加开销";布局从不内置。
- 官方 performance 四条:自定义 node/edge memo 化;组件里避免直接读 nodes/edges;折叠大子树(hidden);最后才简化 CSS。
- 版本现状(2026-09):v12 线(`@xyflow/react`),无 v13。

## 8. Undo/Redo:command / snapshot / patch / event sourcing

**一句话内核**:命令栈赢在粒度与内存、输在"每个操作都要写 undo";快照栈赢在实现与正确性、输在内存(structural sharing 救)——**业界节点编辑器实际全走快照或反向 delta 路线**。

- 举证:UE Editor=FTransaction 快照;Blender=快照式 Undo History;ComfyUI 前端=ChangeTracker 整图 JSON 快照栈;Excalidraw=HistoryDelta 反向增量。
- 中间路线 patch 栈:Immer `produceWithPatches` → `applyPatches(inversePatches)`。

## 9. 图数据的持久化与变更检测

**一句话内核**:版本化靠 schemaVersion+迁移函数链;"图变没变"靠规范化序列化后的内容哈希;协同靠 CRDT(Yjs/Loro)但"图语义"要自己建模。

- 内容指纹:**RFC 8785 JCS**(键按 UTF-16 码元排序、无空白)→ SHA-256——本项目 storyboardSourceFingerprint(stableHash JSON 键排序)同思想。
- ComfyUI 前端已立 ADR-CRDT-LAYOUT-0003(布局意图与本地测量分离)。

## 10. 错误传播与重试语义

**一句话内核**:数据流图失败语义共识=**节点级归因 + 默认 fail-fast 短路(下游 skip、上游结果保留)+ 可选错误降级为数据 + 重试是节点粒度配置**。

- n8n:节点级 On Error 三选 + Retry On Fail + 工作流级 error workflow。
- 本仓对照:失败=节点 status:"failed"+errorReason(节点级归因)+弹窗;批量链失败跳过继续=Continue 语义;VLM 闸门 rejected 重生 1 次=节点粒度重试;fail-open 不阻断主链。

## 11. 业界参照系 + JS 库生态

| 系统/库 | 代表思想 | License |
|---|---|---|
| Blender Nodes | 类型即视觉语言(color-coded socket + multi-input) | — |
| Houdini SOP | 脏传播+可 lock 缓存的过程化 DAG;cook 按需求值 | — |
| Unreal Blueprint | exec wire+data wire 两类边共存;pure 节点=按需拉取 | — |
| n8n | 入口节点(trigger)驱动线性工作流 | — |
| **ComfyUI** | 本仓现行画布内核+执行引擎 | GPL-3.0(漫影经双许可合规使用) |
| React Flow(`@xyflow/react`) | 已退役;React 节点 UI 标杆 | MIT+attribution 政策 |
| dagre / elkjs | 布局库 | MIT / **EPL-2.0** |

## 12. 网络误传勘误表(2026-09 核验)

1. "React Flow 内部不维护状态" — 错;内部始终有 zustand store。
2. "`node.width/height` 是库量出的尺寸" — v12 起测量值在 `node.measured`。
3. "`onlyRenderVisibleElements` 一定更快" — 官方原话"may improve ... but also adds an overhead"。
4. "ComfyUI 执行器是递归的" — 现行 master 已改 ExecutionList 迭代调度(验证阶段仍递归)。
5. "快照式 undo 必然内存爆炸" — 配 structural sharing/截断完全可用。
6. "ComfyUI 用户目录可随意指" — 前端工作流库绑定 `<user>/default/workflows`,sidecar 库要同路径必须显式指向(§16)。

---

# 第二部分:本项目节点图架构(ComfyUI 换代终态,2026-09-10)

## 13. 全景:三槽位 webview + 一第六 tab,画布全 ComfyUI

**换代史**:09-09 comfyui-frontend-swap 四阶段落地,批6(c79cdc5)图片画布 React Flow 退役,批8(076df54)主分镜视图切换+React Flow 终局退役;09-09/10 音乐收敛 ComfyUI(f60c50c 音乐 tab 撤)、大模型展示入引擎卡模型页(82f2cfc)。

> **09-13 校准**(下表为 09-10 快照,按此增量阅读):①「辅助」入口 09-11 更名**「本地模型」**,FreedomView 五 tab 与 `ImageStudio.tsx` 已退役——assist 面板现= `ComfyWorkspace.tsx` 三态(`freedom-store.activeStudio`: comfy=ComfyCanvasStudio / tts=TtsStudio 配音室 / generate=LocalModelStudio 漫影生图);②分镜工作流画布 09-11/12 **全链迁 ComfyUI 收官**(991ad48):章节七环节链+分镜网格进 `漫影/0_工作流主线`,业务载荷经 `comfy-canvas/stage-payload-map.ts` 映射写入环节节点,studio 侧新增 NodeDocViewer 与 workflow-node-model-* 接线;③沉浸视图(本地模型/画布页签)零 chrome,唯一导航=全局悬浮球 AppOrb(含任务中心);④本地模型模块画布三层分离(09-12):侧栏/原生树过滤分镜+会话 partition。

| 挂载面 | 位置 | 说明 |
|---|---|---|
| 辅助·图片工作室 tab | `FE/components/panels/assist/ImageStudio.tsx`(壳)→ `comfy-canvas/ComfyCanvasSwap` | FreedomView 五 tab(image/video/cinema/tts/comfy)之一 |
| 主视图·分镜制作 | `FE/components/panels/studio/index.tsx` storyboard tab → ComfyCanvasSwap | 批8 主视图化 |
| 主视图·分镜画布 | 同上 imageWorkflow tab → ComfyCanvasSwap(带 onBack) | 资产/分镜深链入口 |
| 辅助·第六 ComfyUI tab | `comfy-canvas/ComfyCanvasStudio` 直挂 | 完整版(多引擎信息栏) |

- **ComfyCanvasSwap**(`comfy-canvas/ComfyCanvasSwap.tsx`):头部=标题+返回(可选)+**「导入存量画布(N)」按钮**(§17)+退役提示;主体=ComfyCanvasStudio(embedded)。`legacy` 入参为兼容残留不再渲染。
- **ComfyCanvasStudio**(`comfy-canvas/ComfyCanvasStudio.tsx`):引擎状态机三态占位(未装→一键安装/就绪未跑→启动/运行中→webview `http://127.0.0.1:<port>/`);**client 引用必须 useMemo 固化**否则探测 effect 循环重跑;webview `allowpopups` 须传字符串。它同时是**桥轮询宿主**:tab 在场每 5s——推分镜快照(pushBridgeStoryboards)+总览图库保鲜(syncStoryboardOverviewToLibrary,指纹守卫)+消费收件箱(consumeComfyBridgeWritebacks);inFlight 压重叠,轮询面静默不弹窗。
- 同一时刻只有一个实例在挂载(两处 Tabs 均无 forceMount,非活动 tab 卸载)→单路轮询。

## 14. manying_nodes:自有节点插件(仓库真源)

真源 `BE/engines/comfyui/manying_nodes/`(sync 至引擎 custom_nodes 不依赖打包;连字符目录不能直 import,验证走引擎 object_info):

- 节点(NODE_CLASS_MAPPINGS,现六类):`ManyingPrompt` / `ManyingReference` / `ManyingGenerated`(shot_target 经侧栏回填)/ `ManyingShot`(镜节点)/ `ManyingStage`(环节节点)/ `ManyingCloudImage`(云端图)。
- 前端扩展:`web/` 原 manying.js 单文件已拆为多模块(6697af8 起;`stage-node.js`+`stage-ui/`+`assets.js` 等,环节节点 UI 在此);拉 sidecar 分镜快照,点选回填 ManyingGenerated.shot_target;旧版前端无 sidebar API=静默跳过。**改 web/ 后须重打包才进安装版**(引擎 spawn 用 Resources 覆写引擎家)。
- 测试:`manying_nodes/tests/`;bridge 三件套见 §15。

## 15. 桥(sidecar↔webview↔渲染层)

| 模块 | 职责 |
|---|---|
| `BE/engines/comfyui/bridge_sidepanel.py` | 分镜快照数据面:渲染层周期 POST,webview 内扩展 GET 同址(CORS 回显+令牌);15 分钟 stale 标注 |
| `BE/engines/comfyui/bridge_inbox.py` | 生成结果收件箱(出图回写业务的落点) |
| `BE/engines/comfyui/bridge_contract.py` | 令牌单源;`image_gen/server.py` 启动时断言与 LOCAL_TOKEN 一致,漂移即拒绝启动 |
| `FE/lib/assist/image-studio/comfy-bridge-writeback-consumer.ts` | 渲染层消费收件箱(ComfyCanvasStudio 轮询驱动) |
| `FE/lib/assist/image-studio/storyboard-overview-sync.ts` | 总览图库保鲜(指纹守卫:分镜未动不导入) |

## 16. 工作流库(09-10 打通:sidecar 库=ComfyUI 原生目录)

**单一真源**:`<comfy_home>/ComfyUI/user/default/workflows`——webview 工作流菜单、sidecar API、迁移入库三者同目录。webview 左侧「工作流」即管理界面(浏览/打开/改名/删除/文件夹)。

- **目录解析**(`BE/engines/comfyui/manifest.py`):`configured_workflows_dir`——manifest `workflowsDir` 覆写优先,否则 `engine_source_dir()/user/default/workflows`;`legacy_workflows_dir()`=旧默认 `<comfy_home>/workflows`。
- **旧库并入**(`plugin_manager.merge_legacy_workflows_dir`):`_iter_workflow_files`(库读取咽喉)与 `import_workflows` 前调用;幂等、同名不覆盖(旧库胜)、旧文件永不动、非破坏 copy2。
- **HTTP 面**(`BE/image_gen/server.py`,Bearer `manying-local-image`):
  `GET /comfy/workflows`(树:rglob 递归+nodeCount+缺失插件标记,引擎未跑 missingNodes=null)/ `POST /comfy/workflows/import`(≤50 文件,同名 skip 除非 overwrite,JSON 校验拒坏)/ `GET …/content` / `POST …/rename|move|delete`(delete 须 confirm,先回引用扫描,备份进 snapshots/workflow-backups)。
- **路径安全**:`_safe_workflow_id` 拒绝对路径/`..` 穿越;**resolve 纪律**:该函数返回已 resolve 路径,import/rename/move 的 `relative_to` 根必须 `workflows_dir().resolve()` 同源——符号链接前缀(macOS `/var`→`/private/var`)下不同源=嵌套导入 400 且文件已落盘(§30 裁定 29)。
- **存储设置**:设置→本地配置→ComfyUI 引擎→存储 tab 可改 workflowsDir(engine_manager.set_paths/migrate_paths_job 搬移);paths_status.defaults 用 `configured_workflows_dir(default_manifest())` 保持真默认口径。

## 17. 存量迁移(09-10 打通:画布头部一键入口)

- **入口**:ComfyCanvasSwap 头部「导入存量画布(N)」——N=studio store imageWorkflows 数(N>0 才显示);单飞防连点;三挂载面全生效。
- **链路**:`migrateWorkflowsToLibraryWithToast`(`FE/lib/assist/image-studio/workflow-migrate-batch.ts`)→ flows=useStudioStore.imageWorkflows → `exportImageWorkflowToComfy` 双格式(UI 格式+API 格式随身 `ui.extra.apiFormat`+`manyingMigration` 报告,库内取用即得)→ 参考图占位上传(best-effort,引擎须在跑;`comfyImageUrlToB64` 读取)→ `transport.importFiles(files, "skip")`。
- **幂等口径**:无值守入口默认 **skip**(重复点击只补新增流,绝不灌「名 2」副本);keep-both 仅留给显式导入场景。
- **toast**:成功「N 入库 / M 失败;参考图 K 张…——在 ComfyUI 画布左侧『工作流』里可打开」;总 0 流=info 提示。长任务禁模态(后台跑+toast 铁律)。
- **实弹验收器**:`workflow-migrate-batch.live.test.ts`(env 门控 `MANYING_MIGRATE_LIVE=1`+sidecar17595+引擎在跑):读真实流文件→全量导出→object_info 校验缺类→抽检≥10 真提交引擎执行→收件箱回写命中。

## 18. 存量数据层与分镜生成链(旧链健在部分)

- **studio store imageWorkflows 冻结**:旧画布已删但数据不丢(深链照常读写);节点/边 CRUD 单源仍在 `FE/lib/studio/image-workflow/graph-build-mutations.ts`(store 操作与 comfy 注册表桥共用)。
- **分镜面板批量生图链(生产主力,勿动)**:`use-storyboard-batch-generation.ts` → `run-image-workflow-node-generation.ts`(uncloth 分流预检/NSFW 白名单/连续性门禁/资产圣经拼接/@图N 令牌)→ `request.ts` 组装 → aiManager → 自动去噪(>512² Worker)→ VLM 人物闸门(fail-open;先落盘后闸门)→ 回写(先连续性三件套→patch→updateStoryboard)。构图自愈 healStoryboardPromptForCast 唯一触发点=批量复用存量流重生前。
- **assist 侧现行生成**:`run-node-generation`/`run-uncloth`(直连 sidecar /v1/images/uncloth)/`comfy-execute`(工作流无头执行,job 化);台账 `history-records.ts`(宁留勿坏/删除双口径;写入侧=上三者)。
- **取材/超分/回写链**不变:use-image-workflow-upscale(up4x- 幂等单源 lib/upscale/client.ts)、setGeneratedImageResult=衍生过期咽喉。

## 19. 引擎管理(设置页)

- `FE/components/panels/settings/comfy-engine/`:useComfyEngineSettings(状态机:install/start job 轮询)、引擎卡默认收起(点开才挂载才查更新)、「模型」tab(本地大模型展示)、插件台账(已装 30/策展+Registry 合并搜索)、「存储」tab(四目录+迁移)。
- `BE/engines/comfyui/engine_manager.py`:实例锁(engine.lock,双 sidecar 风暴根修)、build_launch_args(gpu-only/--reserve-vram 可组合/--use-pytorch-cross-attention;**无 --user-directory**=原生用户目录生效的前提)、更新链(强制拉源码覆盖+失败重试+requirements 指纹跳过 pip)、collect_import_failures(插件兼容点名)。
- `plugin_manager.py`:策展清单 curated_plugins.json、差分 node sets、卸载/备份。
- **端口口径(09-12 根修 00b671e)**:引擎默认启动串不再钉 `--port`;端口真源归账本/引擎状态(`status.port`=全 app 寻址真源),17598 仅作桥回落位。启动链:start_lock 全程串行+快路径等健康防假就绪;报「本地生图服务未运行」类死窗有 sidecar 自愈补试。

## 20. 待清遗留(studio 侧孤儿,未清)

`FE/components/panels/studio/image-workflow/` 目录内存留一批画布退役后疑似孤儿(canvas-commands.ts 总线仅剩 use-image-workflow-commands 挂钩、后者仅剩注释引用)——09-10 清理只覆盖了 assist 目录(28 文件);**studio 侧需另做一轮全量可达性分析后再动**,勿直接照名单删(分镜生成链文件与真孤儿混居同目录)。

---

# 第三部分:常见任务地图(改 X 去哪)

| 任务 | 改哪里 |
|---|---|
| 改工作流库行为(导入/列表/删除) | `BE/engines/comfyui/plugin_manager.py` + `manifest.py`(目录解析/旧库并入);HTTP 面在 `image_gen/server.py` /comfy/workflows* |
| 改库目录/存储 | manifest `workflowsDir` 覆写或改 `configured_workflows_dir` 默认;迁移 job 走 engine_manager.set_paths/migrate_paths_job |
| 改存量迁移 | `FE/lib/assist/image-studio/workflow-migrate-batch.ts`(批)+ `workflow-export-comfy.ts`(导出器);入口按钮在 ComfyCanvasSwap |
| 改画布槽位/头部 | `comfy-canvas/ComfyCanvasSwap.tsx`;引擎占位/webview/轮询在 `ComfyCanvasStudio.tsx` |
| 改自有节点 | `BE/engines/comfyui/manying_nodes/`(节点+web 扩展+tests);object_info 验证,勿依赖直 import |
| 改桥/回写 | 后端 bridge_*.py;渲染层 comfy-bridge-writeback-consumer / storyboard-overview-sync |
| 改分镜批量生图 | use-storyboard-batch-generation → run-image-workflow-node-generation → request.ts(§18 链,全链健在) |
| 改无头执行工作流 | `FE/lib/assist/image-studio/comfy-execute.ts`(job 化)+ BE execute.py |
| 调引擎启动/更新/插件 | engine_manager.py(launch args/更新链/实例锁)+ plugin_manager.py |
| 改 uncloth 默认参数 | `FE/lib/assist/image-studio/uncloth-defaults.ts` |
| 调生成失败 | 分镜链看 diagnostics logEvent;assist 链 run-node-generation;uncloth 直连 sidecar;参考图过大先查 image-transfer 缩略 |

---

# 第四部分:已生效裁定(不可协商约束)

**连线与执行(存量链,仍约束 §18):**
1. 一个成图只接一根正向提示词边;nsfw 链与直连提示词互斥;负向出口=拼装通道可与正向共存(09-07)。
2. t2i/i2i 无歧义:空参考阻断不静默降级(09-03)。
3. NSFW 破限仅 krea2-turbo/comfyui-bridge 白名单。
4. uncloth instruct 为现行;稳定流提示词不吃「重绘:/锚定:」词头。
5. 参考图编号=画布位置序=AI 数组序单源;本地 Krea2 只吃第 1 张。

**数据与生成:**
6. 参考图手动调 API 也必须先缩略 768px<1MB(发大图=供应商 500/524)。
7. 参数权威=paramsEdited;新建/绑定分镜流恒带 targetSourceFingerprint(否则水合清理丢弃)。
8. 无活动项目禁落盘,绝不回退应用级旧路径;瞬态 data:/blob: 禁入 store。
9. 台账宁留勿坏;删除双口径比对(09-04)。
10. persistMedia:false(分镜成图自存项目真源)。

**换代与库(09-09/10 新增):**
11. **画布终态=ComfyUI**,React Flow 双画布已退役删除;存量数据冻结在 store 深链读写(批6/8)。
12. **工作流库=ComfyUI 原生用户目录** `<引擎>/user/default/workflows`(manifest 覆写除外);旧默认 `<home>/workflows` 非破坏并入(同名旧库胜,旧文件不动)。
13. **存量迁移入口=画布头部按钮**;冲突模式无值守默认 **skip 幂等**;keep-both 只留给显式导入。
14. comfy-workflow-browser 整套退役:库管理=webview 原生界面,不自建重复 UI。
15. **路径三口同源 resolve**(import/rename/move 的 relative_to 根必须 resolve;符号链接前缀下不同源=400 半完成态)。
16. 图片/视频/音乐本地大模型全归 ComfyUI(音乐 tab 已撤 f60c50c;大模型展示入引擎卡模型页 82f2cfc)。

**架构:**
17. lib 不反向依赖 components;代码文件按功能模块落位。
18. 冷门端口铁律:自家 17xxx 顺延,禁 8000/8188/3000;改外部软件先找权威配置位。
19. 长任务禁模态(确认即关+后台+toast);轮询面静默不弹窗轰炸。
20. 打包链禁测生图(90s+/张);装机验收生弹留给用户。

> 旧 React Flow 时代裁定(左键不拖画布/删除只走右键/fitView 时机等)随画布退役转史案,记录在 git 历史;对存量数据操作仍部分适用(CRUD 语义)。

---

# 第五部分:已知坑与存疑(史案+待查)

**已根修的史案(复发警惕):**
- 符号链接前缀 400 半完成态:pytest tmp_path 天然 resolve,单测永远抓不到;实弹必须真起服务(mktemp 的 /var→/private/var 即天然复现器)。
- 「测试全绿但 UI 不可达」:comfy-workflow-browser 7 测全绿但组件零挂载——孤儿判定必须做**入口可达性分析**,零引用扫描+互引岛都要查,绿灯不是活着的证据。
- 受控 edges 不注入 selected→键盘删边失效(a4fa34a);重建 effect 抹 selected(e4ea0c4);点边不清节点选中(b67c5df)。
- 1024² 主线程双边滤波冻结 UI(去噪进 Worker,09-03);批次快照旧 keyframes 直接映射丢写入(以 store 现势为基)。
- 引擎实例锁前的双 sidecar 风暴(09-09 负载事故);孤儿进程占 17595→无限重启风暴。
- 并行会话共享 index/pre-commit:他人飞行中半态(删源未删测试)会瞬时挡你提交——重试即可,勿顺手"修"别人的文件。
- client 引用不 memo 固化→探测 effect 循环重跑;webview 布尔属性传字符串。

**存疑/待办:**
- ⚠️ §20 studio 侧孤儿待全量可达性分析后清理(canvas-commands/use-image-workflow-commands 疑死,与活链混居)。
- 09-09 对齐轮装机验收 6/8:NodeResizer 段未跑完,复跑器=`apps/build/scripts/canvas-comfy-align-acceptance.mjs`(已入册 42c8010)。
- SeedVR2 超分档 `{restore:true}` 前端链路疑似无消费点(未实弹复核)。

---

## 参考来源(第一部分,2026-09 核验)

- 范式/图论:en.wikipedia.org — Dataflow_programming / Directed_acyclic_graph / Topological_sorting / Layered_graph_drawing / Coffman–Graham_algorithm
- Houdini cook:sidefx.com/docs/houdini/tops/cooking.html;Blender socket:docs.blender.org …/nodes/parts.html
- ComfyUI:docs.comfy.org/custom-nodes/backend/server_overview;github.com/comfyanonymous/ComfyUI — execution.py / comfy_execution/caching.py;前端 changeTracker.ts 与 docs/adr/CRDT-*(Comfy-Org/ComfyUI_frontend)
- React Flow(史案):reactflow.dev — api-reference / performance / migrate-to-v12;源码 xyflow/xyflow
- 布局库:github.com/dagrejs/dagre/wiki;github.com/kieler/elkjs(EPL-2.0)
- 增量计算:Adapton(PLDI 2014);salsa-rs.github.io;rustc-dev-guide;github.com/snowleopard/build
- 持久化:RFC 8785(JCS);jsondiffpatch;yjs/loro
- 错误语义:reactivex.io/documentation/contract.html;docs.n8n.io handle-errors
