#!/usr/bin/env python3
"""qi21-道劫-t2i.json 幂等生成器(09-23;0925 加速与展示全量外露收窄轮)。

本轮(0929 四块组框重画轮,三件统一口径·纯组框+摆位手术,零拓扑改动):
  - **主图组框 3→4 按四块口径重画**:①加载器([1][3][2][11],双TE 自旧「装配外露」
    框迁出归此)/②提示词·装配([24][40][27])/③加速区([5][7][31][206][198][208][207],
    =空潜+三支路+选择件+seed单源;标题保持 startswith「道劫·加速区」+「加速区·并行」
    子串=契约 6d2 与自查 W1 锚双兼容,序号③入括号不断锚)/④输出([8][9]);
    旧「主链」框废框拆散([5][7] 归③、[8][9] 归④)——主链×加速区在 [7] 直出行的
    历史 bbox 交叠就此消灭;
  - **微移仅 2 件**(能不挪就不挪,其余 15 件原位):[24] 主体句 (953.78,2325)→
    (1700,2900)——旧位在①框 x 区正下方,②框上缘须罩 [27]@1650 起,①②必 x 交叠,
    唯一出路=[24] 右移出①x 区(②框 x0=1670,与①框 x1=1493.5 间隙 176.5);
    [207] seed (3200,2900)→(3950,2950)——旧位 rect 咬合②框右尾,新位 [5] 右下方
    入③框(坐标枚举实测:[7] seed 线 x≥3950 才绕开 [31] 右下角,交叉守恒 67 零动);
    [27]/[11] 均原位(评审实弹定谳:提案 [11]→1880 与 [2] est 重叠、
    [27]→(3050,2161.2) 撞 [40] 横距 85<200+10 线遮,全弃);
  - **自查新增 3h 谓词补机器闸**(此前主图框两两相交/裸奔无门禁):主图组框两两
    bbox 零交集+非白名单(MarkdownNote)节点零裸奔+四块成员恰好;
  - W1 加速区罩盖断言随口径扩为七件;交叉棘轮 _CROSS_BASELINE 主67 零动(实测不超)。

本轮(0929 加速区并行化轮,Trellis 09-29-qi21-acczone-parallel·方案 B=MyQi21SpeedSelect;
用户三令存真:「使用并行节点布局前面只有1个选择逻辑」「不要重复出现1个节点,要进行复用」
「默认使用 Fun-Acc(阿里PDD)」(0927 裁定,0929 恢复;同日拉齐重放裁定默认改
直出40步等效,Fun-Acc 仍为主加速居二)——架构手术非坐标轮):
  - **注入式开关农场全拆**:t2i 加速区 10 选择类逻辑件([30] 档位/[32] MODEL 开关/
    [177] steps 联动开关/[178][179] steps 常量/[193][194] 比较/[195][196] 比较常量/
    [197] latent 路由)全数拆除(旧 id 留历史锚注释,件不在图);
  - **立三条完整并行支路**(各含采样器,MODEL/steps 内聚;每支路横向一行,三行纵叠):
    支路0 直出=[1]base→[7]KSampler(40步,steps 回 widget=面板生效值)/
    支路1 viggle=[1]base→[31]LoRA(0.8)→[206]KSampler(359步)/
    支路2 Fun-Acc=[1]base→[198]T8(4步全内置;model=[1] 直连,绝不吃 viggle LoRA);
  - **seed 单源扇出**:[207] PrimitiveInt(0 fixed)扇出 [7]/[206]/[198](三采样器 seed
    一律 widget→input 接线接管;T8 seed 输入化=research/03 §4.1 实证 JSON 层可行);
  - **单点选择**:三支路 LATENT 汇流→[208] MyQi21SpeedSelect(my_nodes 自研懒选择件,
    combo 首项=默认=直出40步(0929 拉齐重放);未选支路懒执行零加载)→[8] 解码→[9] 保存;
  - **复用铁则**:[40].positive 三扇出/[40].negative 二扇出(T8 无负面槽)/[5] 空潜三扇出/
    [1] base 三扇出——共享源全部单节点扇出;自查新增零真重复谓词(同 type+同上游集合+
    同 widgets 值不得两件,主图/子图分域);
  - **组框/Note 随拓扑重建**:加速区组框罩三支路+选择件;Note 只重写加速区段+参数圣经
    (三档并行+单选择+默认直出40步+档2 插件依赖警示+seed 单源+面板值=生效值口径),
    其余 tokens 原样保留;
  - 布局:三支路行 y=1740/2460/3180(行距 720,分层行铁律),选择件居三支路汇流带右侧,
    [1]/[5]/[207] 让位重排([1] 挪回加载器列上首/[5] 3900→3700);交叉基线按新拓扑实测重立。

本轮(0929 用户手改回灌轮——用户晨间手改画布件,语义改动照单译回生成器,重跑即规范版):
  - **宿主面板机制简化(最大一笔)**:[40] 宿主外露输入槽 8→4(clip/vae/主体句/pe_clip),
    型选择/RGBA透明开关/PE开关/画幅联动开关四控件从「输入槽外露」改回「面板控件」
    (host widgets_values 五值不变;PE开关=true 默认开不变量照旧被 9b 谓词钉死);
    机械后果:主图 link31([11] PE专属TE→[40])目标槽 6→3;子图内部 IO 仍 8 入
    5 出零动(四控件仍是子图 -10 槽,只是宿主侧不再外露成槽);
  - **主画布全量重排版**:新坐标(浮点)与新尺寸照抄用户([151]/[152] 高 200→262、
    [5]/[7]/[27]/[30]/[31]/[32]/[177]/[194]/[197]/[198]/[40]/[141]/[150]/[157]/[158]
    尺寸全随用户);坐标修正两类——①Note[10] 用户拖至 x=-561 负区,归一 x=80,
    又因 x=80 下 900 宽卡片与 [24]/[30] est+矩形双重叠,y 自 2271.75 下移至 3500;
    ②est 间距/线遮让位微调 11 点:加载器列 [3]/[11]/[24]、加速区 [31]/[179]/[193]/
    [195]/[196]、[9](est 横纵距)+[5] 让出 [32]/[177]→[7] 与 [40]→[7]/[203]→[198]
    五斜线走廊(→3900,1740)+[198] 下移避 [194]→[197] 布尔线(→2560);子图
    [140] 左移 50/[163] 右移 130 让 [163]→[143] 竖走廊出 [141] 拉宽后的右缘;
  - **两个新默认值(用户 0929 拍板「原样保留」)**:[30] 加速档位 PrimitiveInt 默认
    2→11(11 不命中 ==1/==2 任何比较分支=等效直出 40 步档);[179] steps 常量 6→359
    (viggle 联动臂步数);构造器/注释/谓词/干跑期望全同步;
  - **子图两枚 Reroute 重创**:[177]/[178] 删了重加成 [204]/[205](位置/接线同位,
    生成器按新 id 落避免无谓震荡;主图 [177]=steps 开关另一 id 空间不受扰);
  - 前端序列化噪音不收(生成器出干净件):ue_properties/widget_ue_connectable/
    version 7.8/widget 尾值 "randomize"/easy compare [""] 形变/子图连线 id 重编号
    一族——回灌后生成器重写磁盘件,与用户当前文件存在这层噪音差异属预期;
  - **交叉棘轮 0929 用户手排重立:主 26→37 / 子 7→8**(layout_check 同源引擎实测;
    用户原始布局实测主 23 但带 3 线遮+6 est+1 负区违禁,零线遮/零重叠合规化后
    以 37 重立,主图方向只收紧;子图 +1=[141] 拉宽连带)。

历史轮:改名→子图化(学 K2 [90])→底座美化→MyQi21DaojieBase 总装→RGBA 官方公式
→画幅联动→R26.4 LoRA 槽→满血接线 steps 联动→0925 布局美化/节点标题归位→
0926 子图 pos≥80 收口(实测发现项3:子图整体归一平移,自查零负区阈值 40→80 互锁)→
**0926 线不遮节点轮(用户令:「工作流的美化,你只管位置,不要线与节点彼此遮盖!」
实测(贝塞尔 41 点采样精判)该件曾有 21 条真遮挡——重灾区=主画布 [151]-[158]
画幅联动链菊花链互压([151]->[153] 遮 152、[153]->[156] 遮 154,155 等)与
[140]->[152] 遮 [40]、加速区 [30]/[179] 扇出遮串、[32]/[177]->[7] 遮 [5] 等;
本轮主画布全量重排+4 枚垫脚石 Reroute 归零,自查新增谓词「零线遮节点」互锁)**:
  - 画幅联动链改蛇形两行(上=宽路 [151][153][155][157] y1560,下=高路
    [152][154][156][158] y2100,列对齐 x3700/4240/4690/5230+高开关 [158] 让位
    x5900):同路横连走行内空档,跨路 [153]<->[156]/[154]<->[155] 走列间对角,
    wh_ratio 双降线走 [140] 右缘陡降走廊;
  - 行2 收敛为装配横排 [24]→[40]→[141]→[27](左右相邻零穿越);[140] PE 改写
    下沉 PE 带 y1450([11]→[140] 陡降,[140]→[141]/双正则斜上/陡下均零穿越);
  - [40].width/.height→联动开关 on_false 垫脚石 [191]/[192](九型 W/H 长横线
    先沿蛇形上带平走再陡降,避免直连斜穿列盒);[180] 总闸挪蛇形行间走廊右端;
  - 主链上移与蛇形同带([5] y1200/[7][8][9] y1560):[40].positive/.negative
    直连 [7] 零遮挡(不再需要通道件),[157]/[158]→[5] 陡升;
  - 加速区两行化(上=[32]@4900 y2600,下=[30]@2400 y2680/[177]@3800 y2900/
    [31]@4400 y2900/[178][179]@2400 y2900/3200):[30] 扇出走行间,
    [178]/[179] 垂直堆叠避菊花,[21] 顶通道 MODEL 垂降垫脚石 [190]@1100
    (x982-1218 装载器列缝)再平送 [31]/[32](直连斜穿 [3]/[140]/[151] 全避免);
  - 子图两笔:[173] H 通道拐点左移避 [150].WIDTH 升线;[143]->[144] 行3
    on_true 线几何上必过 [142](三行契约+成员序钉死),垫脚石 [175] 走行2-行3
    框间带拐弯。
本轮(0928 残留清创轮·独立审计两笔,照 i2i/edit 0928 删踏脚石直连轮同款判据):
  - **主图四枚无实测正当性踏脚石 Reroute 删件直连**(逐枚 layout_check 同源引擎实测
    「删后交叉与线遮双不增」裁决):[22]+[23] VAE 顶通道对删([3]→[8] 直连,link10
    保号改指实靶)/[199] [5]→T8 垫脚石删([5]→[198] 直连,link65)/[202]
    [40].positive 顶带首拐删([40]→[203] 直连,link70);**[203] 实测保留**(单删交叉
    26→32(+6),与 [202] 整对删仍 +5,踏脚石有真实治理功用,留逐枚实测注记);
    旧留用理由「蛇形两道墙无直连走廊」已失真——联动蛇形两行本轮已随 PE 链迁入
    [40] 子图,主图无此墙;
  - **干跑谓词修复(审计残留二)**:旧主图侧谓词「默认态 PE 改写 [140] 应在执行源内」
    随 PE 迁子图被删后,主图只剩「宿主 [40] 可达」近恒真断言顶包;新增第 9b 节
    _dry_run_subgraph_default 子图默认态执行集谓词钉死——宿主「PE开关」默认 true
    (0926 裁定1;宪法「所有提示词必须过 PE」)⇒ [141] 走 on_true 臂=PE 改写 [140]
    必须在执行图、直写臂 [131] 懒旁路不可达;第 9 节直写臂装配文本核验照旧不丢,
    归因注释改与事实一致(9 节核装配文本,不核 PE 开路臂);
  - 交叉计数实测主 26 持平/子 7 持平,_CROSS_BASELINE 棘轮不动(主图方向只收紧)。

本轮(0928 PE 链迁入装配子图轮,用户裁定「所有提示词必须过 PE」+点名消灭装配子图[40]→
主图 PE 链→[40] 的来回绕线;架构手术非坐标轮):
  - **PE 改写[140]+提示词开关[141] 迁入 [40] 装配子图**:子图内部成四行流水=
    源行(型/底座选择)→装配→PE改写→编码(TextEncode),提示词从装配到编码全程
    子图内;[141].on_false 直收 [131] 装配全文、输出直喂 [142].prompt(旧冻结回流
    线 link34 与 [40].prompt→[141] 出图线一并消灭,主图左向线清零,W2 冻结豁免退役);
  - **画幅联动链[151]-[158] 随 PE 就近迁入子图**(数据源全在子图:[140].wh_ratio+
    [150] 九型 W/H;消费端唯主图 [5]):子图经 width/height 输出槽向主图暴露终值,
    [5] EmptyLatentImage 直连消费;主图联动总闸[180] 退役为宿主面板 widget
    「画幅联动开关」(默认关,照 RGBA透明开关机制);主图 W/H 垫脚石[191]/[192] 删除;
  - **宿主面板新增两控件**:「PE开关」(BOOLEAN,默认 true=PE 开路,0926 裁定1 不变,
    照「型选择」combo 暴露机制)+「画幅联动开关」(默认 false);[11] PE 专属 TE 留
    主图加载器行(与 [2]/[3] 喂 [40] 同款一进线,经新增宿主输入槽 pe_clip);
  - 采样器路径(steps 联动/LoRA/latent 路由/MODEL 顶通道)零动留主图;主图删 13 节点
    (PE 两件+联动八件+总闸+垫脚石两件);子图 16→28 节点、六行(四行流水+联动蛇形两行);
  - **交叉计数(统一口径)主 39→26 / 子 5→7**,_CROSS_BASELINE 棘轮同步重立
    (主图方向只收紧;子图因节点迁入上升属预期,以新实测值 7 重立);
    W2 谓词反转=「PE 链在子图内、主图零 PE 件」,左向线谓词改恒 0(冻结豁免退役)。

本轮(0928 重布局先锋轮,三件全量重布局 t2i 先锋;遵守「线条不交叉>分组>从左向右>从上到下」
五级优先级,docs/comfyui-kb/画布布局规范-0928.md):
  - **坐标-only**:links/widgets/文本/properties/组框标题逐字节不变,仅 pos 与 groups
    bounding(+IO 槽 pos/W6 联动 bounding)变——骨架对比已逐字节核验;
  - 主图全量重排:[40] 装配子图右移贴近主链(条件双线塌缩)+主链带整体右移
    ([5]/[7]/[197]/[8]/[9]/[198]/[199]/[200]/[23])+PE 电路([140]/[141])下移让出条件走廊
    +蛇形联动带下移([151]-[158])+加速区深带三泳道([30]/[193]-[196]/[177]-[179]/[31]/[32])
    +MODEL 顶通道双臂左垂降([20]/[21]/[190]/[204]);加载器行随交叉最小化重排
    ([1]/[2]/[3]/[11] 分置,组框1 bounding 随行);
  - 子图行内间距收口(行1 [110]/[160]/[161] 横距≥200)+通道 Reroute est 高度修正
    ([173]/[174] y=250 避 88 高 est 重叠)+[175] 垫脚石抬升;
  - **交叉计数(统一口径)主 78→60 / 子 7→5**,_CROSS_BASELINE 棘轮同步下调(单向只降);
    红线全绿:零线遮/恒向右(唯一豁免=冻结回流线 34)/est 零重叠+横≥200 纵≥80/
    零负区/输出口最右/子图三行/group 预算 4+加速区罩盖;
  - 本轮为先锋件,i2i/edit 同构推排在后续轮(基线仍 74+10/84 待棘轮)。

本轮(Trellis 09-25-qi21-speed-subgraph,W1/W2/W3/W5/W6):

  W2 t2i PE 链迁出子图(0925 设计铁则 1/2:经常改动的量+需展示的结果=主画布):
    [140] QwenImage21_T2IPromptRewrite + [141] 提示词开关 + 画幅联动链
    [151]-[158](正则×2/转数×2/公式×2/双 INT 开关)全部从 [40] 子图迁到主画布,
    与 i2i/edit 的 PE 位置同构(均主画布);PE 开关=本件 widget(照 i2i [15] 式,
    不再占宿主面板);画幅联动开关改主画布 PrimitiveBoolean [180](铁则 1)。
    **结构性冻结项(契约冻结,仿 ad22a9e 先例)**:PE 开关在主画布+双路编码在子图
    (拍板③)⇒ [141] 输出必须回流 [40]「提示词」槽——文本出子图([40].prompt→
    [141].on_false 向右)再回子图([141]→[40].提示词)在几何上必有且恰 1 条
    左向线(target.x≤origin.x),横向铁律对该 link(id 34)单点豁免+新增谓词
    「左向线恰 1 条且端点=[141]→[40].提示词」钉死豁免不可蔓延。
  W3 [40] 子图收窄(铁则 4:子图只放九型+装配底层美术):
    迁出 PE 后子图 11 节点=MyQi21DaojieBase[150] 九选一+锁层A[110]+拼接
    [130][131]+RGBA 官方头尾/公式拼接 [160][161][162][163]+双路编码
    [142][143]+RGBA 开关 [144](拍板③:双路编码留子图);行式三行=源行/
    装配路由/编码输出(与 i2i 子图同构);宿主 widget 槽序收窄=主体句/型选择/
    RGBA透明开关(与 i2i 三 widget 同构),新增「提示词」link 输入槽(①=装配
    全文进 [141] 二选一后回编码)。九型 W/H 仍由 [150] 直出,经顶部 Reroute 通道
    (y=40/140 正区)自 width/height 输出直驱主画布 [157]/[158].on_false。
  W1 加速区组框收纳(方案 C·原生组框,拍板①):
    [30] 总闸/[32] MODEL 开关/[31] LoraLoaderModelOnly/[177] steps 联动开关/
    [178][179] 常量 40/6 六件收进主画布原生组框「道劫·加速区·总闸[30]」,
    Note 说明两态(关=40 步原味/开=viggle LoRA·6 步一拨全配);主图 group 预算
    3→4。[7] 面板 steps 显 40 与 [5] 面板 1024×1024=摆设值,Note 注明不生效。
  W5 Note 两笔终审(拍板④⑤):负面线=保留接线+Note 写明「cfg=1 下负面数学上
    不参与采样,占位为官方同构」;PE presence_penalty=1.5 定档(A/B 四维 57.5 vs
    55.0 略优,保留 1.5)。
  W6 画布归一:①负坐标归一——主画布+子图全部节点 pos≥40(整图平移至左上留
    边距,打开即全貌);②输出口最右——子图输出 IO 槽按新前端表示法钉死最右列
    (K2-文生图-道劫 [90] 实证:输出槽 x 超过全子图最右节点,纵向堆叠);③自查
    新增两谓词:零负区(主图+子图所有节点 pos≥40)+输出口最右(子图输出接口
    x≥全子图最大 x-50),与既有谓词(est 零重叠+横距≥200/纵距≥80)合成防线。

主画布布局(0929 加速区并行化轮;全部正区;从上到下=阶段带,行内从左到右):
  加载器竖列 x≈1000-1460:[1] UNET@996,1180(base MODEL 单源三扇出 [31]/[7]/[198];
             自旧加速区组框挪回加载器列上首——[1]→[7] 直连线需从 [40] 上方净空过)
             →[3] VAE@1105,1500→[2] 主TE@1076,1704→[11] PE专属TE@1063,2015
  装配外露带:[24] 主体句@1700,2900(0929 四块重画自 953,2325 挪——出①加载器框
             x 区,②框 x0=1670 与①框 x1=1493.5 间隙 176.5)→[40] 装配子图@2393,2161
             (外露槽4=clip/vae/主体句/pe_clip,面板五控件);[27] 装配预览@3050,1650 原位
             (0929 并行化轮自 3173,2331 上袋让位线遮走廊,四块轮零动)
  并行支路带(三行纵叠,行距 720):
             行0 直出 y=1740:[5] 空潜@3900,1740(宽高直连 [40].width/.height,LATENT
             三扇出 [7]/[206]/[198])→[7] KSampler(40步)@5011,1740
             行1 viggle y=2460:[31] LoRA@4250,2460(窄卡 270 宽让行带走廊)→
             [206] KSampler(359步)@5100,2460
             行2 Fun-Acc y=3180:[198] T8@5011,3180(model=[1] 直连)
             汇流:[207] seed 单源@3200,2900(行1-行2 间带左袋)→三采样器 seed;
             [208] MyQi21SpeedSelect@6300,2460(居三支路汇流带右侧)→[8] 解码@6986,1722
             →[9] 保存@7440,1748(卡片缩 933×904→700×460,主链框不吞支路带)
  Note [10] 左下独立@[80,3500](白名单留组外);
  主图 group 恰 4=四块口径(0929 四块重画轮,两两 bbox 零交集/非Note零裸奔/四块
  成员恰好=自查 3h 谓词):①加载器([1][3][2][11],双TE自旧装配外露框迁入)/
  ②提示词·装配([24][40][27])/③加速区([5][7][31][206][198][208][207],空潜+
  三支路+选择+seed单源——旧「主链」框废框拆散,[5][7] 并入、[8][9] 独立成④;
  旧主链×加速区在 [7] 直出行的交叠就此消灭)/④输出([8][9]);宅基律 pad=
  L30/T50/R30/B50 实测沿用,阅读序①左上→②其下→③右侧中段→④最右=Z形。

子图结构(宿主 [40],双击进入;行式六行=四行流水+联动蛇形两行;0929 宿主外露槽 8→4):
  宿主 [40] 外露输入槽 4: clip/vae(外连 [2][3])+ 主体句(外连 [24])+ pe_clip
  (外连 [11]);型选择/RGBA透明开关/PE开关(默认 true)/画幅联动开关(默认 false)
  四控件=面板控件(不占输入槽,widgets_values 五值;子图内部 -10 IO 仍 8 槽零动)。
  outputs(5): positive/negative(→[7] KSampler)、最终文本(→[27] 装配预览)、
  width/height(INT→[5] 空潜直连,联动开关后终值)。
  行1 y=280   源行:[150] MyQi21DaojieBase+[110] 锁层A+[160][161] RGBA 官方头尾
  行2 y=1040  装配:[130] 拼接①(主体句+BASE)→[131] 拼接②(+锁层A)→
              [162][163] RGBA 公式拼接(头+装配全文+尾)
  行3 y=1800  PE改写:[140] PE改写(clip 接 pe_clip 槽,种子句自带反噪条款)→
              [141] 提示词开关(on_false←[131] 直写 / on_true←[140];switch←宿主 PE开关)
  行4 y=2560  编码输出:[143] RGBA编码→[142] 主编码(prompt 直收 [141] 输出)→
              [144] RGBA 开关([175] 垫脚石走行3-行4 框间带)
  行5 y=3320  联动宽路:[151]正则→[153]转数→[155]公式→[157]宽开关
  行6 y=4080  联动高路:[152]正则→[154]转数→[156]公式→[158]高开关
              (源=[140].wh_ratio 双降;九型 W/H 经左缘通道 [171]/[172] 喂 on_false;
              switch←宿主「画幅联动开关」;[141]→[176]→最终文本输出走行4-行5 框间带)
  通道:W/H 左缘竖走廊 [171]@[520,3295]/[172]@[560,4055](边界线豁免口径);
  group 四框各罩单一阶段行(联动蛇形两行不设框,预算≤4);子图输出 IO 槽 x=7300
  钉死最右列(全子图最大节点 x=4760,表示法=K2 [90] 实证)。

自查(写盘后必跑,任一失败退出码 1):json.loads 往返 / 主图+子图 link 双向一致 /
主图加速区并行结构(恰1 LoRA+[7]40步/[206]359步 两 KSampler steps 回归 widget=面板
生效值+cfg/euler/simple/denoise 照抄现值+[198] T8 model=[1] 直连无负面槽+seed 输入化/
[207] seed 单源三扇出(三采样器 seed 一律 widget→input)/[208] MyQi21SpeedSelect combo
首项=直出40步=默认+三 latent 槽接线+输出→[8]+主图零选择类逻辑件(ComfySwitchNode/
easy compare/PrimitiveBoolean 恒0,旧注入式十件 id 全不在图)+零真重复节点(同 type+
同上游集合+同 widgets,主图/子图分域)) /
三档懒干跑(默认直出40步=[7] 在链而 [198]/[206]/[31] 零执行;档1=viggle 链在;
档2=Fun-Acc T8 在)/
主图+子图横向排版(每条连线 target.x>origin.x,含 Reroute 段;边界线以 IO 槽 pos
为端点;**0928 PE 迁子图后冻结回流线已消灭=左向线恒 0,旧 W2 单点豁免退役**)/
子图六行排版(按 y 分行恰 6 行=四行流水+联动蛇形两行、Reroute 拐点不占行、行间净距
≥100、行内 x 严格递增;group 四框各罩单一阶段行,蛇形两行不设框)/ 主图+子图节点矩形零重叠 /
est 间距(同行横距≥200/同列纵距≥80,Reroute/Note 豁免)+ est 足迹零重叠 /
group 预算(子图≤4、主图≤4[四块重画:①加载器/②提示词装配/③加速区/④输出])+
框两两不相交(主图+子图同判,0929 四块轮补主图谓词)+ 主图非Note零裸奔+四块成员
恰好(自查 3h) /
**零负区(主图+子图所有节点 pos≥40)** / **输出口最右(子图输出接口 x≥全子图
最大 x-50)** / **交叉不增封顶(0928 裁定:线不交叉>分组,现值基线封顶防回归,治理拧紧至 0) / 零线遮节点(0926 铁律,主图+子图同口径:贝塞尔 41 点采样,
任采样点落入非端点节点盒 ±2 即遮挡;-10/-20 边界线与验收器同口径跳过)** /
主图+子图 group 全 int id / 子图 IO linkIds 逐项登记(契约铁律) /
道劫字号归位(组框/子图名/说明卡留道劫,节点标题零道劫=0925 裁定) / W1 加速区
组框在位且罩住空潜+三支路+选择件+seed单源七件(0929 四块重画=[5][207] 收编入框) / MyQi21DaojieBase 在场+combo 默认人物+qi21_bases.json↔05 库
逐字互锁 / 锁层A 恒挂且逐字=库 / 子图开关恰 4 枚且 switch 槽全部接 -10 宿主面板
widget(PE开关[141]/RGBA[144]/宽高联动[157][158];0928 PE 迁子图轮)/
PE 链子图内同构锚(0928 反转:[140] 参数/pp=1.5 定档、clip←pe_clip 槽、[141]
on_false←[131] 装配全文、on_true←[140]、输出→[142].prompt+[176]→最终文本输出;
主图零 PE 件/零联动件) / 画幅联动链锚(正则/公式逐字、[157][158].on_false←[150]
九型 W/H(可穿通道 Reroute)、switch←宿主「画幅联动开关」、输出→子图 width/height
→主图 [5] 直连) / 干跑直写选配臂装配逐字=库人物型组合(全程子图内部溯源;
默认臂=PE 开路,0926 裁定1 含画布本体:宿主 PE开关 默认 true) / RGBA 官方头尾逐字 /
steps=40 / 无孤儿节点(MarkdownNote 与 easy showAnything 显示型端点豁免)/ 说明 Note 必含要点。

不动 K2 侧任何文件;引擎家 userdata 零写入;不 git。重跑幂等:主体句默认与
锁层A 全文从 05 库文档现读,BASE 真源=qi21_bases.json,库更新后重跑即同步
(与契约测试 test_qwen21_workflow_contract.py 互锁)。真前端 graphToPrompt 干跑
与实弹出图由 e2e 层另行验证(引擎 v0.37 真前端直开为最终裁判)。

用法:
    python3 apps/build/scripts/qi21_daojie_t2i_0923.py            # 生成(写盘+自查)
    python3 apps/build/scripts/qi21_daojie_t2i_0923.py --check    # 只查不写
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import re
import sys

# ── 真源定位(零 cwd 依赖)──────────────────────────────────────────
_SCRIPT = pathlib.Path(__file__).resolve()
_REPO = _SCRIPT.parents[3]  # scripts → build → apps → 仓库根
_Q21_DIR = _REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图"
QI21_JSON = _Q21_DIR / "qi21-道劫-t2i.json"
PROMPT_LIB = _REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
BASES_JSON = _REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
QI21_BASES_JSON = _REPO / "apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json"

WF_UUID = "7d4a9c31-5e62-4b8a-b1f0-2c8e57a90413"   # 工作流 id,固定值幂等
SG_UUID = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"   # 装配子图 uuid,固定值幂等

# 人物系六型(库 §二:常量B 加挂型)
CHAR_TYPES = ("人物", "美宣", "多视图", "高清人脸", "分镜剧情图", "表情差分")  # 0927 改名轮:三视图→多视图
# ④配色行映射(库 §一映射表;0925 四令多彩轮:宣纸白领头行退役,多彩行=生成器侧映射)
COLOR_MAP = {
    "人物": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "场景": "场景多彩=淡墨+青灰+青绿+赭石+旧金(大面积稳定基底+多色相铺陈各安其位)",
    "道具": "道具多彩=淡墨+旧金+玉青+赭石+朱红(大面积稳定基底+中等强度器物色+少量高识别强调色)",
    "美宣": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "多视图": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "高清人脸": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "分镜剧情图": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "表情差分": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "概念气氛图": "场景多彩=淡墨+青灰+青绿+赭石+旧金(大面积稳定基底+多色相铺陈各安其位)",
}
PE_CLIP_FILE = "qwen_image_2.1_pe_t2i_bf16.safetensors".replace("qwen_image", "qwen3.5_9b_qwen_image")
# PE 参数(0925 拍板⑤:presence_penalty=1.5 定档——A/B 四维 57.5 vs 55.0 略优,保留)
PE_PARAMS = [1.0, 0.95, 20, 1.5, 16256, 42]
# PE 种子句(0925 毒理定案 R1/C1 反噪 + 0925 四令多彩化):PE 路旁路③层锁文,种子句是
# 唯一能携带反噪意志进 PE 路的通道——必须在风格前缀后自带表面洁净正向条款(措辞=05 库
# 常量A 禁纸纹条款的正向转写原文,零自造词),禁裸「水墨国风修仙:」前缀直发(九拍 PE 文
# 纹理语全部溯源到裸前缀,无第二风格源);四令多彩轮:留白/稀彩点题语退役,种子句多彩向
# (背景多色相铺陈+一点强调色),使 PE 扩围时同守四令(大面积留白/素净暖白=按图选配);
# 纪律=05 库 §一/§六「PE 种子纪律」。
PE_SEED_PROMPT = ("水墨国风修仙,画面干净平滑,墨与色落在浅净平涂色场上,"
                  "而非纸面纹理:一位修士立于云中山巅,渡劫前夜,背景青灰远山与青绿草木"
                  "多色相铺陈,朱红灯塔一点强调色")
DEFAULT_TYPE = "人物"

# RGBA 官方公式头尾(research/12 答A必改1;逐字对齐官方模板原文)
RGBA_HEAD_EN = "This is an RGBA format image with transparency."  # 0927 勘案修账:官方逐字(官方模板 Note 双源)
RGBA_TAIL_EN = "The image has an alpha channel and a transparent background."  # 0927 勘案修账:官方逐字
RGBA_HEAD_ZH = "这是一张带有透明度的RGBA图像。"
RGBA_TAIL_ZH = "该图像具有alpha通道,背景是透明的。"

# 画幅联动:PE 建议 wh_ratio(如 "16:9")→ 4.2MP 档宽高(口径=native_px)
RATIO_W_PATTERN = r"^\s*(\d+)"
RATIO_H_PATTERN = r":\s*(\d+)\s*$"
MATH_W_EXPR = "round(a*sqrt(4.2*1024*1024/(a*b))/8)*8"
MATH_H_EXPR = "round(b*sqrt(4.2*1024*1024/(a*b))/8)*8"

# 子图内部节点 id(独立 id 空间;0925 W3 收窄后 11 节点,与 i2i 子图同构)
BASE_ID = 150                                              # MyQi21DaojieBase 九选一
LOCK_ID = 110                                              # 通用锁层常量A
RGBA_HEAD_ID, RGBA_TAIL_ID = 160, 161                      # RGBA 官方头/尾常量(EN)
CONCAT1_ID, CONCAT2_ID = 130, 131                          # 装配拼接①②
RGBA_CAT1_ID, RGBA_CAT2_ID = 162, 163                      # RGBA 公式拼接
TE_ID, TE_RGBA_ID, RGBA_SW_ID = 142, 143, 144              # 主编码/RGBA 编码/RGBA 开关
HOST_ID = 40                                               # 主图子图宿主
SUBJECT_ID, PREVIEW_ID = 24, 27                            # 主图外露主体句/装配预览
LATENT_ID, SAMPLER_ID = 5, 7                               # 主图空潜/KSampler
# PE 链(0928 迁入子图轮:0925 W2 曾迁出→主画布,本轮按用户裁定「所有提示词必须过 PE」
# 迁回 [40] 装配子图,消灭 [40]→主图 PE 链→[40] 来回绕线;id 承袭不变)
PE_RW_ID, PE_SW_ID = 140, 141                              # PE 改写/提示词开关(子图内)
RATIO_RW_ID, RATIO_RH_ID = 151, 152                        # 正则取宽/高比(子图内)
CONV_RW_ID, CONV_RH_ID = 153, 154                          # 字串→数(子图内)
MATH_W_ID, MATH_H_ID = 155, 156                            # 公式求宽/高(子图内)
SW_W_ID, SW_H_ID = 157, 158                                # 宽/高联动开关(INT,子图内)
PE_TE_ID = 11                                              # PE 专属 TE(留主图加载器行)
# 主图通道 Reroute(0928 残留清创轮:踏脚石逐枚实测「删后交叉与线遮双不增」裁决)
RR_M8A_ID, RR_M8B_ID = 20, 21                              # MODEL 通道(历史锚,件不在图)
RR_M10A_ID, RR_M10B_ID = 22, 23                            # VAE 通道(历史锚;清创轮删件直连,实测双不增)
RR_M8C_ID = 190        # MODEL 低位垂降拐点(历史锚;0928 重布局轮已并线直连,件不在图)
# 子图 Reroute(0928 PE 迁子图轮;W/H=两跳通道:左缘竖走廊→行隙横带→落槽;
# 0929 用户手改回灌:[177]/[178] 删了重加成 [204]/[205],位置/接线同位,按新 id 落
# 避免无谓震荡;主图 [177]=steps 开关是另一 id 空间不受扰)
RR_W_ID, RR_W2_ID = 171, 172    # WIDTH:左缘竖走廊 + 行4-行5 隙(y3085)横带→[157].on_false 上方落槽
RR_H_ID, RR_H2_ID, RR_H3_ID = 173, 174, 204  # HEIGHT:左缘两跳竖走廊 + 行6 下方(y4565)横带→[158] 升槽
RR_SWC_ID, RR_SWC2_ID = 175, 205  # [143]->[144] on_true 双垫脚石(直连必过 [142];
                                   # 行4 下方绕行:先降 y2975 再右行再升槽,全程零遮挡零交叉)
RR_TXT_ID = 176                 # [141]->最终文本输出 走行4-行5 框间带的下探拐点
# ── 0929 加速区并行化轮(Trellis 09-29-qi21-acczone-parallel,方案 B=MyQi21SpeedSelect)──
# 用户三令存真:「使用并行节点布局前面只有1个选择逻辑」「不要重复出现1个节点,要进行复用」
# 「默认使用 Fun-Acc(阿里PDD)」(0927 裁定,0929 恢复;0929 拉齐重放:默认改直出40步
# 等效,Fun-Acc 仍为主加速居二)。注入式开关农场十件全拆(旧 id 留
# 历史锚,件不在图):[30] 档位/[32] MODEL 开关/[177] steps 联动开关/[178][179] steps 常量/
# [193][194] 比较/[195][196] 比较常量/[197] latent 路由。立三条完整并行支路+seed 单源+
# LATENT 汇流单选择(各支路自足,MODEL/steps 内聚;懒执行=未选支路零执行零加载):
#   支路0 直出:   [1]base ────────────────→ [7]  KSampler(40步,steps 回 widget 生效值)
#   支路1 viggle: [1]base → [31]LoRA(0.8) → [206]KSampler(359步)
#   支路2 Fun-Acc:[1]base ────────────────→ [198]T8(4步内置;model=[1] 直连绝不吃 LoRA)
#   [207] PrimitiveInt(0 fixed) seed 单源扇出三采样器;三支路→[208]MyQi21SpeedSelect→[8]。
LORA_ID = 31                                           # 支路1 viggle LoRA(承袭旧 id)
LORA_FILE = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"
SAMPLER_VIGGLE_ID = 206    # 支路1 viggle KSampler(0929 并行化轮新增 id;[7]=支路0 承袭)
SEED_ID = 207              # seed 单源 PrimitiveInt(0 fixed;三支路共享,改 seed 只动此一处)
SPEED_SEL_ID = 208         # MyQi21SpeedSelect(LATENT 汇流单点选择,懒执行)
STEPS_OFF, STEPS_ON = 40, 359  # 支路0/支路1 KSampler widget 生效步数(359=0929 用户改值,
#   原 6=v0.2.1 系卡荐档;并行化后步数回归各支路面板=真实生效值,无联动开关无摆设值)
MODE_DIRECT, MODE_VIGGLE, MODE_FUNACC = 0, 1, 2        # 档位语义锚(档号=选择件档位字符串
#   前导数字;0927 三档语义不变,0929 拉齐重放默认档=直出40步,档号语义不变)
T8_ID = 198                                            # 支路2 Fun-Acc T8 采样器(承袭)
FUNACC_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"   # 已装机(models/loras/)
T8_CLASS = "T8QwenImage21FunAccPDD4Step"
# 历史锚(0929 并行化轮拆除,件不在图;id 不复用防旧件幽灵):LORA_PB_ID=30/LORA_SW_ID=32/
#   STEPS_SW_ID=177/STEPS_C40_ID=178/STEPS_C6_ID=179/CMP_VIG_ID=193/CMP_FUN_ID=194/
#   CMP_C1_ID=195/CMP_C2_ID=196/LAT_SW_ID=197/RR_LAT_ID=199/RR_CMP_ID=200/RR_MODE_ID=201/
#   RR_POS_A_ID=202/RR_POS_B_ID=203/RR_DIR_ID=204
# MyQi21SpeedSelect 档位表真源=my_nodes 节点件(combo 列表即契约,/prompt 闭集硬校验;
# 改档位文案必须与节点件同笔——此处 import 互锁,漂移即拒生成):
_spec = importlib.util.spec_from_file_location(
    "my_qi21_speed_select_truth",
    _REPO / "apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_speed_select.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
SPEED_MODES = _mod.SPEED_MODES               # ((档位字符串, 选中槽名)×3;首项=默认=直出40步)
SPEED_DEFAULT_MODE = _mod.DEFAULT_MODE       # combo 默认值(0929 拉齐重放=直出40步)
SPEED_SLOT_OF = dict(SPEED_MODES)            # 档位字符串 → latent 槽名
SPEED_SLOT_OF_MODE = {int(m.split(" ·")[0]): s for m, s in SPEED_MODES}  # 档号 → 槽名
del _spec, _mod

# 宿主面板控件(面板值序=widgets_values 序;0929 用户手改回灌:宿主外露输入槽 8→4,
# 型选择/RGBA透明开关/PE开关/画幅联动开关四控件从「输入槽外露」改回「面板控件」——
# 本表=面板控件序(主体句/型选择/RGBA/PE开关(默认 true=0926 裁定1)/画幅联动(默认
# false,原主画布 [180] 总闸退役);子图内部 -10 IO 槽序不变)
WIDGET_INPUTS = [
    ("主体句", "STRING"), ("型选择", "COMBO"), ("RGBA透明开关", "BOOLEAN"),
    ("PE开关", "BOOLEAN"), ("画幅联动开关", "BOOLEAN"),
]

NOTE_TEXT = (
    "## 道劫 · Qwen-Image-2.1 文生图(装配子图版·0929 宿主面板简化轮)\n\n"
    "K2 道劫『一处选型+分件装配+子图收装』思想的 Q2-1 原生落地(0928 用户裁定:所有提示词"
    "必须过 PE——**PE 改写链与画幅联动链已收进 [40] 装配子图**,消灭 [40]→主图 PE 链→[40] "
    "来回绕线,主图零 PE 件零左向线;0925 外露轮的 W2 迁出就此回卷)。**[40] 装配子图**(双击"
    "进入=底座九选一+锁层恒挂+换行拼接+RGBA 公式拼接+**PE 改写→提示词开关**+双路编码+画幅"
    "联动链;四行流水=源行→装配→PE改写→编码,提示词从装配到编码全程子图内);提示词真源="
    "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md(②层底座=09-23 美化版,canon-json "
    "逐字锚废止,型名/顺序仍对齐 daojie_bases.json)。\n\n"
    "### 怎么换型(一处切换)\n"
    "- 主画布点选 [40] 装配子图,面板「型选择」下拉九选一(默认①人物):人物/场景/道具/美宣/"
    "多视图/高清人脸/分镜剧情图/表情差分/概念气氛图——子图内 MyQi21DaojieBase 节点按选型出 "
    "BASE(该型②层底座+人物系增量四锁B+④配色行,真源=qi21_bases.json 磁盘热读,逐字=05 库)"
    "与 WIDTH/HEIGHT(型档分辨率直出)。\n"
    "- **分辨率随型自动**:[40] 子图 width/height 输出(联动开关后终值)直驱 [5] 空潜宽高"
    "(ResolutionSelector 已退役;九型档=qi21_bases.json 的 aspect/MP/override;多视图=Q2.1侧"
    "分档 3:4 Portrait 4.2MP 分张产线(0927 多视图轮,override 已退役))——换型不再手动切档;[5] "
    "面板 1024×1024=**摆设值不生效**(实际由 [40] width/height 供给)。\n"
    "- 换型后 [24] 主体句须同步换成本型主体句(各型例句见库文档;场景/概念气氛图不写人——"
    "空镜句尾可明写「空镜无人」);主体句只写主体与画面,不重复风格词,全角标点,质量词/比例词/"
    "否定式禁入(库文档主体句纪律五则)。\n"
    "- 警示(手贴 vs 重跑):手贴内容只活在画布件——生成脚本重跑会把主体句默认/锁层全文重置回"
    "库文档现读值(底座 BASE 不经画布常量、直读 qi21_bases.json,库更新重跑提取脚本即同步),"
    "要长久保留先回写库文档再重跑,或重跑前另存画布件。\n\n"
    "### 装配怎么拼([24] 唯一手写位;最终文本=子图 [141] 开关输出,经 [40]「最终文本」出口过目 [27])\n"
    "- 拼法=库文档四层装配『主体句领头+换行分层』:子图内拼接把 [24] 主体句 + [150] 当前型 "
    "BASE + [110] 通用锁层常量A(③层,库首节全文,全九型恒挂不随型)逐层接成一段,进子图内 "
    "**[141] 提示词开关**(true=PE 扩写=**默认 PE 改写**(0926 裁定1:多彩时代默认 PE 开路,"
    "任何人打开默认走 PE;false=直写装配=按图选配,单图手动关)——开关输出=将进编码的最终"
    "文本,子图内直喂主编码 [142].prompt,并经 [40]「最终文本」输出到主画布 [27] 装配预览"
    "过目。**[141] 开关在 [40] 面板=「PE开关」控件**(默认开,照「型选择」combo 同款暴露)。\n"
    "- 层次序注:画布装配行序=①主体句→②型底座→(人物系增量锁)→④配色行→③通用锁层;库文档"
    "直写件行序=①②③(内嵌增量锁)④——层内容零差异,仅行序不同(锁层常量恒挂不可拆,增量锁"
    "随型走在 BASE 内)。\n"
    "- 甲案围栏:本链为甲案全中文直书(中文合法);与 PE/乙案英文长文禁混——[141] PE 开关开="
    "走 PE 改写路(中文种子句进、英文长文出,整体替换装配全文),与本链二选一(库文档禁混条"
    "款一)。\n\n"
    "### PE 与画幅联动(0928 全收进 [40] 子图;宿主面板「PE开关」默认开/「画幅联动开关」默认关=恒九型)\n"
    "- [140] PE 改写(子图行3;随 PE开关 开路即入链载 PE 模型——clip 由主图 [11] PE 专属 TE "
    "经 [40].pe_clip 槽一进线供给;关 PE开关=直写选配时旁路懒执行不载):PE 参数=插件官方 "
    "README 推荐值"
    "(temp1.0/topP0.95/topK20/**presence_penalty=1.5 已定档**(0925 拍板:A/B 四维 57.5 vs "
    "55.0 略优,保留 1.5)/max16256/seed42)。\n"
    "- [140] **PE 种子纪律**(0925 毒理定案 C1,反噪):PE 路旁路③层锁文,种子句是唯一能"
    "携带反噪意志进 PE 路的通道——种子句在风格前缀后自带表面洁净正向条款「画面干净平滑,"
    "墨与色落在浅净平涂色场上,而非纸面纹理」(措辞=05 库常量A 禁纸纹条款的正向转写原文,"
    "零自造词),**禁止裸「水墨国风修仙:」前缀直发**(九拍 PE 文的纹理语全部溯源到裸前缀,"
    "无第二风格源);[140] 种子句默认值已按此落盘,驱动脚本与人工发拍同守此纪律"
    "(宪法=05 库 §一/§六「PE 种子纪律」)。\n"
    "- [40] 面板「画幅联动开关」(默认关):开=[140] PE 建议画幅 wh_ratio 经子图联动链"
    "[151]-[158](正则/转数/公式)接管 [5] 宽高(4.2MP 档,终值仍从 [40] width/height 输出"
    "直驱 [5]);恒九型仍是业务默认,故默认关;开联动会把 PE 组拉入执行(PE开关 同开才有意"
    "义),PE 未给建议画幅时该路报错——常规出图保持关闭。\n"
    "- 起草/改写提示词唤取技能 qwen-image-2-1-prompter。\n\n"
    "### 负面线说明(cfg=1 占位,W5 终审)\n"
    "- **cfg=1 下负面提示词数学上不参与采样**;[40] negative 输出→[7] 负向槽的接线保留,纯为"
    "与官方模板同构的**占位**(不生效)。要用负向须抬 cfg,非本产线口径。\n\n"
    "### 加速区·并行三支路+单选择(0929 并行化轮;默认=直出40步=0929 拉齐重放裁定)\n"
    "- **三档=三条完整并行支路,前面只有一个选择逻辑=[208] MyQi21SpeedSelect**(LATENT 汇流处"
    "单点,combo 三选一**首项=默认=「0 · 直出40步」**(0929 拉齐重放,12:05 主会话复核;"
    "Fun-Acc 仍为主加速=次序第二);0929 前注入式开关农场 10 逻辑件"
    "([30]档位/[32]/[177] 开关/[178][179][195][196] 常量/[193][194] 比较)已全拆):"
    "支路0=直出 40 步([7] KSampler 官方完整档)/支路1=viggle 359 步([31] LoRA(0.8)→"
    "[206] KSampler)/支路2=Fun-Acc 4 步([198] T8QwenImage21FunAccPDD4Step,4步/sigmas 五值/"
    "euler/cfg1 全内置勿外接采样器)。默认档只是初始值,随时可切任何档;加速启停语义=用户手动权威。\n"
    "- **懒执行**:未选中支路整体不进执行图零加载(MyQi21SpeedSelect 懒选择,check_lazy_status "
    "只拉起选中档支路;如默认直出40步时 [198]/[206]/[31] 全不在执行图)。\n"
    "- **seed 单源共享**:[207] PrimitiveInt(默认 0 fixed 可复现)单源扇出三支路采样器"
    "([7]/[206]/[198] 的 seed 一律 widget→input 接线接管——各采样器面板 seed 值=摆设值不生效,"
    "改 seed 只动 [207] 一处,三支路同步)。\n"
    "- **面板值=生效值**:steps 回归各支路 KSampler widget([7]=40/[206]=359 均真实生效,"
    "无联动开关无摆设值);cfg 恒 1/euler/simple/denoise 1 照官方;[40].negative 占位接线保留在"
    "[7]/[206](cfg=1 下数学上不参与,见负面线说明节)。\n"
    "- **档1=viggle**:[31] LoraLoaderModelOnly 挂链(name 预填 **" + LORA_FILE + "**,viggle 蒸馏件"
    "已装机,strength 0.8——0925 探针最优:flatMAD 2.52→1.75 细腻无结构缺陷;8步方案 2.60 无收益+"
    "超荐档弃)+[206] 359 步(0929 用户改值,原 6=v0.2.1 系卡荐档;cfg 保持 1);模型卡注 "
    "shift_terminal=0.02 伤末步,画质异常先查调度。\n"
    "- **档2=Fun-Acc**:[198] model=[1] base **直连(绝不吃 viggle LoRA)**;positive 与 [7]/[206] "
    "同源=[40].positive;latent 与 [7]/[206] 同源=[5] 空潜;无负面槽(负面词在档2 不参与);"
    "model_file=" + FUNACC_FILE + "(已装机 models/loras/)。实测速度(0926 三轮实弹):1024² "
    "28.8s/2048² 130.7s(viggle 34.1/183.1,直出 214.7/1173.4)。TE 硬校验 4096 维,现产线 "
    "TE=qwen3vl_8b_bf16_heretic 已实测通过。\n"
    "- **依赖警示:档2 需引擎装 Fun-Acc 插件(T8 节点,见设置页生态插件区"
    " Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8)**;未装的机器选档2 节点红/执行失败——降级="
    "经 [208] 选择件下拉切回 0/1 档。TE-Speed 槽不加(3c 试装已死归档:插件未装=画布红节点,"
    "D4 终审永不装)。\n\n"
    "### 参数圣经\n"
    "- cfg 恒 1(负面=官方同构占位,见上节;档2 Fun-Acc 无负面槽);**步数=各支路面板真实生效值"
    "([7]=40 官方完整档,官方区间 40-50,起手即完整态;[206]=359=viggle 支路(0929 用户改值,"
    "原 6);档2=Fun-Acc 4 步内置于 [198] T8)**;分辨率走 [40] 子图随型直驱 width/height"
    "(宽高恒 8 倍数);seed=[207] 三支路共享单源(默认 fixed=0 可复现);风格终审=用户。\n"
    "- 生成脚本=apps/build/scripts/qi21_daojie_t2i_0923.py(幂等;主体句默认/锁层全文从库文档"
    "现读,BASE 真源=qi21_bases.json,重跑即同步)。\n"
    "- RGBA 透明(默认关):官方公式 This is an RGBA format image with transparency. [装配全文,与 "
    "[27] 同源]. The image has an alpha channel and a transparent background.(头尾逐字=官方"
    "原文,子图 [160][161][162][163] 现拼;中文同款:这是一张带有透明度的RGBA图像。……该图像"
    "具有alpha通道,背景是透明的。)透明路出图必须存 PNG 才保 alpha。\n"
)


# ── 真源解析(05 库文档;②层=09-23 美化版;qi21_bases.json 互锁)────────
def load_truth() -> dict:
    """返回 {types:[{zh,aspect,mp,subject,base,middle_is_char,constant_text}], const_a}。

    constant_text=该型底座应有全文=②美化版底座(+常量B·人物系增量四锁)+④配色行;
    并与 qi21_bases.json(MyQi21DaojieBase 运行时真源)逐字互锁——两账漂移即拒生成。
    """
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    qi21_bases = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))
    zh_order = [b["zh"] for b in bases]
    if [e.get("zh") for e in qi21_bases] != zh_order:
        raise SystemExit("qi21_bases.json 条目 zh 顺序与 daojie_bases.json 不一致(真源链断)")
    qi21_by_zh = {e["zh"]: e for e in qi21_bases}

    headings = re.findall(r"^### (.+?)-基础\s*$", md, re.M)
    if headings != zh_order:
        raise SystemExit(f"库 ### 九型标题与 daojie_bases.json zh 顺序不一致: {headings} vs {zh_order}")

    head = md.split("## 三、")[0]
    fences = re.findall(r"```text\n(.*?)\n```", head, re.S)
    if len(fences) < 3:
        raise SystemExit("库 §二 常量围栏不足(应含 装配顺序块+常量A+常量B)")
    const_a, const_b = fences[1], fences[2]
    b_lines = const_b.split("\n")

    types = []
    for zh, canon in zip(zh_order, bases):
        m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
        if not m:
            raise SystemExit(f"库文档缺条目: ### {zh}-基础")
        fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S)
        if not fence:
            raise SystemExit(f"条目 {zh} 缺 ```text 装配全文围栏")
        lines = fence.group(1).split("\n")
        subject_wrapped, base_line, middle, color = lines[0], lines[1], lines[2:-1], lines[-1]
        if not (subject_wrapped.startswith("⟨①:") and subject_wrapped.endswith("⟩")):
            raise SystemExit(f"条目 {zh} 首行非 ⟨①:…⟩ 主体槽")
        # ③层互锁:人物系=[A1,A2,B×4,A3] 七行,场景系=[A1,A2,A3] 三行
        is_char = zh in CHAR_TYPES
        want_len = 7 if is_char else 3
        if len(middle) != want_len:
            raise SystemExit(f"条目 {zh} ③锁层行数 {len(middle)} ≠ {want_len}(库结构漂移)")
        if middle[2:6] != b_lines and is_char:
            raise SystemExit(f"条目 {zh} ③锁层中段与常量B 不逐字一致")
        if color != COLOR_MAP[zh]:
            raise SystemExit(f"条目 {zh} ④配色行与 §一映射表不一致")
        constant_text = "\n".join([base_line] + (b_lines if is_char else []) + [color])
        # 真源链互锁:qi21_bases.json(节点运行时读)与 05 库(文档真源)逐字一致
        if qi21_by_zh[zh].get("base_text") != constant_text:
            raise SystemExit(f"qi21_bases.json 「{zh}」base_text 与 05 库②层(美化版)装配不逐字一致"
                             "(先重跑 qi21_bases_extract_0923.py 同步提取)")
        types.append({
            "zh": zh,
            "aspect": canon["aspect_ratio"],
            "mp": canon["megapixels"],
            "subject": subject_wrapped[len("⟨①:"):-len("⟩")],
            "base": base_line,
            "constant_text": constant_text,
        })
    if len({t["constant_text"] for t in types}) != 9 or len({t["base"] for t in types}) != 9:
        raise SystemExit("九型底座常量两两不唯一")
    return {"types": types, "const_a": const_a}


def _qi21_base_text(zh: str) -> str:
    """MyQi21DaojieBase 运行时将读出的 BASE(干跑用;qi21_bases.json 现读)。"""
    entries = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))
    for e in entries:
        if e.get("zh") == zh:
            return e["base_text"]
    raise SystemExit(f"qi21_bases.json 缺「{zh}」条目")


# ── 节点工厂(序列化口径承 qwen21 族在库件/K2 件/官方 blueprint)─────────
def _string_constant(nid: int, title: str, text: str, pos: list, links: list[int], size: list) -> dict:
    return {
        "id": nid, "type": "StringConstant", "title": title,
        "pos": pos, "size": size, "flags": {}, "order": 0, "mode": 0,
        "inputs": [],
        "outputs": [{"name": "STRING", "type": "STRING", "links": links}],
        "properties": {"Node name for S&R": "StringConstant"},
        "widgets_values": [text],
    }


def _switch(nid: int, title: str, false_link: int, true_link: int, switch_link: int,
            out_links: list[int], pos: list, typ: str = "STRING", default: bool = False) -> dict:
    """开关:switch 槽为 widget 转输入(接 -10 边界或主画布布尔源;None=本件 widget,
    照 i2i [15] PE 开关式——主画布 PE 开关不再占宿主面板)。default=widget 默认值
    (0926 裁定1:PE 开路含画布本体,[141] 默认 true;其余开关一律默认 false)。"""
    return {
        "id": nid, "type": "ComfySwitchNode", "title": title,
        "pos": pos, "size": [380, 120], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "on_false", "shape": 7, "type": typ, "link": false_link},
            {"name": "on_true", "shape": 7, "type": typ, "link": true_link},
            {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": switch_link},
        ],
        "outputs": [{"name": "output", "type": typ, "links": out_links}],
        "properties": {"Node name for S&R": "ComfySwitchNode"},
        "widgets_values": [default],
    }


def _concatenate(nid: int, title: str, a_link: int, b_link: int, out_links: list[int], pos: list,
                 delimiter: str = "\n") -> dict:
    return {
        "id": nid, "type": "StringConcatenate", "title": title,
        "pos": pos, "size": [380, 180], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "string_a", "type": "STRING", "widget": {"name": "string_a"}, "link": a_link},
            {"name": "string_b", "type": "STRING", "widget": {"name": "string_b"}, "link": b_link},
        ],
        "outputs": [{"name": "STRING", "type": "STRING", "links": out_links}],
        "properties": {"Node name for S&R": "StringConcatenate"},
        "widgets_values": ["", "", delimiter],
        "widgets_values_named": {"delimiter": delimiter},
    }


def _reroute(nid: int, pos: list, in_link: int, out_link, typ: str) -> dict:
    """Reroute 通道拐点(序列化逐字段=K2-角色设定-道劫.json 顶层级实取样板;
    out_link 可单线 int 或扇出 list——R26.4 起 MODEL 通道扇出直连/LoRA 两臂)。"""
    return {
        "id": nid, "type": "Reroute", "pos": pos, "size": [75, 26],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "", "type": "*", "link": in_link}],
        "outputs": [{"name": "", "type": typ,
                     "links": out_link if isinstance(out_link, list) else [out_link]}],
        "properties": {"showOutputText": False, "horizontal": False},
    }


def _primitive_int(nid: int, title: str, value: int, pos: list, out_link: int) -> dict:
    """PrimitiveInt 常量(steps 联动臂;序列化逐字段=官方本地 I2V-480P 模板实取样板:
    widgets_values=[value,"fixed"] 带 control_after_generate + named 双记账)。"""
    return {
        "id": nid, "type": "PrimitiveInt", "title": title,
        "pos": pos, "size": [270, 90], "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "value", "type": "INT", "widget": {"name": "value"}, "link": None}],
        "outputs": [{"name": "INT", "type": "INT", "links": [out_link]}],
        "properties": {"cnr_id": "comfy-core", "Node name for S&R": "PrimitiveInt"},
        "widgets_values": [value, "fixed"],
        "widgets_values_named": {"value": value, "fixed": "fixed"},
    }


def _trace_origin(i_links: dict, i_nodes: dict, lid: int) -> int:
    """沿 link 反向溯源,穿过 Reroute 通道拐点回到实源节点 id(-10 边界照实返回)。"""
    seen = set()
    while True:
        l = i_links[lid]
        oid = l["origin_id"]
        if oid == -10 or i_nodes[oid]["type"] != "Reroute" or oid in seen:
            return oid
        seen.add(oid)
        lid = i_nodes[oid]["inputs"][0]["link"]


# ── 子图构建(0925 W3 收窄:九型+锁层+拼接+RGBA 公式+双路编码;三行)───────
def _internal_link(lid: int, oid: int, oslot: int, tid: int, tslot: int, typ: str) -> dict:
    return {"id": lid, "origin_id": oid, "origin_slot": oslot,
            "target_id": tid, "target_slot": tslot, "type": typ}


def build_subgraph(truth: dict) -> tuple[dict, list[dict]]:
    """返回 (subgraph 定义, 内部 link 对象表)。

    0928 PE 链迁入轮:子图=六行(四行流水+联动蛇形两行),全部节点 pos≥80:
      行1 y=280   源行:[150] 底座九选一/[110] 锁层A/[160][161] RGBA 头尾
      行2 y=1040  装配:[130] 拼接①→[131] 拼接②→[162][163] RGBA 公式拼接
      行3 y=1800  PE改写:[140] PE改写→[141] 提示词开关(全程子图内,回流线绝迹)
      行4 y=2560  编码输出:[143] RGBA编码→[142] 主编码(prompt 直收 [141])→[144]
      行5 y=3320  联动宽路:[151]正则→[153]转数→[155]公式→[157]宽开关
      行6 y=4080  联动高路:[152]正则→[154]转数→[156]公式→[158]高开关
      通道:W/H 左缘竖走廊 [171]/[172](x500-620 净空,边界线豁免口径);
      [175]=[143]->[144] 垫脚石(直连必过 [142]);[176]=[141]->最终文本输出下探拐点
      (走行4-行5 框间带,平送输出槽)。
    输出 IO 槽 x=7300 钉死最右列(全子图最大节点 x=4760;表示法=K2 [90] 实证)。
    """
    links: list[dict] = []
    # -10 扇出(边界线;widget 型输入 linkIds 同样逐项登记=契约铁律)
    links.append(_internal_link(1, -10, 0, TE_ID, 0, "CLIP"))            # clip → 主编码
    links.append(_internal_link(2, -10, 0, TE_RGBA_ID, 0, "CLIP"))       # clip → RGBA 编码
    links.append(_internal_link(3, -10, 1, TE_ID, 2, "VAE"))             # vae → 主编码
    links.append(_internal_link(4, -10, 1, TE_RGBA_ID, 2, "VAE"))        # vae → RGBA 编码
    links.append(_internal_link(5, -10, 2, CONCAT1_ID, 0, "STRING"))     # 主体句 → 拼接①.string_a
    links.append(_internal_link(6, -10, 3, BASE_ID, 0, "COMBO"))         # 型选择 → MyQi21DaojieBase.base
    links.append(_internal_link(7, -10, 4, RGBA_SW_ID, 2, "BOOLEAN"))    # RGBA透明开关 → [144].switch
    links.append(_internal_link(8, -10, 5, PE_SW_ID, 2, "BOOLEAN"))      # PE开关(宿主面板) → [141].switch
    links.append(_internal_link(46, -10, 6, PE_RW_ID, 0, "CLIP"))        # pe_clip(主图[11]) → PE改写.clip
    links.append(_internal_link(47, -10, 7, SW_W_ID, 2, "BOOLEAN"))      # 画幅联动开关 → 宽开关.switch
    links.append(_internal_link(48, -10, 7, SW_H_ID, 2, "BOOLEAN"))      # 画幅联动开关 → 高开关.switch
    # 装配链(9-12)
    links.append(_internal_link(9, BASE_ID, 0, CONCAT1_ID, 1, "STRING"))    # BASE → 拼接①.string_b
    links.append(_internal_link(10, LOCK_ID, 0, CONCAT2_ID, 1, "STRING"))   # 锁层A 恒挂 → 拼接②
    links.append(_internal_link(11, CONCAT1_ID, 0, CONCAT2_ID, 0, "STRING"))
    links.append(_internal_link(12, CONCAT2_ID, 0, RGBA_CAT1_ID, 1, "STRING"))  # 装配全文 → RGBA 公式①
    # RGBA 官方公式拼接(13-16;头句+装配全文+尾句)
    links.append(_internal_link(13, RGBA_HEAD_ID, 0, RGBA_CAT1_ID, 0, "STRING"))
    links.append(_internal_link(14, RGBA_CAT1_ID, 0, RGBA_CAT2_ID, 0, "STRING"))
    links.append(_internal_link(15, RGBA_TAIL_ID, 0, RGBA_CAT2_ID, 1, "STRING"))
    links.append(_internal_link(16, RGBA_CAT2_ID, 0, TE_RGBA_ID, 3, "STRING"))  # → RGBA 编码.prompt
    # 编码与 RGBA 开关(17-19;[143]->[144] on_true 经双垫脚石 [175]/[178]——行4 成员序
    # [143][142][144] 钉死,直连线几何上必横穿 [142] 盒;且 on_true(slot1) 须自下方升入,
    # 免穿 [142]→[144] on_false 平线(槽序结构性交叉))
    links.append(_internal_link(17, TE_ID, 0, RGBA_SW_ID, 0, "CONDITIONING"))
    links.append(_internal_link(18, TE_RGBA_ID, 0, RR_SWC_ID, 0, "CONDITIONING"))
    links.append(_internal_link(49, RR_SWC_ID, 0, RR_SWC2_ID, 0, "CONDITIONING"))
    links.append(_internal_link(19, RR_SWC2_ID, 0, RGBA_SW_ID, 1, "CONDITIONING"))
    links.append(_internal_link(20, RGBA_SW_ID, 0, -20, 0, "CONDITIONING"))   # → 输出 positive
    links.append(_internal_link(21, TE_ID, 1, -20, 1, "CONDITIONING"))        # 主编码.negative → 输出
    # PE 链(22-24;0928 迁入:装配全文不出子图,最终文本直喂主编码)
    links.append(_internal_link(22, CONCAT2_ID, 0, PE_SW_ID, 0, "STRING"))     # 装配全文 → [141].on_false
    links.append(_internal_link(23, PE_RW_ID, 0, PE_SW_ID, 1, "STRING"))       # PE 改写 → [141].on_true
    links.append(_internal_link(24, PE_SW_ID, 0, TE_ID, 3, "STRING"))          # 最终文本 → 主编码.prompt
    links.append(_internal_link(44, PE_SW_ID, 0, RR_TXT_ID, 0, "STRING"))      # 最终文本 → 下探拐点
    links.append(_internal_link(45, RR_TXT_ID, 0, -20, 2, "STRING"))           # → 输出 最终文本(主图[27])
    # 画幅联动链(25-34;源=[140].wh_ratio,数据源与消费全在子图)
    links.append(_internal_link(25, PE_RW_ID, 2, RATIO_RW_ID, 0, "STRING"))    # wh_ratio → 取宽比
    links.append(_internal_link(26, PE_RW_ID, 2, RATIO_RH_ID, 0, "STRING"))    # wh_ratio → 取高比
    links.append(_internal_link(27, RATIO_RW_ID, 0, CONV_RW_ID, 0, "STRING"))
    links.append(_internal_link(28, RATIO_RH_ID, 0, CONV_RH_ID, 0, "STRING"))
    links.append(_internal_link(29, CONV_RW_ID, 1, MATH_W_ID, 0, "INT"))
    links.append(_internal_link(30, CONV_RW_ID, 1, MATH_H_ID, 0, "INT"))
    links.append(_internal_link(31, CONV_RH_ID, 1, MATH_W_ID, 1, "INT"))
    links.append(_internal_link(32, CONV_RH_ID, 1, MATH_H_ID, 1, "INT"))
    links.append(_internal_link(33, MATH_W_ID, 1, SW_W_ID, 1, "INT"))          # 公式宽 → 宽开关.on_true
    links.append(_internal_link(34, MATH_H_ID, 1, SW_H_ID, 1, "INT"))          # 公式高 → 高开关.on_true
    # 九型 W/H 两跳通道(35-40:全程右向;左缘竖走廊→行隙横带→联动开关 on_false 落槽)
    links.append(_internal_link(35, BASE_ID, 1, RR_W_ID, 0, "INT"))
    links.append(_internal_link(36, RR_W_ID, 0, RR_W2_ID, 0, "INT"))
    links.append(_internal_link(37, RR_W2_ID, 0, SW_W_ID, 0, "INT"))           # 行4-5 隙横带→[157].on_false
    links.append(_internal_link(38, BASE_ID, 2, RR_H_ID, 0, "INT"))
    links.append(_internal_link(39, RR_H_ID, 0, RR_H2_ID, 0, "INT"))
    links.append(_internal_link(40, RR_H2_ID, 0, RR_H3_ID, 0, "INT"))
    links.append(_internal_link(41, RR_H3_ID, 0, SW_H_ID, 0, "INT"))           # 行6 下方横带→[158].on_false
    # 联动终值出子图(42-43;主图 [5] EmptyLatentImage 直连消费)
    links.append(_internal_link(42, SW_W_ID, 0, -20, 3, "INT"))                # → 输出 width
    links.append(_internal_link(43, SW_H_ID, 0, -20, 4, "INT"))                # → 输出 height
    assert sorted(l["id"] for l in links) == list(range(1, 50))

    nodes: list[dict] = []
    # 行1 源行(列距≥200 est 足迹口径)
    nodes.append({
        "id": BASE_ID, "type": "MyQi21DaojieBase",
        "title": "底座九选一(MyQi21DaojieBase:BASE=②+B+④ 逐字=05库/宽高随型直出/磁盘热读)",
        "pos": [80, 280], "size": [570.5259765625, 200], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "base", "type": "COMBO", "widget": {"name": "base"}, "link": 6},
        ],
        "outputs": [
            {"name": "BASE", "type": "STRING", "links": [9]},
            {"name": "WIDTH", "type": "INT", "links": [35]},
            {"name": "HEIGHT", "type": "INT", "links": [38]},
            {"name": "型名", "type": "STRING", "links": None},
        ],
        "properties": {"Node name for S&R": "MyQi21DaojieBase"},
        "widgets_values": [DEFAULT_TYPE],
    })
    nodes.append(_string_constant(
        LOCK_ID, "通用锁层常量A(③层·库首节全文·全九型恒挂)",
        truth["const_a"], [900, 280], [10], [440, 400]))
    nodes.append(_string_constant(
        RGBA_HEAD_ID, "RGBA官方头句(EN·逐字=官方模板)", RGBA_HEAD_EN,
        [1550, 280], [13], [380, 120]))
    nodes.append(_string_constant(
        RGBA_TAIL_ID, "RGBA官方尾句(EN·逐字=官方模板)", RGBA_TAIL_EN,
        [2150, 280], [15], [380, 120]))

    # 行2 装配
    nodes.append(_concatenate(
        CONCAT1_ID, "装配拼接①(主体句+BASE;delimiter=\\n)", 5, 9, [11], [680, 1040]))
    nodes.append(_concatenate(
        CONCAT2_ID, "装配拼接②(+通用锁层恒挂;delimiter=\\n)", 11, 10, [12, 22], [1400, 1040]))
    nodes.append(_concatenate(
        RGBA_CAT1_ID, "RGBA公式拼接①(官方头句+装配全文;delimiter=空格)", 13, 12, [14],
        [2000, 1040], delimiter=" "))
    nodes.append(_concatenate(
        RGBA_CAT2_ID, "RGBA公式拼接②(+官方尾句;delimiter=空格)", 14, 15, [16],
        [2710, 1040], delimiter=" "))

    # 行3 PE改写(0928 迁入;clip←pe_clip 槽,prompt=种子句 widget 自带反噪条款;
    # 0929 回灌:[140]/[141] 宽度随用户(502.56/640.40);[140] x 1740→1690 让 est 横距
    # ≥200([141] 保用户 x=2400,其右缘 3040.40 恰在 [163]→[143] 竖走廊左侧)——
    # 用户拉宽 [141] 后该竖走廊从 [141] 身后穿过,[163] x 2580→2710 把走廊推出
    # [141] 右缘外,组框2/3 随罩)
    nodes.append({
        "id": PE_RW_ID, "type": "QwenImage21_T2IPromptRewrite",
        "title": f"[{PE_RW_ID}] PE改写(短句→英文长文,默认开路(0926裁定1);pp=1.5 已定档 0925)",
        "pos": [1690, 1800], "size": [502.5630859375, 340], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "clip", "type": "CLIP", "link": 46},
            {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": None},
            {"name": "temperature", "type": "FLOAT", "widget": {"name": "temperature"}, "link": None},
            {"name": "top_p", "type": "FLOAT", "widget": {"name": "top_p"}, "link": None},
            {"name": "top_k", "type": "INT", "widget": {"name": "top_k"}, "link": None},
            {"name": "presence_penalty", "type": "FLOAT", "widget": {"name": "presence_penalty"}, "link": None},
            {"name": "max_new_tokens", "type": "INT", "widget": {"name": "max_new_tokens"}, "link": None},
            {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": None},
        ],
        "outputs": [
            {"name": "positive_prompt", "type": "STRING", "links": [23]},
            {"name": "negative_prompt", "type": "STRING", "links": None},
            {"name": "wh_ratio", "type": "STRING", "links": [25, 26]},
            {"name": "thinking", "type": "STRING", "links": None},
            {"name": "parse_ok", "type": "BOOLEAN", "links": None},
        ],
        "properties": {"Node name for S&R": "QwenImage21_T2IPromptRewrite"},
        "widgets_values": [PE_SEED_PROMPT, *PE_PARAMS],
    })
    # [141] 提示词开关(0928 迁入子图;switch=宿主面板「PE开关」控件,-10 槽5;
    # x=2400 保用户原值)
    nodes.append(_switch(
        PE_SW_ID, "提示词开关(true=PE扩写·默认(0926裁定1) / false=直写装配=按图选配;输出=最终文本→主编码)",
        22, 23, 8, [24, 44], [2400, 1800], default=True))
    nodes[-1]["size"] = [640.39609375, 120]

    # 行4 编码输出(TextEncode 输入序=官方:clip/images.image_1/vae/prompt)
    def _textencode(nid: int, title: str, pos: list, clip_l: int, vae_l: int,
                    prompt_link, prompt_text: str, pos_links) -> dict:
        return {
            "id": nid, "type": "TextEncodeQwenImage21", "title": title,
            "pos": pos, "size": [420, 320], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": clip_l},
                {"name": "images.image_1", "type": "IMAGE", "shape": 7, "link": None},
                {"name": "vae", "type": "VAE", "shape": 7, "link": vae_l},
                {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": prompt_link},
            ],
            "outputs": [
                {"name": "positive", "type": "CONDITIONING", "links": pos_links},
                {"name": "negative", "type": "CONDITIONING", "links": (
                    [21] if nid == TE_ID else None)},
                {"name": "latent", "type": "LATENT", "links": None},
            ],
            "properties": {"Node name for S&R": "TextEncodeQwenImage21"},
            "widgets_values": [prompt_text, "", 1024],
        }

    nodes.append(_textencode(TE_RGBA_ID, "RGBA编码(官方公式拼接路,默认旁路)",
                             [3060, 2560], 2, 4, 16, "", [18]))
    nodes.append(_textencode(TE_ID, "主编码(prompt 直收子图内[141]开关输出=最终文本)",
                             [3720, 2560], 1, 3, 24, "", [17]))
    nodes.append(_switch(
        RGBA_SW_ID, "RGBA开关(false=普通 / true=透明,透明图存PNG)", 17, 19, 7, [20],
        [4380, 2560], typ="CONDITIONING"))

    # 行5/行6 画幅联动蛇形(0928 随 PE 迁入;上=宽路/下=高路,列对齐)
    def _regex(nid: int, title: str, pattern: str, in_link: int, out_link: int, pos: list) -> dict:
        return {
            "id": nid, "type": "RegexExtract", "title": title,
            "pos": pos, "size": [340, 200], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "string", "type": "STRING", "widget": {"name": "string"}, "link": in_link},
                {"name": "regex_pattern", "type": "STRING", "widget": {"name": "regex_pattern"}, "link": None},
                {"name": "mode", "type": "COMBO", "widget": {"name": "mode"}, "link": None},
                {"name": "case_insensitive", "type": "BOOLEAN", "widget": {"name": "case_insensitive"}, "link": None},
                {"name": "multiline", "type": "BOOLEAN", "widget": {"name": "multiline"}, "link": None},
                {"name": "dotall", "type": "BOOLEAN", "widget": {"name": "dotall"}, "link": None},
                {"name": "group_index", "type": "INT", "widget": {"name": "group_index"}, "link": None},
            ],
            "outputs": [{"name": "STRING", "type": "STRING", "links": [out_link]}],
            "properties": {"Node name for S&R": "RegexExtract"},
            "widgets_values": ["", pattern, "First Group", False, False, False, 1],
        }

    def _convert(nid: int, title: str, in_link: int, out_links: list[int], pos: list) -> dict:
        return {
            "id": nid, "type": "ComfyNumberConvert", "title": title,
            "pos": pos, "size": [240, 80], "flags": {}, "order": 0, "mode": 0,
            "inputs": [{"name": "value", "type": "INT,FLOAT,STRING,BOOLEAN", "link": in_link}],
            "outputs": [
                {"name": "FLOAT", "type": "FLOAT", "links": None},
                {"name": "INT", "type": "INT", "links": out_links},
            ],
            "properties": {"Node name for S&R": "ComfyNumberConvert"},
        }

    def _math(nid: int, title: str, expr: str, a_link: int, b_link: int, out_link: int, pos: list) -> dict:
        return {
            "id": nid, "type": "ComfyMathExpression", "title": title,
            "pos": pos, "size": [340, 160], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"label": "a", "name": "values.a", "type": "FLOAT,INT", "link": a_link},
                {"label": "b", "name": "values.b", "shape": 7, "type": "FLOAT,INT", "link": b_link},
                {"name": "expression", "type": "STRING", "widget": {"name": "expression"}, "link": None},
            ],
            "outputs": [
                {"name": "FLOAT", "type": "FLOAT", "links": None},
                {"name": "INT", "type": "INT", "links": [out_link]},
            ],
            "properties": {"Node name for S&R": "ComfyMathExpression"},
            "widgets_values": [expr],
        }

    nodes.append(_regex(RATIO_RW_ID, "PE建议画幅·取宽比(如 16:9→16)", RATIO_W_PATTERN, 25, 27,
                        [2500, 3320]))
    nodes[-1]["size"] = [340, 262]   # 0929 回灌:用户拉高 200→262
    nodes.append(_regex(RATIO_RH_ID, "PE建议画幅·取高比(如 16:9→9)", RATIO_H_PATTERN, 26, 28,
                        [2500, 4080]))
    nodes[-1]["size"] = [340, 262]   # 0929 回灌:用户拉高 200→262
    nodes.append(_convert(CONV_RW_ID, "宽比转数", 27, [29, 30], [3100, 3320]))
    nodes.append(_convert(CONV_RH_ID, "高比转数", 28, [31, 32], [3100, 4080]))
    nodes.append(_math(MATH_W_ID, "PE建议宽(4.2MP·8倍数取整)", MATH_W_EXPR, 29, 31, 33,
                       [3700, 3320]))
    nodes.append(_math(MATH_H_ID, "PE建议高(4.2MP·8倍数取整)", MATH_H_EXPR, 30, 32, 34,
                       [3700, 4080]))
    nodes.append(_switch(SW_W_ID, "宽联动开关(false=九型WIDTH / true=PE建议宽)", 37, 33, 47, [42],
                         [4300, 3320], typ="INT"))
    nodes[-1]["size"] = [343.6548828125, 110]   # 0929 回灌:用户拉宽 300→343.65
    nodes.append(_switch(SW_H_ID, "高联动开关(false=九型HEIGHT / true=PE建议高)", 41, 34, 48, [43],
                         [4300, 4080], typ="INT"))
    nodes[-1]["size"] = [349.4380859375, 110]   # 0929 回灌:用户拉宽 300→349.44

    # 通道 Reroute(0928 迁入轮:[171]/[172]=九型 W/H 左缘竖走廊——x500-620 净空竖带
    # (边界线豁免口径),行5/行6 槽位平送联动开关 on_false;[175] 行3-行4 框间带垫脚石;
    # [176] [141]→最终文本输出 走行4-行5 框间带下探再平送输出槽)
    nodes.append(_reroute(RR_W_ID, [640, 3060], 35, 36, "INT"))
    nodes.append(_reroute(RR_W2_ID, [4180, 3060], 36, 37, "INT"))
    nodes.append(_reroute(RR_H_ID, [545, 2900], 38, 39, "INT"))
    nodes.append(_reroute(RR_H2_ID, [610, 4520], 39, 40, "INT"))
    nodes.append(_reroute(RR_H3_ID, [4180, 4540], 40, 41, "INT"))
    nodes.append(_reroute(RR_SWC_ID, [3500, 2950], 18, 49, "CONDITIONING"))
    nodes.append(_reroute(RR_SWC2_ID, [4100, 2950], 49, 19, "CONDITIONING"))
    nodes.append(_reroute(RR_TXT_ID, [2900, 2900], 44, 45, "STRING"))

    for order, n in enumerate(nodes):
        n["order"] = order

    # 内部分组(四框各罩四行流水单一阶段行,边到边;联动蛇形两行不设框——预算≤4,
    # 消交叉可打破组框层约束的宪法既定;通道拐点留框间带不入框)
    groups: list[dict] = [
        {
            "id": 1, "title": "道劫·底座装配(行1 源行:九选一底座+锁层A恒挂+RGBA官方头尾)",
            "bounding": [50, 230, 2510, 530], "color": "#3f789e", "flags": {},
        },
        {
            "id": 2, "title": "道劫·装配(行2:拼接①② delimiter=\\n 分层;RGBA 公式拼接;装配全文→[141])",
            "bounding": [650, 990, 2450, 310], "color": "#a1309b", "flags": {},
        },
        {
            "id": 3, "title": "道劫·PE改写(行3:[140]PE改写→[141]提示词开关;switch=宿主面板「PE开关」默认开)",
            "bounding": [1685, 1750, 1400, 470], "color": "#886", "flags": {},
        },
        {
            "id": 4, "title": "道劫·编码输出(行4:主编码(prompt 直收[141]最终文本)+RGBA编码(默认旁路)+RGBA开关)",
            "bounding": [3030, 2510, 1790, 400], "color": "#4d9e6a", "flags": {},
        },
    ]

    # 子图 IO(inputs 槽序=宿主 inputs 序;widget 型输入 linkIds 同样逐项登记=契约铁律)
    _IO_IDS = [
        "a1e2c3d4-0001-4a01-9e01-7d4a9c31a001",  # in-0 clip
        "a1e2c3d4-0002-4a02-9e02-7d4a9c31a002",  # in-1 vae
        "a1e2c3d4-0003-4a03-9e03-7d4a9c31a003",  # in-2 主体句
        "a1e2c3d4-0004-4a04-9e04-7d4a9c31a004",  # in-3 型选择(COMBO)
        "a1e2c3d4-0005-4a05-9e05-7d4a9c31a005",  # in-4 RGBA透明开关
        "a1e2c3d4-0006-4a06-9e06-7d4a9c31a006",  # in-5 PE开关(BOOLEAN,默认 true)
        "a1e2c3d4-0007-4a07-9e07-7d4a9c31a007",  # in-6 pe_clip(主图 [11] PE 专属 TE)
        "a1e2c3d4-0008-4a08-9e08-7d4a9c31a008",  # in-7 画幅联动开关(BOOLEAN,默认 false)
        "b2f3a4c5-0001-4b01-8f01-3c5f81b56b01",  # out-0 positive
        "b2f3a4c5-0002-4b02-8f02-3c5f81b56b02",  # out-1 negative
        "b2f3a4c5-0003-4b03-8f03-3c5f81b56b03",  # out-2 最终文本(→主图 [27])
        "b2f3a4c5-0004-4b04-8f04-3c5f81b56b04",  # out-3 width
        "b2f3a4c5-0005-4b05-8f05-3c5f81b56b05",  # out-4 height
    ]
    # IO 槽 pos(输入槽落各自目标近旁:clip/vae 落行3-行4 间带、开关类落目标行近旁、
    # 主体句/型选择落左缘行带;输出槽 x=7300 全部钉死最右列,纵向按出线源行分布)
    inputs = [
        {"id": _IO_IDS[0], "name": "clip", "type": "CLIP", "linkIds": [1, 2], "pos": [2720, 2350]},
        {"id": _IO_IDS[1], "name": "vae", "type": "VAE", "linkIds": [3, 4], "pos": [2520, 2450]},
        {"id": _IO_IDS[2], "name": "主体句", "type": "STRING", "linkIds": [5], "pos": [-36, 1065]},
        {"id": _IO_IDS[3], "name": "型选择", "type": "COMBO", "linkIds": [6], "pos": [-36, 300]},
        {"id": _IO_IDS[4], "name": "RGBA透明开关", "type": "BOOLEAN", "linkIds": [7], "pos": [4200, 2700]},
        {"id": _IO_IDS[5], "name": "PE开关", "type": "BOOLEAN", "linkIds": [8], "pos": [2200, 1750]},
        {"id": _IO_IDS[6], "name": "pe_clip", "type": "CLIP", "linkIds": [46], "pos": [1540, 1700]},
        {"id": _IO_IDS[7], "name": "画幅联动开关", "type": "BOOLEAN", "linkIds": [47, 48], "pos": [4100, 3700]},
    ]
    outputs = [
        {"id": _IO_IDS[8], "name": "positive", "type": "CONDITIONING", "linkIds": [20], "pos": [7300, 2585]},
        {"id": _IO_IDS[9], "name": "negative", "type": "CONDITIONING", "linkIds": [21], "pos": [7300, 2685]},
        {"id": _IO_IDS[10], "name": "最终文本", "type": "STRING", "linkIds": [45], "pos": [7300, 2950]},
        {"id": _IO_IDS[11], "name": "width", "type": "INT", "linkIds": [42], "pos": [7300, 3345]},
        {"id": _IO_IDS[12], "name": "height", "type": "INT", "linkIds": [43], "pos": [7300, 4105]},
    ]

    sg = {
        "id": SG_UUID,
        "version": 1,
        "state": {"lastGroupId": 4, "lastNodeId": 205, "lastLinkId": 49, "lastRerouteId": 8},
        "revision": 1,
        "config": {"defaultIOState": {}},
        "name": "[40] 道劫·装配子图(双击进入)",
        "inputNode": {"id": -10, "bounding": [-320, -260, 160, 4460]},
        "outputNode": {"id": -20, "bounding": [7220, 2300, 320, 2200]},
        "inputs": inputs,
        "outputs": outputs,
        "widgets": [truth["types"][0]["subject"], DEFAULT_TYPE, False, True, False],
        "nodes": nodes,
        "groups": groups,
        "links": links,
        "extra": {"ue_links": [], "links_added_by_ue": []},
    }
    # W6 收口(0926 实测发现项3 计划断言互锁):子图整体归一平移至所有节点
    # pos≥80(左上边距升级 40→80;相对布局零变=est 间距/零重叠/行带语义全保持;
    # 源码逻辑坐标行1-6 y=280/1040/1800/2560/3320/4080 不改,序列化前统一抬,
    # IO 槽/组框/inputNode·outputNode bounding 同步平移保持罩合关系)。
    _dx = max(0, 80 - min(n["pos"][0] for n in sg["nodes"]))
    _dy = max(0, 80 - min(n["pos"][1] for n in sg["nodes"]))
    if _dx or _dy:
        for _n in sg["nodes"]:
            _n["pos"] = [_n["pos"][0] + _dx, _n["pos"][1] + _dy]
        for _io in sg["inputs"] + sg["outputs"]:
            _io["pos"] = [_io["pos"][0] + _dx, _io["pos"][1] + _dy]
        for _grp in sg["groups"]:
            _grp["bounding"][0] += _dx
            _grp["bounding"][1] += _dy
        sg["inputNode"]["bounding"][0] += _dx
        sg["inputNode"]["bounding"][1] += _dy
        sg["outputNode"]["bounding"][0] += _dx
        sg["outputNode"]["bounding"][1] += _dy
    return sg, links


# ── 主图构建(0928 PE 迁子图轮:主图=加载+装配外露+采样链;全部节点 pos≥40)──
def build_main(truth: dict, sg: dict) -> dict:
    g = {
        "id": WF_UUID, "version": 0.4, "revision": 0, "config": {}, "extra": {},
        # ── 四块组框(0929 四块重画轮:三件统一口径;宅基律 pad=L30/T50/R30/B50 实测沿用;
        # 两两 bbox 零交集[自查 3h],非 Note 零裸奔+四块成员恰好[自查 3h];旧「装配外露」
        # 框拆散=[2][11] 双TE 划出归①,旧「主链」框废框=[5][7] 并入③加速区(空潜+三支路
        # 合口径)、[8][9] 独立成④输出——主链×加速区在 [7] 直出行的历史交叠就此消灭)──
        "groups": [
            # 块① 加载器(罩 UNET/VAE/全部 CLIPLoader 含 PE 专属 TE;[2][11] 自旧装配外露框迁入)
            {"id": 2, "title": "道劫·①加载器(UNET[1]/VAE[3]/双TE:[2]主+[11]PE专属→[40])",
             "bounding": [966.6286340249105, 1130, 526.8653345251539, 1065], "color": "#3f789e", "flags": {}},
            # 块② 提示词·装配(主体句+装配子图+预览;[27] 预览留 y1650 上袋原位,框上缘 1600 起)
            {"id": 3, "title": "道劫·②提示词·装配([24]主体句=①层唯一手写位;[40]装配子图(PE改写/画幅联动全在内,面板=型选择/RGBA/PE开关/画幅联动开关);[27]装配预览=最终文本)",
             "bounding": [1670, 1600, 1910.300390625, 1550], "color": "#a1309b", "flags": {}},
            # 块③ 加速区(W1;标题保持 startswith「道劫·加速区」+「加速区·并行」子串=契约
            # TestCanvasNormalization0925 与自查 W1 锚双兼容,序号③入括号不断锚;罩空潜[5]
            # +三支路[7]/[31]+[206]/[198]+选择件[208]+seed单源[207]——旧主链框 [5] 收编,
            # 左缘 3870=[5]-30;[207] 自 (3200,2900) 挪 (3950,2950) 入框脱离②右尾)
            {"id": 4, "title": "道劫·加速区·并行三支路+单选择(③空潜[5]三扇出→[7]直出40步/[31]+[206]viggle·359步/[198]Fun-Acc·4步→[208]MyQi21SpeedSelect;seed单源[207];combo首项=默认直出40步,未选支路懒执行零加载)",
             "bounding": [3870, 1690, 2840, 1790], "color": "#4d9e6a", "flags": {}},
            # 块④ 输出(旧主链框拆出;[8] 解码→[9] 保存)
            {"id": 5, "title": "道劫·④输出([8]VAEDecode→[9]SaveImage)",
             "bounding": [6956.474674780493, 1672.0313909766683, 1213.525325219507, 586.1961868742776],
             "color": "#b58b2a", "flags": {}},
        ],
        "nodes": [],
        "links": [],
        "definitions": {"subgraphs": [sg]},
        "last_node_id": HOST_ID,
        "last_link_id": 18,
    }
    types = truth["types"]

    def loader(nid: int, ntype: str, title: str, pos: list, size: list, wv: list,
               out_links: list[int], inputs: list[dict]) -> dict:
        return {
            "id": nid, "type": ntype, "title": f"[{nid}] {title}",
            "pos": pos, "size": size, "flags": {}, "order": 0, "mode": 0,
            "inputs": inputs,
            "outputs": [{"name": {"UNETLoader": "MODEL", "CLIPLoader": "CLIP",
                                  "VAELoader": "VAE"}[ntype], "type":
                         {"UNETLoader": "MODEL", "CLIPLoader": "CLIP",
                          "VAELoader": "VAE"}[ntype],
                         "links": out_links}],
            "properties": {"Node name for S&R": ntype},
            "widgets_values": wv,
        }

    nodes = [
        # 加载器竖列(0929 并行化轮:[1] UNET 自旧加速区组框(y2882)挪回加载器列上首——
        # [1]→[7] 直连线需从 [40] 上方净空过(旧位出发必穿 [40] 盒);MODEL 单源三扇出
        # [97]/[105]/[106]→[31]LoRA/[7]直出/[198]T8;base 三支路共享)
        loader(1, "UNETLoader", "UNETLoader", [996.6286340249105, 1180], [340, 84],
               ["qwen_image_2.1_bf16.safetensors", "default"], [97, 105, 106],
               [{"name": "unet_name", "type": "COMBO", "widget": {"name": "unet_name"}, "link": None},
                {"name": "weight_dtype", "type": "COMBO", "widget": {"name": "weight_dtype"}, "link": None}]),
        loader(2, "CLIPLoader", "CLIPLoader(主 TE)", [1076.4913898424497, 1704.2324093444404], [360, 130],
               ["qwen3vl_8b_bf16_heretic.safetensors", "qwen_image", "default"], [12],
               [{"name": "clip_name", "type": "COMBO", "widget": {"name": "clip_name"}, "link": None},
                {"name": "type", "type": "COMBO", "widget": {"name": "type"}, "link": None},
                {"name": "device", "type": "COMBO", "shape": 7, "widget": {"name": "device"}, "link": None}]),
        loader(3, "VAELoader", "VAELoader", [1105.518747026763, 1500], [340, 60],
               ["qwen_image_2.1_vae_bf16.safetensors"], [10, 13],
               [{"name": "vae_name", "type": "COMBO", "widget": {"name": "vae_name"}, "link": None}]),
        loader(11, "CLIPLoader", "CLIPLoader(PE 专属 TE→[40].pe_clip)", [1063.4939685500644, 2015], [400, 130],
               [PE_CLIP_FILE, "qwen_image", "default"], [31],
               [{"name": "clip_name", "type": "COMBO", "widget": {"name": "clip_name"}, "link": None},
                {"name": "type", "type": "COMBO", "widget": {"name": "type"}, "link": None},
                {"name": "device", "type": "COMBO", "shape": 7, "widget": {"name": "device"}, "link": None}]),
        # 装配外露带(0928 PE 迁子图轮:PE 改写/画幅联动收进 [40],主图零 PE 件零联动件;
        # 0929 四块重画轮:[24] 自 (953.78,2325) 挪 (1700,2900)——旧位在①加载器框 x 区
        # 正下方(y 顶 2325 <①框底 2195 之外但②框上缘须罩 [27]@1650 起,①②必在 x 区
        # 交叠,唯一出路=[24] 右移出①x 区使②框 x0≥1700-30,与①框 x 间隙 176.5;新位
        # 在 [40] 左下方,[24]→[40] 线近竖直微右上行(左向线恒 0 保持),pos.x<40.x 合规)
        {
            "id": SUBJECT_ID, "type": "PrimitiveStringMultiline",
            "title": f"[{SUBJECT_ID}] 主体句(①层唯一手写位;默认=库人物型例一)",
            "pos": [1700, 2900], "size": [661, 200], "flags": {}, "order": 4, "mode": 0,
            "inputs": [],
            "outputs": [{"name": "STRING", "type": "STRING", "slot_index": 0, "links": [15]}],
            "properties": {"Node name for S&R": "PrimitiveStringMultiline"},
            "widgets_values": [types[0]["subject"]],
        },
        {
            "id": PREVIEW_ID, "type": "easy showAnything",
            "title": f"[{PREVIEW_ID}] 装配预览(接[40]「最终文本」输出=将进编码的最终文本;跑图前过目)",
            # 上袋净空走廊=VAE→[8] 长直线(下缘)与 [40] W/H→[5] 对角线(下缘)之间,
            # 高度 230→160 恰容(上下净距各 ~35px);est/线遮数值复核=自查 3c/3f 谓词
            "pos": [3050, 1650], "size": [500.300390625, 160], "flags": {}, "order": 6, "mode": 0,
            "inputs": [{"label": "输入任何", "name": "anything", "shape": 7, "type": "*", "link": 18}],
            "outputs": [{"name": "output", "type": "*", "links": None}],
            "properties": {"Node name for S&R": "easy showAnything"},
            "widgets_values": [""],
        },
        # 主链带(0929 并行化轮:[5] 空潜=LATENT 单源三扇出 [5]/[104]/[65]→[7]/[206]/[198];
        # 保持 3900 原位——W/H 直连线斜率决定 [27]@3100,1600 下缘 38px 净空,挪 3700 会反遮;
        # 宽高仍直连 [40] width/height)
        {
            "id": LATENT_ID, "type": "EmptyLatentImage",
            "title": f"[{LATENT_ID}] EmptyLatentImage(宽高直连 [{HOST_ID}] width/height 输出=联动开关后终值;面板 1024=摆设值不生效)",
            "pos": [3900, 1740], "size": [671.759375, 110], "flags": {}, "order": 8, "mode": 0,
            "inputs": [
                {"name": "width", "type": "INT", "widget": {"name": "width"}, "link": 1},
                {"name": "height", "type": "INT", "widget": {"name": "height"}, "link": 2},
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [5, 104, 65]}],
            "properties": {"Node name for S&R": "EmptyLatentImage"},
            "widgets_values": [1024, 1024, 1],
        },
        {
            "id": SAMPLER_ID, "type": "KSampler",
            "title": f"[{SAMPLER_ID}] KSampler(直出支路·40步·cfg1;model=[1] base 直连;"
                     f"seed←[{SEED_ID}] 共享单源(widget 转输入);面板 steps=真实生效值)",
            "pos": [5011.97707393495, 1740], "size": [754.7955078125, 262], "flags": {}, "order": 9, "mode": 0,
            "inputs": [
                {"name": "model", "type": "MODEL", "link": 105},
                {"name": "positive", "type": "CONDITIONING", "link": 16},
                {"name": "negative", "type": "CONDITIONING", "link": 17},
                {"name": "latent_image", "type": "LATENT", "link": 5},
                # seed 单源扇出(0929 并行化轮 widget 转输入;面板 seed 值=接线接管不生效)
                {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": 107},
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [9]}],
            "properties": {"Node name for S&R": "KSampler"},
            "widgets_values": [0, "fixed", STEPS_OFF, 1, "euler", "simple", 1],
        },
        {
            "id": 8, "type": "VAEDecode",
            "title": "[8] VAEDecode",
            "pos": [6986.474674780493, 1722.0313909766683], "size": [240, 50], "flags": {}, "order": 10, "mode": 0,
            "inputs": [
                {"name": "samples", "type": "LATENT", "link": 62},   # [208] 选择件输出(三支路汇流)
                {"name": "vae", "type": "VAE", "link": 10},   # VAE 直连([22]/[23] 顶通道对已删,link10 改指实靶)
            ],
            "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [11]}],
            "properties": {"Node name for S&R": "VAEDecode"},
        },
        {
            "id": 9, "type": "SaveImage",
            "title": "[9] SaveImage",
            "pos": [7440, 1748.2275778509459], "size": [700, 460],
            "flags": {}, "order": 11, "mode": 0,
            "inputs": [{"name": "images", "type": "IMAGE", "link": 11}],
            "outputs": [],
            "properties": {"Node name for S&R": "SaveImage"},
            "widgets_values": ["QI21道劫文生图_"],
        },
        {
            "id": 10, "type": "MarkdownNote",
            "title": "[10] 道劫·用法速查(装配子图版·0929 宿主面板简化轮)",
            # 0929 回灌:用户拖至 x=-561 负区→归一 x=80;900 宽卡片在 x=80 下与 [24]/
            # [30] est+矩形双重叠,y 自 2271.75 下移至 3500(零负区+零重叠铁律内最近合规位)
            "pos": [80, 3500], "size": [900, 1500], "flags": {}, "order": 12, "mode": 0,
            "inputs": [], "outputs": [],
            "properties": {},
            "widgets_values": [NOTE_TEXT],
        },
    ]

    # 宿主 [40](0929 用户手改回灌:外露输入槽 8→4——只留连线槽 clip/vae/主体句/pe_clip,
    # 型选择/RGBA透明开关/PE开关/画幅联动开关四控件从「输入槽外露」改回「面板控件」
    # (widgets_values 五值/PE开关默认 true=0926 裁定1 不变;子图内部 -10 IO 仍 8 槽);
    # 机械后果:link31 目标槽 6→3;序列化口径=K2 [90].base COMBO 实证)
    host_inputs = [
        {"name": "clip", "type": "CLIP", "link": 12},
        {"name": "vae", "type": "VAE", "link": 13},
        {"name": "主体句", "type": "STRING", "widget": {"name": "主体句"}, "link": 15},
        {"name": "pe_clip", "type": "CLIP", "link": 31},
    ]
    _wv = [types[0]["subject"], DEFAULT_TYPE, False, True, False]
    host = {
        "id": HOST_ID, "type": SG_UUID,
        "title": f"[{HOST_ID}] 装配子图(双击进入;PE改写/画幅联动在内,面板=型选择/RGBA/PE开关/画幅联动)",
        "pos": [2393.784928591911, 2161.1515445773366], "size": [571.1001953125, 480], "flags": {}, "order": 13, "mode": 0,
        "inputs": host_inputs,
        "outputs": [
            {"name": "positive", "type": "CONDITIONING", "links": [16, 101, 102]},
            {"name": "negative", "type": "CONDITIONING", "links": [17, 103]},
            {"name": "最终文本", "type": "STRING", "links": [18]},
            {"name": "width", "type": "INT", "links": [1]},
            {"name": "height", "type": "INT", "links": [2]},
        ],
        "properties": {"subgraph": SG_UUID, "previewExposures": []},
        "widgets_values": list(_wv),
        "widgets_values_named": {name: val for (name, _t), val in zip(WIDGET_INPUTS, _wv)},
    }
    nodes.append(host)


    # ── 加速区·并行三支路(0929 并行化轮;注入式开关农场十件已拆,见常量段历史锚)──
    # 三行纵叠(行距 720):行0 直出 [7]@y1740(在主链 nodes 段)/行1 viggle [31]+[206]@y2460/
    # 行2 Fun-Acc [198]@y3180;[207] seed 单源@(3950,2950)=[5] 右下方③框内(0929 四块
    # 重画自 3200,2900 挪——旧位咬合②框右尾,seed 归③口径);[208] 选择件@
    # 三支路汇流带右侧。[31] 窄卡 270 宽:让左区下行线的行1 带走廊——实测窗位
    # y2460-2590 带 x 走廊≈[3540,3862]([40].pos→[198])∪[3639,3862]([1]→[198])∪
    # [4030,4120]([207]seed→[7])∪[4569,5100]([40].neg/.pos→[206]+[5]→[206]/[198]),
    # [31] 落 [4250,4520] 净窗;数值复核=自查 3f/3g 谓词。
    nodes.append({
        "id": LORA_ID, "type": "LoraLoaderModelOnly",
        "title": f"[{LORA_ID}] LoraLoaderModelOnly(viggle v0.2 r256;支路1 专属·strength0.8,"
                 f"输出只喂 [{SAMPLER_VIGGLE_ID}])",
        "pos": [4250, 2460], "size": [270, 130], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": 97},
            {"name": "lora_name", "type": "COMBO", "widget": {"name": "lora_name"}, "link": None},
            {"name": "strength_model", "type": "FLOAT", "widget": {"name": "strength_model"}, "link": None},
        ],
        "outputs": [{"name": "MODEL", "type": "MODEL", "links": [24]}],
        "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
        "widgets_values": [LORA_FILE, 0.8],
    })
    nodes.append({
        "id": SAMPLER_VIGGLE_ID, "type": "KSampler",
        "title": f"[{SAMPLER_VIGGLE_ID}] KSampler(viggle支路·359步·cfg1;model=[{LORA_ID}] LoRA;"
                 f"seed←[{SEED_ID}] 共享单源(widget 转输入);面板 steps=真实生效值)",
        "pos": [5100, 2460], "size": [754.7955078125, 262], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": 24},
            {"name": "positive", "type": "CONDITIONING", "link": 101},
            {"name": "negative", "type": "CONDITIONING", "link": 103},
            {"name": "latent_image", "type": "LATENT", "link": 104},
            {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": 108},
        ],
        "outputs": [{"name": "LATENT", "type": "LATENT", "links": [68]}],
        "properties": {"Node name for S&R": "KSampler"},
        "widgets_values": [0, "fixed", STEPS_ON, 1, "euler", "simple", 1],
    })
    nodes.append({
        "id": T8_ID, "type": T8_CLASS,
        "title": f"[{T8_ID}] FunAccPDD4StepSampler(Fun-Acc支路·4步内置;model=[1] base 直连"
                 f"绝不吃 viggle LoRA;无负面槽;seed←[{SEED_ID}] 共享单源)",
        "pos": [5011.36759057362, 3180], "size": [818.51328125, 250], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": 106},          # [1] 直连(0929 并行化:不再经 MODEL 开关)
            {"name": "positive", "type": "CONDITIONING", "link": 102},
            {"name": "latent_image", "type": "LATENT", "link": 65},   # [5] 直连(与 [7]/[206] 同源)
            {"name": "model_file", "type": "COMBO", "widget": {"name": "model_file"}, "link": None},
            {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": 109},  # T8 seed 输入化(research/03 §4.1)
        ],
        "outputs": [{"name": "LATENT", "type": "LATENT", "links": [110]}],
        "properties": {"Node name for S&R": T8_CLASS},
        "widgets_values": [FUNACC_FILE, 0],
    })
    nodes.append({
        "id": SEED_ID, "type": "PrimitiveInt",
        "title": f"[{SEED_ID}] seed·三支路共享单源(默认0 fixed;扇出 [{SAMPLER_ID}]/"
                 f"[{SAMPLER_VIGGLE_ID}]/[{T8_ID}];改 seed 只动此一处)",
        # 0929 四块重画轮:自 (3200,2900) 挪 (3950,2950)——旧位 rect x[3200,3470] 咬合
        # ②框右尾(x 至 3580)=seed 归③口径违规;新位入③框([5] 右下方),三 seed 线
        # 出 (4220,2975):坐标枚举实测(机器同款 est/线遮/交叉判定)——[207]→[7]
        # 上行线须 x≥3950 才绕开 [31] 右下角(x=3900 时 link107 在 x4471-4522 带穿
        # [31] 盒 y2458-2592);定稿位全 CLEAN 且交叉守恒 67=棘轮零动;数值复核=
        # 自查 3f/3g 谓词
        "pos": [3950, 2950], "size": [270, 90], "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "value", "type": "INT", "widget": {"name": "value"}, "link": None}],
        "outputs": [{"name": "INT", "type": "INT", "links": [107, 108, 109]}],
        "properties": {"cnr_id": "comfy-core", "Node name for S&R": "PrimitiveInt"},
        "widgets_values": [0, "fixed"],
        "widgets_values_named": {"value": 0, "fixed": "fixed"},
    })
    # 单点选择件(方案 B=my_nodes 自研懒选择;combo 首项=默认=直出40步;三 latent 槽全
    # optional 全 lazy=未选支路零执行零加载;输出=选中支路 LATENT 原样直通→[8] 解码)
    nodes.append({
        "id": SPEED_SEL_ID, "type": "MyQi21SpeedSelect",
        "title": f"[{SPEED_SEL_ID}] 加速档位选择(MyQi21SpeedSelect:三支路 LATENT 汇流单点·"
                 f"combo 首项=默认直出40步;未选支路懒执行零加载)",
        "pos": [6300, 2460], "size": [380, 150], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "latent_funacc", "type": "LATENT", "shape": 7, "link": 110},
            {"name": "latent_viggle", "type": "LATENT", "shape": 7, "link": 68},
            {"name": "latent_direct", "type": "LATENT", "shape": 7, "link": 9},
        ],
        "outputs": [{"name": "latent", "type": "LATENT", "links": [62]}],
        "properties": {"Node name for S&R": "MyQi21SpeedSelect"},
        "widgets_values": [SPEED_DEFAULT_MODE],
    })
    # 顶缘通道 Reroute:0929 并行化轮 [203]([40].positive→T8 顶带拐点)随注入式机构
    # 拆除退役([40].positive 三扇出直连 [7]/[206]/[198],新布局下直连零线遮);[22]/[23]/
    # [199]/[200]/[201]/[202]/[204] 为历史锚件不在图
    for order, n in enumerate(nodes):
        n["order"] = order
    g["nodes"] = nodes

    g["links"] = [
        # 宿主外链(0928 PE 迁子图轮:PE 改写/画幅联动全在 [40] 内,主图只剩一进一出)
        [12, 2, 0, HOST_ID, 0, "CLIP"],           # 主 TE → [40].clip
        [13, 3, 0, HOST_ID, 1, "VAE"],            # VAE → [40].vae
        [15, SUBJECT_ID, 0, HOST_ID, 2, "STRING"],  # [24] 主体句 → [40].主体句
        [31, 11, 0, HOST_ID, 3, "CLIP"],          # PE 专属 TE → [40].pe_clip(0929 外露槽序=第4槽)
        [18, HOST_ID, 2, PREVIEW_ID, 0, "STRING"],   # [40].最终文本 → [27] 装配预览
        [1, HOST_ID, 3, LATENT_ID, 0, "INT"],      # [40].width(联动后终值) → [5].width 直连
        [2, HOST_ID, 4, LATENT_ID, 1, "INT"],      # [40].height → [5].height 直连
        # [40].positive 单源三扇出 / .negative 单源二扇出(T8 无负面槽;cfg=1 占位口径保留)
        [16, HOST_ID, 0, SAMPLER_ID, 1, "CONDITIONING"],         # → [7].positive(直出支路)
        [17, HOST_ID, 1, SAMPLER_ID, 2, "CONDITIONING"],         # → [7].negative(占位)
        [101, HOST_ID, 0, SAMPLER_VIGGLE_ID, 1, "CONDITIONING"], # → [206].positive(viggle 支路)
        [103, HOST_ID, 1, SAMPLER_VIGGLE_ID, 2, "CONDITIONING"], # → [206].negative(占位)
        [102, HOST_ID, 0, T8_ID, 1, "CONDITIONING"],             # → T8.positive(同源直连)
        # [5] 空潜单源三扇出(三支路同源;[199] 垫脚石 0928 先例=直连)
        [5, LATENT_ID, 0, SAMPLER_ID, 3, "LATENT"],
        [104, LATENT_ID, 0, SAMPLER_VIGGLE_ID, 3, "LATENT"],
        [65, LATENT_ID, 0, T8_ID, 2, "LATENT"],
        # [1] base MODEL 单源三扇出(支路2 T8 直连=绝不吃 viggle LoRA)
        [97, 1, 0, LORA_ID, 0, "MODEL"],              # [1] → [31] LoRA.model(支路1)
        [105, 1, 0, SAMPLER_ID, 0, "MODEL"],          # [1] → [7].model(支路0 直连)
        [106, 1, 0, T8_ID, 0, "MODEL"],               # [1] → T8.model(支路2 直连)
        [24, LORA_ID, 0, SAMPLER_VIGGLE_ID, 0, "MODEL"],  # LoRA → [206].model(支路1 唯一消费者)
        # [207] seed 单源三扇出(三采样器 seed 一律 widget→input 接线接管)
        [107, SEED_ID, 0, SAMPLER_ID, 4, "INT"],
        [108, SEED_ID, 0, SAMPLER_VIGGLE_ID, 4, "INT"],
        [109, SEED_ID, 0, T8_ID, 4, "INT"],
        # 三支路 LATENT 汇流 → 单点选择 → 解码(懒执行:未选支路不进执行图)
        [9, SAMPLER_ID, 0, SPEED_SEL_ID, 2, "LATENT"],          # [7] → latent_direct(支路0)
        [68, SAMPLER_VIGGLE_ID, 0, SPEED_SEL_ID, 1, "LATENT"],  # [206] → latent_viggle(支路1)
        [110, T8_ID, 0, SPEED_SEL_ID, 0, "LATENT"],             # [198] → latent_funacc(支路2)
        [62, SPEED_SEL_ID, 0, 8, 0, "LATENT"],                  # 选择件 → [8].samples(汇流)
        [11, 8, 0, 9, 0, "IMAGE"],
        # VAE 直连(0928 残留清创轮:[22]/[23] 顶通道对删,实测双不增;link10 保号改指实靶)
        [10, 3, 0, 8, 1, "VAE"],
    ]
    # id 计数器真值重算(根图+子图共享分配器,一并计入 max;计数器只抬不降)
    g["last_node_id"] = max(
        [g["last_node_id"]]
        + [n["id"] for n in g["nodes"]]
        + [n["id"] for sg_ in g["definitions"]["subgraphs"] for n in sg_["nodes"]])
    g["last_link_id"] = max(
        [g["last_link_id"]]
        + [l[0] for l in g["links"]]
        + [l["id"] for sg_ in g["definitions"]["subgraphs"] for l in sg_["links"]])
    return g


# ── 自查(与契约测试同口径谓词 + 子图契约铁律 + 干跑)───────────────
def self_check(g: dict, truth: dict) -> list[str]:
    errs: list[str] = []
    sg = g["definitions"]["subgraphs"][0]
    m_nodes = {n["id"]: n for n in g["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    i_links = {l["id"]: l for l in sg["links"]}

    # 1. 主图 link 双向一致 + 类型匹配
    for l in g["links"]:
        lid, oid, oslot, tid, tslot, typ = l
        origin, target = m_nodes[oid], m_nodes[tid]
        if typ != origin["outputs"][oslot]["type"]:
            errs.append(f"主图 link{lid}: origin 槽类型不匹配")
        if lid not in (origin["outputs"][oslot].get("links") or []):
            errs.append(f"主图 link{lid}: origin.outputs 未登记")
        if target["inputs"][tslot].get("link") != lid:
            errs.append(f"主图 link{lid}: target.inputs 不匹配")

    # 2. 子图 link 双向一致(对象格式;-10/-20 端点对照 IO 槽 linkIds)
    for l in sg["links"]:
        lid, oid, oslot, tid, tslot, typ = l["id"], l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"]
        if oid == -10:
            io = sg["inputs"][oslot]
            if lid not in io["linkIds"]:
                errs.append(f"子图 link{lid}: -10 槽{oslot}({io['name']}) linkIds 未登记(契约铁律)")
            if typ != io["type"]:
                errs.append(f"子图 link{lid}: -10 槽{oslot} 类型不匹配")
        else:
            origin = i_nodes[oid]
            if typ != origin["outputs"][oslot]["type"]:
                errs.append(f"子图 link{lid}: origin 槽类型不匹配")
            if lid not in (origin["outputs"][oslot].get("links") or []):
                errs.append(f"子图 link{lid}: origin.outputs 未登记")
        if tid == -20:
            io = sg["outputs"][tslot]
            if lid not in io["linkIds"]:
                errs.append(f"子图 link{lid}: -20 槽{tslot}({io['name']}) linkIds 未登记(契约铁律)")
        else:
            target = i_nodes[tid]
            if target["inputs"][tslot].get("link") != lid:
                errs.append(f"子图 link{lid}: target.inputs 不匹配")
    # linkIds 反向:IO 槽登记的每条线必须真实存在且端点正确
    for slot, io in enumerate(sg["inputs"]):
        for lid in io["linkIds"]:
            l = i_links.get(lid)
            if not l or l["origin_id"] != -10 or l["origin_slot"] != slot:
                errs.append(f"子图 inputs[{slot}]({io['name']}) linkIds[{lid}] 端点不实")
        if not io["linkIds"]:
            errs.append(f"子图 inputs[{slot}]({io['name']}) linkIds 为空(契约铁律)")
    for slot, io in enumerate(sg["outputs"]):
        for lid in io["linkIds"]:
            l = i_links.get(lid)
            if not l or l["target_id"] != -20 or l["target_slot"] != slot:
                errs.append(f"子图 outputs[{slot}]({io['name']}) linkIds[{lid}] 端点不实")
        if not io["linkIds"]:
            errs.append(f"子图 outputs[{slot}]({io['name']}) linkIds 为空(契约铁律)")

    # 3. 横向排版:主图每条连线 target.x > origin.x(0928 PE 迁子图轮:冻结回流线
    #    link34 随架构消灭,左向线恒 0——旧 W2 单点豁免退役,不再接受任何左向线)
    backward = [l[0] for l in g["links"]
                if not m_nodes[l[3]]["pos"][0] > m_nodes[l[1]]["pos"][0]]
    if backward:
        errs.append(f"主图左向线应恒 0(0928 PE 迁子图后冻结回流线已消灭),得 {sorted(backward)}")
    for l in sg["links"]:
        ox = sg["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 else i_nodes[l["origin_id"]]["pos"][0]
        tx = sg["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 else i_nodes[l["target_id"]]["pos"][0]
        if not tx > ox:
            errs.append(f"子图 link{l['id']}: 纵向塔违规")

    # 3b. 行排版:子图按 y 分行恰 6 行=四行流水(源/装配/PE改写/编码输出)+画幅联动
    #     蛇形两行(宽/高;0928 PE 迁子图轮);通道 Reroute 拐点不占行;行间净距≥100;
    #     行内 x 严格递增(数组序=数据流序)
    sg_rows: dict[int, list[int]] = {}
    for n in sg["nodes"]:
        if n["type"] == "Reroute":
            continue  # 通道拐点不占阶段行
        sg_rows.setdefault(n["pos"][1], []).append(n["id"])
    row_ys = sorted(sg_rows)
    want_rows = [
        [BASE_ID, LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID],
        [CONCAT1_ID, CONCAT2_ID, RGBA_CAT1_ID, RGBA_CAT2_ID],
        [PE_RW_ID, PE_SW_ID],
        [TE_RGBA_ID, TE_ID, RGBA_SW_ID],
        [RATIO_RW_ID, CONV_RW_ID, MATH_W_ID, SW_W_ID],
        [RATIO_RH_ID, CONV_RH_ID, MATH_H_ID, SW_H_ID],
    ]
    if len(row_ys) != 6:
        errs.append(f"子图应恰 6 行(四行流水+联动蛇形两行),得 {len(row_ys)} 行")
    for y, want in zip(row_ys, want_rows):
        if sorted(sg_rows[y]) != sorted(want):
            errs.append(f"子图行 y={y} 成员漂移: 应 {sorted(want)} 得 {sorted(sg_rows[y])}")
        xs = [i_nodes[nid]["pos"][0] for nid in sg_rows[y]]  # 数组序=数据流序
        if any(b <= a for a, b in zip(xs, xs[1:])):
            errs.append(f"子图行 y={y} 行内 x 非严格递增(行内应从左到右)")
    for y, next_y in zip(row_ys, row_ys[1:]):
        bottom = y + max(i_nodes[nid]["size"][1] for nid in sg_rows[y])
        if next_y - bottom < 100:
            errs.append(f"子图行距不足: 行 y={y} 底 {bottom} 与下行 y={next_y} 净距 <100")
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for i in range(len(scope_nodes)):
            for j in range(i + 1, len(scope_nodes)):
                a, b = scope_nodes[i], scope_nodes[j]
                if (a["pos"][0] < b["pos"][0] + b["size"][0] and b["pos"][0] < a["pos"][0] + a["size"][0]
                        and a["pos"][1] < b["pos"][1] + b["size"][1] and b["pos"][1] < a["pos"][1] + a["size"][1]):
                    errs.append(f"{scope} node{a['id']} 与 node{b['id']} 矩形重叠")
    # 3c. 间距阈值(0925 布局美化轮,est 足迹口径):同行横净距≥200 / 同列纵净距≥80;
    #     Reroute 通道件与 MarkdownNote 说明卡豁免;全图(含豁免件)est 盒零重叠。
    def _est_box(n: dict):
        x, y = float(n["pos"][0]), float(n["pos"][1])
        w = max(250.0, float(n["size"][0]))
        rows = max(len(n.get("inputs", [])), len(n.get("outputs", [])))
        h = max(36 + 24 * rows + 30 * len(n.get("widgets_values") or []) + 28, float(n["size"][1]))
        return x, y, x + w, y + h

    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        boxes = [(n["id"], _est_box(n)) for n in scope_nodes]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                (ida, (ax0, ay0, ax1, ay1)), (idb, (bx0, by0, bx1, by1)) = boxes[i], boxes[j]
                if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                    errs.append(f"{scope} node{ida} 与 node{idb} est 足迹重叠(inspect 口径)")
        real = [(n["id"], _est_box(n)) for n in scope_nodes
                if n["type"] not in ("Reroute", "MarkdownNote")]
        for i in range(len(real)):
            for j in range(i + 1, len(real)):
                (ida, (ax0, ay0, ax1, ay1)), (idb, (bx0, by0, bx1, by1)) = real[i], real[j]
                yov = min(ay1, by1) - max(ay0, by0)
                xov = min(ax1, bx1) - max(ax0, bx0)
                if yov > 0 and xov <= 0 and -(xov) < 200:
                    errs.append(f"{scope} node{ida} 与 node{idb} 同行横距 {-(xov):.0f} <200(0925 间距令)")
                elif xov > 0 and yov <= 0 and -(yov) < 80:
                    errs.append(f"{scope} node{ida} 与 node{idb} 同列纵距 {-(yov):.0f} <80(0925 间距令)")

    # 3d. 零负区(0925 W6①;0926 收紧 pos≥40→≥80=实测发现项3 计划断言互锁):
    #     主图+子图所有节点 pos≥80,整图平移至左上留边距,打开即全貌
    #     (子图 IO 槽非节点,负 x 表示法=K2 [90] 同款,豁免)
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for n in scope_nodes:
            if n["pos"][0] < 80 or n["pos"][1] < 80:
                errs.append(f"{scope} node{n['id']} 负区坐标 {n['pos']}(零负区:pos≥80)")

    # 3e. 输出口最右(0925 W6②):子图输出 IO 槽钉死最右列(表示法=K2 [90] 实证:
    #     输出槽 x 超过全子图最右节点,纵向堆叠)
    max_nx = max(n["pos"][0] for n in sg["nodes"])
    for io in sg["outputs"]:
        if io["pos"][0] < max_nx - 50:
            errs.append(f"子图输出 {io['name']} 未钉最右列(x={io['pos'][0]} < 全子图最大 x{max_nx}-50)")

    # 3f. 零线遮节点(0926 铁律:工作流的美化只管位置,线与节点不得彼此遮盖):
    #     判定=三次贝塞尔 41 点采样——P0=输出槽(节点右缘,top+25+origin_slot×20)、
    #     P3=输入槽(左缘,top+25+target_slot×20),控制点 P1=(P0.x+k,P0.y)/
    #     P2=(P3.x−k,P3.y),k=clamp(|dx|/2,40,200);节点盒=普通节点 size(缺省
    #     [220,120])/Reroute 60×30;任采样点落入非端点节点盒(±2 容差)即遮挡,
    #     端点豁免;-10/-20 边界线无节点盒端点,与验收器同口径跳过(主图+子图同判)。
    def _occl_box(n: dict):
        w, h = (60, 30) if n["type"] == "Reroute" else (n.get("size") or [220, 120])[:2]
        x, y = n["pos"][0], n["pos"][1]
        return x, y, x + w, y + h

    def _occl_slot(n: dict, s: int, side: str):
        x, y, x2, _ = _occl_box(n)
        sy = y + 25 + (s or 0) * 20
        return (x2, sy) if side == "out" else (x, sy)

    def _bez(p0, p1, p2, p3, t):
        mt = 1 - t
        return (mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1])

    for scope, scope_nodes, scope_links in (
            ("主图", g["nodes"], [[l[0], l[1], l[2], l[3], l[4]] for l in g["links"]]),
            ("子图", sg["nodes"], [[l["id"], l["origin_id"], l["origin_slot"],
                                    l["target_id"], l["target_slot"]] for l in sg["links"]])):
        byid = {n["id"]: n for n in scope_nodes}
        for lid, oid, oslot, tid, tslot in scope_links:
            o, t = byid.get(oid), byid.get(tid)
            if not o or not t:
                continue   # -10/-20 边界线(无节点盒端点),与验收器同口径跳过
            p0, p3 = _occl_slot(o, oslot, "out"), _occl_slot(t, tslot, "in")
            k = max(40, min(200, abs(p3[0] - p0[0]) * 0.5))
            p1, p2 = (p0[0] + k, p0[1]), (p3[0] - k, p3[1])
            hit = set()
            for i in range(41):
                x, y = _bez(p0, p1, p2, p3, i / 40)
                for nid, n in byid.items():
                    if nid in (oid, tid):
                        continue   # 端点豁免
                    bx = _occl_box(n)
                    if bx[0] - 2 <= x <= bx[2] + 2 and bx[1] - 2 <= y <= bx[3] + 2:
                        hit.add(nid)
            if hit:
                errs.append(f"{scope} link{lid} [{oid}]->[{tid}] 线遮节点 {sorted(hit)}"
                            f"(0926 铁律:线不遮节点;挪位或按通道约定垫 Reroute)")

    # 3g. 交叉不增封顶(0928 用户裁定:「线不交叉的规则大于分组的规则」,入宪
    #     docs/comfyui-kb/画布布局规范-0928.md):主图+子图同口径;口径=同款贝塞尔
    #     24 点采样线段两两求交,每对线至多计 1 次;-10/-20 边界线跳过。
    #     **现值封顶起步防回归**,治理轮逐步拧紧至 0(单向棘轮,只降不升);
    #     优先级:交叉 > 组框美观——消交叉可打破组框单行/罩盖约束(契约随行同步)。
    #     0928 重布局先锋轮(t2i):主 78→60 / 子 7→5;0928 PE 迁子图轮:主 39→26
    #     (删 PE/联动 13 件稀疏化),子 5→7(节点迁入上升属预期,以新实测值重立);
    #     0928 残留清创轮:主 26 持平;**0929 用户手改回灌轮重立:主 26→37 / 子 7→8**。
    #     **0929 加速区并行化轮重立:主 37→67 / 子 8 持平**(拓扑手术=注入式十件拆三支路,
    #     design §8「拓扑变更→按 0928 棘轮重立基线」;结构成因=复用铁则单源扇出
    #     ([1]/[40]/[5]/[207] 各恰一节点)×三支路纵叠,4 源×3 行的长线扇在几何上必然
    #     互交——热区实测=link106 [1]→[198](11)/link17/101/103([40]→KSampler 系,各 10);
    #     源位置对倒实验([40] 挪 row0 带等)总数守恒 ~67=交叉随扇出重分布非坐标可消,
    #     属并行拓扑本体;消交叉须打破单源扇出或支路纵叠=违复用铁则/横向排版铁律,
    #     不可。以实测值 67 重立封顶防回归,主图方向后续只收紧;子图零动基线不动。)
    _CROSS_BASELINE = {'主图': 67, '子图': 8}
    def _cross_seg_int(a, b, c, d):
        def _cr(o, x, y):
            return (y[0] - o[0]) * (x[1] - o[1]) - (y[1] - o[1]) * (x[0] - o[0])
        d1, d2, d3, d4 = _cr(c, d, a), _cr(c, d, b), _cr(a, b, c), _cr(a, b, d)
        return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))

    for _scope, _nodes, _links in (("主图", g["nodes"], [[l[0], l[1], l[2], l[3], l[4]] for l in g["links"]]),
            ("子图", sg["nodes"], [[l["id"], l["origin_id"], l["origin_slot"],
                                    l["target_id"], l["target_slot"]] for l in sg["links"]])):
        _byid = {n["id"]: n for n in _nodes}
        _wires = []
        for _l in _links:
            _oid, _os, _tid, _ts = _l[1], _l[2], _l[3], _l[4]
            _o, _t = _byid.get(_oid), _byid.get(_tid)
            if not _o or not _t:
                continue
            _p0 = _occl_slot(_o, _os, "out")
            _p3 = _occl_slot(_t, _ts, "in")
            _k = max(40, min(200, abs(_p3[0] - _p0[0]) * 0.5))
            _p1, _p2 = (_p0[0] + _k, _p0[1]), (_p3[0] - _k, _p3[1])
            _wires.append([_bez(_p0, _p1, _p2, _p3, i / 23) for i in range(24)])
        _cnt = 0
        for _i in range(len(_wires)):
            _a = _wires[_i]
            for _j in range(_i + 1, len(_wires)):
                _b = _wires[_j]
                _hit = False
                for _k2 in range(len(_a) - 1):
                    for _m in range(len(_b) - 1):
                        if _cross_seg_int(_a[_k2], _a[_k2 + 1], _b[_m], _b[_m + 1]):
                            _cnt += 1; _hit = True; break
                    if _hit:
                        break
        if _cnt > _CROSS_BASELINE[_scope]:
            errs.append(f"{_scope} 线-线交叉 {_cnt} 对超封顶 {_CROSS_BASELINE[_scope]}"
                        f"(0928 裁定:线不交叉>分组;挪线/并线/垫 Reroute 消交叉)")

    if len(sg["groups"]) > 4:
        errs.append(f"子图 group 预算超限(≤4),得 {len(sg['groups'])}")
    if len(g["groups"]) > 4:
        errs.append(f"主图 group 预算超限(≤4,0929 四块重画=①加载器/②提示词装配/③加速区/④输出),"
                    f"得 {len(g['groups'])}")
    # 3h. 四块组框口径(0929 四块重画轮;此前主图框无两两不相交/零裸奔谓词=旧主链×
    #     加速区在 [7] 直出行交叠无门禁,本谓词补机器闸):主图框两两 bbox 零交集 +
    #     非白名单(MarkdownNote 用法速查等纯说明件)节点矩形完全落入至少一框 +
    #     四块成员恰好(矩形完全落入口径;宅基律 pad=L30/T50/R30/B50 实测沿用)——
    #       块①加载器=[1]/[3]/[2]/[11](双TE 自旧装配外露框迁入)
    #       块②提示词·装配=[24]/[40]/[27]
    #       块③加速区=[5]/[7]/[31]/[206]/[198]/[208]/[207](空潜+三支路+选择+seed 单源)
    #       块④输出=[8]/[9]
    def _grp_rect(grp: dict):
        bx, by, bw, bh = grp["bounding"]
        return bx, by, bx + bw, by + bh

    _main_boxes = [(i, _grp_rect(grp)) for i, grp in enumerate(g["groups"])]
    for _i in range(len(_main_boxes)):
        for _j in range(_i + 1, len(_main_boxes)):
            (ia, (ax0, ay0, ax1, ay1)), (ib, (bx0, by0, bx1, by1)) = _main_boxes[_i], _main_boxes[_j]
            if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                errs.append(f"主图 group 框 {ia} 与 {ib} 相交(0929 四块口径:两两 bbox 零交集)")
    _naked = sorted(n["id"] for n in g["nodes"]
                    if n["type"] != "MarkdownNote"
                    and not any(gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                                and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1
                                for gx0, gy0, gx1, gy1 in (_grp_rect(x) for x in g["groups"])))
    if _naked:
        errs.append(f"主图节点裸奔无组 {_naked}(0929 四块口径:非说明件必须完全落入至少一框)")
    _four_blocks = {
        "道劫·①加载器": [1, 3, 2, 11],
        "道劫·②提示词": [SUBJECT_ID, HOST_ID, PREVIEW_ID],
        "道劫·加速区": [LATENT_ID, SAMPLER_ID, LORA_ID, SAMPLER_VIGGLE_ID,
                        T8_ID, SPEED_SEL_ID, SEED_ID],
        "道劫·④输出": [8, 9],
    }
    for _prefix, _want in _four_blocks.items():
        _grp = next((x for x in g["groups"] if x["title"].startswith(_prefix)), None)
        if _grp is None:
            errs.append(f"四块口径缺 {_prefix!r} 组框(0929 四块重画)")
            continue
        gx0, gy0, gx1, gy1 = _grp_rect(_grp)
        _got = sorted(n["id"] for n in g["nodes"]
                      if n["type"] != "MarkdownNote"
                      and gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                      and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1)
        if _got != sorted(_want):
            errs.append(f"四块 {_prefix!r} 成员漂移: 应 {sorted(_want)} 得 {_got}")
    sg_boxes = [(grp["bounding"][0], grp["bounding"][1],
                 grp["bounding"][0] + grp["bounding"][2],
                 grp["bounding"][1] + grp["bounding"][3]) for grp in sg["groups"]]
    for i in range(len(sg_boxes)):
        for j in range(i + 1, len(sg_boxes)):
            if (sg_boxes[i][0] < sg_boxes[j][2] and sg_boxes[j][0] < sg_boxes[i][2]
                    and sg_boxes[i][1] < sg_boxes[j][3] and sg_boxes[j][1] < sg_boxes[i][3]):
                errs.append(f"子图 group 框 {i} 与 {j} 相交")
    for grp in sg["groups"]:
        gx0, gy0 = grp["bounding"][0], grp["bounding"][1]
        gx1, gy1 = gx0 + grp["bounding"][2], gy0 + grp["bounding"][3]
        inside = [n for n in sg["nodes"] if n["type"] != "Reroute"
                  if gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                  and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1]
        if not inside:
            errs.append(f"子图 group {grp['title']!r} 未框住任何节点(装饰框即病)")
        if len({n["pos"][1] for n in inside}) != 1:
            errs.append(f"子图 group {grp['title']!r} 跨行框住节点(应只框单一阶段行)")
        row_y = inside[0]["pos"][1] if inside else None
        row_all = [n["id"] for n in sg["nodes"] if n["pos"][1] == row_y]
        if sorted(n["id"] for n in inside) != sorted(row_all):
            errs.append(f"子图 group {grp['title']!r} 应框住其阶段行全部节点")

    # 4. group 全 int id + 标题字号(节点标题零道劫=0925 归位裁定)+ W1 加速区组框在位
    for scope, groups in (("主图", g["groups"]), ("子图", sg["groups"])):
        if not groups:
            errs.append(f"{scope}分组为空")
        for grp in groups:
            if not isinstance(grp.get("id"), int):
                errs.append(f"{scope} group {grp.get('title')!r} id 非 int")
    for grp in g["groups"]:
        if "道劫" not in grp["title"]:
            errs.append(f"主图 group {grp['title']!r} 缺道劫字号")
    if "道劫" not in sg["name"]:
        errs.append("子图 name 缺道劫字号")
    for n in g["nodes"]:
        if n["type"] == "MarkdownNote":
            if "道劫" not in (n.get("title") or ""):
                errs.append(f"主图 node{n['id']} 说明卡标题缺道劫字号(工作流级说明件保留道劫)")
        elif n["type"] != "Reroute" and "道劫" in (n.get("title") or ""):
            errs.append(f"主图 node{n['id']} 标题含道劫前缀(0925 归位:节点标题零道劫): {n.get('title')!r}")
    for n in sg["nodes"]:
        if n["type"] != "MarkdownNote" and "道劫" in (n.get("title") or ""):
            errs.append(f"子图 node{n['id']} 标题含道劫前缀(0925 归位:节点标题零道劫): {n.get('title')!r}")
    # W1 加速区组框(0929 四块重画轮=块③):标题带「加速区·并行」(契约 6d2 startswith
    # 「道劫·加速区」+三支路/并行子串双兼容,序号③入括号不断锚)且罩空潜[5]+三支路
    # [7](直出)/[31]+[206](viggle)/[198](Fun-Acc)+选择件[208]+seed单源[207]——
    # 旧口径「seed/空潜留框外」随四块重画退役(硬约束2 非Note零裸奔:共享源必须入框)
    accel_ids = [LATENT_ID, SAMPLER_ID, LORA_ID, SAMPLER_VIGGLE_ID, T8_ID, SPEED_SEL_ID, SEED_ID]
    accel_grp = next((grp for grp in g["groups"] if "加速区·并行" in grp["title"]), None)
    if accel_grp is None:
        errs.append("W1 缺「加速区·并行」组框(0929 四块重画=块③:罩空潜+三支路+选择件+seed)")
    else:
        gx0, gy0 = accel_grp["bounding"][0], accel_grp["bounding"][1]
        gx1 = gx0 + accel_grp["bounding"][2]
        gy1 = gy0 + accel_grp["bounding"][3]
        for nid in accel_ids:
            n = m_nodes[nid]
            if not (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                    and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1):
                errs.append(f"W1 加速区组框未罩住 [{nid}](0929 并行化:罩三支路+选择件)")

    # 5. 宿主结构:type/properties.subgraph=uuid;外露输入槽=连线槽子集(0929 用户手改
    #    回灌:8→4——型选择/RGBA透明开关/PE开关/画幅联动开关四控件改回「面板控件」,
    #    不再占输入槽;子图内部 inputs 仍 8 槽零动);外露槽与子图同名槽名+型对齐且
    #    全部有连线;面板五控件值经 widgets_values(WIDGET_INPUTS 序)钉死
    host = m_nodes[HOST_ID]
    if host["type"] != SG_UUID or host["properties"].get("subgraph") != SG_UUID:
        errs.append("[40] 宿主 type/properties.subgraph 与子图 uuid 不一致")
    want_exposed = ["clip", "vae", "主体句", "pe_clip"]
    got_exposed = [i["name"] for i in host["inputs"]]
    if got_exposed != want_exposed:
        errs.append(f"[40] 宿主外露输入槽应为 {want_exposed}(0929 面板控件机制:四控件回面板"
                    f"不占槽),得 {got_exposed}")
    sg_by_name = {s["name"]: s for s in sg["inputs"]}
    for hi in host["inputs"]:
        si = sg_by_name.get(hi["name"])
        if si is None or hi["type"] != si["type"]:
            errs.append(f"[40] 宿主外露槽 {hi['name']!r} 与子图同名槽不对齐(名+型)")
        if hi.get("link") is None:
            errs.append(f"[40] 宿主外露槽 {hi['name']!r} 应有连线(未连线控件应留面板,不占槽)")
    if len(sg["inputs"]) != 8 or len(sg["outputs"]) != 5:
        errs.append("[40] 子图内部 IO 应仍 8 入 5 出(0929 只动宿主外露,子图 -10/-20 槽零动)")
    if host["widgets_values"] != [truth["types"][0]["subject"], DEFAULT_TYPE, False, True, False]:
        errs.append("[40] 宿主 widgets_values 应=[人物例一主体句, 人物, False, True, False]"
                    "(面板五控件:型选择默认人物/RGBA 关/PE开关默认开=0926 裁定1/画幅联动默认关)")

    # 6. 外部接线(0928 PE 迁子图轮+0929 并行化轮):加载器/主体句/PE 专属 TE→宿主;宿主五出
    #    (positive 三扇出/negative 二扇出/最终文本/width/height);三支路单源扇出+汇流选择
    ext_want = [
        (12, 2, 0, HOST_ID, 0, "CLIP"), (13, 3, 0, HOST_ID, 1, "VAE"),
        (15, SUBJECT_ID, 0, HOST_ID, 2, "STRING"),
        (31, 11, 0, HOST_ID, 3, "CLIP"),   # PE 专属 TE → [40].pe_clip(0929 外露槽序 4 槽制)
        (16, HOST_ID, 0, SAMPLER_ID, 1, "CONDITIONING"), (17, HOST_ID, 1, SAMPLER_ID, 2, "CONDITIONING"),
        (18, HOST_ID, 2, PREVIEW_ID, 0, "STRING"),   # [40].最终文本 → [27] 装配预览
        (1, HOST_ID, 3, LATENT_ID, 0, "INT"), (2, HOST_ID, 4, LATENT_ID, 1, "INT"),  # W/H 直驱 [5]
        # 0929 并行化:positive 三扇出/negative 二扇出(T8 无负面槽)/latent 三扇出/MODEL 三扇出
        (101, HOST_ID, 0, SAMPLER_VIGGLE_ID, 1, "CONDITIONING"),
        (103, HOST_ID, 1, SAMPLER_VIGGLE_ID, 2, "CONDITIONING"),
        (102, HOST_ID, 0, T8_ID, 1, "CONDITIONING"),
        (5, LATENT_ID, 0, SAMPLER_ID, 3, "LATENT"),
        (104, LATENT_ID, 0, SAMPLER_VIGGLE_ID, 3, "LATENT"),
        (65, LATENT_ID, 0, T8_ID, 2, "LATENT"),
        (97, 1, 0, LORA_ID, 0, "MODEL"), (105, 1, 0, SAMPLER_ID, 0, "MODEL"),
        (106, 1, 0, T8_ID, 0, "MODEL"), (24, LORA_ID, 0, SAMPLER_VIGGLE_ID, 0, "MODEL"),
        (107, SEED_ID, 0, SAMPLER_ID, 4, "INT"), (108, SEED_ID, 0, SAMPLER_VIGGLE_ID, 4, "INT"),
        (109, SEED_ID, 0, T8_ID, 4, "INT"),
        (9, SAMPLER_ID, 0, SPEED_SEL_ID, 2, "LATENT"),
        (68, SAMPLER_VIGGLE_ID, 0, SPEED_SEL_ID, 1, "LATENT"),
        (110, T8_ID, 0, SPEED_SEL_ID, 0, "LATENT"),
        (62, SPEED_SEL_ID, 0, 8, 0, "LATENT"),
        (10, 3, 0, 8, 1, "VAE"),   # VAE 直连(顶通道对 [22]/[23] 0928 残留清创轮已删)
    ]
    got = {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in g["links"]}
    for w in ext_want:
        if w not in got:
            errs.append(f"外部接线缺: link{w[0]} {[x for x in w[1:]]}")
    for banned in ("ResolutionSelector", "TextEncodeQwenImage21",
                   "StringConstant", "StringConcatenate"):
        if any(n["type"] == banned for n in g["nodes"]):
            errs.append(f"主图不应有平铺 {banned}(装配核心已收进子图/分辨率已随型直驱)")
    # 0928 W2 反转:PE 链在子图内、主图零 PE 件;主图联动件零残留
    pe_mains = [n for n in g["nodes"] if n["type"] == "QwenImage21_T2IPromptRewrite"]
    if pe_mains:
        errs.append(f"0928 PE 迁子图:主图应零 QwenImage21_T2IPromptRewrite(PE 链已收进 [40] 子图),"
                    f"得 {[n['id'] for n in pe_mains]}")
    pe_subs = [n for n in sg["nodes"] if n["type"] == "QwenImage21_T2IPromptRewrite"]
    if len(pe_subs) != 1 or pe_subs[0]["id"] != PE_RW_ID:
        errs.append(f"0928 PE 迁子图:子图应恰 1 个 QwenImage21_T2IPromptRewrite[{PE_RW_ID}],"
                    f"得 {[n['id'] for n in pe_subs]}")
    for banned_link_type in ("RegexExtract", "ComfyNumberConvert", "ComfyMathExpression",
                             "PrimitiveBoolean"):
        if any(n["type"] == banned_link_type for n in g["nodes"]):
            errs.append(f"0928 PE 迁子图:主图应零 {banned_link_type}(画幅联动已收进 [40] 子图)")

    # 6b. 加速区并行三支路+MyQi21SpeedSelect 单选择(0929 并行化轮,方案 B):
    #     拆净断言=主图零选择类逻辑件+旧注入式十件 id 全不在图;并行断言=三采样器步数
    #     回归 widget 生效值/T8 model=[1] 直连(绝不吃 LoRA)/seed 单源三扇出/选择件
    #     combo 首项=直出40步=默认+三 latent 槽接线+输出→[8]。
    for banned in ("ComfySwitchNode", "easy compare", "PrimitiveBoolean"):
        if any(n["type"] == banned for n in g["nodes"]):
            errs.append(f"0929 并行化:主图应零 {banned}(注入式开关农场已拆,选择点唯 MyQi21SpeedSelect)")
    for gone in (30, 32, 177, 178, 179, 193, 194, 195, 196, 197):
        if gone in m_nodes:
            errs.append(f"0929 并行化:旧注入式件 [{gone}] 应已拆除(件不在图)")
    loras = [n for n in g["nodes"] if n["type"] == "LoraLoaderModelOnly"]
    if len(loras) != 1 or loras[0]["id"] != LORA_ID:
        errs.append(f"LoraLoaderModelOnly[{LORA_ID}] 应恰 1 个(支路1 viggle 专属)")
    else:
        if loras[0]["widgets_values"] != [LORA_FILE, 0.8]:
            errs.append(f"LoRA 槽 name/strength 漂移: {loras[0]['widgets_values']}")
        if _trace_reroute_main(m_links, m_nodes, loras[0]["inputs"][0]["link"]) != 1:
            errs.append("LoRA 槽 model 上游应 UNETLoader[1](可穿顶通道 Reroute)")
        if sorted(loras[0]["outputs"][0]["links"] or []) != [24]:
            errs.append(f"[{LORA_ID}] LoRA 输出应扇出恰一线(只喂 [{SAMPLER_VIGGLE_ID}],单源不复用消歧)")
    # 两 KSampler:steps=面板生效值(R6);seed=widget 转输入接单源;cfg/euler/simple/denoise 照抄
    for sid, want_steps, model_want in ((SAMPLER_ID, STEPS_OFF, 1), (SAMPLER_VIGGLE_ID, STEPS_ON, LORA_ID)):
        ks = m_nodes[sid]
        if ks["type"] != "KSampler":
            errs.append(f"[{sid}] 应为 KSampler(并行支路采样器)")
            continue
        wv = ks["widgets_values"]
        if wv[2] != want_steps:
            errs.append(f"[{sid}] KSampler steps 应={want_steps}(面板生效值,0929 并行化:步数回归 widget),得 {wv[2]}")
        if wv[1] != "fixed" or wv[3] != 1 or wv[4] != "euler" or wv[5] != "simple" or wv[6] != 1:
            errs.append(f"[{sid}] KSampler seed控制/cfg/sampler/scheduler/denoise 漂移"
                        f"(应 fixed/1/euler/simple/1 照抄现值),得 {wv}")
        if any(i.get("name") == "steps" for i in ks["inputs"]):
            errs.append(f"[{sid}] steps 应为纯 widget(0929 并行化:steps 联动开关已拆,面板值即生效值)")
        seed_inp = next((i for i in ks["inputs"] if i.get("name") == "seed"), None)
        if not seed_inp or "widget" not in seed_inp or seed_inp.get("link") is None:
            errs.append(f"[{sid}] seed 应为 widget 转输入接 [{SEED_ID}] 单源(序列化照 [5].width 先例)")
        elif _trace_reroute_main(m_links, m_nodes, seed_inp["link"]) != SEED_ID:
            errs.append(f"[{sid}] seed 上游应 [{SEED_ID}] 共享单源(可穿 Reroute)")
        if _trace_reroute_main(m_links, m_nodes, ks["inputs"][0]["link"]) != model_want:
            errs.append(f"[{sid}] model 上游应 [{model_want}](支路0=[1] base 直连/支路1=LoRA 链,可穿 Reroute)")
        if _trace_reroute_main(m_links, m_nodes, ks["inputs"][1]["link"]) != HOST_ID:
            errs.append(f"[{sid}] positive 上游应 [{HOST_ID}].positive(三支路同源)")
        if _trace_reroute_main(m_links, m_nodes, ks["inputs"][2]["link"]) != HOST_ID:
            errs.append(f"[{sid}] negative 上游应 [{HOST_ID}].negative(cfg=1 占位口径)")
        if _trace_reroute_main(m_links, m_nodes, ks["inputs"][3]["link"]) != LATENT_ID:
            errs.append(f"[{sid}] latent_image 上游应 [{LATENT_ID}] 空潜(三支路同源)")
    ks_count = [n for n in g["nodes"] if n["type"] == "KSampler"]
    if len(ks_count) != 2:
        errs.append(f"主图 KSampler 应恰 2 个([{SAMPLER_ID}]直出40步/[{SAMPLER_VIGGLE_ID}]viggle359步),"
                    f"得 {[n['id'] for n in ks_count]}")
    # seed 单源(主图 PrimitiveInt 恰 1 个=旧档位/steps/比较常量全拆;扇出恰三线到三采样器 seed 槽)
    pb_ints = [n for n in g["nodes"] if n["type"] == "PrimitiveInt"]
    if sorted(n["id"] for n in pb_ints) != [SEED_ID]:
        errs.append(f"主图 PrimitiveInt 应恰 1 个=[{SEED_ID}] seed 单源(旧档位/steps/比较常量已拆),"
                    f"得 {[n['id'] for n in pb_ints]}")
    seed_node = m_nodes[SEED_ID]
    if seed_node["widgets_values"][:2] != [0, "fixed"]:
        errs.append(f"[{SEED_ID}] seed 单源应默认 0 fixed(三支路共享可复现),得 {seed_node['widgets_values']}")
    seed_targets = sorted((m_links[l][3], m_links[l][4]) for l in seed_node["outputs"][0]["links"])
    if seed_targets != sorted([(SAMPLER_ID, 4), (SAMPLER_VIGGLE_ID, 4), (T8_ID, 4)]):
        errs.append(f"[{SEED_ID}] seed 应扇出恰三线到三采样器 seed 槽,得 {seed_targets}")
    # T8(支路2):model=[1] 直连;无负面槽;seed 输入化;positive/latent 与 KSampler 同源
    t8 = m_nodes[T8_ID]
    if t8["type"] != T8_CLASS:
        errs.append(f"[{T8_ID}] 应为 {T8_CLASS}(Fun-Acc PDD 采样器)")
    if t8["widgets_values"] != [FUNACC_FILE, 0]:
        errs.append(f"[{T8_ID}] model_file/seed 漂移(应 {FUNACC_FILE}/seed 接线接管前值 0),得 {t8.get('widgets_values')}")
    if len([i for i in t8["inputs"] if i.get("name") == "negative"]) != 0:
        errs.append(f"[{T8_ID}] T8 无负面槽(输入仅 model/positive/latent_image/model_file/seed)")
    if _trace_reroute_main(m_links, m_nodes, t8["inputs"][0]["link"]) != 1:
        errs.append(f"[{T8_ID}] model 上游应 UNETLoader[1] base 直连(绝不吃 viggle LoRA;可穿 Reroute)")
    if _trace_reroute_main(m_links, m_nodes, t8["inputs"][1]["link"]) != HOST_ID:
        errs.append(f"[{T8_ID}] positive 上游应 [{HOST_ID}].positive(与 KSampler 同源,可穿垫脚石)")
    if _trace_reroute_main(m_links, m_nodes, t8["inputs"][2]["link"]) != LATENT_ID:
        errs.append(f"[{T8_ID}] latent_image 上游应 [{LATENT_ID}] 空潜(与 KSampler 同源,可穿垫脚石)")
    t8_seed = next((i for i in t8["inputs"] if i.get("name") == "seed"), None)
    if not t8_seed or "widget" not in t8_seed or t8_seed.get("link") is None:
        errs.append(f"[{T8_ID}] T8 seed 应 widget→input 接 [{SEED_ID}](research/03 §4.1 输入化实证)")
    t8s = [n for n in g["nodes"] if n["type"] == T8_CLASS]
    if len(t8s) != 1:
        errs.append(f"{T8_CLASS} 应恰 1 个(支路2),得 {[n['id'] for n in t8s]}")
    # MyQi21SpeedSelect(单点选择;combo 首项=默认=直出40步=0929 拉齐重放裁定)
    sel = m_nodes[SPEED_SEL_ID]
    if sel["type"] != "MyQi21SpeedSelect":
        errs.append(f"[{SPEED_SEL_ID}] 应为 MyQi21SpeedSelect(LATENT 汇流单点选择)")
    else:
        if sel["widgets_values"] != [SPEED_DEFAULT_MODE]:
            errs.append(f"[{SPEED_SEL_ID}] combo 默认应=首项 {SPEED_DEFAULT_MODE!r}(直出40步,0929 拉齐重放),"
                        f"得 {sel['widgets_values']}")
        if SPEED_MODES[0][1] != "latent_direct" or "直出40步" not in SPEED_MODES[0][0]:
            errs.append("档位表真源漂移:首项应=直出40步(my_nodes 节点件 import 互锁)")
        slot_src = {inp["name"]: m_links[inp["link"]][1]
                    for inp in sel["inputs"] if inp.get("link") is not None}
        if slot_src != {"latent_funacc": T8_ID, "latent_viggle": SAMPLER_VIGGLE_ID,
                        "latent_direct": SAMPLER_ID}:
            errs.append(f"[{SPEED_SEL_ID}] 三 latent 槽接线应 funacc←[{T8_ID}]/viggle←[{SAMPLER_VIGGLE_ID}]"
                        f"/direct←[{SAMPLER_ID}],得 {slot_src}")
    if m_links[m_nodes[8]["inputs"][0]["link"]][1] != SPEED_SEL_ID:
        errs.append(f"[8].samples 上游应 [{SPEED_SEL_ID}] 选择件(三支路汇流,懒执行单点)")
    sels = [n for n in g["nodes"] if n["type"] == "MyQi21SpeedSelect"]
    if len(sels) != 1:
        errs.append(f"MyQi21SpeedSelect 应恰 1 个(前面只有一个选择逻辑,0929 用户令),得 {[n['id'] for n in sels]}")
    # 主图节点类型白名单(0929 并行化:+MyQi21SpeedSelect;-easy compare 零残留出册;
    # ComfySwitchNode 留册但上方拆净断言已锁死主图恒 0)
    whitelist = {"UNETLoader", "CLIPLoader", "VAELoader", "EmptyLatentImage", "KSampler",
                 "VAEDecode", "SaveImage", "MarkdownNote", "easy showAnything",
                 "PrimitiveStringMultiline", "PrimitiveInt",
                 "ComfySwitchNode", "LoraLoaderModelOnly", "Reroute",
                 "MyQi21SpeedSelect", T8_CLASS}
    for n in g["nodes"]:
        if n["id"] == HOST_ID and n["type"] == sg["id"]:
            continue
        if n["type"] not in whitelist:
            errs.append(f"主图未知节点类型 {n['type']!r}(TE-Speed 槽不加,3c 已死归档;"
                        f"0929 后 easy compare/注入式逻辑件亦不入主图白名单)")
    # 三档懒干跑(MyQi21SpeedSelect 懒选择=只回溯选中档槽,未选支路零执行零加载;
    # PE/联动链在子图内,主图干跑只核宿主可达——子图内部第 9/9b 节另核)
    dfun = _dry_run_main(g)   # 默认态=combo 首项 直出40步(0929 拉齐重放)
    if SAMPLER_ID not in dfun:
        errs.append("干跑:默认态(直出40步)KSampler 应在执行链(选择件首项=默认档)")
    for nid in (T8_ID, SAMPLER_VIGGLE_ID, LORA_ID):
        if nid in dfun:
            errs.append(f"干跑:默认态(直出40步)未选支路 [{nid}] 不应执行(懒选择零加载)")
    for nid in (HOST_ID, LATENT_ID, 1, SEED_ID):
        if nid not in dfun:
            errs.append(f"干跑:默认态共享源 [{nid}] 应在执行源内(单源扇出)")
    dvig = _dry_run_main(g, mode_override=MODE_VIGGLE)
    if LORA_ID not in dvig or SAMPLER_VIGGLE_ID not in dvig:
        errs.append(f"干跑:档1(viggle)执行图应含 LoRA[{LORA_ID}]+KSampler[{SAMPLER_VIGGLE_ID}]")
    for nid in (SAMPLER_ID, T8_ID):
        if nid in dvig:
            errs.append(f"干跑:档1 [{nid}] 不应执行(懒选择只拉起 viggle 支路)")
    ddir = _dry_run_main(g, mode_override=MODE_DIRECT)
    if SAMPLER_ID not in ddir:
        errs.append(f"干跑:档0(直出)KSampler[{SAMPLER_ID}] 应在执行链(40 步主线)")
    for nid in (LORA_ID, SAMPLER_VIGGLE_ID, T8_ID):
        if nid in ddir:
            errs.append(f"干跑:档0 [{nid}] 不应执行(懒选择零加载)")
    # 0929 拉齐重放后默认=直出,档2(Fun-Acc)改经 override 显式核(三档覆盖只增不减)
    dfa = _dry_run_main(g, mode_override=MODE_FUNACC)
    if T8_ID not in dfa:
        errs.append(f"干跑:档2(Fun-Acc)T8[{T8_ID}] 应在执行链(主加速支路)")
    for nid in (SAMPLER_ID, SAMPLER_VIGGLE_ID, LORA_ID):
        if nid in dfa:
            errs.append(f"干跑:档2 [{nid}] 不应执行(懒选择只拉起 Fun-Acc 支路)")

    # 6c. (0927 满血接线轮 steps 联动断言随 [177]/[178]/[179] 拆除退役——步数语义回归
    #     各支路 KSampler widget,由 6b 节「steps=面板生效值」断言接管)

    # 6d. 零真重复(0929 复用铁则:同 type+同上游集合+同 widgets 值不得两件;主图/子图
    #     分域,子图上游含 -10 伪源照计=同域可比;两 KSampler 非重复论证=steps widget 与
    #     model 上游均不同=并行支路本体,design §5.3)
    for _scope, _scope_nodes, _scope_links in (
            ("主图", g["nodes"], {l[0]: l for l in g["links"]}),
            ("子图", sg["nodes"], i_links)):
        _seen: dict[tuple, int] = {}
        for n in _scope_nodes:
            _ups = []
            for inp in n.get("inputs", []):
                _lid = inp.get("link")
                if _lid is not None and _lid in _scope_links:
                    _l = _scope_links[_lid]
                    _oid = _l["origin_id"] if isinstance(_l, dict) else _l[1]
                    _oslot = _l["origin_slot"] if isinstance(_l, dict) else _l[2]
                    _ups.append((_oid, _oslot, inp.get("name")))
            _key = (n["type"], json.dumps(n.get("widgets_values"), ensure_ascii=False),
                    frozenset(_ups))
            if _key in _seen:
                errs.append(f"{_scope} 真重复节点: [{_seen[_key]}] 与 [{n['id']}] 同 type/同上游/同 widgets"
                            f"(0929 复用铁则:共享源单节点扇出,零真重复)")
            _seen[_key] = n["id"]

    # 7. MyQi21DaojieBase 在场+combo 默认人物+三出接线;qi21_bases.json↔05 库互锁;
    #    锁层A 恒挂逐字=库;九型 W/H 经通道 Reroute 出子图
    base_node = i_nodes.get(BASE_ID)
    if not base_node or base_node["type"] != "MyQi21DaojieBase":
        errs.append(f"[{BASE_ID}] 应为 MyQi21DaojieBase(九选一底座节点)")
    else:
        if base_node["widgets_values"] != [DEFAULT_TYPE]:
            errs.append(f"[{BASE_ID}] combo 默认应为 {DEFAULT_TYPE!r}")
        b_inp = base_node["inputs"][0]
        if b_inp.get("name") != "base" or "widget" not in b_inp:
            errs.append("[150].base 应为 widget 转输入(combo 经宿主面板外露)")
        bl = i_links.get(b_inp.get("link"))
        if not bl or bl["origin_id"] != -10 or bl["origin_slot"] != 3:
            errs.append("[150].base 应接 -10 槽3(宿主面板「型选择」COMBO)")
        if [o["name"] for o in base_node["outputs"]] != ["BASE", "WIDTH", "HEIGHT", "型名"]:
            errs.append("[150] 四出应为 BASE/WIDTH/HEIGHT/型名")
        if i_links[i_nodes[CONCAT1_ID]["inputs"][1]["link"]]["origin_id"] != BASE_ID:
            errs.append("拼接①.string_b 上游应为 [150].BASE(级联已退役)")
        if _trace_origin(i_links, i_nodes, i_nodes[RR_W_ID]["inputs"][0]["link"]) != BASE_ID or \
           _trace_origin(i_links, i_nodes, i_nodes[RR_H_ID]["inputs"][0]["link"]) != BASE_ID:
            errs.append("W/H 左缘走廊首拐点上游应为 [150].WIDTH/HEIGHT(九型直驱)")
    if _qi21_base_text(DEFAULT_TYPE) != truth["types"][0]["constant_text"]:
        errs.append("干跑 BASE(qi21_bases.json 人物)与 05 库人物型②层装配不逐字一致")
    if i_nodes[LOCK_ID]["widgets_values"][0] != truth["const_a"]:
        errs.append("[110] 通用锁层常量A 与库首节常量不逐字一致")
    lock_link = i_links[i_nodes[LOCK_ID]["outputs"][0]["links"][0]]
    if lock_link["target_id"] != CONCAT2_ID:
        errs.append("[110] 应恒挂直连拼接②(不随型走开关)")

    # 8. 子图开关纪律(0928 PE 迁子图轮):子图 ComfySwitchNode 恰 4 枚——[141] 提示词
    #    开关/[144] RGBA/[157] 宽联动/[158] 高联动,且 switch 槽全部接 -10 宿主面板
    #    widget(PE开关/RGBA透明开关/画幅联动开关;唯 [141] 默认 true=0926 裁定1,
    #    其余默认 false);子图 StringConstant 仍恰 3 枚(锁层A+RGBA头尾)。
    #    联动链锚(子图内):正则/公式逐字、[157][158] 接线、wh_ratio 联动源、
    #    on_false 九型 W/H(可穿左缘走廊 Reroute)、输出→子图 width/height→主图 [5] 直连
    switches = [n for n in sg["nodes"] if n["type"] == "ComfySwitchNode"]
    if sorted(n["id"] for n in switches) != sorted([PE_SW_ID, RGBA_SW_ID, SW_W_ID, SW_H_ID]):
        errs.append(f"子图开关应恰 4 枚(提示词[141]/RGBA[144]/宽[157]/高[158]),"
                    f"得 {[n['id'] for n in switches]}")
    for sw in switches:
        want_default = (sw["id"] == PE_SW_ID)   # 0926 裁定1:PE 开路含画布本体
        if bool(sw["widgets_values"][0]) is not want_default:
            errs.append(f"[{sw['id']}] 开关默认应为 {want_default}"
                        f"(唯 [141] 默认 true=PE 开路,0926 裁定1)")
        if _trace_origin(i_links, i_nodes, sw["inputs"][2]["link"]) != -10:
            errs.append(f"[{sw['id']}] switch 槽应接 -10(宿主面板 widget)")
    sconsts = [n for n in sg["nodes"] if n["type"] == "StringConstant"]
    if sorted(n["id"] for n in sconsts) != sorted([LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID]):
        errs.append(f"级联退役:子图 StringConstant 应恰 3 枚(锁层A+RGBA头尾),得 {[n['id'] for n in sconsts]}")
    # 联动链锚(子图内)
    if i_nodes[RATIO_RW_ID]["widgets_values"][1] != RATIO_W_PATTERN or \
       i_nodes[RATIO_RH_ID]["widgets_values"][1] != RATIO_H_PATTERN:
        errs.append("画幅联动正则 pattern 漂移")
    if i_nodes[MATH_W_ID]["widgets_values"][0] != MATH_W_EXPR or \
       i_nodes[MATH_H_ID]["widgets_values"][0] != MATH_H_EXPR:
        errs.append("画幅联动公式漂移")
    for mid, conv_a, conv_b in ((MATH_W_ID, CONV_RW_ID, CONV_RH_ID), (MATH_H_ID, CONV_RW_ID, CONV_RH_ID)):
        a_src = i_links[i_nodes[mid]["inputs"][0]["link"]]["origin_id"]
        b_src = i_links[i_nodes[mid]["inputs"][1]["link"]]["origin_id"]
        if a_src != conv_a or b_src != conv_b:
            errs.append(f"[{mid}] 公式 values.a/b 上游应为宽/高转数([{CONV_RW_ID}]/[{CONV_RH_ID}])")
    if i_links[i_nodes[SW_W_ID]["inputs"][1]["link"]]["origin_id"] != MATH_W_ID or \
       i_links[i_nodes[SW_H_ID]["inputs"][1]["link"]]["origin_id"] != MATH_H_ID:
        errs.append("宽高开关 on_true 上游应为公式宽/高")
    wh = i_nodes[PE_RW_ID]["outputs"][2]
    if wh["name"] != "wh_ratio" or sorted(wh["links"] or []) != [25, 26]:
        errs.append("[140].wh_ratio 应扇出两线喂宽高正则(联动源)")
    # 九型默认臂:可穿左缘走廊 Reroute,实源应=[150].WIDTH/HEIGHT
    for sw_id, base_slot in ((SW_W_ID, 1), (SW_H_ID, 2)):
        oid = _trace_origin(i_links, i_nodes, i_nodes[sw_id]["inputs"][0]["link"])
        if oid != BASE_ID:
            errs.append(f"[{sw_id}].on_false 上游应 [150] 输出槽{base_slot}"
                        f"(九型 W/H 默认路,可穿走廊 Reroute),得 {oid}")
    lat_w = m_links[m_nodes[LATENT_ID]["inputs"][0]["link"]]
    lat_h = m_links[m_nodes[LATENT_ID]["inputs"][1]["link"]]
    if (lat_w[1], lat_w[2]) != (HOST_ID, 3) or (lat_h[1], lat_h[2]) != (HOST_ID, 4):
        errs.append("[5] 宽高应接 [40] width/height 输出直连(0928 联动终值出子图)")
    # 子图 width/height 输出溯至联动开关(终值语义)
    for out_slot, sw_id in ((3, SW_W_ID), (4, SW_H_ID)):
        io = sg["outputs"][out_slot]
        l_ = i_links[io["linkIds"][0]]
        if l_["origin_id"] != sw_id:
            errs.append(f"子图输出槽{out_slot} 应溯至 [{sw_id}] 联动开关(终值)")

    # 9. 干跑谓词(静态 graphToPrompt 等价):直写选配臂([141] on_false)装配链完整性;
    #    0928 PE 迁子图后全程子图内部溯源;本函数固定走 on_false 直写臂核装配文本逐字
    #    (不核默认态执行图);[141] 默认 true 由第 8/10 节核 widget,默认态 PE 开路臂
    #    执行图成员资格由第 9b 节 _dry_run_subgraph_default 钉住
    reach_int, assembled = _dry_run_default(g, sg)
    if BASE_ID not in reach_int or LOCK_ID not in reach_int:
        errs.append(f"干跑:直写选配臂应含 [{BASE_ID}]底座/[{LOCK_ID}]锁层,得 {sorted(reach_int)}")
    for nid in (RGBA_HEAD_ID, RGBA_TAIL_ID, RGBA_CAT1_ID, RGBA_CAT2_ID, TE_RGBA_ID):
        if nid in reach_int:
            errs.append(f"干跑:直写选配臂 [{nid}] 不应可达(RGBA 懒执行旁路)")
    want = "\n".join([truth["types"][0]["subject"],
                      _qi21_base_text(DEFAULT_TYPE), truth["const_a"]])
    if assembled != want:
        errs.append("干跑:直写选配臂装配全文与库人物型四层组合不逐字一致")

    # 9b. 默认态子图执行集(0928 残留清创轮补真谓词,审计残留二):旧主图侧谓词
    #     「默认态 PE 改写 [140] 应在执行源内(0926 裁定1 默认 PE 开路,[141]=true)」
    #     随 PE 迁子图被删后,主图只剩「宿主 [40] 可达」近恒真断言,默认开路 PE 臂
    #     的执行图成员资格无谓词覆盖——本谓词恢复真实覆盖:宿主「PE开关」默认 true
    #     (0926 裁定1;宪法「所有提示词必须过 PE」)⇒ [141] 走 on_true 臂=PE 改写
    #     [140] 必须在执行图、直写臂 [131] 懒旁路不可达;9 节直写臂装配文本核验不丢。
    dpe = _dry_run_subgraph_default(g, sg)
    if PE_RW_ID not in dpe:
        errs.append(f"干跑:默认态(PE开关 默认 true=0926 裁定1)PE 改写 [{PE_RW_ID}] "
                    f"应在执行图内(宪法:所有提示词必须过 PE;懒执行走 on_true 臂)")
    if CONCAT2_ID in dpe:
        errs.append(f"干跑:默认态直写臂 [{CONCAT2_ID}] 不应可达([141] on_true=PE 开路,"
                    f"直写选配臂懒旁路)")
    if TE_ID not in dpe or RGBA_SW_ID not in dpe:
        errs.append(f"干跑:默认态主编码 [{TE_ID}]/RGBA 开关 [{RGBA_SW_ID}] "
                    f"应在执行图内(positive 终点路)")

    # 10. PE/RGBA 承袭(0928 PE 迁子图后链全在子图):[140] 参数/clip←pe_clip 槽;
    #     [141] 接线=最终文本路由(子图内闭环);[27] 预览改接 [40].最终文本输出;
    #     RGBA 官方公式(子图;头尾逐字+拼接路+空格 delimiter)
    pe = i_nodes[PE_RW_ID]
    if pe["widgets_values"] != [PE_SEED_PROMPT, *PE_PARAMS]:
        errs.append("PE 改写组参数漂移(官方 README 推荐值;pp=1.5 已定档 0925)")
    pe_cl = i_links[pe["inputs"][0]["link"]]
    if pe_cl["origin_id"] != -10 or pe_cl["origin_slot"] != 6:
        errs.append("[140].clip 上游应 -10 槽6 pe_clip(主图 [11] PE 专属 TE 一进线)")
    pe_clip = [n for n in g["nodes"] if n["type"] == "CLIPLoader" and n["widgets_values"][0] == PE_CLIP_FILE]
    if len(pe_clip) != 1 or pe_clip[0]["id"] != PE_TE_ID:
        errs.append(f"PE 专属 CLIPLoader 应恰 1 个=[{PE_TE_ID}](留主图加载器行)")
    _pe_clip_slot = next((i for i, s in enumerate(sg["inputs"]) if s["name"] == "pe_clip"), None)
    _host_pe_clip = next((i for i, s in enumerate(host["inputs"]) if s["name"] == "pe_clip"), None)
    if _pe_clip_slot != 6 or _host_pe_clip != 3:
        errs.append("[40] pe_clip 应=子图 -10 槽6/宿主外露槽3(0929 外露槽序 4 槽制)")
    elif m_links[host["inputs"][3]["link"]][1] != PE_TE_ID:
        errs.append("[40].pe_clip 外链上游应 [11] PE 专属 TE")
    psw = i_nodes[PE_SW_ID]
    if psw["type"] != "ComfySwitchNode" or psw["outputs"][0]["type"] != "STRING":
        errs.append(f"[{PE_SW_ID}] 应为 STRING 泛型开关(提示词开关)")
    if psw["widgets_values"][0] is not True:
        errs.append(f"[{PE_SW_ID}] 提示词开关默认应 true(PE 开路,0926 裁定1 含画布本体;关=直写按图选配)")
    psw_cl = i_links[psw["inputs"][2]["link"]]
    if psw_cl["origin_id"] != -10 or psw_cl["origin_slot"] != 5:
        errs.append("[141].switch 应接 -10 槽5(宿主面板「PE开关」,照「型选择」combo 暴露机制)")
    f_src = i_links[psw["inputs"][0]["link"]]
    if (f_src["origin_id"], f_src["origin_slot"]) != (CONCAT2_ID, 0):
        errs.append("[141].on_false 上游应 [131] 装配全文(子图内直收,不再出图)")
    if i_links[psw["inputs"][1]["link"]]["origin_id"] != PE_RW_ID:
        errs.append("[141].on_true 上游应 [140] PE 改写")
    if sorted(psw["outputs"][0]["links"] or []) != sorted([24, 44]):
        errs.append("[141] 输出应扇出恰两线([142].prompt 主编码 + [176]→最终文本输出)")
    if i_links[i_nodes[TE_ID]["inputs"][3]["link"]]["origin_id"] != PE_SW_ID:
        errs.append("[142].prompt 应直收 [141] 开关输出(最终文本,子图内闭环)")
    pv = m_nodes[PREVIEW_ID]
    if (m_links[pv["inputs"][0]["link"]][1], m_links[pv["inputs"][0]["link"]][2]) != (HOST_ID, 2):
        errs.append("[27] 装配预览应接 [40].最终文本 输出(与进编码文本同源)")
    if i_nodes[RGBA_HEAD_ID]["widgets_values"][0] != RGBA_HEAD_EN or \
       i_nodes[RGBA_TAIL_ID]["widgets_values"][0] != RGBA_TAIL_EN:
        errs.append("RGBA 官方头/尾常量非官方原文逐字")
    rgba_prompt_link = i_links.get(i_nodes[TE_RGBA_ID]["inputs"][3]["link"])
    if not rgba_prompt_link or rgba_prompt_link["origin_id"] != RGBA_CAT2_ID:
        errs.append("[143].prompt 应接 [163] RGBA 公式拼接输出")
    if i_nodes[TE_RGBA_ID]["widgets_values"][0] != "":
        errs.append("[143] prompt widget 应清空(公式路现拼)")
    cat1, cat2 = i_nodes[RGBA_CAT1_ID], i_nodes[RGBA_CAT2_ID]
    if cat1["widgets_values"][2] != " " or cat2["widgets_values"][2] != " ":
        errs.append("RGBA 公式拼接 delimiter 应为空格")
    if i_links[cat1["inputs"][1]["link"]]["origin_id"] != CONCAT2_ID:
        errs.append("RGBA 公式拼接①.string_b 上游应为装配全文")
    if host["widgets_values"][2] is not False:
        errs.append("[40] 面板 RGBA透明开关默认必须 false")

    # 10b. (采样完整态断言已并入 6b:两 KSampler steps=40/359 面板生效值+cfg/euler/
    #      simple/fixed 控制位不漂移,0929 并行化轮随双采样器改写)

    # 11. 无孤儿节点(SaveImage 向上可达;MarkdownNote/easy showAnything 显示型端点豁免)
    seen, stack = set(), [9]
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        for inp in m_nodes[nid].get("inputs", []):
            lid = inp.get("link")
            if lid is not None:
                stack.append(m_links[lid][1])
    orphans = sorted(i for i in m_nodes if i not in seen
                     and m_nodes[i]["type"] not in ("MarkdownNote", "easy showAnything"))
    if orphans:
        errs.append(f"孤儿节点: {orphans}")

    # 12. 说明 Note 必含要点(W5 两笔终审承袭;0929 并行化轮:三支路+单选择+seed 单源+面板生效值)
    note = next(n for n in g["nodes"] if n["type"] == "MarkdownNote")["widgets_values"][0]
    for token in ("cfg 恒 1", "40-50", RGBA_HEAD_EN, RGBA_TAIL_EN, RGBA_HEAD_ZH,
                  RGBA_TAIL_ZH, "qwen-image-2-1-prompter", "05-道劫规范提示词库.md", "九型", "空镜无人",
                  "MyQi21DaojieBase", "画幅联动", "恒挂", "美化", "[27]", "ResolutionSelector 已退役",
                  "LoraLoaderModelOnly", LORA_FILE,
                  "[198]", "[206]", "[207]", "[208]", "[31]",
                  "0=直出 40 步", "1=viggle 359 步", "2=Fun-Acc", "降级=",
                  "shift_terminal=0.02", "TE-Speed",
                  # 0925 收窄轮新要点
                  "数学上不参与采样", "官方同构", "占位", "presence_penalty=1.5 已定档",
                  "摆设值不生效", "加速区", "[140]", "[141]",
                  # 0928 PE 迁子图轮:面板控件新口径
                  "PE开关", "画幅联动开关", "最终文本",
                  # 0925 毒理定案 C1:PE 种子纪律(反噪)
                  "PE 种子纪律", "画面干净平滑", "而非纸面纹理",
                  # 0926 裁定1:默认 PE 开路含画布本体(Note 必含新口径)
                  "默认 PE 改写", "按图选配",
                  # 0929 并行化轮:三支路并行+单选择+seed 单源+面板生效值+依赖警示+T8 事实
                  "MyQi21SpeedSelect", "并行三支路", "只有一个选择逻辑", "默认=直出40步",
                  "拉齐重放",
                  "懒执行", "seed 单源共享", "面板值=生效值",
                  "依赖警示", "生态插件区", "Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8",
                  "T8QwenImage21FunAccPDD4Step", FUNACC_FILE, "无负面槽", "用户手动权威",
                  "绝不吃 viggle LoRA"):
        if token not in note:
            errs.append(f"说明 Note 缺要点: {token!r}")
    if note.lstrip().startswith("# "):
        errs.append("说明 Note 以一级大标题开幅(禁横幅)")
    return errs


def _trace_reroute_main(m_links: dict, m_nodes: dict, lid: int) -> int:
    """主图沿 link 反向溯源,穿过顶通道 Reroute 回到实源节点 id。"""
    seen = set()
    while True:
        l = m_links[lid]
        oid = l[1]
        if m_nodes[oid]["type"] != "Reroute" or oid in seen:
            return oid
        seen.add(oid)
        lid = m_nodes[oid]["inputs"][0]["link"]


def _dry_run_main(g: dict, mode_override: int | None = None) -> set[int]:
    """主图执行集(SaveImage 回溯;懒执行=只走选中支路)。

    0929 并行化轮:选择点=[208] MyQi21SpeedSelect(三 latent 槽全 lazy)——按档位
    (combo widget;mode_override=档号 0/1/2 模拟运行态切档;默认态=combo 首项=
    直出40步)只回溯选中档支路的槽,
    未选支路整体不进执行图(零空转零加载);注入式开关农场已拆,主图零
    ComfySwitchNode;PE/画幅联动在 [40] 子图内部,主图干跑只核宿主可达(子图懒
    语义第 9/9b 节另核)。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    want_slot = SPEED_SLOT_OF_MODE[MODE_DIRECT if mode_override is None else mode_override]
    reach: set[int] = set()
    stack = [9]  # SaveImage
    while stack:
        nid = stack.pop()
        if nid in reach:
            continue
        reach.add(nid)
        node = m_nodes[nid]
        if node["type"] == "MyQi21SpeedSelect":
            slots = [i for i, inp in enumerate(node["inputs"]) if inp.get("name") == want_slot]
        else:
            slots = range(len(node.get("inputs", [])))
        for si in slots:
            lid = node["inputs"][si].get("link")
            if lid is not None:
                stack.append(m_links[lid][1])
    return reach


