---
name: node-graph
description: 节点图(node graph)与画布布局(canvas layout)技能——凡涉 ComfyUI 工作流构建或修改、画布布局、工作流布局、节点图搭建、连线交叉治理、线遮节点、横向排版、组框、负区、输出口位、workflow JSON 两种格式、连线与类型机制、多模式/加速档拓扑怎么搭(并行支路/节点复用/懒选择)的任务先读此技能。含拓扑结构策略章(0929:并行支路+单一选择点/单源扇出+零真重复/懒执行选择/注入式反模式;0930 补:完整功能域收装子图)、历次布局裁定系谱(09-19 横向铁律→0926 线不遮节点→0928 交叉立宪→0930 输出槽排布/节点命名/节奏常数)与布局策略全谱(①-⑦+⑧ 输出槽排布·节点命名·对称规整节奏常数);本技能管图结构与布局,引擎驱动与生成归 comfyui 技能;1006 增「节点与工作流认知」章(节点解剖/object_info 真源/子图六同步与蓝图单向/宿主槽渲染/自研节点设计纪律——含**控件vs展示框退役分界:删下拉框≠删展示框,退役令只及控件**/工作流四副本与热覆盖/mermaid 展示/交付三道门)与「工作流 JSON 配置与逻辑」章(GUI/API 双格式逐字段解剖+graphToPrompt 执行链;1006 末轮术语对照补父图/宿主/连接状态/连接参数四条问法映射+嵌套单层口径全库扫描定谳)。Use for any node graph / canvas layout / workflow building or editing / crossing-and-group governance / topology-patterning / node details / subgraph host panel / workflow-cache-path / workflow JSON fields and execution chain task.
metadata:
  type: reference
---

# 节点图与画布布局(node graph / canvas layout)

本技能是**整合者**:地图(指路三真源)+纪律(优先级序)+速查层(脱离外部文件可用的最小操作集)。三真源(`.claude/knowledge/node-graph-architecture.md`、`docs/comfyui-kb/画布布局规范-0928.md`、`.agents/skills/comfyui/`)仍是唯一权威;**任何冲突——包括布局策略章与 0928 立宪文档的冲突——一律真源胜,然后回改本技能**。「布局策略章完整自含」(0928 用户二令)的边界:指该章不依赖外部文件即可读全布局纪律,不指权威高于真源;优先级序的第一出处仍是 0928 立宪文档。

## 头部声明(两条,先读)

1. **裁定同步钩子(R13)**:R13=本技能建档任务档的需求条款编号(全文见 `.trellis/tasks/archive/2026-09/09-28-node-graph-skill/prd.md`,已归档)。规矩:今后新布局裁定落账(立宪文档或生成器自查谓词变更)时,**同一战役批次内**同步本章布局策略——本技能不是写死的静态件。
2. **工具口径边界声明**:`workflow_layout.inspect()` 是**快速近似读数**(重叠盒+直线中心线交叉+边界),**非 0928 立宪口径**(无贝塞尔模型、无线遮节点检查、无间距阈值、无输出口检查);立宪判据现可用本地 `tools/layout_check.py` 跑(立宪口径的可跑实现,见 ⑥),生产权威宿主=「layout_check+workflow_layout_baseline.json+契约测试」三件(三生成器 1001 起退役勿重跑)。

## 何时用

- 改画布、排节点、治交叉、建/改工作流 JSON、读节点图架构之前;
- 「连线交叉」「线穿过节点」「组框罩不住」「负区/一打开就左滚」「输出口位置」类布局问题;
- 写或改 workflow JSON(两种格式、连线写法、类型匹配、转换件);
- 与 comfyui 技能分界:本技能管**图结构与布局**(排布/治理/格式/连线);跑图/模型/参数/VRAM 等引擎驱动与生成归 comfyui 技能。两域重叠的任务先本技能定结构,再 comfyui 技能执行。
- 定图结构:多模式/加速档/参数互斥切换怎么搭(并行支路 vs 注入式)、节点复用、懒选择——先读下方「拓扑结构策略」章再进布局策略;**结构先定、布局后排,错拓扑用布局治理只治标**(0928 布局轮坐标-only 重排未能治好注入式加速区的观感混乱,即为例证)。
- 节点详情/子图宿主面板(输入点不渲染/错名/widget 丢失)/「改了没生效」缓存疑云/自研节点设计与展示——先读下方「节点与工作流认知」章;宿主槽排查与缓存路径全图的专文见三真源地图。

## 拓扑结构策略(0929 新章:图结构层,布局层的上游)

> 本章裁定出自 2026-09-29 加速区并行化战役(Q2-1 三件),权威记录=`.trellis/tasks/09-29-qi21-acczone-parallel/` 的 prd.md/design.md(用户三令存真);战役落地后按头部 R13 钩子回填生成器谓词与基线现值。冲突时真源胜。
>
> **已落地(0929 本役)**:三生成器+契约+实弹+装机全绿。回填先例:①「拓扑变更重立基线」=合法上调(t2i 主 37→67,扇出×三行结构性互交、源位置对倒守恒论证;i2i 64→52、edit 68→58 净降),棘轮「只降不升」仅约束坐标-only 轮;②零真重复谓词已入三生成器自查(同 type+同上游集合+同 widgets,主图/子图分域);③实弹产物勿落 `apps/out/`(打包清场设计内会清除,本役实弹 PNG 连坐丢失),改落 `apps/output/`。

1. **并行支路+单一选择点**(0929 用户令「使用并行节点布局前面只有1个选择逻辑」):N 个互斥模式=**N 条完整自足支路**(各含自己的采样器与参数,MODEL/steps 全内聚),在选择点汇流;选择点**唯一**,置于被切换量的最下游汇流处(如 LATENT 汇流→单解码)。
2. **注入式=反模式**:向共用节点注入参数(换 MODEL/换 steps)每个注入量要 1 开关+常量+比较器伺候,K 个注入参数≈3K 个逻辑件,并伴生摆设值与「某一模式的机构占满画布」的视觉倾斜——实据:0929 前的 Q2-1 加速区 10 个逻辑件伺候一个档位,用户观感「满眼 viggle」。
3. **复用铁则**(0929 用户令「不要重复出现1个节点,要进行复用」):
   - **单源扇出**:同一资源只允许一个节点实例,多消费者从该实例扇出(ComfyUI 原生支持一输出接多输入;典型:base MODEL 一源三用、空潜/条件/seed 单源扇出全支路);
   - **零真重复**:画布不得存在「同 type+同上游集合+同 widgets 值」的两节点——生成器自查+契约测试双记账;
   - **非重复论证**:参数或上游不同=并行支路本体,非真重复;强行共用一个节点即回注入式反模式。
4. **懒执行选择**:选择点必须懒——未选中支路零执行零加载(原生 ComfySwitchNode=二态懒开关;N 选 1 用二态级联(仍多件)或自研懒选择节点(参照核心 comfy_extras 开关件 `check_lazy_inputs` 写法,首例见 my_nodes 的 MyQi21SpeedSelect))。档位类闭集用 combo(列表即契约,首项=默认),禁裸 int 档位号;档位表(`SPEED_MODES`)单源防漂=契约测试锚(原三生成器 import 互锁随 1001 退役失效)。
5. **面板值=生效值(设计要求,非事实默认,违者即查)**:凡留在面板上的控件,其面板值必须就是生效值;被输入接管的 widget=摆设值(面板值≠生效值),须 Note 注明或重构消灭;并行化后各支路参数回归自身 widget 即自然达标。
6. **完整功能域收装子图**(0930 用户令:「[206]/[7]/[198] 这个排列太奇怪了…将上面三种情况,都写入自定义加速节点图里面,才是正道,现在,在外面做的看起来太奇怪了!」):完整功能域(并行支路+其伺服件+选择件+seed 类机构)**整体收进一个子图**,主图退成「加载器→提示词子图→加速子图→输出」四块骨架——机构在主图摊开成排=反模式(观感判例同令)。收装铁则:①**宿主 id=原汇流/选择件节点 id 沿用**(t2i[208]/i2i[190]/edit[58],锚变动最小、契约残留可循;子图内让位件取新 id,展开形 `宿主id:内部id` 避同号);②宿主 title=用户语言短名(命名规范见布局策略 ⑧2);③用户控件(速度档位/seed/三态 RGBA)经**宿主面板外露**(widget 型输入槽,无连线;值权威=宿主 `widgets_values`,与 `sg.widgets` 同序镜像双写);④**懒执行语义子图内保持**(收装后必须实弹复核未选支路零执行零加载);⑤**两子图职责互斥**(提示词子图管内容语义:型选择/装配/PE改写/RGBA;加速子图管采样策略:三支路+档位+seed;不掺和)。先例:Q2-1 道劫三件 0930 收装批(09-29-qi21-canvas-batch)——干跑执行集四档对拍逐 id 等价、实弹三档懒执行取证全绿、每件恰两子图;子图工程登记惯例(宿主 id 沿用/widget 外露清单式)入 `docs/comfyui-kb/子图工作流工程契约.md` §八。

