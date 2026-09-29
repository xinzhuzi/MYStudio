#!/usr/bin/env python3
"""qi21-edit.json R16 核心化升级(09-23,幂等全量再生成)。

0929 四块重画轮(三件统一口径,edit 件;纯组框+摆位手术,nodes 除 pos 外与
links 逐字节不变):
  组框 4→5 框,四块口径=①加载器(罩 UNET/VAE/全部 CLIPLoader 含 PE 专属 TE:
  [3] 自主链框划出入 TE 列、[12] 自 PE 瀑布左下上收入①,与 i2i① 同构)/②主链
  (缩框改名「道劫·②图像·编码主链」,上缘 660 让①、下缘 2510 让 PE 组)/
  ②PE 子框(「道劫·②PE-I2I 改写组」,按六件 [21][22][23][24][26][27] 实测
  重立,修旧框零全含之脱位)/③加速区(标题原样保留过锚,仅上缘 250→190 收编
  [29] Reroute+高度 1830→1860 罩 [57])/④输出([9][10] 独立成块)。
  微移 8 件:[3] (2960,980)→(2960,460)/[12] (440,3700)→(850,490)/
  [7] (7040,640)→(7040,660)/[16] (2220,540)→(2220,700)/[21] (1380,2060)→
  (1380,2600)/[19] (6300,3000)→(6300,2340)/[57] (8400,1960)→(8630,1090)/
  [28] (4080,780)→(4450,680);其余 25 件原位。提案原坐标([3]y320/
  [12](2880,440)/[7]y700)经 est 间距/线遮口径手算预检证伪修正;[57]/[28]
  两件为交叉棘轮补偿(61→56,框内网格搜索定值,--check 实跑收敛)。
  自查随批:groups 预算 4→5;新增硬约束1(组框两两 bbox 交集空)/硬约束2
  (非 MarkdownNote 零裸奔,口径 pos+size 全含)两谓词入 verify——评审员令
  验收须可复现,不靠提案方一次性脚本。

0929 加速区并行化轮(Trellis 09-29-qi21-acczone-parallel,design §2/§4/§5;本件无子图):
  拆除加速区全部 13 选择逻辑件([30]档位/[32]MODEL开关/[33]steps开关/[42]正源开关/
  [54]latent路由(开关4)+[50][51][41]比较(3)+[34][35][38][39][40]常量(6)),立三条完整
  并行支路(支路横向一行、三行纵叠,选择件居汇流点右侧):
    支路0 直出   [7]Cache ────────────────→ [8]  KSampler(40步)
    支路1 viggle [7]Cache → [31]LoRA(0.8) → [56] KSampler(359步)
    支路2 FunAcc [7]Cache ────────────────→ [55] T8(4步内置,model 直连 base 绝不吃 LoRA)
  三支路汇流 [58] MyQi21SpeedSelect(combo 首项=「0 · 直出40步」=默认(0929 拉齐重放,
  Fun-Acc 仍为主加速居二);latent_funacc/
  latent_viggle/latent_direct 三槽全 lazy,check_lazy_status 只拉起选中支路)→ [9] 解码;
  seed 单源 [57] PrimitiveInt(0,fixed)扇出三采样器(T8 seed widget→输入);steps 回归
  各支路 KSampler widget(面板=生效值,消灭摆设值);正源双路保持 0928 黑图修复语义
  (直出支路=[6] 双参考/viggle·FunAcc 支路=[43] 单参考,positive 直入各支路,零开关);
  KSampler seed randomize→fixed 归一(与 t2i/i2i 同构);组框「道劫·加速区」随拓扑重建;
  Note 只重写加速区段;自查新增零真重复谓词(复用铁则)+--check 只查入口+写盘后
  磁盘态双跑(t2i/i2i 对齐);combo 闭集与 my_qi21_speed_select.SPEED_MODES 单源互锁。

0928 删踏脚石直连轮·edit(本件无子图,PE 链留主图,PE 默认开不变量不动):
  主图纯中转 Reroute 六枚删件直连([56]/[57]/[58]/[46]/[44]/[45],单入单出只
  转发;origin 侧 link 保留 id 改指实靶,出侧 link 删):[7]→[32].on_false /
  [51]→[54].switch / [2]→[43].clip / [30]→[41].a / [6].positive→[42].on_true /
  [43].positive→[42].on_false 全部直连;配套三挪位保零线遮([42] 正源开关
  2920→2300 让两正源臂从 [38]/[20]/[51] 顶侧净空过、避 [32]→[55] MODEL 总线
  斜带;[54] latent 路由 1620→2300 让 [51] 布尔线从 [55] 盒底下方平飞;
  [35] 常量6 6000→6600 让出 [6]→[42] 长臂贝塞尔下垂走廊,link37 近平飞不增交叉)。
  VAE 顶通道总线 [28]/[29] 实测保留:删 [28] 线遮 +1、删 [29] 交叉 +3 且线遮 +1、
  双删交叉 +8——交叉与线遮至少一增,按「删后双不增才删」判据留用。
  主图交叉 **69→68**,_CROSS_BASELINE 棘轮同步 69→68;红线全绿(零线遮 41 点
  精判/恒向右/est 零重叠+横≥200 纵≥80/零负区/加速区罩盖)。

0928 重布局同构推排轮·edit(承 t2i/i2i 方法论;本件无子图,主图 only):
  坐标-only(links/widgets/文本/properties/组框标题逐字节不变,仅 pos 与 groups
  bounding 变,骨架对比已逐字节核验);主图重排=退火局部搜索+定向手术([30] 档位源
  下移加速区中心消四长扇出线+[45]/[33]/[8] 三点微调收尾):主图交叉 **84→69**(-18%),
  _CROSS_BASELINE 棘轮同步 84→69;红线全绿(零线遮 41 点精判/恒向右/est 零重叠+
  横≥200 纵≥80/零负区/加速区罩盖,组框4 bounding 随行 [5960,80,2960,2870]);
  残余=TE[6]→KSampler 长横贯+加速区竖直扇出在恒向右+est 红线下的结构性存量,
  后续棘轮轮继续拧。

Trellis 09-23-qwen-image-21-research design §13(R16);research/13 官方 PE 强化件
解剖的「免插件 PE 链」照抄 + research/14/15 吸收项(输入图预缩):

  ① PE 改写链换 comfy-core 五件套(去 benjiyaya 依赖):
     PE CLIPLoader(pe_i2i bf16, type=qwen_image)
       → StringFormat {a}{b}{c}(a=官方 i2i 系统提示词 chatml 段 / b=原始用户词
         / c=assistant+<think> 预填段,三段各一 PrimitiveStringMultiline)
       → TextGenerate(use_default_template=false + thinking=false,<think> 预填为
         官方刻意设计勿改;temp 0.7/topK 20/topP 0.95/minP 0.05/repPen 1.05/
         maxLength 8192/seed 42;presence_penalty=1.5 已定档(0925 拍板:A/B 四维 57.5 vs
         55.0 略优,保留 1.5)
       → RegexExtract(抓 rewritten_prompt,dotall=True,对 think 长文免疫)
       → ComfySwitchNode(false=原始用户词/true=PE,0926 裁定1 默认 true=PE 开路;
       关=直写选配旁路懒执行)
  ② QwenImage21Cache(auto)挂 UNETLoader 后(既有,本脚本保核对)
  ③ BatchImagesNode 前置双通道:全部(预缩后)输入图合批 → TextGenerate.image
     (PE 看全图);TextEncodeQwenImage21 只接选定图(编码器吃选图)
  ④ latent 双路:PrimitiveBoolean → ComfySwitch(false=TextEncode.latent 跟随
     image_1 / true=EmptyLatentImage 自定义宽高,默认 false)
  ⑤ 布局:从上到下=阶段行(加载器/主链/画幅双路/PE 两行),行内从左到右,
     全连线恒向右(纵向塔铁律);group 恰 3;节点标题铁律:核心节点零自定义
     title(原生默认名),本件无自研节点故全图无 title
  吸收(research/15 §4 P1 并入 R16):LoadImage 后接 ImageScaleToTotalPixels
     预缩——画布 1.5MP/参考图 1.0MP(lanczos,resolution_steps=32);控显存+
     稳输入尺寸(视频实证速度与输入图强相关)。

  R26.4 LoRA 加速槽(09-24 统一接线,与 i2i 出生槽/t2i 补槽三件同构;D1 定案
  默认关=正常生成):[7] Cache→⟨[32] MODEL 开关(false=Cache 直连/true=[31]
  LoraLoaderModelOnly,name 预填 Qwen-Image-2.1-viggle-turbo-4step-lora-r64
  .safetensors,strength 0.8)⟩→[8] KSampler.model(槽插最靠近 KSampler 的
  model 入口=Cache 之后);[30] PrimitiveBoolean 默认 false=旁路,关态懒执行=
  执行图零 LoraLoader;TE-Speed 槽不加(3c 试装已死归档,D4 终审永不装)。
  布局随迁:三件住 Cache 上带(y=-560/-260);VAE→VAEDecode 长横穿改走顶缘
  Reroute 通道([28]/[29],y=-640,序列化样板=K2-角色设定-道劫.json——t2i/i2i
  同款),KSampler/解码/保存右移让位;交叉审计 11=整治前 11(零新增)。

  0925 加速与展示全量外露收窄轮(Trellis 09-25-qi21-speed-subgraph,W1/W5/W6):
    W1 加速区组框收纳(方案C 原生组框):[30][31][32][33][34][35] 六件入主画布
    「加速区」组框(group 预算 3→4,G2 收窄让位两框不相交);W5 Note 两笔终审:
    负面线=cfg=1 下数学上不参与采样、占位为官方同构;PE presence_penalty=1.5
    定档(A/B 四维 57.5 vs 55.0 略优);[8] 面板 steps 显 40=摆设值注明;W6 画布
    归一:主图整体平移零负区(全部节点 pos≥40,打开即全貌);自查新增谓词:
    零负区(本件无子图,输出口最右谓词不适用——t2i/i2i 子图件适用)。
    (t2i 件另有 W2 PE 链迁出子图/W3 子图收窄,PE 位置三件同构=均主画布。)

  0926 线不遮节点轮(用户令「工作流的美化,你只管位置,不要线与节点彼此
  遮盖!」;整治 11 条真遮挡,全部挪位解决、零新增 Reroute):自查新增谓词
  「零线遮节点」=贝塞尔采样精判(节点盒 size 口径/Reroute 60×30,槽位
  右/左缘 top+25+slot×20,三次贝塞尔 k=clamp(|dx|/2,40,200) 41 点采样,
  非端点盒 ±2 容差即遮挡;bbox 走廊口径高估 5 倍弃用)。挪位九处:
  ① [1] UNET 抬 y=440(长线 [1]→[7] 高走净空,不再扫 [2]/[6]);
  ② [3] VAE 右移 2700([2]→[6] 长线从其盒底下方过),RR_V_A 随迁 2960
     保恒向右;③ 双图链改双子行([5]/[17] 沉 y=1560,[25] 沉 y=1500)——
  [16] 两条长线([16]→[6] 平飞/[16]→[25] 斜穿)与 [17]→[6] 上行线全部
  走净空;④ [7] Cache 抬 y=740([6]→[8] 双 condition 线从其盒底下方过);
  ⑤ 加速区六件错位重排([30](7040,400)/[31](7040,640)/[32](7590,860)/
  [34](7640,220)/[35](7640,460),[33] 不动)——[7]→[32] 直连臂从 [31]
  盒底下方过,[30]→[33]/[34]→[33] 竖落线走件间净空;⑥ [18] 沉 y=2260
  ([19]→[20] 布尔横线从其盒顶上方过);⑦ chatml 三段纵瀑布([21] 抬
  y=2200/[23] 沉 y=2900,[22] 双扇出主居中)+[24] 沉 y=2540——同横排时
  槽 y 全落 2400-2580 带,任何排法必有一段横扫邻段,纵错位后三段送线
  与 [12]→[26] 顶带横线(y=2785)全部走净空;⑧ [15] PE 开关抬 y=2460
  ([22] 直写长线近平飞收口,不再扫 [27] 盒顶);⑨ 组框 G1/G2/G3/G4
  边界随占位同步。既有谓词(横向排版/est 零重叠/横距≥200 纵距≥80/
  零负区 pos≥80/命名/内容互锁)全保持绿;接线与参数零改动(纯位置手术)。

幂等:全量确定性再生成——重跑输出逐字节一致(真源=本脚本,手改画布会被
重跑重置,Note 有维护警示)。前置守卫:现文件必须是「旧 benjiyaya 形」或
「本脚本产物形」,别的形状拒写(先验证再动手,铁律0)。

系统提示词来源:官方 v2 精简版逐字(research/13 §4 四源一致:官方件 widget
=docx=本仓存档 pe_i2i_system_prompt.txt=benjiyaya 插件内置);文末自带
"The user's edit instruction to rewrite is:" 收束句,拼 chatml 勿重复添加。
"""
import json
import os
import sys

WF = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "engines",
                  "comfyui", "workflows", "1_图片", "Q2-1图像", "2_图生图",
                  "qi21-edit.json")
WF = os.path.normpath(WF)

