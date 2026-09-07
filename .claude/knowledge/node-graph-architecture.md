# 节点图知识文档(通用原理 + 本项目架构)

> **本文件为节点图领域权威知识文档**(2026-09-07 建立):第一部分是节点图的行业通用知识(dataflow/DAG/求值模型/ComfyUI/React Flow),第二部分是本项目两块画布的完整架构(以代码为准、带行号锚点),第三部分是"改 X 去哪"任务地图,第四部分是已生效的用户裁定(不可协商约束)。
>
> **任何涉及 image-workflow / image-studio 画布、节点、连线、生成的任务,动手前先读本文件**;行号以 2026-09-07 工作区为准,过期时以代码实况为准(锚点符号名比行号更稳)。
>
> 路径约定:下文 `FE/` = `apps/frontend/`,`BE/` = `apps/backend/`。

---

# 第一部分:节点图通用知识(行业共识)

> 本部分回答"节点图是什么、算法是什么、为什么这么设计"。所有来源均经 2026-09 实际抓取核验,文末附 URL。

## 1. 节点图范式 = dataflow programming 的图形化

**一句话内核**:程序被建模为"数据在操作之间流动的有向图"——节点是黑盒操作,边显式声明数据依赖;执行顺序不再由语句顺序决定,而由图拓扑决定。

- 点火规则(firing rule):"An operation runs as soon as all of its inputs become valid"——节点只依赖输入可用性,天然无隐藏状态、天然可并行。
- 与命令式的关系:节点图 ≈ 命令式调用的"依赖图显式化"——每个节点对应一次函数调用,每条边对应一次实参传递。**理解任何节点图的捷径:把它看成"自动排好了调用顺序的函数调用网"。**
- 优点:依赖显式可审计、易并行、子图可复用可替换。缺点:大图可读性差、版本管理难——业界用 group/subgraph/minimap/折叠缓解。
- 同一思想的非图形化身:spreadsheet 单元重算、makefile 依赖、TensorFlow/Flink/Spark 计算图。

## 2. 图论基础:DAG / 拓扑排序 / 环检测

**一句话内核**:可执行节点图几乎总是 DAG(有向无环图);拓扑排序给出合法求值顺序,排序失败即有环——这是"禁止回连"约束的数学根据。

- **拓扑序**:线性序使每条边 (u,v) 满足 u 在 v 前。非唯一(并列分支可互换)→ 对应"并行分支执行顺序不唯一"。
- **Kahn 算法** O(V+E):入度 0 的顶点入队 → 出队删出边 → 新入度 0 者入队;结束时仍有剩余 = 有环。
- **DFS 算法** O(V+E):临时标记进入/永久标记完成,输出 reverse post-order;遇临时标记点 = back edge = 环。
- 工程共识:环检测应在**连线瞬间**(图编辑时)完成,而不是执行时才炸;反馈/循环语义要用显式特殊节点建模(UE 的 Timeline、ComfyUI 的子图展开)。

## 3. 求值模型:pull vs push、脏传播、输出缓存

**一句话内核**:pull(lazy)从输出端按需回拉上游(Houdini cook、ComfyUI),push(eager)从变更点向前点火(流处理、响应式);实际系统几乎都是混合——"脏标记(push 式打标)+ 按需拉取(pull 式求值)"。

- **脏传播**(dirty propagation):参数变更 → 该节点脏;上游结果变 → 所有下游脏;求值时"只重做变了的部分"。
- **输出缓存/记忆化**(ComfyUI 范本):缓存 key = 节点输入签名(含全部上游 ancestry + IS_CHANGED 返回值 + 字面量输入);相同输入签名的子图即使位置不同也命中缓存。`NaN` 表示永远重算(NaN≠NaN)。
- 与本项目的对照:**本项目是"用户手触发 + 单点 pull"**——点成图节点的「生成」按钮才从该节点回拉上游(见 §12),没有自动脏传播;衍生过期(staleSince)是一种轻量脏标记。

## 4. 端口类型系统(Socket/Handle Types)

**一句话内核**:端口类型 = 视觉编码(颜色/形状)+ 连线时的类型检查与自动转换;Blender 的 color-coded socket 是最完整范本。