## 节点与工作流认知(1006 新章:节点详情·子图关系·设计纪律·文件关系)

> 本章收拢历役踩坑定谳(0922~1006;机制类=前端源码/活机实证,稳定;实据战役随条标注)。凡写/改节点、建/改子图、排查「改了没生效」先通读本章;与排查专文冲突时专文胜,回改本章。

### 1. 节点解剖(基础节点必知)

- 节点 JSON 字段:`id/type/pos/size/title/properties`+`inputs[]`(每项 `{name,type,link}`,widget 槽另有 `"widget"` 键)+`outputs[]`(每项 `{name,type,links[]}`)+`widgets_values`(按 widget 序装值)。**手建节点漏 `outputs[]`=双向一致性破**(实据:PrimitiveString 手建件);`widgets_values` 错位/缺占位=子图件多发实弹红根源(1002 F1)。
- **widget 输入 vs 连线输入**:同槽二选一,接线后 widget 成**摆设值**(面板值≠生效值),须 Note 注明或重构消灭。
- **links 三处挂接+死槽死线零容忍**:每条连线同挂 links 表+源 `outputs[].links`+目标 `inputs[].link`;`link.type` 必须=origin 槽实型(`"*"`≠STRING 会出事);节点删改后 link/边界槽/主图连线**不自动清**,架构改后全链审计(实据:五轮手术漏删 link330 被自检拦下;link303 陈旧指向=用户负向主体句静默丢弃)。
- **隐藏输入可回溯真实执行链**:`hidden:{"prompt":"PROMPT","unique_id":"UNIQUE_ID"}` 引擎执行期注入完整执行图;API 批量路径会剪枝路由节点、画布旁路件在 UI→API 转换期已剔除——披露/审计类需求走此路,勿读静态台账(先例 my_daojie_route [86],0922)。
- **OUTPUT_NODE 想看得见=ui 载荷+JS onExecuted**:裸元组返回前端不画(预览算了但看不见);py 侧回 `{"ui":{...},"result":...}`+web 扩展 `onExecuted` 回填显示框(前端版本可能传 `message.output.merged` 或 `message.merged`,**双形态兼容**);`WEB_DIRECTORY="./web"` 官方扩展点零改本体。刚打开不跑的两形态都属设计内:**有预填快照的件=打开即见快照**(部署时写进 JSON `widgets_values`,1006 展示框预填),**无预填的件=空框**;两者跑完一发都被 `onExecuted` 回填覆盖。**展示框持久化是双态设计(1007 用户令定谳)**:①短暂态 `serialize=false`(不进 widgets_values=不污染序列化,重启即空);②**持久态 `serialize=true` 文本随 widgets_values 落盘+载入预填,必须配 `onConfigure` 链守卫**(serialize=false 时代的旧存档缺本槽位,框架按位填充可能留 undefined,显式归 "";运行期仍由 onExecuted 覆盖)。实例=[401] 合并预览已转持久态(用户令「预览跨重启持久化」);同文件 api_key 密码控件的 serialize=false 是**密钥不落盘**设计,两者勿混。api 格式零波及:非 py 输入的 widget 不进 graphToPrompt,serialize 位只影响工作流文件 widgets_values。
- **multiline 文本框**:STRING 要渲染成占满节点的大文字框=`required`+`multiline:True`;**只读展示框必须放 optional**——required 会被 `/prompt` 验证层强求值直接 400(1006 实据)。展示框与控件的退役分界(删下拉框≠删展示框)见 §5。

### 2. 节点真实形状以 /object_info 为唯一真源

- **API 输入名≠画布显示名**(LoraLoaderModelOnly 真名 `lora_name`/`strength_model`,画布显示 `lora`/`strength`):读输入/写 API 图/造单测假图一律 `/object_info/<NodeType>` 实查 `input.required/input.optional/output`,禁凭画布记忆——单测假图必须按 object_info 形状造,否则假绿真弹全穿(0922 四连坑之首)。
- `/prompt` API **不吃 widget 默认值**(model/temp/max_tokens 必显式带,max_tokens 下限 256);裸 COMBO 槽写字面值会被空列表校验拒(value_not_in_list),须链接形态;easy showAnything 的 history 取值键=`text` 非 anything。
- **引擎验证层环检对 lazy 边不豁免**(`execution.validate_prompt`;执行层 graph.py 才豁免):A出B、B出A 的图 queuePrompt 直接拒——解法=拆件成链,不能靠 lazy 硬绕(1001 S8)。

### 3. 子图关系模型(宿主·定义·边界·主图,一处改处处查)

- 关系链:`definitions.subgraphs[]` 定义(内嵌 nodes/links/inputs/outputs)↔ 主图宿主节点(type+properties.subgraph=子图 uuid)↔ 宿主 `inputs[]`(与 sg.inputs 逐项镜像)↔ 主图 `links`(target_slot=宿主槽号)。**架构改后必跑六同步**(清单专文=排查文档 §五,两处须同款六项):①子图边界 inputs(槽名+槽号;含 `sg.inputNode(-10)` 元数据在场非空——缺/空=宿主零输入口)②宿主 host.inputs ③主图 links target_slot(**删中间槽后后续槽号整体移位,连线不跟=输入入口消失,最易漏**)④子图出口销位置=**虚拟出口节点(id=-20,SubgraphOutputNode)装载时按节点布局自动推导**(实测≈最右节点 pos.x+50 / 最顶节点 pos.y;1007 晚两会话双机实证),`outputs[].pos` 是被 `arrange()` 重算的**装饰字段,改它零视觉效果**(pos=4000 实验点不动实证;上会话 2450→2780 三修无效同因)——**调销位=调节点布局**:装配子图 [4014] y 204→340(带0 内),销盒底 208 与节点顶净距 132px,锚=契约 `test_subgraph_row_layout_top_to_bottom`;**运行时执行器=`my_nodes/web/subgraph-io-anchor.js`**(1007 用户令「输出 port 须在输入 port 右侧且有距离」:看门狗 600ms 轻检,出口销 x 低于最右节点右缘+80 时锚定到下限,手拖更右不回拉;文件布局推导位必然内落,此扩展=恒向右/输出口最右铁律的落地 enforcement)⑤工作流三路热覆盖(仓库→装机 Resources→引擎缓存,见 §6)⑥蓝图重同步(子图定义改后跑 sync,否则 blueprint-match 锚红)。
- **层级与嵌套口径**:主图(=用户所说「父图」)→宿主节点→`definitions.subgraphs[]` 定义,三层各归各位;**本仓恒单层子图**(10-06 全库扫描 81 件 JSON:13 件含子图定义,子图内嵌子图节点 0 命中;契约文档无嵌套条款,layout_check scope 亦单层 `sub:<名>` 不递归)——未来若引入嵌套,六同步清单与 scope 模型两处口径须先扩再动手。
- **-10/-20=虚拟边界概念**:−10 只住 `sg.inputNode` 元数据字段(`{id:-10,bounding:[…]}`,驱动宿主输入口渲染),−20 只作出口边界;**禁塞进 sg.nodes 数组**(前端不认 `__subgraph_input__` 类型,报「请安装缺失的包」,1005)。
- **蓝图同步恒单向(蓝图→工作流)**:术后先「抽离回蓝图」再跑 sync,否则 sync 把手术打回旧版(1001);蓝图化宿主 type=前端新造实例 uuid(非定义原 uuid),幂等比较须除 id 归一;蓝图改后蓝图文件不同步=契约锚红。子图内新节点类型须重启引擎才注册(队列==0 硬门再重启)。

### 4. 宿主面板槽渲染(前端源码+活机定谳;排查专文=「子图宿主面板排查.md」)

- **宿主槽渲染成什么由子图内部落点决定,与宿主序列化无关**:边界线落点是带 widget 的输入(COMBO/BOOLEAN 等)→widget **提升**到宿主=面板控件;落点是 forceInput 纯槽→宿主渲染带名连线点(MODEL/CONDITIONING/LATENT 天然纯槽=带名)。修「面板不渲染/错名」先查内部落点声明(forceInput),勿再照序列化格式盲改(1005 ㊇翻案)。
- **终态公式**:STRING 连线槽=纯槽形(只 name/type/link;对象形+活 link 在连线后=裸点无标签+隐藏 widget 占位大空白);widget 槽=对象形 `"widget":{"name":"槽名"}`(布尔 `true` 无效);`widgets_values` 只装 widget 槽值。
- **序列化零重叠≠视觉零重叠**:multiline 展示框把实际渲染撑大于序列化 size——间距按渲染后占位留,画布门加活机截图复核(est/自查仍按序列化口径,见 ②)。

### 5. 自研节点设计纪律(用户 UI 哲学,违者返工)