# ── 常量(逐字锚)───────────────────────────────────────────────────
UNET_FILE = "qwen_image_2.1_bf16.safetensors"
CLIP_FILE = "qwen3vl_8b_bf16_heretic.safetensors"   # 0924 用户令 TE 换 Heretic 当主力(官方件保留引擎家作备胎)
VAE_FILE = "qwen_image_2.1_vae_bf16.safetensors"
PE_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors"
# R26.4 LoRA 加速槽(09-24 统一接线);0929 并行化轮:viggle 支路本体件(model←[7]Cache)
LORA_FILE = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"
LORA_ID = 31                          # LoraLoaderModelOnly(viggle 支路,strength 0.8)
RR_V_A_ID, RR_V_B_ID = 28, 29   # VAE 顶通道(R26.4 随迁:长横穿上顶缘,样板=K2 件)
# 0929 并行化轮:steps 回归各支路 KSampler widget(面板=生效值,零摆设);
#   40=直出支路官方完整档 / 359=viggle 支路(0929 拉齐值,原 6=v0.2.1 系卡荐档)
STEPS_OFF, STEPS_ON = 40, 359
# 0929 并行化轮新锚:三支路采样器/seed 单源/单选择件(方案 B,design §2/§4)
KS_VIG_ID = 56                         # viggle 支路 KSampler(359 步 widget)
SEED_ID = 57                           # seed 单源 PrimitiveInt(默认 0 fixed,扇出三采样器)
SEL_ID = 58                            # MyQi21SpeedSelect(三支路 LATENT 汇流单选择)
T8_ID = 55                             # T8 采样器(Fun-Acc 支路)
SEL_CLASS = "MyQi21SpeedSelect"        # 自研件(my_nodes/nodes/my_qi21_speed_select.py)
# 档位 combo 闭集(=自研件 SPEED_MODES 逐字;首项=默认=直出40步,0929 拉齐重放裁定
# (Fun-Acc 仍为主加速=次序第二);分隔符=U+00B7 中点;列表即契约,与自研件单源
# 互锁,漂移拒生成)
SPEED_MODE_DIRECT = "0 · 直出40步"
SPEED_MODE_FUNACC = "2 · Fun-Acc 4步"
SPEED_MODE_VIGGLE = "1 · viggle"
SPEED_MODES = (SPEED_MODE_DIRECT, SPEED_MODE_FUNACC, SPEED_MODE_VIGGLE)
# 选择件槽序(inputs 声明序:mode=0 / latent_funacc=1 / latent_viggle=2 / latent_direct=3)
_SEL_SLOT = {SPEED_MODE_FUNACC: 1, SPEED_MODE_VIGGLE: 2, SPEED_MODE_DIRECT: 3}
# 0928 删踏脚石直连轮:RR_DIR[56]/RR_CMP[57]/RR_CLIP[58]/RR_A[46]/RR_TRUE[44]/
#   RR_FALSE[45] 六枚单入单出垫脚石删件直连(常量随之退役);VAE 顶通道 [28]/[29]
#   实测保留(删后交叉/线遮至少一增,见文件头本轮纪要)。
FUNACC_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"   # 已装机(models/loras/)
T8_CLASS = "T8QwenImage21FunAccPDD4Step"
# 0928 黑图修复轮(实弹判别七拍闭环:双参考条件×少步蒸馏=viggle6/T8_4 全黑,
# 单参考全真,档0 40步双参考真——根因=TextEncodeQwenImage21 同时吃 image_1(1.5MP
# 画布)+image_2(1.0MP 参考)的双参考 reference_latents 令少步蒸馏采样崩出纯黑;
# 40 步基座可积出真图)。0929 并行化迁移:正源差异内聚进各支路(positive 直入,
# 零开关)——直出支路 [8].positive=[6] 双参考(官方路零改动);viggle/FunAcc 支路
# [56]/[55].positive=[43] 单参考(仅 image_1,词源与 [6] 同源=[15] PE 开关输出)。
# [6] 恒执行(负向/latent 仍由其供),viggle/FunAcc 档时 [43] 亦入链(+~20s 编码);
# 直出档 [43] 懒旁路(其输出仅两加速支路消费)。
TE1_ID = 43  # 单参考编码(仅 image_1;viggle/FunAcc 支路正源,0928 黑图修复)

# 官方 i2i 系统提示词核心(research/13 四源一致;repr 注入保逐字)
SYSTEM_I2I = '# Edit Prompt Enhancer — General (v2, 精简版)\n\n**FIRST — there are TWO separate language decisions. Do NOT conflate them.**\n\n**(A) Language of the rewritten prompt\'s DESCRIPTIVE prose — every word OUTSIDE double quotes (the description you write for the diffusion model, NOT the text painted into the image). This decision is final and non-negotiable:**\n- User instruction is in Chinese → write the description in Chinese.\n- User instruction is in English → write the description in English.\n- User instruction is in ANY other language (Japanese, Korean, French, Spanish, Thai, etc.) → write the description in English.\n\n**(B) Language of the TEXT THAT WILL BE RENDERED INTO THE OUTPUT IMAGE — the content INSIDE double quotes. Decide it in this strict priority order:**\n1. If the user\'s instruction gives the exact text to write, OR names a target language for the text (e.g. "改成\'夏日特惠\'", "把标题写成英文", "add a Japanese title", "write the caption in Thai") → render exactly that text / in exactly that specified language.\n2. Otherwise, if the input image already contains text → render in the DOMINANT language of the image\'s existing text — even when the instruction is written in a different language.\n3. Otherwise (the image contains no text AND the instruction names no target language) → render in the language of the user\'s instruction itself — including Japanese, Korean, Thai, Arabic, French, etc. Do NOT force it to English.\nWorked example: image is mostly Thai, instruction is in English asking to add/redesign a title without giving the exact words or a language → the rendered (quoted) text must be **Thai** (the image\'s dominant language), while the surrounding description (A) is still written in English.\n\nTwo reinforcements on decision (B): all rendered (quoted) text must be **monolingual** — do not mix Chinese and English inside the quotes and do not emit a bilingual pair unless the user explicitly asks for one. And **genre never overrides input language**: a "spec sheet / cinematic data-document / storyboard / technical parameter" look is achieved through layout and typography, NOT by switching rendered labels to English — every header, label, and caption stays in the decided language (standardized units and user-given proper nouns may remain Latin).\n\nYou are an expert at clarifying image editing instructions. Given a user\'s vague or ambiguous edit instruction and the input image(s), rewrite it into a precise, unambiguous, actionable editing directive. An input image is ALWAYS present — this is always an image-editing task, never text-to-image from nothing.\n\n## Core Objective\n\nRewrite the instruction so a downstream image-editing model can execute it without guessing — anchored on what the input image(s) actually show, faithful to the user\'s intent, inventing nothing.\n\n**How much you build is intent-branched.** When the user wants *this picture changed* (a local object/attribute/background edit, a text or UI edit, a quality or style change, a viewpoint/canvas transform), clarify and constrain: say exactly what changes, and let everything else stand. When the user wants *a new picture of this subject* (placing a subject in a new scene, compositing across images, a photo-shoot or poster or infographic built from a reference), construct actively: design the scene, lighting, composition and layout to a professional standard. Scale the elaboration to what was asked — a plain placement stays restrained, a styled shoot or a publication-grade poster is built out fully.\n\n## The Governing Principle — Attribute Disentanglement at Full Strength\n\n**Edit exactly the attribute(s) the user named, push each to a strong and unmistakable degree, and hold everything else at input fidelity.**\n\nBoth halves matter, and the two failure modes are symmetric:\n\n- **Leakage** — touching what the user did not name (a sharpen that re-grades color, an upscale that reframes, a style change that drifts a face, an outfit swap that drops an accessory, a background change that "helpfully" cleans up something unmentioned).\n- **Under-editing** — an output a viewer could mistake for the unedited input, because the requested change was applied faintly.\n\nPreservation locks **content, never edit strength**. Recognizability is bought by naming what stays fixed, not by holding the effect back.\n\n## What to Anchor, What to Decide\n\n**Anchor on the image.** Every spatial, tonal and contextual claim comes from what is visibly there. If you are unsure a detail exists, leave it out — a preserved element described at a higher level of abstraction is always safer than an invented specific.\n\n**Say what stays, without repainting it.** Name the untargeted content by type, position and role rather than describing its appearance, and prefer one blanket preservation clause over walking the frame. A preservation description reads to the model as a generation instruction: the more concretely you describe something you meant to keep, the more likely it drifts. Describe appearance concretely only for what you are actually changing, or when it is the only way to disambiguate between similar objects.\n\n**Identity is the hardest invariant.** A person\'s facial identity and the personal accessories that make them recognizable; a product\'s exact design, markings and count; and the input\'s rendering medium (photograph, anime, illustration, sketch, 3D render, painting) all survive every edit unless the user explicitly targets them. When identity comes from a reference image, point at that image rather than describing features in words — verbal descriptions make the model regenerate and degrade the likeness.\n\n**Resolve ambiguity, then commit.** Turn vague intent, imprecise spatial reference and unparameterized style words into something concrete and observable. Translate abstract quality language into the visual properties it implies. Where the instruction offers alternatives or contradicts itself, pick the most reasonable reading and state it as a decision. Keep the user\'s own action verb, spatial relations and described state intact, and treat anything they asked to preserve as absolute. Preserve creative or physically impossible intent rather than correcting it.\n\n**Only what was asked.** Do not add operations the user did not request, and do not clean up unmentioned defects, overlays or clutter however prominent they look. When an edit removes, moves or reveals something, say enough about the newly exposed region that the result stays physically coherent.\n\n**Text in the image is literal.** Whenever readable text will appear in the output, commit to the exact characters — every element, quoted, nothing summarized or abbreviated away. Text you cannot commit to should not be added at all. Match the typography and language the input establishes unless the user asks otherwise. When the operation extends the canvas outward, name it as outpainting explicitly.\n\n**Write it as an instruction.** Lead with the operation, not a description of the finished picture, and write from the perspective of someone holding only the input image(s).\n\n## Thinking Process\n\nBefore emitting JSON, reason through: what the image(s) actually contain (including a complete reading of any text present); what the user is asking for and which attributes that names; what must therefore stay fixed; the output size; and finally the composed directive. Close with a check that every visible element is either the target of the edit or covered by what stays fixed, that the requested change is unmistakable, that nothing outside the target was touched, and that every quoted string obeys language decision (B).\n\n## Image Reference Rules\n\nFor Multi-Image Input (N >= 2), the rewritten instruction MUST use `<image1>`, `<image2>`, ... to refer to each input image. Do not use natural language references like "图1", "第一张图", "the first image", or "image A". This tagging format is mandatory and non-negotiable. For single-image input (N = 1), do NOT use tags — refer to the image naturally ("图像", "图片中", "the image").\n\nState each image\'s role explicitly — which one is the canvas whose composition and untargeted content survive, and which supply material to transfer — and say what is taken from each. For scene generation with no canvas (合影/合照 and the like), all images serve as identity sources. Describe every referenced image individually; never compress several into a range or a group to avoid describing them one by one.\n\n## Output Size Determination\n\nYou must determine two output fields: `wh_ratio` and `ratio_follow`. These two fields are mutually exclusive — when one has a value, the other must be empty string "".\n\n### Step 1: Check if the user explicitly specified a size or aspect ratio\n\nLook for any of the following in the user\'s edit instruction:\n- Exact pixel dimensions: "1920x1080", "800×600", "1080p"\n- Aspect ratios: "16:9", "4:3", "3:2", "9:16", "1:1"\n- Descriptive terms mapped to aspect ratios:\n  - "正方形" / "square" / "头像" / "avatar" / "profile picture" / "专辑封面" / "album cover" → "1:1"\n  - "横版" / "landscape" / "横屏" / "电脑壁纸" / "desktop wallpaper" / "宽屏" / "widescreen" / "视频封面" / "video thumbnail" / "PPT" / "幻灯片" / "slide" / "演示文稿" → "16:9"\n  - "竖版" / "portrait" / "竖屏" / "手机壁纸" / "phone wallpaper" / "手机屏幕" / "Instagram story" / "Stories" / "Reels" / "短视频封面" → "9:16"\n  - "手机全面屏" / "全面屏" / "iPhone屏幕" / "iPhone screen" → "18:39"\n  - "安卓全面屏" / "Android screen" → "9:20"\n  - "超宽" / "ultrawide" / "带鱼屏" → "7:3"\n  - "电影画面" / "cinematic" / "电影比例" / "宽银幕" / "cinemascope" → "21:9"\n  - "海报" / "poster" → "2:3"\n  - "证件照" / "ID photo" / "passport photo" / "小红书" / "Xiaohongshu" → "3:4"\n  - "iPad屏幕" / "tablet" / "平板屏幕" → "4:3"\n  - "全景图" / "panoramic" / "panorama" → "2:1"\n  - "名片" / "business card" → "9:5"\n  - "A4" → "5:7"(竖向)or "7:5"(横向)\n  - "1080p" / "720p" → "16:9"\n\n**High-resolution keywords ("2K", "4K", "8K") are quality descriptors, NOT aspect ratio indicators.** When the user mentions "2K", "4K", or "8K", these only express a desire for high image quality. They must NOT be used to infer or determine the aspect ratio. The aspect ratio should still be determined by other explicit cues or by the input image\'s ratio. For output resolution, always use 2K-level resolution regardless of whether the user says "2K", "4K", or "8K".\n\nIf the user specified a size or ratio:\n→ `wh_ratio` = the corresponding ratio (e.g., "16:9", "1:1", "3:2")\n→ `ratio_follow` = ""\n\nIf the user specified exact pixel dimensions (e.g., "1920x1080"), convert to the simplest integer ratio (1920:1080 = 16:9).\n\n### Step 2: If the user did NOT specify any size or ratio\n\n#### Single-image editing (1 input image):\nThe output should follow the input image\'s resolution.\n→ `wh_ratio` = ""\n→ `ratio_follow` = "<image1>"\n\n**Exception — Single-image scene generation**: If the task generates a new scene from scratch using the input image only as an identity reference (e.g., "拍一套写真", "cosplay成X", "穿越到古代"), do NOT follow the input image\'s ratio — the output is a new composition, not an edit of the existing image. Instead, choose `wh_ratio` by scene semantics:\n\n| Scene type | wh_ratio |\n|---|---|\n| Portrait / 写真 / half-body | "2:3" |\n| Full-body scene / outdoor activity | "3:4" |\n| Landscape-oriented scene | "3:2" |\n| No clear orientation hint | Follow the input image\'s ratio (set `ratio_follow` to `<image1>`, `wh_ratio` to "") |\n\n#### Multi-image editing (N ≥ 2 input images):\nYou must identify the **canvas image** (the image whose composition and framing the output should follow), then set `ratio_follow` to that image\'s tag.\n\n| Edit type | Canvas | ratio_follow |\n|---|---|---|\n| Compositing — transfer subject into a scene ("把A P到B中", "放到", "加入到") | The target scene image | "<imageX>" (scene image number) |\n| Face/head swap ("换脸", "换头") | The body image | "<imageX>" (body image number) |\n| Clothing swap ("换衣服", "换装") | The person image | "<imageX>" (person image number) |\n| Style transfer ("画成X的风格", "风格迁移") | The content image (not the style reference) | "<imageX>" (content image number) |\n| Background replacement | The foreground subject image | "<imageX>" (subject image number) |\n| Local object replacement | The original image being edited | "<imageX>" (original image number) |\n| Scene generation — no canvas ("合影", "合照", "一起变老", "让他们X") | No canvas — you must choose a ratio | See below |\n\nFor **scene generation tasks with no canvas** (合影, 合照, 一起吃饭, etc.), set `ratio_follow` = "" and choose `wh_ratio` by scene semantics:\n\n| Scene type | wh_ratio |\n|---|---|\n| Group photo / 合影 / 合照 | "3:2" |\n| Portrait / 写真 | "2:3" |\n| Poster / 海报 | "2:3" |\n| Desktop wallpaper | "16:9" |\n| Phone wallpaper | "9:16" |\n| No clear orientation hint | Follow the last input image\'s ratio (set `ratio_follow` to the last image, `wh_ratio` to "") |\n\n#### Outpainting (扩图 / 延伸画面):\n\nFor outpainting tasks where the user did NOT specify a target aspect ratio, do NOT simply follow the input image\'s ratio — outpainting changes the image\'s proportions by definition. Instead, infer the new ratio from the extension direction:\n\n- Extend **right only** or **left only**: widen the ratio. E.g., a 1:1 input → "3:2"; a 3:4 input → "1:1" or "4:3".\n- Extend **both left and right**: widen more aggressively. E.g., a 1:1 input → "16:9" or "2:1".\n- Extend **down only** or **up only**: make the ratio taller. E.g., a 1:1 input → "2:3"; a 16:9 input → "4:3" or "1:1".\n- Extend **both up and down**: make the ratio significantly taller. E.g., a 1:1 input → "9:16".\n- Extend **all sides**: keep the original ratio (the image grows uniformly).\n\nAs a general rule, estimate the extended area as roughly 30%–50% additional space in the specified direction(s), then compute the new W:H ratio accordingly. Set `ratio_follow` = "" and `wh_ratio` = the inferred ratio.\n\n#### Panoramic generation (全景 / panorama):\n\n| Panoramic type | wh_ratio |\n|---|---|\n| Standard panorama / 全景 | "2:1" |\n| Wide panorama / 超宽全景 | "3:1" |\n| 360° / VR panorama | "2:1" |\n| User specified a different ratio | Use the user\'s specified ratio |\n\nSet `ratio_follow` = "".\n\n#### Three-view drawings and multi-grid generation (三视图 / 多宫格):\n\nFor three-view or multi-panel grid generation where the user did NOT specify an aspect ratio, do NOT use a fixed default. Determine it adaptively from:\n\n1. **Subject shape proportion**: a tall standing person is vertically oriented, a car is horizontally oriented, a round object roughly square.\n2. **Panel layout arrangement**: how the panels are arranged (1×3 horizontal, 3×1 vertical, 2×2) and the shape of each panel.\n3. **Combined ratio**: (single panel W × columns) : (single panel H × rows), choosing the ratio that best fits the content without excessive empty space or cropping.\n\nExamples:\n- Three side-by-side views of a standing person (each panel ~1:3, portrait) → overall ratio = "1:1" — do NOT over-widen to "2:1" or "3:1", which would squash each portrait panel (use "3:1" only when each panel is itself landscape, e.g., a car)\n- Three side-by-side views of a car (each panel ~3:2) → overall ratio = "3:1" or "9:2"\n- 2×2 grid of a square object → overall ratio = "1:1"\n- 3×3 grid of square panels → overall ratio = "1:1"\n\nSet `ratio_follow` = "" and `wh_ratio` = the adaptively determined ratio.\n\n## Output Format\nOutput a valid JSON object with exactly three fields:\n```json\n{\n  "rewritten_prompt": "<the rewritten editing instruction>",\n  "wh_ratio": "<aspect ratio like \'16:9\', or empty string>",\n  "ratio_follow": "<\'<image1>\' / \'<image2>\' / ... / \'\'>"\n}\n```\n\n`rewritten_prompt` formatting rules:\n- The entire rewritten prompt must be a single continuous paragraph with NO line breaks or newline characters (`\\n`).\n- All text that should appear as visible, readable content in the output image must be enclosed in double quotes (""). Descriptive or structural language that does not appear as rendered text should NOT be quoted.\n- **Never include any resolution or aspect ratio information in `rewritten_prompt`** (e.g., "2:3", "16:9", "1920x1080", "2K", "4K"). Resolution and aspect ratio are conveyed exclusively through the `wh_ratio` and `ratio_follow` fields.\n- Write it out in full — no ellipsis, no truncation.\n- State requirements affirmatively ("保持背景与输入图完全一致") rather than as prohibitions ("禁止改变背景"). Standard preservation phrasing "保持/保留[X]不变" is fine.\n- Be precise and decisive: no hedging, no unresolved alternatives, no vague degree words left unresolved.\n- **Language-purge self-check (do this last)**: re-scan every double-quoted string — the text that will be RENDERED in the image — and enforce language decision (B). No quoted string may mix Chinese and English, form a bilingual pair, or carry a parenthetical translation gloss unless the user explicitly asked. Standardized units and user-given proper nouns may remain Latin.\n\nRules for each field:\n- `rewritten_prompt`: The rewritten editing instruction. The descriptive prose (outside double quotes) follows language decision (A); the text rendered inside the image (inside double quotes) follows language decision (B). Retain proper nouns and domain-specific terms in their original language, placed in English double quotes.\n- `wh_ratio`: The target aspect ratio as "W:H". Set to "" when the output resolution should follow an input image instead.\n- `ratio_follow`: Which input image\'s resolution the output should follow ("<image1>", "<image2>", …). Set to "" when a specific aspect ratio is provided in `wh_ratio`.\n\nMutual exclusivity rule:\n- If `wh_ratio` has a value → `ratio_follow` must be ""\n- If `ratio_follow` is "<imageX>" → `wh_ratio` must be ""\n\nDo not include any text outside the JSON object — no greetings, no explanations, no markdown code fences.\n\nThe user\'s edit instruction to rewrite is:\n'
A_SEG = "<|im_start|>system\n" + SYSTEM_I2I + "\n<|im_end|>\n<|im_start|>user"
C_SEG = "\n<|im_end|>\n<|im_start|>assistant\n<think>"
# 原始用户词默认=官方换装例句(短句;PE 开启时被改写,关闭时直写)
B_SEG = ("Put the light blue denim shirt from <image2> on the character "
         "in <image1>, keep everything else unchanged")