- Blender:Geometry=绿、Float=蓝、Int=柠檬绿、Boolean=紫红……;未连接=空心、连接后=实心;multi-input socket 可接多根线。
- 类型检查的位置:ComfyUI 在**验证阶段**做 received_type vs input_type 字符串比对;React Flow **不内置类型系统**,连线合法性完全交给应用层的 `isValidConnection` 回调——**这正是本项目 isValidImageConnection 的设计出处**。
- 自动转换:Blender/UE 会在兼容类型间自动转换(不可直连时 UE 自动插 autocast 节点);不兼容直接拒连。

## 5. ComfyUI 执行引擎(本仓后端的直接参照系)

**一句话内核**:节点=注册进 NODE_CLASS_MAPPINGS 的 Python 类(INPUT_TYPES/RETURN_TYPES/FUNCTION 协议);执行分"验证→执行"两阶段;靠输入签名+IS_CHANGED 的输出缓存跳过未变子图。

- 验证阶段:递归 validate_inputs——检查必填缺失、连线类型匹配、字面量范围;自定义 VALIDATE_INPUTS 在执行前跑。
- 执行阶段:从 OUTPUT_NODE(输出节点)拉取,按 ExecutionList 迭代调度(当前 master 已从早期 recursive_execute 递归改为迭代);先广播 execution_cached 让前端置灰被缓存的节点。
- 本仓对照:`BE/image_gen/server.py` 的 `/v1/images/generations` + `pipeline.py` 引擎分发,是同一思想的极简化——无缓存(每次全量算)、无验证阶段(校验全在前端)、单请求单图。`engines/comfyui_bridge.py` 则直接把 4 个 ComfyUI 工作流模板当远程引擎调。

## 6. React Flow / xyflow 要点(本仓画布内核)

**一句话内核**:React Flow 是**受控组件库**——nodes/edges 全是你传入的 props,交互只产生 onNodesChange/onConnect 等事件由你落地状态;渲染/交互复杂度由库承担。

- 受控模型:`setNodes(nds => applyNodeChanges(changes, nds))` + `addEdge`;handler 必须 useCallback,否则可能无限重渲染。
- Custom node:`nodeTypes` 按 node.type 分派组件;Handle 分 source/target 两个方向,多 Handle 必须有唯一 `id`——**本项目 prompt 双出口(positive/negative)和 uncloth 三入口(image/prompt-1/prompt-2)正是用 Handle id 实现的**。
- `isValidConnection`(ReactFlow 级或 Handle 级):官方建议放 ReactFlow 级(性能)——本仓两画布都这么做。
- 分组:`parentId` + `extent:'parent'`(v11.11 前叫 parentNode);group = "无 handle 的容器节点";**nodes 数组中父节点必须排在子节点前**。
- 性能三板斧:custom node 用 React.memo、回调 useCallback、`onlyRenderVisibleElements` 虚拟化(注意它自身有开销,适合大图)。
- 版本现状(2026-09):最新大版本 v12 线(新包名 `@xyflow/react`),无 v13;11→12 迁移要点=包名/`node.measured`/parentId 改名/onEdgeUpdate→onReconnect 等。

## 7. 业界参照系速览

| 系统 | 代表思想 | 一句话 |
|---|---|---|
| Blender Nodes | 类型即视觉语言 | color-coded socket + multi-input + 自动插转换节点 |
| Houdini SOP | 脏传播+可锁缓存的过程化 DAG | cook 按需求值,只重做变了的;可 lock 节点固化结果 |
| Unreal Blueprint | 控制流与数据流两类边共存 | 白色 exec wire(执行序)+ 彩色 data wire(数据);pure 节点=按需拉取 |
| n8n | 入口节点(trigger)驱动的线性工作流 | webhook/schedule 触发,节点顺序执行 |
| LiteGraph.js | 引擎与编辑器分离 | Canvas2D 蓝图库,图可在无编辑器环境执行(ComfyUI 早期前端) |

## 8. UI/UX 与性能共识

- 交互已高度趋同:端口拖拽连线、右键菜单(节点发现主入口)、框选、minimap、undo/redo。
- **undo/redo 标准答案 = command pattern**(execute()/undo() 命令对象栈);React Flow 不内建 undo,状态在应用侧正好便于实现——**注意:本仓实际用的是"快照栈"而非 command pattern**(nodes+edges 整图快照,见 §15),对本仓图规模这是合理简化。
- Handle 对齐减少连线交叉(Blender 手册明文建议)——本仓两列/三列泳道布局就是这个共识的落地。
- 性能:渲染侧虚拟化/裁剪,求值侧只算脏子图,数据侧惰性求值;React 侧 memo/useCallback/避免子组件订阅整个 nodes 数组。

