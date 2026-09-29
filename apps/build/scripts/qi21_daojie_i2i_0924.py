#!/usr/bin/env python3
"""qi21-道劫-i2i.json 幂等生成器(09-24,道劫风格图生图·生修合一架构纠正版)。

0929 加速区并行化轮·i2i(任务 09-29-qi21-acczone-parallel R3;用户令「使用并行
节点布局前面只有1个选择逻辑」+「不要重复出现1个节点,要进行复用」):
  - **拆注入式开关农场(13 选择逻辑件+2 垫脚石)**:[30]档位/[32]MODEL 开关/[164]
    steps 联动/[175]latent 路由/[185]正源开关(开关5,[187] 垫脚石)+[171][172][184]
    比较(3)+[173][174][183][165][166] 常量(6)+[179] 垫脚石——0927 三档轮「档位拆
    布尔→向共用 [8] 注入 MODEL/steps/latent」的注入式拓扑退役(反模式定谳=
    node-graph 技能「拓扑结构策略」章:每个注入量要开关+常量+比较器伺候);
  - **立三条完整并行支路**(各含自己的采样器,MODEL/steps 内聚,零注入):
    支路0 直出=[7]Cache→[8]KSampler(40 步,steps 回归 widget=面板值即生效值);
    支路1 viggle=[7]Cache→[31]LoRA(0.8)→[189]KSampler(359 步,0929 拉齐值);
    支路2 Fun-Acc=[7]Cache→[176]T8(4 步内置;model 直连 Cache,绝不吃 LoRA);
  - **单选择点=MyQi21SpeedSelect[190]**(R2 自研件;combo 首项=默认=直出40步=0929
    拉齐重放裁定(Fun-Acc 仍为主加速=次序第二);三 latent 槽全 optional 全 lazy=
    check_lazy_status 只拉起选中支路),
    居三支路汇流点右侧,输出→[9] 单点解码;选择逻辑件 13→1;
  - **seed 单源扇出**:新 [191] PrimitiveInt(默认 0 fixed)一源三用([8]/[189]/
    [176].seed,T8 seed 输入化)——消灭旧 [8] widget 与 [176] seed 两处分离(R5 债);
  - **黑图修复正源分线直入**(0928 语义原样):支路0 [8].positive=宿主 positive
    (双参考官方路)/支路1·2 [189]/[176].positive=宿主 positive_single(单参考)——
    [183][184][185] 正源开关组随注入式机构一并拆,正源差异内聚进各支路;
  - **复用铁则(R8)**:新增零真重复谓词(同 type+同上游集合+同 widgets 不得两件;
    两 KSampler 步数+model 上游均不同=并行支路本体,非真重复);
  - 布局:三支路横向一行(直出上/viggle 中/Fun-Acc 下,design §2 图同序)、三行
    纵叠、选择件居汇流点右侧,组框「道劫·加速区」罩六件;交叉基线按新拓扑实测重立。

0928 PE 链迁入装配子图轮·i2i(同构 t2i 0928 PE 迁子图轮,用户裁定「所有提示词
必须过 PE」+消灭主图 PE 链→[40] 的来回绕线;架构手术非坐标轮)+ 删踏脚石直连轮
(照用户在 t2i 的手动简化先例:纯中转 Reroute 删件直连,顶通道总线拐点以
「删后交叉与线遮两项都不增」实测权衡):
  - **PE-I2I 改写链七件迁入 [40] 装配子图**:[21]/[23] chatml 常量+[24] StringFormat
    拼装+[25] BatchImagesNode 合批(PE 看全图,改吃 -10 image_1/image_2 边界)+
    [26] TextGenerate+[27] RegexExtract+[15] 指令开关(PE开关);[22] 原始用户词
    留主图=指令①层唯一手写位,直喂宿主「指令」槽;[12] PE 专属 TE 留主图加载器
    行,经新增宿主输入槽 pe_clip 一进线(与 [2]/[3] 喂 [40] 同款);
  - **指令路径全程子图内**:[15] 输出直喂 [130] 拼接①.string_a(①层占位)——
    PE 改写的是指令(改什么),装配(BASE+锁层A)随后分层,功能语义与迁前逐字
    同构(i2i 语义:i2i 无画幅联动/比例推导链可迁——画幅随输入图,PE 的 wh_ratio
    输出本件不消费,正则只抓 rewritten_prompt);
  - **宿主面板新增「PE开关」**(BOOLEAN widget,默认 true=PE 开路,0926 裁定1
    不变,照「型选择」combo 暴露机制)+ pe_clip 输入槽;主图删 7 节点(PE 链
    七件),PE-I2I 改写组框退役为「指令外露带」组框;
  - 子图 4→6 行=源行→PE改写两带(chatml+合批 / 生成)→装配→编码→单参考编码
    (t2i 四行流水的 i2i 适配:PE 改写指令须先于装配;组框预算≤4=源行/PE生成/
    装配/编码,chatml 带+单参考行不设框);
  - **删踏脚石直连(实测口径=layout_check 立宪数学)**:子图 [175] clip 垫脚石
    删(中转段本计入交叉/线遮,直连后整线成 -10 边界线两口径同豁免,严格不增);
    主图各纯中转 Reroute 逐枚实测「删后交叉与线遮都不增」裁决,顶通道总线拐点
    有治理功用的保留并留注释;
  - **交叉计数(统一口径)主 65→64 / 子 10 持平**,_CROSS_BASELINE 棘轮同步重立
    (主图方向只收紧;子图 PE 七件迁入后六行重排,清零增量=与迁前持平);
    W2 同构谓词反转=「PE 链在子图内、主图零 PE 件」。

0928 重布局同构推排轮·i2i(承 t2i 先锋件方法论):
  坐标-only(links/widgets/文本/properties/组框标题逐字节不变,仅 pos 与 groups
  bounding 变,骨架对比已逐字节核验);主图重排=退火局部搜索+最小修复
  ([174]/[20]/[187] 挪出 [30]→[184] 竖走廊):主图交叉 74→65(-12%),
  _CROSS_BASELINE 棘轮同步 74→65(子图 10 不动);红线全绿(零线遮 41 点精判/
  恒向右/est 零重叠+横≥200 纵≥80/零负区/加速区罩盖);子图四行制原布局保持
  (手术试排无净收益,10 对=行2→行3/行4 跨行装配全文长线结构性存量,后续棘轮轮
  继续拧);手工大迁移方案(主链右移/加速区整块下移)经仿真否决(交叉反弹 83-101),
  i2i 局部最优深于 t2i(图像双路+PE 组+加速区三带互锁)。

0926 子图 pos≥80 收口(实测发现项3:子图整体归一平移,自查零负区阈值
40→80 与契约测试互锁)。

0926 线不遮节点收口(用户令「工作流的美化,你只管位置,不要线与节点彼此遮盖!」):
贝塞尔 41 点采样精判存量 13 条真遮挡全数清零,优先挪位置让跨行长线走净空走廊——
主图:行2 错位([5]/[17] 降 y=1300/1560 带、[25] 合批移 (3700,1600),[16] 的
跨行馈线走行2/行2c 框间净空);PE 链错位([21]/[23] 降 y=2900 带避开 [12]→[26]
y=2785 横馈走廊,[15] 开关升 (4980,2240) 让 [22]→[15] 走 [24] 上净空);
行3 立体化([28] 预览升 (6240,530)/[7] Cache 升 (6940,440)/[42] MODEL 顶通道
拐点右移 (6400,180),[40]→[8] 双馈线与 [42]→[7] MODEL 走廊上下分层;
加速区组框六件重排=[32] 顶带/[31] 底带/[30]·[165]·[166] 中带,同带横馈零交叉;
行3c [18] 降 y=2280 让 [19]→[20] 开关线走净空)。子图:行2 [162]/[163] 右移、
行3 [143] 左移 (2660,1580) 让 [131]→[142] 装配馈线走行2/行3 框间净空;唯一
不可避=[143]→[144].on_true 横穿同行 [142](行内三件同 y 带,左端编码器馈线
必过右端编码器)→ 垫 Reroute[170] 拐点走框间带(拐点不占行,样板=t2i 子图
W/H 通道 [171]-[174])。自查新增谓词「零线遮节点」(主图+子图同口径,子图
-10/-20 边界线照产线判定口径豁免);契约测试同步:[144].on_true 溯源可穿拐点。

Trellis 09-24-qi21-daojie-i2i(R24);PRD 09-24 架构纠正:Qwen-Image-2.1 生修合一,
**无传统 img2img——图输入即指令编辑**,旧 denoise 图生图设计(LoadImage→VAEEncode
→denoise)就此作废。本件=edit 骨架 + qi21 九型装配移植:

  骨架(承 qwen21_edit_core_pe_0923.py,R16 核心化版原样保留):
    LoadImage×2(官方示例双图)→[16/17]预缩(画布1.5MP/参考1.0MP)→[25]BatchImagesNode
    双通道(PE 看全图/编码器吃选图)→PE-I2I 链([12]专属 CLIPLoader+chatml 三段
    [21][22][23]+StringFormat[24]+TextGenerate[26]+RegexExtract[27]+开关[15],
    0926 裁定1 默认 true=PE-I2I 看图改写(PE 开路含画布本体;on_false=直写指令
    按图选配))→[40]装配子图;latent 双路([19]/[18]/[20],默认跟随
    image_1);QwenImage21Cache(auto)恒挂;KSampler 40步/cfg1/euler/simple/
    denoise1.0/seed fixed。
  九型装配移植(承 qi21_daojie_t2i_0923.py 任务一修好的装配子图段,裁画幅联动行):
    [40] 装配子图=MyQi21DaojieBase[150] 九选一(型选择=宿主面板 COMBO widget,
    默认人物;BASE 逐字=05库↔qi21_bases.json 互锁)+通用锁层A[110]恒挂+拼接
    [130][131](delimiter=\n 换行分层)+RGBA 官方头尾[160][161]+公式拼接
    [162][163]+双路编码[142][143]+RGBA 开关[144](宿主面板,默认 false)。
    **拼接次序(执行期定稿,05 库 §一四层装配口径)**:①主体句位=改图指令占位
    (指令即主体——[15] 开关输出接宿主「指令」槽),②型底座+③通用锁层照 t2i
    分层逐字追加;装配全文=指令+\\n+BASE+\\n+锁层A。
  加速槽(09-24 定案:出生只带 LoRA 槽;事实=R23 research/02):
    [1]UNETLoader→[41/42]顶通道→[7]Cache→⟨[32]MODEL 开关(false=[7]直连/
    true=[31]LoraLoaderModelOnly,name 预填 Qwen-Image-2.1-viggle-turbo-4step-
    lora-r64.safetensors,strength 0.8)⟩→[8]KSampler;[30]PrimitiveBoolean
    默认 false=旁路。**TE-Speed 槽永不带**(3c 试装已死归档:插件未装=画布
    红节点,D4 终审永不装;t2i/edit 已于 R26.4 同构补入 LoRA 槽)。
  布局(0925 布局美化轮·用户令「线非常杂乱,节点之间没有足够的距离…装配子图节点的
  标题过长,并且子图里面的线,节点都非常杂乱」):子图行距 560→720、行内列距一律≥200
  (est 足迹口径)、同列纵距≥80;IO 槽归位——clip/vae/image_1/image_2 落行3 左下带
  自下而入(双目标馈线与 [131]→[142]/[163]→[143] 降线共端点豁免),prompt/latent/
  positive/negative 输出 IO 落各自出线近旁;主图骨架随 edit 件重排([25] 合批上移
  主链行、[12] PE loader 下移行5、宿主右移 2000 让 [15]→[40] 指令升线走净空柱、
  Cache/LoRA 带/steps 三件上顶带、[19]/[18]/[20] 画幅双路随宿主右侧):主图交叉
  16→3、子图 7→1;子图 name 缩短为「[40] 道劫·装配子图(双击进入)」(宿主无 title
  展示名=子图 name,≤20 字;0924-r8 零自定义 title 铁律下功能性说明住 Note)。
  0925 加速与展示全量外露收窄轮(Trellis 09-25-qi21-speed-subgraph,W1/W5/W6):
    W1 加速区组框收纳(方案C 原生组框):[30][31][32][164][165][166] 六件入主画布
    「加速区」组框,主图 group 预算 3→4;W5 Note 两笔终审:负面线=cfg=1 下数学上
    不参与采样、占位为官方同构;PE presence_penalty=1.5 定档(A/B 四维 57.5 vs
    55.0 略优);[8] 面板 steps 显 40=摆设值注明;W6 画布归一:主图整体平移零负区
    (全部节点 pos≥40,打开即全貌)+子图行带下移 140(三行 y=140/860/1580);子图
    输出 IO 槽钉死最右列(x=4700,表示法=K2-文生图-道劫 [90] 实证:输出槽 x 超过
    全子图最右节点,纵向堆叠);自查新增两谓词:零负区(主图+子图所有节点 pos≥40)
    +输出口最右(子图输出接口 x≥全子图最大 x-50)。t2i 件另有 W2 PE 链迁出子图/
    W3 子图收窄(PE 位置三件同构=均主画布),见其生成器。

  布局(照任务一 09-24 布局整治标准,从出生合规):
    恒向右(全连线 target.x>origin.x)/行式从上到下、行内从左到右/group int id
    互异/长横穿走顶部 Reroute 通道(MODEL y=-560/VAE y=-640,序列化=K2-角色
    设定-道劫.json 顶层级样板)/节点标题铁律=核心与第三方节点零自定义 title,
    仅自研(My*)可命([150] 描述性功能名 title;0925 归位:节点标题零道劫前缀,
    道劫只留 Group 框/子图名/说明卡)。

幂等:全量确定性再生成,重跑逐字节一致(真源=本脚本;主体句默认/锁层全文从
05 库现读,BASE 真源=qi21_bases.json 磁盘热读,库更新重跑即同步)。前置守卫:
现文件必须是本脚本产物形(含 MyQi21DaojieBase 子图+TextGenerate+LoraLoader
ModelOnly),别的形状拒写(铁律0)。

不动 K2 存档 9 件;qi21-edit.json 本体零改动(注:R26.4 起 edit 件由其
生成器自行补 LoRA 槽);引擎家 git 恒 0;userdata
零写入;TE-Speed 槽禁入本件(3c 死,永不装)。

用法:
    python3 apps/build/scripts/qi21_daojie_i2i_0924.py            # 生成(写盘+自查)
    python3 apps/build/scripts/qi21_daojie_i2i_0924.py --check    # 只查不写
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

# ── 真源定位(零 cwd 依赖)──────────────────────────────────────────
_SCRIPT = pathlib.Path(__file__).resolve()
_REPO = _SCRIPT.parents[3]  # scripts → build → apps → 仓库根
_Q21_DIR = _REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
I2I_JSON = _Q21_DIR / "2_图生图" / "qi21-道劫-i2i.json"
PROMPT_LIB = _REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
BASES_JSON = _REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
QI21_BASES_JSON = _REPO / "apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json"

WF_UUID = "8a14d6f0-52b9-4c7d-a3e8-6f1b2c3d4e5f"   # 工作流 id,固定值幂等
SG_UUID = "d47c9e21-8f36-4a5b-b0c9-2e8d4f6a8c1d"   # 装配子图 uuid,固定值幂等

# ── 常量(逐字锚;承 edit 生成器)───────────────────────────────────
UNET_FILE = "qwen_image_2.1_bf16.safetensors"
CLIP_FILE = "qwen3vl_8b_bf16_heretic.safetensors"   # 0924 用户令 TE 换 Heretic 当主力(官方件保留引擎家作备胎)
VAE_FILE = "qwen_image_2.1_vae_bf16.safetensors"
PE_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors"
LORA_FILE = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"

# 官方 i2i 系统提示词核心(research/13 四源一致;repr 注入保逐字)——与 edit 生成器逐字节同源
SYSTEM_I2I = '# Edit Prompt Enhancer — General (v2, 精简版)\n\n**FIRST — there are TWO separate language decisions. Do NOT conflate them.**\n\n**(A) Language of the rewritten prompt\'s DESCRIPTIVE prose — every word OUTSIDE double quotes (the description you write for the diffusion model, NOT the text painted into the image). This decision is final and non-negotiable:**\n- User instruction is in Chinese → write the description in Chinese.\n- User instruction is in English → write the description in English.\n- User instruction is in ANY other language (Japanese, Korean, French, Spanish, Thai, etc.) → write the description in English.\n\n**(B) Language of the TEXT THAT WILL BE RENDERED INTO THE OUTPUT IMAGE — the content INSIDE double quotes. Decide it in this strict priority order:**\n1. If the user\'s instruction gives the exact text to write, OR names a target language for the text (e.g. "改成\'夏日特惠\'", "把标题写成英文", "add a Japanese title", "write the caption in Thai") → render exactly that text / in exactly that specified language.\n2. Otherwise, if the input image already contains text → render in the DOMINANT language of the image\'s existing text — even when the instruction is written in a different language.\n3. Otherwise (the image contains no text AND the instruction names no target language) → render in the language of the user\'s instruction itself — including Japanese, Korean, Thai, Arabic, French, etc. Do not force it to English.\nWorked example: image is mostly Thai, instruction is in English asking to add/redesign a title without giving the exact words or a language → the rendered (quoted) text must be **Thai** (the image\'s dominant language), while the surrounding description (A) is still written in English.\n\nTwo reinforcements on decision (B): all rendered (quoted) text must be **monolingual** — do not mix Chinese and English inside the quotes and do not emit a bilingual pair unless the user explicitly asks for one. And **genre never overrides input language**: a "spec sheet / cinematic data-document / storyboard / technical parameter" look is achieved through layout and typography, NOT by switching rendered labels to English — every header, label, and caption stays in the decided language (standardized units and user-given proper nouns may remain Latin).\n\nYou are an expert at clarifying image editing instructions. Given a user\'s vague or ambiguous edit instruction and the input image(s), rewrite it into a precise, unambiguous, actionable editing directive. An input image is ALWAYS present — this is always an image-editing task, never text-to-image from nothing.\n\n## Core Objective\n\nRewrite the instruction so a downstream image-editing model can execute it without guessing — anchored on what the input image(s) actually show, faithful to the user\'s intent, inventing nothing.\n\n**How much you build is intent-branched.** When the user wants *this picture changed* (a local object/attribute/background edit, a text or UI edit, a quality or style change, or a viewpoint/canvas transform), clarify and constrain: say exactly what changes, and let everything else stand. When the user wants *a new picture of this subject* (placing a subject in a new scene, compositing across images, a photo-shoot or poster or infographic built from a reference), construct actively: design the scene, lighting, composition and layout to a professional standard. Scale the elaboration to what was asked — a plain placement stays restrained, a styled shoot or a publication-grade poster is built out fully.\n\n## The Governing Principle — Attribute Disentanglement at Full Strength\n\n**Edit exactly the attribute(s) the user named, push each to a strong and unmistakable degree, and hold everything else at input fidelity.**\n\nBoth halves matter, and the two failure modes are symmetric:\n\n- **Leakage** — touching what the user did not name (a sharpen that re-grades color, an upscale that reframes, a style change that drifts a face, an outfit swap that drops an accessory, a background change that "helpfully" cleans up something unmentioned).\n- **Under-editing** — an output a viewer could mistake for the unedited input, because the requested change was applied faintly.\n\nPreservation locks **content, never edit strength**. Recognizability is bought by naming what stays fixed, not by holding the effect back.\n\n## What to Anchor, What to Decide\n\n**Anchor on the image.** Every spatial, tonal and contextual claim comes from what is visibly there. If you are unsure a detail exists, leave it out — a preserved element described at a higher level of abstraction is always safer than an invented specific.\n\n**Say what stays, without repainting it.** Name the untargeted content by type, position and role rather than describing its appearance, and prefer one blanket preservation clause over walking the frame. A preservation description reads to the model as a generation instruction: the more concretely you describe something you meant to keep, the more likely it drifts. Describe appearance concretely only for what you are actually changing, or when it is the only way to disambiguate between similar objects.\n\n**Identity is the hardest invariant.** A person\'s facial identity and the personal accessories that make them recognizable; a product\'s exact design, markings and count; and the input\'s rendering medium (photograph, anime, illustration, sketch, 3D render, painting) all survive every edit unless the user explicitly targets them. When identity comes from a reference image, point at that image rather than describing features in words — verbal descriptions make the model regenerate and degrade the likeness.\n\n**Resolve ambiguity, then commit.** Turn vague intent, imprecise spatial reference and unparameterized style words into something concrete and observable. Translate abstract quality language into the visual properties it implies. Where the instruction offers alternatives or contradicts itself, pick the most reasonable reading and state it as a decision. Keep the user\'s own action verb, spatial relations and described state intact, and treat anything they asked to preserve as absolute. Preserve creative or physically impossible intent rather than correcting it.\n\n**Only what was asked.** Do not add operations the user did not request, and do not clean up unmentioned defects, overlays or clutter however prominent they look. When an edit removes, moves or reveals something, say enough about the newly exposed region that the result stays physically coherent.\n\n**Text in the image is literal.** Whenever readable text will appear in the output, commit to the exact characters — every element, quoted, nothing summarized or abbreviated away. Text you cannot commit to should not be added at all. Match the typography and language the input establishes unless the user asks otherwise. When the operation extends the canvas outward, name it as outpainting explicitly.\n\n**Write it as an instruction.** Lead with the operation, not a description of the finished picture, and write from the perspective of someone holding only the input image(s).\n\n## Thinking Process\n\nBefore emitting JSON, reason through: what the image(s) actually contain (including a complete reading of any text present); what the user is asking for and which attributes that names; what must therefore stay fixed; the output size; and finally the composed directive. Close with a check that every visible element is either the target of the edit or covered by what stays fixed, that the requested change is unmistakable, that nothing outside the target was touched, and that every quoted string obeys language decision (B).\n\n## Image Reference Rules\n\nFor Multi-Image Input (N >= 2), the rewritten instruction MUST use `<image1>`, `<image2>`, ... to refer to each input image. Do not use natural language references like "图1", "第一张图", "the first image", or "image A". This tagging format is mandatory and non-negotiable. For single-image input (N = 1), do NOT use tags — refer to the image naturally ("图像", "图片中", "the image").\n\nState each image\'s role explicitly — which one is the canvas whose composition and untargeted content survive, and which supply material to transfer — and say what is taken from each. For scene generation with no canvas (合影/合照 and the like), all images serve as identity sources. Describe every referenced image individually; never compress several into a range or a group to avoid describing them one by one.\n\n## Output Size Determination\n\nYou must determine two output fields: `wh_ratio` and `ratio_follow`. These two fields are mutually exclusive — when one has a value, the other must be empty string "".\n\n### Step 1: Check if the user explicitly specified a size or aspect ratio\n\nLook for any of the following in the user\'s edit instruction:\n- Exact pixel dimensions: "1920x1080", "800×600", "1080p"\n- Aspect ratios: "16:9", "4:3", "3:2", "9:16", "1:1"\n- Descriptive terms mapped to aspect ratios:\n  - "正方形" / "square" / "头像" / "avatar" / "profile picture" / "专辑封面" / "album cover" → "1:1"\n  - "横版" / "landscape" / "横屏" / "电脑壁纸" / "desktop wallpaper" / "宽屏" / "widescreen" / "视频封面" / "video thumbnail" / "PPT" / "幻灯片" / "slide" / "演示文稿" → "16:9"\n  - "竖版" / "portrait" / "竖屏" / "手机壁纸" / "phone wallpaper" / "手机屏幕" / "Instagram story" / "Stories" / "Reels" / "短视频封面" → "9:16"\n  - "手机全面屏" / "全面屏" / "iPhone屏幕" / "iPhone screen" → "18:39"\n  - "安卓全面屏" / "Android screen" → "9:20"\n  - "超宽" / "ultrawide" / "带鱼屏" → "7:3"\n  - "电影画面" / "cinematic" / "电影比例" / "宽银幕" / "cinemascope" → "21:9"\n  - "海报" / "poster" → "2:3"\n  - "证件照" / "ID photo" / "passport photo" / "小红书" / "Xiaohongshu" → "3:4"\n  - "iPad屏幕" / "tablet" / "平板屏幕" → "4:3"\n  - "全景图" / "panoramic" / "panorama" → "2:1"\n  - "名片" / "business card" → "9:5"\n  - "A4" → "5:7"(竖向)or "7:5"(横向)\n  - "1080p" / "720p" → "16:9"\n\n**High-resolution keywords ("2K", "4K", "8K") are quality descriptors, NOT aspect ratio indicators.** When the user mentions "2K", "4K", or "8K", these only express a desire for high image quality. They must NOT be used to infer or determine the aspect ratio. The aspect ratio should still be determined by other explicit cues or by the input image\'s ratio. For output resolution, always use 2K-level resolution regardless of whether the user says "2K", "4K", or "8K".\n\nIf you specified a size or ratio:\n→ `wh_ratio` = the corresponding ratio (e.g. "16:9", "1:1", "3:2")\n→ `ratio_follow` = ""\n\nIf you specified exact pixel dimensions (e.g. "1920x1080"), convert to the simplest integer ratio (1920:1080 = 16:9).\n\n### Step 2: If the user did NOT specify any size or ratio\n\n#### Single-image editing (1 input image):\nThe output should follow the input image\'s resolution.\n→ `wh_ratio` = ""\n→ `ratio_follow` = "<image1>"\n\n**Exception — Single-image scene generation**: If the task generates a new scene from scratch using the input image only as an identity reference (e.g., "拍一套写真", "cosplay成X", "穿越到古代"), do NOT follow the input image\'s ratio — the output is a new composition, not an edit of the existing image. Instead, choose `wh_ratio` by scene semantics:\n\n| Scene type | wh_ratio |\n|---|---|\n| Portrait / 写真 / half-body | "2:3" |\n| Full-body scene / outdoor activity | "3:4" |\n| Landscape-oriented scene | "3:2" |\n| No clear orientation hint | Follow the input image\'s ratio (set `ratio_follow` to `<image1>`, `wh_ratio` to "") |\n\n#### Multi-image editing (N ≥ 2 input images):\nYou must identify the **canvas image** (the image whose composition and framing the output should follow), then set `ratio_follow` to that image\'s tag.\n\n| Edit type | Canvas | ratio_follow |\n|---|---|---|\n| Compositing — transfer subject into a scene ("把A P到B中", "放到", "加入到") | The target scene image | "<imageX>" (scene image number) |\n| Face/head swap ("换脸", "换头") | The body image | "<imageX>" (body image number) |\n| Clothing swap ("换衣服", "换装") | The person image | "<imageX>" (person image number) |\n| Style transfer ("画成X的风格", "风格迁移") | The content image (not the style reference) | "<imageX>" (content image number) |\n| Background replacement | The foreground subject image | "<imageX>" (subject image number) |\n| Local object replacement | The original image being edited | "<imageX>" (original image number) |\n| Scene generation — no canvas ("合影", "合照", "一起变老", "让他们X") | No canvas — you must choose a ratio | See below |\n\nFor **scene generation tasks with no canvas** (合影, 合照, 一起吃饭, etc.), set `ratio_follow` = "" and choose `wh_ratio` by scene semantics:\n\n| Scene type | wh_ratio |\n|---|---|\n| Group photo / 合影 / 合照 | "3:2" |\n| Portrait / 写真 | "2:3" |\n| Poster / 海报 | "2:3" |\n| Desktop wallpaper | "16:9" |\n| Phone wallpaper | "9:16" |\n| No clear orientation hint | Follow the last input image\'s ratio (set `ratio_follow` to the last image, `wh_ratio` to "") |\n\n#### Outpainting (扩图 / 延伸画面):\n\nFor outpainting tasks where the user did NOT specify a target aspect ratio, do NOT simply follow the input image\'s ratio — outpainting changes the image\'s proportions by definition. Instead, infer the new ratio from the extension direction:\n\n- Extend **right only** or **left only**: widen the ratio. E.g., a 1:1 input → "3:2"; a 3:4 input → "1:1" or "4:3".\n- Extend **both left and right**: widen more aggressively. E.g., a 1:1 input → "16:9" or "2:1".\n- Extend **down only** or **up only**: make the ratio taller. E.g., a 1:1 input → "2:3"; a 16:9 input → "4:3" or "1:1".\n- Extend **both up and down**: make the ratio significantly taller. E.g., a 1:1 input → "9:16".\n- Extend **all sides**: keep the original ratio (the image grows uniformly).\n\nAs a general rule, estimate the extended area as roughly 30%–50% additional space in the specified direction(s), then compute the new W:H ratio accordingly. Set `ratio_follow` = "" and `wh_ratio` = the inferred ratio.\n\n#### Panoramic generation (全景 / panorama):\n\n| Panoramic type | wh_ratio |\n|---|---|\n| Standard panorama / 全景 | "2:1" |\n| Wide panorama / 超宽全景 | "3:1" |\n| 360° / VR panorama | "2:1" |\n| User specified a different ratio | Use the user\'s specified ratio |\n\nSet `ratio_follow` = "" and `wh_ratio` = the inferred ratio.\n\n#### Three-view drawings and multi-grid generation (三视图 / 多宫格):\n\nFor three-view or multi-panel grid generation where the user did NOT specify an aspect ratio, do NOT use a fixed default. Determine it adaptively from:\n\n1. **Subject shape proportion**: a tall standing person is vertically oriented, a car is horizontally oriented, a round object roughly square.\n2. **Panel layout arrangement**: how the panels are arranged (1×3 horizontal, 3×1 vertical, 2×2) and the shape of each panel.\n3. **Combined ratio**: (single panel W × columns) : (single panel H × rows), choosing the ratio that best fits the content without excessive empty space or cropping.\n\nExamples:\n- Three side-by-side views of a standing person (each panel ~1:3, portrait) → overall ratio = "1:1" — do NOT over-widen to "2:1" or "3:1", which would squash each portrait panel (use "3:1" only when each panel is itself landscape, e.g., a car)\n- Three side-by-side views of a car (each panel ~3:2) → overall ratio = "3:1" or "9:2"\n- 2×2 grid of a square object → overall ratio = "1:1"\n- 3×3 grid of square panels → overall ratio = "1:1"\n\nSet `ratio_follow` = "" and `wh_ratio` = the adaptively determined ratio.\n\n## Output Format\nOutput a valid JSON object with exactly three fields:\n```json\n{\n  "rewritten_prompt": "<the rewritten editing instruction>",\n  "wh_ratio": "<aspect ratio like \'16:9\', or empty string>",\n  "ratio_follow": "<\'<image1>\' / \'<image2>\' / ... / \'\'>"\n}\n```\n\n`rewritten_prompt` formatting rules:\n- The entire rewritten prompt must be a single continuous paragraph with NO line breaks or newline characters (`\\n`).\n- All text that should appear as visible, readable content in the output image must be enclosed in double quotes (""). Descriptive or structural language that does not appear as rendered text should NOT be quoted.\n- **Never include any resolution or aspect ratio information in `rewritten_prompt`** (e.g., "2:3", "16:9", "1920x1080", "2K", "4K"). Resolution and aspect ratio are conveyed exclusively through the `wh_ratio` and `ratio_follow` fields.\n- Write it out in full — no ellipsis, no truncation.\n- State requirements affirmatively ("保持背景与输入图完全一致") rather than as prohibitions ("禁止改变背景"). Standard preservation phrasing "保持/保留[X]不变" is fine.\n- Be precise and decisive: no hedging, no unresolved alternatives, no vague degree words left unresolved.\n- **Language-purge self-check (do this last)**: re-scan every double-quoted string — the text that will be RENDERED in the image — and enforce language decision (B). No quoted string may mix Chinese and English, form a bilingual pair, or carry a parenthetical translation gloss unless the user explicitly asked. Standardized units and user-given proper nouns may remain Latin.\n\nRules for each field:\n- `rewritten_prompt`: The rewritten editing instruction. The descriptive prose (outside double quotes) follows language decision (A); the text rendered inside the image (inside double quotes) follows language decision (B). Retain proper nouns and domain-specific terms in their original language, placed in English double quotes.\n- `wh_ratio`: The target aspect ratio as "W:H". Set to "" when the output resolution should follow an input image instead.\n- `ratio_follow`: Which input image\'s resolution the output follows ("<image1>", "<image2>", …). Set to "" when a specific aspect ratio is provided in `wh_ratio`.\n\nMutual exclusivity rule:\n- If `wh_ratio` has a value → `ratio_follow` must be ""\n- If `ratio_follow` is "<imageX>" → `wh_ratio` must be ""\n\nDo not include any text outside the JSON object — no greetings, no explanations, no markdown code fences.\n\nThe user\'s edit instruction to rewrite is:\n'
A_SEG = "<|im_start|>system\n" + SYSTEM_I2I + "\n<|im_end|>\n<|im_start|>user"
C_SEG = "\n<|im_end|>\n<|im_start|>assistant\n<think>"
# 原始用户词默认=官方换装例句(edit 生成器口径;=本件「指令」①层占位默认)
B_SEG = ("Put the light blue denim shirt from <image2> on the character "
         "in <image1>, keep everything else unchanged")
# 官方正则逐字(对 i2i 三字段 JSON 只抓 rewritten_prompt;wh_ratio 匹配不消费)
REGEX = '"rewritten_prompt"\\s*:\\s*"(.*?)"\\s*,\\s*"wh_ratio"\\s*:'

# 官方示例双图(LoadImage 默认样例图照抄 edit 生成器口径,09-24 自决定案)
IMG1, IMG2 = "portrait_model_denim.png", "clothing_light_blue_denim_shirt.png"

# TextGenerate widgets_values 序(官方件实读):
# [prompt, max_length, sampling_mode, temperature, top_k, top_p, min_p,
#  repetition_penalty, seed, presence_penalty, thinking,
#  use_default_template, mtp]
TG_WV = ["", 8192, "on", 0.7, 20, 0.95, 0.05, 1.05, 42, 1.5, False, False, "auto"]

# 道劫装配(承 t2i 生成器):九型真源互锁 + RGBA 官方公式头尾
CHAR_TYPES = ("人物", "美宣", "多视图", "高清人脸", "分镜剧情图", "表情差分")  # 0927 改名轮:三视图→多视图
DEFAULT_TYPE = "人物"
RGBA_HEAD_EN = "This is an RGBA format image with transparency."  # 0927 勘案修账:官方逐字(官方模板 Note 双源)
RGBA_TAIL_EN = "The image has an alpha channel and a transparent background."  # 0927 勘案修账:官方逐字
RGBA_HEAD_ZH = "这是一张带有透明度的RGBA图像。"
RGBA_TAIL_ZH = "该图像具有alpha通道,背景是透明的。"

# 子图内部节点 id(独立 id 空间,承 t2i 装配段编号)
BASE_ID = 150                 # MyQi21DaojieBase 九选一(自研,可命 title)
LOCK_ID = 110                 # 通用锁层常量A
RGBA_HEAD_ID, RGBA_TAIL_ID = 160, 161
CONCAT1_ID, CONCAT2_ID = 130, 131
RGBA_CAT1_ID, RGBA_CAT2_ID = 162, 163
TE_ID, TE_RGBA_ID, RGBA_SW_ID = 142, 143, 144
# 0926 线不遮节点轮:[143]→[144].on_true 横穿同行 [142] 不可避(行3 三件同
# y 带,左端编码器馈线必过右端编码器)→ 垫 Reroute 拐点走行2/行3 框间净空带
# (拐点不占阶段行,样板=t2i 子图 W/H 通道 [171]-[174];入线复用 link22)
SG_RR_ID = 170                  # RGBA on_true 垫脚石拐点
SG_RR_LINK = 27                 # RR→[144].on_true 段
# 0928 黑图修复轮(实弹判别七拍闭环:双参考条件×少步蒸馏=viggle6/T8_4 全黑,
# 单参考全真,档0 40步双参考真):子图新增行4 单参考编码族(仅 image_1,RGBA
# 镜像开关同边界槽6),主图 [185] 正源档位开关(==0:true=[40].positive 双参考
# =档0 官方路/false=[40].positive_single 单参考=档1/2)重定 [8]/[176] 供词。
TE1_ID, TE1R_ID, TE1_SW_ID = 171, 172, 173        # 单参考主编码/RGBA 编码/镜像开关(行4)
SG_RR2_ID = 174                                   # 行4 on_false 垫脚石(直连横穿 [172] 不可避)
SG_RR3_ID = 175   # [172].clip 垫脚石(历史锚;0928 删踏脚石轮已删件直连:中转段本
                  # 计入交叉/线遮,直连后整线成 -10 边界线两口径同豁免,实测严格不增)
# 0928 PE 迁子图轮:PE-I2I 链七件迁入 [40] 子图(id 随迁,子图独立 id 空间);
# [22] 原始用户词留主图(指令①层唯一手写位);[12] PE 专属 TE 留主图加载器行
PE_A_ID, PE_C_ID = 21, 23           # chatml a 段(官方 i2i 系统提示词)/c 段(assistant 预填)
PE_FMT_ID = 24                      # StringFormat {a}{b}{c} chatml 拼装
PE_BATCH_ID = 25                    # BatchImagesNode 合批(PE 看全图,吃 -10 image_1/2)
PE_TG_ID = 26                       # TextGenerate(comfy-core)
PE_RX_ID = 27                       # RegexExtract(抓 rewritten_prompt)
PE_SW_ID = 15                       # 指令开关(true=PE-I2I 看图改写=默认/false=直写)
# 宿主面板新增槽位(0928 PE 迁子图轮):槽7 PE开关(BOOLEAN widget 默认 true=
# 0926 裁定1 PE 开路)/槽8 pe_clip(主图 [12] PE 专属 TE 一进线)
SG_SLOT_PE_SW, SG_SLOT_PE_CLIP = 7, 8
# 主图锚(id 承 edit 骨架同表)
HOST_ID = 40                  # 装配子图宿主
PREVIEW_ID = 28               # easy showAnything 装配预览(新 id,edit 的 27=RegexExtract)
NOTE_ID = 11                  # MarkdownNote
# ── 0929 加速区并行化轮(任务 09-29-qi21-acczone-parallel;注入式开关农场退役)──
# 退役件存照(0927 三档轮+0928 黑图修复轮的注入式机构,共 13 选择逻辑件+2 垫脚石,
# 本轮全拆;旧 id 一并退役防误用):[30]档位 PrimitiveInt / [32] MODEL 开关 /
# [164] steps 联动开关+[165][166] 常量 40/359 / [175] latent 路由开关 /
# [185] 正源档位开关+[183][184] ==0 比较组 / [171][172] ==1/==2 比较+
# [173][174] 判据常量 / [179][187] 垫脚石([186][188][182][178][41] 先轮已退役)。
# 档位语义并入选择件 combo(steps 回归各支路 KSampler widget=面板值即生效值;
# 正源双路分线直入各支路,黑图修复语义不变)。
LORA_ID = 31                       # viggle 支路 LoRA(保留;model←[7] Cache 单源扇出)
T8_ID = 176                        # Fun-Acc 支路 T8 采样器(保留;model 改 Cache 直连)
STEPS_OFF, STEPS_ON = 40, 359      # 直出/viggle 支路 KSampler steps 生效值(回归
#   widget,面板值=生效值;359=0929 拉齐值(原 6=v0.2.1 系卡荐档))
KS_DIR_ID = 8                      # 支路0 直出 KSampler(40 步;id 承旧共用体 [8])
KS_VIG_ID = 189                    # 支路1 viggle KSampler(359 步;新件,id 取旧 [187] 之上)
SPEED_SEL_ID = 190                 # MyQi21SpeedSelect 单选择件(三 latent 槽懒路由)
SEED_ID = 191                      # seed(三支路共享) PrimitiveInt 单源扇出
SPEED_SELECT_CLASS = "MyQi21SpeedSelect"
# 档位 combo 闭集=自研件 SPEED_MODES 单源(my_nodes/nodes/my_qi21_speed_select.py;
# combo 列表即契约:/prompt 闭集硬校验,改档位文案必须与三生成器同笔);首项=默认=
# 直出40步(0929 用户拉齐裁定,12:05 主会话复核;Fun-Acc 仍为主加速=次序第二)。
SPEED_COMBO_DIRECT = "0 · 直出40步"
SPEED_COMBO_FUNACC = "2 · Fun-Acc 4步"
SPEED_COMBO_VIGGLE = "1 · viggle"
SPEED_COMBO = (SPEED_COMBO_DIRECT, SPEED_COMBO_FUNACC, SPEED_COMBO_VIGGLE)
MODE_DIRECT, MODE_VIGGLE, MODE_FUNACC = 0, 1, 2   # 档位语义锚(干跑 override 用)
RR_M_A_ID = 41   # MODEL 顶通道首拐(历史锚;0928 删踏脚石轮删件直连 [1]→[42],
                 # 实测交叉/线遮双不增;双拐同删=[1]→[7] 直连线遮+1 故留 [42] 单拐)
RR_M_B_ID = 42   # MODEL 顶通道总线拐(保留:删后线遮+1,实测 0928 删踏脚石轮)
RR_V_A_ID = 43   # VAE 顶通道首拐(保留:删后线遮+1)
RR_V_B_ID = 44   # VAE 顶通道末拐(保留:删后交叉+3)
FUNACC_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"   # 已装机(models/loras/)
T8_CLASS = "T8QwenImage21FunAccPDD4Step"

# 全图节点类型白名单(自查:TE-Speed 槽禁入本件——插件未装=红节点,任何未知类型即红)
NODE_TYPE_WHITELIST = {
    # 主图
    "UNETLoader", "CLIPLoader", "VAELoader", "LoadImage",
    "ImageScaleToTotalPixels", "QwenImage21Cache", "LoraLoaderModelOnly",
    "PrimitiveBoolean", "PrimitiveInt", "ComfySwitchNode", "KSampler", "VAEDecode",
    "SaveImage", "PrimitiveStringMultiline", "StringFormat", "BatchImagesNode",
    "TextGenerate", "RegexExtract", "MarkdownNote", "easy showAnything",
    "Reroute", "EmptyLatentImage",
    # 0929 并行化轮:easy compare 随注入式比较器全拆出册;MyQi21SpeedSelect 入册
    "MyQi21SpeedSelect", "T8QwenImage21FunAccPDD4Step",
    # 子图
    "MyQi21DaojieBase", "StringConstant", "StringConcatenate",
    "TextEncodeQwenImage21",
}

NOTE_TEXT = """## 道劫 · Qwen-Image-2.1 图生图(生修合一·编辑流骨架+九型装配;i2i 09-24)