# 官方正则逐字(对 i2i 三字段 JSON 只抓 rewritten_prompt;wh_ratio 匹配不消费)
REGEX = '"rewritten_prompt"\\s*:\\s*"(.*?)"\\s*,\\s*"wh_ratio"\\s*:'

# 官方示例双图
IMG1, IMG2 = "portrait_model_denim.png", "clothing_light_blue_denim_shirt.png"

# TextGenerate widgets_values 序(官方件实读):
# [prompt, max_length, sampling_mode, temperature, top_k, top_p, min_p,
#  repetition_penalty, seed, presence_penalty, thinking,
#  use_default_template, mtp]
TG_WV = ["", 8192, "on", 0.7, 20, 0.95, 0.05, 1.05, 42, 1.5, False, False, "auto"]

NOTE = """## Qwen-Image-2.1 换装编辑 · 使用说明

**官方换装示例(两张图须先放引擎 input 目录)**

- image_1 = portrait_model_denim.png(编辑画布/人物)
- image_2 = clothing_light_blue_denim_shirt.png(参考/衬衫)

权重三件套同 t2i 件:qwen_image_2.1_bf16 + qwen3vl_8b_bf16_heretic(TE 破限件,0924 用户令换主力;CLIPLoader type=qwen_image)+ qwen_image_2.1_vae_bf16。

### 参数圣经(官方模板 Note 要点)

- **cfg 恒 1**(官方路径):负面提示词在 cfg=1 下**数学上不参与采样**——负面线保留接线为**官方同构占位**(不生效);要用负向须抬 cfg,非本产线口径;Fun-Acc 支路无负面槽。步数官方 40-50:直出支路 [8]=40 官方完整档/viggle 支路 [56]=359(0929 拉齐值,原 6)/Fun-Acc 支路 4 步内置于 [55] T8——三支路 steps 均为面板=生效值(0929 并行化轮消灭摆设值)。
- **resolution 是总像素预算非宽高**(保比例):官方默认 1024、上限 2048;本流取 **0=不重采样**(仅取整到 32 的倍数),输出尺寸跟随 image_1(预缩后)。
- **参考图语法**:提示词里用 `<image1>`..`<image10>` 点名;image_1=编辑目标画布,其余是参考;模型契约上限 10 图(节点槽 16)。
- **输入图预缩(0923 吸收,夸克实践)**:加载后先 ImageScaleToTotalPixels(lanczos·32 倍数)——画布 1.5MP、参考图 1.0MP;控显存+稳输入尺寸(速度与输入图尺寸/数量强相关)。
- **QwenImage21Cache(auto/default)**:KV 缓存设备/精度挂 UNETLoader 后,内存吃紧可调(cpu/int8)。

### 输出画幅双路(默认跟随输入图)

- **false(默认)**:latent 取 TextEncode.latent,跟随 image_1(预缩后)比例。
- **true**:EmptyLatentImage 自定义宽高(默认 1024×1024,直接改宽高 widget);自定义尺寸须贴近 image_1 比例,否则编辑漂移。

### RGBA 透明图句式(存 PNG 才保 alpha)

This is an RGBA format image with transparency. [your description]. The image has an alpha channel and a transparent background.

### 加速区·并行三支路+单选择件(0929 并行化轮;默认=直出40步(0929 拉齐重放裁定))

- **三条完整并行支路**(各支路自足 MODEL/steps,零注入零开关):0=直出 40 步(官方完整档)=[7]Cache→[8]KSampler;1=viggle 359 步=[7]Cache→[31] LoraLoaderModelOnly(0.8)→[56]KSampler;2=Fun-Acc·4步=[7]Cache→[55]T8。共享源单节点扇出(base MODEL/latent/负面/seed 一源三用,复用铁则:不重复出现节点)。
- **单选择件 [58] MyQi21SpeedSelect**(选择点唯一,居三支路汇流处):combo 三选一,首项=「0 · 直出40步」=默认(0929 拉齐重放,12:05 主会话复核;Fun-Acc 仍为主加速=次序第二);三支路 LATENT 汇流其三槽(latent_funacc/latent_viggle/latent_direct),输出接 [9] 解码。默认档仅初始值,随时可切任何档;加速启停语义=用户手动权威。
- **懒执行**:未选中支路整体不进执行图(check_lazy_status 只拉起选中支路,零空转零加载)。
- **seed 单源**:[57] PrimitiveInt(默认 0,fixed)一处扇出 [8]/[56]/[55] 三采样器(T8 seed 已输入化),一处改三支路同步生效。
- **步数=面板=生效值**:[8] steps=40/[56] steps=359 各支路 KSampler widget 真实生效(0929 并行化轮消灭摆设值);cfg 恒 1/euler/simple/denoise 1 照抄官方值。
- **支路1 viggle**:[31] 挂 **Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors**(viggle 蒸馏件已装机),strength 0.8(0925 探针最优:flatMAD 2.52→1.75),steps 359(0929 拉齐改值,原 6=v0.2.1 系卡荐档;cfg 保持 1)。
模型卡注 shift_terminal=0.02 伤末步,画质异常先查调度。
- **支路2 Fun-Acc**:[55] T8QwenImage21FunAccPDD4Step 接管采样——4步/sigmas 五值/euler/cfg1 全内置(勿外接采样器),无负面槽(负面词在该支路不参与);model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors(已装机 models/loras/);model=[7] Cache 直连 base 模型(绝不吃 viggle LoRA);seed 默认 0 固定可复现。实测速度(0926 三轮实弹):1024² 28.8s/2048² 130.7s(viggle 34.1/183.1,直出 214.7/1173.4)。TE 硬校验 4096 维,现产线 TE=qwen3vl_8b_bf16_heretic 已实测通过。
- **依赖警示:Fun-Acc 档需引擎装 Fun-Acc 插件(T8 节点,见设置页生态插件区 Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8)**;未装的机器该支路节点红/执行失败——降级=切回 0/1 档。
- TE-Speed 槽不加(3c 试装已死归档:插件未装=画布红节点,D4 终审永不装)。

### 加速档单参考正源(0928 黑图修复;viggle/Fun-Acc 支路专用)

- **实测事实(0928 实弹判别,七拍闭环)**:编码器同时吃双参考图(image_1 画布 1.5MP+image_2 参考 1.0MP)时,**viggle 6 步与 Fun-Acc 4 步两档少步蒸馏采样一律崩纯黑**(引擎报 success、尺寸对、全图唯一色=1);40 步直出档不受影响(步数够,可把双参考序列积出真图)。单参考(仅 image_1)两加速档全真——viggle 单参考 105s/Fun-Acc 单参考 120s 出真图。
- **修复接线(0929 并行化迁移:正源差异内聚进各支路,零开关)**:直出支路 [8].positive=[6] 双参考编码(官方路零改动);viggle/Fun-Acc 支路 [56]/[55].positive=[43] 单参考编码(仅 image_1,词源与 [6] 同源=[15] PE 开关)。
- [6] 恒执行(负面/latent 仍由其供,画幅随 image_1 不变);viggle/Fun-Acc 档时 [43] 亦入链(多一次视觉编码,约 +20s);直出档 [43] 懒旁路。
- 档0 的双参考语义零改动;选择件默认档=直出40步(正源走双参考 [6])。

### 提示词起草

已装技能 **qwen-image-2-1-prompter**(官方 PE 宪法封装)——起草/改写提示词时唤取它。

### PE-I2I 改写组([15] 开关,默认 PE 改写(0926 裁定1);关=直写按图选配;0923-r16 换核心免插件)

- 链路:PE CLIPLoader(pe_i2i bf16·type=qwen_image)→ 三段 chatml 拼装(StringFormat {a}{b}{c}:a=[21] 官方 i2i 系统提示词段/b=[22] 原始用户词/c=[23] assistant+`<think>` 预填段)→ [26] TextGenerate(comfy-core)→ [27] RegexExtract(抓 rewritten_prompt,dotall 免疫 think 长文)→ [15] ComfySwitch(false=[22] 原始用户词/true=PE 结果)。
- **PE 看全部输入图(双通道)**:[25] BatchImagesNode 合批全部(预缩后)输入图喂 [26].image;TextEncodeQwenImage21 只吃选定图(编码器通道)——改写需要全图上下文才能写 `<imageN>` 引用与判断画布。
- [26] 参数:use_default_template=false+thinking=false(`<think>` 预填是官方刻意设计,勿改 true);temp 0.7/topK 20/topP 0.95/minP 0.05/repPen 1.05/maxLength 8192/seed 42;**presence_penalty=1.5 已定档(0925 拍板:A/B 四维 57.5 vs 55.0 略优,保留 1.5)**。
- 关 [15](直写选配)时 PE 组不进执行图(ComfySwitchNode 懒执行,PE 模型不加载);默认开=PE 模型随首拍加载。
- PE 权重:text_encoders/qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors(bf16 自转件;官方 int8_convrot 在 MPS 首矩阵乘即死,勿装)。
- 系统提示词=官方 v2 精简版逐字(research/13 四源一致);文末自带收束句,拼 chatml 勿重复添加。

### 维护警示

本件由 apps/build/scripts/qwen21_edit_core_pe_0923.py 全量再生成(幂等,重跑逐字节一致);改布局/参数/提示词=改脚本再跑,手改画布会被重跑重置。

### 演进预研·道劫同脸精修迁 Q2.1(i2i 编辑句式,09-23 深检吸收立账)

- **编辑句式骨(官方 21 例全用此套,research/12 答A备3)**:身份/保真段永远写在变化段之前;参考图引用三式任用——`<image1>` / 【图1】 / 「第1-10张图」;身份锁定=Strictly preserve 全清单(须保真的五官/发型/体态/服饰要素逐项点名);句尾守恒句「不作重新构图或整体重绘」恒带。道劫同脸精修(K2-人脸精修-道劫)迁 Q2.1 时整套移植。
- **I2I PE 接线骨(research/10 §4.1/§5.3;edit 线 0923-r16 已换核心)**:全部输入图合批(BatchImagesNode)→ TextGenerate.image(官方原生路线,本流已采);t2i/道劫线暂为 benjiyaya QwenImage21_T2IPromptRewrite(pe_t2i 系检查点)——同检查点族同宪法同 JSON 字段,道劫换核心时照本件五件套抄。
"""