- **开关只在一处、选择只在一处、下游只做处理**;控制流分散多节点=认知负担+冗余。
- **零死槽死线+标题正名**:删功能连边界槽/宿主槽/主图连线/标题残留一起清;标题=用户界面禁残留已删功能描述,机制细节住 Note/组框标题,信息零丢失。
- **改共享类前先查全部消费方**(一类两用=拆双类,先例 MyQi21FinalOutput=t2i/MyQi21PromptSelect=i2i·edit);半途签名手术=运行期才炸的哑雷,简化后必须真调用一次验证;**共用常量改前 grep 全部用法**(一名多锚,改它=他处口径全变)。
- **改节点行为=改 my_nodes 代码层让旧工作流自动继承,禁碰用户工作流 JSON**(用户画布手改=权威,改前必重读);JSON 热读数据(教材/色卡/风格底座)节点内读真源文件零复制进画布;无用参数框=认知噪音禁 UI 暴露(**仅指输入控件**;只展示不参与计算的展示框不是参数框,分界见下条)。
- **「退役/删控件」只及控件,展示框不是控件(1006 问责判例,过度执行高发,先分类再动手)**:面板上物分两类——**控件**=下拉框(COMBO)/开关(BOOLEAN)/数值框(INT/FLOAT)这类参与计算的输入件,用户操作它,是退役类指令的合法对象;**展示框**=optional multiline 只读文本框,值有两源(**出生=工作流 JSON `widgets_values` 部署时预填快照,打开即见;运行期=JS `onExecuted` 回填覆盖**),只展示不参与计算,**不是控件**。因此任何「退役/清空/转零控件/删下拉框」类指令的默认范围**不含展示框**;展示框要删必须用户点名(用户说出「删展示框」才算)。执行流程:动手前先把目标节点的 widgets 逐个分成「控件清单/展示框清单」两张单,只动控件清单,展示框清单原样保留;**删控件后同批重对 `widgets_values`**——位置制按序装值,少一项全表错位(F1 实据:七值形头部空串占位),宿主镜像与子图 `sg.widgets` 同步重对,防「控件删完、展示框值错位」的第二发实弹红。实据:1006 某会话转零控件类时把 optional「内容」展示框一并删掉=过头,用户令返工(三个专用类加回展示框+json 重预填)。
- **改管线/改节点签名=契约与 E2E 锚同批重锚**(速查卡/说明卡/契约常量/E2E 锚点全链对账;实据:E2E D5 旧锚 FAIL=锚债非缺陷,响亮 FAIL 恰证判别力)。
- **DOM 输入控件三陷阱(1007 实弹,api_key 密码框三连修全录)**:给节点加「可输入」控件(密码框/单行输入)时——①`addWidget("customtext",…,{multiline:false})` **不生成输入元素**(数据层 widgets 在场≠面板可见;验控件必验 `w.element/inputEl` 在场,验到数据层不算数);②`addDOMWidget` 元素**懒创建**,loadGraphData 期 `DOMWidgetImpl.computeLayoutSize` 无条件读 `this.element`→`getComputedStyle(undefined)`→**整个工作流装载中断**(用户所见「打开失败」);③分离元素上 `--comfy-widget-min/max-height` CSS 变量读空→parseInt NaN→行高放飞成巨框。**官方修法(框架 customtext 封装同款)**:元素 nodeCreated 期先造→addDOMWidget 后立即 `w.element=el` 饿汉挂载→options 显式 `getMinHeight/getMaxHeight/getHeight:()=>38` 钉单行(+`getValue/setValue` 同步值;`serialize=false` 不入工作流,配引擎侧内存路由则密件全链零落盘)。诊断法=CDP 复现抓 `e.stack`→拉前端 bundle 按 stack offset 翻源码定位元素绑定机制(勿按猜测绕过)。

### 6. 工作流文件四副本与读取路径(改前追真读源,改后热覆盖)

**⭐ 唯一交付管线(1007 判图役五连修定谳+1007晚 出口销整备改序:契约前置,验证绿了才准部署;禁跳步禁凭感觉)**:

1. **改仓库真源**(唯一编辑位;生产件=带断言手术脚本,fail-closed)。
2. **契约测试(前置门,绿了才准进第 3 步)**:`pytest tests/test_qwen21_workflow_contract.py my_nodes/tests/ -q`——**零新增红;不绿=带伤部署,坏版本会流进用户画布被点运行(1007晚 实弹:reroute 手术 4304 slot 错,契约当场抓到,但部署已先行,用户窗口期执行被前端校验拒收=全节点零输出)**。既有红账如实注,零新增为准。
3. **cp 热覆盖**(按类型):.py=仓库→装机 Resources→引擎家 custom_nodes 三方;工作流 JSON=仓库→装机→引擎缓存三方**+蓝图 subgraphs 双刷**+`qi21_blueprint_sync_1001.py --check`;JS=仓库→装机→引擎家两方。
4. **生效动作**(按类型,缺这步=用户看到的永远是旧的):.py→**重启引擎**(队列==0 硬门);工作流 JSON→**画布重载文件**(关签重开或 CDP `loadGraphData`——**reload 页面只恢复会话快照≠读盘**);JS→**页面重载**(no-cache 已根治缓存)。
5. **活机读数**(无读数不得报「已生效」;只许说「盘上已改待载」):.py→`/object_info/<类>`+路由 curl;JSON→CDP `app.graph.serialize()` 读 definitions(根图恒 `app.graph`,`app.canvas.graph` 在子图视图=内层图);JS→CDP 验 DOM(`w.element/inputEl` 在场,数据层在场≠渲染在场)。探针姿势=App 带 `--remote-debugging-port=9225` 启动→`/json/list` 取 webview target→executeJavaScript。
6. **报账**:生效声明+活机读数+测试结果,三件同报。

> 1007 实弹反例存档(每步漏掉的代价):漏 3→用户看旧布局(会话快照恢复)「布局没改」;漏 4→控件数据层在场面板无 DOM、装载期炸 getComputedStyle;漏 4 的读数→「webview 已刷」实为恢复快照,错0 二犯;**错序(先部署后测)→带伤版本流出,用户执行被前端校验拒收=全节点零输出(1007晚 出口销整备 4304 slot 错)**。

- 四副本:①仓库真源 `apps/backend/engines/comfyui/workflows/` ②装机包种子 `/Applications/….app/Contents/Resources/backend/…` ③构建产物 `apps/release/build/…`(拿它代替验证=AGENTS 禁)④引擎家用户区 `<engine-home>/ComfyUI/user/default/workflows/`(用户另存件家;旧快照与 repo 恒 differ=用户手存非装机件)。`~/Library/漫影工作室`=软链→新家,非第五处。
- **改任何 UI/工作流前先从用户看到的界面反向追实际读取路径**,勿只改理论源头(1005 十轮白改教训):侧栏 `repo:` 叶子直载读**②装机包**非④(活机判据 `activeWorkflow.path` 形如 `workflows/<rel>`);全图见排查文档 §七。
- **画布类改动=热覆盖零打包**(1006 最高令):仓库→装机包 Resources→引擎缓存三路覆盖,涉节点 .py 再加引擎家 custom_nodes 且须引擎重启(App 首启 sync 覆写 custom_nodes——手动 cp 引擎家重启必被冲掉,持久热修=改 Resources 种子);**蓝图/子图定义改动=装机 Resources 两处同批 cp**(`my_nodes/subgraphs/` 蓝图+`workflows/` 宿主工作流——侧栏真读装机包,漏 cp=用户侧仍旧,重启经 sync_my_nodes 进 custom_nodes);md5 指纹四处全一才算同步;**打包仅用户明令才跑 build-mac.sh**。又一坑(1007 晚实勘):**用户画布还持旧态时,App 一次保存/会话收尾就把旧内存态写回用户区缓存复毒**(实测 2424 复写发生在三路修复后 15 分钟,指纹=用户区 md5 又异于仓库)——修完三路必须让用户关签重开读到新态才算闭环,只对盘不对活机=白修;修复后画布未重开前勿按保存。
- **⭐ 排障思路序(「改了没生效」的思考流程,1007 出口销五修无效一役定谳的方法论,照序走禁跳步)**:
  **第0步·先看像素**:截图看用户实际所见,**数据读数(serialize/outputs/审计)一律不算数**——它们可被装饰字段与推导位欺骗(本次五轮全被"数据绿"骗过);画布怠速 FPS0 不重绘,程序性移动须 `draw(true,true)` 强绘再截。
  **第1步·盘上对账**:`canvas_deploy.mjs --audit`——漂=补齐+查谁写回(复毒指纹:用户区 mtime 晚于修复时间=活机旧态回写)。
  **第2步·读取路径定谳**:用户从哪打开?(侧栏 repo: 叶子=读装机包/原生菜单=读用户区/恢复=读草稿+标签态)——从用户实际入口反推,勿从"理论源头"正推。
  **第3步·判决实验(本方法论的核心武器)**:把怀疑字段改到**夸张值**(如 pos=[4000,60])+强绘+截图——**像素动=字段是真渲染源**,问题在"没送到用户层"(继续第4步);**像素不动=装饰字段/镜像**,立即停手读**渲染器源码**找"pos 被谁写"(案例:SubgraphOutput.arrange 揭示 pos 是被 arrange 写出的衍生物)。**此实验五分钟,价值=终结整场盲修;禁在第 3 轮盲修之后才做。**
  **第4步·会话层按序排除**:关签重开→草稿(Draft.v2 换血)→标签 content/changeTracker→子图 uuid 注册表(节点布局随重载同步,销位播种不跟)——**每排除一层记一层,同层禁反复**。
  **第5步·三败熔断**:盲修 3 轮无果=**强制停手**,升级为读渲染器源码+读契约测试锚(布局手术必须在锚内做),从"改数据"切换为"改布局/改机制"。
  **第6步·闭环报账**:零动作交付配方(直推+换草稿+就地板)+渲染源读数+**截图**+契约+audit,五件同报。
  (四根因速查表仍是第 1-2 步的快捷路径;本序是含会话层与判决实验的完整思考流程。)