def _dry_run_default(g: dict, sg: dict) -> tuple[set[int], str]:
    """静态干跑:直写选配臂视图(0926 裁定1 后默认臂=[141] true=PE 开路,PE 文本运行
    时动态出改写器、静态不可逐字;本函数固定走 [141].on_false 直写臂)装配文本溯源
    与可达集——直写臂装配链完整性与逐字组合仍是硬契约(选配档不许坏)。

    0928 PE 迁子图后装配全文路径(全程子图内部,不再出图回流):主编码 [142].prompt
    ← [141] 开关(本视图走 on_false)← [131] 装配全文(主体句+BASE+锁层A)。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_links = {l["id"]: l for l in sg["links"]}
    host = m_nodes[HOST_ID]
    # 0929 面板控件机制:宿主 inputs 只剩外露连线槽(4),面板控件值只在 widgets_values
    # (WIDGET_INPUTS 序=面板控件序,与 widgets_values 逐位对应——主体句/型选择/RGBA/
    # PE开关/画幅联动,PE开关=true 默认开不变量仍由此路径钉死)
    host_widget_values = dict(zip([name for name, _t in WIDGET_INPUTS],
                                  host["widgets_values"]))
    host_link_by_name = {i["name"]: i.get("link") for i in host["inputs"]}

    def resolve_node(src: dict) -> list[str]:
        """按节点类型解析其文本贡献(拼接=两输入递归;PE 开关=固定 on_false 懒执行)。"""
        if src["type"] == "StringConstant":
            return [src["widgets_values"][0]]
        if src["type"] == "MyQi21DaojieBase":
            return [_qi21_base_text(host_widget_values.get("型选择", DEFAULT_TYPE))]
        if src["type"] == "ComfySwitchNode":
            if src["id"] == PE_SW_ID:
                return resolve_internal(src["id"], 0)   # [141]=PE 开关(0926 裁定1 默认
                # true=PE 开路);本视图固定走 on_false 直写选配臂核装配文本,不随 widget 定臂
            if src["widgets_values"][0] is not False:
                raise SystemExit(f"干跑:默认链开关非 false [{src['id']}]")
            return resolve_internal(src["id"], 0)  # on_false(懒执行)
        if src["type"] == "StringConcatenate":
            return resolve_internal(src["id"], 0) + resolve_internal(src["id"], 1)
        return []

    def resolve_internal(node_id: int, slot: int) -> list[str]:
        """解析子图内部某输入槽的文本贡献:内链→内部节点/-10(外链→主图源;
        0929 面板控件机制:-10 槽按名取宿主——外露槽走连线溯源,面板控件走
        widgets_values 值(型选择 COMBO 等),不再按宿主 inputs 槽位直查)。"""
        texts: list[str] = []
        inp = i_nodes[node_id]["inputs"][slot]
        lid = inp.get("link")
        if lid is None:
            return texts
        l = i_links[lid]
        if l["origin_id"] == -10:
            slot_name = sg["inputs"][l["origin_slot"]]["name"]
            ext_lid = host_link_by_name.get(slot_name)
            if ext_lid is not None:  # 外露连线槽→主图源(主体句←[24])
                src = m_nodes[m_links[ext_lid][1]]
                if src["type"] == "PrimitiveStringMultiline":
                    texts.append(src["widgets_values"][0])
            else:  # 面板控件(型选择 COMBO 等)——MyQi21DaojieBase 的 base 即此路
                if i_nodes[node_id]["type"] == "MyQi21DaojieBase":
                    texts.append(_qi21_base_text(host_widget_values.get("型选择", DEFAULT_TYPE)))
            return texts
        texts.extend(resolve_node(i_nodes[l["origin_id"]]))
        return texts

    # 装配文本 = 主编码 [142].prompt 溯源(子图内闭环)
    texts = resolve_internal(TE_ID, 3)

    # 默认态参与执行的子图内部节点(懒执行:开关只走 on_false;从 [144] 正极终点回溯
    # 即覆盖 [142]→[141]→[131]→[130]→[150]/[110]/主体句 全直写臂)
    reach: set[int] = set()

    def walk(node_id: int):
        if node_id in reach:
            return
        reach.add(node_id)
        node = i_nodes[node_id]
        slots = [0] if node["type"] == "ComfySwitchNode" else range(len(node.get("inputs", [])))
        for si in slots:
            lid = node["inputs"][si].get("link")
            if lid is None:
                continue
            l = i_links[lid]
            if l["origin_id"] != -10:
                walk(l["origin_id"])

    walk(RGBA_SW_ID)   # positive 默认路终点开关(on_false=[142] 主编码臂)
    return reach, "\n".join(texts)


def _dry_run_subgraph_default(g: dict, sg: dict) -> set[int]:
    """子图默认态执行集(0928 残留清创轮:恢复「默认 PE 开路」的执行图成员覆盖)。

    懒执行=ComfySwitchNode 只走选中臂;switch 槽接 -10 宿主面板 widget 的开关按
    宿主 widgets_values 解析有效布尔(0929 面板控件机制:面板值=WIDGET_INPUTS 序与
    widgets_values 逐位对应,无外接回落本件 widget)。默认态:宿主「PE开关」
    true(0926 裁定1)⇒ [141] 走 on_true=PE 改写 [140] 在链;RGBA/宽高开关 false ⇒
    走 on_false。从 positive 输出 IO 槽(linkIds)回溯;-10 边界即主图侧,不越界。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    i_links = {l["id"]: l for l in sg["links"]}
    host = m_nodes[HOST_ID]
    host_wv = dict(zip([name for name, _t in WIDGET_INPUTS],
                       host["widgets_values"]))

    def _sw_bool(node: dict) -> bool:
        lid = node["inputs"][2].get("link")
        if lid is not None:
            l = i_links[lid]
            if l["origin_id"] == -10:
                # 宿主面板 widget(子图开关唯一合法 switch 源,第 8 节钉死)
                return bool(host_wv.get(sg["inputs"][l["origin_slot"]]["name"], False))
        return bool(node["widgets_values"][0])

    reach: set[int] = set()
    stack = [l["origin_id"] for l in sg["links"]
             if l["target_id"] == -20 and l["target_slot"] == 0]   # positive 输出
    while stack:
        nid = stack.pop()
        if nid in reach:
            continue
        reach.add(nid)
        node = i_nodes[nid]
        slots = ([1 if _sw_bool(node) else 0] if node["type"] == "ComfySwitchNode"
                 else range(len(node.get("inputs", []))))
        for si in slots:
            lid = node["inputs"][si].get("link")
            if lid is None:
                continue
            l = i_links[lid]
            if l["origin_id"] != -10:
                stack.append(l["origin_id"])
    return reach