def node(nid, ntype, pos, size, inputs, outputs, widgets=None, order=None):
    n = {"id": nid, "type": ntype, "pos": pos, "size": size, "flags": {},
         "order": order if order is not None else nid, "mode": 0,
         "inputs": inputs, "outputs": outputs,
         "properties": {"Node name for S&R": ntype}}
    if widgets is not None:
        n["widgets_values"] = widgets
    return n


def inp(name, typ, link=None, shape=None, widget=False):
    e = {"name": name, "type": typ}
    if shape is not None:
        e["shape"] = shape
    if widget:
        e["widget"] = {"name": name}
    e["link"] = link
    return e


def out(name, typ, links):
    return {"name": name, "type": typ, "links": links}


def rr(nid, pos, in_link, out_link, typ="VAE"):
    """Reroute 顶通道拐点(R26.4 随迁;序列化逐字段=K2-角色设定-道劫.json 样板;
    0927 三档轮:typ 参数化——MODEL 直连臂/BOOLEAN 比较布尔/CONDITIONING positive)。"""
    return {
        "id": nid, "type": "Reroute", "pos": pos, "size": [75, 26],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "", "type": "*", "link": in_link}],
        "outputs": [{"name": "", "type": typ, "links": [out_link]}],
        "properties": {"showOutputText": False, "horizontal": False},
    }


def pint(nid, value, pos, out_links):
    """PrimitiveInt 常量(0929 并行化轮:seed 单源扇出三采样器;序列化=官方本地
    I2V-480P 模板实取样板;核心节点零自定义 title 铁律)。out_links=int 或 list。"""
    links_ = [out_links] if isinstance(out_links, int) else list(out_links)
    return {
        "id": nid, "type": "PrimitiveInt", "pos": pos, "size": [270, 90],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "value", "type": "INT", "widget": {"name": "value"}, "link": None}],
        "outputs": [{"name": "INT", "type": "INT", "links": links_}],
        "properties": {"cnr_id": "comfy-core", "Node name for S&R": "PrimitiveInt"},
        "widgets_values": [value, "fixed"],
        "widgets_values_named": {"value": value, "fixed": "fixed"},
    }


def build_nodes():
    return [
        # ── 行1 加载器(上)────────────────────────────────────────
        # 0926 线不遮节点轮:[1] 抬高走顶带(其 [1]→[7] 长线过 [2][3][6] 顶侧净空),
        # [3] 右移让 [2]→[6] 长线从其盒底下方通过(lane y≈675+ > 盒底 662)。
        # 0929 四块重画轮:[3] 上收 (2960,980)→(2960,460) 入①TE 列(est 同列纵距
        # 距 [2] est 底 366 恰 94≥80;[2]→[6]/[2]→[43] 两线从其新盒上方 y≈175 过)。
        node(1, "UNETLoader", [880, 140], [340, 84],
             [inp("unet_name", "COMBO", widget=True),
              inp("weight_dtype", "COMBO", widget=True)],
             [out("MODEL", "MODEL", [5])],
             [UNET_FILE, "default"], order=0),
        node(2, "CLIPLoader", [2880, 140], [360, 130],
             [inp("clip_name", "COMBO", widget=True),
              inp("type", "COMBO", widget=True),
              inp("device", "COMBO", shape=7, widget=True)],
             [out("CLIP", "CLIP", [3, 63])],
             [CLIP_FILE, "qwen_image", "default"], order=1),
        node(3, "VAELoader", [2960, 460], [340, 60],
             [inp("vae_name", "COMBO", widget=True)],
             [out("VAE", "VAE", [4, 28, 66])],
             [VAE_FILE], order=2),
        # ── 行2 主链:双图→预缩→编码→缓存→采样→解码→保存 ──────────
        node(4, "LoadImage", [2040, 1060], [340, 420],
             [inp("image", "COMBO", widget=True),
              inp("upload", "IMAGEUPLOAD", widget=True)],
             [out("IMAGE", "IMAGE", [1]), out("MASK", "MASK", None)],
             [IMG1, "image"], order=3),
        # 0929 四块重画轮:[16] 下移 (2220,540)→(2220,700) 脱①框入主链(est 同列
        # 纵距距 [4] est 顶 110≥80/距 [12] est 底 174≥80;[12]→[26] 长对角线从其
        # 盒顶上方 y≈665 过(余量 33px),[1]→[7] 顶带横线 y≈195-272 亦从上方过)。
        node(16, "ImageScaleToTotalPixels", [2220, 700], [330, 130],
             [inp("image", "IMAGE", link=1),
              inp("upscale_method", "COMBO", widget=True),
              inp("megapixels", "FLOAT", widget=True),
              inp("resolution_steps", "INT", widget=True)],
             [out("IMAGE", "IMAGE", [9, 11, 65])],
             ["lanczos", 1.5, 32], order=5),
        # 0926 线不遮节点轮:双图链改双子行——[5]→[17] 整链下沉 y=1560 行,
        # 让 [16] 的两条长线([16]→[6] 平飞 / [16]→[25] 斜穿)走原行 B 净空。
        node(5, "LoadImage", [2020, 2020], [340, 420],
             [inp("image", "COMBO", widget=True),
              inp("upload", "IMAGEUPLOAD", widget=True)],
             [out("IMAGE", "IMAGE", [2]), out("MASK", "MASK", None)],
             [IMG2, "image"], order=4),
        node(17, "ImageScaleToTotalPixels", [2700, 2040], [330, 130],
             [inp("image", "IMAGE", link=2),
              inp("upscale_method", "COMBO", widget=True),
              inp("megapixels", "FLOAT", widget=True),
              inp("resolution_steps", "INT", widget=True)],
             [out("IMAGE", "IMAGE", [10, 12])],
             ["lanczos", 1.0, 32], order=6),
        node(6, "TextEncodeQwenImage21", [4820, 740], [760, 480],
             [inp("clip", "CLIP", link=3),
              inp("images.image_1", "IMAGE", shape=7, link=9),
              inp("vae", "VAE", shape=7, link=4),
              inp("images.image_2", "IMAGE", shape=7, link=10),
              inp("prompt", "STRING", widget=True, link=22)],
             # 0929 并行化:positive 直喂直出支路 [8](双参考=官方路零改动);
             # negative 单源扇出两 KSampler(T8 无负面槽);latent 槽位照旧恒执行
             [out("positive", "CONDITIONING", [68]),
              out("negative", "CONDITIONING", [8, 77]),
              out("latent", "LATENT", [23])],
             ["", "", 0], order=7),
        # 0928 黑图修复新增:单参考编码 [43](仅 image_1,词源=[15] PE 开关与 [6]
        # 同源;双参考崩少步蒸馏→单参考全真,判别实弹 ec5e3357/af8bdd30;
        # 落位 [6] 正下带 y=1520 避 [1]→[7] 顶馈走廊,feeders 全走净空)
        # 0929 并行化:positive 直喂 viggle/FunAcc 两支路([56]/[55]),零开关
        node(TE1_ID, "TextEncodeQwenImage21", [4600, 1420], [760, 480],
             [inp("clip", "CLIP", link=63),
              inp("images.image_1", "IMAGE", shape=7, link=65),
              inp("vae", "VAE", shape=7, link=66),
              inp("prompt", "STRING", widget=True, link=67)],
             [out("positive", "CONDITIONING", [69, 76]),
              out("negative", "CONDITIONING", None),
              out("latent", "LATENT", None)],
             ["", "", 0], order=32),
        # 0929 并行化轮:[7] Cache=base MODEL 单源扇出三支路([40]→[8] 直连臂/
        # [30]→[31] viggle 链/[73]→[55] T8 直连臂);y 让 [6]→[8] 双 condition
        # 线从盒顶上方过、顶通道 [28] 线与 [6].negative→[56] 长横线从盒顶/盒底两侧过。
        # 0929 四块重画轮:y=640→660 入主链新框(上缘 660);盒底 780 仍让
        # [6].negative→[56] 长横线(该段 y≈818-822)38px 净空(700 会压线,弃)。
        node(7, "QwenImage21Cache", [7040, 660], [340, 120],
             [inp("model", "MODEL", link=5),
              inp("device", "COMBO", widget=True),
              inp("dtype", "COMBO", widget=True)],
             [out("MODEL", "MODEL", [40, 30, 73])],
             ["auto", "default"], order=20),
        # 支路0 直出(40 步官方完整档):steps 回归 widget=面板生效值(0929 消灭摆设值);
        # seed 输入化接 [57] 单源;positive=[6] 双参考(0928 黑图修复官方路零改动)
        node(8, "KSampler", [9400, 300], [330, 260],
             [inp("model", "MODEL", link=40),
              inp("positive", "CONDITIONING", link=68),
              inp("negative", "CONDITIONING", link=8),
              inp("latent_image", "LATENT", link=26),
              inp("seed", "INT", widget=True, link=78),
              inp("steps", "INT", widget=True)],
             [out("LATENT", "LATENT", [81])],
             [0, "fixed", STEPS_OFF, 1, "euler", "simple", 1], order=21),
        node(9, "VAEDecode", [11540, 500], [240, 50],
             [inp("samples", "LATENT", link=52), inp("vae", "VAE", link=35)],
             [out("IMAGE", "IMAGE", [29])], order=22),
        node(10, "SaveImage", [13370, 800], [380, 330],
             [inp("images", "IMAGE", link=29)], [],
             ["MYStudio"], order=23),
        # ── 0929 并行化轮·道劫加速区:三支路横向一行、三行纵叠,选择件居汇流点右侧 ──
        # 支路1 viggle:[7]Cache→[31]LoRA(0.8)→[56]KSampler(359 步 widget 生效值)
        node(LORA_ID, "LoraLoaderModelOnly", [7900, 1100], [340, 130],
             [inp("model", "MODEL", link=30),
              inp("lora_name", "COMBO", widget=True),
              inp("strength_model", "FLOAT", widget=True)],
             [out("MODEL", "MODEL", [74])],
             [LORA_FILE, 0.8], order=26),
        node(KS_VIG_ID, "KSampler", [9400, 820], [330, 260],
             [inp("model", "MODEL", link=74),
              inp("positive", "CONDITIONING", link=69),
              inp("negative", "CONDITIONING", link=77),
              inp("latent_image", "LATENT", link=50),
              inp("seed", "INT", widget=True, link=79),
              inp("steps", "INT", widget=True)],
             [out("LATENT", "LATENT", [82])],
             [0, "fixed", STEPS_ON, 1, "euler", "simple", 1], order=35),
        # 支路2 Fun-Acc:[55] T8 采样器(model=[7] Cache 直连 base,绝不吃 viggle
        # LoRA,R7 不变量;4步/采样全内置无负面槽;seed 输入化接 [57] 单源)
        node(T8_ID, T8_CLASS, [9400, 1440], [420, 250],
             [inp("model", "MODEL", link=73),
              inp("positive", "CONDITIONING", link=76),
              inp("latent_image", "LATENT", link=55),
              inp("model_file", "COMBO", widget=True),
              inp("seed", "INT", widget=True, link=80)],
             [out("LATENT", "LATENT", [83])],
             [FUNACC_FILE, 0], order=31),
        # seed 单源(默认 0 fixed,扇出三采样器;edit 旧 randomize→fixed 归一 t2i/i2i)
        # 0929 四块重画轮:[57] 上移三支路行间 (8400,1960)→(8630,1090)——
        # 三条扇出线长度骤减,主图交叉 61→56(网格搜索定值,--check 实跑收敛;
        # est 对 [31] 横距 390、对 [56]/[55] 全分离,W1 罩盖保持)
        pint(SEED_ID, 0, [8630, 1090], [78, 79, 80]),
        # 单选择件 MyQi21SpeedSelect(三支路 LATENT 汇流;combo 首项=直出40步=默认
        # (0929 拉齐重放);三槽全 lazy=未选支路零执行零加载;输出→[9] 解码=单解码)
        node(SEL_ID, SEL_CLASS, [10900, 800], [340, 170],
             [inp("mode", "COMBO", widget=True),
              inp("latent_funacc", "LATENT", link=83),
              inp("latent_viggle", "LATENT", link=82),
              inp("latent_direct", "LATENT", link=81)],
             [out("latent", "LATENT", [52])],
             [SPEED_MODE_DIRECT], order=36),
        # ── 行3 输出画幅双路 ──────────────────────────────────────
        # 0929 四块重画轮:[19] 上移 (6300,3000)→(6300,2340) 入主链新框
        # (est 同行横距距 [20] est 500≥200;link25 变近平飞,[18]→[20]/[6].latent
        # →[20] 两线从其新盒上方 y≈2206/1491 过)。
        node(19, "PrimitiveBoolean", [6300, 2340], [280, 90],
             [inp("value", "BOOLEAN", widget=True)],
             [out("BOOLEAN", "BOOLEAN", [25])],
             [False], order=17),
        # 0926 线不遮节点轮:[18] 下沉让 [19]→[20] 布尔横线从其盒顶上方通过。
        node(18, "EmptyLatentImage", [5380, 2120], [300, 120],
             [inp("width", "INT", widget=True),
              inp("height", "INT", widget=True),
              inp("batch_size", "INT", widget=True)],
             [out("LATENT", "LATENT", [24])],
             [1024, 1024, 1], order=18),
        node(20, "ComfySwitchNode", [7080, 2240], [280, 100],
             [inp("on_false", "LATENT", shape=7, link=23),
              inp("on_true", "LATENT", shape=7, link=24),
              inp("switch", "BOOLEAN", widget=True, link=25)],
             [out("output", "LATENT", [26, 50, 55])],
             [False], order=19),
        # ── 行4 PE 链前半:PE loader + chatml 三段 + 拼装 ───────────
        # 0926 线不遮节点轮(chatml 三段纵错位):三段同横排时任何一段的
        # 送线必横扫邻段盒(槽 y 全落在 2400-2580 带内,横排不可两全)——
        # 改纵瀑布:[21]a 段上抬/[23]c 段下沉/[22]b 段(双扇出主)居中,
        # [24] 拼装落位 y=2540,[12]→[26] 顶带横线(y=2785)从 [23] 盒顶上方过。
        # 0929 四块重画轮:[12] 上收 (440,3700)→(850,490) 入①框左下角(est 对
        # [1] 同列纵距 178/对 [11] 244,余皆分离);[12]→[26] 长对角线走
        # [17]/[25] 双盒下方(y@x2698=2310>2172/y@x2948=2636>1832),沿途
        # [4](x 带内 y 1552-1870 恒>盒底 1482)/[5](x 带内 y≤1870<盒顶 2018,
        # 上方过)/[21][22][24] 全净空;[1]→[7] 顶带横线 x≥1220 不入其盒(x≤1212)。
        node(12, "CLIPLoader", [850, 490], [360, 130],
             [inp("clip_name", "COMBO", widget=True),
              inp("type", "COMBO", widget=True),
              inp("device", "COMBO", widget=True)],
             [out("CLIP", "CLIP", [13])],
             [PE_CLIP_FILE, "qwen_image", "default"], order=8),
        node(21, "PrimitiveStringMultiline", [1380, 2600], [300, 180],
             [inp("value", "STRING", widget=True)],
             [out("STRING", "STRING", [14])],
             [A_SEG], order=9),
        node(22, "PrimitiveStringMultiline", [1420, 3960], [340, 180],
             [inp("value", "STRING", widget=True)],
             [out("STRING", "STRING", [15, 21])],
             [B_SEG], order=10),
        node(23, "PrimitiveStringMultiline", [1920, 4580], [260, 180],
             [inp("value", "STRING", widget=True)],
             [out("STRING", "STRING", [16])],
             [C_SEG], order=11),
        node(24, "StringFormat", [2440, 3760], [300, 130],
             [inp("values.a", "*", shape=7, link=14),
              inp("values.b", "*", shape=7, link=15),
              inp("values.c", "*", shape=7, link=16),
              inp("f_string", "STRING", widget=True)],
             [out("STRING", "STRING", [17])],
             ["{a}{b}{c}"], order=12),
        # ── 行5 PE 链后半:合批→生成→正则→开关 ────────────────────
        node(25, "BatchImagesNode", [2950, 1660], [260, 170],
             [inp("images.image0", "IMAGE", link=11),
              inp("images.image1", "IMAGE", shape=7, link=12)],
             [out("IMAGE", "IMAGE", [18])], order=13),
        node(26, "TextGenerate", [3470, 3160], [400, 450],
             [inp("clip", "CLIP", link=13),
              inp("image", "IMAGE", shape=7, link=18),
              inp("video", "IMAGE", shape=7),
              inp("audio", "AUDIO", shape=7),
              inp("prompt", "STRING", widget=True, link=17),
              inp("max_length", "INT", widget=True),
              inp("sampling_mode", "COMFY_DYNAMICCOMBO_V3", widget=True),
              inp("sampling_mode.temperature", "FLOAT", widget=True),
              inp("sampling_mode.top_k", "INT", widget=True),
              inp("sampling_mode.top_p", "FLOAT", widget=True),
              inp("sampling_mode.min_p", "FLOAT", widget=True),
              inp("sampling_mode.repetition_penalty", "FLOAT", widget=True),
              inp("sampling_mode.seed", "INT", widget=True),
              inp("sampling_mode.presence_penalty", "FLOAT", shape=7, widget=True),
              inp("thinking", "BOOLEAN", shape=7, widget=True),
              inp("use_default_template", "BOOLEAN", shape=7, widget=True),
              inp("mtp", "COMBO", shape=7, widget=True)],
             [out("generated_text", "STRING", [19])],
             TG_WV, order=14),
        node(27, "RegexExtract", [3950, 4720], [330, 260],
             [inp("string", "STRING", widget=True, link=19),
              inp("regex_pattern", "STRING", widget=True),
              inp("mode", "COMBO", widget=True),
              inp("case_insensitive", "BOOLEAN", widget=True),
              inp("multiline", "BOOLEAN", widget=True),
              inp("dotall", "BOOLEAN", widget=True),
              inp("group_index", "INT", widget=True)],
             [out("STRING", "STRING", [20])],
             ["", REGEX, "First Group", False, False, True, 1], order=15),
        # [15] PE 开关(0926 裁定1 PE 开路含画布本体:默认 true=PE 改写,关=直写选配;
        # 0926 线不遮节点轮:上抬 y=2460——[22] 直写长线近平飞收口,不再扫 [27] 盒顶)
        node(15, "ComfySwitchNode", [4040, 1760], [300, 110],
             [inp("on_false", "STRING", shape=7, link=21),
              inp("on_true", "STRING", shape=7, link=20),
              inp("switch", "BOOLEAN", widget=True)],
             [out("output", "STRING", [22, 67])],
             [True], order=16),
        # ── 说明卡(左缘独立,零重叠)──────────────────────────────
        node(11, "MarkdownNote", [80, 960], [940, 1100], [], [],
             [NOTE], order=24),
        # ── VAE 顶通道(R26.4 随迁:VAE→VAEDecode 长横穿上顶缘,零新增交叉;
        #    0928 删踏脚石直连轮实测保留:删后交叉/线遮至少一增;
        #    0926 线不遮节点轮 RR_V_A 随 [3] 右移至 2960 保恒向右;
        #    0929 四块重画轮:RR_V_A (4080,780)→(4450,680)——[3] 上收①框后
        #    [3]→[28]/[28]→[29] 走向重排,网格搜索定值,主图交叉 61→56)──
        rr(RR_V_A_ID, [4450, 680], 28, 34),
        rr(RR_V_B_ID, [9800, 220], 34, 35),
    ]