- 「改了没生效」四根因按序查:读错副本→已开标签内存副本(须关签重开)→节点 .py 未重启引擎→webview 未载新 JS;对拍内容用 `python3 -m json.tool` 规范化,装机包序列化格式异而内容同≠种子过期。
- **JS 扩展旧缓存类已于 1007 根治**:my_nodes 注册 aiohttp middleware 给 `/extensions/*` 响应补 `Cache-Control: no-cache`(每次重载回源校验,304 命中零成本)——改 JS 后重启引擎(中间件随 .py 装载)+任意重载即新代码,「关签重开两次」旧咒语作废;若仍旧=查引擎是否真重启过或文件是否真 cp 到位(仍是四根因,不再赖缓存)。又一坑(1007):**App 页面刷新恢复的是会话快照(标签内容存 App 侧)非盘上文件**——改子图定义后光 reload 无用,必须关签重开或 CDP `loadGraphData` 直推;活机对账读 live 值(经 `app.graph.serialize()`,注意 `app.canvas.graph` 在子图视图=内层图无 definitions,根图恒 `app.graph`)。**二阶坑(1007 二次实勘):子图实例按 id 缓存,loadGraphData 重建定义≠重建内层实例**——内层 `app.canvas.graph.outputs` 仍持旧 pos 时,就地赋值修渲染源(`o.pos=[…]`+`app.canvas.setDirtyCanvas(true,true)`),验收必读渲染源(内层 graph.outputs)而非仅根图 serialize。
- **生效矩阵(改动类型→生效动作,1007 判图役五连修定谳,照单执行禁凭感觉)**:①节点 .py(类/路由/中间件)=cp 三方+**重启引擎**(队列==0 硬门)→object_info/路由探活;②工作流 JSON(含子图定义/出口槽位/预填快照)=cp 三方+蓝图双刷+**画布重载文件**(关签重开或 CDP loadGraphData——reload 页面只恢复会话快照≠读盘)→活机 serialize() 读数;③JS 扩展=cp 两方+**页面重载**(no-cache 头已根治缓存,重启引擎非必需除非同批改了 .py)→探针验 DOM。**凡报「已生效」必须带对应活机读数;报「盘上已改待载」也算诚实**。
- **⭐ 落点总表(一次修改到底要落几个地方,1007 晚出口销战役五修无效后全量定谳,照单落点禁凭记忆)**:
  - **节点 .py = 3 盘上落点**:①仓库真源 ②装机 Resources(`Resources/backend/engines/comfyui/my_nodes/`)③引擎家 `custom_nodes/my-nodes/`(引擎重启被 sync 从②覆写=手动只改③不持久);生效=重启引擎(队列==0)。
  - **JS 扩展 = 3 盘上落点**:同上三路(web/ 目录);生效=页面重载(no-cache 已根治缓存)。
  - **工作流 JSON = 3 盘上 + 3 会话层 = 6 落点(最复杂,少一个=「改了没变」)**:①仓库真源 ②装机 Resources(**侧栏 repo: 叶子真读这份**)③用户区缓存 `user/default/workflows/`(脏画布 autosave 会写回=复毒源)④**webview 草稿** localStorage `Comfy.Workflow.Draft.v2:personal:<path哈希>`(恢复优先级草稿>盘上,quit 时被活画布态回写)⑤已开标签内存态(workflow.content/changeTracker,关签即清、存档期写回④)⑥子图定义 uuid 注册表(会话内注册:节点布局随重载同步,**出口销等播种字段不跟**)。**子图定义改动另加蓝图** `my_nodes/subgraphs/*.json` 仓库+装机两刷(引擎家经 sync)=合计 7-9 落点。
  - **覆盖分工**:①②③=canvas_deploy.mjs 部署+`--audit` 全量对账(机器门);④⑤⑥=零动作交付配方(直推+换草稿+就地板)+渲染源读数+**截图**(唯一视觉铁证);子图布局另有契约锚=pytest `test_subgraph_row_layout_top_to_bottom`(带成员/带内 x 递增/链序)。
  - **App 前端(tsx/css)= 仓库 1 处+重打包**(asar 无热修,打包仅用户明令)。
- 活机自验:`node apps/build/scripts/comfy-canvas-verify.mjs`(**整跑 prekill 全家,用户开着 App 时禁跑**)或一次性 CDP 探针(连 9222-9231 活实例读 activeWorkflow.path/宿主 inputs/组框标题+截图,不杀 App)。
- **一键交付工具(1007 收尾固化,本管线 2~4 步的代码化)**:`node apps/build/scripts/canvas_deploy.mjs <文件...> [--verify-only]`——判型(py/js/subgraphs json/workflows json)→cp 热覆盖→生效动作→活机读数→PASS/FAIL 即交付结论(exit code=verdict);`--verify-only`=只读验收零部署。报「已生效」引用它的读数即可。三坑已内治:扩展 URL=WEB_DIRECTORY 内容平铺进 `/extensions/<节点目录>/` 无 web/ 段(从 `/extensions` 注册表反查,勿拼路径)/lsof 的 `-i` 与 `-p` 是 OR 关系必须加 `-a`(否则扫全系统监听面抓到别的进程的口)/py 类提取按顶格 `^class`(勿要求缩进)。
- **指纹门=机器门,散文对账作废(1007晚 复毒事故立宪)**:报「同步完成/指纹一致/零漂移」前必跑 `node apps/build/scripts/canvas_deploy.mjs --audit`——全量扫 workflows+my_nodes 三副本 md5(装机=必须同;用户区=存在必须同,缺席=NOTE 零回灌基线非漏;tests=豁免),FAIL 点名文件,exit code=verdict。**理由:三处对账规则在库三处(SKILL §6/排查文档§五.5/记忆四副本图),两任执行人仍各漏一次——门在散文里靠自觉逐条对=必漏,只验自己改过的件=验不全;机器门一键全量+反事实自证(弄漂一份必红)后才算门。**交接胶囊转来的哈希数不算数,接手验收必须自己重跑门。
- **CDP 取证通道坑(1007)**:对 App webview 发 CDP `Page.reload` 后,该 webview target **不再回归 `/json/list`**(Electron guest 重载不重注册 target;主窗体 page target 仍在但 `document.querySelectorAll('webview')` 为零=画布是独立 view 非 webview tag)——之后对用户会话的活机取证改走自起无头实例(独立 profile 直连引擎,零 /prompt 不碰用户队列)或重启 App;webview 是否活着看 `lsof -a -iTCP:<引擎口>` 的 ESTABLISHED 连接数,勿凭 target 消失断言界面坏了。**零动作交付配方(1007晚 实测全通,修盘不修眼=没修)**:target 回归后直连用户 webview——`loadGraphData` 直推最新文件→**内层实例 `host.subgraph.outputs` 逐个 `o.pos=[…]` 就地赋值**(推文件不重建按 id 缓存的实例)→`window.app.canvas.openSubgraph(sg)` 把用户视图送回子图→**复读 `app.canvas.graph.outputs`(渲染源)报数才算交付闭环**;「盘上已修,请关签重开」是半成品交付。**「App 会话快照反复打回旧值」的真窝点=ComfyUI 前端草稿自存档 localStorage `Comfy.Workflow.Draft.v2:personal:<path哈希>`(恢复优先级:草稿>盘上文件;索引=`Comfy.Workflow.DraftIndex.v2:personal`,标签清单=`Comfy.Workflow.LastOpenPaths:personal`)——改布局必须连草稿一起换血,格式=`{data:<工作流JSON字符串>,updatedAt}`(data 是字符串非对象,Object.keys 出数字下标即铁证),写完必验 `JSON.parse(d.data).definitions` 在场+新坐标在档;只推活画布不换草稿=下次恢复原样打回(1007晚 三推三回实录)。**