def main() -> int:
    check_only = "--check" in sys.argv
    truth = load_truth()
    sg, _ = build_subgraph(truth)
    g = build_main(truth, sg)
    errs = self_check(g, truth)
    if errs:
        for e in errs:
            print(f"FAIL(构建期): {e}", file=sys.stderr)
        return 1

    payload = json.dumps(g, ensure_ascii=False, indent=2) + "\n"
    if not check_only:
        existing = QI21_JSON.read_text(encoding="utf-8") if QI21_JSON.is_file() else None
        if existing != payload:
            QI21_JSON.write_text(payload, encoding="utf-8")
            print(f"写盘: {QI21_JSON.relative_to(_REPO)}")
        else:
            print(f"在位且一致(幂等跳过): {QI21_JSON.relative_to(_REPO)}")

    # 写盘后复读自查(磁盘态为准):json.loads 往返 + 全谓词
    if QI21_JSON.is_file():
        disk = json.loads(QI21_JSON.read_text(encoding="utf-8"))
        disk_errs = self_check(disk, truth)
        if disk_errs:
            for e in disk_errs:
                print(f"FAIL(磁盘态): {e}", file=sys.stderr)
            return 1
    else:
        print("FAIL: qi21 件未在位", file=sys.stderr)
        return 1

    n_nodes = len(disk["nodes"])
    n_links = len(disk["links"])
    sg_nodes = len(disk["definitions"]["subgraphs"][0]["nodes"])
    sg_links = len(disk["definitions"]["subgraphs"][0]["links"])
    zh_list = " ".join(t["zh"] for t in truth["types"])
    print(f"PASS: 主图 {n_nodes} 节点/{n_links} 链 + 子图 {sg_nodes} 节点/{sg_links} 链;九型={zh_list};"
            f"0929 加速区并行化轮=注入式开关农场十件全拆([30]/[32]/[177]/[178]/[179]/[193]/[194]/"
            f"[195]/[196]/[197]),立并行三支路(直出=[1]→[7]KSampler·{STEPS_OFF}步/viggle=[1]→"
            f"[{LORA_ID}]LoRA(0.8)→[{SAMPLER_VIGGLE_ID}]KSampler·{STEPS_ON}步/Fun-Acc=[1]→[{T8_ID}]T8·4步内置"
            f"(model=[1] 直连绝不吃 LoRA)),[{SEED_ID}] seed 单源(0 fixed)三扇出(三采样器 seed 一律"
            f"widget→input),三支路 LATENT 汇流→[{SPEED_SEL_ID}] MyQi21SpeedSelect(combo 首项=默认="
            f"{SPEED_DEFAULT_MODE},懒选择=未选支路零执行零加载;档位表真源=my_nodes 节点件 import 互锁)"
            f"→[8] 解码;共享源全单节点扇出([1]/[5]/[40].positive 三扇出,[40].negative 二扇出(T8 无负面槽)),"
            f"自查新增零真重复谓词;steps 回归各支路 widget=面板生效值([7] steps 摆设值误导清除);"
            f"组框加速区随拓扑重建(罩空潜+三支路+选择件+seed单源七件),Note 只重写加速区段+参数圣经(三档并行+单选择+"
            f"默认直出40步+档2 插件依赖警示+seed 单源+面板值=生效值),其余 tokens 原样;"
            f"交叉基线按新拓扑实测重立(见 3g 注);"
            f"0929 用户手改回灌轮=宿主面板机制简化([40] 外露输入槽 8→4,四控件改回面板控件;"
            f"子图内部 IO 仍 8 入 5 出零动)+两新默认并入本轮口径(档位默认并入选择件 combo 首项="
            f"直出40步(0929 拉齐重放裁定,12:05 主会话复核);viggle 步数 359 保留为 [{SAMPLER_VIGGLE_ID}] 面板生效值);"
            f"0928 残留清创轮=主图踏脚石直连([203] 亦随并行化退役)+干跑 9b 谓词;"
            f"0928 PE 链迁入装配子图([140]/[141]/[151]-[158] 全收 [40];主图左向线恒 0;"
            f"[5] 宽高直连 [40].width/.height;[27] 预览接 [40].最终文本);"
            f"W5 负面 cfg=1 占位说明+pp=1.5 定档;"
            f"W6 零负区(全节点 pos≥80)+输出口最右(输出槽钉最右列 x=7300);"
            f"0926 铁律·线不遮节点(主图+子图同口径);"
            f"默认=①人物(combo 经宿主面板外露,RGBA 官方头尾公式,"
            f"PE 默认开路([141] true)/联动默认关);"
            f"三档懒干跑(默认直出40步=[7] 在链而 [198]/[206]/[31] 零执行;档1/档2 同口径核);"
            f"干跑直写选配臂装配全文逐字=库组合(全程子图内溯源);"
            f"双向/横向(左向线恒 0)/六行排版/零重叠/est 间距(横≥200/纵≥80)/零线遮节点(0926)/"
            f"0929 四块重画轮=主图组框四块(①加载器[1][3][2][11]/②提示词装配[24][40][27]/"
            f"③加速区[5][7][31][206][198][208][207]/④输出[8][9];旧装配外露+主链框拆散消失,"
            f"主链×加速区 [7] 行交叠消灭;微移仅 [24]→(1700,2900)+[207]→(3950,2950) 两件)/"
            f"group 预算(子图4·主图4,子图各框单一阶段行且不相交,主图框两两不相交+非Note零裸奔"
            f"+四块成员恰好,联动蛇形两行不设框)/"
            f"group int/子图 linkIds 逐项登记(8 入 5 出)/"
            f"锁层A 恒挂/懒执行旁路/零孤儿全绿")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
