#!/usr/bin/env python3
"""qi21-edit.json R16 核心化升级(09-23,幂等全量再生成)。

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
# R26.4 LoRA 加速槽(09-24 统一接线;id 同构 i2i/t2i 生成器 LORA_PB/LORA/LORA_SW)
LORA_FILE = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"
LORA_PB_ID, LORA_ID, LORA_SW_ID = 30, 31, 32
RR_V_A_ID, RR_V_B_ID = 28, 29   # VAE 顶通道(R26.4 随迁:长横穿上顶缘,样板=K2 件)
# 满血接线轮(09-24):steps 联动 INT 开关三件(同受 [30] 布尔源驱动;样板=t2i 画幅联动
# [157][158] ComfySwitchNode typ=INT);关态 steps 25→40(任务令:三件同构关=40 完整档)
STEPS_SW_ID, STEPS_C40_ID, STEPS_C6_ID = 33, 34, 35
STEPS_OFF, STEPS_ON = 40, 6   # 关=40 官方完整档/开=6(v0.2 卡荐档,一拨全配)
# 0927 三档切换轮(用户裁定原话「默认使用 Fun-Acc(阿里PDD)」):二态开关升级三档
#   0=直出 40 步官方完整档 / 1=viggle 6 步 / 2=Fun-Acc PDD 4 步(默认档)
# 结构同构 t2i/i2i:[30] 升级 PrimitiveInt 档位(默认 2)→两枚 easy compare(easy-use
# 家族;object_info 实证 optional a/b+comparison COMBO,输出 BOOLEAN)产出两布尔:
# viggle_bool=(档==1) 驱 [32] MODEL 开关+[33] steps 开关;funacc_bool=(档==2) 驱
# [54] latent 路由开关(懒执行:档=2 时 KSampler/viggle LoRA/steps 三件整体不在
# 执行图)。[55] T8 采样器 T8QwenImage21FunAccPDD4Step(输入 model/positive/
# latent_image/model_file/seed,无负面槽,steps/sigmas/cfg 全内置):model 吃 [32]
# 输出(档=2 时 false 臂=base);positive 与 [8] 同源=[6].positive;latent_image
# 与 [8] 同源=[20] 画幅开关输出;seed=0 固定可复现。
MODE_DEFAULT = 2                                       # [30] 默认档=2(Fun-Acc,0927 用户裁定)
MODE_DIRECT, MODE_VIGGLE, MODE_FUNACC = 0, 1, 2        # 档位语义锚
CMP_VIG_ID, CMP_FUN_ID = 50, 51                        # easy compare ==(1)/==(2) 布尔源
CMP_C1_ID, CMP_C2_ID = 38, 39                          # 比较常量 1/2
LAT_SW_ID, T8_ID = 54, 55                              # latent 路由开关/T8 采样器
RR_DIR_ID, RR_CMP_ID, RR_POS_ID = 56, 57, 58            # 直连臂/布尔/positive 垫脚石
FUNACC_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"   # 已装机(models/loras/)
T8_CLASS = "T8QwenImage21FunAccPDD4Step"

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

- **cfg 恒 1**(官方路径):负面提示词在 cfg=1 下**数学上不参与采样**——负面线保留接线为**官方同构占位**(不生效);要用负向须抬 cfg,非本产线口径;档2 Fun-Acc 无负面槽。步数官方 40-50,本流 40(档0=40 官方完整档;档1=[50] 联动自动 6;档2=Fun-Acc 4 步内置于 [55] T8;[8] 面板 steps 显 40=摆设值不生效)。
- **resolution 是总像素预算非宽高**(保比例):官方默认 1024、上限 2048;本流取 **0=不重采样**(仅取整到 32 的倍数),输出尺寸跟随 image_1(预缩后)。
- **参考图语法**:提示词里用 `<image1>`..`<image10>` 点名;image_1=编辑目标画布,其余是参考;模型契约上限 10 图(节点槽 16)。
- **输入图预缩(0923 吸收,夸克实践)**:加载后先 ImageScaleToTotalPixels(lanczos·32 倍数)——画布 1.5MP、参考图 1.0MP;控显存+稳输入尺寸(速度与输入图尺寸/数量强相关)。
- **QwenImage21Cache(auto/default)**:KV 缓存设备/精度挂 UNETLoader 后,内存吃紧可调(cpu/int8)。

### 输出画幅双路(默认跟随输入图)

- **false(默认)**:latent 取 TextEncode.latent,跟随 image_1(预缩后)比例。
- **true**:EmptyLatentImage 自定义宽高(默认 1024×1024,直接改宽高 widget);自定义尺寸须贴近 image_1 比例,否则编辑漂移。

### RGBA 透明图句式(存 PNG 才保 alpha)

This is an RGBA format image with transparency. [your description]. The image has an alpha channel and a transparent background.

### 加速区三档(0927 三档轮;[30] 档位默认 2=Fun-Acc)

- **[30] 加速档位=0/1/2 三选一(单一控件,默认 2=Fun-Acc PDD 4步)**:0=直出 40 步(官方完整档)/1=viggle 6 步/2=Fun-Acc 4 步。默认档只是初始值,随时可切任何档;加速启停语义=用户手动权威。
- 档位自动拆两路(无需手动调):[30]→[50] 比较(==1)→viggle 布尔,同时驱动 [32] MODEL 开关(false=Cache 直连/true=[31] LoraLoaderModelOnly)与 [33] steps 联动开关(false→[34] 常量 40/true→[35] 常量 6);[30]→[51] 比较(==2)→Fun-Acc 布尔,驱动 [54] latent 路由开关(false=[8] KSampler 输出/true=[55] T8 输出→[9] 解码)。
- **档0=直出**:MODEL 直连,[8] 40 步官方完整档主线,LoRA 不加载。
- **档1=viggle**:[31] LoRA 挂链(name 预填 **Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors**,viggle 蒸馏件已装机),strength 0.8(0925 探针最优:flatMAD 2.52→1.75)+steps 自动 6(v0.2.1 系卡荐档,cfg 保持 1)。
模型卡注 shift_terminal=0.02 伤末步,画质异常先查调度。
- **档2=Fun-Acc(默认)**:[55] T8QwenImage21FunAccPDD4Step 接管采样——4步/sigmas 五值/euler/cfg1 全内置(勿外接采样器),无负面槽(负面词在档2 不参与);model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors(已装机 models/loras/);model 走 [32] false 臂=base 模型(绝不吃 viggle LoRA);positive 与 [8] 同源;latent_image 与 [8] 同源;seed 默认 0 固定可复现。实测速度(0926 三轮实弹):1024² 28.8s/2048² 130.7s(viggle 34.1/183.1,直出 214.7/1173.4)。懒执行:档2 时 [8] KSampler 与 viggle LoRA 整体不在执行图(ComfySwitchNode 懒路由,零空转零加载)。TE 硬校验 4096 维,现产线 TE=qwen3vl_8b_bf16_heretic 已实测通过。
- **依赖警示:档2 需引擎装 Fun-Acc 插件(T8 节点,见设置页生态插件区 Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8)**;未装的机器选档2 节点红/执行失败——降级=切回 0/1 档。
- [8] 面板 steps 显 40=摆设值不生效(档0/1 由 [33] 联动供给;档2 steps 内置于 [55] T8)。
- TE-Speed 槽不加(3c 试装已死归档:插件未装=画布红节点,D4 终审永不装)。

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


def pint(nid, value, pos, out_link):
    """PrimitiveInt 常量(steps 联动臂;序列化=官方本地 I2V-480P 模板实取样板;
    核心节点零自定义 title 铁律)。"""
    return {
        "id": nid, "type": "PrimitiveInt", "pos": pos, "size": [270, 90],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "value", "type": "INT", "widget": {"name": "value"}, "link": None}],
        "outputs": [{"name": "INT", "type": "INT", "links": [out_link]}],
        "properties": {"cnr_id": "comfy-core", "Node name for S&R": "PrimitiveInt"},
        "widgets_values": [value, "fixed"],
        "widgets_values_named": {"value": value, "fixed": "fixed"},
    }


def sswitch(nid, pos, false_link, true_link, switch_link, out_link):
    """steps 联动 INT 开关(样板=t2i 画幅联动 [157][158];零自定义 title 铁律)。"""
    return {
        "id": nid, "type": "ComfySwitchNode", "pos": pos, "size": [300, 110],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "on_false", "shape": 7, "type": "INT", "link": false_link},
            {"name": "on_true", "shape": 7, "type": "INT", "link": true_link},
            {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": switch_link},
        ],
        "outputs": [{"name": "output", "type": "INT", "links": [out_link]}],
        "properties": {"Node name for S&R": "ComfySwitchNode"},
        "widgets_values": [False],
    }


def build_nodes():
    return [
        # ── 行1 加载器(上)────────────────────────────────────────
        # 0926 线不遮节点轮:[1] 抬高走顶带(其 [1]→[7] 长线过 [2][3][6] 顶侧净空),
        # [3] 右移让 [2]→[6] 长线从其盒底下方通过(lane y≈675+ > 盒底 662)。
        node(1, "UNETLoader", [1220, 440], [340, 84],
             [inp("unet_name", "COMBO", widget=True),
              inp("weight_dtype", "COMBO", widget=True)],
             [out("MODEL", "MODEL", [5])],
             [UNET_FILE, "default"], order=0),
        node(2, "CLIPLoader", [1760, 600], [360, 130],
             [inp("clip_name", "COMBO", widget=True),
              inp("type", "COMBO", widget=True),
              inp("device", "COMBO", shape=7, widget=True)],
             [out("CLIP", "CLIP", [3])],
             [CLIP_FILE, "qwen_image", "default"], order=1),
        node(3, "VAELoader", [2700, 600], [340, 60],
             [inp("vae_name", "COMBO", widget=True)],
             [out("VAE", "VAE", [4, 28])],
             [VAE_FILE], order=2),
        # ── 行2 主链:双图→预缩→编码→缓存→采样→解码→保存 ──────────
        node(4, "LoadImage", [1220, 960], [340, 420],
             [inp("image", "COMBO", widget=True),
              inp("upload", "IMAGEUPLOAD", widget=True)],
             [out("IMAGE", "IMAGE", [1]), out("MASK", "MASK", None)],
             [IMG1, "image"], order=3),
        node(16, "ImageScaleToTotalPixels", [1920, 960], [330, 130],
             [inp("image", "IMAGE", link=1),
              inp("upscale_method", "COMBO", widget=True),
              inp("megapixels", "FLOAT", widget=True),
              inp("resolution_steps", "INT", widget=True)],
             [out("IMAGE", "IMAGE", [9, 11])],
             ["lanczos", 1.5, 32], order=5),
        # 0926 线不遮节点轮:双图链改双子行——[5]→[17] 整链下沉 y=1560 行,
        # 让 [16] 的两条长线([16]→[6] 平飞 / [16]→[25] 斜穿)走原行 B 净空。
        node(5, "LoadImage", [1220, 1560], [340, 420],
             [inp("image", "COMBO", widget=True),
              inp("upload", "IMAGEUPLOAD", widget=True)],
             [out("IMAGE", "IMAGE", [2]), out("MASK", "MASK", None)],
             [IMG2, "image"], order=4),
        node(17, "ImageScaleToTotalPixels", [1920, 1560], [330, 130],
             [inp("image", "IMAGE", link=2),
              inp("upscale_method", "COMBO", widget=True),
              inp("megapixels", "FLOAT", widget=True),
              inp("resolution_steps", "INT", widget=True)],
             [out("IMAGE", "IMAGE", [10, 12])],
             ["lanczos", 1.0, 32], order=6),
        node(6, "TextEncodeQwenImage21", [5480, 960], [760, 480],
             [inp("clip", "CLIP", link=3),
              inp("images.image_1", "IMAGE", shape=7, link=9),
              inp("vae", "VAE", shape=7, link=4),
              inp("images.image_2", "IMAGE", shape=7, link=10),
              inp("prompt", "STRING", widget=True, link=22)],
             [out("positive", "CONDITIONING", [7, 54]),
              out("negative", "CONDITIONING", [8]),
              out("latent", "LATENT", [23])],
             ["", "", 0], order=7),
        # 0926 线不遮节点轮:[7] 上抬至 y=740 带——[6]→[8] 双 condition 线从其
        # 盒底下方通过,[1]→[7] 长线全程高走不再扫 [6] 盒顶。
        node(7, "QwenImage21Cache", [6440, 740], [340, 120],
             [inp("model", "MODEL", link=5),
              inp("device", "COMBO", widget=True),
              inp("dtype", "COMBO", widget=True)],
             [out("MODEL", "MODEL", [30, 40])],
             ["auto", "default"], order=20),
        node(8, "KSampler", [8850, 960], [330, 260],
             [inp("model", "MODEL", link=33),
              inp("positive", "CONDITIONING", link=7),
              inp("negative", "CONDITIONING", link=8),
              inp("latent_image", "LATENT", link=26),
              # 满血接线轮:steps widget 转输入(照 [150].base 先例 widget 标记保留;
              # 档0=40 官方完整档/档1=[33] 联动自动 6)
              inp("steps", "INT", widget=True, link=39)],
             [out("LATENT", "LATENT", [50])],
             [0, "randomize", 40, 1, "euler", "simple", 1], order=21),
        node(9, "VAEDecode", [9900, 960], [240, 50],
             [inp("samples", "LATENT", link=52), inp("vae", "VAE", link=35)],
             [out("IMAGE", "IMAGE", [29])], order=22),
        node(10, "SaveImage", [10350, 960], [380, 330],
             [inp("images", "IMAGE", link=29)], [],
             ["MYStudio"], order=23),
        # ── R26.4 LoRA 加速槽三件(Cache 上带;09-24 统一接线,与 i2i/t2i 同构)──
        # 0926 线不遮节点轮(加速区六件错位重排):[31] 上抬让 [7]→[32] 直连臂
        # 从其盒底下方走;[30]/[34]/[35] 随之让位,保 est 间距(横≥200/纵≥80)
        # 与 [30]→[33]、[34]→[33] 两条竖落线走件间净空。
        node(LORA_PB_ID, "PrimitiveInt", [7040, 240], [280, 90],
             [inp("value", "INT", widget=True)],
             [out("INT", "INT", [42, 43])],
             [MODE_DEFAULT, "fixed"], order=25),
        node(LORA_ID, "LoraLoaderModelOnly", [8080, 1140], [340, 130],
             [inp("model", "MODEL", link=30),
              inp("lora_name", "COMBO", widget=True),
              inp("strength_model", "FLOAT", widget=True)],
             [out("MODEL", "MODEL", [31])],
             [LORA_FILE, 0.8], order=26),
        node(LORA_SW_ID, "ComfySwitchNode", [8480, 200], [300, 110],
             [inp("on_false", "MODEL", shape=7, link=41),
              inp("on_true", "MODEL", shape=7, link=31),
              inp("switch", "BOOLEAN", widget=True, link=46)],
             [out("output", "MODEL", [33, 53])],
             [False], order=27),
        # ── 0927 三档轮新增:比较件×2+常量×2+latent 路由+T8 采样器+垫脚石×2 ──
        node(CMP_VIG_ID, "easy compare", [7540, 260], [260, 110],
             [inp("a", "*", widget=True, link=42),
              inp("b", "*", widget=True, link=44),
              inp("comparison", "COMBO", widget=True)],
             [out("boolean", "BOOLEAN", [46, 47])],
             ["", "", "a == b"], order=28),
        node(CMP_FUN_ID, "easy compare", [7960, 2000], [260, 110],
             [inp("a", "*", widget=True, link=43),
              inp("b", "*", widget=True, link=45),
              inp("comparison", "COMBO", widget=True)],
             [out("boolean", "BOOLEAN", [48])],
             ["", "", "a == b"], order=29),
        pint(CMP_C1_ID, MODE_VIGGLE, [7040, 1540], 44),
        pint(CMP_C2_ID, MODE_FUNACC, [7450, 1800], 45),
        node(LAT_SW_ID, "ComfySwitchNode", [9400, 960], [300, 110],
             [inp("on_false", "LATENT", shape=7, link=50),
              inp("on_true", "LATENT", shape=7, link=51),
              inp("switch", "BOOLEAN", widget=True, link=49)],
             [out("output", "LATENT", [52])],
             [False], order=30),
        node(T8_ID, T8_CLASS, [8850, 1450], [420, 250],
             [inp("model", "MODEL", link=53),
              inp("positive", "CONDITIONING", link=59),
              inp("latent_image", "LATENT", link=55),
              inp("model_file", "COMBO", widget=True),
              inp("seed", "INT", widget=True)],
             [out("LATENT", "LATENT", [51])],
             [FUNACC_FILE, 0], order=31),
        rr(RR_DIR_ID, [8160, 760], 40, 41, "MODEL"),
        rr(RR_CMP_ID, [9250, 1900], 48, 49, "BOOLEAN"),
        rr(RR_POS_ID, [6600, 1400], 54, 59, "CONDITIONING"),
        # ── 行3 输出画幅双路 ──────────────────────────────────────
        node(19, "PrimitiveBoolean", [5440, 2080], [280, 90],
             [inp("value", "BOOLEAN", widget=True)],
             [out("BOOLEAN", "BOOLEAN", [25])],
             [False], order=17),
        # 0926 线不遮节点轮:[18] 下沉让 [19]→[20] 布尔横线从其盒顶上方通过。
        node(18, "EmptyLatentImage", [5940, 2260], [300, 120],
             [inp("width", "INT", widget=True),
              inp("height", "INT", widget=True),
              inp("batch_size", "INT", widget=True)],
             [out("LATENT", "LATENT", [24])],
             [1024, 1024, 1], order=18),
        node(20, "ComfySwitchNode", [7380, 2080], [280, 100],
             [inp("on_false", "LATENT", shape=7, link=23),
              inp("on_true", "LATENT", shape=7, link=24),
              inp("switch", "BOOLEAN", widget=True, link=25)],
             [out("output", "LATENT", [26, 55])],
             [False], order=19),
        # ── 行4 PE 链前半:PE loader + chatml 三段 + 拼装 ───────────
        # 0926 线不遮节点轮(chatml 三段纵错位):三段同横排时任何一段的
        # 送线必横扫邻段盒(槽 y 全落在 2400-2580 带内,横排不可两全)——
        # 改纵瀑布:[21]a 段上抬/[23]c 段下沉/[22]b 段(双扇出主)居中,
        # [24] 拼装落位 y=2540,[12]→[26] 顶带横线(y=2785)从 [23] 盒顶上方过。
        node(12, "CLIPLoader", [1220, 2760], [360, 130],
             [inp("clip_name", "COMBO", widget=True),
              inp("type", "COMBO", widget=True),
              inp("device", "COMBO", widget=True)],
             [out("CLIP", "CLIP", [13])],
             [PE_CLIP_FILE, "qwen_image", "default"], order=8),
        node(21, "PrimitiveStringMultiline", [2320, 2200], [300, 180],
             [inp("value", "STRING", widget=True)],
             [out("STRING", "STRING", [14])],
             [A_SEG], order=9),
        node(22, "PrimitiveStringMultiline", [1760, 2400], [340, 180],
             [inp("value", "STRING", widget=True)],
             [out("STRING", "STRING", [15, 21])],
             [B_SEG], order=10),
        node(23, "PrimitiveStringMultiline", [2820, 2900], [260, 180],
             [inp("value", "STRING", widget=True)],
             [out("STRING", "STRING", [16])],
             [C_SEG], order=11),
        node(24, "StringFormat", [3320, 2540], [300, 130],
             [inp("values.a", "*", shape=7, link=14),
              inp("values.b", "*", shape=7, link=15),
              inp("values.c", "*", shape=7, link=16),
              inp("f_string", "STRING", widget=True)],
             [out("STRING", "STRING", [17])],
             ["{a}{b}{c}"], order=12),
        # ── 行5 PE 链后半:合批→生成→正则→开关 ────────────────────
        node(25, "BatchImagesNode", [3370, 1500], [260, 170],
             [inp("images.image0", "IMAGE", link=11),
              inp("images.image1", "IMAGE", shape=7, link=12)],
             [out("IMAGE", "IMAGE", [18])], order=13),
        node(26, "TextGenerate", [3850, 2760], [400, 450],
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
        node(27, "RegexExtract", [4450, 2760], [330, 260],
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
        node(15, "ComfySwitchNode", [4980, 2460], [300, 110],
             [inp("on_false", "STRING", shape=7, link=21),
              inp("on_true", "STRING", shape=7, link=20),
              inp("switch", "BOOLEAN", widget=True)],
             [out("output", "STRING", [22])],
             [True], order=16),
        # ── 说明卡(左缘独立,零重叠)──────────────────────────────
        node(11, "MarkdownNote", [80, 960], [940, 1100], [], [],
             [NOTE], order=24),
        # ── VAE 顶通道(R26.4 随迁:VAE→VAEDecode 长横穿上顶缘,零新增交叉;
        #    满血接线轮 RR_V_B 右移 3400 让 [33]→[8].steps 落位走廊;
        #    0926 线不遮节点轮 RR_V_A 随 [3] 右移至 2960 保恒向右)──
        rr(RR_V_A_ID, [2960, 80], 28, 34),
        rr(RR_V_B_ID, [9600, 80], 34, 35),
        # ── 满血接线轮(09-24):steps 联动 INT 开关三件(样板=t2i 画幅联动 [157][158];
        #    同受 [30] 布尔源驱动:false→[34] 常量 40/true→[35] 常量 6→[8].steps 转输入)──
        sswitch(STEPS_SW_ID, [8500, 620], 36, 37, 47, 39),
        pint(STEPS_C40_ID, STEPS_OFF, [7040, 660], 36),
        pint(STEPS_C6_ID, STEPS_ON, [7040, 1290], 37),
    ]


LINKS = [
    [1, 4, 0, 16, 0, "IMAGE"],      # [4] 画布 → 预缩A
    [2, 5, 0, 17, 0, "IMAGE"],      # [5] 参考 → 预缩B
    [3, 2, 0, 6, 0, "CLIP"],        # 主 CLIP → 编码.clip
    [4, 3, 0, 6, 2, "VAE"],         # VAE → 编码.vae
    [5, 1, 0, 7, 0, "MODEL"],       # UNET → Cache(②)
    [40, 7, 0, RR_DIR_ID, 0, "MODEL"],   # Cache → 直连臂垫脚石(0927 三档轮)
    [41, RR_DIR_ID, 0, 32, 0, "MODEL"],  # 垫脚石 → 加速槽开关.on_false(直连臂)
    [30, 7, 0, 31, 0, "MODEL"],     # Cache → LoraLoader.model(加速槽 on_true 臂)
    [31, 31, 0, 32, 1, "MODEL"],    # LoraLoader → 开关.on_true
    [46, CMP_VIG_ID, 0, 32, 2, "BOOLEAN"],  # 比较==1 → 开关.switch(0927)
    [33, 32, 0, 8, 0, "MODEL"],     # 开关 → KSampler.model(二选一)
    [53, 32, 0, T8_ID, 0, "MODEL"],      # [32] 输出(base 总线) → T8.model(0927)
    [7, 6, 0, 8, 1, "CONDITIONING"],
    [8, 6, 1, 8, 2, "CONDITIONING"],
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
    [20, 27, 0, 15, 1, "STRING"],   # rewritten_prompt → 开关.on_true
    [21, 22, 0, 15, 0, "STRING"],   # 原始用户词 → 开关.on_false
    [22, 15, 0, 6, 4, "STRING"],    # 开关 → 编码.prompt
    [23, 6, 2, 20, 0, "LATENT"],    # 编码.latent → 画幅开关.on_false(④)
    [24, 18, 0, 20, 1, "LATENT"],   # 空潜 → 画幅开关.on_true
    [25, 19, 0, 20, 2, "BOOLEAN"],  # 布尔 → 画幅开关.switch
    [26, 20, 0, 8, 3, "LATENT"],    # 画幅开关 → KSampler.latent_image
    [50, 8, 0, LAT_SW_ID, 0, "LATENT"],   # [8] 输出 → [54].on_false(档0/1 路,0927)
    [51, T8_ID, 0, LAT_SW_ID, 1, "LATENT"],   # T8 输出 → [54].on_true(档2 路)
    [52, LAT_SW_ID, 0, 9, 0, "LATENT"],   # [54] 路由输出 → [9].samples(汇流)
    [28, 3, 0, 28, 0, "VAE"],       # VAE → 顶通道(升,R26.4)
    [34, 28, 0, 29, 0, "VAE"],      # 顶横 y=-640
    [35, 29, 0, 9, 1, "VAE"],       # → VAEDecode
    [29, 9, 0, 10, 0, "IMAGE"],
    [36, 34, 0, 33, 0, "INT"],      # 常量40 → steps开关.on_false(档0=原路 40)
    [37, 35, 0, 33, 1, "INT"],      # 常量6 → steps开关.on_true(档1=卡荐档 6)
    [47, CMP_VIG_ID, 0, 33, 2, "BOOLEAN"],  # 比较==1 → steps开关.switch(0927)
    [39, 33, 0, 8, 4, "INT"],       # steps开关 → KSampler.steps(自动 40/6)
    # 0927 三档轮:档位 [30] 拆两布尔 + T8 同源供词/供潜
    [42, LORA_PB_ID, 0, CMP_VIG_ID, 0, "INT"],   # 档位 → 比较(==1).a
    [43, LORA_PB_ID, 0, CMP_FUN_ID, 0, "INT"],   # 档位 → 比较(==2).a
    [44, CMP_C1_ID, 0, CMP_VIG_ID, 1, "INT"],    # 常量1 → 比较(==1).b
    [45, CMP_C2_ID, 0, CMP_FUN_ID, 1, "INT"],    # 常量2 → 比较(==2).b
    [48, CMP_FUN_ID, 0, RR_CMP_ID, 0, "BOOLEAN"],  # 比较==2 → 布尔垫脚石
    [49, RR_CMP_ID, 0, LAT_SW_ID, 2, "BOOLEAN"],   # 垫脚石 → [54] latent 路由.switch
    [54, 6, 0, RR_POS_ID, 0, "CONDITIONING"],   # [6].positive → 垫脚石(避 [31] 段,0927)
    [59, RR_POS_ID, 0, T8_ID, 1, "CONDITIONING"],  # 垫脚石 → T8.positive(与[8]同源)
    [55, 20, 0, T8_ID, 2, "LATENT"],       # [20] → T8.latent_image(与[8]同源)
]

GROUPS = [
    # 0926 线不遮节点轮:三组框边界随节点错位重排同步改(G1 罩三加载器新梯形
    # 占位/G2 底缘下探罩双图子行/G3 罩 PE 纵瀑布与上抬的 [15]/G4 罩加速区六件新占位)
    {"id": 1, "title": "Qwen-Image-2.1 加载器(bf16 三件套)",
     "bounding": [1180, 400, 1820, 390], "color": "#3f789e", "flags": {}},
    {"id": 2, "title": "换装编辑主链(双参考图预缩→编码→缓存→LoRA加速槽+steps联动开关→采样→解码→保存;下排=输出画幅双路)",
     "bounding": [1580, 460, 5400, 1580], "color": "#3f789e", "flags": {}},
    {"id": 3, "title": "PE-I2I 改写组(默认 PE 开路·核心 TextGenerate·看全部输入图)",
     "bounding": [1580, 2140, 3760, 1140], "color": "#8864a8", "flags": {}},
    # 0925 W1 加速区组框(0927 三档轮十件=档位/比较×2/常量1·2·40·6/MODEL开关/
    # LoRA/steps开关;[54]/[55] 留主链带=数据流所在)
    {"id": 4, "title": "加速区·档位[30](0=直出40步 / 1=viggle·6步 / 2=Fun-Acc·4步,默认2;拆两路:==1驱MODEL+steps开关,==2驱[54]latent路由)",
     "bounding": [7000, 160, 1950, 2100], "color": "#4d9e6a", "flags": {}},
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

    # 5 计数器真值 ≥ 实存最大(0923 round7 红根因)
    if wf.get("last_node_id", 0) < max(nodes):
        errs.append("last_node_id 陈旧")
    if wf.get("last_link_id", 0) < max(links):
        errs.append("last_link_id 陈旧")

    # 6 groups:int id 互异;≤3;PE 组名锚;组内节点全含
    ids = [g.get("id") for g in wf["groups"]]
    if len(ids) != len(set(ids)) or not all(isinstance(i, int) for i in ids):
        errs.append("group id 非互异 int")
    if len(wf["groups"]) > 4:
        errs.append(f"group 超 4(W1 加速区组框;{len(wf['groups'])})")
    if not any("PE-I2I 改写组" in g.get("title", "") and "默认 PE 开路" in g.get("title", "")
               for g in wf["groups"]):
        errs.append("缺 PE-I2I 改写组(默认 PE 开路)分组")
    # 0925 W1 加速区组框(0927 三档轮十件):[30][50][51][38][39][31][32][33][34][35]
    accel_ids = [LORA_PB_ID, CMP_VIG_ID, CMP_FUN_ID, CMP_C1_ID, CMP_C2_ID,
                 LORA_ID, LORA_SW_ID, STEPS_SW_ID, STEPS_C40_ID, STEPS_C6_ID]
    accel_grp = next((g for g in wf["groups"] if "加速区·档位" in g.get("title", "")), None)
    if accel_grp is None:
        errs.append("W1 缺「加速区」组框(主画布原生组框收纳六件)")
    else:
        gx0, gy0 = accel_grp["bounding"][0], accel_grp["bounding"][1]
        gx1, gy1 = gx0 + accel_grp["bounding"][2], gy0 + accel_grp["bounding"][3]
        for nid in accel_ids:
            n = nodes[nid]
            if not (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                    and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1):
                errs.append(f"W1 加速区组框未罩住 [{nid}](方案C 组框收纳)")

    # 7 节点标题铁律:核心/第三方零自定义 title(本件无自研节点)
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

    # 10 KSampler 契约 + Cache 在场(②)
    ks = by_type("KSampler")
    if len(ks) != 1:
        errs.append("KSampler 应恰 1")
    else:
        wv = ks[0]["widgets_values"]
        if not (wv[3] == 1 and wv[2] == 40 and wv[4] == "euler"
                and wv[5] == "simple" and wv[6] == 1.0):
            errs.append(f"KSampler 参数漂移(满血接线轮:关态 steps=40 官方完整档/cfg1/euler/simple/denoise1): {wv}")
        if wv[1] != "randomize":
            errs.append("edit seed 应 randomize")
    cache = by_type("QwenImage21Cache")
    if len(cache) != 1 or cache[0]["widgets_values"] != ["auto", "default"]:
        errs.append("QwenImage21Cache(auto/default) 应恰 1")
    else:
        up = links[cache[0]["inputs"][0]["link"]][1]
        dn = links[cache[0]["outputs"][0]["links"][0]]
        if nodes[up]["type"] != "UNETLoader" or \
                nodes[dn[3]]["type"] not in ("KSampler", "ComfySwitchNode",
                                             "LoraLoaderModelOnly"):
            errs.append("Cache 未挂 UNETLoader→KSampler 之间(可穿加速槽开关)")
        if links[nodes[8]["inputs"][0]["link"]][1] != LORA_SW_ID:
            errs.append("KSampler.model 上游应 MODEL 开关(加速槽二选一,R26.4)")

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
    if len(te) != 1:
        errs.append("TextEncodeQwenImage21 应恰 1")
    else:
        imgs = [i for i in te[0]["inputs"]
                if i["name"].startswith("images.") and i.get("link")]
        if len(imgs) < 2:
            errs.append("编码器应接 ≥2 选定图")
        if {links[i["link"]][1] for i in imgs} != {16, 17}:
            errs.append("编码器选定图上游应为两预缩图")
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
    el = by_type("EmptyLatentImage")
    if len(el) != 1 or el[0]["widgets_values"] != [1024, 1024, 1]:
        errs.append("EmptyLatentImage(1024×1024×1)应恰 1")

    # 13b R26.4 LoRA 加速槽(09-24 统一接线,与 i2i/t2i 同构;D1 硬性 AC=关闭也正常生成)
    loras = by_type("LoraLoaderModelOnly")
    if len(loras) != 1 or loras[0]["id"] != LORA_ID:
        errs.append(f"LoraLoaderModelOnly[{LORA_ID}] 应恰 1 个(加速槽)")
    else:
        if loras[0]["widgets_values"] != [LORA_FILE, 0.8]:
            errs.append(f"LoRA 槽 name/strength 漂移: {loras[0]['widgets_values']}")
        if links[loras[0]["inputs"][0]["link"]][1] != 7:
            errs.append("LoRA 槽 model 上游应 QwenImage21Cache[7]")
    lsw = nodes[LORA_SW_ID]
    if lsw["type"] != "ComfySwitchNode" or lsw["outputs"][0]["type"] != "MODEL":
        errs.append(f"[{LORA_SW_ID}] 应为 MODEL 泛型开关")
    if lsw["widgets_values"][0] is not False:
        errs.append(f"[{LORA_SW_ID}] LoRA 开关默认应 false(档位由 [{CMP_VIG_ID}] 布尔源驱动)")
    if _trace_reroute(links, nodes, lsw["inputs"][0]["link"]) != 7:
        errs.append("MODEL 开关 on_false 上游应 Cache[7](直连臂,可穿垫脚石)")
    if links[lsw["inputs"][1]["link"]][1] != LORA_ID:
        errs.append("MODEL 开关 on_true 上游应 LoraLoaderModelOnly")
    if links[lsw["inputs"][2]["link"]][1] != CMP_VIG_ID:
        errs.append("MODEL 开关 switch 上游应 easy compare(档位==1 布尔)")
    # 三档源:[30] PrimitiveInt 默认 2(0927 用户裁定「默认使用 Fun-Acc(阿里PDD)」)
    pb_node = nodes[LORA_PB_ID]
    if pb_node["type"] != "PrimitiveInt" or pb_node["widgets_values"][0] != MODE_DEFAULT:
        errs.append(f"[{LORA_PB_ID}] 应为 PrimitiveInt 档位且默认={MODE_DEFAULT}(Fun-Acc,0927 裁定),"
                    f"得 {pb_node.get('widgets_values')}")
    if sorted(pb_node["outputs"][0]["links"] or []) != sorted([42, 43]):
        errs.append(f"[{LORA_PB_ID}] 档位源应扇出恰两线(→[{CMP_VIG_ID}]/[{CMP_FUN_ID}])")
    for cid, want in ((CMP_VIG_ID, MODE_VIGGLE), (CMP_FUN_ID, MODE_FUNACC)):
        c = nodes[cid]
        if c["type"] != "easy compare" or c["widgets_values"][2] != "a == b":
            errs.append(f"[{cid}] 应为 easy compare(a == b)产出档位布尔")
        if _trace_reroute(links, nodes, c["inputs"][0]["link"]) != LORA_PB_ID:
            errs.append(f"[{cid}].a 上游应档位源 [{LORA_PB_ID}]")
        b_src = nodes[links[c["inputs"][1]["link"]][1]]
        if b_src["type"] != "PrimitiveInt" or b_src["widgets_values"][0] != want:
            errs.append(f"[{cid}].b 上游应常量 {want}(比较判据)")
    # latent 路由 + T8 采样器(0927 三档轮档2 支路)
    latsw = nodes[LAT_SW_ID]
    if latsw["type"] != "ComfySwitchNode" or latsw["outputs"][0]["type"] != "LATENT":
        errs.append(f"[{LAT_SW_ID}] 应为 LATENT 泛型开关(latent 路由)")
    if latsw["widgets_values"][0] is not False:
        errs.append(f"[{LAT_SW_ID}] latent 路由开关 widget 默认应 false(档位由 [{CMP_FUN_ID}] 驱动)")
    if links[latsw["inputs"][0]["link"]][1] != 8:
        errs.append(f"[{LAT_SW_ID}].on_false 上游应 [8] KSampler(档0/1 路)")
    if links[latsw["inputs"][1]["link"]][1] != T8_ID:
        errs.append(f"[{LAT_SW_ID}].on_true 上游应 [{T8_ID}] T8(档2 路)")
    if _trace_reroute(links, nodes, latsw["inputs"][2]["link"]) != CMP_FUN_ID:
        errs.append(f"[{LAT_SW_ID}].switch 上游应 easy compare[{CMP_FUN_ID}](可穿垫脚石)")
    if links[nodes[9]["inputs"][0]["link"]][1] != LAT_SW_ID:
        errs.append("[9].samples 上游应 [54] latent 路由(三档汇流)")
    t8 = nodes[T8_ID]
    if t8["type"] != T8_CLASS:
        errs.append(f"[{T8_ID}] 应为 {T8_CLASS}(Fun-Acc PDD 采样器)")
    if t8["widgets_values"] != [FUNACC_FILE, 0]:
        errs.append(f"[{T8_ID}] model_file/seed 漂移(应 {FUNACC_FILE}/seed 0),得 {t8.get('widgets_values')}")
    if len([i for i in t8["inputs"] if i.get("name") == "negative"]) != 0:
        errs.append(f"[{T8_ID}] T8 无负面槽(输入仅 model/positive/latent_image/model_file/seed)")
    if links[t8["inputs"][0]["link"]][1] != LORA_SW_ID:
        errs.append(f"[{T8_ID}].model 上游应 [{LORA_SW_ID}] 输出(档2 时 false 臂=base 模型)")
    if _trace_reroute(links, nodes, t8["inputs"][1]["link"]) != 6:
        errs.append(f"[{T8_ID}].positive 上游应 [6].positive(与 [8] 同源)")
    if _trace_reroute(links, nodes, t8["inputs"][2]["link"]) != 20:
        errs.append(f"[{T8_ID}].latent_image 上游应 [20] 画幅开关(与 [8] 同源)")
    if len(by_type(T8_CLASS)) != 1:
        errs.append(f"{T8_CLASS} 应恰 1 个(档2 支路)")
    # 三档干跑(懒执行:开关只走选中臂;0927 三档轮:档位经 easy compare 拆两布尔,
    # mode_override 模拟运行态切档;[19] 画幅 PrimitiveBoolean 兼容直取)
    def _sw_bool(node_, mode_override=None):
        lid = node_["inputs"][2].get("link")
        if lid is not None:
            src = nodes[links[lid][1]]
            while src["type"] == "Reroute":   # 穿垫脚石([51]→[54] 经 [57])
                src = nodes[links[src["inputs"][0]["link"]][1]]
            if src["type"] == "PrimitiveBoolean":
                return bool(src["widgets_values"][0])
            if src["type"] == "easy compare":
                a_src = nodes[links[src["inputs"][0]["link"]][1]]
                while a_src["type"] == "Reroute":
                    a_src = nodes[links[a_src["inputs"][0]["link"]][1]]
                b_src = nodes[links[src["inputs"][1]["link"]][1]]
                a_val = mode_override if (mode_override is not None
                                          and a_src["type"] == "PrimitiveInt") \
                    else a_src["widgets_values"][0]
                return int(a_val) == int(b_src["widgets_values"][0])
        return bool(node_["widgets_values"][0])

    def _reach(mode_override=None):
        reach_, stack_ = set(), [10]  # SaveImage
        while stack_:
            nid = stack_.pop()
            if nid in reach_:
                continue
            reach_.add(nid)
            node_ = nodes[nid]
            slots_ = (([1 if _sw_bool(node_, mode_override) else 0]
                       if node_["type"] == "ComfySwitchNode"
                       else range(len(node_.get("inputs", [])))))
            for si in slots_:
                lid = node_["inputs"][si].get("link")
                if lid is not None:
                    stack_.append(links[lid][1])
        return reach_

    def _steps_value(mode_override=None):
        steps_inp = next((i for i in nodes[8]["inputs"] if i.get("name") == "steps"), None)
        if not steps_inp or steps_inp.get("link") is None:
            return None
        sw_ = nodes[links[steps_inp["link"]][1]]
        if sw_["type"] != "ComfySwitchNode":
            return None
        arm = 1 if _sw_bool(sw_, mode_override) else 0
        return nodes[links[sw_["inputs"][arm]["link"]][1]]["widgets_values"][0]

    d2 = _reach()   # 默认态=档2(Fun-Acc)
    if T8_ID not in d2:
        errs.append("干跑:默认态(档2 Fun-Acc)执行图应含 T8 采样器")
    if 8 in d2:
        errs.append("干跑:档2 KSampler 不应执行(latent 路由 on_true=懒旁路,零空转)")
    if LORA_ID in d2:
        errs.append("干跑:档2 viggle LoRA 不应加载(档2 必须 base 模型)")
    if STEPS_SW_ID in d2 or STEPS_C40_ID in d2 or STEPS_C6_ID in d2:
        errs.append("干跑:档2 steps 联动三件不应可达(KSampler 懒旁路)")
    d1 = _reach(mode_override=MODE_VIGGLE)
    if LORA_ID not in d1 or 8 not in d1:
        errs.append("干跑:档1(viggle)执行图应含 LoRA+KSampler")
    if T8_ID in d1:
        errs.append("干跑:档1 T8 不应执行(latent 路由 on_false)")
    if _steps_value(mode_override=MODE_VIGGLE) != STEPS_ON:
        errs.append(f"干跑:档1 steps 应解析={STEPS_ON}(v0.2.1 卡荐档)")
    d0 = _reach(mode_override=MODE_DIRECT)
    if LORA_ID in d0 or T8_ID in d0:
        errs.append("干跑:档0(直出)执行图应零 LoRA 零 T8(正常生成)")
    if 8 not in d0:
        errs.append("干跑:档0 KSampler 应在执行链(40 步主线)")
    if _steps_value(mode_override=MODE_DIRECT) != STEPS_OFF:
        errs.append(f"干跑:档0 steps 应解析={STEPS_OFF}(自动回原路)")

    # 13c 满血接线轮·steps 联动结构([33] INT 开关 false→[34]=40/true→[35]=6→[8].steps
    #     转输入;switch 槽与 MODEL 开关同一布尔源 [30] 扇出两线)
    ssw = nodes[STEPS_SW_ID]
    if ssw["type"] != "ComfySwitchNode" or ssw["outputs"][0]["type"] != "INT":
        errs.append(f"[{STEPS_SW_ID}] 应为 INT 泛型开关(steps 联动,样板=t2i [157][158])")
    if ssw["widgets_values"][0] is not False:
        errs.append(f"[{STEPS_SW_ID}] steps 联动开关默认应 false(关=原路 40)")
    for cid, want in ((STEPS_C40_ID, STEPS_OFF), (STEPS_C6_ID, STEPS_ON)):
        c = nodes[cid]
        if c["type"] != "PrimitiveInt" or c["widgets_values"][0] != want:
            errs.append(f"[{cid}] PrimitiveInt 常量应={want},得 {c.get('widgets_values')}")
    if links[ssw["inputs"][0]["link"]][1] != STEPS_C40_ID:
        errs.append(f"[{STEPS_SW_ID}].on_false 上游应常量40 [{STEPS_C40_ID}]")
    if links[ssw["inputs"][1]["link"]][1] != STEPS_C6_ID:
        errs.append(f"[{STEPS_SW_ID}].on_true 上游应常量6 [{STEPS_C6_ID}]")
    if links[ssw["inputs"][2]["link"]][1] != CMP_VIG_ID:
        errs.append(f"[{STEPS_SW_ID}].switch 上游应档位==1 布尔 [{CMP_VIG_ID}](与 MODEL 开关同源)")
    if sorted(nodes[CMP_VIG_ID]["outputs"][0]["links"] or []) != sorted([46, 47]):
        errs.append(f"[{CMP_VIG_ID}] viggle 布尔应扇出恰两线(MODEL 开关+steps 开关)")
    ks_steps = next((i for i in nodes[8]["inputs"] if i.get("name") == "steps"), None)
    if not ks_steps or ks_steps.get("link") != 39 or "widget" not in ks_steps:
        errs.append("[8].steps 应为 widget 转输入接 [33] 联动开关(序列化照 [150].base 先例)")

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
                  "[50]", "[51]", "[54]", "[55]",
                  "0=直出 40 步", "1=viggle 6 步", "2=Fun-Acc", "默认 2", "降级=",
                  "shift_terminal=0.02", "TE-Speed",
                  # 0925 收窄轮新要点(W1 组框/W5 负面占位+pp 定档+摆设值)
                  "数学上不参与采样", "官方同构占位", "已定档", "摆设值不生效", "加速区",
                  # 0927 三档轮:依赖警示+档位语义+T8 事实
                  "依赖警示", "生态插件区", "Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8",
                  "T8QwenImage21FunAccPDD4Step", FUNACC_FILE, "无负面槽", "用户手动权威",
                  "懒执行", "绝不吃 viggle LoRA"):
        if token not in note:
            errs.append(f"Note 缺要点:{token}")
    if note.lstrip().startswith("# "):
        errs.append("Note 一级大标题开幅违规")

    return errs


def main():
    with open(WF, encoding="utf-8") as f:
        old = json.load(f)
    shape = preflight(old)

    wf = {
        "id": old.get("id", "8f4c1a92-6d27-4b8e-9a15-2c7d58b0e002"),
        "version": old.get("version", 0.4),
        "revision": old.get("revision", 0),
        "config": old.get("config", {}),
        "extra": old.get("extra", {}),
        "groups": GROUPS,
        "nodes": build_nodes(),
        "links": LINKS,
        # R26.4:LoRA 三件(30/31/32)+VAE 顶通道(28/29)入图,计数器真值重算
        "last_node_id": max([27] + [n["id"] for n in build_nodes()]),
        "last_link_id": max([29] + [l[0] for l in LINKS]),
    }

    errs = verify(wf)
    if errs:
        for e in errs:
            print(f"  自查红:{e}", file=sys.stderr)
        sys.exit("写盘前自查未过,拒写盘。")

    with open(WF, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"再生成完成:{WF}({shape};节点 {len(wf['nodes'])}/连线 {len(wf['links'])}/"
          f"group 4=W1 加速区组框;W5 负面 cfg=1 官方同构占位+pp=1.5 定档+steps 摆设值注明;"
          f"W6 零负区(pos≥80,0926 收紧=发现项3 互锁);0926 铁律线不遮节点(贝塞尔采样精判零红);"
          f"0927 三档轮=加速档位 [30] PrimitiveInt 默认 {MODE_DEFAULT}(Fun-Acc PDD 4步,用户裁定;"
          f"0=直出40/1=viggle 6/2=Fun-Acc 4),easy compare×2 拆布尔([{CMP_VIG_ID}]==1 驱 MODEL+steps "
          f"开关,[{CMP_FUN_ID}]==2 驱 [{LAT_SW_ID}] latent 路由),[{T8_ID}] T8 采样器(model=base 总线/"
          f"positive 与 [8] 同源/latent 与 [8] 同源/无负面槽/seed 0),懒执行=档2 时 KSampler+LoRA+"
          f"steps 三件整体旁路;自查零红)")


if __name__ == "__main__":
    main()