- **✅ 第六层已缴械(1007晚三场读源码破案,上文「未缴械」销案)**:「第六恢复源」**根本不存在为存储层**——出口销位置由虚拟出口节点(id=-20)装载时**按节点布局现算**(≈最右 pos.x+50/最顶 y,见六同步④),布局不变则每次装载都算出同一个旧值=「跨重启存活/grep 不可见」的全部真相;[4000,60]=判决实验残留经标签 changeTracker 状态回流。根治=[4014] y 204→340(推导位落空带,d84ed3f5),此后任何恢复路径都落空带。五层对账+探针(readpath-probe 五读数)+就地手术仍有效,但**布局销位类问题先读六同步④,勿再找暗格**。
- **⚠ 视觉改动两铁律(1007晚 出口销五修无效定谳,违者=盲修)**:①**判决实验先行**——渲染类改动动手前,先把目标字段改到夸张值+截图看**像素动不动**(五分钟证伪装饰字段/镜像;反例=outputs[].pos 改三轮才发现是装饰位);②**截图=唯一视觉铁证**——数据读数(serialize/outputs 复读)可被装饰字段与推导位欺骗,报「已生效」必须附截图;画布怠速 FPS 0.00 时程序性移动**不重绘**,须 `window.app.canvas.draw(true, true)` 强绘再截(当前前端无 `setDirtyCanvas`,try/catch 会吞错假成功)。

### 7. 展示与交付纪律

- **展示节点图/拓扑/数据流一律用 mermaid graph 代码块**(graph LR/TB+subgraph 分层+节点标签带编号短名+分支带标签连线 `-->|"条件"|`),**禁字符画箭头图**(用户终端错位难读,1002 裁定)。
- **交付三道门**(画布/节点 UI 类改动,不过不报完成):①指纹三处(仓库+装机包+引擎缓存)md5 同一;②相关 pytest 绿;③活机对账+截图 AI 亲眼看渲染。禁拿用户当测试仪(1005 问责立宪)。
- **诊断顺序**:活机探针>读前端源码(Comfy-Org/ComfyUI_frontend)>同仓参照件逐字段 diff>才轮到假设;禁凭记忆编序列化格式。

## 布局策略全谱(核心章,完整自含)

> 本章数字口径以 0928 立宪与 `apps/build/scripts/workflow_layout_baseline.json` 实况为准(三生成器 1001 起退役勿重跑,自查谓词降为史档);**易变棘轮基线现值不硬编码**,取现值走 `docs/comfyui-kb/画布布局规范-0928.md` §三。

**生成器(⚠️ 1001 起退役勿重跑)**(本章与 ④⑥⑦ 反复依赖的概念,先定义)= `apps/build/scripts/` 下三个幂等 Python 脚本,0928 立宪时的生产工作流产地(直接执行=重建三件生产工作流 GUI JSON+跑自查谓词一体,谓词住各脚本 docstring 自查段)。**1001 起 0928 立宪 §三 明令退役勿重跑**——重跑=用旧拓扑覆盖手术链产物(t2i 件权威=手术脚本链);自查段降为史档可读勿执行。退役后现状口径:①**基线真源=`apps/build/scripts/workflow_layout_baseline.json` 单源**(audit/layout_check 口径);②生产件改动=带断言幂等手术脚本(fail-closed 不落盘)改仓库真源,改后 layout_check+契约测试双验;③名单速取(史档,免誊代号)=`grep -l "交叉不增封顶" apps/build/scripts/*.py` 恰命中三件(文件名带项目代号,按零 IP 词纪律本文不誊写)。基线账权威=0928 立宪文档 §三。

### ① 排版总策略

- **横向流水线**:列=阶段(加载器→编码→采样→解码→保存),数据恒左→右(09-19 铁律)。
- **分层行结构**:层内横向一条链,并行层从上到下堆叠,层间距=**PITCH 节奏常数(标准档 760;0930 节奏常数轮起 720 退役、三件收敛单值 760,紧凑档 560/600 须真前端观感定夺禁拍脑袋回退)**。0925 调和定谳:这是「分层行」不是「纵塔」——并行链垂直堆叠是 09-19 铁律的合法形态,纵向深链单列塔才是违令形态。
- **零负区**:所有节点 **pos≥80**(现行值;演化注:0925 W6 时为 pos≥40,0926 收口升级 80;0925 W6=2026-09-25 战役第 6 工作段的时点编号)。嵌套子图摊平后须整图归一,手法=**平移归一**(x/y 最小值归一到阈值,子图行带同步下移;本仓现库零嵌套,嵌套口径=「节点与工作流认知」§3)。

### ② 防重叠体系(两套体系分清,防混装)

**本项目生产工作流恒用 est 制**(est=按槽位/控件数估的节点渲染足迹):

- 节点矩形零重叠:主图+子图所有节点两两盒不交;
- est 间距:同行横距 **≥200**、同列纵距 **≥80**(Reroute/Note 豁免间距阈值,但 est 盒重叠**不豁免**);
- 子图行排版:按 y 分行(行数=阶段数),Reroute 拐点**不占行**,**行间净距≥100**,行内 x 严格递增;
- **禁两节点同 pos**。
- **序列化 size≠渲染占位**:multiline 展示框等会把实际渲染撑大于序列化 size——est/自查按序列化口径跑,视觉重叠须活机截图复核(机制见「节点与工作流认知」§4)。
- est 足迹估算(自查/估尺寸用):高=标题 36+槽位行数×24(行数=max(输入数,输出数))+控件数×30+垫高 28,预览类节点(SaveImage/LoadImage 等)再+260;宽=max(250,声明宽),高不低于声明高(声明宽/高=节点 JSON 的 `size[0]`/`size[1]`;size 缺省时 est 宽自 250 起步、高按公式)。公式出处=本技能 `tools/workflow_layout.py`(归因副本;上游同步以 comfyui 技能原件为准)的 `est_size()`。备察:`est_size` 较生成器自查段内联 est 式为**超集**(预览类节点再 +260 高度并取整);est 类检查已对三件生产件实跑与生成器绿零分歧——差异系口径来源不同,非移植失真(立宪检查器 est 盒按 R14 明文复用 est_size;R14=同任务档 prd.md 的「通用代码入技能」条款——0928 三令「通用性的代码设计,是需要在这个技能中的」所落,与头部 R13 同档相邻条)。
- 三个纵向数的适用面(勿混):**PITCH(标准 760)=分层行的层间距**(整条并行链换层时用;行带 y 等差单常数,0930 前旧值 dy=720 已退役);**同列纵距≥80**=est 制同列相邻节点最小净距(主图+子图通用);**行间净距≥100**=子图行排版中阶段行之间的净距。

**非项目临时图/通用件**才可用 comfyui 技能的 y 游标+列宽起步法(列宽=最宽节点+80、列内纵距 60)或 `auto_layout`(H_GAP=120/V_GAP=70)——常量低于项目阈值,**不得用于本项目生产件**。

### ③ 流向纪律

- **恒向右**:每条连线 `target.x > origin.x`(含 Reroute 段;子图边界线以 IO 槽 pos 为端点)。
- **左向线=冻结豁免,三防线钉死**:①生成器谓词锁「左向线恰 1 条且端点钉死」;②契约测试同步钉同一端点;③论证在档(替代方案均违已批裁定)。通用方法论:**豁免必须钉死(数量+端点双锁),不接受无名扩散豁免**。先例实据:某生产件子图内恰 1 条冻结回流线(link34,[141]→[40].提示词),端点由契约测试 `test_horizontal_layout_no_vertical_tower` 钉死(旧生成器谓词随 1001 退役=史档)——查实例=契约测试与 0928 立宪文档 §三。
- **子图 IO 三段位**:输入口最左→机器居中→输出口钉死最右:输出接口 **x≥全子图最大节点 x−50**(容差 50),右列纵向堆叠。先例实证(时点值):K2 图(K2=本仓 K2 图像产线,工作流住 `apps/backend/engines/comfyui/workflows/1_图片/`)输出槽 x=5231,比全子图最大节点 x 还靠右逾四百像素。
- **通道 Reroute 手法**:共享总线(MODEL/VAE 等)走顶缘正区通道带;Reroute 拐点不占行,不破坏行排版判定。

### ④ 五层优先级序+判定口径+治理手法(0928 立宪)

优先级序(高→低,冲突时高位胜):

1. **线不交叉**(线-线交叉对数越少越好,治理目标 0);
2. **线不遮节点**(0926 铁律:线不得从非端点节点身上穿过;=「节点不遮线」同义双向口径,1007 用户令重申——遮挡是线与节点盒的相对关系,两个说法同一判据,layout_check `occlusion` 41 点采样执行);
   1b. **DOM 渲染路线双写铁律**(1007 用户实拍「[401] 没有内容」):新前端 multiline/customtext=**DOM 文本框渲染**——程序性只写 `w.value` 不刷 `inputEl.value`,数据层 1226 字、像素层永远占位符空框(数据在场≠渲染在场 DOM 版)。onExecuted/程序性赋值一律 `w.value` 与 `inputEl.value`(无 inputEl 则 `element.value`)双写;验收=CDP 读 `inputEl.value`+截图,勿只读数据层。
   2b. **组与组不重叠**(1007 用户令):任意两组框 bounding 两两零交集——判据已入 layout_check(CHECK_KEY=`group_overlap`,C8 自测双向过;今日实测 分镜 4 组/t2i 5 组零重叠);
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
- **交叉不增封顶+单向棘轮**:现值基线以 `apps/build/scripts/workflow_layout_baseline.json` 封顶(audit/layout_check 口径;1001 起单源,生成器自查段 `_CROSS_BASELINE`=史档),超基线即红(防改动让交叉变多);每次治理后把基线降到新现值,只降不升;**判定口径 1001 起一律按 audit/layout_check**(生成器真实 size 口径字段仅存档不判)。基线账详见 0928 立宪文档 §三,本章不硬编码(防过期账)。