---

# 第二部分:本项目节点图架构(以代码为准)

## 9. 全景:两块画布,一套图模型

| 维度 | 分镜画布(studio) | 图片工作室画布(assist) |
|---|---|---|
| 容器组件 | `FE/components/panels/studio/image-workflow/ImageWorkflowCanvas.tsx:87` + `ImageWorkflowFlowView.tsx:28` | `FE/components/panels/assist/image-studio/ImageStudioCanvas.tsx:79`(内嵌 FlowView :963) |
| 数据源 | `useStudioStore().imageWorkflows` | `useImageStudioStore`(独立 zustand) |
| 图模型 | **共用同一 `ImageWorkflowGraph` 类型**;assist store 注释明说"节点/边 CRUD 全部经 lib/studio/image-workflow/graph-build(单一实现源)"(`FE/stores/assist/image-studio-store.ts:46-47`) | 同左 |
| 定位 | 生产域:分镜指纹/资产圣经连续性/风格锁/VLM 闸门/回写分镜与资产/批量超分/取材四工具/多帧 keyframes | 自由域:多画布、右键创建、复制粘贴、批量 1-4 张、生成历史、JSON 导入导出、拖图入布 |
| 持久化 | studio-workflow 分片 store(§16) | 项目侧一画布一文件(§16) |

两画布共享:图变更族(graph-build-mutations)、边校验(isValidImageConnection)、手势内核(useCanvasGestureKernel)、undo/redo hook、UnclothNodeEditor/NsfwNodeEditor、CanvasViewportControls。

⚠️ 命名澄清(易混):`workflow-node-model.ts` / `workflow-node-registry.ts` 是**生产流画布**(剧本→分镜→成片)的东西,与图像画布**无关**(已核实无 import 关系)。

## 10. 数据模型(FE/types/studio-production-types.ts)

- 节点类型枚举 `ImageWorkflowNodeType`(:293):`"reference" | "prompt" | "generated" | "uncloth" | "sticky" | "group" | "nsfw"`;状态机 `idle|queued|generating|ready|failed`(:294)。
- 七种节点 data 是判别联合 `ImageWorkflowNode`(:489-496),公共基座 `{id, type, title, position, createdAt, updatedAt}`(:301)。
- 边 `ImageWorkflowEdge {id, source, target, label?, targetHandle?, sourceHandle?}`(:513)——**handle 值就是边上的字段**,不是 React Flow 私有物。
- 图 `ImageWorkflowGraph {id, name, target, targetSourceFingerprint?, assemblyTrace?, nodes, edges, viewport?, …}`(:530);`target.kind = free|material|storyboard|asset`(:248)决定流的归属域。

**Handle 口约定**(渲染层两画布一致):
- prompt 节点双**出口**:`positive`(上)/`negative`(下)(`image-workflow-node-card.tsx:168-185`);
- uncloth 节点三**入口**:`image`(图)/`prompt-1`①=编辑指令/`prompt-2`②=一致性描述 system_prompt(:134-160);
- generated/nsfw 单一无名左入口;其余节点单一无名右出口。
- **存量边回落**:无 targetHandle 的旧边,uncloth 目标按源类型回落 prompt→prompt-1、其他→image;prompt 源无 sourceHandle 回落 positive(`ImageWorkflowCanvas.tsx:320-328`、`ImageStudioCanvas.tsx:630-636`)。

## 11. 节点类型清单

注册表:`FE/lib/studio/canvas-node-registry.ts:38`(IMAGE_WORKFLOW_DEFINITIONS,5 种可连线类型)+ assist 元数据 `image-studio-node-registry.ts:21`(7 种含 sticky/group)。卡片 UI:studio 全部在 `image-workflow-node-card.tsx`,assist 在 `image-studio-node-card.tsx`。