**机制纠正(09-24)**:Qwen-Image-2.1 生修合一,**无传统 img2img(denoise 重绘不存在)——图输入即指令编辑**。
本件=edit 编辑骨架(PE-I2I 看图改写+多参考图双通道)+qi21 道劫九型装配的合体;对标 K2 线 krea2-daojie-i2i.json 同域同式。

### 指令×装配怎么拼(执行期定稿,05 库 §一四层装配口径)

- **指令=改什么**(①主体句位):[22] 原始用户词=唯一手写位(默认=官方换装例句),直喂 [40] 装配子图「指令」槽;子图内 [15] 指令开关(true=PE-I2I 看图改写=**默认 PE 改写**(0926 裁定1:多彩时代默认 PE 开路;false=直写=按图选配,单图手动关)——开关经宿主面板「PE开关」暴露(默认开),改写输出直占 [130] 拼接①①层——**指令即主体**(0928 PE 迁子图轮:指令路径全程子图内)。
- **装配=道劫画风约束**(②③层恒挂):[40] 子图把 指令 + MyQi21DaojieBase 当前型 BASE(②型底座+④配色行,逐字=05 库↔qi21_bases.json 互锁)+通用锁层常量A(③层,库首节全文,全九型恒挂)按**换行分层**接成一段进编码;拼接次序照 05 库四层口径(①领头→②→③)。
- 跑图前过目 [28] 装配预览(接 [40] prompt 输出):显示将进编码的最终文本(指令+装配全文)。
- 装配全文过长挤压指令权重的风险(拼接次序/换行分层已按库口径;PE 开启时改写文与装配双写重复=同 09-22 三视图先例,可跑;嫌重复就关 PE 用直写)。

### 怎么换型(一处切换)

- 主画布点选 [40] 装配子图,面板「型选择」下拉九选一(默认①人物):人物/场景/道具/美宣/多视图/高清人脸/分镜剧情图/表情差分/概念气氛图——子图内 MyQi21DaojieBase 按选型出 BASE(真源=qi21_bases.json 磁盘热读,逐字=05 库)。
- **画幅随输入图,不随型**(i2i 语义):MyQi21DaojieBase 的 WIDTH/HEIGHT 输出本件不接(画幅联动行不移植)——分辨率=TextEncode.resolution 0(不重采样,输出跟随 image_1 预缩后比例);要自定义画幅开 [19] 输出画幅双路。

### 官方示例双图(须先放引擎 input 目录)

- image_1 = portrait_model_denim.png(编辑画布/人物)
- image_2 = clothing_light_blue_denim_shirt.png(参考/衬衫)
- **参考图语法**:指令里用 `<image1>`..`<image10>` 点名;image_1=编辑目标画布,其余是参考;模型契约上限 10 图(节点槽 16)。

### 参数圣经(官方模板 Note 要点)

- **cfg 恒 1**(官方路径):负面提示词在 cfg=1 下**数学上不参与采样**——负面线保留接线为**官方同构占位**(不生效);要用负向须抬 cfg,非本产线口径;Fun-Acc 支路无负面槽。**步数回归各支路 KSampler 面板=真实生效值,零摆设值**(直出 40=道劫产线完整档,官方区间 40-50;viggle 359=0929 拉齐值,原 6=v0.2.1 系卡荐档;Fun-Acc 4 步内置于 [176] T8;可直接手调)**;euler/simple/denoise 1.0;seed fixed 可复现(默认 0,seed 单源扇出三支路,一处改三支路同步)。
- **resolution 是总像素预算非宽高**:[40] 子图编码器取 **0=不重采样**(仅取整到 32 的倍数),输出尺寸跟随 image_1(预缩后)。
- **输入图预缩**:加载后先 ImageScaleToTotalPixels(lanczos·32 倍数)——画布 1.5MP、参考图 1.0MP;控显存+稳输入尺寸。
- **QwenImage21Cache(auto/default)**:KV 缓存挂 UNETLoader 后,内存吃紧可调(cpu/int8)。

### PE-I2I 改写组([40] 子图内;宿主面板「PE开关」默认 PE 改写;关=直写按图选配;0926 裁定1;0928 PE 迁子图轮)

- 链路(全在 [40] 子图内):[12] PE CLIPLoader(pe_i2i bf16·type=qwen_image,主图加载器行)经宿主 pe_clip 槽一进线 → 三段 chatml 拼装([24] StringFormat {a}{b}{c}:a=[21] 官方 i2i 系统提示词/b=指令(宿主「指令」槽)/c=[23] assistant+`<think>` 预填)→ [26] TextGenerate(comfy-core)→ [27] RegexExtract(抓 rewritten_prompt,dotall)→ [15] 指令开关(经宿主面板「PE开关」驱动)→ [130] 拼接①占①层。
- **PE 看全部输入图(双通道)**:[25] BatchImagesNode(子图内)合批全部输入图(经 image_1/image_2 边界,预缩后)喂 [26].image;子图编码器只吃选定图。
- [26] 参数:use_default_template=false+thinking=false(`<think>` 预填是官方刻意设计,勿改);temp 0.7/topK 20/topP 0.95/minP 0.05/repPen 1.05/maxLength 8192/seed 42;presence_penalty=1.5 **已定档**(0925 拍板:A/B 四维 57.5 vs 55.0 略优,保留 1.5)。
- 关「PE开关」(直写选配)时 PE 组不进执行图(ComfySwitchNode 懒执行,PE 模型不加载);默认开=PE 模型随首拍加载。
- PE 权重:text_encoders/qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors(bf16 自转件;官方 int8_convrot 在 MPS 首矩阵乘即死,勿装)。

### 加速区·三支路并行(0929 并行化轮;单选择件 MyQi21SpeedSelect·combo 首项=默认=直出40步(0929 拉齐重放裁定))

- **三支路并行+单选择**(0929 用户令「使用并行节点布局前面只有1个选择逻辑」):直出/viggle/Fun-Acc 三条完整自足支路(各含自己的采样器与步数,MODEL/steps 内聚,零注入),在 MyQi21SpeedSelect 三选一处汇流(选择件居汇流点右侧)后单点解码 [9];懒执行=check_lazy_status 只拉起选中档支路,未选中支路零执行零加载(整体不进执行图)。默认档只是初始值,随时可切任何档;加速启停语义=用户手动权威。
- **支路0 直出(上行,默认档)**:[8] KSampler 40 步官方完整档,MODEL=[7] Cache(base)直连,positive=[40].positive 双参考官方路(0928 黑图修复铁则:支路0 双参考/加速两支路单参考,见下节)。
- **支路1 viggle(中行)**:[31] LoraLoaderModelOnly(name 预填 **Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors**,viggle 蒸馏件已装机,strength 0.8=0925 探针最优:flatMAD 2.52→1.75)→[189] KSampler 359 步(0929 拉齐值,原 6;cfg 保持 1)。模型卡注 shift_terminal=0.02 伤末步,画质异常先查调度。
- **支路2 Fun-Acc(下行,主加速档=次序第二)**:[176] T8QwenImage21FunAccPDD4Step 接管采样——4步/sigmas 五值/euler/cfg1 全内置(勿外接采样器),无负面槽(负面词在该档不参与);model=[7] Cache(base)直连**绝不吃 viggle LoRA**;positive=positive_single(单参考);latent_image 与 [8] 同源;model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors(已装机 models/loras/)。实测速度(0926 三轮实弹):1024² 28.8s/2048² 130.7s(viggle 34.1/183.1,直出 214.7/1173.4)。TE 硬校验 4096 维,现产线 TE=qwen3vl_8b_bf16_heretic 已实测通过。
- **seed 单源共享**:seed(三支路共享) PrimitiveInt 默认 0 fixed 单节点扇出 [8]/[189]/[176] 三采样器(T8 seed 已输入化;一处改,三支路同步)——消灭旧 [8] widget 与 [176] seed 两处分离。
- **复用铁则**(0929 用户令「不要重复出现1个节点,要进行复用」):共享源单节点扇出([7] Cache MODEL 一源三用/[40] 双正源分线/[20] 画幅开关 latent 一源三用/seed 一源三用),画布零真重复节点(同 type+同上游+同 widgets 不得两件;两 KSampler 步数与 model 上游均不同=并行支路本体,非真重复)。
- **依赖警示:Fun-Acc 需引擎装 Fun-Acc 插件(T8 节点,见设置页生态插件区 Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8)**;未装的机器选 Fun-Acc 档节点红/执行失败——降级=切「1 · viggle」或「0 · 直出40步」档。
- 分工:PE=提示词优化(已在链)/LoRA=少步数加速(支路1 自足)/Fun-Acc=PDD 4步采样(支路2 自足)。
- **TE-Speed 槽不在本件**(3c 试装已死归档:插件未装=画布红节点,D4 终审永不装)。

### 加速档单参考正源(0928 黑图修复;支路1/2 专用)

- **实测事实(0928 实弹判别,七拍闭环)**:编码器同时吃双参考图(image_1 画布 1.5MP+image_2 参考 1.0MP)时,**viggle 6 步与 Fun-Acc 4 步两档少步蒸馏采样一律崩纯黑**(引擎报 success、尺寸对、全图唯一色=1);40 步直出档不受影响。单参考(仅 image_1)两加速档全真——viggle 单参考 105s/Fun-Acc 单参考 120s 出真图(结构相关 r=0.872)。
- **修复接线(0929 并行化后形,分线直入)**:子图行4 单参考编码族([171] 主编码/[172] RGBA 编码/[173] RGBA 镜像开关,均仅 image_1、词源与行3 同源、RGBA 开关同宿主面板槽6)产出 positive_single;主图不再走 [185] 正源档位开关(随注入式机构拆除),改分线直入各支路:支路0 [8].positive=宿主 positive(双参考=档0 官方路零改动)/支路1·2 [189]/[176].positive=宿主 positive_single(单参考)——正源差异内聚进各支路。
- [40] 恒执行(负面/latent 仍由其供,画幅随 image_1 不变);支路1/2 选中时行4 编码亦入链(多一次视觉编码,约 +20s)。
- 默认档沿革:0927 裁定 Fun-Acc 默认→0929 拉齐轮暂 11(等效直出)→0929 并行化轮恢复 Fun-Acc(选择件 combo 首项)→**0929 拉齐重放(用户 12:05 裁定)默认=直出40步等效**(选择件 combo 首项,Fun-Acc 仍为主加速居二);档0 的双参考语义零改动。

### RGBA 透明图句式(存 PNG 才保 alpha;[40] 面板「RGBA透明开关」默认关)

This is an RGBA format image with transparency. [装配全文,与 [28] 同源]. The image has an alpha channel and a transparent background.
中文同款:这是一张带有透明度的RGBA图像。……该图像具有alpha通道,背景是透明的。(头尾逐字=官方原文(0927 勘案修账:改官方逐字,旧缩写版废弃),子图 [160][161][162][163] 现拼)

### 输出画幅双路([19] 开关,默认 false=跟随输入图)

- **false(默认)**:latent 取 [40] 子图编码器 latent,跟随 image_1(预缩后)比例。
- **true**:[18] EmptyLatentImage 自定义宽高(默认 1024×1024);自定义尺寸须贴近 image_1 比例,否则编辑漂移。

### 提示词起草

已装技能 **qwen-image-2-1-prompter**(官方 PE 宪法封装)——起草/改写提示词时唤取它;道劫主体句纪律(只写主体与画面,不重复风格词/全角标点/质量词禁入)见 docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md。

### 维护警示

本件由 apps/build/scripts/qi21_daojie_i2i_0924.py 全量再生成(幂等,重跑逐字节一致);改布局/参数/提示词=改脚本再跑,手改画布会被重跑重置。
"""


# ── 真源解析(05 库文档;与 t2i 生成器同口径双记账互锁)──────────────
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

    color_map = {
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
        is_char = zh in CHAR_TYPES
        want_len = 7 if is_char else 3
        if len(middle) != want_len:
            raise SystemExit(f"条目 {zh} ③锁层行数 {len(middle)} ≠ {want_len}(库结构漂移)")
        if middle[2:6] != b_lines and is_char:
            raise SystemExit(f"条目 {zh} ③锁层中段与常量B 不逐字一致")
        if color != color_map[zh]:
            raise SystemExit(f"条目 {zh} ④配色行与 §一映射表不一致")
        constant_text = "\n".join([base_line] + (b_lines if is_char else []) + [color])
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
def _string_constant(nid: int, text: str, pos: list, links: list[int], size: list) -> dict:
    return {
        "id": nid, "type": "StringConstant",
        "pos": pos, "size": size, "flags": {}, "order": 0, "mode": 0,
        "inputs": [],
        "outputs": [{"name": "STRING", "type": "STRING", "links": links}],
        "properties": {"Node name for S&R": "StringConstant"},
        "widgets_values": [text],
    }


def _switch(nid: int, false_link: int, true_link: int, switch_link: int,
            out_links: list[int], pos: list, typ: str = "STRING", size: list | None = None,
            default: bool = False) -> dict:
    # default=widget 默认值(0926 裁定1:PE 开路含画布本体,[15] 默认 true;其余开关默认 false)
    return {
        "id": nid, "type": "ComfySwitchNode",
        "pos": pos, "size": size or [380, 120], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "on_false", "shape": 7, "type": typ, "link": false_link},
            {"name": "on_true", "shape": 7, "type": typ, "link": true_link},
            {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": switch_link},
        ],
        "outputs": [{"name": "output", "type": typ, "links": out_links}],
        "properties": {"Node name for S&R": "ComfySwitchNode"},
        "widgets_values": [default],
    }


def _concatenate(nid: int, a_link: int, b_link: int, out_links: list[int], pos: list,
                 delimiter: str = "\n") -> dict:
    return {
        "id": nid, "type": "StringConcatenate",
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


def _reroute(nid: int, pos: list, in_link: int, out_link: int, typ: str) -> dict:
    """Reroute 通道拐点(序列化逐字段=K2-角色设定-道劫.json 顶层级实取样板)。"""
    return {
        "id": nid, "type": "Reroute", "pos": pos, "size": [75, 26],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "", "type": "*", "link": in_link}],
        "outputs": [{"name": "", "type": typ, "links": [out_link]}],
        "properties": {"showOutputText": False, "horizontal": False},
    }


def _internal_link(lid: int, oid: int, oslot: int, tid: int, tslot: int, typ: str) -> dict:
    return {"id": lid, "origin_id": oid, "origin_slot": oslot,
            "target_id": tid, "target_slot": tslot, "type": typ}


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


# ── 子图构建(0928 PE 迁子图轮:装配+PE 改写+双路编码全收进)──────────
def build_subgraph(truth: dict) -> dict:
    """装配子图:指令 PE 改写 + 四层装配 + RGBA 官方公式 + 双路编码。

    行式(0928 PE 迁子图轮;从上到下=阶段行、行内从左到右;六行):
      行1 y=140   源行:[150] 九选一底座 + [110] 锁层A + [160][161] RGBA 官方头尾
      行2 y=860   装配:[130] 拼接①(指令+BASE)→[131] 拼接②(+锁层A)→
                   [162][163] RGBA 公式拼接(头+装配全文+尾)
      行3 y=1620  编码输出:[143] RGBA 编码→[142] 主编码→[144] RGBA 开关
      行4 y=2400  单参考编码(0928 黑图修复行,仅 image_1):[171][172][173]
      行5 y=3200  PE改写·chatml+合批:[21] a 段/[23] c 段/[25] 合批(看全图)
      行6 y=3960  PE改写·生成:[24] 拼装→[26] TextGenerate→[27] 正则→[15] 指令开关
    (0928 PE 迁子图轮:t2i 四行流水的 i2i 适配——i2i 的 PE 改写的是指令①层,
    经 [15] 开关后升行2 占①层位;PE 两带沉底=[130] 恒向右约束下 [15] 须左于
    [130],沉底让升线走 x2810-2900 空走廊零穿越;画幅联动行不移植——i2i 画幅
    随输入图,PE 的 wh_ratio 输出本件不消费。)
    """
    ROW_Y = (140, 860, 1620, 2400, 3200, 3960)
    links: list[dict] = []
    # -10 扇出(边界线;widget 型输入 linkIds 同样逐项登记=契约铁律)
    links.append(_internal_link(1, -10, 0, TE_ID, 0, "CLIP"))            # clip → 主编码
    links.append(_internal_link(2, -10, 0, TE_RGBA_ID, 0, "CLIP"))       # clip → RGBA 编码
    links.append(_internal_link(3, -10, 1, TE_ID, 2, "VAE"))             # vae → 主编码
    links.append(_internal_link(4, -10, 1, TE_RGBA_ID, 2, "VAE"))        # vae → RGBA 编码
    links.append(_internal_link(5, -10, 2, TE_ID, 1, "IMAGE"))           # image_1 → 主编码
    links.append(_internal_link(6, -10, 3, TE_ID, 3, "IMAGE"))           # image_2 → 主编码
    links.append(_internal_link(7, -10, 2, TE_RGBA_ID, 1, "IMAGE"))      # image_1 → RGBA 编码
    links.append(_internal_link(8, -10, 3, TE_RGBA_ID, 3, "IMAGE"))      # image_2 → RGBA 编码
    links.append(_internal_link(10, -10, 5, BASE_ID, 0, "COMBO"))        # 型选择 → MyQi21DaojieBase.base
    links.append(_internal_link(11, -10, 6, RGBA_SW_ID, 2, "BOOLEAN"))   # RGBA透明开关 → [144].switch
    # 装配链(12-16)
    links.append(_internal_link(12, BASE_ID, 0, CONCAT1_ID, 1, "STRING"))   # BASE → 拼接①.string_b(②层)
    links.append(_internal_link(13, LOCK_ID, 0, CONCAT2_ID, 1, "STRING"))   # 锁层A 恒挂 → 拼接②(③层)
    links.append(_internal_link(14, CONCAT1_ID, 0, CONCAT2_ID, 0, "STRING"))
    links.append(_internal_link(15, CONCAT2_ID, 0, TE_ID, 4, "STRING"))     # 装配全文 → 主编码.prompt
    links.append(_internal_link(16, CONCAT2_ID, 0, RGBA_CAT1_ID, 1, "STRING"))  # 装配全文 → RGBA 公式①([28] 同源)
    # RGBA 官方公式拼接(17-20;头句+装配全文+尾句)
    links.append(_internal_link(17, RGBA_HEAD_ID, 0, RGBA_CAT1_ID, 0, "STRING"))
    links.append(_internal_link(18, RGBA_CAT1_ID, 0, RGBA_CAT2_ID, 0, "STRING"))
    links.append(_internal_link(19, RGBA_TAIL_ID, 0, RGBA_CAT2_ID, 1, "STRING"))
    links.append(_internal_link(20, RGBA_CAT2_ID, 0, TE_RGBA_ID, 4, "STRING"))  # → RGBA 编码.prompt
    # 编码与 RGBA 开关(21-22、27;0926 线不遮节点:[143]→[144].on_true 横穿同行
    # [142] 不可避 → 垫 Reroute[170] 拐点走行2/行3 框间净空带,入线复用 link22)
    links.append(_internal_link(21, TE_ID, 0, RGBA_SW_ID, 0, "CONDITIONING"))
    links.append(_internal_link(22, TE_RGBA_ID, 0, SG_RR_ID, 0, "CONDITIONING"))
    links.append(_internal_link(23, RGBA_SW_ID, 0, -20, 0, "CONDITIONING"))   # → 输出 positive
    links.append(_internal_link(24, TE_ID, 1, -20, 1, "CONDITIONING"))        # 主编码.negative → 输出
    links.append(_internal_link(25, CONCAT2_ID, 0, -20, 2, "STRING"))         # 装配文本 → 输出 prompt
    links.append(_internal_link(26, TE_ID, 2, -20, 3, "LATENT"))              # 主编码.latent → 输出(画幅双路源)
    links.append(_internal_link(SG_RR_LINK, SG_RR_ID, 0, RGBA_SW_ID, 1, "CONDITIONING"))  # 拐点 → [144].on_true
    # 0928 黑图修复:行4 单参考编码族(仅 image_1;词源同 [142]/[143];RGBA 镜像
    # 开关同边界槽6)→ 新输出 positive_single 供主图 [185] 正源档位开关
    links.append(_internal_link(28, -10, 0, TE1_ID, 0, "CLIP"))          # clip → 单参考主编码
    links.append(_internal_link(29, -10, 1, TE1_ID, 2, "VAE"))           # vae → 单参考主编码
    links.append(_internal_link(30, -10, 2, TE1_ID, 1, "IMAGE"))         # image_1 → 单参考主编码
    links.append(_internal_link(31, CONCAT2_ID, 0, TE1_ID, 3, "STRING")) # 装配全文 → 单参考主编码.prompt([28] 同源)
    links.append(_internal_link(32, TE1_ID, 0, SG_RR2_ID, 0, "CONDITIONING"))   # → 行4 垫脚石(横穿 [172] 不可避)
    links.append(_internal_link(33, SG_RR2_ID, 0, TE1_SW_ID, 0, "CONDITIONING"))  # 垫脚石 → 镜像开关.on_false
    links.append(_internal_link(34, TE1R_ID, 0, TE1_SW_ID, 1, "CONDITIONING"))    # 单参考 RGBA → 镜像开关.on_true
    links.append(_internal_link(35, RGBA_CAT2_ID, 0, TE1R_ID, 3, "STRING"))      # RGBA 公式全文 → 单参考 RGBA.prompt
    links.append(_internal_link(36, -10, 0, TE1R_ID, 0, "CLIP"))          # clip → 单参考 RGBA.clip(0928 删 [175] 垫脚石直连)
    links.append(_internal_link(37, -10, 1, TE1R_ID, 2, "VAE"))          # vae → 单参考 RGBA
    links.append(_internal_link(38, -10, 2, TE1R_ID, 1, "IMAGE"))        # image_1 → 单参考 RGBA
    links.append(_internal_link(39, -10, 6, TE1_SW_ID, 2, "BOOLEAN"))    # RGBA透明开关 → 镜像开关.switch(同槽6)
    links.append(_internal_link(40, TE1_SW_ID, 0, -20, 4, "CONDITIONING"))  # 镜像开关 → 输出 positive_single
    # 0928 PE 迁子图轮:PE-I2I 链七件(42-54;[175] clip 垫脚石已删直连——原 link36/41
    # 中转段本计入交叉/线遮,直连后整线成 -10 边界线两口径同豁免,实测严格不增)
    links.append(_internal_link(42, -10, 4, PE_FMT_ID, 1, "STRING"))     # 指令 → 拼装.values.b(chatml b 段)
    links.append(_internal_link(43, -10, 4, PE_SW_ID, 0, "STRING"))      # 指令 → [15].on_false(直写臂)
    links.append(_internal_link(44, -10, SG_SLOT_PE_SW, PE_SW_ID, 2, "BOOLEAN"))   # PE开关(宿主面板) → [15].switch
    links.append(_internal_link(45, -10, SG_SLOT_PE_CLIP, PE_TG_ID, 0, "CLIP"))    # pe_clip(主图[12]) → TextGenerate.clip
    links.append(_internal_link(46, -10, 2, PE_BATCH_ID, 0, "IMAGE"))    # image_1 → 合批(PE 看全图)
    links.append(_internal_link(47, -10, 3, PE_BATCH_ID, 1, "IMAGE"))    # image_2 → 合批
    links.append(_internal_link(48, PE_A_ID, 0, PE_FMT_ID, 0, "STRING"))     # a 段(官方系统提示词) → 拼装
    links.append(_internal_link(49, PE_C_ID, 0, PE_FMT_ID, 2, "STRING"))     # c 段(assistant 预填) → 拼装
    links.append(_internal_link(50, PE_FMT_ID, 0, PE_TG_ID, 4, "STRING"))    # chatml 全文 → TextGenerate.prompt
    links.append(_internal_link(51, PE_BATCH_ID, 0, PE_TG_ID, 1, "IMAGE"))   # 合批 → TextGenerate.image
    links.append(_internal_link(52, PE_TG_ID, 0, PE_RX_ID, 0, "STRING"))     # 生成原文 → 正则
    links.append(_internal_link(53, PE_RX_ID, 0, PE_SW_ID, 1, "STRING"))     # rewritten_prompt → [15].on_true
    links.append(_internal_link(54, PE_SW_ID, 0, CONCAT1_ID, 0, "STRING"))   # [15] 指令开关 → 拼接①.string_a(①层)
    assert sorted(l["id"] for l in links) == [i for i in range(1, 55) if i not in (9, 41)]

    nodes: list[dict] = []
    # 行1 源行(0928 PE 迁子图轮:整体右移上对齐各自行2 消费件——近垂直短降线
    # 零扫掠,长斜降会横扫行1 后续成员=线遮节点结构性病灶)
    nodes.append({
        "id": BASE_ID, "type": "MyQi21DaojieBase",
        "title": "底座九选一(MyQi21DaojieBase:BASE=②+B+④ 逐字=05库/磁盘热读;W/H 本件不用=画幅随输入图)",
        "pos": [2440, ROW_Y[0]], "size": [420, 200], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "base", "type": "COMBO", "widget": {"name": "base"}, "link": 10},
        ],
        "outputs": [
            {"name": "BASE", "type": "STRING", "links": [12]},
            {"name": "WIDTH", "type": "INT", "links": None},
            {"name": "HEIGHT", "type": "INT", "links": None},
            {"name": "型名", "type": "STRING", "links": None},
        ],
        "properties": {"Node name for S&R": "MyQi21DaojieBase"},
        "widgets_values": [DEFAULT_TYPE],
    })
    nodes.append(_string_constant(
        LOCK_ID, truth["const_a"], [3080, ROW_Y[0]], [13], [440, 400]))
    nodes.append(_string_constant(
        RGBA_HEAD_ID, RGBA_HEAD_EN, [4120, ROW_Y[0]], [17], [380, 120]))
    nodes.append(_string_constant(
        RGBA_TAIL_ID, RGBA_TAIL_EN, [4700, ROW_Y[0]], [19], [380, 120]))

    # 行2 装配路由(0928 PE 迁子图轮:整体右移让 [15] 升线走廊——[130] 须右于
    # 行6 [15](恒向右);0926 线不遮节点:[162]/[163] 让 [131]→[142] 装配馈线
    # 的下降弧走 [162]/[163] 底下的净空)
    nodes.append(_concatenate(CONCAT1_ID, 54, 12, [14], [2870, ROW_Y[1]]))
    nodes.append(_concatenate(CONCAT2_ID, 14, 13, [15, 16, 25, 31], [3450, ROW_Y[1]]))
    nodes.append(_concatenate(RGBA_CAT1_ID, 17, 16, [18], [4240, ROW_Y[1]], delimiter=" "))
    nodes.append(_concatenate(RGBA_CAT2_ID, 18, 19, [20, 35], [4820, ROW_Y[1]], delimiter=" "))

    # 行3 编码输出(TextEncode 输入序=edit 件实读:clip/images.image_1/vae/images.image_2/prompt;
    # 双编码器都接双图——i2i 语义:RGBA 路同样要看图编辑)
    def _textencode(nid: int, pos: list, clip_l: int, img1_l: int, vae_l: int, img2_l: int,
                    prompt_link: int, pos_links) -> dict:
        return {
            "id": nid, "type": "TextEncodeQwenImage21",
            "pos": pos, "size": [420, 320], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": clip_l},
                {"name": "images.image_1", "type": "IMAGE", "shape": 7, "link": img1_l},
                {"name": "vae", "type": "VAE", "shape": 7, "link": vae_l},
                {"name": "images.image_2", "type": "IMAGE", "shape": 7, "link": img2_l},
                {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": prompt_link},
            ],
            "outputs": [
                {"name": "positive", "type": "CONDITIONING", "links": pos_links},
                {"name": "negative", "type": "CONDITIONING", "links": (
                    [24] if nid == TE_ID else None)},
                {"name": "latent", "type": "LATENT", "links": (
                    [26] if nid == TE_ID else None)},
            ],
            "properties": {"Node name for S&R": "TextEncodeQwenImage21"},
            "widgets_values": ["", "", 0],  # prompt 清空(连线供词)/负向空/resolution=0 不重采样
        }

    # 0926 线不遮节点:[143] 让 [131]→[142] 装配馈线在 [143] 右缘上方过弧
    nodes.append(_textencode(TE_RGBA_ID, [4920, ROW_Y[2]], 2, 7, 4, 8, 20, [22]))
    nodes.append(_textencode(TE_ID, [5720, ROW_Y[2]], 1, 5, 3, 6, 15, [21]))

    # 0928 黑图修复:单参考编码工厂(无 image_2 槽=prompt 槽位前移;其余同构)
    def _textencode1(nid: int, pos: list, clip_l: int, img1_l: int, vae_l: int,
                     prompt_link: int, pos_links) -> dict:
        return {
            "id": nid, "type": "TextEncodeQwenImage21",
            "pos": pos, "size": [420, 320], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": clip_l},
                {"name": "images.image_1", "type": "IMAGE", "shape": 7, "link": img1_l},
                {"name": "vae", "type": "VAE", "shape": 7, "link": vae_l},
                {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": prompt_link},
            ],
            "outputs": [
                {"name": "positive", "type": "CONDITIONING", "links": pos_links},
                {"name": "negative", "type": "CONDITIONING", "links": None},
                {"name": "latent", "type": "LATENT", "links": None},
            ],
            "properties": {"Node name for S&R": "TextEncodeQwenImage21"},
            "widgets_values": ["", "", 0],  # prompt 清空(连线供词)/负向空/resolution=0 不重采样
        }
    nodes.append(_switch(
        RGBA_SW_ID, 21, SG_RR_LINK, 11, [23], [6340, ROW_Y[2]], typ="CONDITIONING"))
    # 0926 线不遮节点:[143]→[144].on_true 垫脚石拐点(行2/行3 框间净空带,
    # 拐点不占阶段行;升-降两段弧均从 [142] 顶上方过)
    nodes.append(_reroute(SG_RR_ID, [5900, 1400], 22, SG_RR_LINK, "CONDITIONING"))

    # ── 0928 黑图修复:行4 单参考编码族(仅 image_1;双参考崩少步蒸馏→单参考
    #     全真;布局镜像行3:[171]@4780/[172]@5420/[173]@6060,[174] 垫脚石走
    #     行3/行4 框间带)──
    nodes.append(_textencode1(TE1_ID, [4920, ROW_Y[3]], 28, 30, 29, 31, [32]))
    nodes.append(_textencode1(TE1R_ID, [5720, ROW_Y[3]], 36, 38, 37, 35, [34]))
    nodes.append(_switch(
        TE1_SW_ID, 33, 34, 39, [40], [6340, ROW_Y[3]], typ="CONDITIONING"))
    nodes.append(_reroute(SG_RR2_ID, [5900, 2180], 32, 33, "CONDITIONING"))
    # ([175] clip 垫脚石 0928 删踏脚石轮退役:直连后整线成 -10 边界线,豁免口径)

    # ── 0928 PE 迁子图轮:行5/行6 PE-I2I 改写带(七件自主图迁入,id 随迁;
    #     沉底布局——[15] 须左于 [130](恒向右),升线走 x2810-2900 空走廊)──
    def _core(nid: int, ntype: str, pos: list, size: list, inputs: list[dict],
              outputs: list[dict], widgets=None) -> dict:
        """核心/第三方节点工厂:零自定义 title(0924-r8 节点标题铁律)。"""
        n = {"id": nid, "type": ntype, "pos": pos, "size": size, "flags": {},
             "order": 0, "mode": 0, "inputs": inputs, "outputs": outputs,
             "properties": {"Node name for S&R": ntype}}
        if widgets is not None:
            n["widgets_values"] = widgets
        return n

    def _combo(name: str, link=None, shape=None):
        e = {"name": name, "type": "COMBO"}
        if shape is not None:
            e["shape"] = shape
        e["widget"] = {"name": name}
        e["link"] = link
        return e

    # 行5 PE改写·chatml 段+合批(PE 看全图:合批吃 -10 image_1/image_2 边界;
    # [23] 左/[21] 右=[23]→[24] 降线过 [21] 下方净空,[21]→[24] 近垂入槽)
    nodes.append(_core(PE_C_ID, "PrimitiveStringMultiline", [80, ROW_Y[4]], [260, 180],
                       [{"name": "value", "type": "STRING", "widget": {"name": "value"}, "link": None}],
                       [{"name": "STRING", "type": "STRING", "links": [49]}],
                       [C_SEG]))
    nodes.append(_core(PE_A_ID, "PrimitiveStringMultiline", [580, ROW_Y[4]], [300, 180],
                       [{"name": "value", "type": "STRING", "widget": {"name": "value"}, "link": None}],
                       [{"name": "STRING", "type": "STRING", "links": [48]}],
                       [A_SEG]))
    nodes.append(_core(PE_BATCH_ID, "BatchImagesNode", [1140, ROW_Y[4]], [260, 170],
                       [{"name": "images.image0", "type": "IMAGE", "link": 46},
                        {"name": "images.image1", "type": "IMAGE", "shape": 7, "link": 47}],
                       [{"name": "IMAGE", "type": "IMAGE", "links": [51]}]))
    # 行6 PE改写·生成:拼装→TextGenerate→正则→指令开关(0926 线不遮承主图旧
    # 布局思路:三段自不同带收敛,[24]/[25] 上下错带避免 [24]→[26] 横穿 [25])
    nodes.append(_core(PE_FMT_ID, "StringFormat", [840, ROW_Y[5]], [300, 130],
                       [{"name": "values.a", "type": "*", "shape": 7, "link": 48},
                        {"name": "values.b", "type": "*", "shape": 7, "link": 42},
                        {"name": "values.c", "type": "*", "shape": 7, "link": 49},
                        {"name": "f_string", "type": "STRING", "widget": {"name": "f_string"}, "link": None}],
                       [{"name": "STRING", "type": "STRING", "links": [50]}],
                       ["{a}{b}{c}"]))
    nodes.append(_core(PE_TG_ID, "TextGenerate", [1600, ROW_Y[5]], [400, 450],
                       [{"name": "clip", "type": "CLIP", "link": 45},
                        {"name": "image", "type": "IMAGE", "shape": 7, "link": 51},
                        {"name": "video", "type": "IMAGE", "shape": 7, "link": None},
                        {"name": "audio", "type": "AUDIO", "shape": 7, "link": None},
                        {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": 50},
                        {"name": "max_length", "type": "INT", "widget": {"name": "max_length"}, "link": None},
                        {"name": "sampling_mode", "type": "COMFY_DYNAMICCOMBO_V3",
                         "widget": {"name": "sampling_mode"}, "link": None},
                        {"name": "sampling_mode.temperature", "type": "FLOAT",
                         "widget": {"name": "sampling_mode.temperature"}, "link": None},
                        {"name": "sampling_mode.top_k", "type": "INT",
                         "widget": {"name": "sampling_mode.top_k"}, "link": None},
                        {"name": "sampling_mode.top_p", "type": "FLOAT",
                         "widget": {"name": "sampling_mode.top_p"}, "link": None},
                        {"name": "sampling_mode.min_p", "type": "FLOAT",
                         "widget": {"name": "sampling_mode.min_p"}, "link": None},
                        {"name": "sampling_mode.repetition_penalty", "type": "FLOAT",
                         "widget": {"name": "sampling_mode.repetition_penalty"}, "link": None},
                        {"name": "sampling_mode.seed", "type": "INT",
                         "widget": {"name": "sampling_mode.seed"}, "link": None},
                        {"name": "sampling_mode.presence_penalty", "type": "FLOAT", "shape": 7,
                         "widget": {"name": "sampling_mode.presence_penalty"}, "link": None},
                        {"name": "thinking", "type": "BOOLEAN", "shape": 7,
                         "widget": {"name": "thinking"}, "link": None},
                        {"name": "use_default_template", "type": "BOOLEAN", "shape": 7,
                         "widget": {"name": "use_default_template"}, "link": None},
                        {"name": "mtp", "type": "COMBO", "shape": 7, "widget": {"name": "mtp"}, "link": None}],
                       [{"name": "generated_text", "type": "STRING", "links": [52]}],
                       TG_WV))
    nodes.append(_core(PE_RX_ID, "RegexExtract", [2200, ROW_Y[5]], [330, 260],
                       [{"name": "string", "type": "STRING", "widget": {"name": "string"}, "link": 52},
                        {"name": "regex_pattern", "type": "STRING",
                         "widget": {"name": "regex_pattern"}, "link": None},
                        {"name": "mode", "type": "COMBO", "widget": {"name": "mode"}, "link": None},
                        {"name": "case_insensitive", "type": "BOOLEAN",
                         "widget": {"name": "case_insensitive"}, "link": None},
                        {"name": "multiline", "type": "BOOLEAN",
                         "widget": {"name": "multiline"}, "link": None},
                        {"name": "dotall", "type": "BOOLEAN",
                         "widget": {"name": "dotall"}, "link": None},
                        {"name": "group_index", "type": "INT",
                         "widget": {"name": "group_index"}, "link": None}],
                       [{"name": "STRING", "type": "STRING", "links": [53]}],
                       ["", REGEX, "First Group", False, False, True, 1]))
    # [15] 指令开关(0928 迁入子图;switch=宿主面板「PE开关」widget,-10 槽7,
    # 默认 true=PE 开路,0926 裁定1;on_false=直写指令/on_true=PE-I2I 看图改写)
    nodes.append(_switch(PE_SW_ID, 43, 53, 44, [54], [2730, ROW_Y[5]],
                         typ="STRING", size=[300, 110], default=True))

    for order, n in enumerate(nodes):
        n["order"] = order

    groups: list[dict] = [
        {
            "id": 1, "title": "道劫·底座装配(行1 源行:九选一底座+锁层A恒挂+RGBA官方头尾)",
            "bounding": [2410, 90, 2850, 500], "color": "#3f789e", "flags": {},
        },
        {
            "id": 2, "title": "道劫·装配路由(行2:拼接①② delimiter=\\n 分层·指令占①层;RGBA 公式拼接)",
            "bounding": [2840, 810, 2500, 300], "color": "#a1309b", "flags": {},
        },
        {
            "id": 3, "title": "道劫·编码输出(行3:主编码+RGBA编码(官方公式路,默认旁路)+RGBA开关)",
            "bounding": [4890, 1570, 1870, 430], "color": "#886", "flags": {},
        },
        # 0928 黑图修复:行4 单参考编码族(加速档正源,仅 image_1)
        {
            "id": 4, "title": "道劫·单参考编码(行4:档1/2 加速正源,仅 image_1,0928 黑图修复;RGBA 镜像开关同宿主面板)",
            "bounding": [4890, 2350, 1870, 430], "color": "#4d9e6a", "flags": {},
        },
        # 0928 PE 迁子图轮:行5/行6 PE 改写带不设框(预算≤4,同 t2i 蛇形两行不设框先例)
    ]

    # 子图 IO(inputs 槽序=宿主 inputs 序;widget 型输入 linkIds 同样逐项登记=契约铁律)
    _IO_IDS = [
        "c4d5e6f7-0001-4a01-9e01-d47c9e21a001",  # in-0 clip
        "c4d5e6f7-0002-4a02-9e02-d47c9e21a002",  # in-1 vae
        "c4d5e6f7-0003-4a03-9e03-d47c9e21a003",  # in-2 image_1
        "c4d5e6f7-0004-4a04-9e04-d47c9e21a004",  # in-3 image_2
        "c4d5e6f7-0005-4a05-9e05-d47c9e21a005",  # in-4 指令
        "c4d5e6f7-0006-4a06-9e06-d47c9e21a006",  # in-5 型选择(COMBO)
        "c4d5e6f7-0007-4a07-9e07-d47c9e21a007",  # in-6 RGBA透明开关
        "c4d5e6f7-0008-4a08-9e08-d47c9e21a008",  # in-7 PE开关(BOOLEAN,默认 true;0928 PE 迁子图轮)
        "c4d5e6f7-0009-4a09-9e09-d47c9e21a009",  # in-8 pe_clip(主图 [12] PE 专属 TE)
        "e8f1a2b3-0001-4b01-8f01-d47c9e21b01",   # out-0 positive
        "e8f1a2b3-0002-4b02-8f02-d47c9e21b02",   # out-1 negative
        "e8f1a2b3-0003-4b03-8f03-d47c9e21b03",   # out-2 prompt
        "e8f1a2b3-0004-4b04-8f04-d47c9e21b04",   # out-3 latent
    ]
    # IO 槽 pos(0928 PE 迁子图轮随行带重排:指令/PE开关/pe_clip 落 PE 带左缘;
    # image_1/2 须左于 [25] 合批;clip/vae 落编码族左缘;输出槽 x=7500 钉最右列)
    inputs = [
        {"id": _IO_IDS[0], "name": "clip", "type": "CLIP", "linkIds": [1, 2, 28, 36], "pos": [4820, 1560]},
        {"id": _IO_IDS[1], "name": "vae", "type": "VAE", "linkIds": [3, 4, 29, 37], "pos": [4760, 2340]},
        {"id": _IO_IDS[2], "name": "image_1", "type": "IMAGE", "linkIds": [5, 7, 30, 38, 46], "pos": [1060, 3140]},
        {"id": _IO_IDS[3], "name": "image_2", "type": "IMAGE", "linkIds": [6, 8, 47], "pos": [1100, 3170]},
        {"id": _IO_IDS[4], "name": "指令", "type": "STRING", "linkIds": [42, 43], "pos": [-196, 3920]},
        {"id": _IO_IDS[5], "name": "型选择", "type": "COMBO", "linkIds": [10], "pos": [-196, 180]},
        {"id": _IO_IDS[6], "name": "RGBA透明开关", "type": "BOOLEAN", "linkIds": [11, 39], "pos": [6280, 2380]},
        {"id": _IO_IDS[7], "name": "PE开关", "type": "BOOLEAN", "linkIds": [44], "pos": [2660, 3900]},
        {"id": _IO_IDS[8], "name": "pe_clip", "type": "CLIP", "linkIds": [45], "pos": [1520, 3920]},
    ]
    outputs = [
        {"id": _IO_IDS[9], "name": "positive", "type": "CONDITIONING", "linkIds": [23], "pos": [6800, 1700]},
        {"id": _IO_IDS[10], "name": "negative", "type": "CONDITIONING", "linkIds": [24], "pos": [6800, 1860]},
        {"id": _IO_IDS[11], "name": "prompt", "type": "STRING", "linkIds": [25], "pos": [6800, 1000]},
        {"id": _IO_IDS[12], "name": "latent", "type": "LATENT", "linkIds": [26], "pos": [6800, 2020]},
        # 0928 黑图修复:单参考正源输出(行4 镜像开关;主图 [185] 档位开关 on_false 臂)
        {"id": "e8f1a2b3-0005-4b05-8f05-d47c9e21b05", "name": "positive_single",
         "type": "CONDITIONING", "linkIds": [40], "pos": [6800, 2560]},
    ]

    sg = {
        "id": SG_UUID,
        "version": 1,
        "state": {"lastGroupId": 4, "lastNodeId": SG_RR2_ID, "lastLinkId": 54,
                  "lastRerouteId": 2},
        "revision": 1,
        "config": {"defaultIOState": {}},
        "name": "[40] 道劫·装配子图(双击进入)",
        "inputNode": {"id": -10, "bounding": [-320, -260, 160, 4400]},
        "outputNode": {"id": -20, "bounding": [6720, 900, 320, 1800]},
        "inputs": inputs,
        "outputs": outputs,
        "widgets": [B_SEG, DEFAULT_TYPE, False, True],
        "nodes": nodes,
        "groups": groups,
        "links": links,
        "extra": {"ue_links": [], "links_added_by_ue": []},
    }
    # W6 收口(0926 实测发现项3 计划断言互锁):子图整体归一平移至所有节点
    # pos≥80(左上边距升级 40→80;相对布局零变;源码逻辑坐标 行带
    # y=140/860/1580 不改,序列化前统一抬;IO 槽/组框/inputNode·outputNode
    # bounding 同步平移保持罩合关系)。
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
    return sg


# ── 主图构建(0928 PE 迁子图轮:主图=加载+双图预缩+宿主+采样链;零 PE 链件)──
def build_main(truth: dict, sg: dict) -> dict:
    g = {
        "id": WF_UUID, "version": 0.4, "revision": 0, "config": {}, "extra": {},
        "groups": [
            {"id": 1, "title": "道劫·加载器(bf16 三件套+PE-I2I 专属文本编码器→[40].pe_clip)",
             # 0928 PE 迁子图轮:[12] 升加载器行(PE 改写链已收进 [40] 子图)
             "bounding": [320, 40, 2720, 660], "color": "#3f789e", "flags": {}},
            {"id": 2, "title": "道劫·编辑主链(双图预缩→[40]装配子图(PE改写在内)→三支路并行采样+单选择件→解码→保存;下排=输出画幅双路)",
             "bounding": [2400, 200, 8800, 2600], "color": "#3f789e", "flags": {}},
            # 0928 PE 迁子图轮:原「PE-I2I 改写组」框随七件迁入 [40] 子图退役,
            # 换「指令外露带」框([22] 唯一手写位;PE 链在子图,面板「PE开关」默认开)
            {"id": 3, "title": "道劫·指令外露带([22]原始用户词=指令①层唯一手写位→[40].指令;PE-I2I 改写链已收进[40]装配子图,宿主面板「PE开关」默认开=0926 裁定1)",
             "bounding": [1240, 1880, 560, 340], "color": "#8864a8", "flags": {}},
            # W1 加速区组框(0929 并行化轮随拓扑重建):罩三支路+seed 单源+单选择件
            # 六件([8]直出/[31]+[189]viggle/[176]Fun-Acc/[191]seed/[190]选择件);
            # 支路横向一行、三行纵叠,选择件居汇流点右侧
            {"id": 4, "title": "道劫·加速区(三支路并行+单选择)",
             "bounding": [7470, 950, 2320, 1810], "color": "#4d9e6a", "flags": {}},
        ],
        "nodes": [],
        "links": [],
        "definitions": {"subgraphs": [sg]},
    }

    def _core(nid: int, ntype: str, pos: list, size: list, inputs: list[dict],
              outputs: list[dict], widgets=None) -> dict:
        """核心/第三方节点工厂:零自定义 title(0924-r8 节点标题铁律)。"""
        n = {"id": nid, "type": ntype, "pos": pos, "size": size, "flags": {},
             "order": 0, "mode": 0, "inputs": inputs, "outputs": outputs,
             "properties": {"Node name for S&R": ntype}}
        if widgets is not None:
            n["widgets_values"] = widgets
        return n

    def _combo(name: str, link=None, shape=None):
        e = {"name": name, "type": "COMBO"}
        if shape is not None:
            e["shape"] = shape
        e["widget"] = {"name": name}
        e["link"] = link
        return e

    nodes = [
        # ── 行1 加载器(上;0928 PE 迁子图轮:[12] 升加载器行一进线喂宿主 pe_clip)──
        _core(1, "UNETLoader", [360, 100], [340, 84],
              [_combo("unet_name"), _combo("weight_dtype")],
              [{"name": "MODEL", "type": "MODEL", "links": [22]}],
              [UNET_FILE, "default"]),
        _core(2, "CLIPLoader", [2000, 160], [360, 130],
              [_combo("clip_name"), _combo("type"), _combo("device", shape=7)],
              [{"name": "CLIP", "type": "CLIP", "links": [3]}],
              [CLIP_FILE, "qwen_image", "default"]),
        _core(3, "VAELoader", [2640, 540], [340, 60],   # 0926 线不遮:[3] 降 100 让 [2]→[40].clip 弧从顶上过
              [_combo("vae_name")],
              [{"name": "VAE", "type": "VAE", "links": [4, 35]}],
              [VAE_FILE]),
        _core(12, "CLIPLoader", [1300, 160], [400, 130],
              [_combo("clip_name"), _combo("type"), _combo("device", shape=7)],
              [{"name": "CLIP", "type": "CLIP", "links": [9]}],
              [PE_CLIP_FILE, "qwen_image", "default"]),
        # ── 行2 主链前半:双图→预缩→[40] 装配子图宿主→装配预览 ──────
        # 0926 线不遮节点:行2 错位双带——[4]/[16] 上带 y=960、[5]/[17] 降
        # y=1300/1560 带,[16] 的跨行长馈线(→[40].image_1)从 [5]/[17] 顶上方
        # 净空走(0928 PE 迁子图轮:合批已随 PE 链入 [40] 子图吃边界图)
        _core(4, "LoadImage", [1260, 640], [340, 420],
              [_combo("image"), {"name": "upload", "type": "IMAGEUPLOAD",
                                 "widget": {"name": "upload"}, "link": None}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [1]},
               {"name": "MASK", "type": "MASK", "links": None}],
              [IMG1, "image"]),
        _core(16, "ImageScaleToTotalPixels", [2480, 1520], [330, 130],
              [{"name": "image", "type": "IMAGE", "link": 1},
               _combo("upscale_method"), {"name": "megapixels", "type": "FLOAT",
                                          "widget": {"name": "megapixels"}, "link": None},
               {"name": "resolution_steps", "type": "INT",
                "widget": {"name": "resolution_steps"}, "link": None}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [5]}],
              ["lanczos", 1.5, 32]),
        _core(5, "LoadImage", [2610, 1880], [340, 420],
              [_combo("image"), {"name": "upload", "type": "IMAGEUPLOAD",
                                 "widget": {"name": "upload"}, "link": None}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [2]},
               {"name": "MASK", "type": "MASK", "links": None}],
              [IMG2, "image"]),
        _core(17, "ImageScaleToTotalPixels", [3540, 1140], [330, 130],
              [{"name": "image", "type": "IMAGE", "link": 2},
               _combo("upscale_method"), {"name": "megapixels", "type": "FLOAT",
                                          "widget": {"name": "megapixels"}, "link": None},
               {"name": "resolution_steps", "type": "INT",
                "widget": {"name": "resolution_steps"}, "link": None}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [6]}],
              ["lanczos", 1.0, 32]),
        # [40] 装配子图宿主(widget 型输入=宿主面板;序列化口径=t2i [40] 实证;
        # 0928 PE 迁子图轮:面板四控件=指令/型选择/RGBA透明开关/PE开关(默认 true=
        # PE 开路,0926 裁定1);新增 pe_clip 输入槽←主图 [12] 一进线)
        {
            "id": HOST_ID, "type": SG_UUID,
            "pos": [4820, 1320], "size": [560, 480], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": 3},
                {"name": "vae", "type": "VAE", "link": 4},
                {"name": "image_1", "type": "IMAGE", "link": 5},
                {"name": "image_2", "type": "IMAGE", "link": 6},
                {"name": "指令", "type": "STRING", "widget": {"name": "指令"}, "link": 18},
                {"name": "型选择", "type": "COMBO", "widget": {"name": "型选择"}, "link": None},
                {"name": "RGBA透明开关", "type": "BOOLEAN", "widget": {"name": "RGBA透明开关"}, "link": None},
                {"name": "PE开关", "type": "BOOLEAN", "widget": {"name": "PE开关"}, "link": None},
                {"name": "pe_clip", "type": "CLIP", "link": 9},
            ],
            "outputs": [
                # 0929 并行化:positive 分线直入各支路(不再走 [185] 正源档位开关)——
                # 支路0 [8] 吃 positive(双参考官方路)/支路1·2 [189][176] 吃
                # positive_single(单参考,0928 黑图修复铁则)
                {"name": "positive", "type": "CONDITIONING", "links": [71]},
                {"name": "negative", "type": "CONDITIONING", "links": [20, 78]},
                {"name": "prompt", "type": "STRING", "links": [21]},
                {"name": "latent", "type": "LATENT", "links": [30]},
                {"name": "positive_single", "type": "CONDITIONING", "links": [70, 76]},
            ],
            "properties": {"subgraph": SG_UUID, "previewExposures": []},
            "widgets_values": [B_SEG, DEFAULT_TYPE, False, True],
            "widgets_values_named": {"指令": B_SEG, "型选择": DEFAULT_TYPE,
                                     "RGBA透明开关": False, "PE开关": True},
        },
        # 0926 线不遮节点:[28] 预览升 (6240,530) 让 [40]→[8] 双馈线(y≈985..1025)
        # 与 [40].latent→[20] 降线从其底/顶净空走;[25] 合批移 (3700,1600) 让
        # [16]/[17] 双降弧与 [25]→[26] 近垂线全走空当
        _core(PREVIEW_ID, "easy showAnything", [5880, 850], [480, 230],
              [{"label": "输入任何", "name": "anything", "shape": 7, "type": "*", "link": 21}],
              [{"name": "output", "type": "*", "links": None}],
              [""]),
        # ── 行3 三支路并行加速区(0929 并行化轮:直出上/viggle 中/Fun-Acc 下,
        #     支路横向一行+三行纵叠;选择件居汇流点右侧;seed 单源居左下)──────
        _core(7, "QwenImage21Cache", [6720, 240], [340, 120],
              [{"name": "model", "type": "MODEL", "link": 24},
               _combo("device"), _combo("dtype")],
              [{"name": "MODEL", "type": "MODEL", "links": [25, 66, 29]}],
              ["auto", "default"]),
        # 支路0 直出(上行):[8] KSampler 40 步——steps 回归 widget(面板值=生效值,
        # 零摆设值);model=Cache 直连;positive=宿主 positive(双参考官方路)
        _core(KS_DIR_ID, "KSampler", [8600, 1000], [330, 260],
              [{"name": "model", "type": "MODEL", "link": 66},
               {"name": "positive", "type": "CONDITIONING", "link": 71},
               {"name": "negative", "type": "CONDITIONING", "link": 20},
               {"name": "latent_image", "type": "LATENT", "link": 33},
               # 0929:seed widget 转输入接单源(序列化照旧 steps 转输入先例)
               {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": 79}],
              [{"name": "LATENT", "type": "LATENT", "links": [82]}],
              [0, "fixed", STEPS_OFF, 1, "euler", "simple", 1.0]),
        # 支路1 viggle(中行):[31] LoRA(0.8)→[189] KSampler 359 步(0929 拉齐值)
        _core(LORA_ID, "LoraLoaderModelOnly", [7500, 1660], [340, 130],
              [{"name": "model", "type": "MODEL", "link": 25},
               _combo("lora_name"), {"name": "strength_model", "type": "FLOAT",
                                     "widget": {"name": "strength_model"}, "link": None}],
              [{"name": "MODEL", "type": "MODEL", "links": [27]}],
              [LORA_FILE, 0.8]),
        _core(KS_VIG_ID, "KSampler", [8660, 1600], [330, 260],
              [{"name": "model", "type": "MODEL", "link": 27},
               {"name": "positive", "type": "CONDITIONING", "link": 70},
               {"name": "negative", "type": "CONDITIONING", "link": 78},
               {"name": "latent_image", "type": "LATENT", "link": 77},
               {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": 80}],
              [{"name": "LATENT", "type": "LATENT", "links": [83]}],
              [0, "fixed", STEPS_ON, 1, "euler", "simple", 1.0]),
        # 支路2 Fun-Acc(下行,主加速档):[176] T8——model 改 Cache 直连(绝不吃
        # viggle LoRA,R7 不变量);positive=positive_single(单参考);seed 输入化
        _core(T8_ID, T8_CLASS, [8600, 2200], [420, 250],
              [{"name": "model", "type": "MODEL", "link": 29},
               {"name": "positive", "type": "CONDITIONING", "link": 76},
               {"name": "latent_image", "type": "LATENT", "link": 65},
               _combo("model_file"),
               {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": 81}],
              [{"name": "LATENT", "type": "LATENT", "links": [84]}],
              [FUNACC_FILE, 0]),
        # seed 单源(三支路共享;默认 0 fixed,一处改三支路同步;y 让开 [20] est 带)
        _core(SEED_ID, "PrimitiveInt", [8100, 2640], [270, 90],
              [{"name": "value", "type": "INT", "widget": {"name": "value"}, "link": None}],
              [{"name": "INT", "type": "INT", "links": [79, 80, 81]}],
              [0, "fixed"]),
        # 单选择件(0929 方案 B):combo 首项=默认=直出40步(0929 拉齐重放);三 latent
        # 槽全 optional 全 lazy(check_lazy_status 只拉起选中支路,未选支路零执行零加载);
        # 输入序=自研件 INPUT_TYPES 单源(mode/latent_funacc/latent_viggle/
        # latent_direct,槽序 0/1/2/3);自研 My* 件可命 title(0924-r8 铁律)
        {
            "id": SPEED_SEL_ID, "type": SPEED_SELECT_CLASS,
            "title": "加速档位三选一(MyQi21SpeedSelect:默认直出40步·懒执行)",
            "pos": [9400, 1500], "size": [360, 200], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "mode", "type": "COMBO", "widget": {"name": "mode"}, "link": None},
                {"name": "latent_funacc", "type": "LATENT", "shape": 7, "link": 84},
                {"name": "latent_viggle", "type": "LATENT", "shape": 7, "link": 83},
                {"name": "latent_direct", "type": "LATENT", "shape": 7, "link": 82},
            ],
            "outputs": [{"name": "latent", "type": "LATENT", "links": [85]}],
            "properties": {"Node name for S&R": SPEED_SELECT_CLASS},
            "widgets_values": [SPEED_COMBO[0]],
        },
        _core(9, "VAEDecode", [10000, 1500], [240, 50],
              [{"name": "samples", "type": "LATENT", "link": 85},
               {"name": "vae", "type": "VAE", "link": 37}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [38]}]),
        _core(10, "SaveImage", [10460, 1500], [380, 330],
              [{"name": "images", "type": "IMAGE", "link": 38}], [],
              ["QI21道劫图生图_"]),
        # ── 行3c 输出画幅双路(0926 线不遮:[18] 降 y=2280 让 [19]→[20].switch
        #     横开关线走 [18] 顶上净空;[40].latent→[20] 降线走 [18] 顶上净空)──
        _core(19, "PrimitiveBoolean", [5440, 2260], [280, 90],
              [{"name": "value", "type": "BOOLEAN", "widget": {"name": "value"}, "link": None}],
              [{"name": "BOOLEAN", "type": "BOOLEAN", "links": [32]}],
              [False]),
        _core(18, "EmptyLatentImage", [4940, 2060], [300, 120],
              [{"name": "width", "type": "INT", "widget": {"name": "width"}, "link": None},
               {"name": "height", "type": "INT", "widget": {"name": "height"}, "link": None},
               {"name": "batch_size", "type": "INT", "widget": {"name": "batch_size"}, "link": None}],
              [{"name": "LATENT", "type": "LATENT", "links": [31]}],
              [1024, 1024, 1]),
        _switch(20, 30, 31, 32, [33, 77, 65], [7700, 2460], typ="LATENT", size=[280, 100]),
        # ── 0928 PE 迁子图轮:[22] 原始用户词=指令①层唯一手写位(升 (1320,1960)
        #     让 [22]→宿主.指令 升线走 [16] 底/[5] 顶 间净空走廊;PE 链七件已收进
        #     [40] 子图,主图零 PE 件)───────────────────────────────
        _core(22, "PrimitiveStringMultiline", [1320, 1960], [340, 180],
              [{"name": "value", "type": "STRING", "widget": {"name": "value"}, "link": None}],
              [{"name": "STRING", "type": "STRING", "links": [18]}],
              [B_SEG]),
        # ── 说明卡(左缘独立,零重叠)──────────────────────────────
        _core(NOTE_ID, "MarkdownNote", [80, 960], [940, 1100], [], [],
              [NOTE_TEXT]),
        # ── 顶缘通道 Reroute(0928 删踏脚石轮实测裁决:[41]/[182] 删件直连
        #     [1]→[42]/[7]→[32](交叉/线遮双不增);[42]/[43]/[44] 保留=
        #     总线/避遮挡正当拐点,删除则线遮或交叉回升;0929 并行化:[179]
        #     布尔垫脚石随比较器拆除)──────────────────────────────────
        _reroute(RR_M_B_ID, [5480, 140], 22, 24, "MODEL"),
        _reroute(RR_V_A_ID, [2760, 1080], 35, 36, "VAE"),
        _reroute(RR_V_B_ID, [9290, 160], 36, 37, "VAE"),
    ]
    for order, n in enumerate(nodes):
        n["order"] = order
    g["nodes"] = nodes

    g["links"] = [
        [1, 4, 0, 16, 0, "IMAGE"],        # [4] 画布 → 预缩A
        [2, 5, 0, 17, 0, "IMAGE"],        # [5] 参考 → 预缩B
        [3, 2, 0, HOST_ID, 0, "CLIP"],    # 主 CLIP → 宿主.clip
        [4, 3, 0, HOST_ID, 1, "VAE"],     # VAE → 宿主.vae
        [5, 16, 0, HOST_ID, 2, "IMAGE"],  # 预缩A → 宿主.image_1(编码器选定图通道)
        [6, 17, 0, HOST_ID, 3, "IMAGE"],  # 预缩B → 宿主.image_2
        [9, 12, 0, HOST_ID, 8, "CLIP"],   # PE loader → 宿主.pe_clip(子图 PE改写.clip)
        [18, 22, 0, HOST_ID, 4, "STRING"],   # 原始用户词(指令①层唯一手写位)→ 宿主.指令
        [21, HOST_ID, 2, PREVIEW_ID, 0, "STRING"],  # 宿主.prompt → 装配预览
        [22, 1, 0, RR_M_B_ID, 0, "MODEL"],    # UNET → 顶通道总线拐(0928 删 [41] 直连)
        [24, RR_M_B_ID, 0, 7, 0, "MODEL"],    # → Cache
        # ── 0929 并行化:MODEL 单源扇出(Cache 一源三用;T8 直连绝不吃 LoRA)──
        [25, 7, 0, LORA_ID, 0, "MODEL"],      # Cache → LoraLoader.model(viggle 链)
        [66, 7, 0, KS_DIR_ID, 0, "MODEL"],    # Cache → 直出.model(base 直连)
        [29, 7, 0, T8_ID, 0, "MODEL"],        # Cache → T8.model(base 直连,R7 不变量)
        [27, LORA_ID, 0, KS_VIG_ID, 0, "MODEL"],   # LoraLoader → viggle.model
        # ── 0929 并行化:seed 单源扇出(PrimitiveInt 一源三用)──────────────
        [79, SEED_ID, 0, KS_DIR_ID, 4, "INT"],     # seed → 直出.seed(widget 转输入)
        [80, SEED_ID, 0, KS_VIG_ID, 4, "INT"],     # seed → viggle.seed
        [81, SEED_ID, 0, T8_ID, 4, "INT"],         # seed → T8.seed(输入化)
        # ── latent 单源([20] 画幅开关一源三用;手动布尔非档位,R1 保留)────────
        [30, HOST_ID, 3, 20, 0, "LATENT"],    # 宿主.latent → 画幅开关.on_false
        [31, 18, 0, 20, 1, "LATENT"],         # 空潜 → 画幅开关.on_true
        [32, 19, 0, 20, 2, "BOOLEAN"],        # 布尔 → 画幅开关.switch
        [33, 20, 0, KS_DIR_ID, 3, "LATENT"],      # 画幅开关 → 直出.latent_image
        [77, 20, 0, KS_VIG_ID, 3, "LATENT"],      # 画幅开关 → viggle.latent_image
        [65, 20, 0, T8_ID, 2, "LATENT"],          # 画幅开关 → T8.latent_image
        # ── 正源双路分线直入(0928 黑图修复铁则:支路0 双参考/支路1·2 单参考)──
        [71, HOST_ID, 0, KS_DIR_ID, 1, "CONDITIONING"],   # 宿主.positive(双参考)→ 直出
        [70, HOST_ID, 4, KS_VIG_ID, 1, "CONDITIONING"],   # 宿主.positive_single → viggle
        [76, HOST_ID, 4, T8_ID, 1, "CONDITIONING"],       # 宿主.positive_single → T8
        [20, HOST_ID, 1, KS_DIR_ID, 2, "CONDITIONING"],   # 宿主.negative → 直出(占位 W5)
        [78, HOST_ID, 1, KS_VIG_ID, 2, "CONDITIONING"],   # 宿主.negative → viggle(T8 无负面槽)
        # ── 三支路汇流 → 单选择件 → 单点解码(选择件居汇流点右侧)────────────
        [82, KS_DIR_ID, 0, SPEED_SEL_ID, 3, "LATENT"],   # 直出 → 选择件.latent_direct
        [83, KS_VIG_ID, 0, SPEED_SEL_ID, 2, "LATENT"],   # viggle → 选择件.latent_viggle
        [84, T8_ID, 0, SPEED_SEL_ID, 1, "LATENT"],       # T8 → 选择件.latent_funacc
        [85, SPEED_SEL_ID, 0, 9, 0, "LATENT"],           # 选择件 → [9].samples(三档汇流)
        [35, 3, 0, RR_V_A_ID, 0, "VAE"],      # VAE → 顶通道(升)
        [36, RR_V_A_ID, 0, RR_V_B_ID, 0, "VAE"],   # 顶横 y=-640
        [37, RR_V_B_ID, 0, 9, 1, "VAE"],      # → VAEDecode
        [38, 9, 0, 10, 0, "IMAGE"],
    ]
    # id 计数器真值重算(根图+子图共享分配器,一并计入 max;计数器只抬不降)
    g["last_node_id"] = max(
        [n["id"] for n in g["nodes"]]
        + [n["id"] for sg_ in g["definitions"]["subgraphs"] for n in sg_["nodes"]])
    g["last_link_id"] = max(
        [l[0] for l in g["links"]]
        + [l["id"] for sg_ in g["definitions"]["subgraphs"] for l in sg_["links"]])
    return g


# ── 干跑(静态 graphToPrompt 等价:直写选配臂装配文本溯源与可达集)──────────
def _dry_run_default(g: dict, sg: dict) -> tuple[set[int], str]:
    """直写选配臂视图(0926 裁定1 后默认=[15] true=PE-I2I 开路,PE 文本运行时动态出
    改写器、静态不可逐字;本函数固定走 [15].on_false 直写臂)装配文本溯源与子图可达集。

    指令槽有外链则进主图解析([15].on_false→[22] 原始用户词);子图内部沿 link
    解析;ComfySwitchNode 懒执行=只走 on_false;MyQi21DaojieBase 的 BASE=
    qi21_bases.json 该型 base_text(节点运行时真源)。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    i_links = {l["id"]: l for l in sg["links"]}
    host = m_nodes[HOST_ID]
    host_widget_values = dict(zip([i["name"] for i in host["inputs"] if "widget" in i],
                                  host["widgets_values"]))

    def resolve_internal(node_id: int, slot: int) -> list[str]:
        texts: list[str] = []
        lid = i_nodes[node_id]["inputs"][slot].get("link")
        if lid is None:
            return texts
        l = i_links[lid]
        if l["origin_id"] == -10:
            hi = host["inputs"][l["origin_slot"]]
            if hi.get("link") is not None:  # 外链→主图源(指令←[22] 原始用户词)
                src = m_nodes[m_links[hi["link"]][1]]
                if src["type"] == "PrimitiveStringMultiline":
                    texts.append(src["widgets_values"][0])
            else:  # widget 型(型选择 COMBO)——MyQi21DaojieBase 的 base 即此路
                if i_nodes[node_id]["type"] == "MyQi21DaojieBase":
                    texts.append(_qi21_base_text(host_widget_values.get("型选择", DEFAULT_TYPE)))
            return texts
        src = i_nodes[l["origin_id"]]
        if src["type"] == "StringConstant":
            texts.append(src["widgets_values"][0])
        elif src["type"] == "MyQi21DaojieBase":
            texts.append(_qi21_base_text(host_widget_values.get("型选择", DEFAULT_TYPE)))
        elif src["type"] == "ComfySwitchNode":
            if src["id"] == PE_SW_ID:
                # [15]=子图内指令开关(0928 PE 迁子图轮;0926 裁定1 默认 true=PE
                # 开路);本视图固定走 on_false 直写选配臂核装配文本,不随 widget 定臂
                texts.extend(resolve_internal(src["id"], 0))
            else:
                assert src["widgets_values"][0] is False, f"干跑:默认链开关非 false [{src['id']}]"
                texts.extend(resolve_internal(src["id"], 0))  # on_false(懒执行)
        elif src["type"] == "StringConcatenate":
            texts.extend(resolve_internal(src["id"], 0))
            texts.extend(resolve_internal(src["id"], 1))
        return texts

    # 装配文本 = 主编码 [142].prompt 上游(拼接②)溯源
    texts = resolve_internal(TE_ID, 4)

    # 直写选配臂视图参与执行的子图内部节点(懒执行:开关只走 on_false;从 RGBA 开关 on_false 臂走)
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

    walk(RGBA_SW_ID)  # positive 终点开关(on_false=[142] 主编码臂)
    # 0928 黑图修复:正源=行4 单参考族,镜像开关 on_false=[171](0929 并行化后两族
    # 恒在执行图:支路0 [8] 吃 positive 双参考/支路1·2 [189][176] 吃 positive_single)
    walk(TE1_SW_ID)
    return reach, "\n".join(texts)


# ── 自查(写盘后必跑;任一失败退出码 1)──────────────────────────────
def self_check(g: dict, truth: dict) -> list[str]:
    errs: list[str] = []
    sg = g["definitions"]["subgraphs"][0]
    m_nodes = {n["id"]: n for n in g["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    i_links = {l["id"]: l for l in sg["links"]}
    by_type = lambda scope, t: [n for n in scope if n["type"] == t]

    # 1 JSON 结构:前端格式必需字段;无桥格式混写
    for f in ("nodes", "links", "groups"):
        if not isinstance(g.get(f), list):
            errs.append(f"缺前端格式字段 {f}")
    if "schemaVersion" in g or "graph" in g:
        errs.append("混入桥 API 格式字段")

    # 2 主图 link 双向一致 + 类型匹配
    for l in g["links"]:
        lid, oid, oslot, tid, tslot, typ = l
        origin, target = m_nodes[oid], m_nodes[tid]
        if typ != origin["outputs"][oslot]["type"]:
            errs.append(f"主图 link{lid}: origin 槽类型不匹配")
        if lid not in (origin["outputs"][oslot].get("links") or []):
            errs.append(f"主图 link{lid}: origin.outputs 未登记")
        if target["inputs"][tslot].get("link") != lid:
            errs.append(f"主图 link{lid}: target.inputs 不匹配")

    # 3 子图 link 双向一致(对象格式;-10/-20 端点对照 IO 槽 linkIds)
    for l in sg["links"]:
        lid, oid, oslot, tid, tslot, typ = (l["id"], l["origin_id"], l["origin_slot"],
                                            l["target_id"], l["target_slot"], l["type"])
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

    # 4 横向排版:主图每条连线 target.x > origin.x(含 Reroute 通道段);子图同(IO 槽 pos 为端点)
    for l in g["links"]:
        if not m_nodes[l[3]]["pos"][0] > m_nodes[l[1]]["pos"][0]:
            errs.append(f"主图 link{l[0]}: 纵向塔违规 {m_nodes[l[1]]['type']}→{m_nodes[l[3]]['type']}")
    for l in sg["links"]:
        ox = sg["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 \
            else i_nodes[l["origin_id"]]["pos"][0]
        tx = sg["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 \
            else i_nodes[l["target_id"]]["pos"][0]
        if not tx > ox:
            errs.append(f"子图 link{l['id']}: 纵向塔违规")

    # 5 节点矩形零重叠(主图+子图;MarkdownNote/Reroute 计入)
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for i in range(len(scope_nodes)):
            for j in range(i + 1, len(scope_nodes)):
                a, b = scope_nodes[i], scope_nodes[j]
                if (a["pos"][0] < b["pos"][0] + b["size"][0]
                        and b["pos"][0] < a["pos"][0] + a["size"][0]
                        and a["pos"][1] < b["pos"][1] + b["size"][1]
                        and b["pos"][1] < a["pos"][1] + a["size"][1]):
                    errs.append(f"{scope} node{a['id']} 与 node{b['id']} 矩形重叠")

    # 5b 间距阈值(0925 布局美化轮:用户令「节点之间没有足够的距离」)——est 足迹口径
    #     (同 workflow_layout.est_size):同行(y 带交叠)横净距≥200 / 同列(x 带交叠)纵净距≥80;
    #     Reroute 通道件与 MarkdownNote 说明卡豁免;全图(含豁免件)est 盒零重叠(inspect 口径)。
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

    # 5c 零负区(0925 W6①;0926 收紧 pos≥40→≥80=实测发现项3 计划断言互锁):
    #     主图+子图所有节点 pos≥80,整图平移至左上留边距,打开即全貌
    #     (子图 IO 槽非节点,负 x 表示法=K2 [90] 同款,豁免)
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for n in scope_nodes:
            if n["pos"][0] < 80 or n["pos"][1] < 80:
                errs.append(f"{scope} node{n['id']} 负区坐标 {n['pos']}(零负区:pos≥80)")

    # 5d 输出口最右(0925 W6②):子图输出 IO 槽钉死最右列(表示法=K2 [90] 实证)
    max_nx = max(n["pos"][0] for n in sg["nodes"])
    for io in sg["outputs"]:
        if io["pos"][0] < max_nx - 50:
            errs.append(f"子图输出 {io['name']} 未钉最右列(x={io['pos'][0]} < 全子图最大 x{max_nx}-50)")

    # 5e 零线遮节点(0926 铁律:用户令「工作流的美化,你只管位置,不要线与节点
    #     彼此遮盖!」)——贝塞尔 41 点采样精判(与产线判定口径逐字同款,勿用
    #     bbox 走廊口径——高估 5 倍):节点盒= size 字段(缺省 [220,120];
    #     Reroute 60×30);槽位= 输出(右缘,top+25+origin_slot×20)/输入(左缘,
    #     top+25+target_slot×20);线= 三次贝塞尔 P0=输出槽/P3=输入槽,
    #     P1=(P0.x+k,P0.y)/P2=(P3.x−k,P3.y),k=clamp(|dx|/2,40,200);任采样点
    #     落入非端点节点盒(±2 容差)即遮挡,端点豁免;主图+子图同口径;
    #     子图 -10/-20 边界线端点非节点,照产线口径跳过。
    def _occlusion_errs(scope: str, scope_nodes: list, scope_links: list) -> None:
        byid = {n["id"]: n for n in scope_nodes}

        def _obox(n: dict):
            if n.get("type") == "Reroute":
                w, h = 60, 30
            else:
                w, h = (n.get("size") or [220, 120])[:2]
            x, y = n["pos"][:2]
            return (x, y, x + w, y + h)

        def _oslot(n: dict, slot: int, side: str):
            x, y, x2, _ = _obox(n)
            sy = y + 25 + (slot or 0) * 20
            return (x2, sy) if side == "out" else (x, sy)

        def _bez(p0, p1, p2, p3, t):
            mt = 1 - t
            return (mt**3*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t**3*p3[0],
                    mt**3*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t**3*p3[1])

        for l in scope_links:
            if isinstance(l, dict):
                oid = l.get("origin_id")
                oslot_ = l.get("origin_slot", 0)
                tid = l.get("target_id")
                tslot_ = l.get("target_slot", 0)
            else:
                oid, oslot_, tid, tslot_ = l[1], l[2], l[3], l[4]
            o, t = byid.get(oid), byid.get(tid)
            if not o or not t:
                continue  # 子图 -10/-20 边界线(端点非节点,产线口径跳过)
            p0 = _oslot(o, oslot_, "out")
            p3 = _oslot(t, tslot_, "in")
            k = max(40, min(200, abs(p3[0] - p0[0]) * 0.5))
            p1 = (p0[0] + k, p0[1])
            p2 = (p3[0] - k, p3[1])
            hit = set()
            for i in range(41):
                x, y = _bez(p0, p1, p2, p3, i / 40)
                for nid, n in byid.items():
                    if nid in (oid, tid):
                        continue  # 端点豁免
                    bx = _obox(n)
                    if bx[0] - 2 <= x <= bx[2] + 2 and bx[1] - 2 <= y <= bx[3] + 2:
                        hit.add(nid)
            if hit:
                errs.append(f"{scope} link {oid}->{tid} 线遮节点 {sorted(hit)}"
                            f"(0926 铁律:线不遮节点)")

    _occlusion_errs("主图", g["nodes"], g["links"])
    _occlusion_errs("子图", sg["nodes"], sg["links"])

    # 3g. 交叉不增封顶(0928 用户裁定:「线不交叉的规则大于分组的规则」,入宪
    #     docs/comfyui-kb/画布布局规范-0928.md):主图+子图同口径;口径=同款贝塞尔
    #     24 点采样线段两两求交,每对线至多计 1 次;-10/-20 边界线跳过。
    #     **现值封顶起步防回归**(基线={'主图': 74, '子图': 10}),治理轮逐步拧紧至 0;
    #     优先级:交叉 > 组框美观——消交叉可打破组框单行/罩盖约束(契约随行同步)。
    _CROSS_BASELINE = {'主图': 52, '子图': 10}  # 0929 并行化轮实测重立(layout_check
    #     独立对拍同值):主 64→52(拆 15 件注入式机构+26 条交叉密集线网,三支路
    #     汇流扇入零编织);子 10 持平(子图本轮零改动)
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

    for _scope, _nodes, _links in (("主图", g["nodes"], g["links"]),
            ("子图", sg["nodes"], sg["links"])):
        _byid = {n["id"]: n for n in _nodes}
        _wires = []
        for _l in _links:
            _oid, _os, _tid, _ts = (_l["origin_id"], _l["origin_slot"], _l["target_id"], _l["target_slot"]) if isinstance(_l, dict) else (_l[1], _l[2], _l[3], _l[4])
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

    # 6 子图行排版:恰 6 行=六阶段(源/装配路由/编码输出/单参考编码/PE改写两带);
    #   行间净距≥100;行内 x 严格递增(Reroute 通道拐点不占行——0926 线不遮节点轮
    #   垫 [170] 拐点走框间带,样板=t2i 子图 W/H 通道同款约定)
    sg_rows: dict[int, list[int]] = {}
    for n in sg["nodes"]:
        if n["type"] == "Reroute":
            continue  # 通道拐点不占阶段行
        sg_rows.setdefault(n["pos"][1], []).append(n["id"])
    row_ys = sorted(sg_rows)
    want_rows = [
        [BASE_ID, LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID],
        [CONCAT1_ID, CONCAT2_ID, RGBA_CAT1_ID, RGBA_CAT2_ID],
        [TE_RGBA_ID, TE_ID, RGBA_SW_ID],
        # 0928 黑图修复:行4 单参考编码族(加速档正源)
        [TE1_ID, TE1R_ID, TE1_SW_ID],
        # 0928 PE 迁子图轮:行5/行6 PE 改写带(t2i 四行流水的 i2i 适配——
        # PE 改写的是指令①层,经 [15] 开关后升行2 占①层位;PE 带沉底让
        # [15]→[130] 升线走空走廊)
        [PE_A_ID, PE_C_ID, PE_BATCH_ID],
        [PE_FMT_ID, PE_TG_ID, PE_RX_ID, PE_SW_ID],
    ]
    if len(row_ys) != 6:
        errs.append(f"子图应恰 6 行(源/装配/编码/单参考/PE改写两带),得 {len(row_ys)} 行")
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

    # 7 group:主图≤3/子图≤4;全 int id 互异;主图标题带道劫+PE 组名锚;子图名带道劫;
    #   子图各框单一阶段行全部节点且两两不相交
    for scope, groups in (("主图", g["groups"]), ("子图", sg["groups"])):
        ids = [grp.get("id") for grp in groups]
        if len(ids) != len(set(ids)) or not all(isinstance(i, int) for i in ids):
            errs.append(f"{scope} group id 非互异 int")
    if len(g["groups"]) > 4:
        errs.append(f"主图 group 预算超限(≤4,W1 加速区组框),得 {len(g['groups'])}")
    # W1 加速区组框(0929 并行化轮随拓扑重建):标题带「道劫·加速区」且罩住
    # 三支路+seed 单源+单选择件六件([8]直出/[31]+[189]viggle/[176]Fun-Acc/
    # [191]seed/[190]MyQi21SpeedSelect;支路横向一行+三行纵叠)
    accel_ids = [KS_DIR_ID, LORA_ID, KS_VIG_ID, T8_ID, SEED_ID, SPEED_SEL_ID]
    accel_grp = next((grp for grp in g["groups"] if "道劫·加速区" in grp["title"]), None)
    if accel_grp is None:
        errs.append("W1 缺「道劫·加速区」组框(0929 并行化:三支路+seed+选择件六件)")
    else:
        gx0, gy0 = accel_grp["bounding"][0], accel_grp["bounding"][1]
        gx1 = gx0 + accel_grp["bounding"][2]
        gy1 = gy0 + accel_grp["bounding"][3]
        for nid in accel_ids:
            n = m_nodes[nid]
            if not (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                    and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1):
                errs.append(f"W1 加速区组框未罩住 [{nid}](方案C 组框收纳)")
    if len(sg["groups"]) > 4:
        errs.append(f"子图 group 预算超限(≤4),得 {len(sg['groups'])}")
    for grp in g["groups"]:
        if "道劫" not in grp["title"]:
            errs.append(f"主图 group {grp['title']!r} 缺道劫字号")
    # 0928 PE 迁子图轮:主图 PE-I2I 改写组框随七件迁入子图退役;W2 反转锚=
    # 「指令外露带」组框在位(PE 链在 [40] 子图,面板「PE开关」默认开)
    if not any("指令外露带" in grp.get("title", "") for grp in g["groups"]):
        errs.append("缺「指令外露带(…PE-I2I 改写链已收进[40]…)」分组(0928 PE 迁子图轮)")
    if "道劫" not in sg["name"] or "装配子图" not in sg["name"]:
        errs.append("子图 name 缺道劫·装配子图字号")
    boxes = [(grp["bounding"][0], grp["bounding"][1],
              grp["bounding"][0] + grp["bounding"][2],
              grp["bounding"][1] + grp["bounding"][3]) for grp in sg["groups"]]
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            if (boxes[i][0] < boxes[j][2] and boxes[j][0] < boxes[i][2]
                    and boxes[i][1] < boxes[j][3] and boxes[j][1] < boxes[i][3]):
                errs.append(f"子图 group 框 {i} 与 {j} 相交")
    for grp in sg["groups"]:
        gx0, gy0 = grp["bounding"][0], grp["bounding"][1]
        gx1, gy1 = gx0 + grp["bounding"][2], gy0 + grp["bounding"][3]
        inside = [n for n in sg["nodes"]
                  if gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                  and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1]
        if not inside:
            errs.append(f"子图 group {grp['title']!r} 未框住任何节点(装饰框即病)")
        elif len({n["pos"][1] for n in inside}) != 1:
            errs.append(f"子图 group {grp['title']!r} 跨行框住节点(应只框单一阶段行)")
        else:
            row_y = inside[0]["pos"][1]
            row_all = [n["id"] for n in sg["nodes"] if n["pos"][1] == row_y]
            if sorted(n["id"] for n in inside) != sorted(row_all):
                errs.append(f"子图 group {grp['title']!r} 应框住其阶段行全部节点")

    # 8 id 计数器真值 ≥ 实存最大(根图+子图一并计入)
    node_ids = [n["id"] for n in g["nodes"]] + [n["id"] for n in sg["nodes"]]
    link_ids = [l[0] for l in g["links"]] + [l["id"] for l in sg["links"]]
    if g.get("last_node_id", 0) < max(node_ids):
        errs.append("last_node_id 陈旧")
    if g.get("last_link_id", 0) < max(link_ids):
        errs.append("last_link_id 陈旧")

    # 9 节点类型白名单(TE-Speed 槽禁入本件——任何未知类型即红;宿主节点 type=子图 UUID 豁免)
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for n in scope_nodes:
            if n["id"] == HOST_ID and n["type"] == SG_UUID:
                continue
            if n["type"] not in NODE_TYPE_WHITELIST:
                errs.append(f"{scope} node{n['id']} 类型 {n['type']!r} 不在白名单(TE-Speed 槽禁入)")

    # 10 节点标题铁律(0924-r8+0925 归位):核心/第三方零自定义 title,仅自研(My*)
    #    可命且零道劫前缀——道劫只留 Group 框/子图名/说明卡(0925 用户裁定)
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for n in scope_nodes:
            if "title" in n and not n["type"].startswith("My"):
                errs.append(f"{scope} node{n['id']}({n['type']}) 核心节点带自定义 title")
            if n["type"] != "MarkdownNote" and "道劫" in (n.get("title") or ""):
                errs.append(f"{scope} node{n['id']} 标题含道劫前缀(0925 归位:节点标题零道劫): {n.get('title')!r}")

    # 11 孤儿可达(SaveImage 回溯;MarkdownNote/easy showAnything 豁免)
    seen, stack = set(), [10]
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        for i in m_nodes[nid].get("inputs", []):
            if i.get("link") is not None:
                stack.append(m_links[i["link"]][1])
    orphans = sorted(i for i in m_nodes if i not in seen
                     and m_nodes[i]["type"] not in ("MarkdownNote", "easy showAnything"))
    if orphans:
        errs.append(f"孤儿节点: {orphans}")

    # 12 加载器三件套 + PE loader 逐字
    for typ, want in (("UNETLoader", UNET_FILE), ("VAELoader", VAE_FILE)):
        got = [n for n in by_type(g["nodes"], typ) if n["widgets_values"][0] == want]
        if len(got) != 1:
            errs.append(f"{typ}({want}) 应恰 1 个")
    main_clip = [n for n in by_type(g["nodes"], "CLIPLoader")
                 if n["widgets_values"][0] == CLIP_FILE]
    if len(main_clip) != 1 or main_clip[0]["widgets_values"][1] != "qwen_image":
        errs.append("主 CLIPLoader 文件/type 漂移")
    pe_clip = [n for n in by_type(g["nodes"], "CLIPLoader")
               if n["widgets_values"][0] == PE_CLIP_FILE]
    if len(pe_clip) != 1 or pe_clip[0]["widgets_values"][1] != "qwen_image":
        errs.append("PE CLIPLoader(pe_i2i bf16·qwen_image) 应恰 1 个")

    # 13 KSampler 契约(0929 并行化:恰 2=直出40/viggle359,steps 回归 widget=
    #     面板值即生效值,零摆设值)+ Cache 挂位
    ks = by_type(g["nodes"], "KSampler")
    if sorted(n["id"] for n in ks) != sorted([KS_DIR_ID, KS_VIG_ID]):
        errs.append(f"KSampler 应恰 2(直出[{KS_DIR_ID}]40步/viggle[{KS_VIG_ID}]359步,"
                    f"并行支路本体非真重复),得 {sorted(n['id'] for n in ks)}")
    else:
        for nid, want_steps in ((KS_DIR_ID, STEPS_OFF), (KS_VIG_ID, STEPS_ON)):
            wv = m_nodes[nid]["widgets_values"]
            if not (wv[2] == want_steps and wv[3] == 1 and wv[4] == "euler"
                    and wv[5] == "simple" and wv[6] == 1.0 and wv[1] == "fixed"):
                errs.append(f"[{nid}] KSampler 参数漂移(steps={want_steps}/cfg1/euler/"
                            f"simple/denoise1/fixed): {wv}")
            if any(i.get("name") == "steps" for i in m_nodes[nid]["inputs"]):
                errs.append(f"[{nid}] steps 应为纯 widget(0929:步数回归支路面板,零联动开关)")
    cache = by_type(g["nodes"], "QwenImage21Cache")
    if len(cache) != 1 or cache[0]["widgets_values"] != ["auto", "default"]:
        errs.append("QwenImage21Cache(auto/default) 应恰 1")
    else:
        up = _trace_reroute_main(m_links, m_nodes, cache[0]["inputs"][0]["link"])
        if m_nodes[up]["type"] != "UNETLoader":
            errs.append("Cache 上游应 UNETLoader(可穿顶通道 Reroute)")
        dn = m_links[cache[0]["outputs"][0]["links"][0]]
        if m_nodes[dn[3]]["type"] not in ("KSampler", "LoraLoaderModelOnly"):
            errs.append("Cache 下游应在通往采样器的 MODEL 链上")

    # 14 三支路并行+单选择件(0929 并行化轮;注入式开关农场 13 件全拆,R8 复用铁则)
    # 14a LoRA 槽(viggle 支路本体)
    loras = by_type(g["nodes"], "LoraLoaderModelOnly")
    if len(loras) != 1 or loras[0]["id"] != LORA_ID:
        errs.append(f"LoraLoaderModelOnly[{LORA_ID}] 应恰 1(viggle 支路本体)")
    else:
        if loras[0]["widgets_values"] != [LORA_FILE, 0.8]:
            errs.append(f"LoRA 槽 name/strength 漂移: {loras[0]['widgets_values']}")
        if _trace_reroute_main(m_links, m_nodes, loras[0]["inputs"][0]["link"]) != 7:
            errs.append("LoRA 槽 model 上游应 QwenImage21Cache[7](单源扇出)")
        if m_links[loras[0]["outputs"][0]["links"][0]][3] != KS_VIG_ID:
            errs.append(f"LoRA 输出应直喂 viggle 支路 KSampler[{KS_VIG_ID}]")
    # 14b MODEL 单源扇出:Cache 一源三用(直出直连/LoRA 链/T8 直连——T8 绝不吃 LoRA)
    for nid in (KS_DIR_ID, LORA_ID, T8_ID):
        if _trace_reroute_main(m_links, m_nodes, m_nodes[nid]["inputs"][0]["link"]) != 7:
            errs.append(f"[{nid}].model 应溯 Cache[7] 单源扇出(base 直连;"
                        f"T8 绝不吃 viggle LoRA=R7 不变量)")
    if sorted(m_nodes[7]["outputs"][0]["links"] or []) != sorted([25, 66, 29]):
        errs.append("Cache[7] MODEL 应扇出恰三线(LoRA/直出/T8,单源扇出清单)")
    # 14c 正源双路分线直入(0928 黑图修复铁则:支路0 双参考官方路/支路1·2 单参考;
    #     照抄 t2i 统一扇出会复现 0928 黑图)
    def _trace_to_link(lid: int) -> tuple[int, int]:
        while m_nodes[m_links[lid][1]]["type"] == "Reroute":
            lid = m_nodes[m_links[lid][1]]["inputs"][0]["link"]
        o = m_links[lid]
        return o[1], o[2]
    if _trace_to_link(m_nodes[KS_DIR_ID]["inputs"][1]["link"]) != (HOST_ID, 0):
        errs.append(f"[{KS_DIR_ID}].positive 应宿主槽0 positive(双参考=直出支路官方路)")
    for nid in (KS_VIG_ID, T8_ID):
        if _trace_to_link(m_nodes[nid]["inputs"][1]["link"]) != (HOST_ID, 4):
            errs.append(f"[{nid}].positive 应宿主槽4 positive_single(单参考=黑图修复铁则)")
    if _trace_to_link(m_nodes[KS_DIR_ID]["inputs"][1]["link"]) == \
            _trace_to_link(m_nodes[KS_VIG_ID]["inputs"][1]["link"]):
        errs.append("支路0 与支路1/2 positive 源应不同(双参考 vs 单参考,0928 黑图根因)")
    # 14d latent 同源三用+负面占位(T8 无负面槽)
    for nid, lslot in ((KS_DIR_ID, 3), (KS_VIG_ID, 3), (T8_ID, 2)):
        if m_links[m_nodes[nid]["inputs"][lslot]["link"]][1] != 20:
            errs.append(f"[{nid}].latent_image 上游应 [20] 画幅开关(三支路同源)")
    for nid in (KS_DIR_ID, KS_VIG_ID):
        if _trace_to_link(m_nodes[nid]["inputs"][2]["link"]) != (HOST_ID, 1):
            errs.append(f"[{nid}].negative 应宿主槽1(占位口径 W5,cfg=1)")
    t8 = m_nodes[T8_ID]
    if t8["type"] != T8_CLASS:
        errs.append(f"[{T8_ID}] 应为 {T8_CLASS}(Fun-Acc 支路采样器)")
    if t8["widgets_values"] != [FUNACC_FILE, 0]:
        errs.append(f"[{T8_ID}] model_file/seed 漂移(应 {FUNACC_FILE}/seed 0),得 {t8.get('widgets_values')}")
    if len([i for i in t8["inputs"] if i.get("name") == "negative"]) != 0:
        errs.append(f"[{T8_ID}] T8 无负面槽(输入仅 model/positive/latent_image/model_file/seed)")
    if len([n for n in g["nodes"] if n["type"] == T8_CLASS]) != 1:
        errs.append(f"{T8_CLASS} 应恰 1 个(Fun-Acc 支路)")
    # 14e seed 单源扇出(一处改三支路同步;T8 seed 输入化)
    seed_node = m_nodes[SEED_ID]
    if seed_node["type"] != "PrimitiveInt" or seed_node["widgets_values"] != [0, "fixed"]:
        errs.append(f"[{SEED_ID}] 应 PrimitiveInt seed(默认 0 fixed,三支路共享),"
                    f"得 {seed_node.get('widgets_values')}")
    if sorted(seed_node["outputs"][0]["links"] or []) != sorted([79, 80, 81]):
        errs.append(f"[{SEED_ID}] seed 源应扇出恰三线(三采样器,单源扇出)")
    for nid in (KS_DIR_ID, KS_VIG_ID, T8_ID):
        inp = m_nodes[nid]["inputs"][4]
        if inp.get("name") != "seed" or "widget" not in inp:
            errs.append(f"[{nid}].seed 应为 widget 转输入(T8 seed 输入化)")
        elif _trace_reroute_main(m_links, m_nodes, inp["link"]) != SEED_ID:
            errs.append(f"[{nid}].seed 上游应 [{SEED_ID}] seed 单源(三支路共享)")
    # 14f MyQi21SpeedSelect 单选择件(combo 首项=默认=直出40步;三槽接线;汇流→[9])
    sel = m_nodes[SPEED_SEL_ID]
    if sel["type"] != SPEED_SELECT_CLASS:
        errs.append(f"[{SPEED_SEL_ID}] 应为 {SPEED_SELECT_CLASS}(单选择件,0929 方案 B)")
    else:
        if sel["widgets_values"][0] != SPEED_COMBO[0]:
            errs.append(f"[{SPEED_SEL_ID}] mode 默认应=首项 {SPEED_COMBO[0]!r}"
                        f"(直出40步,0929 拉齐重放),得 {sel.get('widgets_values')}")
        if [i["name"] for i in sel["inputs"]] != ["mode", "latent_funacc",
                                                  "latent_viggle", "latent_direct"]:
            errs.append(f"[{SPEED_SEL_ID}] 输入槽序应 mode/latent_funacc/latent_viggle/"
                        f"latent_direct(=自研件 INPUT_TYPES 单源)")
        for slot, src in ((1, T8_ID), (2, KS_VIG_ID), (3, KS_DIR_ID)):
            if m_links[sel["inputs"][slot]["link"]][1] != src:
                errs.append(f"[{SPEED_SEL_ID}] 槽{slot}({sel['inputs'][slot]['name']})"
                            f" 应接 [{src}] 支路输出")
        if [o["type"] for o in sel["outputs"]] != ["LATENT"] or sel["outputs"][0]["links"] != [85]:
            errs.append(f"[{SPEED_SEL_ID}] 输出应 LATENT 单线(选中支路直通)")
    if m_links[m_nodes[9]["inputs"][0]["link"]][1] != SPEED_SEL_ID:
        errs.append(f"[9].samples 上游应 {SPEED_SELECT_CLASS}[{SPEED_SEL_ID}](三支路汇流)")
    # 14g 注入式反模式零残留(0929 拆除 13 选择逻辑件+2 垫脚石)
    if any(n["type"] == "easy compare" for n in g["nodes"]):
        errs.append("主图应零 easy compare(0929 并行化:比较器全拆,白名单已出册)")
    sw_main = sorted(n["id"] for n in by_type(g["nodes"], "ComfySwitchNode"))
    if sw_main != [20]:
        errs.append(f"主图 ComfySwitchNode 应恰 1=[20] 画幅双路(档位类开关全拆),得 {sw_main}")
    pi_main = sorted(n["id"] for n in by_type(g["nodes"], "PrimitiveInt"))
    if pi_main != [SEED_ID]:
        errs.append(f"主图 PrimitiveInt 应恰 1=[{SEED_ID}] seed(档位/常量件全拆),得 {pi_main}")
    # 14h 零真重复(R8 复用铁则谓词:同 type+同上游集合+同 widgets 不得两件)
    def _dup_key(n: dict, lmap: dict) -> tuple:
        ups = []
        for i in n.get("inputs", []):
            lid = i.get("link")
            if lid is None:
                continue
            l = lmap[lid]
            oid = l[1] if isinstance(l, list) else l["origin_id"]
            oslot = l[2] if isinstance(l, list) else l["origin_slot"]
            ups.append((oid, oslot, i.get("name")))
        return (n["type"], json.dumps(n.get("widgets_values"), ensure_ascii=False),
                tuple(sorted(ups, key=str)))
    for scope, scope_nodes, scope_lmap in (
            ("主图", g["nodes"], m_links), ("子图", sg["nodes"], i_links)):
        groups_dup: dict[tuple, list[int]] = {}
        for n in scope_nodes:
            groups_dup.setdefault(_dup_key(n, scope_lmap), []).append(n["id"])
        for key, ids in groups_dup.items():
            if len(ids) > 1:
                errs.append(f"{scope} 真重复节点(R8 复用铁则:同 type+同上游+同 widgets)"
                            f": {ids} type={key[0]!r}")
    # 14i 子图行4 单参考族契约(0928 黑图修复正源真源,0929 并行化保留勿动:
    #     无 image_2=根因规避;词源与行3 同源;宿主 positive_single 输出槽)
    for nid, prompt_src in ((TE1_ID, CONCAT2_ID), (TE1R_ID, RGBA_CAT2_ID)):
        te1n = i_nodes[nid]
        if te1n["type"] != "TextEncodeQwenImage21":
            errs.append(f"子图[{nid}] 应为 TextEncodeQwenImage21(单参考编码)")
        if any(i["name"] == "images.image_2" for i in te1n["inputs"]):
            errs.append(f"子图[{nid}] 单参考编码不得带 image_2(双参考即黑图根因)")
        if i_links[te1n["inputs"][3]["link"]]["origin_id"] != prompt_src:
            errs.append(f"子图[{nid}].prompt 词源应 [{prompt_src}](与行3 同源)")
        _im = i_links[te1n["inputs"][1]["link"]]
        if _im["origin_id"] != -10 or _im["origin_slot"] != 2:
            errs.append(f"子图[{nid}].image_1 应边界槽2(仅 image_1)")
    te1sw = i_nodes[TE1_SW_ID]
    if te1sw["type"] != "ComfySwitchNode":
        errs.append(f"子图[{TE1_SW_ID}] 应为 ComfySwitchNode(RGBA 镜像开关)")
    if i_links[te1sw["inputs"][2]["link"]]["origin_id"] != -10 \
            or i_links[te1sw["inputs"][2]["link"]]["origin_slot"] != 6:
        errs.append(f"子图[{TE1_SW_ID}].switch 应边界槽6(同宿主 RGBA透明开关)")
    if _trace_origin(i_links, i_nodes, te1sw["inputs"][0]["link"]) != TE1_ID:
        errs.append(f"子图[{TE1_SW_ID}].on_false 应单参考主编码 [{TE1_ID}]")
    if _trace_origin(i_links, i_nodes, te1sw["inputs"][1]["link"]) != TE1R_ID:
        errs.append(f"子图[{TE1_SW_ID}].on_true 应单参考 RGBA 编码 [{TE1R_ID}]")
    if len(sg["outputs"]) != 5 or sg["outputs"][4]["name"] != "positive_single":
        errs.append("子图输出应 5 槽(含 positive_single,0928 黑图修复正源)")

    # 三档干跑(懒执行语义:MyQi21SpeedSelect 只走选中档 latent 槽,未选支路零执行零加载;
    # 默认态=combo 首项=直出40步(0929 拉齐重放))
    d_def = _dry_run_main(g)
    if KS_DIR_ID not in d_def or SPEED_SEL_ID not in d_def or SEED_ID not in d_def:
        errs.append("干跑:默认态(直出40步)执行图应含直出 KSampler+选择件+seed 单源")
    if T8_ID in d_def:
        errs.append(f"干跑:默认态(直出40步)T8[{T8_ID}] 不应执行(懒裁剪)")
    if KS_VIG_ID in d_def or LORA_ID in d_def:
        errs.append("干跑:默认态(直出40步)viggle 支路(KSampler+LoRA)不应执行/加载(懒裁剪)")
    d1 = _dry_run_main(g, mode_override=MODE_VIGGLE)
    if LORA_ID not in d1 or KS_VIG_ID not in d1:
        errs.append("干跑:档1(viggle)执行图应含 LoRA+viggle KSampler(支路自足)")
    if KS_DIR_ID in d1 or T8_ID in d1:
        errs.append("干跑:档1 直出/Fun-Acc 支路不应执行(未选支路零空转零加载)")
    if m_nodes[KS_VIG_ID]["widgets_values"][2] != STEPS_ON:
        errs.append(f"干跑:档1 steps 生效值=面板值 {STEPS_ON}(0929 拉齐值,支路 widget)")
    d0 = _dry_run_main(g, mode_override=MODE_DIRECT)
    if KS_DIR_ID not in d0 or SEED_ID not in d0:
        errs.append("干跑:档0(直出)执行图应含直出 KSampler+seed 单源(40 步主线)")
    if KS_VIG_ID in d0 or LORA_ID in d0 or T8_ID in d0:
        errs.append("干跑:档0 应零 viggle 支路零 T8(未选支路零执行零加载)")
    if m_nodes[KS_DIR_ID]["widgets_values"][2] != STEPS_OFF:
        errs.append(f"干跑:档0 steps 生效值=面板值 {STEPS_OFF}(官方完整档)")
    # 0929 拉齐重放后默认=直出,档2(Fun-Acc)改经 override 显式核(三档覆盖只增不减)
    d2 = _dry_run_main(g, mode_override=MODE_FUNACC)
    if T8_ID not in d2 or SPEED_SEL_ID not in d2:
        errs.append(f"干跑:档2(Fun-Acc)执行图应含 T8[{T8_ID}]+选择件(主加速支路)")
    for nid in (KS_DIR_ID, KS_VIG_ID, LORA_ID):
        if nid in d2:
            errs.append(f"干跑:档2 [{nid}] 不应执行(懒选择只拉起 Fun-Acc 支路)")

    # 15 PE-I2I 链(0928 PE 迁子图轮:七件收进 [40] 子图,W2 反转=主图零 PE 件)
    tg = by_type(sg["nodes"], "TextGenerate")
    if len(tg) != 1 or tg[0]["id"] != PE_TG_ID:
        errs.append(f"子图 TextGenerate[{PE_TG_ID}] 应恰 1(PE 链已迁入),得 {[n['id'] for n in tg]}")
    else:
        if tg[0]["widgets_values"] != TG_WV:
            errs.append(f"TextGenerate 参数漂移: {tg[0]['widgets_values']}")
        _cl = i_links[tg[0]["inputs"][0]["link"]]
        if _cl["origin_id"] != -10 or _cl["origin_slot"] != SG_SLOT_PE_CLIP:
            errs.append("TextGenerate.clip 应接 -10 pe_clip 槽(主图 [12] 一进线)")
        _im = i_links[tg[0]["inputs"][1]["link"]]
        if _im["origin_id"] != PE_BATCH_ID:
            errs.append("TextGenerate.image 上游应合批 [25](PE 看全图)")
        if i_links[tg[0]["inputs"][4]["link"]]["origin_id"] != PE_FMT_ID:
            errs.append("TextGenerate.prompt 上游应拼装 [24](chatml 全文)")
    fmt = by_type(sg["nodes"], "StringFormat")
    if len(fmt) != 1 or fmt[0]["widgets_values"] != ["{a}{b}{c}"]:
        errs.append("子图 StringFormat {a}{b}{c} 应恰 1")
    psm = {n["id"]: n["widgets_values"][0] for n in by_type(sg["nodes"], "PrimitiveStringMultiline")}
    if psm.get(PE_A_ID) != A_SEG:
        errs.append("a 段(官方 i2i 系统提示词 chatml)漂移")
    if psm.get(PE_C_ID) != C_SEG:
        errs.append("c 段(assistant+<think> 预填)漂移")
    psm_main = {n["id"]: n["widgets_values"][0] for n in by_type(g["nodes"], "PrimitiveStringMultiline")}
    if psm_main.get(22) != B_SEG:
        errs.append("b 段(原始用户词/指令,主图 [22] 唯一手写位)漂移")
    rx = by_type(sg["nodes"], "RegexExtract")
    if len(rx) != 1 or rx[0]["id"] != PE_RX_ID:
        errs.append(f"子图 RegexExtract[{PE_RX_ID}] 应恰 1(PE 链已迁入),得 {[n['id'] for n in rx]}")
    else:
        wv = rx[0]["widgets_values"]
        if wv[1] != REGEX or wv[2] != "First Group" or wv[5] is not True:
            errs.append("RegexExtract pattern/mode/dotall 漂移")
        if i_links[rx[0]["inputs"][0]["link"]]["origin_id"] != PE_TG_ID:
            errs.append("RegexExtract 上游应 TextGenerate")
    sw = i_nodes[PE_SW_ID]
    if sw["type"] != "ComfySwitchNode" or sw["widgets_values"][0] is not True:
        errs.append("[15] 指令开关默认应 true(PE 开路,0926 裁定1 含画布本体;关=直写按图选配)")
    _of = i_links[sw["inputs"][0]["link"]]
    if _of["origin_id"] != -10 or _of["origin_slot"] != 4:
        errs.append("[15].on_false 应 -10 槽4 指令(直写臂)")
    if i_links[sw["inputs"][1]["link"]]["origin_id"] != PE_RX_ID:
        errs.append("[15].on_true 应 RegexExtract [27](PE-I2I 改写)")
    _sw_l = i_links[sw["inputs"][2]["link"]]
    if _sw_l["origin_id"] != -10 or _sw_l["origin_slot"] != SG_SLOT_PE_SW:
        errs.append("[15].switch 应接 -10 PE开关 槽(宿主面板,默认 true)")
    if i_links[sw["outputs"][0]["links"][0]]["target_id"] != CONCAT1_ID:
        errs.append("[15] 输出应直喂拼接①.string_a(①层占位,全程子图内)")
    if m_links[m_nodes[HOST_ID]["inputs"][4]["link"]][1] != 22:
        errs.append("宿主.指令 上游应 [22] 原始用户词(指令①层唯一手写位,0928 迁子图后直喂)")
    if m_links[m_nodes[HOST_ID]["inputs"][SG_SLOT_PE_CLIP]["link"]][1] != 12:
        errs.append("宿主.pe_clip 上游应 PE CLIPLoader[12](一进线)")
    # W2 反转(0928 PE 迁子图轮):主图零 PE 链件
    for banned in ("TextGenerate", "StringFormat", "RegexExtract", "BatchImagesNode"):
        hit = [n["id"] for n in g["nodes"] if n["type"] == banned]
        if hit:
            errs.append(f"0928 PE 迁子图:主图应零 {banned}(PE 链已收进 [40] 子图),得 {hit}")

    # 16 多图双通道(0928 PE 迁子图轮:合批随 PE 链入子图,吃 -10 image_1/2 边界)
    batch = by_type(sg["nodes"], "BatchImagesNode")
    if len(batch) != 1 or batch[0]["id"] != PE_BATCH_ID:
        errs.append(f"子图 BatchImagesNode[{PE_BATCH_ID}] 应恰 1(PE 全图通道),得 {[n['id'] for n in batch]}")
    else:
        wired = [i for i in batch[0]["inputs"] if i.get("link")]
        slots = {i_links[i["link"]]["origin_slot"] for i in wired
                 if i_links[i["link"]]["origin_id"] == -10}
        if len(wired) < 2 or slots != {2, 3}:
            errs.append("合批应接 -10 槽2/槽3(双图边界,PE 看全图)")
        if i_links[51]["origin_id"] != PE_BATCH_ID or i_links[51]["target_id"] != PE_TG_ID:
            errs.append("合批输出应喂 TextGenerate.image")
    for slot, want in ((2, 16), (3, 17)):
        if m_links[m_nodes[HOST_ID]["inputs"][slot]["link"]][1] != want:
            errs.append(f"宿主 image 槽{slot} 上游应预缩件[{want}]")
    for enc_id in (TE_ID, TE_RGBA_ID):
        enc = i_nodes[enc_id]
        imgs = [(idx, i) for idx, i in enumerate(enc["inputs"])
                if i["name"].startswith("images.")]
        if [i["name"] for _, i in imgs] != ["images.image_1", "images.image_2"]:
            errs.append(f"[{enc_id}] 编辑器图槽序应 image_1/image_2")
        if any(i.get("link") is None for _, i in imgs):
            errs.append(f"[{enc_id}] RGBA 路同样要接双图(i2i 语义:透明路也看图编辑)")
        if enc["widgets_values"][2] != 0:
            errs.append(f"[{enc_id}] resolution 应 0(不重采样,画幅随输入图)")
        if enc["widgets_values"][0] != "":
            errs.append(f"[{enc_id}] prompt widget 应清空(连线供词)")
    scales = by_type(g["nodes"], "ImageScaleToTotalPixels")
    if len(scales) != 2:
        errs.append("预缩应恰 2(画布 1.5MP/参考 1.0MP)")
    else:
        mps = sorted(n["widgets_values"][1] for n in scales)
        if mps != [1.0, 1.5]:
            errs.append(f"预缩 MP 档漂移:{mps}")
        for s in scales:
            if s["widgets_values"][0] != "lanczos" or s["widgets_values"][2] != 32:
                errs.append(f"[{s['id']}] 预缩应 lanczos·32")
            if m_nodes[m_links[s["inputs"][0]["link"]][1]]["type"] != "LoadImage":
                errs.append(f"[{s['id']}] 预缩上游应 LoadImage")
    imgs_loaded = sorted(n["widgets_values"][0] for n in by_type(g["nodes"], "LoadImage"))
    if imgs_loaded != [IMG2, IMG1]:
        errs.append(f"示例双图漂移:{imgs_loaded}")

    # 17 latent 双路(默认跟随 image_1;0929 并行化后主图布尔源唯 [19] 画幅,
    #     档位类机构零残留)
    pb = by_type(g["nodes"], "PrimitiveBoolean")
    if sorted(n["id"] for n in pb) != [19]:
        errs.append(f"PrimitiveBoolean 应恰 1([19] 画幅双路),得 {sorted(n['id'] for n in pb)}")
    if m_nodes[19]["widgets_values"][0] is not False:
        errs.append("[19] 画幅开关源默认应 false(跟随输入图)")
    lsw2 = m_nodes[20]
    if lsw2["type"] != "ComfySwitchNode" or lsw2["outputs"][0]["type"] != "LATENT":
        errs.append("[20] 应为 LATENT 泛型开关")
    if lsw2["widgets_values"][0] is not False:
        errs.append("[20] 画幅开关默认应 false")
    if m_links[lsw2["inputs"][0]["link"]][1] != HOST_ID:
        errs.append("画幅开关 on_false 应宿主.latent(跟随 image_1)")
    if m_nodes[m_links[lsw2["inputs"][1]["link"]][1]]["id"] != 18:
        errs.append("画幅开关 on_true 应 EmptyLatentImage[18]")
    if m_nodes[m_links[lsw2["inputs"][2]["link"]][1]]["id"] != 19:
        errs.append("画幅开关 switch 应 PrimitiveBoolean[19]")
    if m_links[m_nodes[8]["inputs"][3]["link"]][1] != 20:
        errs.append("KSampler.latent_image 上游应画幅开关 [20]")
    el = by_type(g["nodes"], "EmptyLatentImage")
    if len(el) != 1 or el[0]["widgets_values"] != [1024, 1024, 1]:
        errs.append("EmptyLatentImage(1024×1024×1)应恰 1")

    # 18 宿主结构:type/properties.subgraph=uuid;槽序与子图 inputs 对齐;widget 值
    host = m_nodes[HOST_ID]
    if host["type"] != SG_UUID or host["properties"].get("subgraph") != SG_UUID:
        errs.append("[40] 宿主 type/properties.subgraph 与子图 uuid 不一致")
    if len(host["inputs"]) != len(sg["inputs"]):
        errs.append("[40] 宿主 inputs 槽数与子图 inputs 不一致")
    for i, (hi, si) in enumerate(zip(host["inputs"], sg["inputs"])):
        if hi["name"] != si["name"] or hi["type"] != si["type"]:
            errs.append(f"[40] 宿主 inputs[{i}]({hi['name']}) 与子图 inputs[{i}]({si['name']}) 不对齐")
    if host["widgets_values"] != [B_SEG, DEFAULT_TYPE, False, True]:
        errs.append("[40] 宿主 widgets_values 应=[官方换装例句, 人物, False, True]"
                    "(PE开关默认 true=0926 裁定1,0928 PE 迁子图轮上面板)")
    if [i["name"] for i in host["inputs"] if "widget" in i] != ["指令", "型选择", "RGBA透明开关", "PE开关"]:
        errs.append("[40] 宿主面板 widget 型输入应为 指令+型选择+RGBA透明开关+PE开关(槽序)")
    # 主图无平铺装配件(装配核心已收进子图)
    for banned in ("TextEncodeQwenImage21", "StringConstant", "StringConcatenate",
                   "MyQi21DaojieBase"):
        if any(n["type"] == banned for n in g["nodes"]):
            errs.append(f"主图不应有平铺 {banned}(装配核心已收进子图)")

    # 19 MyQi21DaojieBase:在场/combo 默认人物/base 槽接 -10 槽5/喂拼接①;级联与画幅联动不移植
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
        if not bl or bl["origin_id"] != -10 or bl["origin_slot"] != 5:
            errs.append("[150].base 应接 -10 槽5(宿主面板「型选择」COMBO)")
        if [o["name"] for o in base_node["outputs"]] != ["BASE", "WIDTH", "HEIGHT", "型名"]:
            errs.append("[150] 四出应为 BASE/WIDTH/HEIGHT/型名")
        if base_node["outputs"][1]["links"] is not None or base_node["outputs"][2]["links"] is not None:
            errs.append("[150] WIDTH/HEIGHT 本件不接(画幅联动行不移植,画幅随输入图)")
        if i_links[i_nodes[CONCAT1_ID]["inputs"][1]["link"]]["origin_id"] != BASE_ID:
            errs.append("拼接①.string_b 上游应为 [150].BASE(②层)")
    # 子图开关恰 3(0928 PE 迁子图轮:+[15] 指令开关);画幅联动件零移植
    switches = [n for n in sg["nodes"] if n["type"] == "ComfySwitchNode"]
    # 0928 黑图修复:+[173] 单参考 RGBA 镜像开关(行4)
    if sorted(n["id"] for n in switches) != [PE_SW_ID, RGBA_SW_ID, TE1_SW_ID]:
        errs.append(f"子图开关应恰 3 枚(指令PE开关+RGBA+单参考镜像),"
                    f"得 {[n['id'] for n in switches]}")
    for banned in ("ComfyNumberConvert", "ComfyMathExpression"):
        if any(n["type"] == banned for n in sg["nodes"]):
            errs.append(f"子图不应有 {banned}(画幅联动行不移植)")
    sconsts = [n for n in sg["nodes"] if n["type"] == "StringConstant"]
    if sorted(n["id"] for n in sconsts) != sorted([LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID]):
        errs.append(f"子图 StringConstant 应恰 3 枚(锁层A+RGBA头尾),得 {[n['id'] for n in sconsts]}")

    # 20 真源互锁:锁层A 恒挂逐字=库;干跑直写选配臂装配逐字=指令+人物BASE+锁层A;懒执行
    if i_nodes[LOCK_ID]["widgets_values"][0] != truth["const_a"]:
        errs.append("[110] 通用锁层常量A 与库首节常量不逐字一致")
    lock_link = i_links[i_nodes[LOCK_ID]["outputs"][0]["links"][0]]
    if lock_link["target_id"] != CONCAT2_ID:
        errs.append("[110] 应恒挂直连拼接②(不随型走开关)")
    if _qi21_base_text(DEFAULT_TYPE) != truth["types"][0]["constant_text"]:
        errs.append("干跑 BASE(qi21_bases.json 人物)与 05 库人物型②层装配不逐字一致")
    reach_int, assembled = _dry_run_default(g, sg)
    if BASE_ID not in reach_int or LOCK_ID not in reach_int:
        errs.append(f"干跑:直写选配臂应含 [{BASE_ID}]底座/[{LOCK_ID}]锁层,得 {sorted(reach_int)}")
    for nid in (RGBA_HEAD_ID, RGBA_TAIL_ID, RGBA_CAT1_ID, RGBA_CAT2_ID, TE_RGBA_ID):
        if nid in reach_int:
            errs.append(f"干跑:直写选配臂 [{nid}] 不应可达(RGBA 懒执行旁路)")
    for nid in (PE_A_ID, PE_C_ID, PE_FMT_ID, PE_BATCH_ID, PE_TG_ID, PE_RX_ID):
        if nid in reach_int:
            errs.append(f"干跑:直写选配臂 [{nid}] 不应可达(PE 懒执行旁路,关 PE 时 PE 模型不加载)")
    want_assembly = "\n".join([B_SEG, _qi21_base_text(DEFAULT_TYPE), truth["const_a"]])
    if assembled != want_assembly:
        errs.append("干跑:直写选配臂装配全文 ≠ 指令+人物BASE+锁层A 组合(逐字)")
    # 拼接节点 delimiter:装配 \n 分层 / RGBA 公式空格
    if i_nodes[CONCAT1_ID]["widgets_values"][2] != "\n" or \
       i_nodes[CONCAT2_ID]["widgets_values"][2] != "\n":
        errs.append("装配拼接 delimiter 应 \\n(换行分层,05 库口径)")

    # 21 RGBA 官方公式:头尾逐字/空格 delimiter/[143].prompt 接公式输出/[144] 默认关
    if i_nodes[RGBA_HEAD_ID]["widgets_values"][0] != RGBA_HEAD_EN or \
       i_nodes[RGBA_TAIL_ID]["widgets_values"][0] != RGBA_TAIL_EN:
        errs.append("RGBA 官方头/尾常量非官方原文逐字")
    cat1, cat2 = i_nodes[RGBA_CAT1_ID], i_nodes[RGBA_CAT2_ID]
    if cat1["widgets_values"][2] != " " or cat2["widgets_values"][2] != " ":
        errs.append("RGBA 公式拼接 delimiter 应为空格")
    if i_links[cat1["inputs"][1]["link"]]["origin_id"] != CONCAT2_ID:
        errs.append("RGBA 公式拼接①.string_b 上游应为装配全文([28] 同源)")
    rgba_prompt_link = i_links.get(i_nodes[TE_RGBA_ID]["inputs"][4]["link"])
    if not rgba_prompt_link or rgba_prompt_link["origin_id"] != RGBA_CAT2_ID:
        errs.append("[143].prompt 应接 [163] RGBA 公式拼接输出")
    rgba_sw = i_nodes[RGBA_SW_ID]
    if rgba_sw["widgets_values"][0] is not False:
        errs.append("[144] RGBA 开关默认应 false(普通路)")
    rsl = i_links[rgba_sw["inputs"][2]["link"]]
    if rsl["origin_id"] != -10 or rsl["origin_slot"] != 6:
        errs.append("[144] switch 槽应接 -10 槽6(宿主面板 RGBA透明开关)")
    if i_links[rgba_sw["inputs"][0]["link"]]["origin_id"] != TE_ID:
        errs.append("[144] on_false 应主编码 [142]")
    if _trace_origin(i_links, i_nodes, rgba_sw["inputs"][1]["link"]) != TE_RGBA_ID:
        errs.append("[144] on_true 应 RGBA 编码 [143](可穿 Reroute 拐点 [170] 垫脚石)")

    # 22 子图输出接线:positive/negative→KSampler;prompt→[28] 预览;latent→[20] 画幅开关
    if [o["name"] for o in sg["outputs"]] != ["positive", "negative", "prompt", "latent",
                                              "positive_single"]:
        errs.append("子图输出应为 positive/negative/prompt/latent/positive_single(0928)")
    pv = m_nodes[PREVIEW_ID]
    if pv["type"] != "easy showAnything" or m_links[pv["inputs"][0]["link"]][1] != HOST_ID:
        errs.append(f"[{PREVIEW_ID}] 应为 easy showAnything 且接 [40] prompt 输出")

    # 23 说明 Note 必含要点(0929 并行化轮:三支路并行+单选择文案;其余段 tokens 原样)
    note = m_nodes[NOTE_ID]["widgets_values"][0]
    for token in ("生修合一", "指令=改什么", "指令即主体", "cfg 恒 1", "步数回归各支路",
                  RGBA_HEAD_EN, RGBA_TAIL_EN, RGBA_HEAD_ZH, "qwen-image-2-1-prompter",
                  "05-道劫规范提示词库.md", "MyQi21DaojieBase", "LoraLoaderModelOnly",
                  "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors",
                  "[171]", "[172]", "[176]", "[8]", "[189]",
                  # 0929 并行化轮:三支路+单选择+seed 单源+复用铁则(0929 拉齐重放:默认=直出40步)
                  SPEED_SELECT_CLASS, "三支路并行", "单选择", "默认=直出40步",
                  "拉齐重放",
                  "seed(三支路共享)", "单源", "零真重复", "零摆设值",
                  "check_lazy_status", "懒执行", "绝不吃 viggle LoRA",
                  "双参考", "黑图修复", "分线直入",
                  "shift_terminal=0.02", "降级=",
                  "依赖警示", "生态插件区", "Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8",
                  "T8QwenImage21FunAccPDD4Step", FUNACC_FILE, "无负面槽", "用户手动权威",
                  "TE-Speed 槽不在本件", "BatchImagesNode", "TextGenerate",
                  "ImageScaleToTotalPixels", "画幅随输入图", "qi21_daojie_i2i_0924.py",
                  # 0925 收窄轮要点(W1 组框/W5 负面占位+pp 定档)
                  "数学上不参与采样", "官方同构", "占位", "已定档", "加速区",
                  # 0928 黑图修复轮要点
                  "单参考正源", "崩纯黑", "唯一色=1", "positive_single"):
        if token not in note:
            errs.append(f"Note 缺要点: {token!r}")
        if token not in note:
            errs.append(f"Note 缺要点: {token!r}")
    if note.lstrip().startswith("# "):
        errs.append("Note 一级大标题开幅违规")

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


def _speed_select_mode(m_nodes: dict) -> int:
    """MyQi21SpeedSelect 当前档位(combo 字符串→档号 0/1/2;首项=默认=直出40步=0
    (0929 拉齐重放))。

    combo 闭集单源=自研件 SPEED_MODES;字符串前导数字=档号(与旧 [30] 口径一致)。"""
    mode = m_nodes[SPEED_SEL_ID]["widgets_values"][0]
    for combo, num in ((SPEED_COMBO_DIRECT, MODE_DIRECT), (SPEED_COMBO_VIGGLE, MODE_VIGGLE),
                       (SPEED_COMBO_FUNACC, MODE_FUNACC)):
        if mode == combo:
            return num
    raise SystemExit(f"选择件档位字符串未知: {mode!r}(combo 闭集=自研件 SPEED_MODES 单源,"
                     "改档位文案须与生成器同笔)")


def _switch_bool_main(m_links: dict, m_nodes: dict, node: dict) -> bool:
    """主图 ComfySwitchNode 有效布尔(0929 并行化后主图唯一开关=[20] 画幅双路):
    switch 槽有连线→PrimitiveBoolean 直取 widget;否则本件 widget。"""
    lid = node["inputs"][2].get("link")
    if lid is not None:
        src = m_nodes[m_links[lid][1]]
        if src["type"] == "PrimitiveBoolean":
            return bool(src["widgets_values"][0])
    return bool(node["widgets_values"][0])


def _dry_run_main(g: dict, mode_override: int | None = None) -> set[int]:
    """主图执行集(SaveImage[10] 回溯;懒执行=只走选中臂)。

    0929 并行化轮:MyQi21SpeedSelect=单选择点(check_lazy_status 只拉起选中档
    对应 latent 槽——档0 直出→槽3/档1 viggle→槽2/档2 Fun-Acc→槽1,未选支路
    整体不进执行图=零执行零加载);[20] 画幅双路=ComfySwitchNode 懒执行只走
    on_false;mode_override 模拟运行态切档(0/1/2,默认态=combo 首项=直出40步(0929 拉齐重放))。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    reach: set[int] = set()
    stack = [10]  # SaveImage
    while stack:
        nid = stack.pop()
        if nid in reach:
            continue
        reach.add(nid)
        node = m_nodes[nid]
        if node["type"] == SPEED_SELECT_CLASS:
            mode = mode_override if mode_override is not None else _speed_select_mode(m_nodes)
            slots = [3 - int(mode)]   # 槽序 1=funacc/2=viggle/3=direct ↔ 档号 2/1/0
        elif node["type"] == "ComfySwitchNode":
            slots = [1 if _switch_bool_main(m_links, m_nodes, node) else 0]
        else:
            slots = range(len(node.get("inputs", [])))
        for si in slots:
            lid = node["inputs"][si].get("link")
            if lid is not None:
                stack.append(m_links[lid][1])
    return reach


def preflight(old: dict) -> str:
    """守卫:现文件必须是本脚本产物形(装配子图+PE 链+LoRA 槽),否则拒写。

    0928 PE 迁子图轮起 PE 链住子图;迁移过渡期两形皆认(旧形=PE 链在主图,
    新形=PE 链在 [40] 子图)——两者皆本脚本历史产物形。"""
    types = {n["type"] for n in old.get("nodes", [])}
    sg_types = set()
    for sg in old.get("definitions", {}).get("subgraphs", []):
        sg_types |= {n["type"] for n in sg.get("nodes", [])}
    if not (("TextGenerate" in types or "TextGenerate" in sg_types)
            and ("BatchImagesNode" in types or "BatchImagesNode" in sg_types)
            and "LoraLoaderModelOnly" in types and "MyQi21DaojieBase" in sg_types):
        sys.exit("拒写:现文件非本脚本产物形(缺 装配子图/PE 链/LoRA 槽 三锚之一;"
                 "未知形状先人工核对再跑;铁律0 先验证再动手)。")
    return "已是本件形 → 重生成(应零 diff)"


def main() -> int:
    check_only = "--check" in sys.argv
    truth = load_truth()
    sg = build_subgraph(truth)
    g = build_main(truth, sg)
    errs = self_check(g, truth)
    if errs:
        for e in errs:
            print(f"FAIL(构建期): {e}", file=sys.stderr)
        return 1

    payload = json.dumps(g, ensure_ascii=False, indent=2) + "\n"
    if not check_only:
        if I2I_JSON.is_file():
            old = json.loads(I2I_JSON.read_text(encoding="utf-8"))
            shape = preflight(old)
        else:
            shape = "新件首生"
        if not I2I_JSON.is_file() or I2I_JSON.read_text(encoding="utf-8") != payload:
            I2I_JSON.parent.mkdir(parents=True, exist_ok=True)
            I2I_JSON.write_text(payload, encoding="utf-8")
            print(f"写盘: {I2I_JSON.relative_to(_REPO)}")
        else:
            print(f"在位且一致(幂等跳过): {I2I_JSON.relative_to(_REPO)}")
        print(f"形态: {shape}")

    # 写盘后复读自查(磁盘态为准):json.loads 往返 + 全谓词
    if I2I_JSON.is_file():
        disk = json.loads(I2I_JSON.read_text(encoding="utf-8"))
        disk_errs = self_check(disk, truth)
        if disk_errs:
            for e in disk_errs:
                print(f"FAIL(磁盘态): {e}", file=sys.stderr)
            return 1
    else:
        print("FAIL: i2i 件未在位", file=sys.stderr)
        return 1

    m_nodes = len(disk["nodes"])
    m_links = len(disk["links"])
    sg_nodes = len(disk["definitions"]["subgraphs"][0]["nodes"])
    sg_links = len(disk["definitions"]["subgraphs"][0]["links"])
    print(f"PASS: 主图 {m_nodes} 节点/{m_links} 链 + 装配子图 {sg_nodes} 节点/{sg_links} 链;"
          f"机制=生修合一(图输入即指令编辑,零 denoise 重绘);0928 PE 迁子图轮="
          f"PE-I2I 七件链收进 [40] 子图(指令路径全程子图内,主图零 PE 件;[22] 唯一手写位"
          f"直喂宿主指令槽;[12] PE 专属TE经 pe_clip 槽一进线;宿主面板「PE开关」默认 true"
          f"=0926 裁定1)/双图预缩 1.5+1.0MP/BatchImages 双通道(子图内吃边界图)/latent 双路;"
          f"九型装配移植(MyQi21DaojieBase combo 经宿主面板外露默认人物,锁层A 恒挂,"
          f"指令占①层+BASE+锁层A 换行分层,RGBA 官方公式默认旁路);"
          f"0929 并行化=加速区三支路并行(直出[{KS_DIR_ID}]40步/"
          f"viggle [{LORA_ID}]→[{KS_VIG_ID}]359步/Fun-Acc [{T8_ID}]4步内置,"
          f"选择逻辑件 13→1)+单选择件 {SPEED_SELECT_CLASS}[{SPEED_SEL_ID}]"
          f"(combo 首项=默认=直出40步=0929 拉齐重放裁定;三 latent 槽全 lazy,"
          f"check_lazy_status 未选支路零执行零加载)+seed 单源[{SEED_ID}]默认0 fixed "
          f"扇出三采样器(T8 seed 输入化)+正源分线直入(支路0 宿主positive 双参考/"
          f"支路1·2 宿主positive_single 单参考,0928 黑图修复语义原样)+"
          f"T8.model=Cache 直连绝不吃 LoRA;零真重复谓词在册(两 KSampler=支路本体);"
          f"TE-Speed 槽不在场;步数回归支路 widget=面板值即生效值/cfg1/denoise1/fixed;"
          f"干跑直写选配臂装配逐字=指令+人物BASE+锁层A;"
          f"双向/横向(恒向右+顶通道 Reroute)/子图六行排版/零重叠/group int+预算"
          f"(主4·子3,W1 加速区组框;子图各框单一阶段行)/W1 加速区组框罩三支路+seed+选择件六件/"
          f"W5 负面 cfg=1 官方同构占位+pp=1.5 定档+steps 零摆设值/"
          f"W6 零负区(全节点 pos≥80,0926 收紧=发现项3 互锁)+输出口最右(输出槽钉最右列)/"
          f"零线遮节点(0926 铁律:只管位置,线不遮节点;主图+子图贝塞尔 41 点精判=0,"
          f"子图 [143]→[144] 垫 Reroute[{SG_RR_ID}] 拐点走框间净空)/"
          f"子图 linkIds 逐项登记/懒执行旁路/零孤儿全绿")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