LINKS = [
    [1, 4, 0, 16, 0, "IMAGE"],      # [4] 画布 → 预缩A
    [2, 5, 0, 17, 0, "IMAGE"],      # [5] 参考 → 预缩B
    [3, 2, 0, 6, 0, "CLIP"],        # 主 CLIP → 编码.clip
    [4, 3, 0, 6, 2, "VAE"],         # VAE → 编码.vae
    [5, 1, 0, 7, 0, "MODEL"],       # UNET → Cache(②)
    [9, 16, 0, 6, 1, "IMAGE"],      # 预缩A → 编码.image_1(选定图通道)
    [10, 17, 0, 6, 3, "IMAGE"],     # 预缩B → 编码.image_2
    [11, 16, 0, 25, 0, "IMAGE"],    # 预缩A → 合批(③PE 看全图)
    [12, 17, 0, 25, 1, "IMAGE"],    # 预缩B → 合批
    [13, 12, 0, 26, 0, "CLIP"],     # PE loader → TextGenerate.clip
    [14, 21, 0, 24, 0, "STRING"],   # a 段 → 拼装
    [15, 22, 0, 24, 1, "STRING"],   # b 段(原始用户词)→ 拼装
    [16, 23, 0, 24, 2, "STRING"],   # c 段 → 拼装
    [17, 24, 0, 26, 4, "STRING"],   # chatml 全文 → TextGenerate.prompt
    [18, 25, 0, 26, 1, "IMAGE"],    # 合批 → TextGenerate.image
    [19, 26, 0, 27, 0, "STRING"],   # 生成原文 → 正则
    [20, 27, 0, 15, 1, "STRING"],   # rewritten_prompt → PE开关.on_true
    [21, 22, 0, 15, 0, "STRING"],   # 原始用户词 → PE开关.on_false
    [22, 15, 0, 6, 4, "STRING"],    # PE开关 → 编码.prompt
    [23, 6, 2, 20, 0, "LATENT"],    # 编码.latent → 画幅开关.on_false(④)
    [24, 18, 0, 20, 1, "LATENT"],   # 空潜 → 画幅开关.on_true
    [25, 19, 0, 20, 2, "BOOLEAN"],  # 布尔 → 画幅开关.switch
    [28, 3, 0, 28, 0, "VAE"],       # VAE → 顶通道(升,R26.4)
    [34, 28, 0, 29, 0, "VAE"],      # 顶横
    [35, 29, 0, 9, 1, "VAE"],       # → VAEDecode
    [29, 9, 0, 10, 0, "IMAGE"],
    [63, 2, 0, TE1_ID, 0, "CLIP"],                # 主 CLIP → 单参考编码.clip
    [65, 16, 0, TE1_ID, 1, "IMAGE"],              # 预缩A(1.5MP) → 单参考编码.image_1
    [66, 3, 0, TE1_ID, 2, "VAE"],                 # VAE → 单参考编码.vae
    [67, 15, 0, TE1_ID, 3, "STRING"],             # PE 开关 → 单参考编码.prompt(与[6]同源;[43] 无 image_2 槽,prompt 槽位前移=3)
    # ── 0929 并行化轮:三支路 + seed 单源 + 单选择(design §2/§5;research/03 §4.2)──
    [40, 7, 0, 8, 0, "MODEL"],       # Cache → 支路0 直出 KSampler.model(单源扇出①)
    [30, 7, 0, LORA_ID, 0, "MODEL"],       # Cache → LoRA.model(viggle 支路链头)
    [73, 7, 0, T8_ID, 0, "MODEL"],         # Cache → T8.model(base 直连,R7:绝不吃 viggle LoRA)
    [74, LORA_ID, 0, KS_VIG_ID, 0, "MODEL"],      # LoRA(0.8) → 支路1 viggle KSampler.model
    [68, 6, 0, 8, 1, "CONDITIONING"],     # [6].positive(双参考) → 支路0(0928 黑图修复:直出=官方路)
    [69, TE1_ID, 0, KS_VIG_ID, 1, "CONDITIONING"],  # [43].positive(单参考) → 支路1(黑图修复铁则)
    [76, TE1_ID, 0, T8_ID, 1, "CONDITIONING"],      # [43].positive(单参考) → 支路2(黑图修复铁则)
    [8, 6, 1, 8, 2, "CONDITIONING"],      # [6].negative(占位 W5) → 支路0
    [77, 6, 1, KS_VIG_ID, 2, "CONDITIONING"],       # [6].negative → 支路1(T8 无负面槽)
    [26, 20, 0, 8, 3, "LATENT"],    # 画幅开关 → 支路0 latent(单源扇出②)
    [50, 20, 0, KS_VIG_ID, 3, "LATENT"],   # 画幅开关 → 支路1 latent
    [55, 20, 0, T8_ID, 2, "LATENT"],       # 画幅开关 → 支路2 latent
    [78, SEED_ID, 0, 8, 4, "INT"],        # seed 单源 → 支路0(单源扇出③)
    [79, SEED_ID, 0, KS_VIG_ID, 4, "INT"],      # seed 单源 → 支路1
    [80, SEED_ID, 0, T8_ID, 4, "INT"],          # seed 单源 → 支路2(T8 seed 输入化)
    [81, 8, 0, SEL_ID, 3, "LATENT"],         # 支路0 → 选择件 latent_direct(槽序=声明序 funacc/viggle/direct)
    [82, KS_VIG_ID, 0, SEL_ID, 2, "LATENT"],       # 支路1 → latent_viggle
    [83, T8_ID, 0, SEL_ID, 1, "LATENT"],           # 支路2 → latent_funacc
    [52, SEL_ID, 0, 9, 0, "LATENT"],        # 选择件输出 → [9].samples(三支路汇流,单解码)
]

GROUPS = [
    # 0929 四块重画轮(三件统一口径):①加载器上收全部 TE(含 PE 专属 [12],与
    # i2i① 同构)——[3] 自主链框划出入 TE 列、[12] 自 PE 瀑布左下入①;②主链缩框
    # (上缘让①/下缘让 PE 组)+改名;②PE 子框按六件实测重立(旧框零全含已修);
    # ③仅上缘收编 [29] Reroute+底缘补 30 罩 [57];④输出([9][10])独立成块。
    # 坐标经 est 间距/线遮口径手算预检([3] 320→460/[12] (2880,440)→(2000,300)/
    # [7] 700→660 避 negative 长横线),--check 实跑收敛。
    {"id": 1, "title": "Qwen-Image-2.1 ①加载器(bf16 三件套[1][2][3]+PE-I2I 专属TE[12])",
     "bounding": [850, 90, 2480, 530], "color": "#3f789e", "flags": {}},
    {"id": 2, "title": "道劫·②图像·编码主链(双参考[4][5]预缩[16][17]/合批[25]→编码[6][43](上排=单参考[43]加速档正源0928)→[15]参考源选择→[7]缓存;空潜[18]+画幅开关[19][20];改写=②PE组;采样=③;出图=④)",
     "bounding": [1980, 660, 5460, 1850], "color": "#3f789e", "flags": {}},
    {"id": 3, "title": "道劫·②PE-I2I 改写组(默认 PE 开路·核心 TextGenerate[26] 看全部输入图;[21]指令手写位)",
     "bounding": [1310, 2550, 3000, 2480], "color": "#8864a8", "flags": {}},
    # 0929 并行化轮:W1 加速区组框随拓扑重建——罩三支路([8]直出/[31]+[56]viggle/
    # [55]FunAcc)+seed 单源 [57]+单选择件 [58]([7]Cache=共享上游,留主链带);
    # 0929 四块重画轮:上缘 250→190 收编 VAE 顶通道 [29],高度 1830→1860 罩 [57]
    {"id": 4, "title": "道劫·加速区(并行三支路:0=直出40步[8] / 1=viggle·359步[31]→[56] / 2=Fun-Acc·4步[55];单选择件[58] MyQi21SpeedSelect·combo首项=直出40步默认(0929拉齐重放);seed单源[57];加速档正源=单参考[43]/直出=双参考[6],0928黑图修复)",
     "bounding": [7870, 190, 3400, 1860], "color": "#4d9e6a", "flags": {}},
    # 0929 四块重画轮:④输出独立成块([9][10] 自零接触裸奔收编;标题对齐「道劫·」)
    {"id": 5, "title": "道劫·④输出([9]解码→[10]保存)",
     "bounding": [11510, 450, 2270, 730], "color": "#3f789e", "flags": {}},
]