| kind | 职责 | 输入口 | 输出口 | 要点 |
|---|---|---|---|---|
| `reference` | 参考图 | 无 | 右×1 | derivedFrom 取材血缘;直改 imageUrl 触发衍生过期;卡片有取材四按钮 |
| `prompt` | 提示词 | 无 | `positive`+`negative` | 模型/画幅字段已按 08-30 裁定移出,归成图节点 |
| `generated` | 成图(执行节点) | 左×1(可反向拖出建上游) | 右×1 | paramsEdited=参数权威标记;无连线时有内嵌 prompt 面板;按钮=回写/超分/生成 |
| `uncloth` | 无衣物处理 | `image`+`prompt-1`+`prompt-2` | 右×1 | variant fast/fine 已封存,instruct 为现行;参数经 UnclothNodeEditor |
| `nsfw` | NSFW 破限 | 左×1(只吃提示词) | 右×1 | 零参数一期,只读展示专业流参数 |
| `sticky` | 便利贴 | 无 | 无 | 仅 assist 有创建入口 |
| `group` | 分组框 | 无 | 无 | 成员经拖放吸附 setGroupMembership |

辅助单源:`referenceCapacityForModel`(`image-studio-node-registry.ts:57`)——krea2-turbo/flux2-klein-9b/z-image-turbo=1 张,qwen-image-edit-2511/comfyui-bridge/gpt-image*=4 张。

## 12. 执行链(生成怎么走)——最核心

### 12.1 分镜链(studio)

成图卡「生成」→ `useImageWorkflowGeneration.generateNode` → `runImageWorkflowNodeGeneration`(`run-image-workflow-node-generation.ts:50`,UI 无关核心):

1. **uncloth 分流预检**:`buildUnclothChainRequest` 有 uncloth 上游且链完整→走 uncloth 管线;不完整→toast 指路拒发。
2. **请求组装** `buildImageWorkflowGenerationRequest`(`FE/lib/studio/image-workflow/request.ts:43`):
   - 提示词:nsfw 链时 `findPromptViaNsfw`;否则 `findPromptNodeForGenerated`(入边+targetNodeId 直挂);正负文本经 `splitPromptEdgesByPolarity` 按出口极性分流;
   - 参考图:遍历指向本节点的边,reference 按 `continuityOrder` 排序;上游 generated 的 resultUrl 作 `previous-approved-frame`;
   - 资产圣经连续性契约拼接、`@图N` 令牌解码、负向合并参考 avoid;参数权威 `paramsEdited ? node : promptNode`;