### ⑤ 组框策略

- **一阶段一框**:group 各框罩单一阶段行的全部节点;bounding 全罩、边缘到边缘无一外露,公式 `[minX−30, minY−50, (maxX+w)−minX+60, (maxY+h)−minY+80]`(顶部留标题栏高度)。
- **预算**:主图 **≤4**、子图 **≤4**;框**两两不相交**。
- 组框标题 **≤20 字**;颜色编码按阶段(加载器灰/条件蓝/采样绿/解码保存紫/后处理橙)。
- **画布禁功能横幅**(0915 裁定:文件名已说明功能;MarkdownNote 与组框标题不在此列)。
- 组框文案住 `groups[].title`(画布上的组框横幅);扫陈旧描述别只扫 Note 节点(1005 实据:粉色横幅=组框 title,一度漏扫)。

### ⑥ 验证纪律

- **判布局读坐标,禁截图**(截图烧 token,且各客户端同样读不了画布)。
- `tools/layout_check.py`=**0928 立宪口径的可跑实现**:贝塞尔交叉/线遮节点/est 盒零重叠/est 间距/零负区/输出口最右/左向线七判据(与工具 `CHECK_KEYS` 七项一致)逐式移植自生成器自查段,对拍过三件生产件基线(0930 S5 终排后交叉数逐值相等:**t2i 主4/装配16/加速0、i2i 主8/装配12/加速0、edit 主9/两子图0/0**——三件均双子图,九 scope 按 `主图/sub:<装配子图名>/sub:<加速子图名>` 分记;对拍史:0928 立宪时点 t2i 78/7、i2i 74/10、edit 84 单 scope——edit 子图为 0930 收装批新增);任何 GUI 格式工作流(生产件/用户区/临时图)都可独立跑,不依赖生成器;棘轮基线不内置(生产棘轮仍驻生成器)。
- `workflow_layout.inspect()`=**快速近似读数**(口径边界见头部声明;立宪判据现可用本地 layout_check 跑):`overlaps` 必须为 0;`crossings` 仅作粗计参考。
- **生产权威与棘轮宿主=「layout_check 工具+workflow_layout_baseline.json+契约测试」三件**(贝塞尔交叉/遮挡/est 间距/零负区/输出口最右/左向线七判据=layout_check,棘轮基线=baseline.json 单源,契约测试面见 `apps/backend/engines/comfyui/tests/`);旧宿主=三生成器自查谓词,**1001 起退役勿重跑**(自查段=史档,0928 立宪 §三)。
- `auto_layout` 只用于非项目临时图(间距常量低于项目阈值,见 ②);生产件禁 `--apply`。
- 负区治理=整图平移归一(见 ①)。

### ⑦ 落地链(生产件改动与出生路线)

- **固定工作流 AI 禁裸手改 JSON(09-14 只读铁律)**:生产件治理走**带断言幂等脚本路线**(apps/build/scripts/ 惯例:待替串恰出现一次断言+fail-closed 不落盘;先例=qi21 系手术脚本,布局/拓扑改动改脚本内坐标后重跑,产物落仓库真源);**三生成器 1001 起退役勿重跑**(重跑=旧拓扑覆盖手术产物,定义见本章开头);对拍可在内存副本手改,禁直写仓库真源件。
- **新生产工作流的出生路线**(生成器退役后):手写或复制改造 GUI JSON(双格式纪律见 comfyui 技能),落 `apps/backend/engines/comfyui/workflows/` 对应域子夹(1_图片/2_视频/3_声音),过 ⑥ 三件验(layout_check+baseline 棘轮+契约测试)再按认知章 §6 热覆盖装机;结构性大改优先带断言手术脚本;临时/实验图可手写,经 ⑥ 验图,不入库。
- 用户可自由改画布,但须**另存用户区**(引擎家用户目录,别存回仓库件名);要把用户区改动变成正式版=**留账回写**:经生成器路线吸收进仓库真源并提交留痕,用户区件不自动回流;**画布旧标签保存=覆盖威胁**(在旧标签上保存会静默覆盖仓库真源件)。
- 改完必 **lint**:契约测试 `python3 -m pytest apps/backend/engines/comfyui/tests -q`(布局锚如 `test_qwen21_workflow_contract.py` 的画布归一/横向排版用例)。
- 改完必**装机同步**(方式与时机由「节点与工作流认知」§6 钦定,**勿把本条读成「改完必打包」**):画布/节点类改动的日常同步=§6 热覆盖三路(仓库→装机包 Resources→引擎缓存,零打包;此处的手动 cp 是 1006 钦定配方,**不属「绕过入口」**);`apps/build/packaging/build-mac.sh`(构建+覆盖安装+installed smoke 一体)=打包的唯一合法入口,**且仅用户明令「打包/覆盖安装」才跑**——禁无令打包,也禁拿「不许手拷」当跳过热覆盖的理由。

### ⑧ 输出槽排布·节点命名·对称规整节奏常数(0930 画布治理批)

> 出自 09-29-qi21-canvas-batch(用户 0929 逐条报画布问题:标题过长/最终文本输出槽居中致线交错/布局对称竖排规整紧凑/命名不知所云);规则措辞按该役三件实拍归纳,非拍脑袋。真源=三生成器自查谓词(3i 节奏常数/0 号命名铁表;**1001 起退役=史档**,常数现值以仓库真源件+契约锚为准)+`docs/comfyui-kb/画布布局规范-0928.md`(§五 同口径);冲突时真源胜回改本技能。

1. **输出槽排布——槽序与下游去向的纵向序对齐**:同一节点多输出槽时,各槽的下游消费端按槽序自上而下纵叠(消费端在上者吃高槽位、在下者吃低槽位),导线不翻越兄弟槽的走线;**去向更远/需走框间带的输出放低位**。**预览/过目类文本输出槽(最终文本/prompt)=最末槽(节点最底)**——预览件通常远在右上,低槽位导线贴底横走,不与兄弟槽导线互辫。实证(0930 实拍):t2i [40] 槽序 `positive/negative/width/height/最终文本`,三消费端 [208]@上/[5]@中/[27](预览)@底按槽序纵叠,主图交叉 13→4;旧形(最终文本卡槽 2)导线翻越 width/height 两槽去右上,与他线交错(i2i prompt 槽同病同治,新序 `positive/negative/latent/positive_single/prompt`)。edit 无预览槽=**空真**;若补预览件,新槽必落最末。同步面=宿主 `outputs[]`+子图边界 `outputs[]`(右列 pos 随槽序)+主图 links `src_slot`+边界线(-20)`target_slot`+契约锚。
2. **节点命名规范——标题=用户语言功能短名**:节点 title 写**稳定短名**,让用户一眼知道这个节点是干嘛的(量级:「[40] 装配子图」「加速子图」「出图速度选择」);机制细节(类名/默认档/懒执行/档位数/括号说明)禁进标题,住 Note/tooltip/组框标题;**同构节点跨件同名**(三件宿主与选择件统一口径)。工程笔记式长标题=反模式(0929 用户判例:「表达不出这个节点是干嘛的,对用户来说感觉非常奇怪」)。被删说明性内容由组框标题+用法 Note 承载,**信息零丢失**(执行时逐条对账)。
3. **对称·竖排规整·紧凑=节奏常数(「不随意」的可判化)**:坐标章法收敛为**少数几个节奏常数**,生成器字面直写,自查谓词容差 0(同值直写,漂移只可能来自手改或常量失配,均应红)——①**同列 x 全等**(支路链头列 BRANCH_X、装配同构行成员 x 元组逐位全等);②**行距方差 0**(行带 y 等差,单常数 PITCH;**标准档=760**,720/760 双值并存已收敛,支路行距 PITCH_BR 与装配 PITCH_ASM 同值);③**行序=选择件输入槽纵序**(funacc 顶/viggle 中/direct 底;正序 0 交叉 vs 反序 4 交叉+1 线遮,实证对照);④**seed 带/Reroute 通道=寄生带**(左侧净空列或行间净空,不占行网格、不计入行距序列);⑤**紧凑=常数取小档而非破下限**:est 间距(横≥200/纵≥80)与零负区(pos≥80)仍为下限判据,紧凑档(560/600)启用须真前端观感定夺,禁拍脑袋回退(560 正是 0925 被用户批后弃用值)。主图**不做全网格**(节点少/组框承载视觉/列位随链),仅四块锚列常数化(每件 X①-X④ 字面直写)。对称/规整样板=三支路同列同距纵叠+装配同构行 x 元组全等(t2i 联动宽/高两行 `(2500,3100,3700,4300)`)。
4. **完整功能域收装子图**(结构层规则,全文见上方拓扑结构策略章第 6 条):功能域机构整体入子图、主图退四块骨架;宿主 id 沿用原选择件 id;控件经宿主面板外露;懒执行子图内保持(实弹复核)。布局侧落点=主图四块锚列+两宿主摆位(提示词宿主消费端按 1 的槽序纵叠对齐)。