def _trace_reroute(links, nodes, lid):
    """沿 link 反向溯源,穿过 Reroute 垫脚石回到实源节点 id。"""
    seen = set()
    while True:
        l = links[lid]
        oid = l[1]
        if nodes[oid]["type"] != "Reroute" or oid in seen:
            return oid
        seen.add(oid)
        lid = nodes[oid]["inputs"][0]["link"]


def preflight(old):
    """守卫:现文件必须是旧 benjiyaya 形或本脚本产物形,否则拒写。"""
    types = {n["type"] for n in old["nodes"]}
    old_shape = ("QwenImage21_EditPromptRewrite" in types
                 and "QwenImage21Cache" in types)
    new_shape = ("TextGenerate" in types and "BatchImagesNode" in types
                 and "QwenImage21Cache" in types)
    if not (old_shape or new_shape):
        sys.exit("拒写:现文件既非旧 benjiyaya 形亦非本脚本产物形(未知形状,"
                 "先人工核对再跑;铁律0 先验证再动手)。")
    return "旧 benjiyaya 形 → 升级" if old_shape else "已是核心化形 → 重生成(应零 diff)"


def verify(wf):
    """写盘自查(全套,零 pytest;任一红即非零退出)。"""
    errs = []
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf["links"]}
    by_type = lambda t: [n for n in wf["nodes"] if n["type"] == t]

    # 1 JSON 结构:前端格式必需字段;无桥格式混写
    for f in ("nodes", "links", "groups"):
        if not isinstance(wf.get(f), list):
            errs.append(f"缺前端格式字段 {f}")
    if "schemaVersion" in wf or "graph" in wf:
        errs.append("混入桥 API 格式字段")

    # 2 连线双向一致 + 槽型匹配
    for l in wf["links"]:
        lid, oid, oslot, tid, tslot, typ = l
        o, t = nodes[oid], nodes[tid]
        if typ != o["outputs"][oslot]["type"]:
            errs.append(f"link{lid} origin 槽型不匹配")
        if lid not in (o["outputs"][oslot].get("links") or []):
            errs.append(f"link{lid} origin.outputs 未登记")
        if t["inputs"][tslot].get("link") != lid:
            errs.append(f"link{lid} target.inputs 不匹配")

    # 3 纵向塔铁律:全连线 target.x > origin.x
    for l in wf["links"]:
        if not nodes[l[3]]["pos"][0] > nodes[l[1]]["pos"][0]:
            errs.append(f"link{l[0]} 未向右(纵向塔违规)")

    # 4 节点矩形零重叠(MarkdownNote 计入)
    ns = wf["nodes"]
    for i in range(len(ns)):
        for j in range(i + 1, len(ns)):
            a, b = ns[i], ns[j]
            if (a["pos"][0] < b["pos"][0] + b["size"][0]
                    and b["pos"][0] < a["pos"][0] + a["size"][0]
                    and a["pos"][1] < b["pos"][1] + b["size"][1]
                    and b["pos"][1] < a["pos"][1] + a["size"][1]):
                errs.append(f"节点重叠 {a['id']}/{b['id']}")

    # 4b 间距阈值(0925 布局美化轮:用户令「节点之间没有足够的距离」)——est 足迹口径
    #    (同 workflow_layout.est_size):同行(y 带交叠)横净距≥200 / 同列(x 带交叠)纵净距≥80;
    #    Reroute 通道件与 MarkdownNote 说明卡豁免;全图(含豁免件)est 盒零重叠(inspect 口径)。
    def _est_box(n):
        x, y = float(n["pos"][0]), float(n["pos"][1])
        w = max(250.0, float(n["size"][0]))
        rows = max(len(n.get("inputs", [])), len(n.get("outputs", [])))
        h = max(36 + 24 * rows + 30 * len(n.get("widgets_values") or []) + 28, float(n["size"][1]))
        return x, y, x + w, y + h

    boxes = [(n["id"], _est_box(n)) for n in ns]
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (ida, (ax0, ay0, ax1, ay1)), (idb, (bx0, by0, bx1, by1)) = boxes[i], boxes[j]
            if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                errs.append(f"est 足迹重叠(inspect 口径) {ida}/{idb}")
    real = [(n["id"], _est_box(n)) for n in ns if n["type"] not in ("Reroute", "MarkdownNote")]
    for i in range(len(real)):
        for j in range(i + 1, len(real)):
            (ida, (ax0, ay0, ax1, ay1)), (idb, (bx0, by0, bx1, by1)) = real[i], real[j]
            yov = min(ay1, by1) - max(ay0, by0)
            xov = min(ax1, bx1) - max(ax0, bx0)
            if yov > 0 and xov <= 0 and -(xov) < 200:
                errs.append(f"node{ida} 与 node{idb} 同行横距 {-(xov):.0f} <200(0925 间距令)")
            elif xov > 0 and yov <= 0 and -(yov) < 80:
                errs.append(f"node{ida} 与 node{idb} 同列纵距 {-(yov):.0f} <80(0925 间距令)")

    # 4c 零负区(0925 W6①;0926 收紧 pos≥40→≥80=实测发现项3 计划断言互锁):
    #    主图所有节点 pos≥80,整图平移至左上留边距,打开即全貌
    #    (本件无子图;t2i/i2i 子图件另有输出口最右谓词,此处不适用)
    for n in ns:
        if n["pos"][0] < 80 or n["pos"][1] < 80:
            errs.append(f"node{n['id']} 负区坐标 {n['pos']}(零负区:pos≥80)")

    # 4d 零线遮节点(0926 铁律:用户令「工作流的美化,你只管位置,不要线与节点
    #    彼此遮盖!」)——贝塞尔采样精判(刻意不用 bbox 走廊口径:走廊高估约
    #    5 倍,会产生大量假遮挡)。口径:节点盒=普通节点 size 字段(缺省
    #    [220,120]),Reroute 按 60×30;槽位=输出槽(节点右缘,top+25+
    #    origin_slot×20)/输入槽(左缘,top+25+target_slot×20);线=三次
    #    贝塞尔 P0=输出槽/P3=输入槽,P1=(P0.x+k,P0.y)/P2=(P3.x−k,P3.y),
    #    k=clamp(|dx|/2,40,200),41 点采样;任采样点落入非端点节点盒
    #    (±2 容差)即遮挡,两端点豁免。本件无子图,主图口径。
    def _occ_box(n):
        if n["type"] == "Reroute":
            w, h = 60.0, 30.0
        else:
            w, h = (n.get("size") or [220, 120])[:2]
        x, y = float(n["pos"][0]), float(n["pos"][1])
        return (x, y, x + w, y + h)

    def _occ_slot(n, slot, side):
        x0, y0, x1, _ = _occ_box(n)
        sy = y0 + 25 + (slot or 0) * 20
        return (x1, sy) if side == "out" else (x0, sy)

    def _bez(p0, p1, p2, p3, t):
        mt = 1 - t
        return (mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0]
                + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1]
                + 3 * mt * t * t * p2[1] + t ** 3 * p3[1])

    occ_boxes = {nid: _occ_box(n) for nid, n in nodes.items()}
    for l in wf["links"]:
        lid, oid, oslot, tid, tslot, _ = l
        p0 = _occ_slot(nodes[oid], oslot, "out")
        p3 = _occ_slot(nodes[tid], tslot, "in")
        k = max(40, min(200, abs(p3[0] - p0[0]) * 0.5))
        p1, p2 = (p0[0] + k, p0[1]), (p3[0] - k, p3[1])
        pts = [_bez(p0, p1, p2, p3, i / 40) for i in range(41)]
        hit = sorted(nid for nid, bx in occ_boxes.items()
                     if nid not in (oid, tid)
                     and any(bx[0] - 2 <= px <= bx[2] + 2
                             and bx[1] - 2 <= py <= bx[3] + 2
                             for px, py in pts))
        if hit:
            errs.append(f"link{lid} [{oid}]->[{tid}] 线遮节点 {hit}"
                        f"(0926 铁律:线不遮节点,挪位或垫 Reroute 让长线走净空)")

    # 3g. 交叉不增封顶(0928 用户裁定:「线不交叉的规则大于分组的规则」,入宪
    #     docs/comfyui-kb/画布布局规范-0928.md):主图口径(本件无子图);口径=同款贝塞尔
    #     24 点采样线段两两求交,每对线至多计 1 次;-10/-20 边界线跳过。
    #     **现值封顶起步防回归**,治理轮逐步拧紧至 0;
    #     优先级:交叉 > 组框美观——消交叉可打破组框单行/罩盖约束(契约随行同步)。
    #     0928 删踏脚石直连轮:69→68;0929 并行化轮:68→58(拆 13 逻辑件+约 20 连线,
    #     三支路扇出重构;残余=多源扇出至三行纵叠支路的结构性存量:同向多源扇出
    #     对交错槽位的目标序反转,后续棘轮轮继续拧)。
    _CROSS_BASELINE = {'主图': 58}
    def _cross_seg_int(a, b, c, d):
        def _cr(o, x, y):
            return (y[0] - o[0]) * (x[1] - o[1]) - (y[1] - o[1]) * (x[0] - o[0])
        d1, d2, d3, d4 = _cr(c, d, a), _cr(c, d, b), _cr(a, b, c), _cr(a, b, d)
        return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))

    def _slot(n, s, side):
        w, h = (60, 30) if n.get("type") == "Reroute" else (n.get("size") or [220, 120])[:2]
        x, y = n["pos"][0], n["pos"][1]
        sy = y + 25 + (s or 0) * 20
        return (x + w, sy) if side == "out" else (x, sy)

    def _bez(p0, p1, p2, p3, t):
        mt = 1 - t
        return (mt**3*p0[0]+3*mt*mt*t*p1[0]+3*mt*t*t*p2[0]+t**3*p3[0],
                mt**3*p0[1]+3*mt*mt*t*p1[1]+3*mt*t*t*p2[1]+t**3*p3[1])

    for _scope, _nodes, _links in (("主图", wf["nodes"], wf["links"]),):
        _byid = {n["id"]: n for n in _nodes}
        _wires = []
        for _l in _links:
            _oid, _os, _tid, _ts = _l[1], _l[2], _l[3], _l[4]
            _o, _t = _byid.get(_oid), _byid.get(_tid)
            if not _o or not _t:
                continue
            _p0 = _slot(_o, _os, "out")
            _p3 = _slot(_t, _ts, "in")
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

    # 5 计数器真值 ≥ 实存最大(0923 round7 红根因)
    if wf.get("last_node_id", 0) < max(nodes):
        errs.append("last_node_id 陈旧")
    if wf.get("last_link_id", 0) < max(links):
        errs.append("last_link_id 陈旧")

    # 6 groups:int id 互异;≤5(0929 四块重画轮:4→5,新增④输出独立成块;
    #   ①加载器+②主链+②PE 子框+③加速区+④输出);PE 组名锚;组内节点全含
    ids = [g.get("id") for g in wf["groups"]]
    if len(ids) != len(set(ids)) or not all(isinstance(i, int) for i in ids):
        errs.append("group id 非互异 int")
    if len(wf["groups"]) > 5:
        errs.append(f"group 超 5(0929 四块重画:①②②③④;{len(wf['groups'])})")
    # 0929 四块重画轮:硬约束1/2 入自查(评审员令:两两 bbox 交集空+非 Note 零
    # 裸奔须可复现,不靠提案方一次性脚本)——口径=pos+size 全含(pos 左上角)
    gs_ = wf["groups"]
    for _i in range(len(gs_)):
        for _j in range(_i + 1, len(gs_)):
            _a, _b = gs_[_i]["bounding"], gs_[_j]["bounding"]
            if (_a[0] < _b[0] + _b[2] and _b[0] < _a[0] + _a[2]
                    and _a[1] < _b[1] + _b[3] and _b[1] < _a[1] + _a[3]):
                errs.append(f"组框两两相交 {gs_[_i]['id']}/{gs_[_j]['id']}(硬约束1:主图组框 bbox 交集空)")
    def _covered(n_):
        return any(g["bounding"][0] <= n_["pos"][0]
                   and n_["pos"][0] + n_["size"][0] <= g["bounding"][0] + g["bounding"][2]
                   and g["bounding"][1] <= n_["pos"][1]
                   and n_["pos"][1] + n_["size"][1] <= g["bounding"][1] + g["bounding"][3]
                   for g in gs_)
    strays = [n["id"] for n in wf["nodes"]
              if n["type"] != "MarkdownNote" and not _covered(n)]
    if strays:
        errs.append(f"裸奔节点(非 Note 无组框全含,硬约束2;白名单=MarkdownNote):{strays}")
    if not any("PE-I2I 改写组" in g.get("title", "") and "默认 PE 开路" in g.get("title", "")
               for g in wf["groups"]):
        errs.append("缺 PE-I2I 改写组(默认 PE 开路)分组")
    # 0929 并行化轮:W1 加速区组框罩三支路+seed 单源+单选择件(六件;[7]Cache 共享上游留主链带)
    accel_ids = [8, LORA_ID, KS_VIG_ID, T8_ID, SEED_ID, SEL_ID]
    accel_grp = next((g for g in wf["groups"] if "道劫·加速区" in g.get("title", "")), None)
    if accel_grp is None:
        errs.append("W1 缺「道劫·加速区」组框(并行三支路+单选择件)")
    else:
        gx0, gy0 = accel_grp["bounding"][0], accel_grp["bounding"][1]
        gx1, gy1 = gx0 + accel_grp["bounding"][2], gy0 + accel_grp["bounding"][3]
        for nid in accel_ids:
            n = nodes[nid]
            if not (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                    and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1):
                errs.append(f"W1 加速区组框未罩住 [{nid}](方案C 组框收纳)")

    # 7 节点标题铁律:核心/第三方/自研件零自定义 title([58] 显示名走注册表 NODE_DISPLAY_NAME_MAPPINGS)
    titled = [n["id"] for n in wf["nodes"] if "title" in n]
    if titled:
        errs.append(f"核心节点带自定义 title:{titled}")

    # 8 孤儿可达(SaveImage 回溯;MarkdownNote 豁免)
    seen, stack = set(), [10]
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        for i in nodes[nid].get("inputs", []):
            if i.get("link") is not None:
                stack.append(links[i["link"]][1])
    orphans = sorted(i for i in nodes if i not in seen and i != 11)
    if orphans:
        errs.append(f"孤儿节点:{orphans}")

    # 9 加载器三件套 + PE loader 逐字
    assert_w = [
        ("UNETLoader", 0, UNET_FILE), ("VAELoader", 0, VAE_FILE),
        ("CLIPLoader", 0, PE_CLIP_FILE)]
    for typ, slot, want in assert_w:
        got = [n for n in by_type(typ) if n["widgets_values"][slot] == want]
        if len(got) != 1:
            errs.append(f"{typ}({want}) 应恰 1 个")
    main_clip = [n for n in by_type("CLIPLoader")
                 if n["widgets_values"][0] == CLIP_FILE]
    if len(main_clip) != 1 or main_clip[0]["widgets_values"][1] != "qwen_image":
        errs.append("主 CLIPLoader 文件/type 漂移")
    pe_clip = [n for n in by_type("CLIPLoader")
               if n["widgets_values"][0] == PE_CLIP_FILE]
    if pe_clip and pe_clip[0]["widgets_values"][1] != "qwen_image":
        errs.append("PE CLIPLoader type 应 qwen_image")

    # 10 KSampler 契约(0929 并行化:恰 2=直出[8]40步+viggle[56]359步,steps 回归 widget
    #     =面板生效值;cfg1/euler/simple/denoise1 照抄;seed 输入化接 [57] 单源,fixed 归一)
    ks = by_type("KSampler")
    if sorted(n["id"] for n in ks) != [8, KS_VIG_ID]:
        errs.append(f"KSampler 应恰 2(支路0 [8]+支路1 [{KS_VIG_ID}]),"
                    f"得 {sorted(n['id'] for n in ks)}")
    else:
        for nid, steps_want in ((8, STEPS_OFF), (KS_VIG_ID, STEPS_ON)):
            wv = nodes[nid]["widgets_values"]
            if not (wv[2] == steps_want and wv[3] == 1 and wv[4] == "euler"
                    and wv[5] == "simple" and wv[6] == 1):
                errs.append(f"[{nid}] KSampler 参数漂移(steps={steps_want}/cfg1/euler/simple/denoise1): {wv}")
            if wv[1] != "fixed":
                errs.append(f"[{nid}] seed control 应 fixed(0929 归一 t2i/i2i,原 randomize)")
            steps_inp = next((i for i in nodes[nid]["inputs"] if i.get("name") == "steps"), None)
            if not steps_inp or steps_inp.get("link") is not None:
                errs.append(f"[{nid}] steps 应回归 widget 零接线(面板=生效值,0929 消灭摆设值)")
    cache = by_type("QwenImage21Cache")
    if len(cache) != 1 or cache[0]["widgets_values"] != ["auto", "default"]:
        errs.append("QwenImage21Cache(auto/default) 应恰 1")
    else:
        up = links[cache[0]["inputs"][0]["link"]][1]
        dn_types = {nodes[links[lid][3]]["type"]
                    for lid in cache[0]["outputs"][0]["links"]}
        if nodes[up]["type"] != "UNETLoader" or \
                not dn_types <= {"KSampler", "LoraLoaderModelOnly", T8_CLASS}:
            errs.append("Cache 应挂 UNETLoader 后、扇出恰三支路([8]/[31]/[55],0929 单源扇出)")
        if len(cache[0]["outputs"][0]["links"]) != 3:
            errs.append("Cache.MODEL 应单源扇出恰三线(三支路 model,复用铁则)")

    # 11 ①核心 PE 链:TextGenerate 在场+参数;chatml 三段;正则;开关
    tg = by_type("TextGenerate")
    if len(tg) != 1:
        errs.append("TextGenerate 应恰 1")
    else:
        if tg[0]["widgets_values"] != TG_WV:
            errs.append(f"TextGenerate 参数漂移:{tg[0]['widgets_values']}")
        if links[tg[0]["inputs"][0]["link"]][1] != 12:
            errs.append("TextGenerate.clip 上游应 PE CLIPLoader")
    fmt = by_type("StringFormat")
    if len(fmt) != 1 or fmt[0]["widgets_values"] != ["{a}{b}{c}"]:
        errs.append("StringFormat {a}{b}{c} 应恰 1")
    psm = {n["id"]: n["widgets_values"][0] for n in by_type("PrimitiveStringMultiline")}
    if psm.get(21) != A_SEG:
        errs.append("a 段(官方 i2i 系统提示词 chatml)漂移")
    if psm.get(22) != B_SEG:
        errs.append("b 段(原始用户词)漂移")
    if psm.get(23) != C_SEG:
        errs.append("c 段(assistant+<think> 预填)漂移")
    rx = by_type("RegexExtract")
    if len(rx) != 1:
        errs.append("RegexExtract 应恰 1")
    else:
        wv = rx[0]["widgets_values"]
        if wv[1] != REGEX or wv[2] != "First Group" or wv[5] is not True:
            errs.append("RegexExtract pattern/mode/dotall 漂移")
        if links[rx[0]["inputs"][0]["link"]][1] != 26:
            errs.append("RegexExtract 上游应 TextGenerate")
    sw = nodes[15]
    if sw["type"] != "ComfySwitchNode" or sw["widgets_values"][0] is not True:
        errs.append("[15] PE 开关默认应 true(PE 开路,0926 裁定1 含画布本体;关=直写按图选配)")
    if links[sw["inputs"][0]["link"]][1] != 22:
        errs.append("PE 开关 on_false 应原始用户词 [22]")
    if links[sw["inputs"][1]["link"]][1] != 27:
        errs.append("PE 开关 on_true 应 RegexExtract [27]")
    if links[nodes[6]["inputs"][4]["link"]][1] != 15:
        errs.append("编码 prompt 上游应 PE 开关 [15]")

    # 12 ③多图双通道:合批喂 PE;编码器吃选定图
    batch = by_type("BatchImagesNode")
    if len(batch) != 1:
        errs.append("BatchImagesNode 应恰 1")
    else:
        wired = [i for i in batch[0]["inputs"] if i.get("link")]
        ups = {links[i["link"]][1] for i in wired}
        if len(wired) < 2 or ups != {16, 17}:
            errs.append("合批应接 ≥2 路(两预缩图,PE 看全图)")
        if links[18][3] != 26:
            errs.append("合批输出应喂 TextGenerate.image")
    te = by_type("TextEncodeQwenImage21")
    # 0928 黑图修复:恰 2 =双参考主编码 [6]+单参考编码 [43](加速档正源)
    if len(te) != 2 or sorted(n["id"] for n in te) != [6, TE1_ID]:
        errs.append(f"TextEncodeQwenImage21 应恰 2([6] 双参考+[{TE1_ID}] 单参考,0928),"
                    f"得 {sorted(n['id'] for n in te)}")
    else:
        main_te = nodes[6]
        imgs = [i for i in main_te["inputs"]
                if i["name"].startswith("images.") and i.get("link")]
        if len(imgs) < 2:
            errs.append("主编码器应接 ≥2 选定图")
        if {links[i["link"]][1] for i in imgs} != {16, 17}:
            errs.append("主编码器选定图上游应为两预缩图")
        if te[0]["widgets_values"][2] != 0:
            errs.append("resolution 应 0(不重采样)")
        if te[0]["widgets_values"][0] != "":
            errs.append("编码 prompt widget 应清空(连线供词)")
    scales = by_type("ImageScaleToTotalPixels")
    if len(scales) != 2:
        errs.append("预缩应恰 2(画布 1.5MP/参考 1.0MP)")
    else:
        mps = sorted(n["widgets_values"][1] for n in scales)
        if mps != [1.0, 1.5]:
            errs.append(f"预缩 MP 档漂移:{mps}")

    # 13 ④latent 双路(0927 三档轮:[30] 升级 PrimitiveInt 档位,PrimitiveBoolean 恰 1=[19] 画幅)
    pb = by_type("PrimitiveBoolean")
    if sorted(n["id"] for n in pb) != [19] or \
            any(n["widgets_values"][0] is not False for n in pb):
        errs.append(f"PrimitiveBoolean 应恰 1([19] 画幅;[30] 已升级 PrimitiveInt 档位)且默认 false")
    lsw = nodes[20]
    if lsw["type"] != "ComfySwitchNode" or lsw["widgets_values"][0] is not False:
        errs.append("画幅开关默认应 false(跟随 image_1)")
    if nodes[links[lsw["inputs"][0]["link"]][1]]["type"] != "TextEncodeQwenImage21":
        errs.append("画幅开关 on_false 应 TextEncode.latent")
    if nodes[links[lsw["inputs"][1]["link"]][1]]["type"] != "EmptyLatentImage":
        errs.append("画幅开关 on_true 应 EmptyLatentImage")
    if nodes[links[lsw["inputs"][2]["link"]][1]]["type"] != "PrimitiveBoolean":
        errs.append("画幅开关 switch 应 PrimitiveBoolean")
    if nodes[links[nodes[8]["inputs"][3]["link"]][1]]["id"] != 20:
        errs.append("KSampler.latent_image 上游应画幅开关 [20]")
    # 0929 并行化:三支路 latent 同源 [20](单源扇出;T8 latent 槽序=2)
    for nid, lslot in ((8, 3), (KS_VIG_ID, 3), (T8_ID, 2)):
        if nodes[links[nodes[nid]["inputs"][lslot]["link"]][1]]["id"] != 20:
            errs.append(f"[{nid}] latent_image 上游应画幅开关 [20](三支路同源)")
    el = by_type("EmptyLatentImage")
    if len(el) != 1 or el[0]["widgets_values"] != [1024, 1024, 1]:
        errs.append("EmptyLatentImage(1024×1024×1)应恰 1")

    # 13b 0929 并行化轮·加速区契约(design §2/§4/§5;research/03 §4.2/§7)
    # ① LoRA 支路件:[31] file/strength 锚定,model←[7] 单源,输出仅喂 [56]
    loras = by_type("LoraLoaderModelOnly")
    if len(loras) != 1 or loras[0]["id"] != LORA_ID:
        errs.append(f"LoraLoaderModelOnly[{LORA_ID}] 应恰 1 个(viggle 支路本体件)")
    else:
        if loras[0]["widgets_values"] != [LORA_FILE, 0.8]:
            errs.append(f"LoRA name/strength 漂移: {loras[0]['widgets_values']}")
        if links[loras[0]["inputs"][0]["link"]][1] != 7:
            errs.append("LoRA model 上游应 QwenImage21Cache[7](base 单源扇出)")
        if sorted(loras[0]["outputs"][0]["links"] or []) != [74]:
            errs.append(f"LoRA 输出应仅喂 viggle KSampler[{KS_VIG_ID}](link74)")
    # ② MODEL 单源扇出:Cache 直连三支路;T8.model 直连 base(R7:绝不吃 viggle LoRA)
    for lid_, want_oid, want_tid, tag in ((40, 7, 8, "直出支路"),
                                          (30, 7, LORA_ID, "viggle 链头"),
                                          (73, 7, T8_ID, "T8 base 直连(R7)"),
                                          (74, LORA_ID, KS_VIG_ID, "viggle 支路")):
        l_ = links[lid_]
        if (l_[1], l_[3]) != (want_oid, want_tid):
            errs.append(f"link{lid_} 接线漂移(应 [{want_oid}]→[{want_tid}] {tag}),得 [{l_[1]}]→[{l_[3]}]")
    # ③ 正源双路(0928 黑图修复保持;并行化迁移=positive 直入各支路零开关):
    #    直出支路=[6] 双参考(官方路)/viggle·FunAcc 支路=[43] 单参考(支路0 源≠支路1·2 源)
    if links[nodes[8]["inputs"][1]["link"]][1] != 6:
        errs.append("[8].positive 上游应 [6] 双参考编码(直出支路官方路零改动)")
    for nid in (KS_VIG_ID, T8_ID):
        if links[nodes[nid]["inputs"][1]["link"]][1] != TE1_ID:
            errs.append(f"[{nid}].positive 上游应单参考编码 [{TE1_ID}](0928 黑图修复铁则)")
    # ④ 负面占位(W5):[6].negative 扇出 [8]/[56](T8 无负面槽)
    for nid in (8, KS_VIG_ID):
        if links[nodes[nid]["inputs"][2]["link"]][1] != 6:
            errs.append(f"[{nid}].negative 上游应 [6](cfg=1 官方同构占位)")
    t8 = nodes[T8_ID]
    if t8["type"] != T8_CLASS:
        errs.append(f"[{T8_ID}] 应为 {T8_CLASS}(Fun-Acc PDD 采样器)")
    if t8["widgets_values"] != [FUNACC_FILE, 0]:
        errs.append(f"[{T8_ID}] model_file/seed 漂移(应 {FUNACC_FILE}/0),得 {t8.get('widgets_values')}")
    if len([i for i in t8["inputs"] if i.get("name") == "negative"]) != 0:
        errs.append(f"[{T8_ID}] T8 无负面槽(输入仅 model/positive/latent_image/model_file/seed)")
    if len(by_type(T8_CLASS)) != 1:
        errs.append(f"{T8_CLASS} 应恰 1 个(Fun-Acc 支路)")
    # ⑤ seed 单源:[57] PrimitiveInt(0,fixed)扇出恰三线;三支路 seed 全输入化(T8 含)
    seed = nodes[SEED_ID]
    if seed["type"] != "PrimitiveInt" or seed["widgets_values"][:2] != [0, "fixed"]:
        errs.append(f"[{SEED_ID}] seed 单源应 PrimitiveInt 默认 0 fixed,得 {seed.get('widgets_values')}")
    if sorted(seed["outputs"][0]["links"] or []) != sorted([78, 79, 80]):
        errs.append(f"[{SEED_ID}] seed 应扇出恰三线(三支路采样器,一处改三支路生效)")
    for nid, lid_ in ((8, 78), (KS_VIG_ID, 79), (T8_ID, 80)):
        sin = next((i for i in nodes[nid]["inputs"] if i.get("name") == "seed"), None)
        if not sin or sin.get("link") != lid_ or "widget" not in sin:
            errs.append(f"[{nid}] seed 应 widget 转输入接 [{SEED_ID}](link{lid_};T8 seed 输入化=三支路同源)")
    # ⑥ 单选择件 MyQi21SpeedSelect(方案 B):恰 1;combo 默认=首项=直出40步;三槽接线;输出→[9]
    sels = by_type(SEL_CLASS)
    if len(sels) != 1 or sels[0]["id"] != SEL_ID:
        errs.append(f"{SEL_CLASS}[{SEL_ID}] 应恰 1(单一选择点)")
    else:
        sel = sels[0]
        if sel["widgets_values"] != [SPEED_MODE_DIRECT]:
            errs.append(f"[{SEL_ID}] combo 默认应首项=直出40步「{SPEED_MODE_DIRECT}」"
                        f"(0929 拉齐重放),得 {sel.get('widgets_values')}")
        slot_names = [i.get("name") for i in sel["inputs"]]
        if slot_names != ["mode", "latent_funacc", "latent_viggle", "latent_direct"]:
            errs.append(f"[{SEL_ID}] 输入槽序应 mode/latent_funacc/latent_viggle/latent_direct"
                        f"(自研件声明序),得 {slot_names}")
        for slot_name, want_oid in (("latent_funacc", T8_ID),
                                    ("latent_viggle", KS_VIG_ID),
                                    ("latent_direct", 8)):
            s_in = next(i for i in sel["inputs"] if i.get("name") == slot_name)
            if links[s_in["link"]][1] != want_oid:
                errs.append(f"[{SEL_ID}].{slot_name} 上游应 [{want_oid}](对应支路采样器)")
        if sel["outputs"][0]["type"] != "LATENT":
            errs.append(f"[{SEL_ID}] 输出应 LATENT(选中支路原样直通)")
    if links[nodes[9]["inputs"][0]["link"]][1] != SEL_ID:
        errs.append(f"[9].samples 上游应 [{SEL_ID}] 选择件(三支路汇流,单解码)")
    # ⑦ 单参考编码 [43] 契约(0928 黑图修复件;0929 起为两加速支路正源,直连)
    te1 = nodes[TE1_ID]
    if te1["type"] != "TextEncodeQwenImage21":
        errs.append(f"[{TE1_ID}] 应为 TextEncodeQwenImage21(单参考编码)")
    if any(i.get("name") == "images.image_2" for i in te1["inputs"]):
        errs.append(f"[{TE1_ID}] 单参考编码不得带 image_2(双参考即黑图根因)")
    if links[te1["inputs"][1]["link"]][1] != 16:
        errs.append(f"[{TE1_ID}].image_1 上游应预缩A [16](与 [6] 同图同缩)")
    if _trace_reroute(links, nodes, te1["inputs"][3]["link"]) != 15:
        errs.append(f"[{TE1_ID}].prompt 上游应 [15] PE 开关(与 [6] 同源)")
    if links[te1["inputs"][2]["link"]][1] != 3:
        errs.append(f"[{TE1_ID}].vae 上游应 VAELoader[3](可穿垫脚石)")
    # ⑧ 懒执行三档干跑(选择件 check_lazy_status 语义:只回溯选中支路槽;
    #    mode_override=运行态切档模拟)
    def _sw_bool(node_):
        lid = node_["inputs"][2].get("link")
        if lid is not None:
            src = nodes[links[lid][1]]
            while src["type"] == "Reroute":   # 穿垫脚石(现图仅 VAE 顶通道 [28]/[29])
                src = nodes[links[src["inputs"][0]["link"]][1]]
            if src["type"] == "PrimitiveBoolean":
                return bool(src["widgets_values"][0])
        return bool(node_["widgets_values"][0])

    def _reach(mode_override=None):
        reach_, stack_ = set(), [10]  # SaveImage
        while stack_:
            nid = stack_.pop()
            if nid in reach_:
                continue
            reach_.add(nid)
            node_ = nodes[nid]
            if node_["type"] == SEL_CLASS:   # 选择件:只走选中档槽(懒)
                mode_ = mode_override if mode_override is not None \
                    else node_["widgets_values"][0]
                slots_ = [_SEL_SLOT[mode_]]
            elif node_["type"] == "ComfySwitchNode":
                slots_ = [1 if _sw_bool(node_) else 0]
            else:
                slots_ = range(len(node_.get("inputs", [])))
            for si in slots_:
                lid = node_["inputs"][si].get("link")
                if lid is not None:
                    stack_.append(links[lid][1])
        return reach_

    d_def = _reach()   # 默认态=combo 首项 直出40步(0929 拉齐重放)
    if 8 not in d_def:
        errs.append("干跑:默认态(直出40步)直出 KSampler 应在执行链(选中支路)")
    for nid, tag in ((T8_ID, "Fun-Acc T8"), (KS_VIG_ID, "viggle KSampler"),
                     (LORA_ID, "viggle LoRA")):
        if nid in d_def:
            errs.append(f"干跑:默认态(直出40步){tag} [{nid}] 不应执行(未选支路零执行零加载)")
    for nid in (6, 20, SEED_ID, 7):
        if nid not in d_def:
            errs.append(f"干跑:默认态(直出40步)支撑件 [{nid}] 应在执行链")
    if TE1_ID in d_def:
        errs.append(f"干跑:默认态(直出40步)正源应双参考 [6](单参考编码 [{TE1_ID}] 懒旁路)")
    d1 = _reach(SPEED_MODE_VIGGLE)
    if not ({LORA_ID, KS_VIG_ID} <= d1):
        errs.append(f"干跑:档1(viggle)执行图应含 LoRA[{LORA_ID}]+KSampler[{KS_VIG_ID}]")
    for nid in (8, T8_ID):
        if nid in d1:
            errs.append(f"干跑:档1 [{nid}] 不应执行(未选支路)")
    if TE1_ID not in d1 or 6 not in d1:
        errs.append(f"干跑:档1 正源应单参考 [{TE1_ID}] 且 [6] 恒执行(负面/latent 仍由其供)")
    d0 = _reach(SPEED_MODE_DIRECT)
    if 8 not in d0:
        errs.append("干跑:档0(直出)KSampler 应在执行链(40 步主线)")
    for nid in (LORA_ID, KS_VIG_ID, T8_ID):
        if nid in d0:
            errs.append(f"干跑:档0 [{nid}] 不应执行(未选支路,零 LoRA 零 T8)")
    if TE1_ID in d0:
        errs.append(f"干跑:档0 正源应回双参考 [6](单参考编码 [{TE1_ID}] 懒旁路)")
    if 6 not in d0 or 20 not in d0:
        errs.append("干跑:档0 [6]/[20] 应恒执行")
    # 0929 拉齐重放后默认=直出,档2(Fun-Acc)改经 override 显式核(三档覆盖只增不减)
    d2 = _reach(SPEED_MODE_FUNACC)
    if T8_ID not in d2:
        errs.append(f"干跑:档2(Fun-Acc)T8[{T8_ID}] 应在执行链(主加速支路)")
    for nid in (8, KS_VIG_ID, LORA_ID):
        if nid in d2:
            errs.append(f"干跑:档2 [{nid}] 不应执行(懒选择只拉起 Fun-Acc 支路)")
    if TE1_ID not in d2:
        errs.append(f"干跑:档2 正源应单参考 [{TE1_ID}](0928 黑图修复)")
    # ⑨ 零真重复(0929 复用铁则:同 type+同 widgets+同上游集合不得两件;
    #    两 KSampler 非重复论证=steps 40≠359+model 上游不同,并行支路本体 design §5.3)
    dup_key = {}
    for n_ in wf["nodes"]:
        if n_["type"] in ("Reroute", "MarkdownNote"):
            continue
        ups_ = frozenset((links[i_["link"]][1], links[i_["link"]][2], i_.get("name"))
                         for i_ in n_.get("inputs", []) if i_.get("link") is not None)
        key_ = (n_["type"], json.dumps(n_.get("widgets_values"), ensure_ascii=False), ups_)
        dup_key.setdefault(key_, []).append(n_["id"])
    for key_, ids_ in dup_key.items():
        if len(ids_) > 1:
            errs.append(f"真重复节点(同 type+widgets+上游集合):{ids_}"
                        f"(复用铁则:共享源单节点扇出,零真重复)")

    # 14 官方示例双图 + Note 要点
    imgs_loaded = sorted(n["widgets_values"][0] for n in by_type("LoadImage"))
    if imgs_loaded != [IMG2, IMG1]:
        errs.append(f"示例双图漂移:{imgs_loaded}")
    note = nodes[11]["widgets_values"][0]
    for token in ("cfg 恒 1",
                  "This is an RGBA format image with transparency.",
                  "qwen-image-2-1-prompter", "presence_penalty=1.5",
                  "BatchImagesNode", "TextGenerate", "ImageScaleToTotalPixels",
                  "LoraLoaderModelOnly", LORA_FILE,
                  "[55]", "[56]", "[57]", "[58]",
                  "0=直出 40 步", "1=viggle 359 步", "2=Fun-Acc", "降级=",
                  "shift_terminal=0.02", "TE-Speed",
                  # 0925 收窄轮新要点(W5 负面占位+pp 定档;摆设值要点随并行化消灭)
                  "数学上不参与采样", "官方同构占位", "已定档", "加速区",
                  # 0927 三档轮:依赖警示+档位语义+T8 事实(0929 并行化措辞迁移)
                  "依赖警示", "生态插件区", "Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8",
                  "T8QwenImage21FunAccPDD4Step", FUNACC_FILE, "无负面槽", "用户手动权威",
                  "懒执行", "绝不吃 viggle LoRA",
                  # 0929 并行化轮新要点(三支路+单选择+默认直出40步(拉齐重放)+seed 单源+面板生效值)
                  "并行三支路", SEL_CLASS, SPEED_MODE_DIRECT, "默认=直出40步",
                  "拉齐重放",
                  "seed 单源", "面板=生效值",
                  # 0928 黑图修复轮:单参考正源要点(0929 并行接线迁移)
                  "单参考正源", "崩纯黑", "唯一色=1", "[43]", "零改动"):
        if token not in note:
            errs.append(f"Note 缺要点:{token}")
    if note.lstrip().startswith("# "):
        errs.append("Note 一级大标题开幅违规")

    return errs


