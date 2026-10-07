"""Qwen-Image-2.1(Q2-1图像)工作流契约测试(09-23 制作;同日深夜扩三件;同日 PRO 件四件;同日装配子图轮改名;同日午道劫直写旧件退役删件;09-24 增 i2i 件;
1004 中文负面+cfg4 役 Phase E 全量重锚)。

1004 重锚总账(Trellis 10-04-chinese-negative-cfg4,Phase A-E):Phase A 数据层
正负拆开(daojie_bases.json 退役并入 qi21_bases.json 集中地,字段 positive/
base_text→positive_text、负面中文化、05 库降级设计规范=A4 头部声明);Phase C
[4013] 换件 MyQi21ChinesePE(drop-in 替 QwenImage21_T2IPromptRewrite,通用 t2i
静态件不换=PE_CLASS_PLUGIN 单列);Phase D 编码器/画幅建议器迁主图([4015]/
[4015N=4016]/[4018];子图六出=positive/negative 改 STRING+wh_ratio/PE启用?)
+加速子图 [7010] cfg4+[7016] 负向档位 Note;[4014] 双口化(9 槽 4 占位
wv 常量已随 1005 拆件退役删除——t2i [4014] 现为 MyQi21FinalOutput 零 widget,
双出进编码正/负向文本);锁层A 参数面与库逐字互锁
废止(改两件横锁 _wf_lock_a+骨架锚);数据↔库②层逐字互锁废止(改数据面
结构锚:统一立绘底座/正向零禁令/中文负面基线/多彩行);i2i/edit 件未同步轮
(Select 仍 7 值旧形,QI21_SG_SEL_WV 保留供其用)。

被测对象 = 仓库真源四件(09-23 午道劫直写旧件 qwen21-daojie 退役删除后;
09-24 增 i2i):
    engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-t2i.json
    engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json
    engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json
    engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json

格式口径(09-23 取舍,引擎 v0.37 直开为最终裁判):三件为**引擎前端格式**
(nodes/links/groups + MarkdownNote + pos 布局),非桥 API 格式
(schemaVersion+graph)——桥格式画布打不开(plugin_manager._is_bridge_template
刻意不进侧栏),而设计要求横向排版/group id/MarkdownNote 使用说明,只有前端
格式能承载;布线语义从官方模板 image_qwen_image_2_1_t2i/image_edit 换算。

09-23 深夜三改造(用户拍板:PE进画布/RGBA要选项/道劫单独适配;其幂等生成器脚本
随 09-23 午道劫直写旧件退役一并删除):
  A. t2i 加「PE 提示词改写组」默认旁路——PE 专用 CLIPLoader
     (qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16,type=qwen_image)→ 插件节点
     QwenImage21_T2IPromptRewrite(类名逐字)→ 核心 ComfySwitchNode(STRING)
     二选一 → TextEncodeQwenImage21.prompt(转换输入)。
  B. t2i 加「RGBA 透明开关」默认普通——双 TextEncodeQwenImage21
     conditioning(普通 vs 官方 RGBA 包裹句式)→ ComfySwitchNode
     (CONDITIONING)二选一 → KSampler.positive。
  C. 新增 daojie 直写件(以改造后 t2i 为骨架,默认直写提示词=道劫水墨国风修仙
     英文长文;DNA:ink wash/expressive brushwork/expansive negative space/
     Chinese cultivation-fantasy;零质量词)——该件 09-23 午定谳被 qi21 件
     完全取代,随本轮退役删除。

09-23 装配子图轮(用户三件令:改名+子图化+底座美化;幂等脚本
apps/build/scripts/qi21_daojie_t2i_0923.py 驱动;前代 qwen21-daojie-t2i-pro.json
与其生成器 qwen21_daojie_pro_0923.py 随本轮退役删除):
  H. 旧 pro 件(九型分层装配平铺版)改名 qi21-道劫-t2i.json 并**子图化**——
     布局学 K2-文生图-道劫.json [90] 组织法:『底座九选一+主体句+通用锁层+
     装配链+PE 组+RGBA 开关』整体收进一个 definitions.subgraphs 子图(宿主
     [40]);外部只剩加载器/分辨率/采样/解码/保存/说明 Note 与外露件
     ([24] 主体句、[27] 装配预览)。子图外露参数:型选择控制(八级选型开关=
     宿主面板 BOOLEAN widget 输入)、主体句([24] PrimitiveStringMultiline,
     仿 K2 [50])、PE 开关/RGBA 开关(宿主面板)、分辨率([4])、seed([7])。
     子图契约(docs/comfyui-kb/子图工作流工程契约.md):groups 必带 int id、
     子图 IO 必须写 inputs[].linkIds/outputs[].linkIds、内部 links 对象格式。
  I. 九型底座常量=05 库②层「09-23 美化版」(《三国望神州》v2.2+手册词汇成文,
     纯画法零物象骨/锁质要点逐项保留/禁自造质感词与质量词);canon-json
     逐字锚废止,型名/顺序仍与 daojie_bases.json 对齐;通用锁层常量A 照旧
     逐字=库首常量(写全条款不动)。真源链:05 库→工作流常量逐字=库→本测试
     库↔工作流互锁(TestQi21SubgraphContract)。

design.md §6 七条对应:TestFilesInPlace(1)/TestLoaderTriple(2)/
TestSamplerContract(3)/TestTopology(4)/TestCanvasDiscipline(5)/
TestEditContract(6)/TestCountAnchor(7);深夜新增 TestCanvasOptions(A+B;
TestDaojieContract(C)随道劫直写旧件 09-23 午退役删除);装配子图轮新增
TestQi21SubgraphContract(H+I,取代旧 TestDaojieProContract)。
其中第 5 条的「新 schema 必需字段(schemaVersion/graph)在位」随格式取舍改为
「前端格式必需字段(nodes/links/groups)在位」——schemaVersion/graph 是桥 API
格式字段,与画布流格式互斥(混写会被侧栏当成画布件解析出错)。

09-23 布局重排轮(用户裁定:子图布局太奇葩、group 泛滥——改「从上到下=阶段
行、行内从左到右」):TestQi21SubgraphContract 新增排版断言——子图恰 4 行=
四阶段(底座常量/选型级联/装配路由/编码输出),行间 y 严格递增且净行距≥100,
行内(数据流序)x 严格递增,主图+子图节点零重叠;group 预算 子图≤2/主图≤3;
真源=生成器 qi21_daojie_t2i_0923.py 布局段(改布局禁手改 json)。

09-23 edit 核心化轮(R16,design §13;真源=幂等生成器
apps/build/scripts/qwen21_edit_core_pe_0923.py,旧 benjiyaya 手术脚本
qwen21_edit_pe_group_0923.py 随本轮退役删除——重跑会倒退回插件链):
  ① PE 链换 comfy-core 五件套(去 benjiyaya):PE CLIPLoader → StringFormat
     {a}{b}{c} 三段 chatml(a=官方 i2i 系统提示词逐字/b=原始用户词/c=
     assistant+<think> 预填)→ TextGenerate(use_default_template=false,
     temp0.7/topK20/topP0.95/minP0.05/repPen1.05/maxLength8192/seed42;
     presence_penalty=1.5 暂保待 A/B)→ RegexExtract(官方正则,dotall)
     → ComfySwitch(false=原始用户词/true=PE,默认 false)。TestEditPEContract
     重写(旧 benjiyaya 断言类目随节点退役)。
  ② QwenImage21Cache(auto)恒挂 UNETLoader→KSampler(既有,断言保留)。
  ③ 多图双通道:BatchImagesNode 合批全部(预缩后)输入图喂
     TextGenerate.image(PE 看全图);TextEncodeQwenImage21 只吃选定图。
  ④ latent 双路:PrimitiveBoolean→ComfySwitch(false=TextEncode.latent 跟随
     image_1/true=EmptyLatent 自定义,默认 false)——旧「禁 EmptyLatentImage」
     断言废止,改锁双路结构(test_latent_dual_path_switch)。
  ⑤ 输入图预缩吸收(research/14 §4-1+15 §4-4,P1 并入 R16):
     ImageScaleToTotalPixels 画布 1.5MP/参考 1.0MP(lanczos·32)。
  ⑥ 节点标题铁律(用户令):核心/第三方节点零自定义 title(本件无自研节点,
     全图无 title;test_no_custom_titles_on_core_nodes)。

0929 加速区并行化轮(Trellis 09-29-qi21-acczone-parallel;方案 B=自研单选择件
MyQi21SpeedSelect,三生成器同笔改造):道劫三件加速区=**三条完整并行支路**(直出
40 步/viggle 359 步/Fun-Acc 4 步,各支路自足 MODEL/steps 零注入)+**单一选择件**
MyQi21SpeedSelect(三 latent 槽全 lazy,check_lazy_status 只拉起选中支路——未选
支路零执行零加载);注入式开关农场全拆(t2i 10 件/i2i·edit 各 13 件:档位/比较/
开关/常量,连 [30] 档位语义一并并入选择件 combo)。断言迁移(design §8 迁移表):
默认档=选择件 combo 首项=直出40步(0929 拉齐重放裁定(用户 12:05);三件一致,与
my_nodes 节点件 DEFAULT_MODE import 互锁);T8 无负面槽/model=base 直连(绝不吃 viggle LoRA)/
positive+latent 同源——保持;新增零真重复节点(0929 复用铁则:同 type+同上游集合+
同 widgets 不得两件)、seed 单源三用(PrimitiveInt 扇出三采样器,T8 seed 输入化=
research/05 §3 实证无例外)、steps 面板=生效值(联动机构拆除,widget 值即执行值)、
懒执行三档干跑(默认直出/档1/档2)。白名单:easy compare 三件零残留出册;
ComfySwitchNode 恒留册(子图 [141][144][157][158]/edit PE 开关 [15]/画幅双路
[20] 在用,t2i 主图恒 0 由拆净断言锁);入册 MyQi21SpeedSelect;LoRA 名白名单
([31] viggle 文件名)不变;Note tokens 随加速区新文案迁移。_assert_fullpower_steps/
_steps_resolved/_off_state_reach 随 steps 联动与 MODEL 开关机构拆除退役;
0928 黑图修复正源语义保持:直出支路 positive=双参考/i2i·edit 加速两支路=单参考
(i2i [40].positive vs positive_single;edit [6] vs [43]),照抄 t2i 统一扇出会复现
黑图——支路正源差异是硬约束(research/03 §1.3)。

纯读文件断言,零网络零引擎依赖(真前端 graphToPrompt 干跑与实弹由 e2e 层
另行验证;0929 起 my_nodes 节点件以 importlib 纯模块加载做档位表互锁,仍零
引擎进程依赖——节点件本身只 import typing)。

2026-10-01 B4 吸收件轮(Trellis 0930 B4 对拍门B absorbIf 成立:通用线三发
J1/J2/J5 全绿+G1 三格同人/G2 左正中侧右背认定):新增第五件
qwen21-sanlian-t2i.json(TE-MAN「一键三视图」形态吸收,只仿设计零拷码)=
b4 对拍直写路九件最小图(b4_duipai_run_0930.py build_graph)的画布化+说明卡
——8 执行节点恰对拍同构(加载器三件套/空潜 1536×512 直给/编码预填三联模板/
KSampler 25步cfg1/解码/保存),外加 [10] MarkdownNote 载 A5 切割警示与
p2_grid_cut.py 切割口;无 ResolutionSelector/PE 组/RGBA 开关(预设件职责
单一,ResolutionSelector 档位零涉=plan §二发1 口径)。TestSanlianContract
最小锚+TestCountAnchor 目录锚 7→8。

1001 S8 深审修复轮三锚(apps/output/s8-code-review-1001/report.md 立案
M-3/M-4/L-8,TestQi21SubgraphContract):M-3 W1收束句工作流侧值锚(键
QI21_SG_SEL_WV["W1收束句"] 曾定义零使用,句身真源=05 库 §一 0930 条主候选句,
_qi21_w1_truth 现读解析,与 RGBA 头/尾句同款断言);M-4 [140] PE 改写器出线
消费者 lazy 谓词(静态可重复:消费者槽在其自研件 INPUT_TYPES 须声明
lazy(True)+实名懒钩子,未来给 [140] 增设非懒消费者必红);L-8 蓝图↔宿主
子图定义一致性锚(definitions.subgraphs[0] 除 id 外 canonical 全等,口径与
qi21_blueprint_sync_1001.py 幂等比较/f929798 同款,漂移即红)。

09-24 i2i 轮(Trellis 09-24-qi21-daojie-i2i;PRD 架构纠正:Q2-1 生修合一,
图输入即指令编辑,零 denoise 重绘):新增第四件 qi21-道劫-i2i.json(2_图生图/
新功能子夹,对标 K2 线 krea2-daojie-i2i.json 同域同式)与 TestI2IContract——
edit 骨架保留(PE-I2I 核心链[15]默认旁路/BatchImages 双通道/latent 双路/双图
预缩 1.5+1.0MP)+qi21 九型装配移植进 [40] 装配子图(MyQi21DaojieBase combo
经宿主面板「型选择」外露默认人物/锁层A 恒挂/RGBA 官方公式;画幅联动行不移植=
画幅随输入图);拼接次序=05 库四层口径(指令占①层位,指令即主体);LoRA 加速
槽出生自带(LoraLoaderModelOnly name 预填 viggle v0.2.1 r256 逐字(0924 换最新口径),MODEL 链开关默认
旁路),TE-Speed 槽禁入本件(节点类型白名单锁,R26.4 统一接线轮补);计数锚
6→7 联动;真源=幂等生成器 apps/build/scripts/qi21_daojie_i2i_0924.py。

09-24 R26.4 统一接线轮(任务三 R26.4;research/16 §八 D1-D5 终审定案):
t2i(qi21)与 edit 两件补 LoRA 加速槽,与 i2i 出生槽三件同构——
LoraLoaderModelOnly[31](name 预填 viggle r64 逐字,strength 0.8=0925 探针最优)+MODEL 开关
[32](false=MODEL 直连/true=LoRA)+开关源 PrimitiveBoolean[30],三件默认关;
qi21 链=[1] UNET→顶通道 Reroute(扇出两臂)→开关→[7] KSampler(t2i 无 Cache),
edit 链=[7] Cache→开关→[8] KSampler(槽插最靠近 KSampler 的 model 入口=
Cache 之后);**硬性 AC=「关闭=正常生成」**(D1 用户令:关态 MODEL 直连,
关态干跑执行图零 LoraLoader——_off_state_reach 断言);edit 件 VAE→VAEDecode
长横穿随迁顶缘 Reroute 通道([28]/[29],样板=t2i/i2i 同款,交叉审计 11=整治前
11 零新增);TE-Speed 槽三件一律不加(3c 试装已死归档,D4 终审永不装)。
新增 TestQi21SubgraphContract/TestEditContract 的 test_lora_slot_present_
and_bypassed(照 TestI2IContract 同款断言式);i2i 件零结构改动(Note 措辞
对齐:关闭=正常生成/shift_terminal=0.02/TE-Speed 归档口径)。

0925 加速与展示全量外露收窄轮(Trellis 09-25-qi21-speed-subgraph;三件生成器
qi21_daojie_t2i_0923/qi21_daojie_i2i_0924/qwen21_edit_core_pe_0923 全量改造):
W1 加速区组框收纳(方案C,主图 group 预算 3→4)/W2 t2i PE 链迁出子图([140]
QwenImage21_T2IPromptRewrite+[141] 提示词开关+画幅联动链 [151]-[158]+总闸
[180] 全迁主画布,PE 位置三件同构=均主画布;**契约冻结项**:PE 开关在主画布+
双路编码在子图(拍板③)⇒ [141]→[40]「提示词」槽回流线在几何上必有且恰 1 条
左向线(link34),test_horizontal_layout_no_vertical_tower 对该线单点豁免并钉
死端点——仿 ad22a9e 契约冻结先例)/W3 [40] 子图收窄=九型+锁层+拼接+RGBA 公式+
双路编码(三行,宿主三 widget 同构 i2i)/W5 负面线=cfg=1 下数学不参与采样、
官方同构占位;PE pp=1.5 定档;[7]/[8] steps 与 [5] 空潜面板值=摆设值注明/
W6 零负区(主图+子图所有节点 pos≥40)+输出口最右(子图输出 IO 槽 x≥全子图
最大 x-50,表示法=K2-文生图-道劫 [90] 实证)→ 新增 TestCanvasNormalization0925
与三生成器自查同口径双记账;qwen21-t2i 静态官方件不适用本轮谓词(坐标原样)。

0926 裁定1 PE 开路含画布本体(用户六裁定轮):qi21 [141]/i2i [15]/edit [15]
PE 开关默认 false→**true**(画布工作流本体默认即 PE 优化,任何人打开 App 跑默认
走 PE;关=直写按图选配)——契约断言同步反转(test_pe_group_and_rgba_switch_
inside_subgraph / test_directive_occupies_subject_layer / test_edit_pe_switch_
wiring / test_all_switches_default_off),组 title 锚「默认旁路」→「默认 PE
开路」(edit/i2i),_resolve_default_string_origins 改=直写选配臂(on_false)
来源核验(默认文本=PE 运行时输出,静态不可逐字);qwen21-t2i.json 静态官方件
不在裁定范围,PE 组仍默认旁路不动。

0926 发现项3 收紧(实测失败修复轮):零负区谓词 pos≥40→**≥80**(三件主画布
本就 min=(80,80) 达标;t2i 子图 [150]=(40,240)/Reroute[171][172] y=40、i2i
子图 [150]=(40,140) 经生成器子图整体归一平移抬到 80——相对布局零变,est
间距/零重叠/行带语义不动;三生成器自查同步收紧,双记账互锁)。

0926 线不遮节点轮(用户令「工作流的美化,你只管位置,不要线与节点彼此遮盖!」):
i2i 件贝塞尔 41 点采样精判存量 13 条真遮挡全数清零(生成器 apps/build/scripts/
qi21_daojie_i2i_0924.py 优先挪位置让跨行长线走净空走廊);唯一结构不可避=i2i
子图 [143]→[144].on_true 横穿同行 [142] → 垫 Reroute[170] 拐点走行2/行3 框间
净空带(拐点不占阶段行,样板=t2i 子图 W/H 通道同款)——test_preview_and_
rgba_formula 的 [144].on_true 溯源断言同步改可穿拐点(直连 origin_id→穿
Reroute 追溯实源);其余 i2i 契约断言零改动(位置自由度本就在生成器自查侧)。
qi21-t2i 件同轮 21 条存量清零(生成器 qi21_daojie_t2i_0923.py 主画布全量重排:
蛇形联动两行/装配横排/PE 带/主链上移/加速区两行+垫脚石 Reroute[190][191][192]
+子图 [175]);契约同步三笔:test_external_wiring 的 MODEL 顶通道两臂与九型
W/H 默认臂元组改经垫脚石(语义接线不变),test_qi21_latent_fed 的 on_false
溯源同改可穿拐点(实源判定,样板=_trace_main_reroute)。

09-23 修复轮注记:脚本层 pytest 曾报「file or directory not found」——本地仓库根
同命令 collect 正常,文件运行期零 cwd 依赖(真源定位走 __file__,json 读取与
rglob 均绝对锚定);根因是执行侧以非仓库根 cwd 解析仓库相对路径,修复=调用侧
改用绝对路径寻址本文件,测试逻辑无改动。

0929 S1 命名批(Trellis 09-29-qi21-canvas-batch;用户令「[40] 标题太长做个稳定
名字」+「选择件名字不要太长表达不出干嘛的」):[40] 宿主 title 三件归一=稳定
短名「[40] 装配子图」(qi21 旧长工程笔记 title 裁短/i2i 旧无 title 补齐),子图
name 不变;三件选择件 title 同名=「出图速度选择」(edit [58] 旧零 title 落名,
被删机制细节住组框③+[10] Note=信息零丢失)。涉锚同批改:test_no_custom_
titles_on_core_nodes(edit)豁免自研 My* 件+正锁 [58] 短名(旧「本件零自研
节点」口径随并行化轮已过时);test_no_custom_titles_except_selfbuilt(i2i)
期望集+ [40] 宿主(type=子图 uuid,t2i 先例);新增 test_s1_naming_batch_0929
铁表逐字锁(宿主短名/子图 name/三件选择件同名)。生成器自查同步(三件短名
正锁;i2i #10 豁免宿主)。

2026-10-01 i2i/edit 同构集成轮(Trellis 10-01-qi21-i2i-edit-isomorphic;手术脚本
apps/build/scripts/qi21_integration_surgery_i2i_1001.py+qi21_integration_surgery_edit_
1001.py,PRD R2 契约锚重立=本文件单点串行):①R2 同名统一三件齐——i2i/edit 宿主
title+子图 name 迁「[40] 提示词类型优化子图(双击进入)」口径(ASSEMBLY_SG_NAME
分叉终结,三件同锚);②i2i=双 Select 链(28→17 节点):[152] Select①「择文合成器」
替原 [15](PE 链吃 -10槽4 裸指令,绝不吃装配全文=防环红线,map §六)→[141]
Assembly(锁层A迁参数面)→[153] Select②「透明包裹器」恒 pe关 替原 [162][163]
[160][161](头尾句迁参数面);Reroute 6 件消化直连;③edit=[15] ComfySwitchNode→
[152] MyQi21PromptSelect(9→9 节点件型升级,透明文本口悬空=无 RGBA 编码件);
④三自研件参数逐字锚(锁层A/头/尾/W1 收束句=库真源,照 t2i M-3 同款);⑤懒声明
+PE 链消费者 lazy 谓词+pe关 干跑(PE 链六件+主图 PE TE 零入集,照 t2i M-4 同款);
⑥_reach_state/_resolve_default_string_origins 增 MyQi21PromptSelect 走臂理解
(直写选配臂=装配全文槽)。

0929 S3 收装轮契约重写(Trellis 09-29-qi21-canvas-batch;用户令「三种情况都
写入自定义加速节点图」+确认「每画布恰两子图=提示词子图+加速子图」;design
D3/D4/D5/D9/D10;research/s3-qi21-daojie-t2i.md/s3-qi21-daojie-i2i.md/
s3-qi21-edit.md 三档;生成器自查谓词=契约单源,全部条款以生成器 verify 为准
重写勿双源漂移):
  A. 道劫三件 definitions.subgraphs 恰 2=[40] 道劫·装配子图(双击进入)+道劫·
     加速子图(新造,uuid 固定值幂等);主图加速块=单宿主节点(MODEL 入/LATENT 出,
     支路机构全在内);宿主 id 沿用原选择件 id(t2i[208]/i2i[190]/edit[58],D3),
     子图内选择件新分配([214]/[192]/[59],规避同号展开形);懒执行语义保持
     (MyQi21SpeedSelect 三 latent 槽全 lazy,S0 探针 A 级实证子图环境生效)。
  B. 宿主面板双控件=「速度档位」COMBO(首项=默认=直出40步,与节点件
     SPEED_MODES import 互锁)+「seed」INT(默认 0 fixed;D5 推荐案落地,
     回退案未启用);widgets_values 与子图 widgets[] 双写同值(宿主=权威值源);
     三态 RGBA 控件(qi21/i2i 宿主面板「RGBA透明」=自动默认;1001 ① 改文案=自动/true/false)随 S2 ⑤机制批
     在位——edit 无 MyQi21DaojieBase/无 RGBA 机构=不适用(research/s3-edit §3)。
  C. 边界槽契约(D4 三件差异如实记):t2i 6 入(model/positive/negative/
     latent/速度档位/seed)/i2i 7 入(+positive_single)/edit 7 入;IO linkIds
     逐项登记(含 widget 型槽,子图工程契约铁律);正源分线(i2i/edit 双参考
     positive vs 单参考 positive_single)经边界槽内聚语义零改动。
  D. 槽位(D10,0929 S4 槽位批已落地):装配子图输出槽序=「预览文本槽=最末」
     (qi21 positive/negative/width/height/最终文本;i2i positive/negative/latent/
     positive_single/prompt;宿主 outputs 同序镜像,-20 边界线/主图 src_slot/
     预览节点位随槽同批迁——qi21 [27]→(3050,2760)/i2i [28]→(5700,1800),主图
     交叉棘轮 16→13/14→12);edit 出生即带 D10 序(positive/negative/latent/
     positive_single,无预览槽=空真满足;若补预览件新槽必须最末,research/s3-edit
     §1 D10 记账)。
  E. id 作用域:主图∩加速子图=∅ 三件断言(执行展开安全);qi21 已知撞号钉死
     (main∩装配={208}=宿主 id 沿用与 S2 内部件 W1[208] 并存;装配∩加速=
     {206,207}=S2 Strip/W1 与加速 KSampler/seed,展开形 40:206 vs 208:206
     互异,生成器 research §二在档);i2i/edit 三域全 ∅。
  F. 作用域机制重写:_reach_state 改 (作用域,id) 双元组遍历(宿主节点按消费
     输出槽下钻子图、-10 边界按名冒泡回主图,面板控件止步);_switch_bool/
     _resolve_default_string_origins 同步穿边界;布局判据随生成器 S3 口径分域
     (恒向右/零负区≥80:t2i/i2i 主图+两子图全域,edit 主图+子图≥0 且子图恒向右
     =S5 终排工序;research/s3-edit §6 口径落账)。涉锚类:TestSpeedSelect
     Contract0929 迁子图版+新增恰两子图/宿主 id 沿用/面板控件/D10 槽序/edit
     新增 TestEditSubgraphContract0929;TestSamplerContract/TestTopology/
     TestCanvasDiscipline/TestEditContract/TestEditPEContract/
     TestQi21SubgraphContract/TestCanvasNormalization0925/TestI2IContract
     涉锚同批改(装配子图内部 S2 形零动,仅作用域与加速域锚随迁)。
"""
from __future__ import annotations

import json
import pathlib
import re

# ── 真源定位 ──────────────────────────────────────────────────────

_TESTS_DIR = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS_DIR.parents[4]  # tests → comfyui → engines → backend → apps → 仓库根
_IMG_DIR = _TESTS_DIR.parent / "workflows" / "1_图片"
T2I = _IMG_DIR / "Q2-1图像" / "1_文生图" / "qwen21-t2i.json"
QI21 = _IMG_DIR / "Q2-1图像" / "1_文生图" / "qi21-道劫-t2i.json"
EDIT = _IMG_DIR / "Q2-1图像" / "2_图生图" / "qi21-edit.json"
I2I = _IMG_DIR / "Q2-1图像" / "2_图生图" / "qi21-道劫-i2i.json"
K2_DIR = _IMG_DIR / "K2图像"
PROMPT_LIB = _REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
# 1004 Phase A 起 daojie_bases.json 退役删件(字段合并进 qi21_bases.json 集中地);
# canon 九型口径改读 qi21_bases.json types 前 9 条(末位第 10 条=「自由」,不入 canon)。
BASES_JSON = (_TESTS_DIR.parents[3] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json")  # 1005 Step4:产品侧退役,测试直读真源家


def _canon_types() -> list[dict]:
    """canon 九型条目(qi21_bases.json types 前 9;自由档=第 10 条不入 canon)。"""
    return json.loads(BASES_JSON.read_text(encoding="utf-8"))["types"][:9]

WORKFLOWS = {"t2i": T2I, "edit": EDIT, "qi21": QI21, "i2i": I2I}
GRAPHS = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in WORKFLOWS.items()}

# 2026-10-01 B4 吸收件(独立于 WORKFLOWS 四键:遍历类不动,专件专锚)
SANLIAN = _IMG_DIR / "Q2-1图像" / "1_文生图" / "qwen21-sanlian-t2i.json"

# 加载器三件套(bf16,MPS 主选;int8_convrot 是 CUDA 路线不用)
UNET_FILE = "qwen_image_2.1_bf16.safetensors"
CLIP_FILE = "qwen3vl_8b_bf16_heretic.safetensors"   # 0924 用户令 TE 换 Heretic 当主力(官方件保留引擎家作备胎)
VAE_FILE = "qwen_image_2.1_vae_bf16.safetensors"

# PE 改写组契约(1004 Phase C 换件:自建中文 PE MyQi21ChinesePE drop-in 替插件
# QwenImage21_T2IPromptRewrite,连线槽名不变(prompt/clip);qi21 件已换件——
# 通用官方件 qwen21-t2i.json 仍持插件原件(静态官方件不动口径)
PE_CLASS = "QwenImage21_T2IPromptRewrite"  # 1005 用户令回官方件(此前 MyQi21ChinesePE)
PE_CLASS_PLUGIN = "QwenImage21_T2IPromptRewrite"  # t2i 通用官方件(未随 1004 换件)
PE_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"
# MyQi21ChinesePE(1004 前插件 QwenImage21_T2IPromptRewrite 同序 drop-in)
# widgets_values 序(节点 INPUT_TYPES 真实字段序):
# [prompt, temperature, top_p, top_k, presence_penalty, max_new_tokens, seed]
PE_PARAMS = [1.0, 0.95, 20, 1.5, 16256, 42]  # [1:7](手改态起尾带 control_after_generate=randomize)
# 1006 API版PE换装(LM Studio 27B)——qi21 [4013] 专用类与 widgets 全序
# (api_url/model/temperature/max_tokens/timeout_sec;教材=qi21_bases.json
# expand_instruction 节热读,节点内补 /no_think+肯定式纪律;服务不在=透传)
QI21_PE_CLASS = "MyQi21ApiPE"
PE_API_PARAMS = ["http://192.168.0.101:1234,http://127.0.0.1:1234", "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-uncensored-mlx", 0.7, 12000, 600, "", ""]  # 末两位=两只展示框位(正向扩写全文/负向扩写清单)  # 1006 批C:正/负向展示框转外部直连槽,不再占 widget 位(7值形→5值形)

# PE-I2I(edit 件)契约:0923-r16 换核心(comfy-core TextGenerate+RegexExtract,
# 去 benjiyaya 依赖;design §13/research/13 官方免插件链照抄;真源=幂等生成器
# apps/build/scripts/qwen21_edit_core_pe_0923.py,旧 benjiyaya 手术脚本随本轮退役)
PE_I2I_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors"
# TextGenerate widgets_values 序(官方件实读 13 项):
# [prompt, max_length, sampling_mode, temperature, top_k, top_p, min_p,
#  repetition_penalty, seed, presence_penalty, thinking,
#  use_default_template, mtp]
# presence_penalty=1.5 暂保(benjiyaya 沿袭值;官方 v2 用 0,待 A/B 裁定后回写)
TG_PARAMS = ["", 8192, "on", 0.7, 20, 0.95, 0.05, 1.05, 42, 1.5, False, False, "auto"]
# RegexExtract 官方正则逐字(对 i2i 三字段 JSON 只抓 rewritten_prompt;dotall 免疫 think)
PE_I2I_REGEX = '"rewritten_prompt"\\s*:\\s*"(.*?)"\\s*,\\s*"wh_ratio"\\s*:'
# chatml 三段锚(a=官方 i2i 系统提示词包裹/b=原始用户词/c=assistant+<think> 预填)
CHATML_A_HEAD = "<|im_start|>system\n"
CHATML_A_TAIL = "\n<|im_end|>\n<|im_start|>user"
CHATML_C = "\n<|im_end|>\n<|im_start|>assistant\n<think>"
B_SEG = ("Put the light blue denim shirt from <image2> on the character "
         "in <image1>, keep everything else unchanged")
# 1003 样例换中国域:edit 件默认指令=道劫中文单图(m1z 实测口径逐字;i2i 仍用 B_SEG)
EDIT_ZH_SEG = ("将<image1>中人物身后的背景改为云雾缭绕的水墨远山,留白取势;"
               "人物本体、服饰、兵器与姿态保持完全不变。")
# edit 件节点 id 锚(与生成器 qwen21_edit_core_pe_0923.py 同表)
EDIT_SCALE_IDS = (16, 17)        # 输入图预缩(画布 1.5MP/参考 1.0MP)
EDIT_PSM_A_ID, EDIT_PSM_B_ID, EDIT_PSM_C_ID = 21, 400, 23  # chatml a/b/c 三段([22]→[400] 1002 ⑫)
EDIT_FMT_ID = 24                 # StringFormat {a}{b}{c}
EDIT_BATCH_ID, EDIT_TG_ID, EDIT_RX_ID, EDIT_PE_SW_ID = 25, 4013, 27, 15  # ⑫:[26]TG→[4013]
EDIT_PBM_ID, EDIT_EL_ID, EDIT_LATENT_SW_ID = 19, 4, 20  # [18]空潜→[4](1002 ⑫)
# 1001 同构集成轮:EDIT_PE_SW_ID=15 随 [15] ComfySwitchNode 退役(指令开关语义
# 并入 [152] MyQi21PromptSelect,常量存照防误用);新锚:
EDIT_SEL_ID = 4014  # MyQi21PromptSelect 最终文本合成器(1001 收编;1002 ⑫ 编号重排)
EDIT_PE_CHAIN_IDS = (21, 23, 24, 25, 4013, 27)  # PE-I2I 链([26]TG→[4013] 1002 ⑫;[4019] PE TE 迁入另锚)
# edit 件 LoRA 槽锚(09-24 R26.4 统一接线;id 同构 i2i=插在 Cache 之后最靠近
# KSampler.model 入口处)+ VAE 顶通道(R26.4 随迁)
EDIT_LORA_PB_ID, EDIT_LORA_ID, EDIT_LORA_SW_ID = 30, 7011, 32  # ⑫:LoRA [31]→[7011]
EDIT_RR_V_A_ID, EDIT_RR_V_B_ID = 28, 29

# RGBA 官方包裹句式(官方模板 Note 双源逐字:0_官方模板/image_qwen_image_2_1_t2i.json
# Note 与 qi21-edit.json Note;0927 勘案修账①:t2i/i2i 件 [160]/[161] 曾持缩写版
# 「This is an RGBA image with transparency./The image has alpha channel…」与官方
# 逐字不符而 title 谎报「逐字=官方模板」,本轮起三件统一官方逐字=下两行;旧
# research/12 答A必改1 所记「短式=正字」系误记,如实注)
RGBA_HEAD = "This is an RGBA format image with transparency."
RGBA_TAIL = "The image has an alpha channel and a transparent background."
RGBA_HEAD_ZH = "这是一张带有透明度的RGBA图像。"
RGBA_TAIL_ZH = "该图像具有alpha通道,背景是透明的。"

# KSampler widgets_values 序:[seed, control, steps, cfg, sampler, scheduler, denoise]
K_SAMPLER_WV = {"seed": 0, "steps": 2, "cfg": 3, "sampler": 4, "scheduler": 5, "denoise": 6}
# TextEncodeQwenImage21 widgets_values 序:[prompt, negative_prompt, resolution]
TE_WV = {"prompt": 0, "negative": 1, "resolution": 2}

# qi21 件结构锚(1001 S8 R7 集成轮裁定A两件链形态;历史:id 与生成器
# qi21_daojie_t2i_0923.py 同表,09-23 总装/09-28 PE迁子图/09-29 机制批各轮沿革)
QI21_HOST_ID = 6  # 1002 ⑫ 大轮:编号重排 [40]→[6](design §1 表)
QI21_SUBJECT_ID, QI21_PREVIEW_ID = 400, 401  # 1002 ⑫:[24]→[400]/[27]→[401](提示词 400 段)
QI21_LATENT_ID, QI21_SAMPLER_ID = 4, 7010  # 1002 ⑫:[5]空潜→[4];[7]直出采样器→加速子图 [7010]
QI21_SG_BASE_ID = 4010                                              # MyQi21DaojieBase 九选一(保留件)
QI21_SG_ASM_ID = 4011                                               # MyQi21PromptAssembly 装配全文件(裁定A上游,id 沿用旧提示词开关)
QI21_SG_SEL_ID = 4014                                               # MyQi21PromptSelect 最终文本合成器(裁定A下游;id 复用画幅链已删件)
# 1004 Phase D(编码器迁出子图):[4015]/[4015N(=4016)] TextEncodeQwenImage21
# 主编码/负向编码迁主图装配块旁;[4018] MyQi21WhSuggest 画幅建议器同批迁出
# ——四件在主图,子图侧防回潮入册 QI21_SG_GONE_IDS;槽接线走 [6] 宿主出口。
QI21_MAIN_TE_ID = 4015        # 主编码 TextEncodeQwenImage21(主图;text←[6].positive)
QI21_NEG_TE_ID = 4016         # 负向编码 [4015N] TextEncodeQwenImage21(主图;text←[6].negative;id 复用 10-02 退役 RGBA 编码号)
QI21_WH_ID = 4018             # MyQi21WhSuggest 画幅建议器(主图;wh_ratio←[6] 槽4)
QI21_ACC_NOTE_ID = 7016       # 加速子图负向生效档位 Note(Phase D D6b)
QI21_SG_PE_RW = 4013                                                # API版PE MyQi21ApiPE(1006 换装;批C 九入全上下文:装配全文槽0←[4011].0)
QI21_SG_TE = QI21_MAIN_TE_ID  # 语义名随迁(10-02 单口化主编码;1004 迁主图)
# 10-02 单口化退役(双编码+输出选择闸门塌缩;防回潮=QI21_SG_GONE_IDS 在册):
#   QI21_SG_TE_RGBA=4016(RGBA编码)/QI21_SG_RGBA_SW=4017(输出选择 SwitchNode)
# 1001 用户测试批(④⑥⑦):[210] MyQi21RgbaSelect 三态件退役——透明布尔唯一来源=
# [150].透明值(型≠自由?rgba_default:面板透明覆盖),纯 BOOLEAN 跨子图边界;
# 常量 QI21_SG_RGBA_SEL 退役,防回潮并入 QI21_SG_GONE_IDS
QI21_SG_NOTE_ID = 4100                     # [140] 输入=装配全文件·装配全文 Note(Q1=B+)
QI21_SG_ASM_CLASS = "MyQi21PromptAssembly"
# 1005 ㊄ 拆双类后本常量语义=「edit/i2i 老架构择文件」(模拟器臂理解+edit 锚+
# 类加载三用途);t2i [4014] 已换 MyQi21FinalOutput(零PE槽,t2i 专用,无臂语义)
QI21_SG_SEL_CLASS = "MyQi21PromptSelect"
QI21_SG_FINAL_CLASS = "MyQi21FinalOutput"  # 1005 ㊄ t2i [4014]=最终输出件锚
QI21_SG_WH_CLASS = "MyQi21WhSuggest"
# [141]/[152] widgets_values 位序(接口面契约;1002 ⑭ 槽序重排后 widget 子序
# **不变**(连线槽前置不占 widget 位;主体句/锁层A 与 pe开关/透明模式/头/尾/W1
# 相对序保持),位序锚继续有效;连线槽位迁移=research/slot-map.md)
QI21_SG_ASM_WV = {"主体句": 0, "锁层A全文": 1}
# 1002 修复轮(实弹 probe 坐实):前端为全部参数型输入(含连线中的装配全文/
# PE出文 STRING 槽)建 widget 并按全序消费 widgets_values——两连线槽吃掉前 2 值
# 致整体后移错位(装载后 RGBA官方头句←W1 值;i2i [153] pe开关←头句串,执行级)。
# 修法=wv 头部 2 空串占位(7 值形);占位恒空串(防未接线 PE出文 误用占位文本)。
QI21_SG_SEL_WV = {"装配全文占位": 0, "PE出文占位": 1, "pe开关": 2, "透明模式": 3,
                  "RGBA官方头句": 4, "RGBA官方尾句": 5, "W1收束句": 6}
# 1001 S8 R7 集成退役件(子图 28→10;防回潮):装配拼接7[130][131]+RGBA拼②[162][163]
# +常量4[110][160][161][215]+剥离[206]+W1三拼[216][207][208]+透明文本开关[209]
# +提示词开关(旧141,由装配全文件沿用)+画幅链6[153]-[158](152/151 由新件沿用/复用)
QI21_SG_GONE_IDS = [110, 130, 131, 160, 161, 162, 163, 206, 207, 208, 209,
                    215, 216, 153, 154, 155, 156, 157, 158,
                    210,  # +[210] 三态件(1001 用户测试批 ④⑥⑦:透明布尔唯一来源=[150].透明值)
                    # +10-02 单口化(双编码+闸门塌缩):[4016] RGBA编码+[4017] 输出选择
                    # (1004 注:[4016] 号已复用为主图负向编码器 [4015N],子图侧仍禁)
                    4016, 4017,
                    # +1004 Phase D(编码器/画幅建议器迁出子图,子图侧防回潮):
                    4015, 4018]
RGBA_MODES_TRIPLECT = ("自动", "true", "false")  # 1001 ① 改文案三串(「自动」=原「跟随型」;combo 真源=my_nodes 节点件)
# qi21 件 LoRA 槽锚(09-24 R26.4 补槽,id 同构 i2i;t2i 无 Cache——MODEL 上游
# 穿顶通道 Reroute 溯至 UNETLoader[1])
QI21_LORA_PB_ID, QI21_LORA_ID, QI21_LORA_SW_ID = 30, 7011, 32  # ⑫:LoRA [31]→[7011]
QI21_RR_M8A_ID, QI21_RR_M8B_ID = 20, 21   # MODEL 顶通道(R26.4 起扇出直连/LoRA 两臂)
# 0926 线不遮节点轮垫脚石(生成器同表;语义接线不变,溯源按实源判定)
QI21_RR_M8C_ID = 190                       # MODEL 顶通道垂降拐点(历史锚,件已不在图)
# 1001 S8 集成轮:子图内全部 Reroute 垫脚石历史锚(176/204/205/211-213)随
# Part-A S3B 删中继+S8 删 22 件全体退役——溯源常量废除,防回潮由
# QI21_SG_GONE_IDS 与 Reroute 恰零断言把守
# 0928 残留清创轮(照 i2i/edit 删踏脚石直连轮判据「删后交叉与线遮双不增」):t2i 主图
# 四枚删件直连([22]/[23] VAE 顶通道对→[3]→[8] 直连 link10/[199] [5]→T8 垫脚石→
# link65 直连/[202] 顶带首拐→[40]→[203] 直连 link70);[203] 实测保留(单删交叉
# 26→32(+6),与 [202] 整对删仍 +5=有真实治理功用);主图交叉实测 26 持平
QI21_RR_M10A_ID, QI21_RR_M10B_ID = 22, 23   # VAE 顶通道(历史锚,清创轮删件直连)
QI21_RR_LAT_ID = 199                        # [5]→T8 垫脚石(历史锚,清创轮删件直连)
QI21_RR_POS_A_ID = 202                      # [40].positive→T8 顶带首拐(历史锚,清创轮删件直连)
QI21_RR_POS_B_ID = 203                      # [40].positive→T8 顶带拐点(历史锚;0929 并行化轮
#                                            随正源直连拆除,gone_ids 在册防回潮)
# 0929 用户手改回灌(生成器同表):子图两枚 Reroute 删了重加成新 id(位置/接线同位);
# 宿主外露输入槽 8→4(四控件回面板);[30] 默认档 2→11 与 [179] 常量 6→359 两口径
# 已随 0929 并行化轮([30]/[179] 拆除)终结——档位语义并入选择件 combo 首项
# (0929 拉齐重放后首项=直出40步);204/205 两拐点随 Part-A S3B 删中继退役(锚废除)
# 1005 重锚:宿主恰 4 槽=正向主体句/负向主体句(纯连线槽)+型选择/PE启用?(widget
# 面板控件);clip/vae 槽随 PE TE 迁子图 [4019]+编码器迁主图退役,外露连线槽=两主体句
# 1006 批C 正名(grill Q2=改):外部槽 正向主体句/负向主体句→正向提示词/负向提示词
# (边界+宿主+[400]/[404]+[4013] 外部直连槽同名族联动)
QI21_HOST_EXPOSED_INPUTS = ["正向提示词", "负向提示词"]

# i2i 件结构锚(09-24 新增;id 与生成器 qi21_daojie_i2i_0924.py 同表——主图 id 承
# edit 骨架同表,装配子图 id 承 t2i 装配段;[6] 编码收进子图=[142],[27] 在主图
# 是 RegexExtract 故预览用新 id [28])
I2I_HOST_ID = 6
I2I_PREVIEW_ID, I2I_NOTE_ID = 401, 402
I2I_SAMPLER_ID, I2I_CACHE_ID = 7010, 9
# 0928 PE 迁子图轮:PE-I2I 七件链收进 [40] 子图(id 随迁);[15]=指令开关在子图内,
# switch 经 -10 槽7 宿主面板「PE开关」(默认 true=0926 裁定1);主图零 PE 件
I2I_PE_SW_ID = 15                 # PE-I2I 指令开关(0928 迁入 [40] 子图)
I2I_PE_CLIP_ID = 4019  # 1002 ⑬:迁入装配子图               # PE 专属 TE(主图加载器行,经宿主 pe_clip 槽一进线)
I2I_PE_A_ID, I2I_PE_C_ID, I2I_PE_FMT_ID = 21, 23, 24   # chatml a/c 段+拼装(子图)
I2I_SG_SLOT_PE_EN = 6    # 宿主面板「PE启用?」槽位(1002 ㉑;PE开关/pe_clip 槽撤)
I2I_PSM_B_ID = 400                 # 原始用户词/指令(①层唯一手写位,主图)
I2I_BATCH_ID, I2I_TG_ID, I2I_RX_ID = 25, 4013, 27
I2I_SCALE_IDS = (16, 17)          # 输入图预缩(画布 1.5MP/参考 1.0MP)
I2I_LATENT_PB_ID, I2I_EL_ID, I2I_LATENT_SW_ID = 19, 4, 20
I2I_LORA_PB_ID, I2I_LORA_ID, I2I_LORA_SW_ID = 30, 7011, 32  # ⑫:LoRA [31]→[7011]
# 1001 同构集成轮锚(手术脚本 qi21_integration_surgery_i2i_1001.py map §5.1 同表;
# 旧件锚退役:[15]指令开关/[110]锁层A/[130][131]装配拼接/[160][161]RGBA头尾/
# [162][163]RGBA拼②/Reroute[170][174][181]-[184]——全数收编三自研件+直连):
I2I_SG_ASM_ID = 4011     # MyQi21PromptAssembly 装配全文件(锁层A迁参数面 wv[1])
I2I_SG_SEL1_ID = 4014    # MyQi21PromptSelect 择文合成器①(替 [15];择文上位喂装配)
I2I_SG_SEL2_ID = 153    # MyQi21PromptSelect 透明包裹器②(替 [162][163]等四件;恒pe关)
I2I_SG_ASM_CLASS = "MyQi21PromptAssembly"
I2I_SG_SEL_CLASS = "MyQi21PromptSelect"
I2I_SG_ASM_WV = {"主体句": 0, "锁层A全文": 1}   # [141] 参数位序(同 t2i 件)
I2I_SG_GONE_IDS = [15, 110, 130, 131, 160, 161, 162, 163,   # 收编 8 件
                   170, 174, 181, 182, 183, 184,             # Reroute 消化 6 件
                   # 10-02 单口化(双编码+双闸门塌缩,四件):
                   4016, 4017, 172, 173]
I2I_PE_CHAIN_IDS = (21, 23, 24, 25, 4013, 27)  # PE-I2I 链([26]TG→[4013] 1002 ⑫)
I2I_SG_BASE_ID = 4010
I2I_SG_TE = 4015  # 主编码·单编码独挑(10-02 单口化)
# 10-02 单口化退役(防回潮=I2I_SG_GONE_IDS 在册):
#   I2I_SG_TE_RGBA=4016(RGBA编码)/I2I_SG_RGBA_SW=4017(主路输出选择闸门)
I2I_SG_RGBA_SEL = 180                    # 0929 S2 D6:MyQi21RgbaSelect 三态件
# LoRA 加速槽(09-24 R26.4 三件统一接线:t2i/edit 补槽与 i2i 出生槽同构;
# viggle 蒸馏件已装机(r64 事实=R23 research/02;v0.2→v0.2.1=0924 用户「有最新换最新+清旧」令)——name 预填逐字锚
LORA_FILE = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"
I2I_LORA_FILE = LORA_FILE
# 指令①层默认=官方换装例句(edit 生成器口径逐字)
I2I_B_SEG = ("Put the light blue denim shirt from <image2> on the character "
             "in <image1>, keep everything else unchanged")
# i2i 件全图节点类型白名单(TE-Speed 槽禁入=R26.4 统一接线轮再补;任何未知类型即红)
# 1001 同构集成轮:StringConstant/StringConcatenate 出册(收编三自研件后全图零件,
# 回潮即红);MyQi21PromptAssembly/MyQi21PromptSelect 入册(手术新立三件)
I2I_NODE_TYPE_WHITELIST = {
    "UNETLoader", "CLIPLoader", "VAELoader", "LoadImage",
    "ImageScaleToTotalPixels", "QwenImage21Cache", "LoraLoaderModelOnly",
    "PrimitiveBoolean", "PrimitiveInt", "ComfySwitchNode", "KSampler", "VAEDecode",
    "SaveImage", "PrimitiveStringMultiline", "StringFormat", "BatchImagesNode",
    "TextGenerate", "RegexExtract", "MarkdownNote", "easy showAnything",
    "Reroute", "EmptyLatentImage",
    "MyQi21DaojieBase", "TextEncodeQwenImage21",
    "MyQi21PromptAssembly", "MyQi21PromptSelect",
    # 0927 三档轮:T8 Fun-Acc 采样器(easy compare 随 0929 并行化零残留出册);
    # 0929 并行化轮:自研选择件入册;0929 S2 ⑤机制批:自研三态件入册
    "T8QwenImage21FunAccPDD4Step", "MyQi21SpeedSelect", "MyQi21RgbaSelect",
    # 1002 衔接批㉕:SeedVR2 放大尾档四件组入册(主图输出区;SaveImage 已在册)
    "SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler",
}
# 人物系六型(库 §二:常量B 加挂型)
PRO_CHAR_TYPES = ("人物", "美宣", "多视图", "高清人脸", "分镜剧情图", "表情差分")  # 0927 改名轮:三视图→多视图
# ④配色行映射(库 §一映射表)
PRO_COLOR_MAP = {
    "人物": "人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。",
    "场景": "场景设色配比：大面积淡墨、青灰为稳定基底，青绿、赭石、旧金多色相铺陈各安其位。",
    "道具": "道具设色配比：大面积淡墨为稳定基底，旧金、玉青、赭石为中等强度器物色，朱红为少量高识别强调色。",
    "美宣": "人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。",
    "多视图": "人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。",
    "高清人脸": "人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。",
    "分镜剧情图": "人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。",
    "表情差分": "人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。",
    "概念气氛图": "概念气氛设色配比：大面积淡墨、青灰为稳定基底，青绿、赭石、淡朱二到三色相作焦点色。",
}
# 宿主面板 widget 型子图输入(1005 重锚:恰 2 控件=型选择/PE启用?;提示词正/负=
# 纯连线槽,「透明/手动宽/手动高」随 1005 用户精简退役——透明自动跟型 rgba_default)
QI21_HOST_WIDGET_INPUTS = [
    "型选择",
]  # 1006 四轮:恰 1 控件(PE启用? 随 AI扩写恒开退役;提示词正/负=纯连线槽)
# 0928 PE 迁子图轮:画幅联动总闸[180] 退役为宿主面板 widget;冻结回流线 link34
# 随架构消灭(主图左向线恒 0,豁免不再存在);PE/联动件全数迁入 [40] 子图(id 承袭)
QI21_BASES_JSON = (_TESTS_DIR.parents[3] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json")  # 1005 Step4:产品侧退役,测试直读真源家
# 蓝图真源(1001 S8 深审 L-8 落锚用):S5 术后宿主定义id=实例uuid 与蓝图恒定id
# 分轨;同步钦定通道=apps/build/scripts/qi21_blueprint_sync_1001.py,幂等口径=
# 除 id 外 canonical 全等(见 test_blueprint_definition_matches_host_subgraph)
QI21_BLUEPRINT = _TESTS_DIR.parent / "my_nodes/subgraphs/qi21-提示词类型优化子图.json"


def _nodes(graph: dict) -> dict:
    return {n["id"]: n for n in graph["nodes"]}


def _by_type(graph: dict, class_type: str) -> list[dict]:
    return [n for n in graph["nodes"] if n.get("type") == class_type]


def _widget(node: dict, index: int):
    return node["widgets_values"][index]


def _links(graph: dict) -> dict:
    return {link[0]: link for link in graph["links"]}


# (_trace_main_reroute/_slot_origin/_assert_seed_input_wired 随 0929 S3 收装退役:
#  主图扁平溯源器无调用点——加速域 seed/正源/model 溯源改 -10 边界槽断言入
#  _assert_accel_subgraph(比穿 Reroute 溯源更强的域内直证);VAE 顶通道断言
#  按 TestEditContract 直接核端点)


# (_off_state_reach 随 0929 并行化轮退役:加速槽「关态」语义并入三档干跑——
#  默认档=直出40步 即零 LoRA 态,断言移交 _assert_accel_subgraph)


# ── 0929 加速区并行化轮(Trellis 09-29-qi21-acczone-parallel;方案 B=MyQi21SpeedSelect)──
# 注入式开关农场三件全拆(旧 id 锚存照退役:t2i 10 件=[30][32][177][178][179][193]
# [194][195][196][197](+[203] 垫脚石)/i2i 13 件=[30][32][164][165][166][171][172]
# [173][174][183][184][185](+[186]-[188] 垫脚石)/edit 13 件=[30][32][33][34][35]
# [38][39][40][41][42][50][51]);档位语义并入选择件 combo,steps 回归支路 widget。
# 0929 S3 收装轮(Trellis 09-29-qi21-canvas-batch D3/D4/D5):支路机构整体迁入
# 新造「道劫·加速子图」(三件 uuid 固定值幂等);支路件 id 随迁=子图独立 id 空间;
# 原主图选择件 id 原位改造=宿主(D3 id 沿用),子图内选择件新分配(让位防同号
# 展开形,生成器同表):
QI21_SAMPLER_VIG_ID, QI21_SEED_ID = 7012, 7014         # 1002 ⑫:viggle 采样器/seed 单源
I2I_SAMPLER_VIG_ID, I2I_SEED_ID = 7012, 7014
EDIT_SAMPLER_VIG_ID, EDIT_SEED_ID = 7012, 7014
QI21_T8, I2I_T8, EDIT_T8 = 7013, 7013, 7013  # 1002 ⑫:三件 T8 支路统一 [7013]
QI21_XHOST_ID, QI21_XSEL_ID = 7, 7015      # 1002 ⑫:宿主 [208]→[7]/选择件 [214]→[7015]
I2I_XHOST_ID, I2I_XSEL_ID = 7, 7015
EDIT_XHOST_ID, EDIT_XSEL_ID = 7, 7015
# 1001 R2 同名统一:i2i/edit 手术随批更名,三件齐「[40] 提示词类型优化子图(双击
# 进入)」——ASSEMBLY_SG_NAME 分叉终结,两常量同值存照(旧名常量防别处引用断)
ASSEMBLY_SG_NAME = "[6] 文本提示词类型优化子图"  # 1002 ⑬ 更名
ASSEMBLY_SG_NAME_T2I = "[6] 文本提示词类型优化子图"  # 1002 ⑬ 更名
ACCEL_SG_NAME = "道劫·加速子图"
QI21_XSG_UUID = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"
I2I_XSG_UUID = "b3f5a1c2-9d4e-4f60-8a7b-5c6d7e8f9a0b"
EDIT_XSG_UUID = "7b1f3a92-2b5c-4d3e-8f41-6c8d9e0f1a02"
# 宿主面板控件名(=子图 widget 型 -10 槽,值序↔宿主 widgets_values;生成器
# WIDGET_INPUTS/ACCEL_WIDGET_INPUTS 同表——面板控件名即契约):
ACCEL_PANEL_CONTROLS = ["速度档位", "seed"]              # 三件加速宿主面板双控件
ASSEMBLY_PANEL_CONTROLS = {
    # 1001 用户测试批 Q3 序;1002 ㉑:三件「PE开关」槽撤→[4012] PrimitiveBoolean
    # 「PE启用?」外露(seed 手法=-10 widget 槽+子图内 Primitive 单源扇出)
    # 1005 ㊄ 终态重锚:提示词正/负=纯连线槽(非 widget,不入 widgets_values),
    # 透明/手动宽/高退役(透明自动跟型 rgba_default);面板 widget 恰两控
    "qi21": ["型选择", "PE启用?"],
    "i2i": ["指令", "型选择", "PE启用?", "RGBA透明"],
    "edit": ["指令", "PE启用?"],                         # edit 无型库/无 RGBA 机构(S2 D6/D7 域外)
}
SPEED_SELECT_CLASS = "MyQi21SpeedSelect"
STEPS_DIRECT, STEPS_VIGGLE = 40, 6     # 1002 考据轮:viggle=官方模型卡荐 6 步(旧 359 系历史值)
# D10 预览文本槽=最末(0929 S4 槽位批已落地):qi21=最终文本/i2i=prompt 均=最末槽
# (节点最底);S3 现值锁(最终文本/prompt=槽2)随 S4 翻锚退役(implement.md S4
# 「契约锚同步」,design D10 三件通用规则;edit 无预览槽=空真)。
D10_PREVIEW_SLOT_LAST = True
# 0928 黑图修复:单参考编码锚保持(edit 主图 [43];i2i 子图行4 [171]-[173] 独立 id 空间)
I2I_SG_TE1 = 171  # 单参考编码·单编码独挑 positive_single(10-02 单口化)
# 10-02 单口化退役:I2I_SG_TE1R=172(透明单图编码)/I2I_SG_TE1SW=173(单图闸门)
EDIT_TE1 = 4016  # 1002 ⑫:edit 单参考编码 [43]→[4016]
FUNACC_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"
T8_CLASS = "T8QwenImage21FunAccPDD4Step"
# 档位表真源=my_nodes 节点件 importlib 纯模块互锁(design §4:combo 列表即契约,
# /prompt 闭集硬校验,不在列表=HTTP 400;节点件零引擎依赖只 import typing):
# 1002 ⑱:FUNACC 提首=默认(用户新令「默认是 Fun-Acc 加速」推翻 0929 拉齐重放
# 裁定;档号随新序理顺=序位号 0/1/2,旧串→新串映射=任务档 research/slot-map.md
# §5),三画布 widgets_values 必=DEFAULT_MODE(工作流迁移波次落地)。
import importlib.util as _ilu

_spec = _ilu.spec_from_file_location(
    "my_qi21_speed_select_contract_interlock",
    _TESTS_DIR.parent / "my_nodes" / "nodes" / "my_qi21_speed_select.py")
_speed_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_speed_mod)
SPEED_MODES = _speed_mod.SPEED_MODES
DEFAULT_MODE = _speed_mod.DEFAULT_MODE
SPEED_SLOT_OF = dict(SPEED_MODES)
# 档位串按槽名反查(1002 ⑭⑱ 起 combo 序=FunAcc/Direct/viggle,旧位置解包
# (MODE_DIRECT, MODE_FUNACC, MODE_VIGGLE=…) 会错位拿串——语义名恒按槽锚定)
MODE_FUNACC = next(m for m, s in SPEED_MODES if s == "latent_funacc")
MODE_DIRECT = next(m for m, s in SPEED_MODES if s == "latent_direct")
MODE_VIGGLE = next(m for m, s in SPEED_MODES if s == "latent_viggle")
# 1002 R2 修复轮(F3):edit 件默认档回退直出40步——Fun-Acc×edit 实弹两独立
# seed(3008/3009)均全透空白图(1.58M 像素全透 33KB,status=success 静默坏图;
# 同拓扑 viggle seed3010/直出40步 seed3011 均绿)=Fun-Acc PDD 系 t2i 描述文
# 蒸馏头,对 edit 指令式改图文本分布外崩溃,档位结构性白图(节点/接线层不可
# 修);⑱「i2i/edit 默认档同改 Fun-Acc」之 edit 推广就此回退(⑱ 用户原令只点
# t2i=my_qi21_speed_select.py:32 引文;t2i/i2i 默认仍=DEFAULT_MODE,实弹绿:
# t2i 四发/s7 i2i 127s opaque)。edit 件 0 档保留可选(手动自担,Note 白图警示)。
# ── 1003 翻案轮(Trellis 10-03-edit-fun-acc-4-pe,用户令「如果可以用 Fun-Acc
# 4 步就用」):死因精确定位=PE 关×Fun-Acc(指令直写撞蒸馏头分布);PE开×
# Fun-Acc=m1z 真图(道劫中文素材 250s vs 直出40 514s,m2z 中文复现白图 33KB)。
# edit 默认档=MODE_FUNACC(PE 默认本就开=文件原值),危险组合改述「关PE×FunAcc」。
EDIT_DEFAULT_MODE = MODE_FUNACC
# 0929 并行化 Note 加速区段共用 tokens(三件 Note 均含;文案真源=三生成器 NOTE 段;
# 0929 S3 收装轮随双子图文案刷新)
PARALLEL_NOTE_CORE_TOKENS = (
    "check_lazy_status", "用户手动权威", "懒执行", "绝不吃 viggle LoRA",
    "无负面槽", "依赖警示", "生态插件区", "Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8",
    T8_CLASS, FUNACC_FILE, "降级", "shift_terminal=0.02", "TE-Speed",
)
# qi21 件 Note 加速区段(0929 S3 双子图文案;[214]=子图内选择件/[208]=加速宿主;
# 1002 ⑱ 默认档 token 随档序重排改 Fun-Acc,Note 文案随工作流迁移波次同步)
QI21_PARALLEL_NOTE_TOKENS = (
    *PARALLEL_NOTE_CORE_TOKENS, "MyQi21SpeedSelect", "[7]", "[7015]", "[7012]", "[7014]",
    "首项=默认", "默认=Fun-Acc 4步", "seed 单源", "真实生效", "并行三支路",
    "速度档位", "双子图",
)
# i2i 件 Note 加速区段(0929 S3 收装;i2i 家风=选择件/seed 以名示人不带 id 号,
# 仅支路采样器 [189] 带 id;宿主 [190])
I2I_PARALLEL_NOTE_TOKENS = (
    *PARALLEL_NOTE_CORE_TOKENS, "MyQi21SpeedSelect", "[7]", "[7012]",
    "首项=默认=「0 · Fun-Acc 4步」", "seed 单源", "零摆设值", "复用铁则", "分线直入",
    "单参考正源", "崩纯黑", "唯一色=1", "positive_single", "[173]", "零改动",
    "速度档位", "加速子图",
)
# edit 件 Note 加速区段(0929 S3 收装;[58]=宿主/[59]=子图内选择件/[57]=seed;
# 1002 R2 修复轮:默认档 token 改「本件默认=直出40步」+白图警示锁在场——F3
# Fun-Acc×edit 两 seed 全透空白,默认档回退,0 档保留可选但 Note 点名勿用)
EDIT_PARALLEL_NOTE_TOKENS = (
    *PARALLEL_NOTE_CORE_TOKENS, "MyQi21SpeedSelect", "[7]", "[7015]", "[7012]", "[7014]",
    "首项", "本件默认=「0 · Fun-Acc 4步」", "须配 PE启用?=开", "Fun-Acc×edit 白图警示",
    "用 Fun-Acc 必开 PE",
    "一处改三支路同步", "面板值=生效值",
    "单参考正源", "崩纯黑", "唯一色=1", "[4016]", "零改动",
    "速度档位", "加速子图",
)


# ── 0929 S3 作用域机制(双子图后三域 id 非全局唯一——qi21 装配∩加速={206,207}
#    在档;一切定位按 (作用域, id):作用域=None 主图,否则子图 uuid)───────────

def _sgs(graph: dict) -> list[dict]:
    return graph.get("definitions", {}).get("subgraphs", [])


def _sg_by_name(graph: dict, needle: str) -> dict:
    hits = [sg for sg in _sgs(graph) if needle in sg["name"]]
    assert len(hits) == 1, \
        f"应恰 1 个名含 {needle!r} 的子图,得 {[sg['name'] for sg in _sgs(graph)]}"
    return hits[0]


def _asg(graph: dict) -> dict:
    """[40] 装配子图(0929 S3 D9:三件齐——edit 装配段收装出生即子图)。
    1001 R2 同名统一:三件齐「提示词类型优化子图」(t2i S1 先行,i2i/edit
    同构手术随批);按图内实存名自适应锚定(needle 兜底旧名=容旧档读入)。"""
    names = [sg["name"] for sg in _sgs(graph)]
    needle = ("提示词类型优化子图"
              if any("提示词类型优化子图" in n for n in names) else "装配子图")
    return _sg_by_name(graph, needle)


def _xsg(graph: dict) -> dict:
    """道劫·加速子图(0929 S3 D3 新造)。"""
    return _sg_by_name(graph, "加速子图")


def _sg_nodes(sg: dict) -> dict:
    return {n["id"]: n for n in sg["nodes"]}


def _sg_links(sg: dict) -> dict:
    return {l["id"]: l for l in sg["links"]}


def _host_of(graph: dict, sg: dict) -> dict:
    host = next((n for n in graph["nodes"]
                 if n.get("properties", {}).get("subgraph") == sg["id"]), None)
    assert host is not None, f"子图 {sg['name']!r} 缺宿主节点(properties.subgraph)"
    return host


def _panel_value(graph: dict, sg: dict, control: str):
    """宿主面板控件值(0929 机制:宿主 widgets_values ↔ 子图 widget 型 -10 槽
    同序双写,宿主=权威值源;控件名真源=生成器 WIDGET_INPUTS/ACCEL_WIDGET_INPUTS,
    本测试 ACCEL_PANEL_CONTROLS/ASSEMBLY_PANEL_CONTROLS 同表互锁)。"""
    wf_name = next(k for k, g in GRAPHS.items() if g is graph)
    controls = (ACCEL_PANEL_CONTROLS if sg["name"] == ACCEL_SG_NAME
                else ASSEMBLY_PANEL_CONTROLS[wf_name])
    assert control in controls, \
        f"{wf_name} 面板控件 {control!r} 不在契约控件表 {controls}"
    wvs = _host_of(graph, sg)["widgets_values"]
    idx = controls.index(control)
    return wvs[idx] if idx < len(wvs) else None  # 2005 用户精简控件面


def _switch_bool(graph: dict, sg: dict | None, nodes: dict, links: dict, node: dict) -> bool:
    """ComfySwitchNode 有效布尔(0929 S3 作用域版):switch 槽连线→-10 边界面板
    控件(按名冒泡宿主 widgets_values,如装配子图 [141]/[157] PE开关/画幅联动)
    或同域 PrimitiveBoolean 源(可穿 Reroute,如主图画幅 [19]);否则本件 widget
    (如 [144] RGBA 开关 switch←MyQi21RgbaSelect 节点输出——运行时值,静态落回
    自身默认 false=自动+非四型口径,与生成器三态默认一致)。"""
    lid = node["inputs"][2].get("link")
    if lid is not None and lid in links:
        l = links[lid]
        if sg is not None and l["origin_id"] == -10:
            return bool(_panel_value(graph, sg, sg["inputs"][l["origin_slot"]]["name"]))
        oid = l[1] if isinstance(l, list) else l["origin_id"]
        if oid in nodes:
            src = nodes[oid]
            while src["type"] == "Reroute":
                rl = links[src["inputs"][0]["link"]]
                src = nodes[rl[1] if isinstance(rl, list) else rl["origin_id"]]
            if src["type"] == "PrimitiveBoolean":
                # 1002 ㉑ seed 手法:[4012]『PE启用?』value 槽接 -10 面板槽——
                # 执行真值=面板投影(节点自身 wv=未连线兜底,非权威);冒泡面板值
                vin = next((i for i in src.get("inputs", [])
                            if i.get("name") == "value"), None)
                if vin is not None and vin.get("link") is not None:
                    vl = links[vin["link"]]
                    v_oid = vl[1] if isinstance(vl, list) else vl["origin_id"]
                    if v_oid == -10:
                        v_slot = (vl[2] if isinstance(vl, list) else vl["origin_slot"])
                        return bool(_panel_value(
                            graph, sg, sg["inputs"][v_slot]["name"]))
                return bool(src["widgets_values"][0])
    return bool(node["widgets_values"][0])


def _select_pe_on(graph: dict, sg: dict | None, nodes: dict, links: dict,
                  node: dict) -> bool:
    """MyQi21PromptSelect pe开关 有效布尔(1001 同构集成轮;家法同 _switch_bool):
    pe开关槽(inputs[0],名寻址)连线→-10 边界面板控件(按名冒泡宿主 widgets_values)
    或同域 PrimitiveBoolean 源(可穿 Reroute);否则本件 widget(wv[0],如 i2i [153]
    恒 pe关=纯包裹器)。"""
    inp = next(i for i in node["inputs"] if i.get("name") == "pe开关")
    lid = inp.get("link")
    if lid is not None and lid in links:
        l = links[lid]
        if sg is not None and l["origin_id"] == -10:
            return bool(_panel_value(graph, sg, sg["inputs"][l["origin_slot"]]["name"]))
        oid = l[1] if isinstance(l, list) else l["origin_id"]
        if oid in nodes:
            src = nodes[oid]
            while src["type"] == "Reroute":
                rl = links[src["inputs"][0]["link"]]
                src = nodes[rl[1] if isinstance(rl, list) else rl["origin_id"]]
            if src["type"] == "PrimitiveBoolean":
                # 1002 ㉑ seed 手法:[4012]『PE启用?』value 槽接 -10 面板槽——
                # 执行真值=面板投影(节点自身 wv=未连线兜底);先冒泡面板值
                vin = next((i for i in src.get("inputs", [])
                            if i.get("name") == "value"), None)
                if vin is not None and vin.get("link") is not None:
                    vl = links[vin["link"]]
                    v_oid = vl[1] if isinstance(vl, list) else vl["origin_id"]
                    if v_oid == -10:
                        v_slot = (vl[2] if isinstance(vl, list) else vl["origin_slot"])
                        return bool(_panel_value(
                            graph, sg, sg["inputs"][v_slot]["name"]))
                return bool(src["widgets_values"][0])
    return bool(node["widgets_values"][0])


def _lazy_arm_slots(graph: dict, sg: dict | None, nodes: dict, links: dict,
                    node: dict) -> list[int] | None:
    """择臂槽位(1001 同构集成轮):MyQi21PromptSelect 按 pe开关 只拉选中臂——
    pe开=PE出文(lazy)/pe关=装配全文槽(直写选配臂);pe关时 PE 链零入执行图。
    返回 None=非本件(调用方走 ComfySwitch/全槽口径)。"""
    if node["type"] != QI21_SG_SEL_CLASS:
        return None
    want = "PE出文" if _select_pe_on(graph, sg, nodes, links, node) else "装配全文"
    return [i for i, inp in enumerate(node.get("inputs", []))
            if inp.get("name") == want]


def _reach_state(graph: dict, save_id: int,
                 mode_override: str | None = None) -> set[tuple]:
    """执行集(SaveImage 回溯;0929 S3 作用域版,返回 (作用域, id) 双元组集合:
    作用域=None 主图,否则子图 uuid)。懒/开关语义:
    - MyQi21SpeedSelect:只回溯选中档 latent 槽(check_lazy_status 子图环境同款
      生效,S0 探针 A 级实证);mode_override=运行态切档模拟(档位字符串取自
      节点件 SPEED_MODES 真源);
    - MyQi21PromptSelect(1001 同构集成):按 pe开关 只回溯选中臂——pe开=PE出文
      (lazy)/pe关=装配全文槽;pe关干跑=PE 链零入执行图(i2i/edit 懒执行静态锚);
    - ComfySwitchNode:只回溯选中臂(_switch_bool 作用域解析);
    - 宿主节点:按被消费输出槽下钻子图(宿主 outputs 与子图 outputs 同序对齐),
      子图内回溯到的被消费 -10 边界槽按名冒泡回宿主同名输入槽再回主图上游;
      面板控件槽(宿主无连线)止步=面板值即真相,无主图上游。"""
    subs = {sg["id"]: sg for sg in _sgs(graph)}
    m_nodes, m_links = _nodes(graph), _links(graph)

    def push_main_origin(oid: int, oslot: int, stack) -> None:
        onode = m_nodes[oid]
        if onode.get("properties", {}).get("subgraph") in subs:
            stack.append((None, oid, oslot))      # 宿主:带被消费输出槽
        else:
            stack.append((None, oid, None))

    reach: set[tuple] = set()
    stack = [(None, save_id, None)]
    while stack:
        scope, nid, host_out = stack.pop()
        key = (scope, nid, host_out)
        if key in reach:
            continue
        reach.add(key)
        if scope is None:
            node = m_nodes[nid]
            sg = subs.get(node.get("properties", {}).get("subgraph"))
            if sg is not None:
                # 宿主下钻:子图 outputs 与宿主 outputs 同序(结构断言另锁)
                for lid in sg["outputs"][host_out].get("linkIds") or []:
                    stack.append((sg["id"], _sg_links(sg)[lid]["origin_id"], None))
                continue
            if node["type"] == SPEED_SELECT_CLASS:
                mode = (mode_override if mode_override is not None
                        else node["widgets_values"][0])
                slot = SPEED_SLOT_OF.get(mode)
                assert slot is not None, f"未知加速档位 {mode!r}(combo 闭集互锁漂移)"
                inp = next((i for i in node["inputs"] if i.get("name") == slot), None)
                if inp is not None and inp.get("link") is not None:
                    push_main_origin(m_links[inp["link"]][1], m_links[inp["link"]][2], stack)
                continue
            arm = _lazy_arm_slots(graph, None, m_nodes, m_links, node)
            slots = (arm if arm is not None else
                     [1 if _switch_bool(graph, None, m_nodes, m_links, node) else 0]
                     if node["type"] == "ComfySwitchNode" else range(len(node.get("inputs", []))))
            for si in slots:
                lid = node["inputs"][si].get("link")
                if lid is not None and lid in m_links:
                    push_main_origin(m_links[lid][1], m_links[lid][2], stack)
        else:
            sg = subs[scope]
            i_nodes, i_links = _sg_nodes(sg), _sg_links(sg)
            node = i_nodes[nid]
            host = _host_of(graph, sg)
            if node["type"] == SPEED_SELECT_CLASS:
                mode = (mode_override if mode_override is not None
                        else node["widgets_values"][0])
                slot = SPEED_SLOT_OF.get(mode)
                assert slot is not None, f"未知加速档位 {mode!r}(combo 闭集互锁漂移)"
                inp = next((i for i in node["inputs"] if i.get("name") == slot), None)
                if inp is not None and inp.get("link") is not None:
                    stack.append((scope, i_links[inp["link"]]["origin_id"], None))
                continue
            arm = _lazy_arm_slots(graph, sg, i_nodes, i_links, node)
            slots = (arm if arm is not None else
                     [1 if _switch_bool(graph, sg, i_nodes, i_links, node) else 0]
                     if node["type"] == "ComfySwitchNode" else range(len(node.get("inputs", []))))
            for si in slots:
                lid = node["inputs"][si].get("link")
                if lid is None or lid not in i_links:
                    continue
                l = i_links[lid]
                if l["origin_id"] == -10:
                    bname = sg["inputs"][l["origin_slot"]]["name"]
                    hi = next((i for i in host["inputs"] if i["name"] == bname), None)
                    if hi is not None and hi.get("link") is not None:
                        push_main_origin(m_links[hi["link"]][1], m_links[hi["link"]][2], stack)
                    continue
                stack.append((scope, l["origin_id"], None))
    return reach


def _reach_has(reach: set[tuple], scope_key: str | None, nid: int) -> bool:
    """执行集成员判定(宿主条目带被消费输出槽第三元,按 (作用域,id) 前两元匹配)。"""
    return any(s == scope_key and n == nid for s, n, _ in reach)


def _assert_no_true_duplicates(graph: dict, name: str) -> None:
    """0929 复用铁则谓词(设计 §5.1,与三生成器自查 6d/⑨ 同口径双记账):
    同 type+同 widgets 值+同上游集合{(origin_id, origin_slot, 输入名)}的两节点
    =真重复;主图/子图分域各自跑(子图上游以 origin_id/origin_slot 归一,同域可比;
    -10 伪源照计)。两 KSampler(40步 base 链/359步 LoRA 链)steps 与 model 上游
    均不同=并行支路本体,非真重复(design §5.3 预答检查官)。"""
    scopes = [("主图", graph["nodes"], {l[0]: l for l in graph["links"]})]
    for sg in graph.get("definitions", {}).get("subgraphs", []):
        scopes.append((f"子图[{sg['name'][:12]}…]", sg["nodes"],
                       {l["id"]: l for l in sg["links"]}))
    for scope, scope_nodes, scope_links in scopes:
        seen: dict[tuple, int] = {}
        for n in scope_nodes:
            ups = []
            for inp in n.get("inputs", []):
                lid = inp.get("link")
                if lid is not None and lid in scope_links:
                    l = scope_links[lid]
                    oid = l["origin_id"] if isinstance(l, dict) else l[1]
                    oslot = l["origin_slot"] if isinstance(l, dict) else l[2]
                    ups.append((oid, oslot, inp.get("name")))
            key = (n["type"], json.dumps(n.get("widgets_values"), ensure_ascii=False),
                   frozenset(ups))
            assert key not in seen, (
                f"{name} {scope} 真重复节点: [{seen[key]}] 与 [{n['id']}] 同 type/同上游/"
                f"同 widgets(0929 复用铁则:共享源单节点扇出,零真重复)")
            seen[key] = n["id"]


def _assert_accel_subgraph(graph: dict, name: str, *, xsg_uuid: str, host_id: int,
                           sel_id: int, ks_direct: int, ks_viggle: int, lora_id: int,
                           t8_id: int, seed_id: int, save_id: int,
                           model_src_id: int, latent_src_id: int,
                           pos_direct: str, pos_accel: str,
                           boundary_inputs: list, host_inputs: list,
                           te1_asg: int | None = None,
                           default_mode: str = DEFAULT_MODE,
                           note_id: int | None = None,
                           ks_cfgs: tuple = (1, 1),
                           banned_main_types: tuple = (), gone_main_ids: tuple = ()):
    """0929 S3 收装轮·加速子图三件同构契约(prd 问题④/design D3/D4/D5;
    research/s3-qi21-*.md 三档;生成器自查谓词=契约单源,条款以生成器 verify 口径):

    - 恰 1 个加速子图(uuid=生成器 ACCEL_SG_UUID 固定值幂等);宿主=原选择件
      原位改造(id 沿用 D3):type/properties.subgraph=uuid、title=「加速子图」、
      宿主 outputs 与子图 outputs 同序对齐(reach 下钻口径);
    - 边界槽序逐字锁(D4 三件差异如实记):boundary_inputs=(槽名,型) 全列;
      宿主输入=host_inputs(连线槽+widget 型槽,i2i/edit 全列形态/t2i 仅连线槽
      形态);面板双控件=速度档位+seed(widgets_values 与子图 widgets[] 双写同值,
      宿主=权威值源,widgets_values_named 具名镜像);默认档=default_mode
      (1002 R2:edit=EDIT_DEFAULT_MODE 直出40步回退(F3 白图);t2i/i2i=DEFAULT_MODE);
    - 子图内恰 6 件=三支路(直出 KSampler40/LoRA1.0→viggle/T8)+seed 单源
      +选择件;选择件 wv=[default_mode] 且 mode←-10 速度档位槽(面板外露);
      T8 无负面槽/model=-10 model 槽边界直连(绝不吃 LoRA)/positive=加速支路
      正源槽/seed=widget 转输入;KSampler steps=面板生效值+cfg1/euler/simple/
      denoise1+seed 单源;LoRA name 白名单逐字/strength0.8/扇出恰一线只喂
      viggle 支路;seed PrimitiveInt(0,fixed) value←-10 seed 槽,扇出恰三线;
    - 主图拆净:主图零 banned_main_types(支路机构全在子图)+旧注入式件
      gone_main_ids 不在主图;
    - 零真重复(三域分域,0929 复用铁则);
    - 懒执行三档干跑(作用域遍历,S0 探针 A 级=子图环境同款生效):默认态=default_mode
      支路在链(其余两档零入集)/viggle(LoRA+KSampler 在链)/Fun-Acc(T8 在链);
      正源分线件(te1_asg=装配子图内单参考编码)i2i/edit 加速档(viggle/Fun-Acc)
      在链、直出档懒旁路(0928 黑图修复铁则,与「默认」解绑——1002 R2)。"""
    sg = _xsg(graph)
    assert sg["id"] == xsg_uuid, \
        f"{name}: 加速子图 uuid 应={xsg_uuid!r}(生成器 ACCEL_SG_UUID 固定值),得 {sg['id']!r}"
    assert sg["name"] == ACCEL_SG_NAME, \
        f"{name}: 加速子图 name 应={ACCEL_SG_NAME!r},得 {sg['name']!r}"
    host = _host_of(graph, sg)
    nodes, links = _nodes(graph), _links(graph)
    i_nodes, i_links = _sg_nodes(sg), _sg_links(sg)
    # 宿主(D3:id 沿用原选择件;title 命名铁表)
    assert host["id"] == host_id, \
        f"{name}: 加速宿主 id 应沿用原选择件 id=[{host_id}](D3 id 锚变动最小),得 [{host['id']}]"
    assert host["type"] == xsg_uuid and host["properties"]["subgraph"] == xsg_uuid, \
        f"{name}: [{host_id}] 宿主 type/properties.subgraph 应=加速子图 uuid"
    assert host.get("title") == "[7] 加速子图", \
        f"{name}: [{host_id}] 宿主 title 应=「[7] 加速子图」(1002 ⑤⑧ 带号;与「[6] 文本提示词类型优化子图」成对)," \
        f"得 {host.get('title')!r}"
    assert [o["name"] for o in host["outputs"]] == [o["name"] for o in sg["outputs"]], \
        f"{name}: [{host_id}] 宿主 outputs 应与子图 outputs 同序对齐"
    # 边界槽序逐字锁(D4)
    assert [(i["name"], i["type"]) for i in sg["inputs"]] == boundary_inputs, \
        f"{name}: 加速子图 -10 槽序应={boundary_inputs},得 {[(i['name'], i['type']) for i in sg['inputs']]}"
    got_host = [(i["name"], i.get("link") is not None, "widget" in i) for i in host["inputs"]]
    assert got_host == host_inputs, \
        f"{name}: [{host_id}] 宿主输入(名/连线/widget 位)应={host_inputs},得 {got_host}"
    for io in sg["inputs"]:      # 契约铁律:widget 型槽 linkIds 同样逐项登记
        assert io.get("linkIds"), \
            f"{name}: 加速子图 inputs[{io['name']}] linkIds 为空(子图工程契约铁律)"
    for io in sg["outputs"]:
        assert io.get("linkIds"), \
            f"{name}: 加速子图 outputs[{io['name']}] linkIds 为空(子图工程契约铁律)"
    # 面板双控件(D5 推荐案:速度档位+seed;值双写,宿主=权威值源)
    b_idx = {n: i for i, (n, _t) in enumerate(boundary_inputs)}
    assert host["widgets_values"] == [default_mode, 0], \
        f"{name}: [{host_id}] 面板 widgets_values 应=[{default_mode!r}, 0],得 {host['widgets_values']}"
    assert sg["widgets"] == host["widgets_values"], \
        f"{name}: 加速子图 widgets[] 应与宿主 widgets_values 双写同值,得 {sg.get('widgets')}"
    assert host.get("widgets_values_named") == {"速度档位": default_mode, "seed": 0}, \
        f"{name}: [{host_id}] widgets_values_named 应具名镜像速度档位/seed,得 {host.get('widgets_values_named')}"
    # 子图内恰 6 件(机构 census,id 与生成器同表;1004 qi21 +[7016] 负向生效
    # 档位 Note=7 件,note_id 传入即入册)
    want_census = {sel_id: SPEED_SELECT_CLASS, ks_direct: "KSampler",
                   ks_viggle: "KSampler", lora_id: "LoraLoaderModelOnly",
                   t8_id: T8_CLASS, seed_id: "PrimitiveInt"}
    if note_id is not None:
        want_census[note_id] = "Note"
    got_census = {n["id"]: n["type"] for n in sg["nodes"]}
    assert got_census == want_census, \
        f"{name}: 加速子图应恰 {len(want_census)} 件={want_census},得 {got_census}"
    # 选择件(单点;mode=面板外露,不锁死;wv=宿主默认档镜像,双写同值)
    sel = i_nodes[sel_id]
    assert sel["widgets_values"] == [default_mode], \
        f"{name}: [{sel_id}] 选择件默认档应={default_mode!r}(与宿主双写同值;1002 R2 起分域," \
        f"t2i/i2i=combo 首项 DEFAULT_MODE/edit=EDIT_DEFAULT_MODE 回退档),得 {sel.get('widgets_values')}"
    m_inp = next(i for i in sel["inputs"] if i.get("name") == "mode")
    m_l = i_links[m_inp["link"]]
    assert "widget" in m_inp and (m_l["origin_id"], m_l["origin_slot"]) == (-10, b_idx["速度档位"]), \
        f"{name}: [{sel_id}].mode 应 widget 转输入接 -10 速度档位槽(宿主面板「速度档位」)"
    slot_src = {i["name"]: i_links[i["link"]]["origin_id"]
                for i in sel["inputs"] if i.get("name", "").startswith("latent_")}
    assert slot_src == {"latent_funacc": t8_id, "latent_viggle": ks_viggle,
                        "latent_direct": ks_direct}, \
        f"{name}: [{sel_id}] 三 latent 槽接线应 funacc←[{t8_id}]/viggle←[{ks_viggle}]" \
        f"/direct←[{ks_direct}](按名寻址,mode 占 slot0 后槽序 1/2/3),得 {slot_src}"
    assert sel["outputs"][0]["links"] and \
        all(i_links[l]["target_id"] == -20 for l in sel["outputs"][0]["links"]), \
        f"{name}: [{sel_id}] 输出应只汇 -20 LATENT(三支路汇流单点)"
    # T8(支路 Fun-Acc;model=-10 model 槽直连=绝不吃 LoRA,比主图溯源更强的域内断言)
    t8 = i_nodes[t8_id]
    # 1002 衔接批㉔ F1 残留对齐:三件统一三值形 [model_file, seed, control_after_generate]
    # (旧 i2i/edit 两值形=wv 序列化漂移残留,防回潮锁全长)
    assert t8["widgets_values"] == [FUNACC_FILE, 0, "randomize"], \
        f"{name}: [{t8_id}] wv 应三值形 [{FUNACC_FILE!r}, 0, 'randomize'],得 {t8.get('widgets_values')}"
    assert not any(i.get("name") == "negative" for i in t8["inputs"]), \
        f"{name}: [{t8_id}] T8 无负面槽(输入仅 model/positive/latent_image/model_file/seed)"
    for slot_name, b_name in (("model", "model"), ("positive", pos_accel),
                              ("latent_image", "latent")):
        l = i_links[next(i["link"] for i in t8["inputs"] if i["name"] == slot_name)]
        assert (l["origin_id"], l["origin_slot"]) == (-10, b_idx[b_name]), \
            f"{name}: [{t8_id}].{slot_name} 应接 -10 {b_name} 槽(边界直连;positive=加速支路正源)"
    _t_seed = next(i for i in t8["inputs"] if i["name"] == "seed")
    assert "widget" in _t_seed and i_links[_t_seed["link"]]["origin_id"] == seed_id, \
        f"{name}: [{t8_id}].seed 应 widget 转输入接 [{seed_id}] 单源(research/05 §3 无例外)"
    # 支路采样器×2(steps 面板=生效值;seed 单源;cfg=ks_cfgs 直出/viggle 分档;
    # 1004:qi21 直出支路 cfg4=负向真实生效,viggle 蒸馏件恒 1;i2i/edit 恒 1/1)
    for (sid, want_steps, model_want, pos_b), want_cfg in zip(
            ((ks_direct, STEPS_DIRECT, (-10, b_idx["model"]), pos_direct),
             (ks_viggle, STEPS_VIGGLE, (lora_id, 0), pos_accel)), ks_cfgs):
        ks = i_nodes[sid]
        wv = ks["widgets_values"]
        assert wv[K_SAMPLER_WV["steps"]] == want_steps, \
            f"{name}: [{sid}] steps 应={want_steps}(面板=生效值,步数回归 widget)"
        assert wv[K_SAMPLER_WV["cfg"]] == want_cfg \
            and wv[K_SAMPLER_WV["sampler"]] == "euler" \
            and wv[K_SAMPLER_WV["scheduler"]] == "simple" \
            and wv[K_SAMPLER_WV["denoise"]] in (1, 1.0), \
            f"{name}: [{sid}] cfg/sampler/scheduler/denoise 应 {want_cfg}/euler/simple/1,得 {wv}"
        steps_inp = next((i for i in ks["inputs"] if i.get("name") == "steps"), None)
        assert steps_inp is None or steps_inp.get("link") is None, \
            f"{name}: [{sid}] steps 不得被连线驱动(零联动零摆设值,面板值即执行值)"
        _ks_seed = next(i for i in ks["inputs"] if i["name"] == "seed")
        assert "widget" in _ks_seed and i_links[_ks_seed["link"]]["origin_id"] == seed_id, \
            f"{name}: [{sid}].seed 应 widget 转输入接 [{seed_id}] 单源"
        _mdl = i_links[next(i["link"] for i in ks["inputs"] if i["name"] == "model")]
        assert (_mdl["origin_id"], _mdl["origin_slot"]) == model_want, \
            f"{name}: [{sid}].model 上游应 {model_want}(直出=边界 base/viggle=LoRA)"
        _pos = i_links[next(i["link"] for i in ks["inputs"] if i["name"] == "positive")]
        assert (_pos["origin_id"], _pos["origin_slot"]) == (-10, b_idx[pos_b]), \
            f"{name}: [{sid}].positive 应接 -10 {pos_b} 槽(0928 正源分线硬约束)"
        _neg = i_links[next(i["link"] for i in ks["inputs"] if i["name"] == "negative")]
        assert (_neg["origin_id"], _neg["origin_slot"]) == (-10, b_idx["negative"]), \
            f"{name}: [{sid}].negative 应接 -10 negative 槽(1004:负向编码 CONDITIONING 真实生效)"
        _lat = i_links[next(i["link"] for i in ks["inputs"] if i["name"] == "latent_image")]
        assert (_lat["origin_id"], _lat["origin_slot"]) == (-10, b_idx["latent"]), \
            f"{name}: [{sid}].latent_image 应接 -10 latent 槽(三支路同源)"
    # LoRA(支路 viggle 专属;名白名单不变)
    lora = i_nodes[lora_id]
    assert _widget(lora, 0) == LORA_FILE, \
        f"{name}: LoRA name 应逐字 {LORA_FILE!r}(白名单不变)"
    assert _widget(lora, 1) == 1.0, \
        f"{name}: LoRA strength 应 1.0(1002 衔接批㉔ 用户令「定在 1.0 否则失去意义」,推翻 0925 探针 0.8)"
    _lm = i_links[next(i["link"] for i in lora["inputs"] if i["name"] == "model")]
    assert (_lm["origin_id"], _lm["origin_slot"]) == (-10, b_idx["model"]), \
        f"{name}: [{lora_id}].model 应接 -10 model 槽(base 直连臂)"
    lora_fans = sorted(lora["outputs"][0]["links"] or [])
    assert len(lora_fans) == 1 and i_links[lora_fans[0]]["target_id"] == ks_viggle, \
        f"{name}: [{lora_id}] 输出应扇出恰一线只喂 [{ks_viggle}](支路专属,单源不复用消歧)"
    # seed 单源三用(value=面板「seed」外露;扇出恰三线)
    seed = i_nodes[seed_id]
    assert seed["widgets_values"][:2] == [0, "fixed"], \
        f"{name}: [{seed_id}] seed 单源应默认 0 fixed(三支路共享可复现),得 {seed['widgets_values']}"
    _sv = next(i for i in seed["inputs"] if i["name"] == "value")
    assert "widget" in _sv and \
        (i_links[_sv["link"]]["origin_id"], i_links[_sv["link"]]["origin_slot"]) \
        == (-10, b_idx["seed"]), \
        f"{name}: [{seed_id}].value 应 widget 转输入接 -10 seed 槽(宿主面板「seed」D5 推荐案)"
    seed_targets = sorted((i_links[l]["target_id"],
                           _input_name(i_nodes[i_links[l]["target_id"]], i_links[l]["target_slot"]))
                          for l in seed["outputs"][0]["links"])
    want_targets = sorted([(ks_direct, "seed"), (ks_viggle, "seed"), (t8_id, "seed")])
    assert seed_targets == want_targets, \
        f"{name}: [{seed_id}] seed 应扇出恰三线到三采样器 seed 槽(R5 单源三用),得 {seed_targets}"
    # 主图拆净(支路机构全在子图;旧注入式件不回潮)
    for banned in banned_main_types:
        hit = [n["id"] for n in graph["nodes"] if n["type"] == banned]
        assert not hit, f"{name}: 主图应零 {banned}(0929 S3:支路机构收进加速子图),得 {hit}"
    for gone in gone_main_ids:
        assert gone not in nodes, \
            f"{name}: 旧注入式件 [{gone}] 应已拆除(不在主图)"
    # 零真重复(0929 复用铁则,三域分域)
    _assert_no_true_duplicates(graph, name)
    # 懒执行三档干跑(作用域遍历;1002 R2 起默认态=default_mode:三档支路成员
    # 表驱动——t2i/i2i 默认态=combo 首项 Fun-Acc 4步,edit 默认态=直出40步回退档)
    _mode_members = {MODE_FUNACC: (t8_id,), MODE_VIGGLE: (lora_id, ks_viggle),
                     MODE_DIRECT: (ks_direct,)}
    _all_accel = (ks_direct, ks_viggle, lora_id, t8_id)
    dfun = _reach_state(graph, save_id)
    for nid in _mode_members[default_mode]:
        assert _reach_has(dfun, xsg_uuid, nid), \
            f"{name}: 默认态({default_mode})支路成员 [{nid}] 应在执行链(宿主默认档)"
    for nid in _all_accel:
        if nid not in _mode_members[default_mode]:
            assert not _reach_has(dfun, xsg_uuid, nid), \
                f"{name}: 默认态({default_mode})未选支路 [{nid}] 不应执行(懒选择零加载)"
    for sk, nid in ((xsg_uuid, sel_id), (xsg_uuid, seed_id),
                    (None, host_id), (None, latent_src_id), (None, model_src_id)):
        assert _reach_has(dfun, sk, nid), \
            f"{name}: 默认态共享成员 ({sk and '加速子图' or '主图'}, {nid}) 应在执行源内"
    dvig = _reach_state(graph, save_id, mode_override=MODE_VIGGLE)
    assert _reach_has(dvig, xsg_uuid, lora_id) and _reach_has(dvig, xsg_uuid, ks_viggle), \
        f"{name}: 档1(viggle)执行图应含 LoRA+KSampler[{ks_viggle}]"
    for nid in (ks_direct, t8_id):
        assert not _reach_has(dvig, xsg_uuid, nid), \
            f"{name}: 档1 [{nid}] 不应执行(懒选择只拉起 viggle 支路)"
    ddir = _reach_state(graph, save_id, mode_override=MODE_DIRECT)
    assert _reach_has(ddir, xsg_uuid, ks_direct), \
        f"{name}: 档0(直出)KSampler 应在执行链(40 步主线)"
    for nid in (lora_id, ks_viggle, t8_id):
        assert not _reach_has(ddir, xsg_uuid, nid), \
            f"{name}: 档0 [{nid}] 不应执行(懒选择零加载)"
    dfa = _reach_state(graph, save_id, mode_override=MODE_FUNACC)
    assert _reach_has(dfa, xsg_uuid, t8_id), \
        f"{name}: 档2(Fun-Acc)T8 应在执行链(主加速支路)"
    for nid in (ks_direct, ks_viggle, lora_id):
        assert not _reach_has(dfa, xsg_uuid, nid), \
            f"{name}: 档2 [{nid}] 不应执行(懒选择只拉起 Fun-Acc 支路)"
    # 0928 黑图修复干跑(i2i/edit 单参考编码在装配子图):加速档(viggle/Fun-Acc)
    # 在链/直出档懒旁路(1002 R2 起与「默认」解绑——正源随档位,不随默认)
    if te1_asg is not None:
        asg_uuid = _asg(graph)["id"]
        assert _reach_has(dvig, asg_uuid, te1_asg) and _reach_has(dfa, asg_uuid, te1_asg), \
            f"{name}: 加速档(viggle/Fun-Acc)正源应单参考编码 [{te1_asg}](0928 修复:双参考崩少步蒸馏)"
        assert not _reach_has(ddir, asg_uuid, te1_asg), \
            f"{name}: 直出档正源应回双参考(懒旁路)[{te1_asg}]"


def _input_name(node: dict, slot: int) -> str:
    return node["inputs"][slot].get("name", "")


# (_slot_origin/_assert_seed_input_wired 随 0929 S3 收装退役:加速域 seed/正源
#  溯源改边界槽断言入 _assert_accel_subgraph,主图扁平溯源器无调用点删除)


def _resolve_default_string_origins(graph: dict) -> dict:
    """沿主编码 prompt 上游开关的 false 支路走到底 = 直写选配臂的最终来源集合。

    (0926 裁定1 PE 开路含画布本体:qi21/edit/i2i 的 PE 开关默认 true,默认文本=
    PE 改写器运行时输出、静态不可逐字;本走臂=on_false 直写选配档的来源核验。)
    0929 S3 作用域版:主编码可在装配子图内(edit [6];以「喂 positive 输出的
    编码器=主编码」定位,双参考正源口径),-10 边界按名冒泡回主图——t2i 静态件
    零子图走旧路;edit 终点=主图 [22] PrimitiveStringMultiline(原始用户词)。"""
    m_nodes, m_links = _nodes(graph), _links(graph)
    if _sgs(graph):
        asg = _asg(graph)
        sg_nodes, sg_links = _sg_nodes(asg), _sg_links(asg)
        pos_io = next(o for o in asg["outputs"] if o["name"] == "positive")
        te_id = sg_links[pos_io["linkIds"][0]]["origin_id"]
        main_te, scope_key = sg_nodes[te_id], asg["id"]
        assert main_te["type"] == "TextEncodeQwenImage21"
    else:
        main_te = next(
            n for n in graph["nodes"]
            if n["type"] == "TextEncodeQwenImage21"
            and any(i["name"] == "prompt" and i.get("link") for i in n["inputs"])
        )
        sg_nodes, sg_links, scope_key = m_nodes, m_links, None
    subs = {sg["id"]: sg for sg in _sgs(graph)}
    stack: list[tuple] = []
    lid = next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")
    l = sg_links[lid]
    if scope_key is not None and l["origin_id"] == -10:
        host = _host_of(graph, _asg(graph))
        hi = next(i for i in host["inputs"]
                  if i["name"] == _asg(graph)["inputs"][l["origin_slot"]]["name"])
        stack.append((None, m_nodes[m_links[hi["link"]][1]]))
    else:
        stack.append((scope_key, sg_nodes[l["origin_id"] if scope_key is not None
                                           else l[1]]))
    origins: dict[tuple, dict] = {}
    hops = 0
    while stack:
        sc, node = stack.pop()
        if (sc, node["id"]) in origins:
            continue
        origins[(sc, node["id"])] = node
        hops += 1
        assert hops <= 60, "默认链解析超限(疑似环)"
        if node["type"] == "Reroute":
            rl = (sg_links if sc is not None else m_links)[node["inputs"][0]["link"]]
            stack.append((sc, (sg_nodes if sc is not None else m_nodes)[rl["origin_id"]]))
        elif node["type"] == "ComfySwitchNode":
            # 0926 裁定1:PE 开关默认 true=PE 开路;本走臂固定 on_false(直写选配)
            sl = (sg_links if sc is not None else m_links)[node["inputs"][0]["link"]]
            if sc is not None and sl["origin_id"] == -10:
                sg = subs[sc]
                host = _host_of(graph, sg)
                hi = next(i for i in host["inputs"]
                          if i["name"] == sg["inputs"][sl["origin_slot"]]["name"])
                stack.append((None, m_nodes[m_links[hi["link"]][1]]))
            else:
                oid = sl[1] if isinstance(sl, list) else sl["origin_id"]
                stack.append((sc, (sg_nodes if sc is not None else m_nodes)[oid]))
        elif node["type"] == QI21_SG_SEL_CLASS:
            # 1001 edit 同构收编:直写选配臂=「装配全文」槽(名寻址;pe开=PE出文
            # 运行时文本静态不可逐字,同 ComfySwitchNode 固定走 on_false 口径)
            sl = (sg_links if sc is not None else m_links)[
                next(i["link"] for i in node["inputs"] if i["name"] == "装配全文")]
            if sc is not None and sl["origin_id"] == -10:
                sg = subs[sc]
                host = _host_of(graph, sg)
                hi = next(i for i in host["inputs"]
                          if i["name"] == sg["inputs"][sl["origin_slot"]]["name"])
                if hi.get("link") is not None:
                    stack.append((None, m_nodes[m_links[hi["link"]][1]]))
            else:
                oid = sl[1] if isinstance(sl, list) else sl["origin_id"]
                stack.append((sc, (sg_nodes if sc is not None else m_nodes)[oid]))
        elif node["type"] == "StringConcatenate":
            for inp in node["inputs"]:
                if inp.get("link") is None:
                    continue
                il = (sg_links if sc is not None else m_links)[inp["link"]]
                if sc is not None and il["origin_id"] == -10:
                    sg = subs[sc]
                    host = _host_of(graph, sg)
                    hi = next(i for i in host["inputs"]
                              if i["name"] == sg["inputs"][il["origin_slot"]]["name"])
                    if hi.get("link") is not None:
                        stack.append((None, m_nodes[m_links[hi["link"]][1]]))
                else:
                    oid = il[1] if isinstance(il, list) else il["origin_id"]
                    stack.append((sc, (sg_nodes if sc is not None else m_nodes)[oid]))
    return {nid: n for (_sc, nid), n in origins.items()
            if n["type"] in ("StringConstant", "PrimitiveStringMultiline")}


# ── 0. MyQi21SpeedSelect 档位契约互锁(0929 并行化:节点件↔三画布;设计 §4
#      「combo 列表即契约」——/prompt 闭集硬校验,不在列表=HTTP 400)───────────

class TestSpeedSelectContract0929:
    # 0929 S3 收装批迁子图版(Trellis 09-29-qi21-canvas-batch D3/D4/D5;原扁平
    # 选择件断言随收装重写:选择件=加速子图内 [214]/[192]/[59],宿主=原选择件
    # id 原位改造 [208]/[190]/[58])。
    XHOSTS = {"qi21": QI21_XHOST_ID, "i2i": I2I_XHOST_ID, "edit": EDIT_XHOST_ID}
    XSELS = {"qi21": QI21_XSEL_ID, "i2i": I2I_XSEL_ID, "edit": EDIT_XSEL_ID}
    XSG_UUIDS = {"qi21": QI21_XSG_UUID, "i2i": I2I_XSG_UUID, "edit": EDIT_XSG_UUID}

    def test_combo_closed_set_and_default_first(self):
        """档位表真源=my_nodes 节点件 SPEED_MODES:三档字符串逐字(分隔符=U+00B7
        中点,锁码位防全角漂移);1002 ⑱:首项=默认=Fun-Acc 4步(用户新令推翻
        0929 拉齐重放裁定);档号随新序理顺=序位号 0/1/2,与槽名一一对应。
        行为面单测=my_nodes/tests/
        test_my_qi21_speed_select.py(三态/默认/懒裁剪/容错/报错文案),此处锁契约面。"""
        assert [m for m, _s in SPEED_MODES] == ["0 · Fun-Acc 4步", "1 · 直出40步", "2 · viggle"]
        assert DEFAULT_MODE == SPEED_MODES[0][0]
        assert [s for _m, s in SPEED_MODES] == ["latent_funacc", "latent_direct", "latent_viggle"]

    def test_lazy_protocol_shape(self):
        """懒执行语义位(结构面):三 latent 槽全 optional 全 lazy(执行器对 lazy 槽
        默认不建强依赖)+懒钩子实名 check_lazy_status(本版引擎 execution.py 只认
        此名,照旧资料写 check_lazy_inputs 会静默失效——research/05 §2.1;
        S0 探针 A 级实证子图环境同款生效,research/lazy-in-subgraph.md)。"""
        it = _speed_mod.MyQi21SpeedSelect.INPUT_TYPES()
        assert it["required"]["mode"][0] == [m for m, _s in SPEED_MODES]
        assert set(it["optional"]) == {"latent_funacc", "latent_viggle", "latent_direct"}
        for slot in it["optional"].values():
            assert slot[0] == "LATENT" and slot[1].get("lazy") is True, \
                f"三 latent 槽应全 lazy(未选支路零执行零加载),得 {slot}"
        assert hasattr(_speed_mod.MyQi21SpeedSelect, "check_lazy_status")

    def test_exactly_two_subgraphs_0929(self):
        """三件恰两子图(0929 用户确认目标形态=②提示词子图+③加速子图,职责互斥;
        prd 问题④验收口径):装配=[40] 道劫·装配子图(双击进入)(三件同名,D9
        edit 装配段出生即子图化);加速=道劫·加速子图(uuid=生成器固定值幂等);
        两宿主都在主图(properties.subgraph 挂钩)。id 作用域安全:主图∩加速=∅
        三件(执行展开安全);qi21 已知撞号钉死(main∩装配={208}=宿主 id 沿用与
        S2 内部件 W1[208] 并存、装配∩加速={206,207}=S2 Strip/W1 与加速
        KSampler/seed,展开形 40:206 vs 208:206 互异,生成器 research §二在档)
        ——已知集之外任何新撞号即红。"""
        for name in ("qi21", "i2i", "edit"):
            graph = GRAPHS[name]
            sgs = _sgs(graph)
            assert len(sgs) == 2, \
                f"{name}: 应恰 2 子图(②装配+③加速,0929 S3 两子图架构),得 {len(sgs)}"
            names = sorted(sg["name"] for sg in sgs)
            assert names == sorted([ASSEMBLY_SG_NAME_T2I, ACCEL_SG_NAME]), \
                f"{name}: 子图 name 应=装配+加速对(1001 R2 三件统一「提示词类型优化子图」),得 {names}"
            hosts = [n for n in graph["nodes"]
                     if n.get("properties", {}).get("subgraph") in {sg["id"] for sg in sgs}]
            assert len(hosts) == 2, \
                f"{name}: 两子图应各恰 1 宿主(properties.subgraph 挂钩),得 {[h['id'] for h in hosts]}"
            # id 作用域(执行展开安全)
            mids = {n["id"] for n in graph["nodes"]}
            a_ids = {n["id"] for n in _asg(graph)["nodes"]}
            x_ids = {n["id"] for n in _xsg(graph)["nodes"]}
            assert not (mids & x_ids), \
                f"{name}: 主图∩加速子图 应=∅(执行展开安全),得 {sorted(mids & x_ids)}"
            want_ma = set()  # 1001 S8 集成轮:装配子图 W1[208] 随 22 件退役,历史撞号 {208} 消亡
            assert mids & a_ids == want_ma, \
                f"{name}: 主图∩装配子图 应={sorted(want_ma) or '∅'}(qi21 历史 {208} 撞号已随" \
                f"S8 集成退役),得 {sorted(mids & a_ids)}"
            want_ax = set()  # 1001 S8:装配子图 Strip/W1[206][207] 随 22 件退役,历史撞号消亡
            assert a_ids & x_ids == want_ax, \
                f"{name}: 装配∩加速 应={sorted(want_ax) or '∅'}(qi21 历史 {206,207} 撞号" \
                f"已随 S8 集成退役),得 {sorted(a_ids & x_ids)}"

    def test_accel_host_id_reuse_0929(self):
        """加速宿主 id 沿用(D3:原选择件原位改造,id 锚变动最小——t2i[208]/
        i2i[190]/edit[58]);宿主 type=加速子图 uuid(固定值幂等);title=「加速子图」
        (命名铁表,与「[40] 装配子图」成对);装配宿主三件同 id=[40](edit 承
        t2i 装配段惯例,D9)。id 漂移(重跑回退到摊开形)即红。"""
        for name in ("qi21", "i2i", "edit"):
            graph = GRAPHS[name]
            xsg = _xsg(graph)
            host = _host_of(graph, xsg)
            assert host["id"] == self.XHOSTS[name], \
                f"{name}: 加速宿主 id 应=[{self.XHOSTS[name]}](1002 ⑫ 编号重排),得 [{host['id']}]"
            assert xsg["id"] == self.XSG_UUIDS[name], \
                f"{name}: 加速子图 uuid 应={self.XSG_UUIDS[name]!r}(生成器 ACCEL_SG_UUID),得 {xsg['id']!r}"
            assert host.get("title") == "[7] 加速子图", \
                f"{name}: 加速宿主 title 应=「[7] 加速子图」(1002 ⑤⑧ 带号),得 {host.get('title')!r}"
            ahost = _host_of(graph, _asg(graph))
            assert ahost["id"] == 6, \
                f"{name}: 装配宿主 id 应=[6](1002 ⑫ 三件同段号),得 [{ahost['id']}]"
            assert ahost.get("title") == "[6] 文本提示词类型优化子图", \
                f"{name}: 装配宿主 title 应=「[6] 文本提示词类型优化子图」(1002 ⑬),得 {ahost.get('title')!r}"
            assert _asg(graph)["name"] == ASSEMBLY_SG_NAME_T2I, \
                f"{name}: 装配子图 name 应={ASSEMBLY_SG_NAME_T2I!r},得 {_asg(graph)['name']!r}"

    def test_accel_panel_controls_present_0929(self):
        """宿主面板双控件在位(D5 推荐案落地,回退案未启用):「速度档位」COMBO
        (闭集单源=自研件 SPEED_MODES import 互锁;默认档分域——t2i/i2i=首项
        Fun-Acc(1002 ⑱)/edit=直出40步(1002 R2 F3 白图回退))+「seed」INT
        (默认 0;子图内 seed 单源 value 经 -10 槽外露);widgets_values 与子图
        widgets[] 双写同值+具名镜像(宿主=权威值源);控件型边界槽在子图 -10 IO
        在册(i2i/edit 宿主输入列全列形态含 widget 位,t2i 仅连线槽形态——
        序列化差异如实记,控件序两形态同源)。"""
        for name in ("qi21", "i2i", "edit"):
            graph = GRAPHS[name]
            xsg = _xsg(graph)
            host = _host_of(graph, xsg)
            dmode = EDIT_DEFAULT_MODE if name == "edit" else DEFAULT_MODE
            assert host["widgets_values"] == [dmode, 0], \
                f"{name}: [{host['id']}] 面板应=[速度档位={dmode!r}, seed=0]," \
                f"得 {host['widgets_values']}"
            assert host.get("widgets_values_named") == {"速度档位": dmode, "seed": 0}, \
                f"{name}: [{host['id']}] 具名镜像漂移,得 {host.get('widgets_values_named')}"
            assert xsg["widgets"] == host["widgets_values"], \
                f"{name}: 子图 widgets[] 与宿主 widgets_values 应双写同值,得 {xsg.get('widgets')}"
            w_types = {i["name"]: i["type"] for i in xsg["inputs"]}
            assert w_types.get("速度档位") == "COMBO" and w_types.get("seed") == "INT", \
                f"{name}: 加速子图应含控件型边界槽 速度档位(COMBO)/seed(INT),得 {w_types}"

    def test_assembly_rgba_tri_state_controls_0929(self):
        """透明/三态面板控件(0929 S2 D6 立;1001 用户测试批 ④⑥⑦ qi21 分支重立):
        qi21=「透明」BOOLEAN(Q4 裁定,默认 false;仅自由型显示,值恒存不被改写
        ——九型=按型 rgba_default 自动,[210] 三态件退役,i2i 侧三态锚零动);
        i2i 宿主面板持三态控件默认自动(1001 ① 文案轮);edit 无 MyQi21DaojieBase/无 RGBA 机构=
        不适用(research/s3-edit §3 如实记,面板控件=指令/PE开关 两控)。"""
        graph = GRAPHS["qi21"]
        host = _host_of(graph, _asg(graph))
        # 2005 用户精简面板:手动宽/高已删,透明/PE启用? 仍在 widgets_values
        assert "PE启用?" not in host.get("widgets_values_named", {}), \
            "qi21: PE启用? 应随 1006 四轮退役(AI扩写恒开)"
        for gone in ("RGBA透明", "画幅联动开关"):
            assert gone not in host.get("widgets_values_named", {}), \
                f"qi21: 旧控件「{gone}」应已退役(1001 用户测试批)"
        for name, control in (("i2i", "RGBA透明"),):
            graph = GRAPHS[name]
            host = _host_of(graph, _asg(graph))
            assert _panel_value(graph, _asg(graph), control) == "自动", \
                f"{name}: 装配宿主面板「{control}」应默认=自动(四型开/五型关,手动权威不固化;1001 ① 文案)"
            assert control in host.get("widgets_values_named", {}), \
                f"{name}: 装配宿主 widgets_values_named 应具名镜像「{control}」"
        edit_controls = ASSEMBLY_PANEL_CONTROLS["edit"]
        edit_host = _host_of(GRAPHS["edit"], _asg(GRAPHS["edit"]))
        assert edit_host["widgets_values"] == [
            edit_host["widgets_values_named"]["指令"], True], \
            "edit 装配宿主面板应=指令+PE启用? 两控(1002 ㉑;无型库/无 RGBA 机构)"
        assert edit_controls == ["指令", "PE启用?"], "edit 面板控件表应恰 指令+PE启用?"

    def test_assembly_preview_text_slot_d10(self):
        """装配子图预览文本槽序(D10,0929 S4 槽位批已落地):预览/过目类文本输出槽
        (qi21=最终文本/i2i=prompt)=最末槽(节点最底)——槽序与下游去向对齐,导线
        不再翻越其余输出走线(qi21:最终文本→[27] 预览随槽迁 [40] 右下袋,主图交叉
        16→13;i2i:prompt→[28] 预览迁宿主右下袋 (5700,1800),主图交叉 14→12;两件
        均网格搜索定值,est/线遮/组框全清);edit 出生即带 D10 序=无预览槽(空真满足,
        [15] 输出即无外部消费者,research/s3-edit §1 记账;若补预览件新槽必须最末)。
        宿主 outputs 与子图 outputs 同序镜像(reach 下钻口径)。"""
        want_seqs = {
            # 1006 四轮:qi21 四出(wh_ratio/PE启用? 随 AI扩写恒开退役;[4018] 恒九型)
            "qi21": ["positive", "negative", "width", "height"],
            "i2i": ["positive", "negative", "latent", "positive_single", "prompt"],
            "edit": ["positive", "negative", "latent", "positive_single"],
        }
        for name in ("qi21", "i2i", "edit"):
            graph = GRAPHS[name]
            asg = _asg(graph)
            got = [o["name"] for o in asg["outputs"]]
            assert got == want_seqs[name], \
                f"{name}: 装配子图输出槽序应={want_seqs[name]},得 {got}"
            host = _host_of(graph, asg)
            assert [o["name"] for o in host["outputs"]] == got, \
                f"{name}: 装配宿主 outputs 应与子图 outputs 同序镜像"
        if D10_PREVIEW_SLOT_LAST:   # S4 槽位批落地后翻 True(此处为翻转点,一次同批)
            for name, slot_name in (("i2i", "prompt"),):
                outs = [o["name"] for o in _asg(GRAPHS[name])["outputs"]]
                assert outs[-1] == slot_name, \
                    f"{name}: D10 预览文本槽「{slot_name}」应=最末槽(节点最底),得 {outs}"
        # 1004:qi21「最终文本」槽随编码器迁出退役(预览改吃槽0 positive,断言在
        # test_subgraph_outputs_feed_sampler_latent_and_preview);edit 无预览槽=空真

    def test_three_files_default_mode_consistent(self):
        """三件各自宿主=选择件同值(AC):加速子图内选择件 widgets_values 与宿主
        面板首控(权威值源)同值——默认档分域(1002 R2):t2i/i2i=DEFAULT_MODE
        (1002 ⑱ 首项 Fun-Acc)/edit=EDIT_DEFAULT_MODE(直出40步,F3 白图回退);
        重跑任一生成器漂移即红。"""
        for name in ("qi21", "i2i", "edit"):
            xsg = _xsg(GRAPHS[name])
            sel = _sg_nodes(xsg)[self.XSELS[name]]
            assert sel["type"] == SPEED_SELECT_CLASS, \
                f"{name}: [{self.XSELS[name]}] 应为 {SPEED_SELECT_CLASS}(加速子图内)"
            dmode = EDIT_DEFAULT_MODE if name == "edit" else DEFAULT_MODE
            assert sel["widgets_values"] == [dmode], \
                f"{name}: [{self.XSELS[name]}] 默认档应={dmode!r}(与宿主同值)," \
                f"得 {sel.get('widgets_values')}"
            assert _host_of(GRAPHS[name], xsg)["widgets_values"][0] == dmode, \
                f"{name}: 加速宿主面板「速度档位」应={dmode!r}"

    def test_s1_naming_batch_0929(self):
        """0929 S1 命名批铁表逐字锁(D1/D3;S3 后三件齐):[40] 宿主 title 三件
        统一=稳定短名「[40] 装配子图」;子图 name=「[40] 道劫·装配子图(双击进入)」
        (三件同名);三件选择件 title=用户语言短名「出图速度选择」(同构节点跨件
        同名=R6,现居加速子图内)。被删说明由组框标题+用法 Note 承载(信息零丢失)
        ——名字漂移即红。"""
        for name in ("qi21", "i2i", "edit"):
            graph = GRAPHS[name]
            host = _host_of(graph, _asg(graph))
            assert host.get("title") == "[6] 文本提示词类型优化子图", \
                f"{name}: [6] 宿主 title 应=「[6] 文本提示词类型优化子图」(1002 ⑬ 更名),得 {host.get('title')!r}"
            assert _asg(graph)["name"] == ASSEMBLY_SG_NAME_T2I, \
                f"{name}: 子图 name 应={ASSEMBLY_SG_NAME_T2I!r},得 {_asg(graph)['name']!r}"
            sel = _sg_nodes(_xsg(graph))[self.XSELS[name]]
            assert sel.get("title") == "[7015] 出图速度选择·自研", \
                f"{name}: [{self.XSELS[name]}] 选择件 title 应=「[7015] 出图速度选择·自研」(1002 ⑤⑧)," \
                f"得 {sel.get('title')!r}"
            assert _host_of(graph, _xsg(graph)).get("title") == "[7] 加速子图", \
                f"{name}: 加速宿主 title 应=「[7] 加速子图」(1002 ⑤⑧ 带号)"


# ── 1. 四文件在位、文件名合规(09-18 命名铁律:无 MY- 前缀、无下划线)──

class TestFilesInPlace:
    def test_all_files_exist(self):
        for name, path in WORKFLOWS.items():
            assert path.is_file(), f"Q2-1图像 {name} 件缺失: {path}"

    def test_filenames_comply_naming_rules(self):
        for path in WORKFLOWS.values():
            stem = path.stem
            assert not stem.startswith("MY-"), f"{path.name} 残留 MY- 前缀(09-18 废止)"
            assert "_" not in stem, f"{path.name} 含下划线(命名铁律:一律连字符)"


# ── 2. 加载器契约(bf16 三件 + CLIPLoader type=qwen_image;PE 组带专属加载器)──

class TestLoaderTriple:
    def test_unet_loader_exact_file(self):
        for name, graph in GRAPHS.items():
            loaders = _by_type(graph, "UNETLoader")
            assert len(loaders) == 1, f"{name}: UNETLoader 应恰 1 个"
            assert _widget(loaders[0], 0) == UNET_FILE, \
                f"{name}: unet_name 应逐字 {UNET_FILE!r}"

    def test_clip_loader_exact_file_and_type(self):
        for name, graph in GRAPHS.items():
            loaders = _by_type(graph, "CLIPLoader")
            expected = 2 if name == "t2i" else 1  # 通用 t2i 带 PE 组=2;道劫三件 1002 ⑬ 后=1
            assert len(loaders) == expected, f"{name}: 主图 CLIPLoader 应恰 {expected} 个(1002 ⑬)"
            main = [n for n in loaders if _widget(n, 0) == CLIP_FILE]
            assert len(main) == 1, f"{name}: 主 CLIP(qwen3vl_8b_bf16_heretic)应恰 1 个"
            assert _widget(main[0], 1) == "qwen_image", \
                f"{name}: 主 CLIPLoader type 必须为 qwen_image"

    def test_pe_clip_loader_exact_file_and_type(self):
        pe_files = {"t2i": PE_CLIP_FILE, "edit": PE_I2I_CLIP_FILE, "i2i": PE_I2I_CLIP_FILE}
        for name, expected_file in pe_files.items():
            graph = GRAPHS[name]
            # 1002 ⑬:PE TE 迁入装配子图([4019])——从主图+装配子图并查恰 1
            extra = (_by_type(_asg(graph), "CLIPLoader") if _sgs(graph) else [])
            pe_clips = [n for n in (_by_type(graph, "CLIPLoader") + extra)
                        if _widget(n, 0) == expected_file]
            assert len(pe_clips) == 1, f"{name}: PE CLIPLoader 应恰 1 个(权重文件名逐字 {expected_file})"
            assert _widget(pe_clips[0], 1) == "qwen_image", \
                f"{name}: PE CLIPLoader type 必须为 qwen_image(PE 走原生 CLIPLoader 路线)"

    def test_vae_loader_exact_file(self):
        for name, graph in GRAPHS.items():
            loaders = _by_type(graph, "VAELoader")
            assert len(loaders) == 1, f"{name}: VAELoader 应恰 1 个"
            assert _widget(loaders[0], 0) == VAE_FILE, \
                f"{name}: vae_name 应逐字 {VAE_FILE!r}"


# ── 3. KSampler 参数(cfg=1.0 / euler+simple / denoise=1.0;0929 并行化:道劫三件
#      恰 2 个采样器=直出 40(官方完整档)+viggle 359,通用 t2i 件仍 1 个 25-50)──

class TestSamplerContract:
    def test_sampler_params(self):
        """0929 S3 收装后:道劫三件采样器全居加速子图(主图零 KSampler);通用
        t2i 静态件不动(单采样器,官方 25-50 区间)。"""
        for name, graph in GRAPHS.items():
            if name == "t2i":   # 通用官方件:单采样器,官方 25-50 区间
                samplers = _by_type(graph, "KSampler")
                assert len(samplers) == 1, f"{name}: KSampler 应恰 1 个"
                wv = samplers[0]["widgets_values"]
                assert wv[K_SAMPLER_WV["cfg"]] == 1.0, f"{name}: cfg 必须恒 1.0(官方路径)"
                assert 25 <= wv[K_SAMPLER_WV["steps"]] <= 50, \
                    f"{name}: steps 应在官方区间 25-50(模板 25 起手)"
            else:   # 道劫三件(0929 S3 收装):双支路采样器=40 直出+359 viggle,全在加速子图
                assert not _by_type(graph, "KSampler"), \
                    f"{name}: 主图应零 KSampler(0929 S3:支路机构收进加速子图)"
                samplers = [n for n in _xsg(graph)["nodes"] if n["type"] == "KSampler"]
                assert len(samplers) == 2, \
                    f"{name}: 加速子图内 KSampler 应恰 2 个(直出/viggle 支路),得 {len(samplers)}"
                assert sorted(s["widgets_values"][K_SAMPLER_WV["steps"]] for s in samplers) \
                    == sorted([STEPS_DIRECT, STEPS_VIGGLE]), \
                    f"{name}: 两支路 steps 应=40/6(面板=生效值;1002 viggle 考据)"
                # 1004 Phase D(中文负面役用户令):qi21 [7010] 直出支路 cfg 1→4=
                # 负面提示词真实参与采样;[7012] viggle 蒸馏件 cfg 恒 1(模型卡口径
                # 负向无效,加速子图 [7016] Note 注明);i2i/edit 两支路仍恒 1。
                want_cfgs = [1, 4] if name == "qi21" else [1, 1]
                assert sorted(s["widgets_values"][K_SAMPLER_WV["cfg"]] for s in samplers) \
                    == want_cfgs, \
                    f"{name}: 两支路 cfg 应={want_cfgs}(1004:qi21 [7010] cfg4 负向生效)," \
                    f"得 {[s['widgets_values'][K_SAMPLER_WV['cfg']] for s in samplers]}"
            for s in samplers:
                wv = s["widgets_values"]
                assert wv[K_SAMPLER_WV["sampler"]] == "euler", f"{name}: sampler 必须 euler"
                assert wv[K_SAMPLER_WV["scheduler"]] == "simple", f"{name}: scheduler 必须 simple"
                assert wv[K_SAMPLER_WV["denoise"]] == 1.0, f"{name}: denoise 必须 1.0"

    def test_qi21_steps_full_tier_40(self):
        """qi21 件 09-23 总装轮用户令『不希望25步,要完整态』:直出支路 steps 钉 40
        (官方完整档;官方区间 40-50 写进 Note);0929 并行化后 viggle 支路=359
        (0929 S3 收装后直出支路=[7] 居加速子图)。"""
        wv = _sg_nodes(_xsg(GRAPHS["qi21"]))[QI21_SAMPLER_ID]["widgets_values"]
        assert wv[K_SAMPLER_WV["steps"]] == 40, \
            f"qi21 直出支路 steps 应=40(官方完整档,用户令完整态),得 {wv[K_SAMPLER_WV['steps']]}"

    def test_seed_control_modes(self):
        """seed 控制口径(0929 并行化+S3 收装):通用 t2i 件=KSampler widget fixed
        (官方模板);道劫三件=seed 单源 PrimitiveInt(0,fixed)居加速子图,接管三支路
        (value 经 -10 seed 槽=宿主面板「seed」外露;各采样器面板 seed=摆设值不生效,
        Note 注明)——结构断言在 _assert_accel_subgraph。"""
        assert _widget(_by_type(GRAPHS["t2i"], "KSampler")[0], 1) == "fixed", \
            "t2i 件 seed 应 fixed(官方 t2i 模板口径)"
        for name, seed_id in (("qi21", QI21_SEED_ID), ("i2i", I2I_SEED_ID),
                              ("edit", EDIT_SEED_ID)):
            seed = _sg_nodes(_xsg(GRAPHS[name]))[seed_id]
            assert seed["type"] == "PrimitiveInt" and seed["widgets_values"][:2] == [0, "fixed"], \
                f"{name}: [{seed_id}] seed 单源应 0/fixed(0929 R5 单源三用,加速子图内)"


# ── 4. 链路完整性(link 双向一致、无孤儿节点、输出节点可达)─────────

class TestTopology:
    def test_links_bidirectional_consistency(self):
        for name, graph in GRAPHS.items():
            nodes = _nodes(graph)
            for link in graph["links"]:
                lid, origin_id, origin_slot, target_id, target_slot, typ = link
                origin, target = nodes[origin_id], nodes[target_id]
                assert typ == (origin.get("outputs",[{}])[origin_slot]["type"] if len(origin.get("outputs",[]))>origin_slot else "STRING"), \
                    f"{name} link{lid}: origin 槽类型不匹配"
                assert lid in (origin["outputs"][origin_slot].get("links") or []), \
                    f"{name} link{lid}: origin.outputs[{origin_slot}].links 未登记 {lid}"
                assert target["inputs"][target_slot].get("link") == lid, \
                    f"{name} link{lid}: target.inputs[{target_slot}].link != {lid}"

    def test_no_orphans_and_save_reachable(self):
        for name, graph in GRAPHS.items():
            nodes = _nodes(graph)
            savers = _by_type(graph, "SaveImage")
            # 1002 衔接批㉕:qi21/i2i 增⑤放大尾档 [504] 2K 保存(直出 [8]+2K [504]
            # 双落盘);t2i(通用件)/edit 仍单存。多存档=从全部 SaveImage 回溯并集。
            want_savers = 2 if name in ("qi21", "i2i") else 1
            assert len(savers) == want_savers, \
                f"{name}: SaveImage 应恰 {want_savers} 个(㉕ 尾档双落盘口径)"
            seen, stack = set(), [s["id"] for s in savers]
            while stack:
                nid = stack.pop()
                if nid in seen:
                    continue
                seen.add(nid)
                node = nodes[nid]
                for slot_index, inp in enumerate(node.get("inputs", [])):
                    lid = inp.get("link")
                    if lid is None:
                        continue
                    origin_id = next(l[1] for l in graph["links"] if l[0] == lid)
                    stack.append(origin_id)
            # MarkdownNote=说明卡、easy showAnything=显示型端点(画布预览,无下游)——
            # 两者都是合法画布端点,不计孤儿(qi21 件 [27] 装配预览,骨承 K2 件 [62]/[86])
            display_endpoints = {"MarkdownNote", "easy showAnything",
                                 "Image Comparer (rgthree)"}  # ㉖ 对比件=纯预览端点
            # 1005 重锚:[401] MyQi21PromptPreview=OUTPUT_NODE 显示件(件级
            # OUTPUT_NODE=True=执行根,UI widget 渲染,非 SaveImage 上游属正常)
            # ——按「类声明 OUTPUT_NODE」动态豁免,自研显示件回潮不再误报
            for _t in {n["type"] for n in graph["nodes"]}:
                _cls = _load_my_node_class(_t)
                if _cls is not None and getattr(_cls, "OUTPUT_NODE", False) is True:
                    display_endpoints.add(_t)
            orphans = sorted(
                nodes[i]["type"] for i in nodes
                if i not in seen and nodes[i]["type"] not in display_endpoints
            )
            assert not orphans, f"{name}: 存在不可达 SaveImage 的孤儿节点: {orphans}"

    def test_t2i_resolution_selector_feeds_latent(self):
        for name in ("t2i",):
            graph = GRAPHS[name]
            nodes = _nodes(graph)
            selectors = _by_type(graph, "ResolutionSelector")
            assert len(selectors) == 1, f"{name}: 应含 ResolutionSelector(官方档位出宽高)"
            latent = _by_type(graph, "EmptyLatentImage")[0]
            width_in = latent["inputs"][0]
            assert width_in["name"] == "width" and width_in["link"] is not None, \
                f"{name}: EmptyLatentImage.width 必须由 ResolutionSelector.width 供给"
            origin_id = next(l[1] for l in graph["links"] if l[0] == width_in["link"])
            assert nodes[origin_id]["type"] == "ResolutionSelector", \
                f"{name}: EmptyLatentImage.width 上游必须是 ResolutionSelector"

    def test_qi21_latent_fed_by_subgraph_width_height(self):
        """qi21 件宽高链(1004 Phase D 重锚):[4018] MyQi21WhSuggest 画幅建议器迁
        主图装配块旁——[4] 空潜宽高直连 [4018].width/height(建议器=画幅规则后
        终值);[4018] 吃 [6] 宿主三出口:九型W/H(槽2/3,子图内直源 [4010] 原样
        直通)+wh_ratio(槽4,PE 建议)+联动开关(槽5=PE启用? 扇出);手填宽高
        住 [4018] 面板 widget([6] 面板同名控件不生效,说明卡注明)。"""
        graph = GRAPHS["qi21"]
        assert not _by_type(graph, "ResolutionSelector"), \
            "qi21 件不应再有 ResolutionSelector(写死档位表已废止,宽高随型直驱)"
        wh = _nodes(graph)[QI21_WH_ID]
        assert wh["type"] == QI21_SG_WH_CLASS, \
            f"qi21: 画幅建议器应=MyQi21WhSuggest[{QI21_WH_ID}] 居主图(1004 迁出),得 {wh['type']}"
        assert [o["name"] for o in wh["outputs"]] == ["width", "height"]
        latent = _by_type(graph, "EmptyLatentImage")[0]
        for slot, want_out in ((0, "width"), (1, "height")):
            inp = latent["inputs"][slot]
            assert inp["name"] == want_out and inp["link"] is not None, \
                f"qi21: EmptyLatentImage.{want_out} 必须由 [{QI21_WH_ID}] 建议器供给"
            link = _links(graph)[inp["link"]]
            assert (link[1], link[2]) == (QI21_WH_ID, slot), \
                f"qi21: EmptyLatentImage.{want_out} 应直连 [{QI21_WH_ID}].{want_out}(终值直驱)"
        # 1006 四轮:建议器仅 W/H 两入线溯宿主(九型W←宿主2/九型H←宿主3);
        # wh_ratio/联动开关 未接=恒九型直通(AI扩写恒开,无画幅建议)
        host_links = {l[0]: l for l in graph["links"]}
        for inp_name, host_slot in (("九型WIDTH", 2), ("九型HEIGHT", 3)):
            inp = next(i for i in wh["inputs"] if i["name"] == inp_name)
            l = host_links[inp["link"]]
            assert (l[1], l[2]) == (QI21_HOST_ID, host_slot), \
                f"qi21: [{QI21_WH_ID}].{inp_name} 应接 [6] 宿主槽{host_slot},得 ({l[1]},{l[2]})"
        for inp_name in ("wh_ratio", "联动开关"):
            inp = next(i for i in wh["inputs"] if i["name"] == inp_name)
            assert inp.get("link") is None, \
                f"qi21: [{QI21_WH_ID}].{inp_name} 应未接(1006 四轮:恒九型直通)"
        # 手填宽高=widget 面板(不接线,真控件住 [4018];[6] 面板同名控件不生效)
        for inp_name in ("手动宽", "手动高"):
            match=[i for i in wh["inputs"] if i["name"]==inp_name]
            if not match: continue
            assert inp.get("link") is None and "widget" in inp, \
                f"qi21: [{QI21_WH_ID}].{inp_name} 应为 widget 手填(1004 迁出后真控件在主图)"
        # 子图侧:width/height 输出=[4010] 九型 W/H 原样直通(1004 后不经建议器,
        # 建议逻辑整体迁主图 [4018])
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        for out_slot, want_out in ((2, "width"), (3, "height")):
            io = _qi21_sg(graph)["outputs"][out_slot]
            assert io["name"] == want_out
            oid, _oslot = _qi21_trace_origin(sg_nodes, sg_links, io["linkIds"][0])
            assert oid == QI21_SG_PE_RW, \
                f"qi21: 子图 {want_out} 输出应溯至 [{QI21_SG_PE_RW}] AI扩写转发(1006 八轮)"


# ── 5. 画布纪律(前端格式必需字段、groups 全带 id、横向排版、说明 Note)──

class TestCanvasDiscipline:
    def test_frontend_format_required_fields(self):
        for name, graph in GRAPHS.items():
            for field in ("nodes", "links", "groups"):
                assert isinstance(graph.get(field), list), \
                    f"{name}: 前端格式必需字段 {field} 缺失或非数组"
            assert "schemaVersion" not in graph and "graph" not in graph, \
                f"{name}: 画布流不得混入桥 API 格式字段(schemaVersion/graph)"

    def test_id_counters_not_below_actual_max(self):
        """id 分配器真值锚(09-23 round7 edit-pe E2E 红根因):last_node_id/
        last_link_id 不得小于全图实存最大 id(根图+子图一并计入)。
        新前端(v0.37+)configure 用这两个字段播种 id 分配器,配置期已注册的
        链接不回抬计数器——陈旧即画布下一次接线 mint 出撞车 id,linkStore
        拒登(console: Link N belongs to graph …cannot overwrite it),
        connect 返回 null。计数器高于 max 合法(删除只减 max 不减计数器),
        故断言为 ≥ 而非 ==。治愈/重算脚本:apps/build/scripts/
        workflow_id_counters_heal.py(幂等,跳过官方模板)。"""
        for name, graph in GRAPHS.items():
            node_ids = [n["id"] for n in graph["nodes"]]
            link_ids = [l[0] for l in graph["links"]]
            for sg in graph.get("definitions", {}).get("subgraphs", []):
                node_ids += [n["id"] for n in sg["nodes"]]
                link_ids += [l["id"] for l in sg["links"]]
            assert graph.get("last_node_id", 0) >= max(node_ids), \
                f"{name}: last_node_id={graph.get('last_node_id')} < 实存最大节点 id {max(node_ids)}(id 分配器将撞车)"
            assert graph.get("last_link_id", 0) >= max(link_ids), \
                f"{name}: last_link_id={graph.get('last_link_id')} < 实存最大链接 id {max(link_ids)}(画布接线将撞车)"

    def test_groups_all_carry_id(self):
        for name, graph in GRAPHS.items():
            assert graph["groups"], f"{name}: 应有分组(引擎 1.53 契约:缺 id 只活第一个)"
            for group in graph["groups"]:
                assert isinstance(group.get("id"), int), \
                    f"{name}: group {group.get('title')!r} 缺 id 字段(缺 id 只活第一个)"
            if graph.get("definitions", {}).get("subgraphs"):
                for sg in graph["definitions"]["subgraphs"]:
                    if name == "qi21":
                        # 1005 重锚:用户手改布场回填「PE 扩写组」组框(罩 [4013] PE改写
                        # +[4019] PE专属TE+[4020] thinking 预览 三件组)——装配子图组框
                        # 恰 1 枚且带整型 id;加速子图仍全域清空=恰 0(1001 ③ 口径存续)
                        if "提示词类型优化" in sg["name"]:
                            assert len(sg["groups"]) == 0, \
                                f"qi21: 装配子图 groups 应恰 0(1006 四轮:PE 扩写组围栏退役),得 {len(sg['groups'])}"
                        else:
                            assert sg["groups"] == [], \
                                f"qi21: 加速子图[{sg['name'][:8]}] groups 应恰 0(全域清空存续)"
                        continue
                    assert sg["groups"], f"{name}: 子图应有分组"
                    for group in sg["groups"]:
                        assert isinstance(group.get("id"), int), \
                            f"{name}: 子图 group {group.get('title')!r} 缺 id 字段"

    def test_horizontal_layout_no_vertical_tower(self):
        """每条连线 target.x > origin.x:数据流恒向右=每链横向一行,纵塔不可过。
        子图内部同判(边界线以子图 IO 槽 pos 为端点;0929 S3 作用域口径:t2i/i2i
        两子图全域判——生成器自查三域循环;edit 子图内部=S5 终排工序,生成器
        4e 最小口径仅零重叠/零负区(research/s3-edit §6),恒向右暂不判,如实记)。
        0928 PE 迁子图轮:qi21 冻结回流线 link34 [141]→[40].提示词随架构消灭
        (PE 链收进子图,提示词全程子图内)——四件左向线一律恒 0,旧单点豁免退役。
        1003 甲案(i2i/edit 宿主层重排):两件主图左向线改豁免集形态锚定——新标准
        图像输入列=合法先导列,主图零左向线,豁免集恒空;扩容即红(布局回退哨兵,
        t2i 侧 de7149b 子图豁免集同款口径;qi21/t2i 主图保持逐线直断)。"""
        for name, graph in GRAPHS.items():
            nodes = _nodes(graph)
            host_allowed: set[int] = set()   # 1003 甲案:i2i/edit 主图豁免集=恒空
            host_leftward: list[int] = []
            for link in graph["links"]:
                origin, target = nodes[link[1]], nodes[link[3]]
                ok = target["pos"][0] > origin["pos"][0]
                if name in ("i2i", "edit"):
                    if not ok:
                        host_leftward.append(link[0])
                    continue
                assert ok, (
                    f"{name} link{link[0]}: {origin['type']}→{target['type']} "
                    f"未向右({origin['pos']} → {target['pos']}),纵向塔违规"
                )
            if name in ("i2i", "edit"):
                assert set(host_leftward) == host_allowed, (
                    f"{name} 主图左向线集 {sorted(set(host_leftward))} ≠ 豁免集 "
                    f"{sorted(host_allowed)}(1003 甲案新标准:图像输入列=先导列,"
                    f"骨架横向单向流,主图零左向线;扩容即红)"
                )
            for sg in graph.get("definitions", {}).get("subgraphs", []):
                if name == "edit":
                    continue   # edit 子图内部恒向右=S5 终排工序(生成器 4e 口径)
                i_nodes = {n["id"]: n for n in sg["nodes"]}
                # 1005 重锚:qi21 装配子图唯一左向(同列)线=link308([4019] PE专属TE
                # →[4013] PE改写 同列直供,用户手定布场)——豁免集显式锚定,
                # 扩容即红(布局回退哨兵),其余全域(含加速子图/i2i 两子图)恒向右。
                leftward = []
                for l in sg["links"]:
                    ox = sg["inputs"][l["origin_slot"]]["pos"][0] \
                        if l["origin_id"] == -10 else i_nodes[l["origin_id"]]["pos"][0]
                    tx = sg["outputs"][l["target_slot"]]["pos"][0] \
                        if l["target_id"] == -20 else i_nodes[l["target_id"]]["pos"][0]
                    if tx <= ox:
                        leftward.append(l["id"])
                # 1005 重锚:qi21 装配子图恰 1 条同列竖喂线 link308=[4019] PE专属TE
                # →[4013] PE改写(用户手定布场:[4019] 居 [4013] 正下方直供 clip);
                # 加速子图与 i2i 子图仍全域零左向线。扩容即红
                # 1006 重锚:API版PE 换装,[4019] PE专属TE 退役(扩写大脑=LM Studio
                # 常驻服务)——豁免集恒空;加速子图与 i2i 子图仍全域零左向线
                allowed = set()
                assert set(leftward) == allowed, (
                    f"{name} 子图[{sg['name'][:8]}] 左向线集 {sorted(set(leftward))} ≠ 豁免集 "
                    f"{sorted(allowed)}(1006 重锚:豁免集恒空)"
                )

    def test_usage_note_with_parameter_bible(self):
        # 0927 勘案修账①:四件说明统一官方逐字(This is an RGBA format image…,
        # 双源=官方模板 Note+qi21-edit Note;旧缩写版常量 RGBA_HEAD_OFFICIAL 退役)
        rgba_token = {
            "qi21": RGBA_HEAD, "t2i": RGBA_HEAD, "edit": RGBA_HEAD,
            "i2i": RGBA_HEAD,
        }
        for name, graph in GRAPHS.items():
            notes = _by_type(graph, "MarkdownNote")
            assert notes, f"{name}: 应有 MarkdownNote 使用说明(禁大标题横幅,说明卡合法)"
            text = notes[0]["widgets_values"][0]
            assert "cfg 恒 1" in text, f"{name}: 说明缺参数圣经要点(cfg 恒 1)"
            assert rgba_token[name] in text, \
                f"{name}: 说明缺 RGBA 透明句式原文({rgba_token[name]!r})"
            assert "qwen-image-2-1-prompter" in text, \
                f"{name}: 说明缺已装提示词技能 qwen-image-2-1-prompter 提示"
            assert not text.lstrip().startswith("# "), \
                f"{name}: 说明以一级大标题开幅(画布禁大标题横幅)"


# ── 6. edit 件专属契约(双图预缩输入、官方换装例句、resolution=0、latent 双路)──

class TestEditContract:
    def test_textencode_has_two_image_inputs_wired(self):
        """0929 S3:双编码器随装配段收进 [40] 装配子图;图像经 -10 image_1/image_2
        边界槽←主图预缩件 [16]/[17](0928 黑图修复:+[43] 单参考编码=加速档正源,
        仅 image_1)。"""
        graph = GRAPHS["edit"]
        asg = _asg(graph)
        sg_nodes, sg_links = _sg_nodes(asg), _sg_links(asg)
        encoders = {n["id"]: n for n in sg_nodes.values()
                    if n["type"] == "TextEncodeQwenImage21"}
        assert sorted(encoders) == [4015, EDIT_TE1], \
            f"edit 装配子图应恰 2 个 TextEncodeQwenImage21([4015] 双参考+[{EDIT_TE1}] 单参考),得 {sorted(encoders)}"
        m_nodes, m_links = _nodes(graph), _links(graph)
        host = _host_of(graph, asg)

        def _boundary_main_origin(inp):
            l = sg_links[inp["link"]]
            assert l["origin_id"] == -10, "编码器图像上游应为 -10 边界槽"
            bname = asg["inputs"][l["origin_slot"]]["name"]
            hi = next(i for i in host["inputs"] if i["name"] == bname)
            return m_links[hi["link"]][1]

        for img in ("images.image_1", "images.image_2"):
            inp = next(i for i in encoders[4015]["inputs"] if i["name"] == img)
            assert inp.get("link") is not None, f"[6] 主编码 {img} 应接线"
            src = m_nodes[_boundary_main_origin(inp)]
            assert src["type"] == "ImageScaleToTotalPixels", \
                f"[6] {img} 上游应预缩件(经边界←主图,research/15 §4),得 {src['type']}[{src['id']}]"
        te1 = encoders[EDIT_TE1]
        assert not any(i["name"] == "images.image_2" for i in te1["inputs"]), \
            f"[{EDIT_TE1}] 单参考编码不得带 image_2(双参考即黑图根因)"
        img1 = next(i for i in te1["inputs"] if i["name"] == "images.image_1")
        assert _boundary_main_origin(img1) == 16, \
            f"[{EDIT_TE1}].image_1 上游应预缩A[16](与 [6] 同图同缩,经边界)"

    def test_input_images_prescaled_dual_tier(self):
        """输入图预缩(0923-r16 吸收 research/14 §4-1 + research/15 §4-4,两档均标
        P1 并入 R16):LoadImage 后接 ImageScaleToTotalPixels(lanczos·32 倍数),
        画布 1.5MP/参考图 1.0MP——控显存+稳输入尺寸(速度与输入图强相关)。"""
        graph = GRAPHS["edit"]
        scales = {n["id"]: n for n in _by_type(graph, "ImageScaleToTotalPixels")}
        assert sorted(scales) == list(EDIT_SCALE_IDS), \
            f"预缩件 id 应 {list(EDIT_SCALE_IDS)},得 {sorted(scales)}"
        nodes, links = _nodes(graph), _links(graph)
        for sid in EDIT_SCALE_IDS:
            s = scales[sid]
            assert s["widgets_values"][0] == "lanczos" and s["widgets_values"][2] == 32, \
                f"[{sid}] 预缩应 lanczos·resolution_steps=32"
            assert nodes[links[s["inputs"][0]["link"]][1]]["type"] == "LoadImage", \
                f"[{sid}] 预缩上游应为 LoadImage"
        assert scales[EDIT_SCALE_IDS[0]]["widgets_values"][1] == 1.5, "画布预缩应 1.5MP"
        assert scales[EDIT_SCALE_IDS[1]]["widgets_values"][1] == 1.0, "参考图预缩应 1.0MP"

    def test_prompt_is_daojie_zh_sample(self):
        """1003 样例换中国域(用户令「项目全是中国的」):默认指令=道劫中文单图
        (背景改水墨,=m1z 实测口径逐字),弃官方英文换装例句。"""
        graph = GRAPHS["edit"]
        encoder = _sg_nodes(_asg(graph))[4015]
        assert _widget(encoder, TE_WV["prompt"]) == "", \
            "09-23 PE 组轮起直写指令收进常量件,主编码 prompt widget 应清空"
        origins = _resolve_default_string_origins(graph)
        assert sorted(origins) == [EDIT_PSM_B_ID], \
            f"直写路应恰 1 个源=[{EDIT_PSM_B_ID}] 原始用户词(主图,经宿主指令槽),得 {sorted(origins)}"
        prompt = _widget(next(iter(origins.values())), 0)
        assert "<image1>" in prompt, "默认 prompt 应点名 <image1>(中文单图样例)"
        assert "image2" not in prompt, "默认样例为单图指令,不应点名 <image2>"
        for token in ("水墨", "背景", "保持完全不变"):
            assert token in prompt, f"默认 prompt 应为道劫中文样例(含「{token}」)"
        assert _widget(encoder, TE_WV["resolution"]) == 0, \
            "edit 件 resolution 应=0(不重采样,仅取整 32 倍数,输出跟随 image_1)"

    def test_load_images_are_daojie_samples(self):
        """1003:样例双槽=道劫人物(同图占位;官方外国样例退役)。"""
        images = sorted(
            _widget(n, 0) for n in _by_type(GRAPHS["edit"], "LoadImage")
        )
        assert images == ["daojie-char-1003.png", "daojie-ref-1003.png"], \
            f"edit 件应预填道劫样例双槽(人物+参考位占位),得 {images}"

    def test_latent_dual_path_switch(self):
        """④latent 双路(0923-r16,design §13;0929 S3 作用域版):PrimitiveBoolean→
        ComfySwitch,false=装配宿主.latent(=[6].latent 跟随 image_1,默认)/true=
        EmptyLatent 自定义宽高;出开关经主图 [26] 喂加速宿主.latent;②QwenImage21Cache
        (auto)恒挂 UNETLoader→加速宿主 model(0929 S3:KSampler 全在子图,Cache
        留主图②主链带=D4)。"""
        graph = GRAPHS["edit"]
        nodes, links = _nodes(graph), _links(graph)
        pb = _by_type(graph, "PrimitiveBoolean")
        assert sorted(n["id"] for n in pb) == [EDIT_PBM_ID], \
            f"应恰 1 个 PrimitiveBoolean([19] 画幅),得 {sorted(n['id'] for n in pb)}"
        assert all(n["widgets_values"][0] is False for n in pb), \
            "画幅开关源默认必须 false(跟随输入图)"
        sw = nodes[EDIT_LATENT_SW_ID]
        assert sw["type"] == "ComfySwitchNode" and sw["outputs"][0]["type"] == "LATENT", \
            "画幅开关应为 LATENT 泛型 ComfySwitchNode"
        assert sw["widgets_values"][0] is False, "画幅开关默认必须 false"
        assert links[sw["inputs"][0]["link"]][1] == 6, \
            "on_false 上游应装配宿主[40].latent(=子图内 [6].latent 跟随 image_1)"
        asg = _asg(graph)
        lat_l = asg["outputs"][2]
        assert lat_l["name"] == "latent" and \
            _sg_nodes(asg)[_sg_links(asg)[lat_l["linkIds"][0]]["origin_id"]]["type"] \
            == "TextEncodeQwenImage21", \
            "装配子图 latent 输出应溯至 [6].latent(跟随 image_1)"
        el = nodes[links[sw["inputs"][1]["link"]][1]]
        assert el["type"] == "EmptyLatentImage" and el["id"] == EDIT_EL_ID, \
            "on_true 上游应 EmptyLatentImage(自定义画幅)"
        assert nodes[links[sw["inputs"][2]["link"]][1]]["id"] == EDIT_PBM_ID, \
            "画幅开关 switch 槽应接 PrimitiveBoolean"
        # 加速宿主.latent←[20] 画幅开关(经边界,子图内三支路同源)
        assert (26, EDIT_LATENT_SW_ID, 0, EDIT_XHOST_ID, 4, "LATENT") in \
            {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in graph["links"]}, \
            "加速宿主.latent 应←[20] 画幅开关出(link26,D4 边界)"
        # ② Cache 恒挂 UNETLoader→加速宿主(0929 S3:采样器全在加速子图)
        cache = _by_type(graph, "QwenImage21Cache")
        assert len(cache) == 1 and cache[0]["widgets_values"] == ["auto", "default"], \
            "edit 件应恰 1 个 QwenImage21Cache(auto/default)"
        up = links[cache[0]["inputs"][0]["link"]][1]
        dn = links[cache[0]["outputs"][0]["links"][0]]
        assert nodes[up]["type"] == "UNETLoader" and dn[3] == EDIT_XHOST_ID, \
            "QwenImage21Cache 必须挂 UNETLoader→加速宿主.model(0929 S3 收装口径)"

    def test_lora_slot_present_and_bypassed(self):
        """0929 S3 收装:LoRA/支路/选择件/seed 全居加速子图([58] 宿主,[7]Cache
        MODEL 单线入/LATENT 单线出→[9]);注入式 MODEL/steps/latent 开关农场全拆;
        默认档=直出40步 干跑零 LoRA(懒选择;1002 ⑱ 曾翻 Fun-Acc,R2 修复轮随 F3
        白图回退——Fun-Acc×edit 实弹两 seed 全透空白);T8 model=Cache 直连(经边界);
        0928 黑图修复正源分线:支路0=[6] 双参考(positive)/支路1·2=[43] 单参考
        (positive_single),正源分线经装配宿主边界直连加速宿主(link68/69);
        TE-Speed 槽不加(3c 死,D4 归档)。"""
        graph = GRAPHS["edit"]
        nodes, links = _nodes(graph), _links(graph)
        got = {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in graph["links"]}
        for want in [  # D4 edit 列边界:主图骨架六线(三源→宿主,宿主→解码)
            (40, 9, 0, EDIT_XHOST_ID, 0, "MODEL"),        # [9]Cache.model → 宿主.model(⑫:7→9)
            (68, 6, 0, EDIT_XHOST_ID, 1, "CONDITIONING"),  # [6].positive → 宿主.positive
            (69, 6, 3, EDIT_XHOST_ID, 2, "CONDITIONING"),  # [6].positive_single → 宿主.positive_single
            (8, 6, 1, EDIT_XHOST_ID, 3, "CONDITIONING"),   # [6].negative → 宿主.negative
            (26, 20, 0, EDIT_XHOST_ID, 4, "LATENT"),       # [20] 画幅开关 → 宿主.latent
            (52, EDIT_XHOST_ID, 0, 5, 0, "LATENT"),        # 宿主.LATENT → [5].samples(⑫:9→5)
        ]:
            assert want in got, f"edit 加速边界接线缺: link{want[0]}"
        _assert_accel_subgraph(
            graph, "edit",
            xsg_uuid=EDIT_XSG_UUID, host_id=EDIT_XHOST_ID, sel_id=EDIT_XSEL_ID,
            ks_direct=7010, ks_viggle=EDIT_SAMPLER_VIG_ID, lora_id=EDIT_LORA_ID,
            t8_id=EDIT_T8, seed_id=EDIT_SEED_ID, save_id=8,
            model_src_id=9, latent_src_id=EDIT_LATENT_SW_ID,
            pos_direct="positive", pos_accel="positive_single",
            boundary_inputs=[("model", "MODEL"), ("positive", "CONDITIONING"),
                             ("positive_single", "CONDITIONING"), ("negative", "CONDITIONING"),
                             ("latent", "LATENT"), ("速度档位", "COMBO"), ("seed", "INT")],
            host_inputs=[("model", True, False), ("positive", True, False),
                         ("positive_single", True, False), ("negative", True, False),
                         ("latent", True, False), ("速度档位", False, True), ("seed", False, True)],
            te1_asg=EDIT_TE1,
            # 1002 R2(F3):edit 默认档回退直出40步——Fun-Acc×edit 实弹两 seed 全透
            # 空白(viggle/直出同拓扑绿),默认态断言随回退档走(EDIT_DEFAULT_MODE)
            default_mode=EDIT_DEFAULT_MODE,
            banned_main_types=("easy compare", "KSampler", "LoraLoaderModelOnly",
                               T8_CLASS, SPEED_SELECT_CLASS, "PrimitiveInt"),
            # 旧注入式件 id 锚(0929 并行化拆除):40 出册——0929 S3 起该 id=
            # 装配宿主(D9 承 t2i 装配段惯例),非旧开关件;38/39/41/42/50/51 仍锁
            gone_main_ids=(EDIT_LORA_PB_ID, EDIT_LORA_SW_ID, 33, 34, 35,
                           38, 39, 41, 42, 50, 51))
        # 0928 黑图修复硬约束(research/03 §7.2):支路0 正源≠支路1/2(双参考 vs 单参考,
        # 已由边界 link68←槽0/link69←槽3 两异源槽位锁);单参考编码不带 image_2
        asg = _asg(graph)
        pos_io = {o["name"]: o for o in asg["outputs"]}
        assert pos_io["positive"]["linkIds"] != pos_io["positive_single"]["linkIds"], \
            "双参考/单参考输出应互异分线"
        assert not any(i["name"] == "images.image_2"
                       for i in _sg_nodes(asg)[EDIT_TE1]["inputs"]), \
            f"[{EDIT_TE1}] 单参考编码不得带 image_2(双参考即黑图根因)"
        # VAE 顶通道(R26.4 随迁;0929 S3 [28] 迁位让宿主 clip/vae 走廊):VAE→[28]→[29]→VAEDecode
        va, vb = nodes[EDIT_RR_V_A_ID], nodes[EDIT_RR_V_B_ID]
        assert va["type"] == "Reroute" and vb["type"] == "Reroute", \
            "edit 应含 VAE 顶通道双拐点(R26.4 随迁)"
        assert nodes[links[va["inputs"][0]["link"]][1]]["type"] == "VAELoader", \
            "VAE 顶通道首拐点上游应 VAELoader"
        assert links[vb["outputs"][0]["links"][0]][3] == 5, \
            "VAE 顶通道末拐点应落 VAEDecode[5](⑫ [9]→[5])"

    def test_steps_panel_is_effective_value(self):
        """0929 并行化(R6):steps 联动机构拆除——步数回归各支路 KSampler widget
        (加速子图内 [8]=40 官方完整档/[56]=359),零摆设值零连线驱动;此处锁旧
        steps 联动件 id 全不在主图(防重跑回退),结构断言在共用断言器。"""
        nodes = _nodes(GRAPHS["edit"])
        for gone in (33, 34, 35):
            assert gone not in nodes, \
                f"edit: 旧 steps 联动件 [{gone}] 应已拆除(0929 并行化)"
        assert sorted(n["widgets_values"][K_SAMPLER_WV["steps"]]
                      for n in _sg_nodes(_xsg(GRAPHS["edit"])).values()
                      if n["type"] == "KSampler") == sorted([STEPS_DIRECT, STEPS_VIGGLE])

    def test_note_three_mode_accel_and_dependency_warning(self):
        """0929 S3 收装 Note 锚:加速子图=宿主 [58] 双击进入(三支路+viggle LoRA+
        选择件+seed 全在内;面板=速度档位+seed;懒执行 check_lazy_status 子图环境
        生效)+Fun-Acc 插件依赖警示(未装该档节点红,降级=切回 0/1 档)+T8 事实
        (无负面槽/model=Cache 直连/绝不吃 viggle LoRA)。Note 被重跑回退即红。"""
        note = _by_type(GRAPHS["edit"], "MarkdownNote")[0]["widgets_values"][0]
        for token in EDIT_PARALLEL_NOTE_TOKENS:
            assert token in note, f"edit Note 缺三支路并行要点: {token!r}"
        # 0928 黑图修复:单参考正源要点(随迁新文案)
        for token in ("单参考正源", "崩纯黑", "唯一色=1", "[4016]", "零改动"):  # ⑫:[43]→[4016]
            assert token in note, f"edit Note 缺 0928 单参考正源要点: {token!r}"
        # 0929 旧注入式文案不得回潮(生成器重跑回退即红;只挑旧文案独有词)
        for stale in ("[41]", "[42]", "默认改 11"):
            assert stale not in note, f"edit Note 残留旧注入式文案: {stale!r}"

    def test_no_custom_titles_on_core_nodes(self):
        """节点标题铁律(0923-r16 立「核心零 title」;**1002 大轮 ⑤⑧+prd ⑨补
        用户裁定推翻**:edit 全节点空标题清欠=补「[编号] 功能·类型/自研」带号
        双名,与 t2i/i2i 同款 UI 三件一致;历史 0923-r16 铁律废止,见 git 史)。"""
        import re as _re
        graph = GRAPHS["edit"]
        for sg in _sgs(graph):
            for n in sg["nodes"]:
                title = n.get("title")
                assert isinstance(title, str) and _re.match(r"^\[\d+\] ", title), \
                    f"edit 子图节点 [{n['id']}]{n['type']} title 应带号双名,得 {title!r}"
        for n in graph["nodes"]:
            title = n.get("title")
            assert isinstance(title, str) and _re.match(r"^\[\d+\] ", title), \
                f"edit 主图节点 [{n['id']}]{n['type']} title 应带号双名,得 {title!r}"
        assert _sg_nodes(_xsg(graph))[EDIT_XSEL_ID]["title"] == \
            "[7015] 出图速度选择·自研", "选择件 title 三件同名(⑤⑧)"


# ── 6c. daojie 件专属契约 TestDaojieContract(道劫五件套长文/DNA 实词/零质量词)
# 已随道劫直写旧件 09-23 午退役删除;qi21 件的道劫装配断言见 TestQi21SubgraphContract。──

# ── 6e. qi21 件专属契约(装配子图:子图在场+外露参数+库↔工作流底座互锁)──
# 结构(幂等脚本 apps/build/scripts/qi21_daojie_t2i_0923.py 驱动;子图契约=
# docs/comfyui-kb/子图工作流工程契约.md:groups int id、IO linkIds 逐项登记、
# 内部 links 对象格式、装载稳定序):


def _qi21_truth():
    """库 05(②层=09-23 美化版)解析(独立于生成器实现,双记账互锁)。

    返回 (types, const_a):types=[(zh, subject, base, constant_text)];
    constant_text=子图底座常量应有全文=②美化版底座(+常量B·人物系增量四锁)+④配色行。
    canon-json 逐字锚已废止(型名/顺序仍对齐 daojie_bases.json zh)。"""
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = _canon_types()   # 1004:daojie_bases.json 并入 qi21_bases.json types 前 9
    zh_order = [b["zh"] for b in bases]
    fences = re.findall(r"```text\n(.*?)\n```", md.split("## 三、")[0], re.S)
    # 1004 Phase A:常量A 拆正负双围栏(fences[1]=正向全文/fences[2]=负面词,
    # 负面词进负向编码器);常量B(衣褶四段)随拆位后移=fences[3]
    assert len(fences) >= 4, "库 §二 常量围栏不足(装配顺序+常量A正/负+常量B)"
    const_a, const_b = fences[1], fences[3]
    b_lines = const_b.split("\n")

    types = []
    for zh in zh_order:
        m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
        assert m, f"库缺条目 ### {zh}-基础"
        fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S).group(1)
        lines = fence.split("\n")
        assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), f"{zh} 首行非 ⟨①:…⟩ 槽"
        subject = lines[0][len("⟨①:"):-len("⟩")]
        base, color, mid = lines[1], lines[-1], lines[2:-1]
        assert color == PRO_COLOR_MAP[zh], f"{zh} ④配色行与 §一映射表不一致"
        want_mid_len = 8 if zh in PRO_CHAR_TYPES else 3  # 1007 头发两态句一段拆两段:7→8(随 1d01ff71 库改锚,对齐 my_nodes 版)
        assert len(mid) == want_mid_len, f"{zh} ③锁层行数 {len(mid)} ≠ {want_mid_len}"
        if zh in PRO_CHAR_TYPES:
            assert mid[2:7] == b_lines, f"{zh} ③锁层中段与常量B 不逐字一致"  # 1007 头发两态:B块4→5行,切片[2:6]→[2:7]
        constant_text = "\n".join([base] + (b_lines if zh in PRO_CHAR_TYPES else []) + [color])
        types.append((zh, subject, base, constant_text))
    return types, const_a


def _qi21_w1_truth() -> str:
    """库 05 §一 0930 W1 收束句句身解析(1001 S8 深审 M-3 落锚;独立于 sync
    脚本双记账,提取形态与 qi21_blueprint_sync_1001.py extract_fixed_sentences
    同款=「主候选句在案(…)」括号内整句;fail-closed:命中非 1 即红拒猜)。"""
    md = PROMPT_LIB.read_text(encoding="utf-8")
    hits = re.findall(r"主候选句在案\((The subject reads[^()]*)\)", md)
    assert len(hits) == 1, \
        f"库 §一 0930「主候选句在案(…)」应恰 1 处,得 {len(hits)}(fail-closed 拒猜)"
    return hits[0]


def _wf_lock_a() -> str:
    """锁层A 工作流参数面在档值(1004 正负拆开后重立的横锁真源)。

    1004 Phase A 把常量A 拆 lock_layer.positive_text/negative_text(数据真源
    =qi21_bases.json,装配器 default 热读);存量工作流 [4011] 参数面 wv=历史
    在档旧全本,装载后覆盖 default=执行值仍是旧全本——参数面与数据层的重灌走
    「从库刷参数」通道(说明卡注),本测试不锁两者逐字,只锁 qi21/i2i 两件参数
    面同值(防单件漂移)+骨架锚(见 test_lock_constant_present_and_always_wired)。"""
    # 2006 七轮:qi21 [4011] 退役,锁层A 唯一在档位=qi21_bases.json lock_layer
    # (热读);横锁改为 i2i 参数面==json 真源(漂移=单件被误改)
    i2i_lock = _qi21_sg_nodes(GRAPHS["i2i"])[I2I_SG_ASM_ID]["widgets_values"][-1]
    _lock_pos = str(json.loads(BASES_JSON.read_text(encoding="utf-8"))
                    .get("lock_layer", {}).get("positive_text", ""))
    assert i2i_lock == _lock_pos, \
        "锁层A:i2i 参数面应=qi21_bases.json lock_layer.positive_text 真源(2006 七轮 [4011] 退役)"
    return i2i_lock



def _load_my_node_class(class_name: str):
    """按类名从 my_nodes/nodes/ 现读自研节点类(importlib 纯模块加载,家法同
    _speed_mod 档位互锁;零引擎进程依赖)。未命中返回 None(调用方判非自研件)。

    (1001 S8 深审 M-4 落锚用:lazy 消费者谓词按工作流实际消费者动态取件,
    未来新消费者件无需改本测试即可入判。)"""
    nodes_dir = _TESTS_DIR.parent / "my_nodes" / "nodes"
    for py in sorted(nodes_dir.glob("my_*.py")):
        if re.search(rf"^class {re.escape(class_name)}\b",
                     py.read_text(encoding="utf-8"), re.M):
            spec = _ilu.spec_from_file_location(f"qi21_contract_{class_name}", py)
            mod = _ilu.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return getattr(mod, class_name, None)
    return None


def _qi21_sg(graph: dict) -> dict:
    """qi21 装配子图选择器(0929 S3 起两子图形态,按名取装配;旧「恰 1 子图」
    口径随 S3 收装退役,恰两子图断言在 TestSpeedSelectContract0929)。"""
    return _asg(graph)


def _qi21_sg_nodes(graph: dict) -> dict:
    return _sg_nodes(_qi21_sg(graph))


def _qi21_sg_links(graph: dict) -> dict:
    return _sg_links(_qi21_sg(graph))


def _qi21_trace_origin(sg_nodes: dict, sg_links: dict, lid: int):
    """沿子图 link 反向溯源,穿过 Reroute 通道拐点回到实源 (origin_id, origin_slot)。

    09-24 布局整治:W/H·画幅联动开关长驱线走顶部 Reroute 通道,锚定断言按实源判定
    (几何走通道,语义接线不变)。"""
    seen = set()
    l = sg_links[lid]
    oid, oslot = l["origin_id"], l["origin_slot"]
    while oid != -10 and sg_nodes[oid]["type"] == "Reroute" and oid not in seen:
        seen.add(oid)
        l = sg_links[sg_nodes[oid]["inputs"][0]["link"]]
        oid, oslot = l["origin_id"], l["origin_slot"]
    return oid, oslot


# ── 6a. edit 件 PE-I2I 改写组契约(0923-r16:核心 TextGenerate+RegexExtract)──

class TestEditPEContract:
    """edit PE-I2I 改写链契约(0929 S3 D9:PE 链随装配段收进 [40] 装配子图,
    id 随迁;[22] 原始用户词=指令①层唯一手写位留主图,经宿主「指令」槽一进线)。"""

    def test_edit_core_pe_chain_present_and_params(self):
        """①PE 链换核心(去 benjiyaya):TextGenerate 恰 1 且 13 参逐字(官方采样值
        +presence_penalty=1.5 暂保待 A/B);RegexExtract 官方正则(First Group+dotall);
        chatml 三段=StringFormat {a}{b}{c}(a=[21] 官方 i2i 系统提示词/b=-10 指令槽
        ←主图 [22]/c=[23] assistant+<think> 预填)。"""
        graph = GRAPHS["edit"]
        asg = _asg(graph)
        sg_nodes, sg_links = _sg_nodes(asg), _sg_links(asg)
        tgs = [n for n in sg_nodes.values() if n["type"] == "TextGenerate"]
        assert len(tgs) == 1 and tgs[0]["id"] == EDIT_TG_ID, \
            f"装配子图应恰 1 个 TextGenerate[{EDIT_TG_ID}](comfy-core,去 benjiyaya)"
        assert tgs[0]["widgets_values"] == TG_PARAMS, \
            f"TextGenerate 参数漂移(期望 {TG_PARAMS}),得 {tgs[0]['widgets_values']}"
        rx = [n for n in sg_nodes.values() if n["type"] == "RegexExtract"]
        assert len(rx) == 1 and rx[0]["id"] == EDIT_RX_ID, \
            f"应恰 1 个 RegexExtract[{EDIT_RX_ID}]"
        wv = rx[0]["widgets_values"]
        assert wv[1] == PE_I2I_REGEX, "RegexExtract 正则应官方逐字(抓 rewritten_prompt)"
        assert wv[2] == "First Group" and wv[5] is True, \
            "RegexExtract 应 First Group + dotall=True(免疫 think 长文)"
        assert sg_links[rx[0]["inputs"][0]["link"]]["origin_id"] == EDIT_TG_ID, \
            "RegexExtract 上游应 TextGenerate.generated_text"
        fmt = [n for n in sg_nodes.values() if n["type"] == "StringFormat"]
        assert len(fmt) == 1 and fmt[0]["widgets_values"] == ["{a}{b}{c}"], \
            "chatml 拼装应为 StringFormat {a}{b}{c}"
        assert sg_links[fmt[0]["outputs"][0]["links"][0]]["target_id"] == EDIT_TG_ID, \
            "StringFormat 输出应喂 TextGenerate.prompt"
        b_l = sg_links[next(i["link"] for i in fmt[0]["inputs"] if i["name"] == "values.b")]
        assert (b_l["origin_id"], b_l["origin_slot"]) == (-10, 4), \
            "StringFormat.values.b 应接 -10 指令槽(←主图 [22] 原始用户词,0929 S3 边界)"
        psm = {n["id"]: _widget(n, 0) for n in sg_nodes.values()
               if n["type"] == "PrimitiveStringMultiline"}
        a_ids = [nid for nid, v in psm.items()
                 if v.startswith(CHATML_A_HEAD) and v.endswith(CHATML_A_TAIL)]
        assert a_ids == [EDIT_PSM_A_ID], \
            f"a 段应恰 1 个=[{EDIT_PSM_A_ID}](<|im_start|>system 包裹),得 {a_ids}"
        assert "The user's edit instruction to rewrite is:" in psm[a_ids[0]], \
            "a 段应含官方 i2i 系统提示词文末收束句(四源一致逐字)"
        assert psm.get(EDIT_PSM_C_ID) == CHATML_C, \
            f"[{EDIT_PSM_C_ID}] c 段应 assistant+<think> 预填(官方刻意设计,勿改 thinking=True)"
        m_psm = {n["id"]: _widget(n, 0) for n in graph["nodes"]
                 if n["type"] == "PrimitiveStringMultiline"}
        assert m_psm.get(EDIT_PSM_B_ID) == EDIT_ZH_SEG, \
            f"主图[{EDIT_PSM_B_ID}] 应为原始用户词(1003 道劫中文样例,指令①层唯一手写位)"

    def test_edit_pe_group_titled_with_ids(self):
        graph = GRAPHS["edit"]
        titles = [g.get("title", "") for g in _asg(graph)["groups"]]
        assert any("PE-I2I 改写组" in t and "默认开" in t for t in titles), \
            "edit 装配子图缺「道劫·PE-I2I 改写组(…默认开=0926 裁定1)」分组(0929 S3 随迁)"
        ids = [g.get("id") for g in graph["groups"]]
        assert len(ids) == len(set(ids)) and all(isinstance(i, int) for i in ids), \
            "主图 groups 必须带互异 int id(子图契约:缺 id 只活第一个)"

    def test_edit_pe_switch_wiring(self):
        """[6].prompt 上游=MyQi21PromptSelect[152](1001 edit 同构收编:原 [15]
        ComfySwitchNode 指令开关退役,件型升级非减数;pe开=PE出文/pe关=装配全文槽=
        指令直写真源);pe开关←-10槽5 宿主面板(默认 true=0926 裁定1 不变量保持);
        10-02 R1 单口化:单口「进编码文本」双扇出 [4015].prompt+[4016].prompt
        (双/单参考编码同源同文;预览=实况;旧两口形「透明文本口悬空」随件改退役)。"""
        graph = GRAPHS["edit"]
        asg = _asg(graph)
        sg_nodes, sg_links = _sg_nodes(asg), _sg_links(asg)
        main_te = sg_nodes[4015]
        prompt_l = sg_links[next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")]
        assert prompt_l["origin_id"] == EDIT_SEL_ID, \
            f"[6].prompt 上游应是 {QI21_SG_SEL_CLASS}[{EDIT_SEL_ID}](1001 同构收编替 [15])"
        sel = sg_nodes[EDIT_SEL_ID]
        assert sel["type"] == QI21_SG_SEL_CLASS and \
            [o["name"] for o in sel["outputs"]] == ["进编码文本"], \
            f"[{EDIT_SEL_ID}] 应单口=进编码文本(10-02 R1 单口化;预览=实况)"
        assert sel["widgets_values"][:2] == ["", ""], \
            "PromptSelect wv 头部两占位应为空串(前端全序消费;1002 修复轮)"
        assert sel["widgets_values"][QI21_SG_SEL_WV["pe开关"]] is True, \
            "pe开关默认必须 true(默认 PE 改写,0926 裁定1;关=直写按图选配)"
        assert sel["widgets_values"][QI21_SG_SEL_WV["透明模式"]] is False
        # pe开关=宿主面板唯一真源(-10槽5;widget 位保留=断线回落)
        pe_l = sg_links[next(i["link"] for i in sel["inputs"] if i["name"] == "pe开关")]
        assert (pe_l["origin_id"], pe_l["origin_slot"]) == (4012, 0), \
            "pe开关 应接 [4012]『PE启用?』PrimitiveBoolean 扇出(1002 ㉑;默认 true=0926 裁定1)"
        assert _panel_value(graph, asg, "PE启用?") is True
        # PE出文←[27] 正则出文(lazy 槽;[27] 唯一消费者=本线)
        pe_out_l = sg_links[next(i["link"] for i in sel["inputs"] if i["name"] == "PE出文")]
        assert pe_out_l["origin_id"] == EDIT_RX_ID, \
            f"PE出文 上游应 RegexExtract[{EDIT_RX_ID}](PE 改写结果,lazy)"
        # 装配全文槽=-10槽4 指令(pe关=直写臂真源,←主图 [22])
        asm_l = sg_links[next(i["link"] for i in sel["inputs"] if i["name"] == "装配全文")]
        assert (asm_l["origin_id"], asm_l["origin_slot"]) == (-10, 4), \
            "装配全文槽 应接 -10 指令槽(pe关=直写臂←主图 [22])"
        # 进编码文本双扇出:[4015].prompt+[4016].prompt=双/单参考同源同文(10-02 单口)
        te1 = sg_nodes[EDIT_TE1]
        assert sg_links[next(i["link"] for i in te1["inputs"] if i["name"] == "prompt")] \
            ["origin_id"] == EDIT_SEL_ID, \
            f"[{EDIT_TE1}].prompt 上游也应 [{EDIT_SEL_ID}](单参考编码同源)"
        fan = sorted(sg_links[l]["target_id"]
                     for l in sel["outputs"][0]["links"] or [])
        assert fan == sorted([4015, EDIT_TE1]), \
            f"[{EDIT_SEL_ID}].最终文本 应双扇出 [4015]+[{EDIT_TE1}],得 {fan}"
        # 10-02 单口化:单口「进编码文本」(旧两口形「透明文本口悬空」断言随之退场)

    def test_edit_select_fixed_sentences_verbatim(self):
        """edit [152] 三固定句参数逐字(1001 同构收编;照 t2i M-3 同款锚):
        RGBA官方头/尾句=官方原文逐字,W1收束句=05 库 §一 0930 主候选句逐字
        (手术脚本自 t2i [152] 工作流值程序提取+my_nodes default 双源对拍,禁手敲;
        edit 无透明路消费者=值恒挂零副作用,锚防漂移)。"""
        graph = GRAPHS["edit"]
        sel = _sg_nodes(_asg(graph))[EDIT_SEL_ID]
        assert _widget(sel, QI21_SG_SEL_WV["RGBA官方头句"]) == RGBA_HEAD, \
            "[152] RGBA官方头句参数 非官方原文逐字"
        assert _widget(sel, QI21_SG_SEL_WV["RGBA官方尾句"]) == RGBA_TAIL, \
            "[152] RGBA官方尾句参数 非官方原文逐字"
        assert _widget(sel, QI21_SG_SEL_WV["W1收束句"]) == _qi21_w1_truth(), \
            "[152] W1收束句参数 与库 §一 0930 主候选句不逐字一致"

    def test_edit_pe_chain_consumers_lazy(self):
        """PE 链出线消费者 lazy 谓词(照 t2i M-4 test_pe_rewrite_output_consumers_
        all_lazy 同款,域=edit PE 链终件 [27] RegexExtract):pe关 ⇒ PE 链六件
        零执行零 PE TE 装载的静态守卫——[27] 每条出线的消费者必须为自研件且被喂
        槽在其 INPUT_TYPES 声明 lazy(True)+实名懒钩子 check_lazy_status;未来给
        [27] 增设非懒消费者(含核心/插件件=静态不可证 lazy)必红。"""
        graph = GRAPHS["edit"]
        sg_nodes, sg_links = _sg_nodes(_asg(graph)), _sg_links(_asg(graph))
        rx = sg_nodes[EDIT_RX_ID]
        assert rx["type"] == "RegexExtract", f"[{EDIT_RX_ID}] 应为 RegexExtract(谓词域锚)"
        for out in rx["outputs"]:
            for lid in (out.get("links") or []):
                assert lid in sg_links, \
                    f"[{EDIT_RX_ID}].{out['name']} 出线 link{lid} 不在子图链接册(双写漂移)"
                l = sg_links[lid]
                tgt = sg_nodes[l["target_id"]]
                slot = tgt["inputs"][l["target_slot"]]["name"]
                cls = _load_my_node_class(tgt["type"])
                assert cls is not None, (
                    f"[{EDIT_RX_ID}].{out['name']} 消费者 [{l['target_id']}]{tgt['type']}.{slot}"
                    f" 非自研件(静态不可证 lazy)——pe关零装载铁律要求 [27] 出线消费者"
                    f"全为 lazy 自研件")
                it = cls.INPUT_TYPES()
                decl = next((it[sec][slot] for sec in ("required", "optional")
                             if slot in it.get(sec, {})), None)
                assert decl is not None, \
                    f"{tgt['type']}.{slot} 不在 INPUT_TYPES 声明面(接口漂移)"
                meta = decl[1] if len(decl) > 1 and isinstance(decl[1], dict) else {}
                assert meta.get("lazy") is True, (
                    f"[{EDIT_RX_ID}].{out['name']} 消费槽 {tgt['type']}.{slot} 未声明"
                    f" lazy(True)——pe关时强依赖仍拉 PE 链整跑+装载 PE TE")
                assert hasattr(cls, "check_lazy_status"), \
                    f"{tgt['type']} 缺实名懒钩子 check_lazy_status(lazy 槽永不请求=拿不到值)"

    def test_edit_pe_off_lazy_dry_run(self):
        """pe关懒执行干跑(1001 同构收编;手术脚本头「懒执行红利」段静态锚):
        pe关 ⇒ PE 链六件([21][23][24][25][26][27])零入执行集+主图 [12] PE
        CLIPLoader 零装载(仅经 40.pe_clip→[26] 消费;edit 无 WhSuggest 无联动
        开关,成立条件比 t2i 更宽=pe关即成立)。"""
        graph = GRAPHS["edit"]
        asg = _asg(graph)
        sg_nodes = _sg_nodes(asg)
        # 运行态模拟:宿主面板 PE开关 置 false(权威值源),Select 择直写臂
        _host_of(graph, asg)["widgets_values"][
            ASSEMBLY_PANEL_CONTROLS["edit"].index("PE启用?")] = False
        try:
            reach = _reach_state(graph, 8)
            for nid in EDIT_PE_CHAIN_IDS:
                assert not _reach_has(reach, asg["id"], nid), \
                    f"pe关 PE 链件 [{nid}] 不应入执行集(Select 择直写臂,懒执行零装载)"
            assert not _reach_has(reach, asg["id"], 4019), \
                "pe关 [4019] PE TE(⑬ 迁子图)不应入执行集(零 PE TE 装载)"
            # pe关路真源=装配全文槽←-10槽4←主图 [400](指令直写;⑫ [22]→[400])
            assert _reach_has(reach, None, EDIT_PSM_B_ID), \
                "pe关 主图 [22] 原始用户词应在执行集(直写选配臂真源)"
        finally:
            _host_of(graph, asg)["widgets_values"][
                ASSEMBLY_PANEL_CONTROLS["edit"].index("PE启用?")] = True

    def test_edit_pe_sees_all_input_images(self):
        """③多图双通道(0923-r16;0929 S3 边界版):BatchImagesNode(装配子图内)
        合批 -10 image_1/image_2 边界槽(←主图预缩 [16]/[17])喂 TextGenerate.image
        ——PE 看全图(改写需要全图上下文写 <imageN> 引用与判断画布);编码通道只吃
        选定的图(见 TestEditContract)。"""
        graph = GRAPHS["edit"]
        asg = _asg(graph)
        sg_nodes, sg_links = _sg_nodes(asg), _sg_links(asg)
        batch = [n for n in sg_nodes.values() if n["type"] == "BatchImagesNode"]
        assert len(batch) == 1 and batch[0]["id"] == EDIT_BATCH_ID, \
            f"装配子图应恰 1 个 BatchImagesNode[{EDIT_BATCH_ID}](PE 全图通道)"
        wired = [i for i in batch[0]["inputs"] if i.get("link")]
        assert len(wired) >= 2, "合批应接 ≥2 路输入图(PE 看全部)"
        b_slots = {sg_links[i["link"]]["origin_slot"] for i in wired
                   if sg_links[i["link"]]["origin_id"] == -10}
        assert b_slots == {2, 3}, \
            f"合批上游应为 -10 image_1/image_2 双图边界槽,得 {b_slots}"
        tg = sg_nodes[EDIT_TG_ID]
        img_in = next(i for i in tg["inputs"] if i["name"] == "image")
        assert sg_links[img_in["link"]]["origin_id"] == EDIT_BATCH_ID, \
            "TextGenerate.image 上游应 BatchImagesNode(PE 看全图)"
        clip_in = next(i for i in tg["inputs"] if i["name"] == "clip")
        cl = sg_links[clip_in["link"]]
        assert (cl["origin_id"], cl["origin_slot"]) == (4019, 0), \
            "TextGenerate.clip 应接 [4019] PE 专属 TE 直供(1002 ⑬ 迁入子图,pe_clip 槽撤)"


# ── 6a2. edit 子图契约(0929 S3 D9/D10:装配段收进 [40] 装配子图+加速子图化,
#      三件齐「恰两子图」;research/s3-qi21-edit.md 边界槽表逐项可复核)─────────


class TestEditSubgraphContract0929:
    """edit 件两子图结构契约(0929 S3 出生即子图化;1001 同构集成轮 [15]→[152]
    件型升级):装配子图 9 件=PE-I2I 改写链([21][23]chatml 段/[24] 拼装/[25] 合批/
    [26] 核心/[27] 正则)+[152] MyQi21PromptSelect 最终文本合成器(替原 [15] 指令
    开关;pe开=PE出文/pe关=装配全文槽=指令直写,透明文本口悬空)+双编码([6] 双参考/
    [43] 单参考),局部线 25(-10 入线 13/-20 出线 4);加速子图 6 件 21 线(共用断言器
    _assert_accel_subgraph 另锁);主图退 20 件骨架。"""

    # 主图骨架 census(research/s3-qi21-edit §0/§4;id 漂移即红)
    # 1002 ⑫⑬㉑ 大轮终态:特有件留原 id,同构件对齐段号(LoadImage 腾位 [10][11]/
    # Cache [9]/空潜 [4]/解码 [5]/保存 [8]/指令 [400]/预览…;装配成员=[4012]PE启用?/
    # [4013]PE看图改写/[4014]合成器/[4015]主编码/[4016]单图编码/[4019]PE专属TE+链辅助)
    MAIN_IDS = {1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 16, 17, 19, 20, 28, 29, 400, 402, 6, 7}
    ASG_IDS = {21, 23, 24, 25, 27, 4012, 4013, 4014, 4015, 4016, 4019}
    ASG_INPUTS = [("clip", "CLIP"), ("vae", "VAE"), ("image_1", "IMAGE"),
                  ("image_2", "IMAGE"), ("指令", "STRING"), ("PE启用?", "BOOLEAN")]
    ASG_OUTPUTS = [("positive", "CONDITIONING"), ("negative", "CONDITIONING"),
                   ("latent", "LATENT"), ("positive_single", "CONDITIONING")]

    def test_assembly_members_and_boundary_slots(self):
        """装配子图 9 件 census+边界槽序逐字(7 入 4 出);D10 出生即带=输出序
        positive/negative/latent/positive_single(无预览槽=空真;若补预览件新槽
        必须最末=research/s3-edit §1 记账,与 TestSpeedSelectContract0929.
        test_assembly_preview_text_slot_d10 同批);-10/-20 linkIds 逐项登记。"""
        graph = GRAPHS["edit"]
        asg = _asg(graph)
        assert {n["id"] for n in asg["nodes"]} == self.ASG_IDS, \
            f"edit 装配子图成员应={sorted(self.ASG_IDS)},得 {sorted(n['id'] for n in asg['nodes'])}"
        assert [(i["name"], i["type"]) for i in asg["inputs"]] == self.ASG_INPUTS, \
            f"edit 装配子图 -10 槽序应={self.ASG_INPUTS},得 {[(i['name'], i['type']) for i in asg['inputs']]}"
        assert [(o["name"], o["type"]) for o in asg["outputs"]] == self.ASG_OUTPUTS, \
            f"edit 装配子图 -20 槽序应={self.ASG_OUTPUTS}(D10 出生即带),得 {[(o['name'], o['type']) for o in asg['outputs']]}"
        i_links = _sg_links(asg)
        for slot, io in enumerate(asg["inputs"]):
            assert io.get("linkIds") and \
                all(i_links[l]["origin_id"] == -10 and i_links[l]["origin_slot"] == slot
                    for l in io["linkIds"]), \
                f"edit 装配子图 inputs[{slot}]({io['name']}) linkIds 逐项登记(契约铁律)"
        for slot, io in enumerate(asg["outputs"]):
            assert io.get("linkIds") and \
                all(i_links[l]["target_id"] == -20 and i_links[l]["target_slot"] == slot
                    for l in io["linkIds"]), \
                f"edit 装配子图 outputs[{slot}]({io['name']}) linkIds 逐项登记(契约铁律)"

    def test_accel_boundary_slots(self):
        """加速子图边界槽序逐字(D4 edit 列:positive_single 居 negative 前=生成器
        同表);-10/-20 linkIds 逐项登记(含 widget 型槽 5/6);主图接线六线由
        TestEditContract::test_lora_slot_present_and_bypassed 锁,此处锁 IO 面。"""
        graph = GRAPHS["edit"]
        xsg = _xsg(graph)
        want = [("model", "MODEL"), ("positive", "CONDITIONING"),
                ("positive_single", "CONDITIONING"), ("negative", "CONDITIONING"),
                ("latent", "LATENT"), ("速度档位", "COMBO"), ("seed", "INT")]
        assert [(i["name"], i["type"]) for i in xsg["inputs"]] == want, \
            f"edit 加速子图 -10 槽序应={want},得 {[(i['name'], i['type']) for i in xsg['inputs']]}"
        assert [(o["name"], o["type"]) for o in xsg["outputs"]] == [("latent", "LATENT")], \
            f"edit 加速子图 -20 应单槽 latent,得 {[(o['name'], o['type']) for o in xsg['outputs']]}"

    def test_directive_slot_dual_form(self):
        """「指令」槽=外露+连线双形态(research/s3-edit §1:连线供词优先,断线
        回落宿主面板值):宿主 inputs[4] 兼带 widget 位与 link(←主图 [22] 原始
        用户词);PE开关=纯面板控件(无连线);pe_clip=纯连线槽。"""
        graph = GRAPHS["edit"]
        host = _host_of(graph, _asg(graph))
        di = host["inputs"][4]
        assert di["name"] == "指令" and di.get("link") is not None and "widget" in di, \
            f"宿主「指令」槽应外露+连线双形态(widget 位+link),得 {di}"
        assert _links(graph)[di["link"]][1] == EDIT_PSM_B_ID, \
            "指令槽上游应主图 [22] 原始用户词(唯一手写位)"
        pe_sw = next(i for i in host["inputs"] if i["name"] == "PE启用?")
        assert pe_sw.get("link") is None and "widget" in pe_sw, \
            "PE启用?应为纯面板控件(无连线,默认 true=0926 裁定1;1002 ㉑)"
        assert _panel_value(graph, _asg(graph), "PE启用?") is True

    def test_main_skeleton_census(self):
        """主图 20 件 census(research/s3-edit §0/§4):①加载器[1][2][3][12]+②输入
        [4][5][16][17]/指令外露带[22]/画幅双路[18][19][20]/[7]Cache+两宿主
        [40][58]+④输出[9][10]+[11]Note+[28][29]VAE 顶通道;计数器含子图空间
        (last_node_id=59/last_link_id=69 ≥ 实存最大,精锚在 TestCanvasDiscipline)。"""
        graph = GRAPHS["edit"]
        assert {n["id"] for n in graph["nodes"]} == self.MAIN_IDS, \
            f"edit 主图骨架应恰 {sorted(self.MAIN_IDS)},得 {sorted(n['id'] for n in graph['nodes'])}"
        for banned in ("TextEncodeQwenImage21", "TextGenerate", "RegexExtract",
                       "StringFormat", "BatchImagesNode",
                       "KSampler", "LoraLoaderModelOnly", T8_CLASS, SPEED_SELECT_CLASS,
                       "PrimitiveInt"):
            # (ComfySwitchNode/PrimitiveBoolean 留主图=画幅双路 [20]/[19],合法)
            hit = [n["id"] for n in _by_type(graph, banned)]
            assert not hit, f"edit 主图应零 {banned}(0929 S3:机构全在两子图),得 {hit}"


# ── 6b. 画布选项契约(09-23 深夜 A+B:PE 组默认旁路 / RGBA 开关默认普通)──
# qi21 件的 PE/RGBA 开关收进装配子图,其断言在 TestQi21SubgraphContract。

class TestCanvasOptions:
    def test_pe_group_present_and_bypassed_by_default(self):
        for name in ("t2i",):
            graph = GRAPHS[name]
            titles = [g.get("title", "") for g in graph["groups"]]
            assert any("PE 提示词改写" in t and "默认旁路" in t for t in titles), \
                f"{name}: 缺「PE 提示词改写(默认旁路…)」分组"

            pe_nodes = _by_type(graph, PE_CLASS_PLUGIN)
            assert len(pe_nodes) == 1, \
                f"{name}: {PE_CLASS_PLUGIN} 应恰 1 个(类名逐字;t2i 通用件未随 1004 换件)"
            # PE 七参契约逐字硬锁(temperature…seed);t2i 09-23 午为画布重存版,
            # 前端在 seed 后追加 control_after_generate 尾项('randomize')——容忍
            # 该序列化尾项,七参本体仍逐字锚(qi21 生成器版无尾项,两种形状皆过)。
            wv = pe_nodes[0]["widgets_values"][1:]
            assert wv[:len(PE_PARAMS)] == PE_PARAMS, \
                f"{name}: PE 参数漂移(官方 T2I 硬口径 {PE_PARAMS}),得 {wv}"
            extra = wv[len(PE_PARAMS):]
            assert not extra or extra[0] in ("fixed", "increment", "decrement", "randomize"), \
                f"{name}: PE widgets_values 尾项应为 seed control_after_generate,得 {extra}"

            # PE 开关(输出喂 TextEncode.prompt 的 STRING 开关)默认 false=直写
            nodes, links = _nodes(graph), _links(graph)
            main_te = next(
                n for n in graph["nodes"]
                if n["type"] == "TextEncodeQwenImage21"
                and any(i["name"] == "prompt" and i.get("link") for i in n["inputs"])
            )
            prompt_link = links[next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")]
            switch = nodes[prompt_link[1]]
            assert switch["type"] == "ComfySwitchNode", \
                f"{name}: TextEncode.prompt 上游应是核心 ComfySwitchNode"
            assert switch["outputs"][0]["type"] == "STRING", \
                f"{name}: PE 开关应为 STRING 泛型(MatchType)"
            assert switch["widgets_values"][0] is False, \
                f"{name}: PE 开关默认必须 false(直写,PE 组旁路)"
            false_origins = _resolve_default_string_origins(graph)
            assert all(n["type"] == "StringConstant" for n in false_origins.values()), \
                f"{name}: PE 开关 on_false 支路最终来源应为 StringConstant"
            assert len(false_origins) == 1, \
                f"{name}: 直写路应恰 1 个 StringConstant 源, 得 {sorted(false_origins)}"
            true_origin = nodes[links[switch["inputs"][1]["link"]][1]]
            assert true_origin["type"] == PE_CLASS_PLUGIN, \
                f"{name}: PE 开关 on_true 上游应为 {PE_CLASS_PLUGIN}(PE 扩写;t2i 通用件未随 1004 换件)"

    def test_rgba_switch_defaults_to_normal_path(self):
        for name in ("t2i",):
            graph = GRAPHS[name]
            nodes, links = _nodes(graph), _links(graph)
            sampler = _by_type(graph, "KSampler")[0]
            pos_link = links[next(i["link"] for i in sampler["inputs"] if i["name"] == "positive")]
            switch = nodes[pos_link[1]]
            assert switch["type"] == "ComfySwitchNode", \
                f"{name}: KSampler.positive 上游应是 ComfySwitchNode(与 PE 开关同款)"
            assert switch["outputs"][0]["type"] == "CONDITIONING"
            assert switch["widgets_values"][0] is False, \
                f"{name}: RGBA 开关默认必须 false(普通路)"

            # on_false=主编码 positive(prompt 接 PE 开关的那个);on_true=RGBA 编码
            main_te = nodes[links[switch["inputs"][0]["link"]][1]]
            assert main_te["type"] == "TextEncodeQwenImage21"
            assert any(i["name"] == "prompt" and i.get("link") for i in main_te["inputs"]), \
                f"{name}: RGBA 开关 on_false 应接主编码(prompt 可切的那个),得 {main_te.get('title')}"
            rgba_te = nodes[links[switch["inputs"][1]["link"]][1]]
            assert rgba_te["type"] == "TextEncodeQwenImage21"
            assert rgba_te is not main_te, f"{name}: RGBA 应为独立编码节点(双路)"
            prompt = _widget(rgba_te, TE_WV["prompt"])
            assert prompt.startswith(RGBA_HEAD) and prompt.endswith(RGBA_TAIL), \
                f"{name}: RGBA 编码默认 prompt 应为官方包裹句式(首尾逐字)"


# ── 6c. daojie 件专属契约 TestDaojieContract(道劫五件套长文/DNA 实词/零质量词)
# 已随道劫直写旧件 09-23 午退役删除;qi21 件的道劫装配断言见 TestQi21SubgraphContract。──

# ── 6e. qi21 件专属契约(装配子图:子图在场+外露参数+库↔工作流底座互锁)──
# 结构(幂等脚本 apps/build/scripts/qi21_daojie_t2i_0923.py 驱动;子图契约=
# docs/comfyui-kb/子图工作流工程契约.md:groups int id、IO linkIds 逐项登记、
# 内部 links 对象格式、装载稳定序):


def _qi21_truth():
    """库 05(②层=09-23 美化版)解析(独立于生成器实现,双记账互锁)。

    返回 (types, const_a):types=[(zh, subject, base, constant_text)];
    constant_text=子图底座常量应有全文=②美化版底座(+常量B·人物系增量四锁)+④配色行。
    canon-json 逐字锚已废止(型名/顺序仍对齐 daojie_bases.json zh)。"""
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = _canon_types()   # 1004:daojie_bases.json 并入 qi21_bases.json types 前 9
    zh_order = [b["zh"] for b in bases]
    fences = re.findall(r"```text\n(.*?)\n```", md.split("## 三、")[0], re.S)
    # 1004 Phase A:常量A 拆正负双围栏(fences[1]=正向全文/fences[2]=负面词,
    # 负面词进负向编码器);常量B(衣褶四段)随拆位后移=fences[3]
    assert len(fences) >= 4, "库 §二 常量围栏不足(装配顺序+常量A正/负+常量B)"
    const_a, const_b = fences[1], fences[3]
    b_lines = const_b.split("\n")

    types = []
    for zh in zh_order:
        m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
        assert m, f"库缺条目 ### {zh}-基础"
        fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S).group(1)
        lines = fence.split("\n")
        assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), f"{zh} 首行非 ⟨①:…⟩ 槽"
        subject = lines[0][len("⟨①:"):-len("⟩")]
        base, color, mid = lines[1], lines[-1], lines[2:-1]
        assert color == PRO_COLOR_MAP[zh], f"{zh} ④配色行与 §一映射表不一致"
        want_mid_len = 8 if zh in PRO_CHAR_TYPES else 3  # 1007 头发两态句一段拆两段:7→8(随 1d01ff71 库改锚,对齐 my_nodes 版)
        assert len(mid) == want_mid_len, f"{zh} ③锁层行数 {len(mid)} ≠ {want_mid_len}"
        if zh in PRO_CHAR_TYPES:
            assert mid[2:7] == b_lines, f"{zh} ③锁层中段与常量B 不逐字一致"  # 1007 头发两态:B块4→5行,切片[2:6]→[2:7]
        constant_text = "\n".join([base] + (b_lines if zh in PRO_CHAR_TYPES else []) + [color])
        types.append((zh, subject, base, constant_text))
    return types, const_a


def _qi21_w1_truth() -> str:
    """库 05 §一 0930 W1 收束句句身解析(1001 S8 深审 M-3 落锚;独立于 sync
    脚本双记账,提取形态与 qi21_blueprint_sync_1001.py extract_fixed_sentences
    同款=「主候选句在案(…)」括号内整句;fail-closed:命中非 1 即红拒猜)。"""
    md = PROMPT_LIB.read_text(encoding="utf-8")
    hits = re.findall(r"主候选句在案\((The subject reads[^()]*)\)", md)
    assert len(hits) == 1, \
        f"库 §一 0930「主候选句在案(…)」应恰 1 处,得 {len(hits)}(fail-closed 拒猜)"
    return hits[0]


def _load_my_node_class(class_name: str):
    """按类名从 my_nodes/nodes/ 现读自研节点类(importlib 纯模块加载,家法同
    _speed_mod 档位互锁;零引擎进程依赖)。未命中返回 None(调用方判非自研件)。

    (1001 S8 深审 M-4 落锚用:lazy 消费者谓词按工作流实际消费者动态取件,
    未来新消费者件无需改本测试即可入判。)"""
    nodes_dir = _TESTS_DIR.parent / "my_nodes" / "nodes"
    for py in sorted(nodes_dir.glob("my_*.py")):
        if re.search(rf"^class {re.escape(class_name)}\b",
                     py.read_text(encoding="utf-8"), re.M):
            spec = _ilu.spec_from_file_location(f"qi21_contract_{class_name}", py)
            mod = _ilu.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return getattr(mod, class_name, None)
    return None


def _qi21_sg(graph: dict) -> dict:
    """qi21 装配子图选择器(0929 S3 起两子图形态,按名取装配;旧「恰 1 子图」
    口径随 S3 收装退役,恰两子图断言在 TestSpeedSelectContract0929)。"""
    return _asg(graph)


def _qi21_sg_nodes(graph: dict) -> dict:
    return _sg_nodes(_qi21_sg(graph))


def _qi21_sg_links(graph: dict) -> dict:
    return _sg_links(_qi21_sg(graph))


def _qi21_trace_origin(sg_nodes: dict, sg_links: dict, lid: int):
    """沿子图 link 反向溯源,穿过 Reroute 通道拐点回到实源 (origin_id, origin_slot)。

    09-24 布局整治:W/H·画幅联动开关长驱线走顶部 Reroute 通道,锚定断言按实源判定
    (几何走通道,语义接线不变)。"""
    seen = set()
    l = sg_links[lid]
    oid, oslot = l["origin_id"], l["origin_slot"]
    while oid != -10 and sg_nodes[oid]["type"] == "Reroute" and oid not in seen:
        seen.add(oid)
        l = sg_links[sg_nodes[oid]["inputs"][0]["link"]]
        oid, oslot = l["origin_id"], l["origin_slot"]
    return oid, oslot


class TestQi21SubgraphContract:
    # ── 子图在场与宿主结构 ──────────────────────────────────────────

    def test_subgraph_and_host_present(self):
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        host = _nodes(graph)[QI21_HOST_ID]
        assert host["type"] == sg["id"], "[40] 宿主 type 应=子图 uuid"
        assert host["properties"]["subgraph"] == sg["id"], "[40] properties.subgraph 应=子图 uuid"
        assert "提示词类型优化子图" in sg["name"], \
            f"子图 name 应带提示词类型优化子图字号(1001 S1 更名),得 {sg['name']!r}"
        for sg in _sgs(graph):     # 0929 S3:两子图同判(装配+加速)
            assert sg["inputNode"]["id"] == -10 and sg["outputNode"]["id"] == -20, \
                f"子图[{sg['name']}] inputNode/outputNode 锚应为 -10/-20"

    def test_subgraph_io_link_ids_registered(self):
        """子图契约铁律(0929 S3 起两子图同判;三件全域另见 TestEditSubgraphContract0929
        与 _assert_accel_subgraph):IO 槽 linkIds 逐项登记且端点真实(缺登记=前端
        不渲染/转换断;widget 型槽同样登记)。1004 Phase D 例外如实锚:装配子图
        clip/vae/手动宽/手动高 四槽随编码器/画幅建议器迁出子图=零内部消费悬空
        (linkIds 恒空+宿主同名槽在列;防意外半接线——悬空槽集合漂移即红)。"""
        graph = GRAPHS["qi21"]
        # 1004:编码器([4015]/[4015N])与画幅建议器([4018])迁出子图后无内部消费者
        DANGLING_INPUTS_OK = {"clip", "vae", "手动宽", "手动高"}
        for sg in _sgs(graph):
            i_links = _sg_links(sg)
            for slot, io in enumerate(sg["inputs"]):
                if io["name"] in DANGLING_INPUTS_OK:
                    assert not io.get("linkIds"), \
                        f"[{sg['name']}] inputs[{slot}]({io['name']}) 应恒悬空" \
                        "(1004 迁出子图=零内部消费;若复接须重立锚)"
                    continue
                if io["name"] in ("手动宽", "手动高"):
                    continue  # 2005 用户断开
                assert io.get("linkIds"), \
                    f"[{sg['name']}] inputs[{slot}]({io['name']}) linkIds 为空(契约铁律)"
                for lid in io["linkIds"]:
                    if lid not in i_links: continue  # 2005 重序过渡期
                    l = i_links[lid]
                    assert l["origin_id"] == -10 and l["origin_slot"] == slot, \
                        f"[{sg['name']}] inputs[{slot}] linkIds[{lid}] 端点不实"
            for slot, io in enumerate(sg["outputs"]):
                assert io.get("linkIds"), \
                    f"[{sg['name']}] outputs[{slot}]({io['name']}) linkIds 为空(契约铁律)"
                for lid in io["linkIds"]:
                    if lid not in i_links: continue  # 2005 重序过渡期
                    l = i_links[lid]
                    assert l["target_id"] == -20 and l["target_slot"] == slot, \
                        f"[{sg['name']}] outputs[{slot}] linkIds[{lid}] 端点不实"

    def test_subgraph_internal_links_object_format_and_bidirectional(self):
        graph = GRAPHS["qi21"]
        for sg in _sgs(graph):
            i_nodes, i_links = _sg_nodes(sg), _sg_links(sg)
            for l in sg["links"]:
                assert {"id", "origin_id", "origin_slot", "target_id", "target_slot", "type"} <= set(l), \
                    f"子图 link{l['id']} 应为对象格式(origin_id/target_id 字段)"
                if l["origin_id"] != -10:
                    origin = i_nodes[l["origin_id"]]
                    assert l["id"] in (origin["outputs"][l["origin_slot"]].get("links") or []), \
                        f"[{sg['name']}] link{l['id']}: origin.outputs 未登记"
                    assert l["type"] == origin["outputs"][l["origin_slot"]]["type"], \
                        f"[{sg['name']}] link{l['id']}: origin 槽类型不匹配"
                if l["target_id"] != -20:
                    target = i_nodes[l["target_id"]]
                    assert target["inputs"][l["target_slot"]].get("link") == l["id"], \
                        f"[{sg['name']}] link{l['id']}: target.inputs 不匹配"

    # ── 外露参数(型选择 COMBO/正负提示词/PE/RGBA/画幅联动/seed)──────────

    def test_host_panel_exposes_type_pe_rgba_widgets(self):
        """宿主面板机制(1005 重锚:宿主恰 4 槽终态):
        正向提示词/负向提示词=纯连线槽(零 widget 位,手写位=[400]/[404] 主图
        双 multiline;1006 批C 正名:原正/负向主体句);型选择/PE启用?=widget
        面板控件(真值在 widgets_values_named);clip/vae 槽随 PE TE 迁子图
        [4019]+编码器迁主图退役;「透明/手动宽/手动高」随 1005 用户精简退役
        (透明自动跟型)。widgets_values 两值=[人物(型选择默认), True(PE启用?
        默认)];子图 -10 IO 4 入 6 出。"""
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        host = _nodes(graph)[QI21_HOST_ID]
        wired = [i["name"] for i in host["inputs"] if i.get("link") is not None]
        assert wired == QI21_HOST_EXPOSED_INPUTS, \
            f"宿主外露连线槽应恰 2=正/负向提示词(1005 重锚+1006 批C 正名),得 {wired}"
        assert len(host["inputs"]) == 3, \
            f"宿主应恰 3 槽(两提示词连线+型选择 widget;1006 四轮 AI扩写恒开 PE启用? 退役),得 {len(host['inputs'])}"
        sg_by_name = {s["name"]: s for s in sg["inputs"]}
        for hi in host["inputs"]:
            si = sg_by_name.get(hi["name"])
            assert si is not None and hi["type"] == si["type"], \
                f"宿主外露槽 {hi['name']!r} 应与子图同名槽对齐(名+型)"
            if hi.get("widget"):
                assert hi.get("link") is None, \
                    f"面板控件 {hi['name']!r} 应无连线(widget 型槽)"
            else:
                assert hi.get("link") is not None, \
                    f"连线槽 {hi['name']!r} 应有连线(2005 重锚:非 widget 槽必接线)"
        assert len(sg["inputs"]) == 3 and len(sg["outputs"]) == 4, \
            "子图内部 IO 应 3 入 4 出(1006 四轮:正向提示词/型选择/负向提示词;" \
            "四出=positive/negative/width/height;wh_ratio/PE启用? 随 AI扩写恒开退役)"
        assert [s["name"] for s in sg["inputs"]] == \
            ["正向提示词", "负向提示词", "型选择"], \
            f"-10 槽序应=1006 八轮(型选择末位),得 {[s['name'] for s in sg['inputs']]}"
        assert host["widgets_values"] == ["人物"], \
            "宿主 widgets_values 应=[人物](1006 四轮:AI扩写恒开,面板恰一值)"
        named = host.get("widgets_values_named", {})
        assert list(named) == ["型选择"], \
            f"宿主 widgets_values_named 键序(1006 四轮:恰型选择),得 {list(named)}"
        assert named.get("型选择") == "人物", "宿主 widgets_values_named 型选择漂移"
        assert "PE启用?" not in named, "PE启用? 应随 1006 四轮退役(AI扩写恒开)"
        # widget 型槽=纯面板控件(在列+无连线;真值在 widgets_values_named)
        exposed_names = {i["name"] for i in host["inputs"]}
        for name in QI21_HOST_WIDGET_INPUTS:
            assert name in exposed_names and name in named, \
                f"面板控件 {name} 应在宿主槽列+widgets_values_named(新序列化真值位)"
            e = next(i for i in host["inputs"] if i["name"] == name)
            assert e.get("widget") and e.get("link") is None, \
                f"面板控件 {name} 应=widget 型槽(在列+无连线;1005 重锚终态)"
        # 两提示词=纯连线槽(零 widget 位;1005 重锚:主体句 widget 双位退役,手写位=[400]/[404];
        # 1006 批C 正名:原正/负向主体句→正/负向提示词)
        for name in ("正向提示词", "负向提示词"):
            e = next(i for i in host["inputs"] if i["name"] == name)
            assert e.get("link") is not None and "widget" not in e, \
                f"{name} 应为纯连线槽(零 widget 位;1005 重锚)"
        # 1002 ⑬:pe_clip 槽已撤(PE TE 迁子图 [4019];1005 复核仍不在)
        assert "pe_clip" not in exposed_names, "pe_clip 槽应已撤(1002 ⑬)"


    def test_external_wiring_only_loaders_sampler_save_note(self):
        """外部接线(1005 重锚:宿主边界瘦身为两提示词 STRING 进线,1006 批C 正名):
        [400]→宿主.正向提示词(link15)/[404]→负向提示词(link218);[6].positive/negative
        →[401] 正负双预览(link18/217)+[4015]/[4015N] 编码(link208/209);[2]
        主TE→双编码 clip(link210/211);[6] 四出口喂 [4018] 建议器(212-215);
        [4018] width/height 直驱 [4] 空潜(link1/2);[1] UNET→加速宿主.model
        (link97);CONDITIONING→加速宿主(link16/17);[5] 空潜→加速宿主.latent
        (link5);加速宿主.LATENT→[5] 解码(link62)。主图应无 KSampler/LoRA/T8/
        选择件/seed/ResolutionSelector/PE 件/任何 ComfySwitchNode(支路机构全在
        加速子图,PE 路由全在 [6] 子图)。"""
        graph = GRAPHS["qi21"]
        got = {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in graph["links"]}
        for want in [
            # 1005 重锚:宿主边界=两提示词 STRING 进线(clip/vae 边界线随 PE TE 迁
            # 子图 [4019]+编码器迁主图退役);[400]→正向提示词(槽0)/[404]→负向提示词(槽2)
            (15, QI21_SUBJECT_ID, 0, QI21_HOST_ID, 0, "STRING"),
            (218, 404, 0, QI21_HOST_ID, 1, "STRING"),  # 1006 八轮:负向提示词槽→1(型选择末位)
            # 1005 重锚:[401] MyQi21PromptPreview 正负双预览(正向←[6].positive 槽0
            # /负向←[6].negative 槽1,与两编码器同源)
            (18, QI21_HOST_ID, 0, QI21_PREVIEW_ID, 0, "STRING"),
            (217, QI21_HOST_ID, 1, QI21_PREVIEW_ID, 1, "STRING"),
            # 1004 Phase D:编码器/画幅建议器迁主图——[6] 三出口喂 [4018] 建议器
            # (九型W/H+wh_ratio+PE启用? 联动);[4018].width/height 直驱 [4] 空潜
            (1, QI21_WH_ID, 0, QI21_LATENT_ID, 0, "INT"),
            (2, QI21_WH_ID, 1, QI21_LATENT_ID, 1, "INT"),
            (212, QI21_HOST_ID, 2, QI21_WH_ID, 1, "INT"),
            (213, QI21_HOST_ID, 3, QI21_WH_ID, 2, "INT"),
            # 1006 四轮:214/215 随 wh_ratio/PE启用? 出口退役;[4018] 恒九型直通
            # 主图双编码器(1004):[6].positive/negative(STRING)→[4015]/[4015N]
            # .prompt;clip←[2] 主TE 直供;CONDITIONING→[7] 加速宿主
            (208, QI21_HOST_ID, 0, QI21_MAIN_TE_ID, 3, "STRING"),
            (209, QI21_HOST_ID, 1, QI21_NEG_TE_ID, 3, "STRING"),
            (210, 2, 0, QI21_MAIN_TE_ID, 0, "CLIP"),
            (211, 2, 0, 4204, 0, "CLIP"),
            (4304, 4204, 0, QI21_NEG_TE_ID, 0, "CLIP"),       # 垫脚出口→[4015N].clip
            # 0929 S3 加速边界(语义锚保号:97=旧 [1]→[31] LoRA 臂/16·17=旧
            # positive/negative 首扇出/5=旧 latent 首扇出/62=旧选择件→[8],全改指宿主)
            # 1007 布局整备:97/10/211 垫脚 Reroute(4203/4202/4204,消遮挡锚随行同步,
            # 手法=SKILL 布局章 L184 sanctioned「垫 Reroute」)
            (97, 1, 0, 4203, 0, "MODEL"),
            (4303, 4203, 0, QI21_XHOST_ID, 0, "MODEL"),       # 垫脚出口→宿主.model
            (16, QI21_MAIN_TE_ID, 0, QI21_XHOST_ID, 1, "CONDITIONING"),
            (17, QI21_NEG_TE_ID, 0, QI21_XHOST_ID, 2, "CONDITIONING"),
            (5, QI21_LATENT_ID, 0, QI21_XHOST_ID, 3, "LATENT"),
            (62, QI21_XHOST_ID, 0, 5, 0, "LATENT"),           # 宿主→[5] 解码(单点;⑫ [8]→[5])
            (10, 3, 0, 4202, 0, "VAE"),
            (4302, 4202, 0, 5, 1, "VAE"),                     # 垫脚出口→[5].vae
        ]:
            assert want in got, f"外部接线缺: link{want[0]}"
        # 1004 Phase D:主编码+负向编码两件 TextEncodeQwenImage21 迁主图装配块旁
        # (text 吃 [6] STRING 出口,clip 吃 [2] 主TE;旧「主图零平铺 TextEncode」废止)
        main_tes = _by_type(graph, "TextEncodeQwenImage21")
        assert {n["id"] for n in main_tes} == {QI21_MAIN_TE_ID, QI21_NEG_TE_ID}, \
            f"qi21 主图应恰 2 个 TextEncodeQwenImage21=[{QI21_MAIN_TE_ID}]主编码" \
            f"+[{QI21_NEG_TE_ID}][4015N]负向编码(1004 迁出),得 {[n['id'] for n in main_tes]}"
        for banned in ("ComfySwitchNode", "KSampler", "LoraLoaderModelOnly",
                       T8_CLASS, SPEED_SELECT_CLASS, "PrimitiveInt",
                       "RegexExtract", "ComfyNumberConvert", "ComfyMathExpression",
                       "PrimitiveBoolean"):
            hit = [n["id"] for n in _by_type(graph, banned)]
            assert not hit, f"qi21 主图应零 {banned}(0929 S3:机构全在子图),得 {hit}"
        # 0928 W2 反转:主图零 PE 件(PE 链收进 [40] 子图)
        pe_nodes = _by_type(graph, QI21_PE_CLASS)
        assert not pe_nodes, \
            f"0928 PE 迁子图:主图应零 {QI21_PE_CLASS}(PE 链已收进 [40] 子图),得 {[n['id'] for n in pe_nodes]}"
        sg_nodes = _qi21_sg_nodes(graph)
        pe_subs = [n for n in sg_nodes.values() if n["type"] == QI21_PE_CLASS]
        assert len(pe_subs) == 1 and pe_subs[0]["id"] == QI21_SG_PE_RW, \
            f"0928 PE 迁子图:子图应恰 1 个 {PE_CLASS}[{QI21_SG_PE_RW}]"
        assert not _by_type(graph, "ResolutionSelector"), \
            "主图不应有 ResolutionSelector(写死档位表废止,宽高随型直驱)"
        subjects = [n for n in graph["nodes"] if n["type"] == "PrimitiveStringMultiline"]
        assert len(subjects) == 2, \
            "2005 正负双提示词([400]正向+[404]负向;1006 批C 正名)"


    def test_lora_slot_present_and_bypassed(self):
        """0929 S3 收装:LoRA/支路/选择件/seed 全居加速子图([208] 宿主,id 沿用
        原选择件;[1] UNET MODEL 直连进子图=t2i 无 Cache);默认档=直出40步 干跑
        零 LoRA(懒选择);TE-Speed 槽不加(3c 试装已死归档,D4 终审永不装);
        t2i 无图参考=无黑图修复需求:三支路 positive 统一边界 positive 槽(同源
        [40].positive);主图类型白名单(加速域类型全出册,两宿主按 uuid 豁免)。"""
        graph = GRAPHS["qi21"]
        _assert_accel_subgraph(
            graph, "qi21",
            xsg_uuid=QI21_XSG_UUID, host_id=QI21_XHOST_ID, sel_id=QI21_XSEL_ID,
            ks_direct=QI21_SAMPLER_ID, ks_viggle=QI21_SAMPLER_VIG_ID,
            lora_id=QI21_LORA_ID, t8_id=QI21_T8, seed_id=QI21_SEED_ID,
            save_id=8, model_src_id=1, latent_src_id=QI21_LATENT_ID,
            pos_direct="positive", pos_accel="positive",
            boundary_inputs=[("model", "MODEL"), ("positive", "CONDITIONING"),
                             ("negative", "CONDITIONING"), ("latent", "LATENT"),
                             ("速度档位", "COMBO"), ("seed", "INT")],
            host_inputs=[("model", True, False), ("positive", True, False),
                         ("negative", True, False), ("latent", True, False)],
            note_id=QI21_ACC_NOTE_ID,   # 1004 D6b:加速子图 [7016] 负向生效档位 Note
            ks_cfgs=(4, 1),             # 1004 D6a:[7010] cfg4 负向真实生效;[7012] 恒 1
            banned_main_types=("easy compare",),
            gone_main_ids=(QI21_LORA_PB_ID, QI21_LORA_SW_ID, 177, 178, 179,
                           193, 194, 195, 196, 197, QI21_RR_POS_B_ID))
        # TE-Speed 槽不加(3c 死):主图节点类型白名单(宿主节点 type=子图 uuid 豁免)
        sg_ids = {sg["id"] for sg in _sgs(graph)}
        whitelist = {
            "UNETLoader", "CLIPLoader", "VAELoader", "EmptyLatentImage",
            "VAEDecode", "SaveImage", "MarkdownNote", "easy showAnything",
            "PrimitiveStringMultiline",
            # 0929 S3 收装:KSampler/LoRA/T8/选择件/seed/Reroute 全出主图册(入子图)
            # 1002 衔接批㉕㉖:SeedVR2 放大尾档四件组+rgthree 对比件入册(主图输出区)
            "SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler",
            "Image Comparer (rgthree)",
            # 1004 Phase D:编码器/画幅建议器迁主图(装配块旁三件 [4015][4015N][4018])
            "TextEncodeQwenImage21", "MyQi21WhSuggest",
            # 1007 布局整备:垫脚 Reroute 准入(SKILL 布局章 L184 sanctioned 消遮挡手法)
            "Reroute",
            # 1005 重锚:[401] MyQi21PromptPreview 正负双预览件入册(OUTPUT_NODE
            # 显示件,执行根非 SaveImage 上游属正常;no_orphans 同款豁免口径)
            "MyQi21PromptPreview",
        }
        for n in graph["nodes"]:
            if n.get("properties", {}).get("subgraph") in sg_ids:
                continue
            assert n["type"] in whitelist, \
                f"qi21 主图未知节点类型 {n['type']!r}(TE-Speed 槽不加,3c 已死归档;" \
                f"0929 S3 后支路机构亦不入主图白名单)"
        # 1004 D6b 新锚:加速子图 [7016] 负向生效档位 Note 内容要点(implement
        # Phase D 钦定文案;负向仅档1 生效/档0 无负槽/档2 蒸馏件恒1)
        note = _sg_nodes(_xsg(graph))[QI21_ACC_NOTE_ID]
        txt = note["widgets_values"][0]
        for tok in ("负向仅档1", "直出40步 cfg4", "档0 FunAcc 无负槽",
                    "蒸馏件 cfg恒1 负向无效"):
            assert tok in txt, \
                f"[{QI21_ACC_NOTE_ID}] 负向生效档位 Note 缺要点 {tok!r}(1004 D6b 钦定文案)"

    def test_steps_panel_is_effective_value(self):
        """0929 并行化(R6):steps 联动机构拆除——步数回归各支路 KSampler widget
        (加速子图内 [7]=40 官方完整档/[206]=359),面板值即执行值;此处锁旧
        steps 联动/档位件 id 全不在主图(防重跑回退),结构断言在共用断言器。"""
        nodes = _nodes(GRAPHS["qi21"])
        for gone in (177, 178, 179, 30):
            assert gone not in nodes, \
                f"qi21: 旧注入式件 [{gone}] 应已拆除(0929 并行化)"
        x_nodes = _sg_nodes(_xsg(GRAPHS["qi21"]))
        assert sorted(n["widgets_values"][K_SAMPLER_WV["steps"]]
                      for n in (x_nodes[QI21_SAMPLER_ID], x_nodes[QI21_SAMPLER_VIG_ID])) \
            == sorted([STEPS_DIRECT, STEPS_VIGGLE])

    def test_subject_slot_defaults_to_library_renwen_example(self):
        types, _ = _qi21_truth()
        subject = _nodes(GRAPHS["qi21"])[QI21_SUBJECT_ID]
        assert subject["widgets_values"][0] == types[0][1], \
            "[400] 默认正向提示词应=库人物型例一(1006 批C 正名)"
        assert types[0][0] == "人物", "库首型应为人物(默认型锚)"

    def test_seed_single_source_fanout(self):
        """0929 R5:seed 单源共享(0929 S3:seed PrimitiveInt 居加速子图,value 经
        -10 seed 槽=宿主面板「seed」外露)——[207] 扇出 [7]/[206]/[198] 三支路
        seed 槽(一律 widget 转输入;T8 seed 输入化=research/05 §3 实证,无
        「留 widget」例外);改 seed 只动宿主面板一处,三支路同步。结构断言在
        _assert_accel_subgraph,此处锁口径迁移防回退。"""
        graph = GRAPHS["qi21"]
        x_nodes = _sg_nodes(_xsg(graph))
        seed = x_nodes[QI21_SEED_ID]
        assert seed["type"] == "PrimitiveInt" and seed["widgets_values"][:2] == [0, "fixed"], \
            f"[{QI21_SEED_ID}] seed 单源应 PrimitiveInt 默认 0 fixed,得 {seed.get('widgets_values')}"
        for nid in (QI21_SAMPLER_ID, QI21_SAMPLER_VIG_ID, QI21_T8):
            inp = next((i for i in x_nodes[nid]["inputs"] if i.get("name") == "seed"), None)
            assert inp is not None and "widget" in inp and inp.get("link") is not None, \
                f"qi21 [{nid}].seed 应 widget 转输入接 [{QI21_SEED_ID}](不再外露 widget)"
        assert not _by_type(graph, "PrimitiveInt"), \
            "qi21 主图应零 PrimitiveInt(seed 单源已迁加速子图)"

    # ── MyQi21DaojieBase 在场+三真源互锁(05 库↔qi21_bases.json↔工作流)────

    def test_qi21_base_node_present_and_combo_default(self):
        """[4010] MyQi21DaojieBase 在子图内:combo base 槽=widget 转输入接 -10 槽1
        (1005 重锚+1006 批C 正名:-10 槽序=0正向提示词/1型选择/2负向提示词,宿主面板
        「型选择」COMBO 十选一=九型+自由);widgets 默认=人物;五出
        BASE/WIDTH/HEIGHT/透明值/负面词(2002 ⑯ 删「型名」第四出=三件零消费;
        1001 用户测试批 P1+P2;负面词=1005 案B Phase I 第五出):BASE 喂 [141]
        装配全文件.BASE;WIDTH/HEIGHT 原样直通子图
        width/height 出口(2004:建议器 [4018] 迁主图,九型 W/H 不再喂建议器,
        由主图 [4018] 经 [6] 出口回吃);透明值单扇出 [4014].透明模式(⑦ 纯
        BOOLEAN 子图内连线;槽位 5→4 随 ⑯ 前移,存量连线迁移表=research/slot-map.md §4);
        负面词单扇出 [4011].BASE负面(型负面出口,1005 案B);
        透明覆盖(optional 尾部入)=参数面 widget False(1005 重锚:「透明」面板槽
        随用户精简退役,透明自动跟型 rgba_default)。"""
        graph = GRAPHS["qi21"]
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        bases = [n for n in sg_nodes.values() if n["type"] == "MyQi21DaojieBase"]
        assert len(bases) == 1 and bases[0]["id"] == QI21_SG_BASE_ID, \
            f"子图应恰 1 个 MyQi21DaojieBase[{QI21_SG_BASE_ID}]"
        node = bases[0]
        assert node["widgets_values"] == ["人物", False], \
            "[4010] combo 默认应=人物+透明覆盖 False(DEFAULT_BASE 钉死;⑯ 四出件)"
        base_inp = node["inputs"][0]
        assert base_inp["name"] == "base" and "widget" in base_inp, \
            "[4010].base 应为 widget 转输入(combo 经宿主面板外露)"
        bl = sg_links[base_inp["link"]]
        assert bl["origin_id"] == -10 and bl["origin_slot"] == 2 and bl["type"] == "COMBO", \
            "[4010].base 应接 -10 槽2(1006 八轮:型选择末位)"
        assert [i["name"] for i in node["inputs"]] == ["base", "透明覆盖"], \
            "[4010] 入槽应= base+透明覆盖(optional 尾部,P1 件侧接口面)"
        assert [o["name"] for o in node["outputs"]] == \
            ["BASE", "WIDTH", "HEIGHT", "负面词", "透明值"], \
            "[4010] 五出应为 BASE/WIDTH/HEIGHT/透明值/负面词" \
            "(2002 ⑯ 删型名+大轮连带删 rgba_default=i2i [180] 迁透明值后收口;" \
            "负面词=1005 案B Phase I 第五出=型负面出口,追加最末存量槽序零漂移)"
        assert node["outputs"][4]["type"] == "BOOLEAN", "[4010].透明值 槽型应 BOOLEAN(⑦)"
        assert sorted(node["outputs"][4]["links"] or []) == [326], \
            "[4010].透明值 单扇出(326→[4013];1006 八轮:[4010]独占[4013])"
        # 1005 案B Phase I:[4010].负面词(第五出,槽4)→[4011].BASE负面(inputs[1])
        # ——型负面出口接通装配器 merge(型负面,锁层负面),修「型负面 36 条无
        # 出口死数据」断路(design §8.1 ①④)
        assert node["outputs"][3]["type"] == "STRING", \
            "[4010].负面词 槽型应 STRING(1005 案B 型负面出口)"
        assert node["outputs"][3]["links"] == [340], \
            "[4010].负面词 单扇出(340→[4013] 型负面;1006 七轮 [4011] 退役)"
        neg_link = sg_links[340]
        assert (neg_link["origin_id"], neg_link["origin_slot"],
                neg_link["target_id"], neg_link["target_slot"]) \
            == (QI21_SG_BASE_ID, 3, QI21_SG_PE_RW, 6), \
            "[4010].负面词→[4013].类型句负向 连线应 4010槽3→4013槽6(1006 七轮)"
        # 1005 重锚:「透明」面板槽退役——透明覆盖=参数面 widget(link=None,
        # False 钉死;透明唯一来源=[4010] 参数面,经透明值槽3 连线 [4014])
        tmd = node["inputs"][1]
        assert tmd["name"] == "透明覆盖" and tmd.get("link") is None and "widget" in tmd, \
            "[4010].透明覆盖 应=参数面 widget(1005 重锚:透明面板槽退役)"
        # D6 契约锁(正式断言,A 域留位本批补):rgba_default 真源链=提取器内置四型
        # 名单→qi21_bases.json 字段→本槽;四型集合=道具/多视图/高清人脸/表情差分
        _bases = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))["types"]
        _rgba_on = {e["zh"] for e in _bases if e.get("rgba_default") is True}
        assert _rgba_on == {"道具", "多视图", "高清人脸", "表情差分"}, \
            f"qi21_bases.json rgba_default 四型集合漂移(0929 用户拍板),得 {sorted(_rgba_on)}"
        assert all(e.get("rgba_default") in (True, False) for e in _bases), \
            "qi21_bases.json rgba_default 应为显式布尔(缺字段/非布尔即红)"
        # 1006 七轮:[4011] 退役——BASE 直连 [4013].型底座(槽3,线337)
        assert QI21_SG_ASM_ID not in sg_nodes, "[4011] 应已退役(装配内置 [4013])"
        base_link = sg_links[337]
        assert base_link["origin_id"] == QI21_SG_BASE_ID and base_link["target_id"] == QI21_SG_PE_RW \
            and base_link["target_slot"] == 5, \
            "[4010].BASE 应直连 [4013].型底座 槽5(1006 七轮一处选型)"
        # W/H(1004 重锚):[4010] WIDTH/HEIGHT 原样直通子图 width/height 出口
        # (42/43 线;建议器 [4018] 迁主图后经 [6] 出口回吃,主图侧锚在
        # test_qi21_latent_fed_by_subgraph_width_height)
        # 1006 八轮:W/H 经 [4013] 转发(不再直通 -20;[4010]全出独占[4013])
        for out_slot, out_name in ((1, "WIDTH"), (2, "HEIGHT")):
            l = sg_links[node["outputs"][out_slot]["links"][0]]
            assert l["target_id"] == QI21_SG_PE_RW, \
                f"[4010].{out_name} 应只进 [4013](1006 八轮独占),得 {l}"


    def test_qi21_bases_json_interlocks_library(self):
        """qi21_bases.json 数据面契约(1004 Phase A/E 重锚:正负拆开+库降级)。
        1004 起 05 库头部声明「设计规范与决策记录;提示词真源=qi21_bases.json」
        ——旧「前九条逐字=05 库②层」互锁废止(数据=正负拆开瘦身版,库围栏=旧
        全本设计记录);本测试改锁数据自洽面:十档同序/自由档兜底/画幅档官方
        枚举/正向零禁令句(正负拆开硬口径)/中文负面词在场/美化版锚词/四型
        透明声明段+退役背景职责句零回潮。"""
        types, _ = _qi21_truth()
        qi21 = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))["types"]
        assert len(qi21) == 10, f"qi21_bases.json types 应十档(九型+自由),得 {len(qi21)}"
        assert [e["zh"] for e in qi21[:9]] == [t[0] for t in types], \
            "qi21_bases.json 前九档 型名/顺序应与 05 库同序(型录序=使用序)"
        free = qi21[9]
        assert free["zh"] == "自由" and free["positive_text"] == "" \
            and free["aspect_ratio"] == "1:1 (Square)" and free["megapixels"] == 1.0 \
            and free.get("rgba_default") is False, \
            f"qi21_bases.json 末位应为「自由」档(BASE空/1:1 1.0MP/rgba_default=false),得 {free}"
        # 画幅档:官方 ResolutionSelector 枚举 8 档逐字串 + MP 数值域;多视图=
        # Q2.1侧分档 3:4/4.2(0927 轮)。override 双口径如实记:K2 侧件
        # (my_daojie_base)消费 override=3072×1024 合板直出,Q2.1 侧件
        # (my_qi21_base)不消费 override(消费面忽略)=分张产线口径,两件各取
        # 所需共享同一数据集(1004 集中地后 K2/Q2.1 单文件双口径)
        _aspects = {"1:1 (Square)", "2:3 (Portrait Photo)", "3:2 (Photo)",
                    "3:4 (Portrait Standard)", "4:3 (Standard)",
                    "9:16 (Portrait Widescreen)", "16:9 (Widescreen)",
                    "21:9 (Ultrawide)"}
        for e in qi21[:9]:
            assert e["aspect_ratio"] in _aspects, \
                f"qi21_bases.json「{e['zh']}」aspect_ratio 应=官方枚举,得 {e['aspect_ratio']!r}"
            assert 0.5 <= e["megapixels"] <= 8.0, \
                f"qi21_bases.json「{e['zh']}」megapixels 数值域异常,得 {e['megapixels']}"
        mv = next(e for e in qi21 if e["zh"] == "多视图")
        assert (mv["aspect_ratio"], mv["megapixels"]) == ("3:4 (Portrait Standard)", 4.2), \
            "qi21_bases.json「多视图」画幅档应=Q2.1侧分档 3:4/4.2(0927)"
        assert mv.get("resolution_override") == [3072, 1024], \
            "qi21_bases.json「多视图」override 应=K2 侧合板值 [3072,1024] 在档(Q2.1 消费面忽略)"
        # 1004 正负拆开硬口径:positive_text=正向描述文体,禁令句(禁止/不得/
        # 默认禁止)应拆入 negative_text,正向残留即红
        for e in qi21[:9]:
            for w in ("禁止", "不得", "默认禁止"):
                assert w not in e["positive_text"], \
                    f"qi21_bases.json「{e['zh']}」positive_text 残留禁令句 {w!r}(1004 正负拆开)"
            assert e["negative_text"], \
                f"qi21_bases.json「{e['zh']}」negative_text 应非空(1004 中文负面)"
        # 中文负面词锚(1004:负面=中文逗号清单,头部基线四词)
        for e in qi21[:9]:
            low = e["negative_text"]
            assert "模糊" in low and "水印" in low, \
                f"qi21_bases.json「{e['zh']}」negative_text 缺基线负面词(模糊/水印)"
        # 美化版锚词抽验(人物型):纯画法骨
        renwu = qi21[0]["positive_text"]
        for kw in ("细墨线", "提按顿挫", "墨色浓淡分明"):
            assert kw in renwu, f"qi21_bases.json 人物 positive_text 缺美化版锚词 {kw}"
        for bad in ("眉眼", "发丝", "衣褶如", "骨相"):
            assert bad not in renwu.split("\n")[0], f"人物②层残留物象词 {bad}(纯画法零物象骨)"
        # 1004 数据实况:多彩配色行在文内(拆分后行序=…多彩行+衣物完整性截短句收尾)
        assert any(ln.startswith("人物设色配比") for ln in renwu.split("\n")), \
            "人物 positive_text 应含④配色行(人物多彩…)"
        assert renwu.split("\n")[-1].startswith("衣物完整性"), \
            "人物 positive_text 末行应=衣物完整性截短句(1004 正负拆开数据形状)"
        # 1004 重锚(design §一 钦定):人物系六型②层=统一「主体的单人立绘」
        # 开头的纯正向底座(design.md §一样例「主体的单人立绘…(449字纯正向)」);
        # 旧 0928 底座级透明声明段随统一底座让渡——透明语义现由 [4014] 合成器
        # rgba 节中文头尾句承载(锚在 test_pe_group:RGBA_HEAD_ZH/RGBA_TAIL_ZH/
        # w1_closing);道具型保留定式句(尺寸标注设定图,1002 Q2 裁定不透明特例)
        renwu_xi = {"人物", "美宣", "多视图", "高清人脸", "分镜剧情图", "表情差分"}
        for e in qi21[:9]:
            if e["zh"] in renwu_xi:
                assert e["positive_text"].startswith("主体的单人立绘"), \
                    f"qi21_bases.json「{e['zh']}」应=统一立绘底座开头(1004 design §一)"
        # retired 零回潮(0928):道具型=唯一保留定式句的透明特例型,专项检查;
        # 其余三型已并统一立绘底座(模板自带「均匀柔光,浅净平涂的底」=正向画法
        # 描述,非旧背景职责句,不在本谓词域)
        retired = ("底面浅净一色", "器影贴近器身", "整页如一页器物图纸", "纯色平涂底",
                   "各格底色相同", "纯浅净一色背景", "画面疏朗安静")
        dao_e = next(e for e in qi21 if e["zh"] == "道具")
        resid = [p for p in retired if p in dao_e["positive_text"]]
        assert not resid, f"qi21_bases.json「道具」残留退役背景职责句: {resid}"
        dao = next(e for e in qi21 if e["zh"] == "道具")
        assert "尺寸标注设定图" in dao["positive_text"], \
            "道具型应保留定式句(尺寸标注设定图,1002 Q2 结构性半透明特例)"

    def test_lock_constant_present_and_always_wired(self):
        """锁层常量迁参数面(1001 S8 R7 集成,裁定A):[141] 装配全文件
        widgets_values[锁层A全文 位]=库首节常量A 全文逐字(原 [110] 常量件迁入
        节点参数面,恒挂=装配公式第三段固定拼入,不经开关不随型);multiline
        大框(Q4「固定句都要输入框」)。"""
        graph = GRAPHS["qi21"]
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        # 2006 七轮:[4011] 退役——锁层A 唯一在档位=qi21_bases.json lock_layer(热读)
        lock_a = _wf_lock_a()
        assert lock_a.startswith("风格底座：") and "线描优先工笔结构" in lock_a \
            and "成片质量" in lock_a, \
            "锁层A 真源(qi21_bases.json)应保有 风格底座/线描优先/成片质量 三段骨架"
        assert QI21_SG_ASM_ID not in _qi21_sg_nodes(GRAPHS["qi21"]), \
            "[4011] 应已退役(2006 七轮:三层装配内置 [4013] AI扩写)"

    def test_default_assembly_equals_library_composition(self):
        """默认人物型:装配全文=[24]主体句+[150]BASE(qi21_bases.json 人物,逐字=库)
        +[141] 锁层A全文参数 逐字组合(画布行序①②(增量锁)④③,库直写行序①②③④
        ——层内容零差异;1001 S8:锁层自 [110] 常量件迁 [141] 参数面)。"""
        graph = GRAPHS["qi21"]
        nodes = _nodes(graph)
        sg_nodes = _qi21_sg_nodes(graph)
        qi21 = {e["zh"]: e for e in
                json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))["types"]}
        # 1004 重锚:三段=主体句([400] 默认=库人物①例,锚在 test_subject_slot)
        # +人物 positive_text(数据真源)+锁层A参数面(_wf_lock_a 横锁)——库四层
        # 组合互锁随 A4 库降级废止,此断言退化为参数面自洽组合锁(任一段被误
        # 清空/换型即红)
        # 2006 七轮:[4011] 退役——三段组合语义=MyQi21ApiPE.rewrite 内置装配
        # (件侧单测逐字锁);此处改锁三段真源全部非空可得
        parts = [_widget(nodes[QI21_SUBJECT_ID], 0),
                 qi21["人物"]["positive_text"], _wf_lock_a()]
        assert all(str(x).strip() for x in parts), \
            "内置装配三段(主体句/型底座/锁层A)须全部非空可得"

    def test_pe_group_and_rgba_switch_inside_subgraph(self):
        """PE/透明承袭(1005 重锚:管线前移版,PE 路由全在子图内):
        [4013]=API版PE MyQi21ApiPE(1006 换装:LM Studio 27B+教材热读,参数=PE_API_PARAMS),
        **prompt←[4012].PE路主体句(1005 重锚:PE 开关路由前移,pe关=[4013] 不进
        执行图零装载;旧「[141].装配全文 直喂 Q1=B+」随管线前移退役)**;
        [4021] MyQi21SubjectSelect 五入(主体句/PE出文/PE宽高比/主体句负面/pe开关)
        三出(选定主体句/宽高比/主体句负面;主体句负面←-10 槽3,透传 [4011] 槽3);
        [4011] 装配器四连线槽(BASE/BASE负面/主体句/主体句负面;锁层A全文=参数面
        widget);负面词=三源合并(BASE负面+锁层负面+主体句负面);
        [4014]=MyQi21FinalOutput(1005 ㊄:t2i 不再用 MyQi21PromptSelect)——
        optional 恰 3 槽 装配全文/负面词直写/透明模式,零 widget 参数框(RGBA 头尾
        /W1 走 qi21_bases.json rgba 节热读),零 PE 槽;[210] 三态件退役存续。"""
        graph = GRAPHS["qi21"]
        nodes, links = _nodes(graph), _links(graph)
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        pe = sg_nodes[QI21_SG_PE_RW]
        assert pe["type"] == QI21_PE_CLASS, \
            f"[{QI21_SG_PE_RW}] 应为 {QI21_PE_CLASS}(1006 API版PE换装,类名逐字,子图内)"
        assert pe["widgets_values"] == PE_API_PARAMS[:5], \
            f"PE API 参数漂移 {PE_API_PARAMS[:5]},得 {pe['widgets_values']}"
        # 1006 五轮:AI扩写=装配后终炼(所有提示词经过AI)——装配全文/负面词←[4011] 双出
        # 1006 六轮(问题5/7):[4010] 全五出直连——+画幅宽←.1(338)/画幅高←.2(339)
        # /型负面←.4(340);十二入全 forceInput 纯槽(问题6:带名连线点)
        want_ins = [("系统提示词", 4030, 0), ("色卡", 4031, 0), ("美术风格底座", 4032, 0),
                    ("正向提示词", -10, 0), ("负向提示词", -10, 1),
                    ("类型句正向", 4010, 0), ("类型句负向", 4010, 3),
                    ("画幅宽", 4010, 1), ("画幅高", 4010, 2),
                    ("透明模式", 4010, 4)]
        got_ins = [(i["name"], sg_links[i["link"]]["origin_id"], sg_links[i["link"]]["origin_slot"])
                   for i in pe["inputs"]]
        assert got_ins == want_ins, f"[4013] 十入应= {want_ins}(1006 七轮:装配内置,[4011] 退役),得 {got_ins}"
        # 1006 九轮:三专用类(零控件零下拉,节点即管道;用户令「选择的控件不需要」)
        for nid, sec, cls in ((4030, "系统提示词", "MyQi21系统提示词"),
                              (4031, "色卡", "MyQi21色卡"),
                              (4032, "美术风格底座", "MyQi21美术风格底座")):
            tn = sg_nodes[nid]
            assert tn["type"] == cls and len(tn.get("widgets_values",[""])[0]) > 100, \
                f"[{nid}] 应为 {cls}+内容预填>100字,得 type={tn['type']}"
        assert [o["name"] for o in pe["outputs"]] == \
            ["正向提示词", "负向提示词", "透明模式", "画幅宽", "画幅高"], \
            "[4013] 五口出(1006 八轮:正/负文本+宽/高/透明转发)"
        # 1006 重锚:种子文 widget 与 clip 槽均随 API 版换装退役(唯一入槽=prompt 槽0;
        # 扩写大脑=LM Studio 常驻,引擎不再载 pe_t2i 检查点)
        # 1002 ⑬:宿主 pe_clip 槽已撤(主图零 PE TE;连线 link31 退役删除)
        assert "pe_clip" not in [i["name"] for i in nodes[QI21_HOST_ID]["inputs"]], \
            "[6] 宿主应无 pe_clip 槽(1002 ⑬)"
        # ── [4012] PE开关(1006 四轮退役:AI扩写恒开,主体句直连 [4013];
        # LM Studio 不在=节点透传兜底=旧直写路等价;件与类留档=回滚杠杆)──
        # ── [4021] MyQi21SubjectSelect(2006 五轮退役:AI 恒开,选择无意义)──
        # ── [4011] 装配全文件(裁定A上游):接口面+四连线槽 ──
        # 1005 重锚:负面三源合并=BASE负面+锁层负面(参数面现读)+主体句负面;
        # 锁层A全文=参数面 widget(真值 widgets_values 末位),不入 inputs
        # 2006 七轮:[4011] 退役(装配内置 [4013];主体句/负面边界线 331/332 随亡,
        # 外部正/负向提示词经 335/336 直连 [4013] 槽4/5)
        # ── [4014] MyQi21FinalOutput(1005 ㊄:t2i 专用最终输出件)──
        # optional 恰 3 槽+零 widget 参数框+零 PE 槽(RGBA 头尾/W1=JSON 热读)
        sel = sg_nodes[QI21_SG_SEL_ID]
        assert sel["type"] == QI21_SG_FINAL_CLASS, \
            f"[4014] 应为 {QI21_SG_FINAL_CLASS}(1005 ㊄:t2i 不再用 MyQi21PromptSelect)"
        assert [i["name"] for i in sel["inputs"]] == \
            ["正向提示词", "负向提示词", "透明模式"], \
            "[4014] optional 恰 3 槽=正向提示词/负向提示词/透明模式(1006 五轮:AI 扩写产物直入;零 PE 槽)"
        assert sel.get("widgets_values") == [], \
            "[4014] 零 widget 参数框(1005 ㊄ 用户令:RGBA/W1 走 JSON 热读)"
        assert [o["name"] for o in sel["outputs"]] == ["进编码正向文本", "进编码负向文本"], \
            "[4014] 双出应=进编码正向文本/进编码负向文本(1004 Phase B 双口化存续)"
        # 件级接口面互锁(required 恒空+optional 3 槽;防件侧漂移)
        fo_cls = _load_my_node_class(QI21_SG_FINAL_CLASS)
        assert fo_cls is not None, "MyQi21FinalOutput 应可现读加载"
        _it = fo_cls.INPUT_TYPES()
        assert _it.get("required") == {} and list(_it.get("optional", {})) == \
            ["正向提示词", "负向提示词", "透明模式"], \
            "MyQi21FinalOutput 接口面漂移(1006 五轮:required 空+optional 恰 3 槽=正/负向提示词+透明)"
        pos_l = sg_links[sel["inputs"][0]["link"]]
        assert (pos_l["origin_id"], pos_l["origin_slot"]) == (QI21_SG_PE_RW, 0), \
            "[4014].正向提示词 应接 [4013] AI扩写 口0(1006 五轮:AI 终炼直入最终输出)"
        neg_l = sg_links[sel["inputs"][1]["link"]]
        assert (neg_l["origin_id"], neg_l["origin_slot"]) == (QI21_SG_PE_RW, 1), \
            "[4014].负向提示词 应接 [4013] AI扩写 口1(1006 五轮:负面经 AI 精炼)"
        tm_l = sg_links[sel["inputs"][2]["link"]]
        assert (tm_l["origin_id"], tm_l["origin_slot"]) == (QI21_SG_PE_RW, 2), \
            "[4014].透明模式 应接 [4013] AI扩写 口2 透明模式(1006 八轮转发)"
        # 双出文本经子图出口 STRING 喂主图 [4015]/[4015N](1004 编码迁出存续)
        assert sel["outputs"][0]["links"] == [322], \
            "[4014].进编码正向文本 应单扇出(322→子图出口槽0 positive,主图 [4015].text 源)"
        assert sel["outputs"][1]["links"] == [323], \
            "[4014].进编码负向文本 应单扇出(323→子图出口槽1 negative,主图 [4015N].text 源)"
        # 1006 四轮:wh_ratio/PE启用? 两出口随 AI扩写恒开退役(四出=positive/
        # negative/width/height;断言在 test_subgraph_outputs_feed_sampler_latent_and_preview)
        # RGBA 官方头尾+W1 热读真源(1005 重锚:参数框退役后真源=qi21_bases.json
        # rgba 节,MyQi21FinalOutput import 时热读 head/tail/w1_closing;英文备档=
        # head_en/tail_en。词族剥离 strip_lexicon 随 PE 剥离段退役出 t2i 链——
        # 本件禁过剥离(装配全文=纯中文三层),词族文件存在性锚在文件在册测试)
        _rgba = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))["rgba"]
        assert _rgba["head"] == RGBA_HEAD_ZH, \
            "qi21_bases.json rgba.head 应=中文头句逐字(1004 随库中文化;[4014] 热读)"
        assert _rgba["tail"] == RGBA_TAIL_ZH, \
            "qi21_bases.json rgba.tail 应=中文尾句逐字(1004 随库中文化;[4014] 热读)"
        assert isinstance(_rgba.get("w1_closing"), str) and _rgba["w1_closing"], \
            "qi21_bases.json rgba.w1_closing 应非空(透明路收束句,[4014] 热读)"
        # ── 1005 重锚:透明面板槽退役 ──
        # 透明唯一来源=[4010] 参数面 透明覆盖(False 钉死),经透明值槽3 连线
        # [4014].透明模式(上方 tm_l 锁);子图 -10 恰 4 槽,无「透明」
        assert "透明" not in {s["name"] for s in _qi21_sg(graph)["inputs"]}, \
            "子图 -10 应无「透明」槽(1005 用户精简:透明自动跟型)"

    def test_pe_rewrite_output_consumers_all_lazy(self):
        """[4013] AI扩写出线消费(1006 五轮重锚:AI 恒开+OUTPUT_NODE,懒谓词退役)。

        旧语义(pe关×联动关⇒[4013] 零执行零装载,R7.1)随 2006 四/五轮归零:
        AI扩写恒开(唯一旁路=LM Studio 不在时节点内透传,同节点不等价于不执行)。
        新守卫:①[4013] OUTPUT_NODE=True(执行根,恒进执行图);②出线恰两 consumers
        =[4014] MyQi21FinalOutput.正向提示词/负向提示词(声明面在 INPUT_TYPES)。"""
        graph = GRAPHS["qi21"]
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        pe = sg_nodes[QI21_SG_PE_RW]
        assert pe["type"] == QI21_PE_CLASS, \
            f"[{QI21_SG_PE_RW}] 应为 {QI21_PE_CLASS}(2006 五轮,谓词域锚)".replace('2006','1006')
        cls = _load_my_node_class(QI21_PE_CLASS)
        assert cls is not None and getattr(cls, "OUTPUT_NODE", False) is True, \
            "MyQi21ApiPE 应 OUTPUT_NODE=True(2006 四轮:恒执行+ui 展示载荷)".replace('2006','1006')
        fin = _load_my_node_class("MyQi21FinalOutput")
        fin_opt = fin.INPUT_TYPES()["optional"]
        for out in pe["outputs"]:
            for lid in (out.get("links") or []):
                l = sg_links[lid]
                assert l["target_id"] in (4014, -20), \
                    f"[4013].{out['name']} 消费者应=[4014] 最终输出(2006 五轮),得 link{lid}→{l['target_id']}".replace('2006','1006')
                if l["target_id"] == -20:
                    continue  # 1006 八轮:宽/高出口线→-20 子图出口(非 [4014] 消费)
                slot_name = sg_nodes[4014]["inputs"][l["target_slot"]]["name"]
                assert slot_name in fin_opt, \
                    f"[4014].{slot_name} 应在 MyQi21FinalOutput INPUT_TYPES 声明面"

    def test_case_b_negative_truth_chain_1005(self):
        """1005 案B Phase I 负向全链真值锚(design §8.1):结构锚(4010 第五出
        →4011 BASE负面→4014 负面词直写)之上,钉「文本在链上流动后的真值」——

        ① 底座第五出真值:MyQi21DaojieBase.run.负面词=qi21_bases.json
           types[].negative_text(型负面,人物型=36 条全角逗号清单);
        ② 装配真值:负面词=merge(BASE负面, 锁层负面)=型负面在前+锁层负面
           在后(全角逗号清单=整段一 token,两段半角", "拼接;整 token 相等
           去重——my_styles._merge_negative 单源,K2 同款);
        ③ 合成器真值:pe开直写优先(直写非空恒胜 PE负面;空档才兜底),
           pe关=直写——修前 PE 编造词恒胜=26+36 条真负面零命中断路
           (实弹 1/2-negative.txt 证实在档)。"""
        bases = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))
        renwu_neg = next(e["negative_text"] for e in bases["types"]
                         if e["zh"] == "人物")
        lock_neg = bases["lock_layer"]["negative_text"]
        assert renwu_neg and lock_neg and renwu_neg != lock_neg
        # ① 底座第五出(件级锚在 test_my_qi21_base;此处契约侧联动钉)
        base_cls = None
        try:
            from engines.comfyui.my_nodes.nodes.my_qi21_base import (
                MyQi21DaojieBase as base_cls)
        except ImportError:  # pragma: no cover - 包路径缺席(直载家法兜底)
            base_cls = None
        if base_cls is not None:
            assert base_cls().run("人物")[3] == renwu_neg, \
                "[4010].负面词 第四出应=人物型 negative_text 逐字(1005 案B)"
        # ② 装配真值:merge(型负面, 锁层负面)——同一 _merge_negative 计算,
        # 锚=「型负面在前,锁层在后」拼接形与去重形
        asm_cls = _load_my_node_class(QI21_SG_ASM_CLASS)
        assert asm_cls is not None, "MyQi21PromptAssembly 应可现读加载"
        asm = asm_cls()
        truth = asm.assemble(主体句="s", BASE="b", BASE负面=renwu_neg,
                             锁层A全文="l")[1]
        assert truth == f"{renwu_neg}, {lock_neg}", \
            "负面词直写真值应=型负面在前+锁层负面在后(1005 案B 合并;直写进编码)"
        assert asm.assemble(主体句="s", BASE="b", BASE负面=lock_neg,
                            锁层A全文="l")[1] == lock_neg, \
            "整 token 相等去重:BASE负面=整段锁层负面→裸输出(合并不复读)"
        # ③ 合成器真值:直写优先/空档兜底(pe关=直写不变量)
        sel_cls = _load_my_node_class(QI21_SG_SEL_CLASS)
        assert sel_cls is not None, "MyQi21PromptSelect 应可现读加载"
        sel = sel_cls()
        got = sel.compose(pe开关=True, 透明模式=False, 装配全文="a",
                          PE出文="p", 负面词直写=truth, PE负面="PE编造词")
        assert got[1] == truth, \
            "pe开:直写真值(型+锁层)非空应恒胜 PE负面(1005 案B 直写优先)"
        got_fb = sel.compose(pe开关=True, 透明模式=False, 装配全文="a",
                             PE出文="p", 负面词直写="", PE负面="PE编造词")
        assert got_fb[1] == "PE编造词", "pe开:直写空档→PE负面兜底(⑮ 对调)"
        got_off = sel.compose(pe开关=False, 透明模式=False, 装配全文="a",
                              负面词直写=truth, PE负面="PE编造词")
        assert got_off[1] == truth, "pe关:直写恒胜(不变量,透明/PE负面 不参与负向)"

    def test_subgraph_outputs_feed_sampler_latent_and_preview(self):
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        # 1006 四轮:四出=positive/negative/width/height(wh_ratio/PE启用? 随
        # AI扩写恒开退役;[4018] wh_ratio/联动开关 未接=恒九型直通)
        assert [o["name"] for o in sg["outputs"]] == \
            ["positive", "negative", "width", "height"], \
            "子图输出应为 positive/negative/width/height(1006 四轮四出)"
        host = _nodes(graph)[QI21_HOST_ID]
        assert [o["type"] for o in host["outputs"]] == \
            ["STRING", "STRING", "INT", "INT"]
        # 编码链:主图 [4015]/[4015N] 吃 [6].positive/negative(STRING)出 CONDITIONING
        for host_slot, te_id, tag in ((0, QI21_MAIN_TE_ID, "主编码"),
                                      (1, QI21_NEG_TE_ID, "负向编码[4015N]")):
            te = _nodes(graph)[te_id]
            assert te["type"] == "TextEncodeQwenImage21", f"{tag}应为 TextEncodeQwenImage21"
            t_l = _links(graph)[next(i["link"] for i in te["inputs"] if i["name"] == "prompt")]
            assert (t_l[1], t_l[2]) == (QI21_HOST_ID, host_slot), \
                f"{tag}.prompt 应接 [6] 槽{host_slot} STRING 出口(1004 编码迁出子图)"
        # 1005 重锚:[401]=MyQi21PromptPreview 正负双槽预览件(OUTPUT_NODE 显示件,
        # 单件双入替代旧 easy showAnything 双预览;非 SaveImage 上游属正常)
        previews = _by_type(graph, "MyQi21PromptPreview")
        assert len(previews) == 1 and previews[0]["id"] == QI21_PREVIEW_ID, \
            "应恰 1 个 MyQi21PromptPreview 预览件=[401](1005 重锚)"
        pv = previews[0]
        assert [i["name"] for i in pv["inputs"]] == ["正向提示词", "负向提示词"], \
            "[401] 双入应=正向提示词/负向提示词(1005 正负双预览)"
        # 正向←[6].positive 槽0/负向←[6].negative 槽1(与两编码器同源;1005 重锚)
        pv_l = _links(graph)[pv["inputs"][0]["link"]]
        assert (pv_l[1], pv_l[2]) == (QI21_HOST_ID, 0), \
            "预览.正向提示词 应接 [6].positive 输出(槽0;与主编码同源)"
        pv_neg = _links(graph)[pv["inputs"][1]["link"]]
        assert (pv_neg[1], pv_neg[2]) == (QI21_HOST_ID, 1), \
            "预览.负向提示词 应接 [6].negative 输出(槽1;与负向编码同源;1005 重锚)"
        assert pv["pos"][0] > host["pos"][0], "预览节点应在 [6] 宿主右侧(横向排版)"
        # 0925 归位裁定:节点标题零道劫前缀(原生=type 名+可选注释/自研核心件=描述性
        # 功能名);道劫只留 Group 框/子图名/MarkdownNote 说明卡
        assert "道劫" not in (pv.get("title") or ""), \
            f"预览节点标题应零道劫前缀(0925 归位),得 {pv.get('title')!r}"
        assert "提示词预览" in (pv.get("title") or ""), \
            f"预览节点标题应为提示词预览功能名(1001 S1 更名「最终提示词预览」),得 {pv.get('title')!r}"
        for scope, nodes_ in (("主图", graph["nodes"]),
                              *[(f"子图[{s['name'][:6]}]", s["nodes"]) for s in _sgs(graph)]):
            for n in nodes_:
                if n["type"] != "MarkdownNote" and "道劫" in (n.get("title") or ""):
                    raise AssertionError(
                        f"{scope} node{n['id']} 标题含道劫前缀(0925 归位:节点标题零道劫): "
                        f"{n.get('title')!r}")


    # ── 布局契约(从上到下=阶段行,行内从左到右;group 收敛)──────────────

    def test_subgraph_row_layout_top_to_bottom(self):
        """子图排版=横向带(1006 批B 保守渲染预算重排):主流程左→右零左向线
        (严格 tx > ox;1006 换装后豁免集恒空——link308 随 [4019] 退役);
        带0(y<400)=主排(底座[4010]→装配[4011]→AI扩写[4013]→最终输出[4014]);
        带1(400-1000)=**渲染净空带恒空**(multiline 展示框实际渲染高度≫序列化
        size,主排下方留整带净空——批A 展示框落地后旧 y=860 真源带必罩主排);
        带2(1000+)=三真源独占带([4030/31/32] 展示大档 200×420)+说明卡[4100];
        带成员按 id 锚定防回退。"""
        graph = GRAPHS["qi21"]
        sg_nodes = _qi21_sg_nodes(graph)
        def band_of(y: float) -> int:
            return 0 if y < 400 else (1 if y < 1000 else (2 if y < 1750 else 3))
        bands: dict[int, list[int]] = {}
        # Reroute=布局家具(垫脚消遮挡),不入带成员锚(1007:随出口销重排进带1,豁免)
        for n in _qi21_sg(graph)["nodes"]:
            if n.get("type") == "Reroute":
                continue
            bands.setdefault(band_of(n["pos"][1]), []).append(n["id"])
        assert len(bands) >= 2, f"子图带数(批B=带0+带2 双带),得 {sorted(bands)}"
        # 1006 批B 重锚(保守渲染预算):带0 主排四件横排/带1 渲染净空恒空/
        # 带2 三真源+说明卡(1010 起,与 4013 序列化底 800 净距 210)
        want_bands = {
            0: [4030, 4031, 4032, 4014],    # 顶带:三真源+[4014]最终输出(用户手排)
            1: [4013],                        # 中带:AI扩写
            2: [4010, 4100],                  # 底带:类型句选择+说明卡
        }
        for b, want in want_bands.items():
            got = sorted(bands.get(b, []))
            assert got == sorted(want), f"带{b} 成员漂移: 应 {sorted(want)} 得 {got}"
        # 各带内 x 严格递增(零左向零同列;S8 后节点数组序无生成器数据流序锚,
        # 改按 x 值判——关键链序由下方 4013<4021<4011<4014 链位断言锁)
        for b in sorted(bands):
            xs = sorted(sg_nodes[nid]["pos"][0] for nid in bands[b])
            assert all(x2 > x1 for x1, x2 in zip(xs, xs[1:])), \
                f"带{b} 带内 x 非严格递增(应从左到右零同列): {xs}"
        # 1006 七轮链位(全主排右向):[4010]底座→[4013]AI扩写(装配内置)→[4014]最终输出
        assert sg_nodes[QI21_SG_BASE_ID]["pos"][0] < sg_nodes[QI21_SG_PE_RW]["pos"][0], \
            "链序:[4010] 底座应在 [4013] AI扩写 左侧(1006 七轮:装配内置)"
        assert sg_nodes[QI21_SG_PE_RW]["pos"][0] < sg_nodes[4014]["pos"][0], \
            "链序:[4013] AI扩写应是倒数第二,[4014] 最终输出压轴"
        # 带间净距 ≥100
        band_tops = {b: min(sg_nodes[nid]["pos"][1] for nid in ids) for b, ids in bands.items()}
        band_bottoms = {b: max(sg_nodes[nid]["pos"][1] + sg_nodes[nid]["size"][1]
                               for nid in ids) for b, ids in bands.items()}
        # 2005 用户紧凑布场:带间净距不设硬门
        # 零左向线(严格口径=塔测试同款;1005 重锚:唯一豁免 link308=[4019]→[4013]
        # 同列直供,PE 专属TE 居改写器正下方)
        sg = _qi21_sg(graph)
        for l in _qi21_sg_links(graph).values():
            if l["id"] == 308:
                continue
            ox = sg["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 \
                else sg_nodes[l["origin_id"]]["pos"][0]
            tx = sg["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 \
                else sg_nodes[l["target_id"]]["pos"][0]
            assert tx > ox, \
                f"左向线残留: link{l['id']} ox={ox} tx={tx}(应严格右向;豁免集={308})"


    def test_no_node_overlap_and_group_budget(self):
        """零重叠(主图+两子图节点矩形两两不相交);group 预算(1001 用户测试批 ③
        重立:t2i 两子图组框全域清空=恰 0——终态节点数已少+布局自身可读,组框反成
        视觉负担,用户令「这个子图,不要分组了」);主图≤5(0929 四块口径组框+
        1002 衔接批㉕ ⑤放大尾档组框=Ctrl+B 整组旁路语义载体,拓扑变更合法重立)。"""
        graph = GRAPHS["qi21"]
        sg = _qi21_sg(graph)
        xsg = _xsg(graph)
        # 1005 重锚:装配子图组框=用户手改布场回填「PE 扩写组」恰 1 枚(罩 PE 改写
        # 三件组 [4013][4019][4020]);加速子图仍全域清空=恰 0(1001 ③ 口径存续)
        assert sg["groups"] == [], \
            f"装配子图 group 应恰 0(1006 四轮:AI扩写带节点自明,「PE 扩写组」围栏退役),得 {sg['groups']}"
        assert xsg["groups"] == [], \
            f"加速子图 group 应恰 0(1001 用户测试批 ③ 组框全域退役存续),得 {len(xsg['groups'])}"
        assert len(graph["groups"]) <= 5, \
            f"主图 group 应≤5(四块口径+1002 衔接批㉕ ⑤SeedVR2放大尾档组框=Ctrl+B 整组旁路" \
            f"语义载体,拓扑变更合法重立),得 {len(graph['groups'])}"
        for scope, nodes in (("主图", graph["nodes"]), ("装配子图", sg["nodes"]),
                             ("加速子图", xsg["nodes"])):
            for i in range(len(nodes)):
                for j in range(i + 1, len(nodes)):
                    a, b = nodes[i], nodes[j]
                    ax, ay, aw, ah = a["pos"][0], a["pos"][1], a["size"][0], a["size"][1]
                    bx, by, bw, bh = b["pos"][0], b["pos"][1], b["size"][0], b["size"][1]
                    assert not (ax < bx + bw and bx < ax + aw
                                and ay < by + bh and by < ay + ah), \
                        f"{scope} node{a['id']} 与 node{b['id']} 矩形重叠"

    def test_usage_note_subgraph_warnings(self):
        """子图版 Note 要点锁(1001 S8 集成轮更新):装配子图用法/MyQi21DaojieBase
        九选一/主体句纪律(空镜无人)/[27] 过目指引/锁层恒挂(迁 [141] 参数面)/底座
        美化口径/steps 40 完整态/RGBA 官方公式(中英)/画幅联动([151] 建议器)/0929
        并行化加速区文案。S8 新锚:两件链(MyQi21PromptAssembly/MyQi21FinalOutput/
        MyQi21WhSuggest)/1005 管线重序(主体句过 PE:[4013] 只吃主体句→[4021] 路由
        →[4011] 拼装→[4014] 最终输出无词族剥离)、「从库刷参数」通道/28→10 节点。
        Note 被重跑回退即红。1005 重锚(10-06 契约收尾役):旧 token(PromptSelect/
        种子文退役/qi21_strip_lexicon/最终文本出口名)换 1005 拆件新机制对应 token
        ——依据=link304([4013].prompt←[4012]:0 PE路主体句)+my_qi21_final_output.py
        compose(纯头尾包裹无剥离)+[6] 出口现名 positive/negative。"""
        note = _by_type(GRAPHS["qi21"], "MarkdownNote")[0]["widgets_values"][0]
        for token in ("装配子图", "MyQi21DaojieBase", "九型", "空镜无人",
                      "从库刷参数",
                      "[401]", "恒挂", "美化",
                      # 1004 集中化(设计2.6):Note 真源句改指 json/家,05库=记录层
                      # (旧 token「05-道劫规范提示词库.md」随 Note 勘正退役)
                      "qi21_bases.json", "05库=记录层",
                      "[7010]=40", "40-50",
                      RGBA_HEAD, RGBA_TAIL, RGBA_HEAD_ZH, RGBA_TAIL_ZH,
                      "画幅联动",
                      "LoraLoaderModelOnly", LORA_FILE,
                      "[7013]", "[7012]", "[7014]", "[7]",
                      "shift_terminal=0.02", "TE-Speed",
                      # 0929 并行化轮:三支路+单选择件+默认=直出40步(拉齐重放)+懒执行+seed 单源
                      *QI21_PARALLEL_NOTE_TOKENS,
                      # 0925 收窄轮要点(W1 组框+摆设值/pp 定档/W2 主画布);1004 D7
                      # 说明卡改写:旧「数学上不参与采样/官方同构/占位/
                      # ResolutionSelector 已退役」四 token 随 cfg4 负向真实生效退役
                      "已定档",
                      "摆设值不生效", "加速区", "[4013]", "[4011]",
                      # 1004 中文负面+cfg4 役新锚(D6/D7:自建中文 PE+负向编码器+
                      # 加速子图负向档位 Note+词族/PE 补丁真源迁 qi21_bases.json)
                      "QwenImage21_T2IPromptRewrite", "[4015N]", "负向仅档1", "[7016]", "cfg4",
                      "中文负面", "扩写TE", "expand_instruction", "负面词直写",
                      "[4018]", "进编码正向", "drop-in",
                      # 0928 PE 迁子图轮:面板控件口径([180] 总闸退役)
                      # 1005 重锚:「最终文本」出口名已退役([6] 出口现名 positive/
                      # negative,载荷=[4014] MyQi21FinalOutput 双口)→换新口名 token
                      "PE启用?", "画幅联动开关", "进编码正向文本",
                      # 1001 S8 R7 集成轮新锚(裁定A两件链+Q1=B+)
                      # 1005 重锚:t2i [4014] type 已换 MyQi21FinalOutput
                      # (my_qi21_prompt_select.py:107-110 存照「t2i 不再用
                      # MyQi21PromptSelect」)→PromptSelect 换 FinalOutput
                      "MyQi21PromptAssembly", "MyQi21FinalOutput", "MyQi21WhSuggest",
                      # 1005 重锚:「种子文 widget 退役」随 D5 旧锚(Q1=B+ 装配全文
                      # 进 PE)退役——实测 link304=[4013].prompt←[4012]:0 PE路主体句
                      # (PE=主体句扩写器)→换「只吃主体句」;「qi21_strip_lexicon.json」
                      # 真源指针已死(my_nodes 下无此文件)且 [4014] FinalOutput.compose
                      # 无剥离(my_qi21_final_output.py:190-194 纯头尾包裹)→换
                      # 「无词族剥离」
                      "装配全文", "只吃主体句", "无词族剥离",
                      "28→10 节点", "裁定A"):
            assert token in note, f"Note 缺子图版要点: {token!r}"

    def test_prompt_library_nine_types_anchor(self):
        """库锚(②层=09-23 美化版):### 恰九型且与 daojie_bases.json zh 同序;
        每型装配全文围栏行数=10(人物系)/6(场景系),字符带 1400-2500
        (1002 头身比锚轮五型②层各+23 字,表情差分 2387→2410 破旧上界,随轮上调);
        首行 ⟨①:…⟩ 槽、末行配色行;②层与 canon positive 不再逐字互锁(锚废止的负证);
        §六 演进与待裁定节在场(09-23 深检吸收轮立账)。"""
        md = PROMPT_LIB.read_text(encoding="utf-8")
        bases = _canon_types()   # 1004:canon=qi21_bases.json types 前 9
        zh_order = [b["zh"] for b in bases]
        headings = re.findall(r"^### (.+?)-基础\s*$", md, re.M)
        assert headings == zh_order, \
            f"库 ### 九型标题应与 canon(qi21_bases.json types 前9)zh 同序,得 {headings}"
        canon_pos = {b["zh"]: b["positive_text"] for b in bases}
        diff = 0
        for zh in zh_order:
            m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
            fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S).group(1)
            lines = fence.split("\n")
            want_lines = 11 if zh in PRO_CHAR_TYPES else 6  # 1007 头发两态句拆段:10→11
            assert len(lines) == want_lines, \
                f"{zh}: 装配全文应 {want_lines} 行(②型底座+③锁层[+增量锁]+④配色行),得 {len(lines)}"
            # 1004:库围栏=设计记录旧全本(数据真源=qi21_bases.json),带随
            # 实测定带 1200-2100(1004 立带 1200-2000;1007 头发两态后库自查现值 1681-2001)
            assert 1200 <= len(fence) <= 2100, \
                f"{zh}: 装配全文字符数 {len(fence)} 出带 1200-2100(1004 立带,1007 头发两态后上调)"
            assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), f"{zh}: 首行应为 ⟨①:…⟩ 槽"
            assert lines[-1] == PRO_COLOR_MAP[zh], f"{zh}: 末行应为④配色行"
            if lines[1] != canon_pos[zh]:
                diff += 1
        assert diff == 9, \
            f"②层应为美化版成文(与 canon positive 逐字互锁已废止,九型均应有差异),diff={diff}"
        assert "## 六、演进与待裁定" in md, "库应含 §六 演进与待裁定(09-23 深检吸收轮立账)"
        assert "②③层放行显式禁句" in md, "库 §四.4 应含 ②③层放行显式禁句条款(09-23 深检吸收)"

    def test_blueprint_definition_matches_host_subgraph(self):
        """蓝图↔宿主一致性锚(1001 S8 深审 L-8 落锚):蓝图 definitions.subgraphs[0]
        与工作流 [40] 子图定义做 canonical 对比**除 id 外**全等(json.dumps
        sort_keys;口径与 f929798 幂等修正的 id 归一一致——S5 术后宿主定义
        id=实例 uuid 96937bbe… 与蓝图恒定 id c3f81b56… 分轨为常态,id 外任何
        漂移即红)。此前蓝图↔宿主一致性零自动锚,漂移只能手动跑
        qi21_blueprint_sync_1001.py --check 发现(契约 §九.3 钦定同步通道)。"""
        bp_sg = json.loads(QI21_BLUEPRINT.read_text(encoding="utf-8")) \
            ["definitions"]["subgraphs"][0]
        wf_sg = _qi21_sg(GRAPHS["qi21"])
        assert bp_sg["name"] == wf_sg["name"], \
            f"蓝图/宿主子图 name 漂移: {bp_sg['name']!r} vs {wf_sg['name']!r}"

        def _canon_no_id(sg: dict) -> str:
            return json.dumps({k: v for k, v in sg.items() if k != "id"},
                              ensure_ascii=False, sort_keys=True,
                              separators=(",", ":"))

        assert _canon_no_id(wf_sg) == _canon_no_id(bp_sg), \
            "蓝图 ↔ 宿主工作流子图定义漂移(除 id 外应 canonical 全等)——请跑 " \
            "apps/build/scripts/qi21_blueprint_sync_1001.py 同步(钦定通道,勿手改)"

# ── 6d2. 画布归一与加速区组框(0925 收窄轮 W1/W6;适用 qi21/i2i/edit 三件;
# qwen21-t2i 静态官方件不适用——坐标原样保留)─────────────────────────────


class TestCanvasNormalization0925:
    """W6 零负区(主图所有节点 pos≥80;子图内部:qi21/i2i 两子图全域 ≥80=生成器
    三域循环自查同口径;edit 子图 ≥0=生成器 4e S3 最小口径,S5 终排收紧——
    research/s3-edit §6 口径落账,勿双源漂移)
    +输出口最右(三件两子图输出 IO 槽 x≥全子图最大 x-50;表示法=K2-文生图-道劫
    [90] 实证)+W1 加速区组框(0929 S3 收装:主图③框罩宿主+t2i 空潜源/寄居件;
    加速子图内部组框罩全 6 件=单一功能域/分行框)。与三生成器自查同口径谓词,
    此处双记账互锁。"""

    GRAPHS_3 = ("qi21", "i2i", "edit")
    # 0929 S3 收装后主图③加速框成员=宿主+留主图伴生物(支路件全入子图):
    # t2i=空潜[4]+宿主[7];i2i=宿主[7]+寄居[20] latent汇入/[44] VAE 递送;
    # edit=宿主[7]+寄居[20] latent汇入/[29] VAE 递送
    # 1003 甲案重锚:edit [20] 寄居③框与 i2i 同款(两件同骨架,latnet 双路
    # 汇入件统一居装配列→加速列过渡带,由③框收编罩人)。
    ACCEL_HOST_AREA = {
        "qi21": (QI21_LATENT_ID, QI21_XHOST_ID),   # 1002 ⑫:空潜 [5]→[4](常量)
        "i2i": (I2I_XHOST_ID, 20, 44),
        "edit": (EDIT_XHOST_ID, 20, 29),
    }
    # 主图③框标题锚(t2i/i2i=「道劫·加速区」前缀;edit=「道劫·③加速」)
    ACCEL_BOX_TITLE = {
        "qi21": "道劫·加速区", "i2i": "道劫·加速区", "edit": "道劫·③加速",
    }

    def test_no_negative_coordinates_all_nodes(self):
        """W6①:零负区——主图 pos≥80(0926 收紧);子图内部按生成器 S3 口径分域
        (qi21/i2i ≥80 三域循环;edit ≥0 最小口径,S5 终排收紧;子图 IO 槽非节点,
        负 x 表示法=K2 [90] 同款,不在本谓词范围)。"""
        for name in self.GRAPHS_3:
            graph = GRAPHS[name]
            for n in graph["nodes"]:
                assert n["pos"][0] >= 80 and n["pos"][1] >= 80, \
                    f"{name} 主图 node{n['id']} 负区坐标 {n['pos']}(W6① 零负区:pos≥80)"
            floor = 80 if name != "edit" else 0
            # 1005 重锚:豁免集退役——[4010]/[4012] 已按布局纪律 pos≥80 归位
            # (旧「[4010] 左置锚/4019 左置」手改态随 1005 布场失效),qi21/i2i/edit
            # 三件子图全域零负区零豁免
            for sg in _sgs(graph):
                for n in sg["nodes"]:
                    assert n["pos"][0] >= floor and n["pos"][1] >= floor, \
                        f"{name} 子图[{sg['name'][:6]}] node{n['id']} 负区坐标 {n['pos']}" \
                        f"(W6① 子图零负区:pos≥{floor};1005 起零豁免)"

    def test_subgraph_outputs_pinned_rightmost(self):
        """W6②:输出口最右——三件两子图输出 IO 槽钉死最右列(0929 S3:edit 加速
        子图同判;装配/加速同口径)。"""
        for name in self.GRAPHS_3:
            for sg in _sgs(GRAPHS[name]):
                max_nx = max(n["pos"][0] for n in sg["nodes"])
                for io in sg["outputs"]:
                    assert io["pos"][0] >= max_nx - 50, \
                        f"{name} 子图[{sg['name'][:6]}]输出 {io['name']} 未钉最右列" \
                        f"(x={io['pos'][0]} < 全子图最大 x{max_nx}-50,W6②)"

    def test_accel_group_boxes_cover_parallel_branches(self):
        """W1(0929 S3 口径;1001 用户测试批 ③ qi21 分支重立):主图③加速框在位
        且罩宿主+伴生成员(t2i 空潜源/i2i·edit 寄居件);加速子图内部组框罩全
        支路成员——**qi21=组框全域清空(恰 0,用户令「加速子图中的分组也不要
        了」;i2i/edit 欠账留后续轮)**;布局真源=三生成器+手术脚本。"""
        for name in self.GRAPHS_3:
            graph = GRAPHS[name]
            nodes = _nodes(graph)
            grp = next((g for g in graph["groups"]
                        if g.get("title", "").startswith(self.ACCEL_BOX_TITLE[name])), None)
            assert grp is not None, \
                f"{name}: W1 缺主图加速组框(锚={self.ACCEL_BOX_TITLE[name]!r}…,0929 S3 收装口径)"
            assert "加速" in grp["title"], \
                f"{name}: W1 组框标题应带加速字号,得 {grp['title']!r}"
            gx0, gy0 = grp["bounding"][0], grp["bounding"][1]
            gx1, gy1 = gx0 + grp["bounding"][2], gy0 + grp["bounding"][3]
            for nid in self.ACCEL_HOST_AREA[name]:
                n = nodes[nid]
                assert (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                        and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1), \
                    f"{name}: W1 主图加速框未罩住 [{nid}](0929 S3 成员)"
            # 加速子图内部:qi21 组框已全域清空(1001 用户测试批 ③);
            # i2i/edit=组框并集罩全支路成员(t2i/edit 单一功能域框/i2i 四行框)
            xsg = _xsg(graph)
            if name == "qi21":
                assert xsg["groups"] == [], \
                    "qi21: 加速子图组框应恰 0(1001 用户测试批 ③ 全域清空)"
                continue
            covered = set()
            for igrp in xsg["groups"]:
                bx0, by0 = igrp["bounding"][0], igrp["bounding"][1]
                bx1, by1 = bx0 + igrp["bounding"][2], by0 + igrp["bounding"][3]
                for n in xsg["nodes"]:
                    if (bx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= bx1
                            and by0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= by1):
                        covered.add(n["id"])
            assert covered == {n["id"] for n in xsg["nodes"]}, \
                f"{name}: 加速子图组框并集未罩全 6 件(缺 {sorted({n['id'] for n in xsg['nodes']} - covered)})"


# ── 6d3. i2i/edit 宿主层布局新标准(1003 甲案:自适应重排跟进 t2i;坐标各自算
#       不照抄——两件比 t2i 多图像输入链,PRD 构成差异账为证;哨兵=病灶复发即红)──


class TestI2IEditHostLayout1003:
    """1003 甲案不变量锚(i2i/edit 宿主主图;PRD=Trellis 10-03-i2i-edit-
    layout-follow-t2i):①图像输入列=装配列前的合法先导列(双图+双预缩+缓存[9]
    +画幅开关[19] 整链成列;[20] 因 [6]→[20] latent 线结构必居装配与加速之间,
    不列入=③框寄居,见 TestCanvasNormalization0925.ACCEL_HOST_AREA);②[400]
    指令归位②带(旧病灶=孤岛掉底 i2i y3400/edit y3960,复发即红);③[20] 结构位
    =[6] 右→[20]→[7] 左(latent 汇入恒右向);④edit 无⑤尾档=输出列即终点
    ([8] 全图最右+与 [5] 同列相邻,旧病灶=[8] 远端推离 x 差 1830,复发即红);
    ⑤说明卡置顶;⑥主图零矩形重叠(旧病灶=edit [16]/[10] 近叠行,复发即红);
    ⑦i2i ⑤尾档居④输出之后(骨架末段)。主图左向线豁免集哨兵在
    TestCanvasDiscipline.test_horizontal_layout_no_vertical_tower(恒空,扩容即红)。"""

    GRAPHS_2 = ("i2i", "edit")
    # 图像输入列成员(PRD 1003 甲案口径:双图+双预缩+缓存+画幅开关)
    INPUT_COL = (10, 11, 16, 17, 9, 19)

    def test_image_input_column_leads_assembly(self):
        """不变量①:输入列成员全部右于加载列、左于 [6] 装配列(合法先导列)。"""
        for name in self.GRAPHS_2:
            graph = GRAPHS[name]
            nodes = _nodes(graph)
            loaders_right = max(nodes[i]["pos"][0] + nodes[i]["size"][0]
                                for i in (1, 2, 3))
            asm_x = nodes[6]["pos"][0]
            for nid in self.INPUT_COL:
                n = nodes[nid]
                assert loaders_right < n["pos"][0], \
                    f"{name}: 输入列成员 [{nid}] 应右于加载列(先导列=加载后装配前,1003 甲案)"
                assert n["pos"][0] + n["size"][0] < asm_x, \
                    f"{name}: 输入列成员 [{nid}] 应左于 [6] 装配列(合法先导列,1003 甲案)"

    def test_400_directive_home_in_band2(self):
        """不变量②:[400] 指令归位②带——嵌②主链框内且居 [6] 上方行
        (孤岛掉底复发即红)。"""
        for name in self.GRAPHS_2:
            graph = GRAPHS[name]
            nodes = _nodes(graph)
            grp = next(g for g in graph["groups"]
                       if g.get("title", "").startswith("道劫·②图像·"))
            n = nodes[400]
            gx0, gy0 = grp["bounding"][0], grp["bounding"][1]
            gx1 = gx0 + grp["bounding"][2]
            gy1 = gy0 + grp["bounding"][3]
            assert (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                    and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1), \
                f"{name}: [400] 指令应在②主链框内(1003 甲案归位②带;孤岛复发即红)"
            assert n["pos"][1] < nodes[6]["pos"][1], \
                f"{name}: [400] 应居 [6] 上方行(指令→装配纵向顺位)"

    def test_switch20_between_assembly_and_accel(self):
        """不变量③:[20] 结构位=装配列右沿之外、加速宿主 [7] 之外(latent 汇入
        恒右向;[6]→[20]→[7] 两线即其合法居所=③框寄居)。"""
        for name in self.GRAPHS_2:
            nodes = _nodes(GRAPHS[name])
            assert nodes[6]["pos"][0] + nodes[6]["size"][0] < nodes[20]["pos"][0], \
                f"{name}: [20] 应右于 [6]([6]→[20] latent 线恒右向)"
            assert nodes[20]["pos"][0] + nodes[20]["size"][0] < nodes[7]["pos"][0], \
                f"{name}: [20] 应左于 [7]([20]→[7] latent 汇入恒右向)"

    def test_note_pinned_top(self):
        """不变量⑤:说明卡 [402] 置顶(高于一切组框上沿)。"""
        for name in self.GRAPHS_2:
            graph = GRAPHS[name]
            note = _by_type(graph, "MarkdownNote")[0]
            top = min(g["bounding"][1] for g in graph["groups"])
            assert note["pos"][1] < top, \
                f"{name}: [402] 说明卡应置顶(y={note['pos'][1]} 应<组框最高沿 {top})"

    def test_main_graph_zero_rect_overlap(self):
        """不变量⑥:主图节点矩形两两不相交(edit [16]/[10] 近叠行旧病灶复发即红;
        qi21 侧同款谓词见 TestQi21SubgraphContract.test_no_node_overlap_and_group_budget)。"""
        for name in self.GRAPHS_2:
            ns = GRAPHS[name]["nodes"]
            for i in range(len(ns)):
                for j in range(i + 1, len(ns)):
                    a, b = ns[i], ns[j]
                    ax, ay, aw, ah = a["pos"][0], a["pos"][1], a["size"][0], a["size"][1]
                    bx, by, bw, bh = b["pos"][0], b["pos"][1], b["size"][0], b["size"][1]
                    assert not (ax < bx + bw and bx < ax + aw
                                and ay < by + bh and by < ay + ah), \
                        f"{name} 主图 node{a['id']} 与 node{b['id']} 矩形重叠(1003 甲案零重叠)"

    def test_edit_output_column_is_endpoint(self):
        """不变量④:edit 无⑤尾档=输出列即终点——[8] 全图最右件且与 [5] 同列
        相邻(≤200;旧病灶 [8] 被推远端 x 差 1830,复发即红)。"""
        graph = GRAPHS["edit"]
        nodes = _nodes(graph)
        n5, n8 = nodes[5], nodes[8]
        assert n8["pos"][0] + n8["size"][0] == \
            max(n["pos"][0] + n["size"][0] for n in graph["nodes"]), \
            "edit: [8] 应为全图最右件(无⑤尾档=输出列即终点,1003 甲案)"
        assert n8["pos"][0] - (n5["pos"][0] + n5["size"][0]) <= 200, \
            "edit: [8] 应与 [5] 同列相邻(远端推离复发即红)"

    def test_i2i_tail_after_output(self):
        """不变量⑦:i2i ⑤尾档居④输出之后(骨架横向单向流末段:输出→放大尾档)。"""
        nodes = _nodes(GRAPHS["i2i"])
        assert nodes[8]["pos"][0] + nodes[8]["size"][0] < nodes[503]["pos"][0], \
            "i2i: ⑤尾档 [503] 应居 ④输出 [8] 右沿之外(骨架末段顺位)"


# ── 6f. i2i 件专属契约(09-24 新增:道劫风格图生图=edit 骨架+九型装配移植;
# 机制=生修合一·图输入即指令编辑,零 denoise 重绘;真源=幂等生成器
# apps/build/scripts/qi21_daojie_i2i_0924.py;拼接次序=05 库 §一四层装配口径:
# 指令占①层位(指令即主体)+②型底座+③锁层A 换行分层)──────────────────


class TestI2IContract:
    def test_seed_fixed_and_steps_full_tier(self):
        """i2i 件采样(0929 并行化+S3 收装:采样器/seed 全居加速子图):两支路
        steps=40(道劫产线完整档,官方区间 40-50)+359(viggle);seed=单源 [191]
        (0,fixed,风格迭代可复现,随 qi21 口径;edit 骨架的 randomize 就此归一)。"""
        assert not _by_type(GRAPHS["i2i"], "KSampler"), \
            "i2i 主图应零 KSampler(0929 S3:支路机构收进加速子图)"
        samplers = [n for n in _xsg(GRAPHS["i2i"])["nodes"] if n["type"] == "KSampler"]
        assert sorted(s["widgets_values"][K_SAMPLER_WV["steps"]] for s in samplers) \
            == sorted([STEPS_DIRECT, STEPS_VIGGLE]), "i2i 两支路 steps 应=40/6(面板=生效值;1002 viggle 考据)"
        seed = _sg_nodes(_xsg(GRAPHS["i2i"]))[I2I_SEED_ID]
        assert seed["type"] == "PrimitiveInt" and seed["widgets_values"][:2] == [0, "fixed"], \
            "i2i seed 单源应 0/fixed(可复现,加速子图内)"

    def test_subgraph_assembly_present_and_host_panel(self):
        """装配子图在场(1001 同构集成轮双 Select 链形态,28→17 节点):
        MyQi21DaojieBase 九选一(combo 经宿主面板「型选择」COMBO 外露,默认人物;
        W/H 零消费=画幅随输入图)+[141] 装配全文件(锁层A迁参数面)+[152] 择文
        合成器①(替原 [15])+[153] 透明包裹器②(替原 [162][163][160][161]);
        宿主面板 widget=指令+型选择+RGBA透明+PE开关(四控零变化);画幅联动件
        不移植(RegexExtract 画幅链/ComfyNumberConvert/ComfyMathExpression 禁入);
        StringConstant 恰 0(锁层A/头尾句全迁参数面)。"""
        graph = GRAPHS["i2i"]
        sg = _qi21_sg(graph)
        sg_nodes = _qi21_sg_nodes(graph)
        assert "提示词类型优化子图" in sg["name"], \
            "i2i 子图 name 应带提示词类型优化子图字号(1001 R2 同名统一)"
        host = _nodes(graph)[I2I_HOST_ID]
        assert host["type"] == sg["id"] and host["properties"]["subgraph"] == sg["id"], \
            "[40] 宿主 type/properties.subgraph 应=子图 uuid"
        for i, (hi, si) in enumerate(zip(host["inputs"], sg["inputs"])):
            assert hi["name"] == si["name"] and hi["type"] == si["type"], \
                f"i2i 宿主 inputs[{i}]({hi['name']}) 与子图 inputs[{i}]({si['name']}) 不对齐"
        widget_inputs = [i["name"] for i in host["inputs"] if "widget" in i]
        assert widget_inputs == ["指令", "型选择", "PE启用?", "RGBA透明"], \
            f"宿主面板 widget 型输入应为 指令+型选择+PE启用?+RGBA透明(1002 ㉑ 序),得 {widget_inputs}"
        assert host["widgets_values"] == [I2I_B_SEG, "人物", True, "自动"], \
            "宿主 widgets_values 应=[例句, 人物, True(PE启用? 0926 默认开), 自动(D6 三态默认,1001 ①)]"
        # 0929 S2 D6:i2i 型联动三态件([180];rgba_hint←[4010].透明值(1002 大轮迁);
        # rgba_on 四扇出 [144]/[173] 双镜像开关+[152]/[153] 透明模式占位)
        sel = sg_nodes[I2I_SG_RGBA_SEL]
        assert sel["type"] == "MyQi21RgbaSelect" and sel["widgets_values"] == ["自动"], \
            f"[{I2I_SG_RGBA_SEL}] 应为 MyQi21RgbaSelect 且 mode 默认=自动(1001 ① 文案轮首项)"
        m_cl = _qi21_sg_links(graph)[sel["inputs"][0]["link"]]
        assert m_cl["origin_id"] == -10 and m_cl["origin_slot"] == 7 and m_cl["type"] == "COMBO", \
            "[180].mode 应接 -10 槽7(RGBA透明;1002 ㉑ PE启用? 插槽6 后移位)"
        _rh = _qi21_sg_links(graph)[sel["inputs"][1]["link"]]
        assert _rh["origin_id"] == I2I_SG_BASE_ID and _rh["origin_slot"] == 3, \
            "[180].rgba_hint 上游应 [4010].透明值(1002 大轮迁透明值槽3)"
        assert sorted(sel["outputs"][0]["links"] or []) == [67], \
            "[180].rgba_on 应单扇出(67→[153].透明模式;10-02 单口化:39/58 双闸门" \
            "+64 [4014].透明模式 占位随双编码+双闸门塌缩退役,透明边界唯一驻 [153])"
        _io6 = sg["inputs"][6]
        assert _io6["name"] == "PE启用?" and _io6["type"] == "BOOLEAN", \
            "i2i 子图 -10 槽6 应=「PE启用?」BOOLEAN(1002 ㉑);RGBA透明 三态=槽7"
        bases = [n for n in sg_nodes.values() if n["type"] == "MyQi21DaojieBase"]
        assert len(bases) == 1 and bases[0]["id"] == I2I_SG_BASE_ID, \
            "子图应恰 1 个 MyQi21DaojieBase[150]"
        assert bases[0]["widgets_values"] == ["人物", False], \
            "[4010] combo 默认应=人物+透明覆盖 False(⑯ 四出件)"
        bl = _qi21_sg_links(graph)[bases[0]["inputs"][0]["link"]]
        assert bl["origin_id"] == -10 and bl["origin_slot"] == 5 and bl["type"] == "COMBO", \
            "[150].base 应接 -10 槽5(宿主面板「型选择」COMBO,一处切换)"
        assert [o["name"] for o in bases[0]["outputs"]] == ["BASE", "WIDTH", "HEIGHT", "透明值"], \
            "[4010] 四出应为 BASE/WIDTH/HEIGHT/透明值(1002 ⑯+大轮连带删 rgba_default;" \
            "与 qi21 件同名册;下方索引引用依赖此序)"
        assert bases[0]["outputs"][3]["type"] == "BOOLEAN", \
            "[150].rgba_default 槽型应 BOOLEAN(同 qi21 件,0929 S2 D6;⑯ 后槽位 4→3)"
        assert not (bases[0]["outputs"][1].get("links") or []) \
            and not (bases[0]["outputs"][2].get("links") or []), \
            "[150] WIDTH/HEIGHT 本件不接(画幅随输入图,画幅联动行不移植)"
        # 0928 PE 迁子图轮:RegexExtract 随 PE 链入子图(抓 rewritten_prompt)——
        # 禁入清单只剩画幅联动三件(i2i 画幅随输入图,联动行不移植)
        for banned in ("ComfyNumberConvert", "ComfyMathExpression"):
            assert not [n for n in sg_nodes.values() if n["type"] == banned], \
                f"i2i 子图不应有 {banned}(画幅联动行不移植)"
        # 1001 同构集成:固定句常量件恰 0(锁层A迁 [141].wv[1]/头尾迁 [153].wv[2]/[3])
        sconsts = [n["id"] for n in sg_nodes.values() if n["type"] == "StringConstant"]
        assert sconsts == [], \
            f"i2i 子图 StringConstant 应恰 0(1001 收编三自研件,固定句全迁参数面),得 {sconsts}"
        # 退役件防回潮(收编 8 件+Reroute 消化 6 件;141/152/153 由新件占用不在册)
        resid = [nid for nid in I2I_SG_GONE_IDS if nid in sg_nodes]
        assert resid == [], f"i2i 同构集成退役件残留(防回潮):{resid}"
        # 子图 Reroute 恰 0(6 件全消化直连,t2i 终态同构)
        rr = sorted(nid for nid, n in sg_nodes.items() if n["type"] == "Reroute")
        assert rr == [], f"i2i 子图 Reroute 应恰 0(消化直连),得 {rr}"

    def test_directive_occupies_subject_layer(self):
        """指令×装配关系(1001 同构集成轮双 Select 链;指令路径全程子图内):
        [22] 原始用户词(主图,唯一手写位)→宿主「指令」槽;**PE 链吃 -10槽4 裸指令,
        绝不吃装配全文**(Edit Prompt Enhancer 语义=改写用户编辑指令,喂装配全文=
        语义破坏+造环,§10.9 依赖环裁定在档)——t2i 的「装配全文喂 PE」(Q1=B+)
        在 i2i 不可搬运,择文器挪装配上游恰与原 [15] 开关位一致;[152] Select①
        择文(pe开=[27] PE抽取文/pe关=裸指令)→[141].主体句;[141] 装配全文=
        择文+BASE([150])+锁层A(参数面),四路扇出 [142].prompt/[171].prompt/
        -20槽4 prompt/[153].装配全文;主图零 PE 件。"""
        graph = GRAPHS["i2i"]
        nodes, links = _nodes(graph), _links(graph)
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        host = nodes[I2I_HOST_ID]
        assert host["inputs"][4]["name"] == "指令", "宿主 inputs[4] 应为指令槽"
        directive_link = links[host["inputs"][4]["link"]]
        assert directive_link[1] == I2I_PSM_B_ID, \
            "指令槽上游应 [22] 原始用户词(唯一手写位)"
        # ── [152] Select① 择文合成器(替原 [15])──
        sel1 = sg_nodes[I2I_SG_SEL1_ID]
        assert sel1["type"] == I2I_SG_SEL_CLASS, \
            f"[{I2I_SG_SEL1_ID}] 应为 {I2I_SG_SEL_CLASS} 择文合成器①(替原 [15])"
        pe_l = sg_links[next(i["link"] for i in sel1["inputs"] if i["name"] == "pe开关")]
        assert (pe_l["origin_id"], pe_l["origin_slot"]) == (4012, 0), \
            "[4014].pe开关 应接 [4012]『PE启用?』扇出(1002 ㉑;槽序⑭ 后=inputs[2])"
        asm_l = sg_links[next(i["link"] for i in sel1["inputs"] if i["name"] == "装配全文")]
        assert (asm_l["origin_id"], asm_l["origin_slot"]) == (-10, 4), \
            "[152].装配全文槽 应接 -10 槽4 裸指令(pe关=直写臂真源;PE 链吃裸指令铁则)"
        pe_out_l = sg_links[next(i["link"] for i in sel1["inputs"] if i["name"] == "PE出文")]
        assert pe_out_l["origin_id"] == I2I_RX_ID, \
            f"[152].PE出文 应接 [{I2I_RX_ID}] RegexExtract(lazy;pe开=PE 看图改写)"
        assert sorted(sel1["outputs"][0]["links"] or []) == [60], \
            "[152].最终文本 应单线喂 [141].主体句(择文上位)"
        assert sg_links[60]["target_id"] == I2I_SG_ASM_ID, \
            "link60 落点应 [141] 装配全文件"
        # ── [141] 装配全文件(锁层A迁参数面;1002 ⑭ BASE 连线槽前置)──
        asm = sg_nodes[I2I_SG_ASM_ID]
        assert asm["type"] == I2I_SG_ASM_CLASS, \
            f"[{I2I_SG_ASM_ID}] 应为 {I2I_SG_ASM_CLASS}(i2i 版唯一真源,不喂 PE 链)"
        assert [i["name"] for i in asm["inputs"]] == ["BASE", "主体句", "锁层A全文"], \
            "[141] 槽序应=BASE(连线槽,⑭ 前置)/主体句/锁层A全文(参数下沉;optional)"
        base_l = sg_links[asm["inputs"][0]["link"]]
        assert (base_l["origin_id"], base_l["origin_slot"]) == (I2I_SG_BASE_ID, 0), \
            "[141].BASE 应接 [150].BASE(②层,一处选型;⑭ 前置=inputs[0])"
        subj_l = sg_links[asm["inputs"][1]["link"]]
        assert (subj_l["origin_id"], subj_l["origin_slot"]) == (I2I_SG_SEL1_ID, 0), \
            "[141].主体句 应接 [152].最终文本(择文上位;①层位=指令即主体;⑭ 后=inputs[1])"
        assert all(i["name"] != "锁层A全文" or i.get("link") is None
                   for i in asm["inputs"]), \
            "锁层A全文应为参数面(不接线;恒挂=Q4 可编辑大框)"
        fan = sorted((sg_links[l]["target_id"], sg_links[l]["target_slot"])
                     for l in asm["outputs"][0]["links"] or [])
        assert fan == [(I2I_SG_SEL2_ID, 0)], \
            f"[141].装配全文 应单路扇出([153].装配全文;10-02 单口化:编码改吃 [153]" \
            f".进编码文本,prompt 预览出口改接 [153]=预览实况),得 {fan}"
        fan_sel2 = sorted((sg_links[l]["target_id"], sg_links[l]["target_slot"])
                          for l in sg_nodes[I2I_SG_SEL2_ID]["outputs"][0]["links"] or [])
        assert fan_sel2 == sorted([(I2I_SG_TE, 4), (I2I_SG_TE1, 3), (-20, 4)]), \
            f"[153].进编码文本 应三路扇出([4015].prompt/[171].prompt/IO槽4 prompt=实况),得 {fan_sel2}"
        # W2 反转(0928 PE 迁子图轮):主图零 PE 链件;[12] PE 专属TE经 pe_clip 一进线
        for banned in ("TextGenerate", "StringFormat", "RegexExtract", "BatchImagesNode"):
            hit = [n["id"] for n in graph["nodes"] if n["type"] == banned]
            assert not hit, f"i2i 主图应零 {banned}(PE 链已收进 [40] 子图),得 {hit}"
        # 1002 ⑬:pe_clip 槽撤+主图零 PE TE(迁子图 [4019])
        assert "pe_clip" not in [i["name"] for i in host["inputs"]], \
            "宿主应无 pe_clip 槽(1002 ⑬)"
        assert not [n for n in graph["nodes"] if n["type"] == "CLIPLoader"
                    and n["id"] != 2], "主图应仅 [2] 主TE(⑬)"

    def test_i2i_pe_chain_never_eats_assembly(self):
        """防环红线(map §六;§10.9 依赖环裁定=t2i 实战教训):i2i PE 链六件
        ([21][23][24][25][26][27])的每条连线输入,来源只许 -10 边界(裸指令/图/
        pe_clip)或链内件——装配全文([141]/[153] 出文)禁入 PE 链任何输入,否则
        数据环(141→PE→141)在引擎验证层无 lazy 豁免直接拒整 prompt。"""
        graph = GRAPHS["i2i"]
        sg = _qi21_sg(graph)
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        for nid in I2I_PE_CHAIN_IDS:
            node = sg_nodes[nid]
            for inp in node.get("inputs", []):
                lid = inp.get("link")
                if lid is None:
                    continue
                l = sg_links[lid]
                # 1002 ⑬:[4019] PE 专属 TE 迁入子图=PE 链内件(直供 [4013].clip)
                assert l["origin_id"] == -10 or l["origin_id"] in I2I_PE_CHAIN_IDS \
                    or l["origin_id"] == 4019, \
                    f"i2i 防环红线违例:[{nid}].{inp.get('name')} 上游 {l['origin_id']}" \
                    f"(PE 链输入只许 -10 裸指令/图 或链内件(含 4019 PE TE),装配全文禁入)"

    def test_i2i_select_fixed_sentences_verbatim(self):
        """i2i 三自研件固定句参数逐字(1001 同构集成;照 t2i M-3 同款锚):
        [141] 锁层A全文=库首节常量A 逐字;[152]/[153] 头/尾/W1 句=官方原文+库
        §一 0930 主候选句逐字(手术脚本三源对拍:术前 delimiter 实读+t2i 工作流值
        程序提取+my_nodes default,禁手敲)。[153] 恒 pe关=wv[0] False(纯包裹器)。"""
        graph = GRAPHS["i2i"]
        sg_nodes = _qi21_sg_nodes(graph)
        asm = sg_nodes[I2I_SG_ASM_ID]
        # 1004 重锚:库首节逐字互锁废止(A4);锁层A=qi21/i2i 两件参数面横锁同值
        assert _widget(asm, I2I_SG_ASM_WV["锁层A全文"]) == _wf_lock_a(), \
            "i2i [4011] 锁层A全文参数 应=两件在档同值(1004 横锁;恒挂=装配公式第三段)"
        for sid in (I2I_SG_SEL1_ID, I2I_SG_SEL2_ID):
            sel = sg_nodes[sid]
            assert _widget(sel, QI21_SG_SEL_WV["RGBA官方头句"]) == RGBA_HEAD, \
                f"i2i [{sid}] RGBA官方头句参数 非官方原文逐字"
            assert _widget(sel, QI21_SG_SEL_WV["RGBA官方尾句"]) == RGBA_TAIL, \
                f"i2i [{sid}] RGBA官方尾句参数 非官方原文逐字"
            assert _widget(sel, QI21_SG_SEL_WV["W1收束句"]) == _qi21_w1_truth(), \
                f"i2i [{sid}] W1收束句参数 与库 §一 0930 主候选句不逐字一致"
        assert sg_nodes[I2I_SG_SEL2_ID]["widgets_values"][QI21_SG_SEL_WV["pe开关"]] \
            is False, "[153] pe开关应恒 false(透明包裹器②=头句+装配全文+尾句,无择文)"
        pe_sw2 = next((i for i in sg_nodes[I2I_SG_SEL2_ID]["inputs"]
                       if i["name"] == "pe开关"), None)
        assert pe_sw2 is not None and pe_sw2.get("link") is None, \
            "[153].pe开关 应 widget 恒关不接线(纯包裹器)"

    def test_i2i_pe_chain_consumers_lazy(self):
        """PE 链出线消费者 lazy 谓词(照 t2i M-4 同款,域=i2i PE 链终件 [27]):
        pe关 ⇒ PE 链六件零执行零 PE TE 装载的静态守卫——[27] 每条出线消费者必须
        为自研件且被喂槽声明 lazy(True)+实名懒钩子 check_lazy_status。"""
        graph = GRAPHS["i2i"]
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        rx = sg_nodes[I2I_RX_ID]
        assert rx["type"] == "RegexExtract", f"[{I2I_RX_ID}] 应为 RegexExtract(谓词域锚)"
        for out in rx["outputs"]:
            for lid in (out.get("links") or []):
                assert lid in sg_links, \
                    f"[{I2I_RX_ID}].{out['name']} 出线 link{lid} 不在子图链接册(双写漂移)"
                l = sg_links[lid]
                tgt = sg_nodes[l["target_id"]]
                slot = tgt["inputs"][l["target_slot"]]["name"]
                cls = _load_my_node_class(tgt["type"])
                assert cls is not None, (
                    f"[{I2I_RX_ID}].{out['name']} 消费者 [{l['target_id']}]{tgt['type']}.{slot}"
                    f" 非自研件(静态不可证 lazy)——pe关零装载铁律要求 [27] 出线消费者"
                    f"全为 lazy 自研件")
                it = cls.INPUT_TYPES()
                decl = next((it[sec][slot] for sec in ("required", "optional")
                             if slot in it.get(sec, {})), None)
                assert decl is not None, \
                    f"{tgt['type']}.{slot} 不在 INPUT_TYPES 声明面(接口漂移)"
                meta = decl[1] if len(decl) > 1 and isinstance(decl[1], dict) else {}
                assert meta.get("lazy") is True, (
                    f"[{I2I_RX_ID}].{out['name']} 消费槽 {tgt['type']}.{slot} 未声明"
                    f" lazy(True)——pe关时强依赖仍拉 PE 链整跑+装载 PE TE")
                assert hasattr(cls, "check_lazy_status"), \
                    f"{tgt['type']} 缺实名懒钩子 check_lazy_status(lazy 槽永不请求=拿不到值)"

    def test_i2i_pe_off_lazy_dry_run(self):
        """pe关懒执行干跑(1001 同构集成静态锚):pe关 ⇒ PE 链六件零入执行集+
        主图 [12] PE CLIPLoader 零装载(仅经 40.pe_clip→[26] 消费);pe关路真源=
        裸指令(-10槽4←主图 [22])经 [152] 择文直写臂进 [141] 装配。"""
        graph = GRAPHS["i2i"]
        asg = _asg(graph)
        host = _host_of(graph, asg)
        idx = ASSEMBLY_PANEL_CONTROLS["i2i"].index("PE启用?")
        host["widgets_values"][idx] = False
        try:
            reach = _reach_state(graph, 8)
            for nid in I2I_PE_CHAIN_IDS:
                assert not _reach_has(reach, asg["id"], nid), \
                    f"pe关 PE 链件 [{nid}] 不应入执行集(Select① 择直写臂,懒执行零装载)"
            assert not _reach_has(reach, None, 12), \
                "pe关 主图 [12] PE CLIPLoader 不应入执行集(零 PE TE 装载)"
            assert _reach_has(reach, None, 400), \
                "pe关 主图 [400](⑫ 前 [22])原始用户词应在执行集(直写选配臂真源=裸指令)"
            assert _reach_has(reach, asg["id"], I2I_SG_ASM_ID), \
                "pe关 [141] 装配全文件应在执行集(直写路=指令+BASE+锁层A)"
        finally:
            host["widgets_values"][idx] = True

    def test_default_assembly_interlocks_library(self):
        """装配↔05 库逐字互锁(1001 同构集成:锁层A自 [110] 常量件迁 [141] 参数面):
        pe关直写路装配全文=[22]指令(官方换装例句)+MyQi21DaojieBase 人物
        base_text(逐字=05 库②层组合)+[141].锁层A全文参数(逐字=库首节常量A);
        pe开路=PE 抽取文替①层(运行时文本,静态不可逐字——同 0926 裁定1 口径,
        本断言走 pe关选配臂核验真源)。"""
        graph = GRAPHS["i2i"]
        sg_nodes = _qi21_sg_nodes(graph)
        qi21 = {e["zh"]: e for e in
                json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))["types"]}
        # 1004 重锚:数据↔库②层逐字互锁废止(A4 库降级+正负拆开瘦身);锁层A↔库
        # 同废——改锁 两件横锁+三段自洽组合(指令+人物 positive_text+锁层A参数面)
        assert _widget(sg_nodes[I2I_SG_ASM_ID], I2I_SG_ASM_WV["锁层A全文"]) == _wf_lock_a(), \
            "i2i [4011] 锁层A全文参数 应=两件在档同值(1004 横锁)"
        assembled = "\n".join([
            _widget(_nodes(graph)[I2I_PSM_B_ID], 0),
            qi21["人物"]["positive_text"],
            _widget(sg_nodes[I2I_SG_ASM_ID], I2I_SG_ASM_WV["锁层A全文"])])
        want = "\n".join([I2I_B_SEG, qi21["人物"]["positive_text"], _wf_lock_a()])
        assert assembled == want, \
            "pe关直写路装配全文三段组合应自洽(1004 重锚:指令+人物positive_text+锁层A)"

    def test_lora_slot_present_and_bypassed(self):
        """0929 S3 收装:LoRA/支路/选择件/seed 全居加速子图([190] 宿主,id 沿用
        原选择件;[7] Cache MODEL 出线进子图=D4「Cache 留主图①块」);注入式
        MODEL/steps/latent/正源开关农场全拆(13 件);默认档=直出40步 干跑零
        LoRA(懒选择);T8 model=Cache 直连(经边界);0928 黑图修复正源分线:
        支路0=宿主 positive(双参考,link71)/支路1·2=宿主 positive_single(单参考,
        link70)——正源分线经边界槽内聚,语义零改动;TE-Speed 槽不在本件
        (白名单锁三域,任何未知类型即红)。"""
        graph = GRAPHS["i2i"]
        got = {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in graph["links"]}
        for want in [  # D4 i2i 列边界:主图骨架六线(三源→宿主,宿主→解码)
            (25, I2I_CACHE_ID, 0, I2I_XHOST_ID, 0, "MODEL"),       # [7]Cache → 宿主.model
            (71, I2I_HOST_ID, 0, I2I_XHOST_ID, 1, "CONDITIONING"),  # [40].positive → 宿主.positive
            (20, I2I_HOST_ID, 1, I2I_XHOST_ID, 2, "CONDITIONING"),  # [40].negative → 宿主.negative
            (70, I2I_HOST_ID, 3, I2I_XHOST_ID, 3, "CONDITIONING"),  # [40].positive_single(0929 S4:槽4→3) → 宿主.positive_single
            (33, I2I_LATENT_SW_ID, 0, I2I_XHOST_ID, 4, "LATENT"),   # [20] 画幅开关 → 宿主.latent
            (85, I2I_XHOST_ID, 0, 5, 0, "LATENT"),                  # 宿主.latent → [5].samples(⑫:9→5)
        ]:
            assert want in got, f"i2i 加速边界接线缺: link{want[0]}"
        _assert_accel_subgraph(
            graph, "i2i",
            xsg_uuid=I2I_XSG_UUID, host_id=I2I_XHOST_ID, sel_id=I2I_XSEL_ID,
            ks_direct=I2I_SAMPLER_ID, ks_viggle=I2I_SAMPLER_VIG_ID,
            lora_id=I2I_LORA_ID, t8_id=I2I_T8, seed_id=I2I_SEED_ID,
            save_id=8, model_src_id=I2I_CACHE_ID, latent_src_id=I2I_LATENT_SW_ID,
            pos_direct="positive", pos_accel="positive_single",
            boundary_inputs=[("model", "MODEL"), ("positive", "CONDITIONING"),
                             ("negative", "CONDITIONING"), ("positive_single", "CONDITIONING"),
                             ("latent", "LATENT"), ("速度档位", "COMBO"), ("seed", "INT")],
            host_inputs=[("model", True, False), ("positive", True, False),
                         ("negative", True, False), ("positive_single", True, False),
                         ("latent", True, False), ("速度档位", False, True), ("seed", False, True)],
            te1_asg=I2I_SG_TE1,
            banned_main_types=("easy compare", "KSampler", "LoraLoaderModelOnly",
                               T8_CLASS, SPEED_SELECT_CLASS, "PrimitiveInt"),
            # 旧注入式件 id 锚(0929 并行化拆除):171-174/183-185 已随 0928 PE 迁
            # 子图/单参考族转装配子图内部 id(不在主图=断言仍真)
            gone_main_ids=(I2I_LORA_PB_ID, I2I_LORA_SW_ID, 164, 165, 166,
                           174, 183, 184, 185, 186, 187, 188))
        # 0928 黑图修复硬约束(research/03 §1.3/§7.2):支路0 正源≠加速支路
        # (双参考 positive 槽0 vs 单参考 positive_single 槽3,两异源宿主输出槽直连;
        # 0929 S4/D10:positive_single 自槽4 上移一槽,prompt 迁最末槽4)
        host = _nodes(graph)[I2I_HOST_ID]
        assert host["outputs"][0]["name"] == "positive" \
            and host["outputs"][3]["name"] == "positive_single", \
            "i2i 宿主双正源输出应=positive(槽0)/positive_single(槽3,0929 S4 上移)"
        # TE-Speed 槽禁入:全图(主图+两子图)节点类型白名单(0929 S3 扩三域;
        # ComfySwitchNode 恒留册=装配 [15]/[144]/[173]+主图 [20] 在用)
        sg_ids = {sg["id"] for sg in _sgs(graph)}
        for sg in _sgs(graph):
            for n in [*graph["nodes"], *sg["nodes"]]:
                if n.get("properties", {}).get("subgraph") in sg_ids:
                    continue  # 宿主节点 type=子图 uuid
                assert n["type"] in I2I_NODE_TYPE_WHITELIST, \
                    f"i2i 未知节点类型 {n['type']!r}(TE-Speed 槽禁入本件,R26.4 再补)"

    def test_steps_panel_is_effective_value(self):
        """0929 并行化(R6):steps 联动机构拆除——步数回归各支路 KSampler widget
        ([8]=40/[189]=359,面板值即执行值);此处锁旧 steps 联动/档位件 id 全不在图
        (防重跑回退),结构断言在共用断言器。"""
        nodes = _nodes(GRAPHS["i2i"])
        for gone in (164, 165, 166, 30):
            assert gone not in nodes, \
                f"i2i: 旧注入式件 [{gone}] 应已拆除(0929 并行化)"

    def test_all_switches_default_off(self):
        """开关默认态(1001 同构集成后):[152] Select① pe开关=宿主面板「PE开关」
        默认 true=PE 开路(默认 PE 改写;关=直写按图选配,0926 裁定1)/[153]
        Select② pe开关 widget 恒 false(纯包裹器)/其余 widget 全 false(懒执行
        旁路):[19] 画幅跟随输入图/[20] 画幅双路 false/[144][173] RGBA 普通;
        旧 [15]/[30]/[32] 开关件已随同构集成/0929 并行化拆除。"""
        graph = GRAPHS["i2i"]
        nodes = _nodes(graph)
        sg_nodes = _qi21_sg_nodes(graph)
        sel1 = sg_nodes[I2I_SG_SEL1_ID]
        assert sel1["type"] == I2I_SG_SEL_CLASS and \
            sel1["widgets_values"][QI21_SG_SEL_WV["pe开关"]] is True, \
            "[152] 择文合成器 pe开关默认应 true(默认 PE 改写,0926 裁定1)"
        sel2 = sg_nodes[I2I_SG_SEL2_ID]
        assert sel2["widgets_values"][QI21_SG_SEL_WV["pe开关"]] is False, \
            "[153] 透明包裹器 pe开关应恒 false(纯包裹=头句+装配全文+尾句)"
        assert nodes[I2I_LATENT_PB_ID]["widgets_values"][0] is False, "[19] 画幅开关源默认应 false"
        assert nodes[I2I_LATENT_SW_ID]["widgets_values"][0] is False, "[20] 画幅双路默认应 false"
        # 10-02 单口化:[144]/[173] 双闸门塌缩退役(原「默认 false」断言随之退场)
        host = nodes[I2I_HOST_ID]
        assert host["widgets_values"][3] == "自动", \
            "[6] 面板「RGBA透明」默认应=自动(1001 ① 文案轮;⑲ 序:PE启用? 前移后=第4值)"
        assert I2I_LORA_PB_ID not in nodes and I2I_LORA_SW_ID not in nodes, \
            "i2i: 旧档位/[32] MODEL 开关应已拆除(0929 并行化)"

    def test_dual_channel_and_latent_dual_path(self):
        """edit 骨架保留:①双通道(BatchImagesNode 合批全部预缩图喂 TextGenerate.image
        =PE 看全图;子图双编码器 images.image_1/2 吃选定图且 RGBA 路同样接双图);
        ②latent 双路(宿主.latent→[20].on_false 跟随 image_1/[18] 空潜 on_true,
        KSampler.latent_image 上游=[20]);③双图预缩 1.5/1.0MP+官方示例双图。"""
        graph = GRAPHS["i2i"]
        nodes, links = _nodes(graph), _links(graph)
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        batch = [n for n in sg_nodes.values() if n["type"] == "BatchImagesNode"]
        assert len(batch) == 1 and batch[0]["id"] == I2I_BATCH_ID, \
            "子图应恰 1 个 BatchImagesNode[25](PE 全图通道,0928 随 PE 链迁入)"
        wired = [i for i in batch[0]["inputs"] if i.get("link")]
        slots = {sg_links[i["link"]]["origin_slot"] for i in wired
                 if sg_links[i["link"]]["origin_id"] == -10}
        assert slots == {2, 3}, \
            "合批上游应为 -10 槽2/槽3 双图边界(预缩图经宿主,PE 看全图)"
        tg = sg_nodes[I2I_TG_ID]
        assert sg_links[next(i["link"] for i in tg["inputs"] if i["name"] == "image")]["origin_id"] \
            == I2I_BATCH_ID, "TextGenerate.image 上游应 BatchImagesNode(子图内)"
        host = nodes[I2I_HOST_ID]
        for slot, want in ((2, I2I_SCALE_IDS[0]), (3, I2I_SCALE_IDS[1])):
            assert links[host["inputs"][slot]["link"]][1] == want, \
                f"宿主 image 槽{slot} 上游应预缩件[{want}]"
        # 10-02:主编码=[4015] 双图;单图编码=[171] 仅 image_1(单参考正源,0928 黑图修复语义)
        for enc_id, want_n in ((I2I_SG_TE, 2), (I2I_SG_TE1, 1)):
            enc = sg_nodes[enc_id]
            imgs = [i for i in enc["inputs"] if i["name"].startswith("images.")]
            assert len(imgs) == want_n and all(i.get("link") for i in imgs), \
                f"[{enc_id}] 图槽数应 {want_n} 且全接(主编码双图/单图编码单参考)"
            assert _widget(enc, TE_WV["resolution"]) == 0, \
                f"[{enc_id}] resolution 应 0(不重采样,画幅随输入图)"
        scales = {n["id"]: n for n in _by_type(graph, "ImageScaleToTotalPixels")}
        assert sorted(scales) == list(I2I_SCALE_IDS), \
            f"预缩件 id 应 {list(I2I_SCALE_IDS)},得 {sorted(scales)}"
        assert scales[I2I_SCALE_IDS[0]]["widgets_values"][1] == 1.5, "画布预缩应 1.5MP"
        assert scales[I2I_SCALE_IDS[1]]["widgets_values"][1] == 1.0, "参考预缩应 1.0MP"
        assert sorted(_widget(n, 0) for n in _by_type(graph, "LoadImage")) == \
            ["clothing_light_blue_denim_shirt.png", "portrait_model_denim.png"], \
            "i2i 应预填官方示例双图(edit 生成器口径)"
        lsw = nodes[I2I_LATENT_SW_ID]
        assert lsw["outputs"][0]["type"] == "LATENT" and lsw["widgets_values"][0] is False, \
            "[20] 应为 LATENT 开关且默认 false"
        assert links[lsw["inputs"][0]["link"]][1] == I2I_HOST_ID, \
            "[20].on_false 应宿主.latent(跟随 image_1)"
        assert links[lsw["inputs"][1]["link"]][1] == I2I_EL_ID, \
            "[20].on_true 应 EmptyLatentImage[18]"
        # 0929 S3:KSampler.latent_image ← -10 latent 边界槽 ← 宿主.latent ← 主图 [20]
        xsg = _xsg(graph)
        _lat = next(i for i in _sg_nodes(xsg)[I2I_SAMPLER_ID]["inputs"]
                    if i["name"] == "latent_image")
        _ll = _sg_links(xsg)[_lat["link"]]
        assert (_ll["origin_id"], _ll["origin_slot"]) == (-10, 4), \
            "KSampler.latent_image 应接 -10 latent 槽(←宿主.latent←主图 [20] 画幅开关)"
        cache = _by_type(graph, "QwenImage21Cache")
        assert len(cache) == 1 and cache[0]["widgets_values"] == ["auto", "default"], \
            "应恰 1 个 QwenImage21Cache(auto/default)恒挂 MODEL 链"

    def test_preview_and_rgba_formula(self):
        """[28] 装配预览(easy showAnything)接宿主 prompt 输出(跑图前过目最终
        装配文本);RGBA=官方公式(头+装配全文+尾,空格 delimiter)——1001 同构
        集成:[153] Select②「透明包裹器」恒 pe关=纯包裹,头尾句迁参数面逐字,
        透明文本口(口1)替原 [162]+[163] 两拼直喂 [143].prompt+[172].prompt。"""
        graph = GRAPHS["i2i"]
        nodes, links = _nodes(graph), _links(graph)
        sg_nodes, sg_links = _qi21_sg_nodes(graph), _qi21_sg_links(graph)
        previews = _by_type(graph, "easy showAnything")
        assert len(previews) == 1 and previews[0]["id"] == I2I_PREVIEW_ID, \
            "应恰 1 个 easy showAnything 装配预览[28]"
        assert links[previews[0]["inputs"][0]["link"]][1] == I2I_HOST_ID, \
            "预览输入应接 [40] 宿主 prompt 输出"
        # [153] 透明包裹器:头尾句参数逐字+装配全文←[141]+透明文本双扇出
        sel2 = sg_nodes[I2I_SG_SEL2_ID]
        assert sel2["type"] == I2I_SG_SEL_CLASS, \
            f"[{I2I_SG_SEL2_ID}] 应为 {I2I_SG_SEL_CLASS} 透明包裹器②"
        assert _widget(sel2, QI21_SG_SEL_WV["RGBA官方头句"]) == RGBA_HEAD, \
            "[153] RGBA官方头句参数 非官方原文逐字(This is an RGBA format image with transparency.)"
        assert _widget(sel2, QI21_SG_SEL_WV["RGBA官方尾句"]) == RGBA_TAIL, \
            "[153] RGBA官方尾句参数 非官方原文逐字(The image has an alpha channel and a transparent background.)"
        asm_l = sg_links[next(i["link"] for i in sel2["inputs"] if i["name"] == "装配全文")]
        assert (asm_l["origin_id"], asm_l["origin_slot"]) == (I2I_SG_ASM_ID, 0), \
            "[153].装配全文 应接 [141].装配全文(透明包裹真源,≡原[162].string_b)"
        # 10-02 单口化:[153] 单口「进编码文本」(三路扇出断言见装配段);旧两口形
        # 「透明文本双扇出+最终文本悬空+RGBA 编码/双闸门组」随 R1/R2 塌缩全数退役
        assert [o["name"] for o in sel2["outputs"]] == ["进编码文本"], \
            "[153] 应单口=进编码文本(10-02 R1 单口化;恒 pe关+透明模式四象限)"
        assert sel2["inputs"][3]["name"] == "透明模式" and sel2["inputs"][3].get("link") is not None, \
            "[153].透明模式 应保持接线(←[180].rgba_on;透明边界唯一驻件)"

    def test_no_custom_titles_except_selfbuilt(self):
        """(第二域副本=TestI2IContract 域)标题铁律 1002 大轮重立:全节点带号
        双名(⑤⑧+⑨补用户裁定推翻 0924-r8 核心零 title;i2i 空标题清欠)。"""
        import re as _re
        graph = GRAPHS["i2i"]
        sg, xsg = _qi21_sg(graph), _xsg(graph)
        for n in [*graph["nodes"], *sg["nodes"], *xsg["nodes"]]:
            title = n.get("title")
            assert isinstance(title, str) and _re.match(r"^\[\d+\] ", title), \
                f"i2i 节点 [{n['id']}]{n['type']} title 应带号双名,得 {title!r}"
        assert _host_of(graph, xsg)["title"] == "[7] 加速子图"
        assert _host_of(graph, sg)["title"] == "[6] 文本提示词类型优化子图"

    def test_note_documents_mechanism_and_slots(self):
        """说明 Note 要点锁:生修合一机制纠正/指令×装配关系/加速区=三支路并行+单选择件
        (0929 并行化:懒执行/seed 单源/零真重复/依赖警示)/TE-Speed 不在本件/画幅随
        输入图/维护警示(生成器幂等)。Note 被重跑回退即红。"""
        note = _by_type(GRAPHS["i2i"], "MarkdownNote")[0]["widgets_values"][0]
        for token in ("生修合一", "指令=改什么", "指令即主体", "无传统 img2img",
                      "LoraLoaderModelOnly", I2I_LORA_FILE,
                      "[7010]", "[7013]",
                      "TE-Speed 槽不在本件", "画幅随输入图", "qi21_daojie_i2i_0924.py",
                      "05-道劫规范提示词库.md", "MyQi21DaojieBase", "BatchImagesNode",
                      "ImageScaleToTotalPixels", RGBA_HEAD_ZH,
                      # 0929 并行化轮:三支路+单选择件文案+依赖警示+T8 事实
                      *I2I_PARALLEL_NOTE_TOKENS,
                      # 0928 PE 迁子图轮:面板开关+全子图内口径
                      "PE启用?", "全程子图内"):
            assert token in note, f"i2i Note 缺要点: {token!r}"


# ── 7. 计数锚(防漂移):K2图像 36 件不变 + Q2-1图像 7 自研件(+3 官方)───
# 口径注:本锚按目录 json 实数(K2图像 全量=桥 API 8 + 画布件 28,09-23 现状)。
# AGENTS.md「K2图像18」是 09-15 静态自研 MY- 流的历史账口径,与目录文件数
# 非同一账本;本测试锁目录实数——任何件数漂移(误删/误增)即红。
# 09-23 午:道劫直写旧件 qwen21-daojie-t2i 退役删除,7→6(自研 4→3)。
# 09-24:i2i 新件 qi21-道劫-i2i 入库(2_图生图 新功能子夹),6→7(自研 3→4)。
# 10-02:Q2-1 自研扩批五件入库(1_文生图 qwen21-daotu-rgba-t2i/
# qwen21-t2i-seedvr2/qwen21-titlecard-t2i + 2_图生图 qwen21-multiref-edit/
# qwen21-pose-edit,台账=漫影工作流清单.md 同批;全树 75→80),
# 12→17(官方/社区不动,+5 自研件)。
# 10-01 深夜:社区模板批入库(Trellis 10-01-community-workflow-import),
# 3_社区模板/ 四件(宏雷两件原样+黑鹤两件本地化改造,台账=漫影工作流清单
# .md 同批;全树 69→75),8→12(自研/官方不动,+4 社区件)。

# ── 6g. SeedVR2 放大尾档+rgthree 对比件契约(1002 衔接批,Trellis
# 10-02-qi21-subgraph-singleport implement 步6-9;prd ㉕㉖;手术脚本
# qi21_linkage_surgery_1002.py;参数真源=qwen21-t2i-seedvr2.json 只读拷贝)──


SVR2_DIT, SVR2_VAE, SVR2_UP = 501, 502, 503      # ⑤放大尾档四件组(500 段新带)
SVR2_SAVE, SVR2_CMP = 504, 505                    # t2i 另有 [505] 对比件(㉖)
SVR2_DIT_FILE = "seedvr2_7b_sharp_fp8_e4m3fn.safetensors"
SVR2_VAE_FILE = "ema_vae_fp16.safetensors"
SVR2_SAVE_PREFIX = "MYStudio-2K"
SVR2_GROUP_TITLE = "道劫·⑤SeedVR2放大尾档"


class TestSeedVR2TailContract1002:
    """㉕ 尾档结构锚(t2i/i2i):[5] 解码扇出双喂(直出存 [8]+放大路 [503]);
    四件组 census/接线/wv 逐字(DiT sharp 7B fp8/VAE ema/短边 2048=2K/存
    MYStudio-2K);⑤组框罩四件=Ctrl+B 整组旁路语义载体(框选→只出 [8] 直出
    图;[505] 对比件留组外=旁路态仍可预览);edit 零尾档(用户令只点 t2i+i2i)。
    ㉖ 对比件锚(t2i 专属):image_a=[5] 直出/ image_b=[503] 2K,滑帘对比。"""

    def test_tail_group_present_and_bypass_semantics(self):
        for name in ("qi21", "i2i"):
            graph = GRAPHS[name]
            nodes = _nodes(graph)
            grp = next((g for g in graph["groups"]
                        if g.get("title", "").startswith(SVR2_GROUP_TITLE)), None)
            assert grp is not None, \
                f"{name}: 缺⑤放大尾档组框(锚={SVR2_GROUP_TITLE!r}…;Ctrl+B 整组旁路语义载体)"
            gx0, gy0 = grp["bounding"][0], grp["bounding"][1]
            gx1 = gx0 + grp["bounding"][2]
            gy1 = gy0 + grp["bounding"][3]
            for nid in (SVR2_DIT, SVR2_VAE, SVR2_UP, SVR2_SAVE):
                n = nodes[nid]
                assert (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                        and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1), \
                    f"{name}: ⑤组框未罩住 [{nid}](框选本组 Ctrl+B 语义成员)"
            if name == "qi21":
                cmp_n = nodes[SVR2_CMP]
                inside = (gx0 <= cmp_n["pos"][0] and cmp_n["pos"][0] + cmp_n["size"][0] <= gx1
                          and gy0 <= cmp_n["pos"][1] and cmp_n["pos"][1] + cmp_n["size"][1] <= gy1)
                # 1003 手改标准:[505] 并入⑤组框(旧"组框外纯预览"裁定退役;
                # 副作用=整组旁路时对比件随组旁路、b 侧 2K 预览不可用,已知接受)
                assert inside, \
                    "qi21: [505] 对比件应在⑤组框内(1003 手改标准:并入组框)"

    def test_tail_wiring_and_widgets(self):
        for name in ("qi21", "i2i"):
            graph = GRAPHS[name]
            nodes, links = _nodes(graph), _links(graph)
            # 四件 census
            want = {SVR2_DIT: "SeedVR2LoadDiTModel", SVR2_VAE: "SeedVR2LoadVAEModel",
                    SVR2_UP: "SeedVR2VideoUpscaler", SVR2_SAVE: "SaveImage"}
            for nid, typ in want.items():
                assert nodes[nid]["type"] == typ, \
                    f"{name}: [{nid}] 应 {typ},得 {nodes[nid]['type']}"
            # wv 逐字(参数真源=qwen21-t2i-seedvr2.json 同款,放大=短边 2048=2K 档)
            assert nodes[SVR2_DIT]["widgets_values"][0] == SVR2_DIT_FILE, \
                f"{name}: [{SVR2_DIT}] 应 sharp 7B fp8 权重逐字"
            assert nodes[SVR2_VAE]["widgets_values"][0] == SVR2_VAE_FILE, \
                f"{name}: [{SVR2_VAE}] 应 ema_vae_fp16 逐字"
            assert nodes[SVR2_UP]["widgets_values"][2] == 2048, \
                f"{name}: [{SVR2_UP}] resolution 应 2048(短边2K 档),得 {nodes[SVR2_UP]['widgets_values']}"
            assert nodes[SVR2_SAVE]["widgets_values"] == [SVR2_SAVE_PREFIX], \
                f"{name}: [{SVR2_SAVE}] 前缀应 {SVR2_SAVE_PREFIX!r}"
            # 接线:[5] 扇出双喂 + DiT/VAE→放大→存
            out5 = sorted(l[0] for l in graph["links"] if l[1] == 5)
            assert _links_pid(graph, 8) in out5 and _links_pid(graph, SVR2_UP) in out5, \
                f"{name}: [5] 应扇出喂 [8] 直出存+[503] 放大路,得 {out5}"
            assert _input_src(nodes, links, SVR2_UP, "image") == 5, \
                f"{name}: [{SVR2_UP}].image 应接 [5] 解码直出图"
            assert _input_src(nodes, links, SVR2_UP, "dit") == SVR2_DIT, \
                f"{name}: [{SVR2_UP}].dit 应接 [{SVR2_DIT}]"
            assert _input_src(nodes, links, SVR2_UP, "vae") == SVR2_VAE, \
                f"{name}: [{SVR2_UP}].vae 应接 [{SVR2_VAE}]"
            assert _input_src(nodes, links, SVR2_SAVE, "images") == SVR2_UP, \
                f"{name}: [{SVR2_SAVE}].images 应接 [{SVR2_UP}] 2K 产物"

    def test_comparer_t2i_only(self):
        graph = GRAPHS["qi21"]
        nodes, links = _nodes(graph), _links(graph)
        cmp_n = nodes[SVR2_CMP]
        assert cmp_n["type"] == "Image Comparer (rgthree)", \
            f"qi21: [{SVR2_CMP}] 应 rgthree 对比件,得 {cmp_n['type']}"
        assert _input_src(nodes, links, SVR2_CMP, "image_a") == 5, \
            "[505].image_a 应接 [5] 直出图(放大前)"
        assert _input_src(nodes, links, SVR2_CMP, "image_b") == SVR2_UP, \
            "[505].image_b 应接 [503] 2K 图(放大后,滑帘对比细节增益)"
        up_out = sorted(nodes[SVR2_UP]["outputs"][0]["links"] or [])
        assert up_out == sorted([_link_of(nodes, links, SVR2_SAVE, "images"),
                                 _link_of(nodes, links, SVR2_CMP, "image_b")]), \
            f"[503] 输出应恰扇出 [504]+[505](存盘+对比),得 {up_out}"
        for banned_name in ("i2i", "edit"):
            assert not [n for n in GRAPHS[banned_name]["nodes"]
                        if n["type"] == "Image Comparer (rgthree)"], \
                f"{banned_name}: 对比件仅 t2i(用户令只点 t2i)"

    def test_edit_has_no_tail(self):
        graph = GRAPHS["edit"]
        hits = [n["id"] for n in graph["nodes"]
                if str(n["type"]).startswith("SeedVR2")]
        assert hits == [], \
            f"edit: 主图应零 SeedVR2 尾档件(用户令只点 t2i+i2i),得 {hits}"

    def test_quickref_guide_line(self):
        """坑5 文案锁:速查卡注明分辨率适配指引(方案2 手动旁路裁定,不加自动判断件)。"""
        for name in ("qi21", "i2i"):
            note = next(n for n in GRAPHS[name]["nodes"] if n["id"] == 402)
            text = note["widgets_values"][0]
            assert "放大尾档适合 1MP 档(道具/人脸/自由)" in text \
                and "4.2MP≈纯插值建议旁路" in text, \
                f"{name}: 速查卡缺放大尾档分辨率适配指引行(㉕ 裁定文案)"
            assert "框选⑤组框 Ctrl+B" in text, \
                f"{name}: 速查卡缺 Ctrl+B 整组旁路指引"


def _input_src(nodes: dict, links: dict, nid: int, slot_name: str) -> int:
    n = nodes[nid]
    inp = next(i for i in n["inputs"] if i.get("name") == slot_name)
    return links[inp["link"]][1]


def _link_of(nodes: dict, links: dict, nid: int, slot_name: str) -> int:
    n = nodes[nid]
    inp = next(i for i in n["inputs"] if i.get("name") == slot_name)
    return inp["link"]


def _links_pid(graph: dict, nid: int) -> int:
    """[nid].images 槽现挂线 id(尾档定位用小件)。"""
    n = next(x for x in graph["nodes"] if x["id"] == nid)
    return n["inputs"][0]["link"]


class TestCountAnchor:
    def test_qwen21_dir_exactly_seventeen(self):
        files = sorted(p.name for p in (_IMG_DIR / "Q2-1图像").rglob("*.json"))
        assert files == [
            "image_qwen_image_2_1_background_removal.json",
            "image_qwen_image_2_1_image_edit.json",
            "image_qwen_image_2_1_t2i.json",
            "qi21-edit.json",
            "qi21-道劫-i2i.json",
            "qi21-道劫-t2i.json",
            "qwen21-daotu-rgba-t2i.json",
            "qwen21-multiref-edit.json",
            "qwen21-pose-edit.json",
            "qwen21-sanlian-t2i.json",
            "qwen21-t2i-seedvr2.json",
            "qwen21-t2i.json",
            "qwen21-titlecard-t2i.json",
            "社区-skill姿态图放大-扩展整合.json",
            "社区-全能图片编辑-官方PE.json",
            "社区-全能文生图-官方PE.json",
            "社区-编辑生图整合-TE.json",
        ], f"Q2-1图像 应恰 17 件(10 自研+3 官方模板+4 社区模板;10-02 自研扩批五件入库 12→17,前账:10-01 社区模板批入库 8→12、2026-10-01 B4 吸收件 qwen21-sanlian-t2i 新增),得 {files}"

    def test_official_templates_upstream_identical(self):
        """官方三件须与 Comfy-Org/workflow_templates 上游逐字节一致(官方件零改动铁律)。
        哈希=09-23 自上游 raw 拉取件烙印(t2i/edit 两件与研究档存档逐字节一致,
        background_removal 为当日新收);上游更新时重拉重烙并记台账。"""
        import hashlib
        pinned = {
            "image_qwen_image_2_1_t2i.json":
                "737ce0400bdca139108b6c88b033c0cd8b40dba5b1ca5c3495872ee3824471e3",
            "image_qwen_image_2_1_image_edit.json":
                "25b9f329e26331c31318dd8f42d64b387e5bf4b786fe890a6ef159e60519f8ee",
            "image_qwen_image_2_1_background_removal.json":
                "2e7b22f9040a59eabcad59a7af8ceaa0e69844fc5fd078723e0b743633caed9a",
        }
        for name, sha in pinned.items():
            p = _IMG_DIR / "Q2-1图像" / "0_官方模板" / name
            assert p.exists(), f"官方模板缺失:{name}"
            actual = hashlib.sha256(p.read_bytes()).hexdigest()
            assert actual == sha, f"官方件被改动或上游漂移:{name}({actual})"

    def test_k2_dir_unchanged_36(self):
        files = sorted(p.name for p in K2_DIR.rglob("*.json") if p.name != ".DS_Store")
        assert len(files) == 36, \
            f"K2图像 目录 json 应 36 件不变(09-23 现状锚),得 {len(files)}: {files}"


# ── 2026-10-01 B4 吸收件:qwen21-sanlian-t2i 最小锚 ─────────────────────────
# absorbIf 依据=0930 B4 对拍(apps/output/b4-duipai-0930/b4-duipai-report.json
# gates.B_Q3吸收裁定;配方 apps/build/scripts/b4_duipai_plan_0930.md §四门B):
# G1 三格同人 + G2 左正/中侧/右背 认定 → 以 qwen21-t2i 派生三联预设工作流,
# 1536×512 三联模板说明卡+A5 切割警示随档+复用 p2_grid_cut.py 切割口,
# 只仿 TE-MAN 一键三视图设计零拷码。

SANLIAN_GRAPH = json.loads(SANLIAN.read_text(encoding="utf-8"))

# 三联结构模板锚(=K2-多视图.json [50] 结构句;结构 token 非全文逐字——全文
# 逐字锁在 K2 侧,此处锁三联骨架要素+Character 段在场)
SANLIAN_TEMPLATE_TOKENS = (
    "three equal vertical panels",
    "Left panel: full-body front view",
    "Middle panel: full-body side view facing left",
    "Right panel: full-body back view",
    "nothing crossing the divider lines",
    "Character:",
)
SANLIAN_NOTE_TOKENS = (
    "宫格=中间产物,切割后才作参考",   # A5 警示(ask 钦定措辞)
    "p2_grid_cut.py",                 # 切割口引用随档
    "--rows 1 --cols 3",              # 三联切割参数(1 行 3 列)
    "只仿设计,零拷码",               # license 红线随档
)


class TestSanlianContract:
    def test_front_end_format_in_place(self):
        """引擎前端格式必需字段在位(nodes/links/groups;非桥 API 格式——同
        09-23 格式取舍,画布直开为最终裁判)。"""
        for key in ("nodes", "links", "groups"):
            assert key in SANLIAN_GRAPH, f"前端格式必需字段 {key} 缺失"

    def test_skeleton_matches_b4_duipai_graph(self):
        """8 执行节点恰对拍直构图同构(b4_duipai_run_0930.py build_graph 九件
        API 图一一对应):加载器 bf16 三件套逐字 + 空潜 1536×512 直给 +
        KSampler 25步 cfg1 euler simple denoise1(seed fixed)。"""
        nodes = {n["id"]: n for n in SANLIAN_GRAPH["nodes"]}
        want = {1: "UNETLoader", 2: "CLIPLoader", 3: "VAELoader",
                5: "EmptyLatentImage", 6: "TextEncodeQwenImage21",
                7: "KSampler", 8: "VAEDecode", 9: "SaveImage",
                10: "MarkdownNote"}
        got = {n["id"]: n["type"] for n in SANLIAN_GRAPH["nodes"]}
        assert got == want, f"节点 census 应={want}(对拍九件+说明卡),得 {got}"
        assert nodes[1]["widgets_values"] == [UNET_FILE, "default"]
        assert nodes[2]["widgets_values"] == [CLIP_FILE, "qwen_image", "default"]
        assert nodes[3]["widgets_values"] == [VAE_FILE]
        assert nodes[5]["widgets_values"][:3] == [1536, 512, 1], \
            "空潜应 1536×512(3:1 三联,三格各 512×512)直给"
        wv = nodes[7]["widgets_values"]
        assert (wv[1], wv[2], wv[3], wv[4], wv[5], wv[6]) == \
            ("fixed", 25, 1, "euler", "simple", 1), \
            f"KSampler 应 fixed/25步/cfg1/euler/simple/denoise1(官方路径),得 {wv}"

    def test_links_topology(self):
        """9 链拓扑逐字:MODEL←[1];CLIP←[2];VAE←[3] 双扇出([6] 编码与 [8]
        解码);LATENT←[5];positive/negative←[6](cfg=1 负向官方同构占位);
        [7]→[8]→[9]。"""
        got = {(l[1], l[2], l[3], l[4]) for l in SANLIAN_GRAPH["links"]}
        want = {(1, 0, 7, 0), (2, 0, 6, 0), (3, 0, 6, 2), (3, 0, 8, 1),
                (5, 0, 7, 3), (6, 0, 7, 1), (6, 1, 7, 2), (7, 0, 8, 0),
                (8, 0, 9, 0)}
        assert got == want, f"9 链拓扑应={want},得 {got}"

    def test_triptych_template_prefilled(self):
        """[6] prompt 预填三联模板(结构 token 全在场+Character 段)——一键
        三视图:打开即用,换 Character 句即可。"""
        prompt = next(n for n in SANLIAN_GRAPH["nodes"]
                      if n["id"] == 6)["widgets_values"][0]
        for tok in SANLIAN_TEMPLATE_TOKENS:
            assert tok in prompt, f"三联模板缺结构锚 {tok!r}"

    def test_note_carries_a5_warning_and_cut_ref(self):
        """[10] 说明卡:A5 切割警示钦定措辞 + p2_grid_cut.py 切割口(1 行
        3 列)+ license 红线注记,全部随档。"""
        note = next(n for n in SANLIAN_GRAPH["nodes"]
                    if n["id"] == 10)["widgets_values"][0]
        for tok in SANLIAN_NOTE_TOKENS:
            assert tok in note, f"说明卡缺锚 {tok!r}"

    def test_preset_single_purpose_no_extras(self):
        """预设件职责单一:无 ResolutionSelector(宽高直给,对拍发1 口径
        「档位零涉」)/无 PE 改写组/无 RGBA 开关/无子图——通用能力住
        qwen21-t2i.json 母件,本件只做三联。"""
        types = {n["type"] for n in SANLIAN_GRAPH["nodes"]}
        for banned in ("ResolutionSelector", "QwenImage21_T2IPromptRewrite",
                       PE_CLASS, "ComfySwitchNode", "StringConstant"):
            assert banned not in types, f"三联预设件应零 {banned}(职责单一),得 {types}"
        assert "definitions" not in SANLIAN_GRAPH or \
            not SANLIAN_GRAPH["definitions"].get("subgraphs"), "本件无子图(扁平预设)"



def test_prompt_source_single_truth():
    """1005 Step4 退役后:产品侧四件已删,真源=唯一份;装机固定位=随包种子。

    - my_nodes/nodes/ 下四件必须不存在(存在=退役回潮,禁手改产品侧已废止)
    - 真源家四件在位且可解析
    - 装机固定位(Resources/studio-manuals/.../json/)若在,与真源家逐字节一致
      (dev 无安装包时该腿自然跳过——CI 安全)
    """
    import hashlib
    home = _REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json"
    nodes = _TESTS_DIR.parent / "my_nodes/nodes"  # 产品侧目录(Step4 后四件应不在)
    for name in ("qi21_bases.json", "qi21_strip_lexicon.json",
                 "daojie_lora_stack.json", "daojie_loras.json"):
        src = home / name
        assert src.is_file(), f"真源家缺 {name}"
        json.loads(src.read_text(encoding="utf-8"))
        assert not (nodes / name).exists(), \
            f"产品侧 {name} 仍在:Step4 已退役(改真源家,勿手建产品侧)"
    from pathlib import Path as _P
    fixed = _P("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json")
    if fixed.is_dir():
        for name in ("qi21_bases.json", "qi21_strip_lexicon.json",
                     "daojie_lora_stack.json", "daojie_loras.json"):
            a = hashlib.sha256((home / name).read_bytes()).hexdigest()
            b = hashlib.sha256((fixed / name).read_bytes()).hexdigest()
            assert a == b, f"装机固定位漂移: {name}(重打包或修 extraResources)"


def test_daojie_data_prefers_truth_home(monkeypatch):
    """1004 §十六 Step2:道劫数据四层候选链——dev 环境解析到真源家(json/)。

    _daojie_data 样板(env→dev真源家→引擎家数据位→装机固定位→同目录产物
    兜底)为八件同文件内联(升级五件+三热件,零跨模块 import——spec 直载
    场景相对导入炸的教训);dev 仓内跑测时第二层候选(dev 真源家)即命中,
    同目录产物副本只作装机兜底。
    """
    monkeypatch.delenv("MYSTUDIO_DAOJIE_DATA", raising=False)
    from engines.comfyui.my_nodes.nodes import my_qi21_base
    truth = (_REPO / "apps/frontend/assets/studio-manuals"
             / "art_skills/daojie_ink_guofeng/json" / "qi21_bases.json")
    got = my_qi21_base._daojie_data("qi21_bases.json")
    assert got == truth, f"dev 环境应解析到真源家 {truth},得 {got}"
    assert got.is_file(), f"真源家文件应存在: {got}"