以上四规则的治理优先级仍服从 ④ 五层优先级序:槽序对齐是「线不交叉」高位目标的结构性手段;挪位/并线优先于垫 Reroute 的手法序不变;节奏常数属第 4 层观感判据的量化,不破 est/负区下限。

### ⑨ 市面同域印证与吸收(1006 普查;来源均 MIT,吸收带署名)

普查(skills.sh 注册表+GitHub 仓库/代码搜索,四形状):同域实质两家=artokun/comfyui-mcp `workflow-layout`(790★,活跃)与 peteromallet/VibeComfy `reorganise-comfy-workflow`(150★);字面 node-graph 仅 HaJH/node-graph-skills(0★,Substance 专用,ComfyUI 仍"计划")。**不整装原因**:前者绑其 `panel_*` MCP 工具族、后者绑 vibecomfy CLI,本仓走纯 JSON 生成器路线——只吸收方法与印证;「JSON 配置+执行链+宿主渲染认知层」普查后仍零对手。

独立印证(他两家实测踩实本仓既有判据,佐证非新增):标题栏不在 `size[1]` 里(机身之上约 30px,按 size 裸堆叠=每节点叠一个头,须含头足迹——本仓 est「标题 36+…」同判);预览/载图类节点媒体未载时 size 偏小、渲染撑高,下方留 ~250-300px(本仓 est 预览类+260 同判);子图轨不随内节点走、搬完必重钉(本仓「出口 pos 紧邻最右」同判);收装子图保内部节点 id、wrapper 取新 id(本仓「宿主 id 沿用原选择件 id」更强);布局-only 契约=只准动 pos/size/组框/颜色/旗标/注释,禁改拓扑/连线/widget 值/prompt(VibeComfy structural-noop 证据与本仓 LINKS-STABLE 对拍同律)。

吸收的做法(落点):
- **双侧钉轨配方**(artokun):入轨=[最左内节点 x−180, 首行 y]、出轨=[最右内节点 x+60, 首行 y]——补强本仓单侧「出口紧邻」判据为两侧都有锚。
- **列内 barycenter 重排**(artokun):同列节点 y 逼近其连线邻居的均值,属 ④ 手法序「挪位置」的具体化,先于垫 Reroute。
- **组框 vs 子图 deliberate choice**(artokun):组框优先(轻量视觉带);2-3 节点的阶段不值得子图化,过度子图化伤可读性与打包交接——制衡「完整功能域收装子图」(收装判据不变:功能域完整才收,不为收而收)。
- **禁擅自大重排**(VibeComfy off/suggest/candidate 治理):布局整理恒显式任务,不做功能编辑的搭车动作;与 1006「手术顺手清残留」不冲突(清残留=删已退役件遗骸,非重排)。
- **对拍证据落盘**(VibeComfy):组框/摆位手术后,对拍结论(逐字节等价+只动 pos/groups)落证据文件,勿只在会话里口头绿。
- **前端扩展 v2 API 指针(含勘正)**(artokun comfyui-frontend-extensions;涉认知章 §1):该技能称 v2 扩展 API 已发布为 npm 包 `@comfyorg/extension-api`(defineNode/defineExtension/defineWidget、typed 事件、Disposable 句柄)——**2026-10-06 npm 三形状实查 404,该包名不存在**(@comfyorg 域现仅 litegraph/sdk 两包),勿按此包名引入;现行可靠路仍是 v1 `app.registerExtension`+`onExecuted` 形(本仓 my_nodes web JS 在用),v2 说法候上游真发布后再考。

## 三真源地图(什么情况读哪个、读到哪节)

| 症状/任务 | 去处 |
| --- | --- |
| 节点图是什么/范式/图论/求值/端口类型 | `.claude/knowledge/node-graph-architecture.md` §1-§4 |
| 自动布局算法原理 | 同上 §5 |
| ComfyUI 内核/旧 React Flow/undo/持久化/错误语义 | 同上 §6-§10 |
| 本项目画布架构/桥/工作流库/迁移 | 同上第二部分 §13-§20 |
| 「改 X 去哪」/不可协商裁定/历史坑 | 同上第三/四/五部分 |
| 布局优先级序与交叉治理(立宪) | `docs/comfyui-kb/画布布局规范-0928.md` |
| 宿主面板不渲染/槽错名/widget 丢失/六同步清单/缓存路径全图 | `docs/comfyui-kb/子图宿主面板排查.md` |
| 子图 linkIds 症状三连/装载机理/收装惯例/蓝图件 | `docs/comfyui-kb/子图工作流工程契约.md` |
| 工作流构建/连线/类型/Subgraph/参数化 | `.agents/skills/comfyui/SKILL.md` 的「Compose a NEW workflow from pieces」「Workflow JSON」「Subgraphs」章 |
| 布局工具三函数 | `.agents/skills/comfyui/workflow_layout.py` |
| 本地捆绑工具(排布+est 口径+立宪检查) | 本技能 `tools/workflow_layout.py`(归因副本)与 `tools/layout_check.py`(立宪口径检查器);配方见「工具调用配方」章 |
| 孤儿节点/节点清单 | `.agents/skills/comfyui/tools/find_orphan_nodes.py` 与 `node_inventory.py` |
| 契约测试锚(布局谓词的测试面) | `apps/backend/engines/comfyui/tests/`(如 test_qwen21_workflow_contract.py) |
| 生产工作流生成器(**1001 起退役勿重跑**=史档)与基线真源 | `apps/build/scripts/`(生成器三件+`workflow_layout_baseline.json` 单源;账见 0928 立宪文档 §三) |

> 路径失效时按文件名在 `docs/comfyui-kb/` 与 `.claude/knowledge/` 下重找(真源改名容错)。

## 工作流 JSON 配置与逻辑(逐字段+执行链,1006 扩写)

> 字段名与取值口径取自本仓生产件实况(逐字段核对过 qi21-道劫-t2i.json,2026-10-06),非凭记忆;与前端新版序列化行为冲突时,以图内 `extra.frontendVersion` 对应版本行为为准并回改本节。

### 术语对照与区分口径(先读:用户问法→JSON 字段)

- **node=节点**:`nodes[]` 一项;宿主节点 type 位=子图 uuid。
- **宿主(host)=主图里代表子图的节点**:type=子图 uuid、`properties.subgraph`=同 uuid;子图机构本体住 `definitions.subgraphs[]`——画布上的子图块=宿主,双击进入的才是定义(逐字段见「子图定义」节)。
- **父图=主图(顶层图)**:用户说「父图」即主图,JSON 无「父图」字面字段;层级链=主图→宿主→子图定义,本仓恒单层(嵌套口径见「节点与工作流认知」§3)。
- **slot=槽,port=端口**:一物两面——JSON 里 `inputs[]`/`outputs[]` 一项=slot,画布上渲染的圆点=port;**port 的标题=slot 的 `name` 字段**。
- **link=连线(输入线)**:`links[]` 一条记录,一条线三处挂接(links 表+源输出槽 `links`+目标输入槽 `link`)。
- **连接参数=一条线登记了什么**:顶层 `links[]` 数组形六元组 `[link_id,src_node,src_slot,dst_node,dst_slot,type]`;子图内对象形 `{id,origin_id,origin_slot,target_id,target_slot,type}`——两制勿混,逐字段见「子图定义」;槽号 0 起算按位索引,读法示例见下「三个号码域」。
- **rail=边界轨**:子图 `sg.inputs`/`sg.outputs` 边界槽表,子图内部连线以 `-10`/`-20` 指向它们。
- **三个号码域不混**:节点 id / 线 id(`link_id`)/ 槽序号(`src_slot`/`dst_slot`,0 起算,**按位索引** `outputs[]`/`inputs[]`)。读法示例:`links` 项 `[218,404,0,6,2,"STRING"]`=「404 的输出槽 0 → 6 的输入槽 2,这条线编号 218」。
- **进出不对称**:输入槽 `link` 是**单值**(最多一条进线,再接=顶替);输出槽 `links` 是**数组**(一出扇出多家)。拆一条线动三处,给一个输出加消费者只动源 `outputs` 一处。
- **同名不同物五例**:节点 `title`≠端口 `name`;端口显示名≠API 输入名(`/object_info` 为准,见认知章 §2);顶层 links 数组形≠子图 links 对象形;输出 **port**≠输出**节点**(OUTPUT_NODE=执行图取件端);**下拉框(控件)≠展示框(只读展示)**——同住 `widgets_values` 的两种物:控件参与计算可退役;展示框 JS 回填只展示,退役类指令默认不及(判例与流程见认知章 §5)。
- **连接状态=某槽接没接线、接线后值归谁**:输入槽看 `link`(null=未接=widget 字面值生效;有值=已接成线),输出槽看 `links[]`(空=暂无消费者);形态细则=下条「widget 槽三态」,删改后的残线/死线纪律=认知章 §1「三处挂接」。
- **widget 槽三态**:`link:null`+widget 在场=字面值生效;`link` 有值+widget 在场=摆设值(面板值≠生效值);宿主提升槽=面板控件(实例值权威=宿主 `widgets_values`,定义级 `sg.widgets` 只是出生缺省)。
- **「输入输出」三层各归各**:①节点槽级(输入/输出 port)②子图边界轨级(`sg.inputs`/`sg.outputs`,-10/-20)③输出节点级(OUTPUT_NODE;graphToPrompt 只保留可达输出节点的子图,见「执行链」)。