def _speed_modes_interlock():
    """combo 闭集与自研件 SPEED_MODES 单源互锁(design §4:combo 列表即契约)。"""
    import importlib.util
    p = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "engines",
                     "comfyui", "my_nodes", "nodes", "my_qi21_speed_select.py")
    p = os.path.normpath(p)
    if not os.path.exists(p):
        sys.exit(f"拒生成:自研件不存在({p};MyQi21SpeedSelect 先于工作流引用,design §6 部署时序)")
    spec = importlib.util.spec_from_file_location("my_qi21_speed_select", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    theirs = tuple(m for m, _slot in mod.SPEED_MODES)
    if theirs != SPEED_MODES:
        sys.exit(f"拒生成:自研件 SPEED_MODES 漂移 {theirs} ≠ 生成器 {SPEED_MODES}"
                 "(combo 闭集即契约,须与生成器同笔改)")


def _build_wf(old):
    return {
        "id": old.get("id", "8f4c1a92-6d27-4b8e-9a15-2c7d58b0e002"),
        "version": old.get("version", 0.4),
        "revision": old.get("revision", 0),
        "config": old.get("config", {}),
        "extra": old.get("extra", {}),
        "groups": GROUPS,
        "nodes": build_nodes(),
        "links": LINKS,
        # 0929 并行化轮:拆 13 件立 3 件,计数器真值随 build_nodes/LINKS 自动重算
        "last_node_id": max([27] + [n["id"] for n in build_nodes()]),
        "last_link_id": max([29] + [l[0] for l in LINKS]),
    }


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    check_only = "--check" in argv   # 只查不写(0929 补齐,与 t2i/i2i 入口能力对齐)
    _speed_modes_interlock()
    with open(WF, encoding="utf-8") as f:
        old = json.load(f)
    shape = preflight(old)

    wf = _build_wf(old)
    errs = verify(wf)
    if errs:
        for e in errs:
            print(f"  自查红:{e}", file=sys.stderr)
        sys.exit("写盘前自查未过,拒写盘。")
    if check_only:
        print(f"自查通过(只查不写 --check):{WF}({shape};节点 {len(wf['nodes'])}/"
              f"连线 {len(wf['links'])};构建态零红)")
        return

    with open(WF, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(WF, encoding="utf-8") as f:   # 写盘后磁盘态双跑(t2i/i2i 对齐)
        disk = json.load(f)
    errs2 = verify(disk)
    if errs2:
        for e in errs2:
            print(f"  自查红(磁盘态):{e}", file=sys.stderr)
        sys.exit("写盘后磁盘态自查未过。")
    print(f"再生成完成:{WF}({shape};节点 {len(wf['nodes'])}/连线 {len(wf['links'])}/group 5;"
          f"0929 并行化轮=拆除加速区 13 选择逻辑件([30][32][33][34][35][38][39][40][41]"
          f"[42][50][51][54]),立三并行支路:直出=[7]→[8]KSampler({STEPS_OFF}步)/"
          f"viggle=[7]→[{LORA_ID}]LoRA(0.8)→[{KS_VIG_ID}]KSampler({STEPS_ON}步)/"
          f"Fun-Acc=[7]→[{T8_ID}]T8(4步内置,model 直连 base 绝不吃 LoRA);"
          f"汇流 [{SEL_ID}] {SEL_CLASS}(combo 首项=「{SPEED_MODE_DIRECT}」=默认(0929 拉齐重放))→[9] 解码;"
          f"seed 单源 [{SEED_ID}](0,fixed)扇出三采样器(T8 seed 输入化);steps 回归各支路"
          f"widget(面板=生效值);正源:直出=[6] 双参考/加速档=[{TE1_ID}] 单参考"
          f"(0928 黑图修复保持);组框「道劫·加速区」随拓扑重建;自查零红"
          f"(构建态+磁盘态双跑;零真重复谓词新增;--check 只查入口补齐))")


if __name__ == "__main__":
    main()