3. **守卫**:NSFW 模型白名单(krea2-turbo/comfyui-bridge 之外大白话阻断);连续性能力门禁(多参考仅 comfyui-bridge/gpt-image 系放行,order 必须 1..k 连续);
4. 受管地址(project-file://等)经 IPC 转 base64 → 分镜流加视觉手册风格锁 → `aiManager.generateImage` → 自动去噪 → 项目内落盘 → VLM 人物一致性闸门(fail-open)→ `setGeneratedImageResult` 回写(触发下游衍生 staleSince)。

### 12.2 图片工作室链(assist)

`useImageStudioGeneration.generateNode`:uncloth 分流 → NSFW 守卫 → **t2i/i2i 无歧义预检**(空参考阻断不静默降级)→ 批量 count 1-4 顺序生成 → `runImageStudioNodeGeneration`(落盘 `media/ai-image/YYYY-MM/` + ledger 台账 + eventBus 广播)。

与分镜链的关键差异:assist **不注入**资产圣经/风格锁,提示词原样透传;**参考图顺序=编号单源** `orderedReferenceSources`(画布 y 主 x 辅排序,`reference-order.ts:16`)——节点上显示"参考图 N"与发往引擎的数组下标同源;本地 Krea2 只吃第 1 张(=画布最上面那张)。

### 12.3 引擎分流(两链共用)

- `FE/lib/ai/image-generation-engine.ts` 的 `generateImage`:模型归属路由 `findModelOwnerConfig` + 本地模型无绑定走内置本地 provider + 本地 sidecar 自愈(health 探测拉起)+ 云端兜底链(freedom_image→character/scene_generation≤2 家 + mikoto 异步)。
- **NSFW 破限链不换管线**:普通请求 `extraParams.use_lora=true`,sidecar 侧 `server.py:232` 消费,由 `engines/krea2.py:30-53` 的 PRO_LORA_STACK 常量接管(Mystic XXX v3@1.0 + pussy@0.3 + 第 9 带 rebalance×5 + cfg=0 纯正向)。
- **uncloth 无衣物流不走 aiManager**:直连 sidecar `POST 127.0.0.1:17595/v1/images/uncloth`(`run-uncloth.ts:18`);后端 `uncloth_pipeline.py`:instruct=本地 Krea2Edit(grounded encode+参考注意力+denoise=1.0),fast/fine=双分割蒙版并集+两遍 masked SDEdit(实现保留已封存)。
- **参考图 768px/1MB 缩略在引擎层统一做**(`FE/lib/ai/image-transfer.ts:96` 阶梯缩边×JPEG 质量双循环)——run 层先转 base64,引擎发送前再缩略;手动调 API 也必须先缩略(用户铁律)。

## 13. 边域规则(连线校验)——单源三路复用

全部在 `FE/lib/studio/image-workflow/graph-build-mutations.ts`,两级结构:

1. **节点级 `isValidImageEdge(graph, source, target)`**(:203)——不看 handle,只看节点对:
   - 通用:自环拒/端点不存在拒/同向重复边拒/sticky+group 作源拒;
   - **uncloth 作目标**:reference/uncloth/generated 源放行(prompt 源限 2 根=编号口前的存量上限);
   - **nsfw 作目标**:只吃 prompt 源且仅 1 根;
   - **generated 作目标**:uncloth 源=单链;nsfw 源=单链且**与直连提示词互斥**;prompt 源=**一个成图只吃一根正向**(负向口例外在连线级);reference/generated 源放行(成图链式=上一代喂下一代);
   - 其他目标一律拒。
2. **连线级 `isValidImageConnection(graph, connection)`**(:299,"React Flow isValidConnection 的唯一后端")——在节点级之上补 handle 口别:prompt 源只认 positive/negative;nsfw 目标拒 negative;同目标口同极性各≤1 席(正负两席可共存=拼装);uncloth image 口只吃 reference/generated/uncloth 一根、prompt-1/2 各口正负分席各一根;无 handle 回落节点级(存量边占正席)。
3. **三个调用点**:①两画布 ReactFlow `isValidConnection`;②`connectImageWorkflowNodes` 建边(有 handle 走连线级、无 handle 走节点级);③边 id 生成带 handle 后缀(同对节点正/负多边合法)。

配套:`splitPromptEdgesByPolarity`(:355)按出口极性拆正负文本;uncloth 存量无 handle 边按画布纵向序回落 ①②。守卫副本(connect-create.ts 的 hasUncloth/NsfwUpstreamEdge、导入校验)与单源同语义,改动须同步。

## 14. 布局算法(两个单源,互不依赖)

- **分镜画布** `FE/lib/studio/image-workflow/layout.ts:24`:两列——左列 x=80(reference/prompt/uncloth/nsfw 共用一条堆叠带),右列 x=760(成图,按 createdAt);`tidyImageWorkflowLayout`(:145)一键整理:prompt 按目标成图帧序排、reference 按 continuityOrder 排其后、uncloth/nsfw 垫底,只改 position 幂等。
- **图片工作室** `FE/lib/assist/image-studio/layout.ts:18`:三列泳道 reference x=80 / prompt x=480 / generated x=1010;**成图链代右移**——沿"成图→成图"连线求最长路径深度 `generatedChainDepth`(:36),每代右移 620px;`layoutImageStudioGraph`(:83)整体整理。
- 手动加节点:studio 用 `nextStackedPosition`(同列最低卡底边之下,永不重叠),assist 用 `nextColumnPosition`(列内 maxY+行距)。

## 15. 图操作层(ops 指令 / 右键 / 删除 / undo)

- **指令总线** `FE/lib/studio/canvas-commands.ts:20,113`:`CanvasCommand` 8 种 kind(add-node/update-node/remove-node/connect/disconnect/select/set-viewport/trigger-node-action + assist 专属 restore-generation),`dispatchCanvasCommand(surface, cmd)` 入队;**没有叫 applyOps 的函数**。两个面执行器:studio `use-image-workflow-commands.ts`、assist `use-image-studio-commands.ts`。自动化测试与画布助手(AI 对话驱动)共用这条总线。
- **右键体系**(assist 独有):空白右键=创建菜单 8 种+整理/适配;节点右键=复制/清空内容/删除。studio 右键=平移,无菜单。
- **删除语义**:assist "删除只走右键菜单,节点卡不设删除按钮"(用户终裁注释 `image-studio-node-card.tsx:290`),键盘 Delete 经 onNodesDelete 也落地;studio 走卡片右上 Trash 按钮。⚠️ studio FlowView 只绑定了 onEdgesDelete 未绑 onNodesDelete——键盘删节点不落 store 是**代码事实**(未见注释声明为有意设计,改动前先问)。
- **undo/redo = 快照栈**(非 command pattern):studio `useCanvasHistory`(nodes+edges 快照,防抖 200ms,容量 50,切流 reset);assist `useAssistCanvasHistory`(订阅引用变化自动 commit,防抖 300ms)。

## 16. 状态与持久化

- 分镜画布:`useStudioStore` 的 imageWorkflows slice;zustand persist `studio-workflow-store` → 分片引擎 `createStudioWorkflowShardedStorage` → 磁盘 `_p/{projectId}/studio-workflow/` manifest+章优先分片,单片≤512KB;水合守卫:data:/blob: 瞬态媒体禁入、无指纹旧流丢弃、空流清理。
- 图片工作室:`useImageStudioStore`(workflows+activeWorkflowId+nodeExtras);项目侧 `<项目根>/store/image-studio/manifest.json + <canvasId>.json` 一画布一文件;水合复位 generating→idle。
- 媒体产物:assist 落 `<项目>/media/ai-image/YYYY-MM/`+ledger;studio 落项目 workflow-images 目录。

## 17. 后端接口(BE/image_gen/,本地生图 sidecar)

- `server.py`:OpenAI images 兼容,127.0.0.1 固定令牌;`POST /v1/images/generations`(t2i/i2i 主通道,参考图 data-URI 列表 4 张软上限,use_lora 透传)、`POST /v1/images/uncloth`、`POST /v1/images/cancel`、`/models/status|download|progress-json`。
- `pipeline.py:68`:引擎分发器——layout 映射 krea2-pointed→engines/krea2.py、flux2-pointed→flux2.py、z-image-pointed→z_image.py、qwen-pointed→qwen.py、comfyui-bridge→comfyui_bridge.py(每模型一脚本,krea2 头注释裁定)。
- `engines/krea2.py`:Krea2 Turbo 主力(SDEdit 单参考图生图)+ 内嵌 NSFW 专业流常量;`engines/comfyui_bridge.py`:4 个 ComfyUI 工作流模板(krea2_t2i/edit_ref/nsfw_pro/uncloth_instruct)按参考数/开关路由。
- `uncloth_pipeline.py`:instruct=本地 Krea2Edit;`model_inventory.py` 聚合各引擎状态供 /models/status。

## 18. 关键单源清单(锚点表)

| 单源 | 位置 |
|---|---|
| 节点/边 CRUD + 边域规则 | `FE/lib/studio/image-workflow/graph-build-mutations.ts:161-402` |
| 分镜画布布局 | `FE/lib/studio/image-workflow/layout.ts:24` |
| assist 画布布局 | `FE/lib/assist/image-studio/layout.ts:18` |
| 参考图编号=数组序 | `FE/lib/assist/image-studio/reference-order.ts:16` |
| 参考图 768px/1MB 缩略 | `FE/lib/ai/image-transfer.ts:96` |
| 无衣物参数默认 | `FE/lib/assist/image-studio/uncloth-defaults.ts` |
| NSFW 专业流参数 | `BE/image_gen/engines/krea2.py:30`(前端展示同步 `FE/components/ui/nsfw-node-editor.tsx`) |
| 节点注册契约 | `FE/lib/studio/canvas-node-registry.ts:38` + assist `image-studio-node-registry.ts:21` |
| ops 指令总线 | `FE/lib/studio/canvas-commands.ts:20,113` |
| 引擎路由/兜底链 | `FE/lib/ai/image-generation-engine.ts` |

---

# 第三部分:常见任务地图(改 X 去哪)

| 任务 | 改哪里(按顺序) |
|---|---|
| 改连线规则 | ① `graph-build-mutations.ts` 两级校验函数;② 检查三个调用点是否吃新规则;③ 同步守卫副本(connect-create.ts/导入校验);④ 补 `graph-build-mutations.test.ts` |
| 加新节点类型 | ① `types/studio-production-types.ts` 加 data 类型进判别联合;② `canvas-node-registry.ts`(assist 再加 `image-studio-node-registry.ts`);③ 两画布卡片 UI 分支+Handle;④ 布局槽位(两处 layout.ts);⑤ connect-create 可创建清单;⑥ 导入校验白名单;⑦ 若有新管线:执行链分流 |
| 改请求组装/提示词注入 | studio 链 `lib/studio/image-workflow/request.ts`;assist 链 `lib/assist/image-studio/request.ts`——两链独立改 |
| 改参考图顺序逻辑 | `lib/assist/image-studio/reference-order.ts`(编号=数组序单源,勿在别处重排) |
| 改 uncloth 参数默认值 | `lib/assist/image-studio/uncloth-defaults.ts`(resolveUnclothParams) |
| 调"连线连不上/删不掉" | 先分清层级:React Flow 事件层(FlowView 的 onConnect/isValidConnection)→ 两级校验函数 → store action;受控 edges 的 selected 注入曾在 a4fa34a 修过键盘删边 |
| 改自动布局/整理 | 对应画布的 layout.ts;两画布互不依赖,别只改一处 |
| 调生成失败 | 看走哪条链:uncloth(直连 sidecar)/NSFW(use_lora 透传)/普通(aiManager 路由);参考图过大先查 image-transfer 缩略 |
| 写画布自动化测试 | 走 `dispatchCanvasCommand` 总线(mystudio-automation-testing skill),勿直接戳 store |

---

# 第四部分:已生效裁定(不可协商约束)

1. **一个成图只接一根正向提示词边**;nsfw 链与直连提示词互斥;uncloth 编号口 prompt-1/2 各一根。
2. **删除只走右键菜单**(assist 终裁,节点卡不设删除按钮);studio 走卡内 Trash。
3. **参考图手动调 API 也必须先缩略 768px<1MB**(发大图=供应商 500/524 直接原因)。
4. **参考图编号=画布位置序=AI 数组序单源**;本地 Krea2 只吃第 1 张(画布最上)。
5. **t2i/i2i 无歧义**:空参考阻断,不静默降级。
6. **NSFW 破限仅 krea2-turbo/comfyui-bridge 白名单**,其他引擎大白话阻断。
7. **uncloth fast/fine 已封存,instruct 为现行**;稳定流提示词不吃「重绘:/锚定:」词头(那是遮罩流协议)。
8. **展示≠数据**;卡片上正/反向提示词完整展示不遮盖;节点卡不加跨节点指引旁注。
9. 提示词节点的模型/画幅字段已移除(08-30 裁定),参数权威在成图节点(paramsEdited)。
10. 本仓画布内核=React Flow,曾对比 infinite-canvas(AGPL)裁定**不换内核**;借鉴插件注册表/指令集思路可以,抄 AGPL 代码零容忍。

---

## 参考来源(第一部分,2026-09 核验)

- Dataflow programming / DAG / 拓扑排序:https://en.wikipedia.org/wiki/Dataflow_programming 、/Directed_acyclic_graph 、/Topological_sorting
- Houdini cook/脏传播:https://www.sidefx.com/docs/houdini/tops/cooking.html
- Blender socket 类型系统:https://docs.blender.org/manual/en/latest/interface/controls/nodes/parts.html
- ComfyUI 执行引擎/缓存:https://docs.comfy.org/custom-nodes/backend/server_overview 、https://github.com/comfyanonymous/ComfyUI/blob/master/execution.py 、/comfy_execution/caching.py
- React Flow:https://reactflow.dev/api-reference/react-flow 、/components/handle 、/learn/advanced-use/performance 、/learn/troubleshooting/migrate-to-v12
- Unreal Blueprint 节点/pin:https://dev.epicgames.com/documentation/en-us/unreal-engine/nodes-in-unreal-engine
- n8n trigger:https://docs.n8n.io/key-concept-glossary.md
- LiteGraph.js:https://github.com/jagenjo/litegraph.js
- Command pattern(undo/redo 共识):https://en.wikipedia.org/wiki/Command_pattern