**两种格式,何时写哪种**:

- **GUI 格式**(画布加载与「保存」产出):顶层 `nodes`+`links`+`groups`+`definitions`(子图)+发号器+视图状态;写它=给人打开看(桥/引擎侧栏)。本仓生产件真源=GUI 格式(生成器产出,引擎侧栏以 `repo:` id 只读合并消费)。
- **API 格式**(`/prompt` 运行):`{ "<节点id>": { "class_type", "inputs" } }`;写它=headless 跑。**它不是第二份手写真源,是前端 `graphToPrompt` 从 GUI 现转的产物**(转换逻辑见「执行链」);手建图双格式都写(GUI 给画布/桥看,API 给 `/prompt` headless 跑——此纪律出自 comfyui 技能)。

### GUI 格式逐字段(配置层)

顶层字段:

| 字段 | 含义与逻辑 |
| --- | --- |
| `id` | 工作流 uuid(前端标识侧栏/标签) |
| `revision` | 修订计数(前端维护;手写保持现值勿乱动) |
| `last_node_id` / `last_link_id` | **发号器高水位**(新建节点/连线取 next id):手写图必须 ≥ 图内现有最大 id,否则前端新建即撞号 |
| `nodes[]` | 节点表(逐字段见下表) |
| `links[]` | 连线表,每项 `[link_id, src_node, src_slot, dst_node, dst_slot, type]`(数组形六元组按位);节点 `inputs[].link`/`outputs[].links` 挂接这些 id |
| `groups[]` | 组框 `{id,title,bounding:[x,y,w,h],color,flags}`;组框文案住 `title`(画布横幅),非 Note |
| `definitions.subgraphs[]` | 子图定义表(见下小节);无子图的图可整键缺席 |
| `extra` | 前端杂项:`frontendVersion`(序列化格式以其为准)/`ds`(画布视图 scale+offset,保存视口)/插件块 |
| `extensions` | 前端扩展持久化块(如 `seed_widgets`,其内容另在顶层 `seed_widgets` 键双写=前端行为,内容同) |
| `config` / `version` | 图级配置(现恒空)/LiteGraph schema 版本(0.4) |

节点对象(`nodes[]` 每项):

| 字段 | 含义与逻辑 |
| --- | --- |
| `id` | 图内唯一正整数;API 格式以此为键 |
| `type` | 节点类名(须引擎已注册,`/object_info` 可查);**宿主节点此位=子图 uuid** |
| `pos` / `size` | `[x,y]` 浮点画布坐标 / `[w,h]` 渲染尺寸(est 判据原料) |
| `flags` | 节点旗标(如折叠);常态 `{}` |
| `order` | 前端绘制/保存序,**≠执行序**(执行序运行时按拓扑现定,改它不改执行) |
| `mode` | `0`=常规;`2`=静音、`4`=旁路——两者都进不了执行图(见执行链) |
| `inputs[]` | 输入槽 `{name,type,link}`;widget 槽=同名加对象形 `"widget":{"name":槽名}` 且 `link:null`;**连线纯槽形只 name/type/link 三键**(形态语义见「节点与工作流认知」§4) |
| `outputs[]` | 输出槽 `{name,type,links:[link_id…]}`;手建节点漏此键=双向一致性破 |
| `widgets_values` | 按 widget 声明序装值;**宿主只装 widget 槽值**(序=面板控件序);错位/缺占位=实弹红根源(F1 七值形头部空串占位) |
| `widgets_values_named` | 按名寻址镜像(前端 1.53+ 双写);对拍/幂等比较两表都要认 |
| `title` | 画布显示名(规范见 ⑧2;缺省=类名) |
| `properties` | `{"Node name for S&R": 真类名}`(搜索替换/渲染锚);宿主另有 `"subgraph": uuid` |

子图定义(`definitions.subgraphs[]` 每项;契约真源=`docs/comfyui-kb/子图工作流工程契约.md`(linkIds 登记/装载稳定序/收装惯例)+comfyui 技能 Subgraphs 章+契约测试):

- 标量:`id`(uuid;宿主 type 指它)/`name`/`version`(子图 schema 版,现 1)/`revision`/`last_link_id`。
- `state`:前端计数器(lastGroupId/lastNodeId/lastLinkId/lastRerouteId),机器域勿手编。
- `inputs[]`/`outputs[]`:边界槽 `{id:uuid, name, type, linkIds:[…], pos:[x,y]}`——pos=边界槽在子图画布的坐标(输出口最右判据以它为端点;出口 pos 必须与最右节点紧邻,见 ④/认知章 §3)。
- `links[]`:**对象形** `{id, origin_id, origin_slot, target_id, target_slot, type}`(与顶层数组形是两制,勿混写);`origin_id=-10` 取自 `inputs[origin_slot]`、`target_id=-20` 送到 `outputs[target_slot]`(来历见 ④)。
- `inputNode`/`outputNode`:`{id:-10/-20, bounding:[…]}` 元数据(驱动宿主口渲染);**±10/±20 禁入 `nodes[]`**(认知章 §3)。
- `widgets`:定义级 widget 缺省快照(新实例出生缺省);**实例运行值权威=宿主 `widgets_values`**,读值以宿主为准。
- **宿主节点(主图侧)**:主图以一个普通节点代表子图,外部经宿主输入/输出槽接线;`inputs[]` 与 `sg.inputs` 逐项镜像(连线槽=纯三键+活 link,widget 槽=对象形+`link:null`)。实况样例(生产件宿主 [6]):inputs=[正向主体句(纯槽,link15)/型选择(COMBO+widget 对象,link:null)/负向主体句(纯槽,link218)],widgets_values=["人物"]。
- 布局:layout_check 对顶层与每个子图分 scope 独立跑全套判据(scope 名 `sub:<子图名>`)。

### API 格式与连线类型机制

- API 每输入=字面值**或** `["<源节点id>", <输出槽序号>]` 二项引用(槽号=源节点匹配输出的 index,0 起算)。
- **类型必须匹配**(IMAGE/LATENT/MODEL/CLIP/VAE/CONDITIONING/MASK/CONTROL_NET…);缝上类型不同就插转换件:`VAEEncode`(IMAGE→LATENT)、`VAEDecode`(LATENT→IMAGE)、`CLIPTextEncode`(text→CONDITIONING)、`ImageScale`(尺寸)。绝不 IMAGE 直塞 LATENT 输入。
- 节点真实输入输出以 `/object_info/<NodeType>` 实查(`input.required`/`input.optional`/`output`),不猜;API 输入名≠画布显示名(认知章 §2)。

### 执行链(GUI JSON 怎么变成一次跑图;逻辑层)

```mermaid
graph LR
  A["引擎侧栏 repo: 叶子<br/>读②装机包"] --> B["前端装载 GUI JSON<br/>开签=内存副本,改文件须关签重开"]
  B --> C["graphToPrompt 现转 API 格式<br/>剔除 mode2静音/4旁路+剪枝不可达死端"]
  C --> D["POST /prompt"]
  D --> E["validate_prompt<br/>类型/COMBO值域/环检无lazy豁免"]
  E --> F["执行层拓扑跑<br/>lazy 豁免在此层"]
  F --> G["history 取件<br/>ui载荷/showAnything=text/PNG元数据"]
```

- 转换期副作用(披露/审计类的坑):**画布上有什么≠执行图里有什么**——mode 2/4 件与不可达死端在 `graphToPrompt` 就消失(子图内死端被剪枝实据 1002);审计真实加载链走 hidden PROMPT 注入回溯(认知章 §1),勿数画布。
- 验证层环检对 lazy 边不豁免、执行层才豁免(认知章 §2);`/prompt` 不吃 widget 默认值,COMBO 字面值过不了值域校验。
- history 取件键随节点而异(easy showAnything=`text`;自研 OUTPUT_NODE=ui 载荷键);PNG 元数据=提示词三层收据之一。

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
