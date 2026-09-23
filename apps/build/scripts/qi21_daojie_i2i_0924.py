#!/usr/bin/env python3
"""qi21-道劫-i2i.json 幂等生成器(09-24,道劫风格图生图·生修合一架构纠正版)。

Trellis 09-24-qi21-daojie-i2i(R24);PRD 09-24 架构纠正:Qwen-Image-2.1 生修合一,
**无传统 img2img——图输入即指令编辑**,旧 denoise 图生图设计(LoadImage→VAEEncode
→denoise)就此作废。本件=edit 骨架 + qi21 九型装配移植:

  骨架(承 qwen21_edit_core_pe_0923.py,R16 核心化版原样保留):
    LoadImage×2(官方示例双图)→[16/17]预缩(画布1.5MP/参考1.0MP)→[25]BatchImagesNode
    双通道(PE 看全图/编码器吃选图)→PE-I2I 链([12]专属 CLIPLoader+chatml 三段
    [21][22][23]+StringFormat[24]+TextGenerate[26]+RegexExtract[27]+开关[15],
    默认 false=直写指令)→[40]装配子图;latent 双路([19]/[18]/[20],默认跟随
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
    lora-r64.safetensors,strength 1.0)⟩→[8]KSampler;[30]PrimitiveBoolean
    默认 false=旁路。**TE-Speed 槽不出生带**(插件未装=画布红节点,R26.4 统一
    接线轮三件同构补入)。
  布局(照任务一 09-24 布局整治标准,从出生合规):
    恒向右(全连线 target.x>origin.x)/行式从上到下、行内从左到右/group int id
    互异/长横穿走顶部 Reroute 通道(MODEL y=-560/VAE y=-640,序列化=K2-角色
    设定-道劫.json 顶层级样板)/节点标题铁律=核心与第三方节点零自定义 title,
    仅自研(My*)可命([150] 带道劫字号 title)。

幂等:全量确定性再生成,重跑逐字节一致(真源=本脚本;主体句默认/锁层全文从
05 库现读,BASE 真源=qi21_bases.json 磁盘热读,库更新重跑即同步)。前置守卫:
现文件必须是本脚本产物形(含 MyQi21DaojieBase 子图+TextGenerate+LoraLoader
ModelOnly),别的形状拒写(铁律0)。

不动 K2 存档 9 件;qwen21-edit.json 本体零改动;引擎家 git 恒 0;userdata
零写入;TE-Speed 槽禁入本件(R26.4 统一补)。

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
CLIP_FILE = "qwen3vl_8b_bf16.safetensors"
VAE_FILE = "qwen_image_2.1_vae_bf16.safetensors"
PE_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors"
LORA_FILE = "Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors"

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
CHAR_TYPES = ("人物", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分")
DEFAULT_TYPE = "人物"
RGBA_HEAD_EN = "This is an RGBA image with transparency."
RGBA_TAIL_EN = "The image has alpha channel and the background is transparent."
RGBA_HEAD_ZH = "这是一张带有透明度的RGBA图像。"
RGBA_TAIL_ZH = "该图像具有alpha通道,背景是透明的。"

# 子图内部节点 id(独立 id 空间,承 t2i 装配段编号)
BASE_ID = 150                 # MyQi21DaojieBase 九选一(自研,可命 title)
LOCK_ID = 110                 # 通用锁层常量A
RGBA_HEAD_ID, RGBA_TAIL_ID = 160, 161
CONCAT1_ID, CONCAT2_ID = 130, 131
RGBA_CAT1_ID, RGBA_CAT2_ID = 162, 163
TE_ID, TE_RGBA_ID, RGBA_SW_ID = 142, 143, 144
# 主图锚(id 承 edit 骨架同表)
HOST_ID = 40                  # 装配子图宿主
PREVIEW_ID = 28               # easy showAnything 装配预览(新 id,edit 的 27=RegexExtract)
NOTE_ID = 11                  # MarkdownNote
LORA_PB_ID, LORA_ID, LORA_SW_ID = 30, 31, 32   # LoRA 加速槽三件
RR_M_A_ID, RR_M_B_ID = 41, 42                 # MODEL 顶通道(y=-560)
RR_V_A_ID, RR_V_B_ID = 43, 44                 # VAE 顶通道(y=-640)

# 全图节点类型白名单(自查:TE-Speed 槽禁入本件——插件未装=红节点,任何未知类型即红)
NODE_TYPE_WHITELIST = {
    # 主图
    "UNETLoader", "CLIPLoader", "VAELoader", "LoadImage",
    "ImageScaleToTotalPixels", "QwenImage21Cache", "LoraLoaderModelOnly",
    "PrimitiveBoolean", "ComfySwitchNode", "KSampler", "VAEDecode",
    "SaveImage", "PrimitiveStringMultiline", "StringFormat", "BatchImagesNode",
    "TextGenerate", "RegexExtract", "MarkdownNote", "easy showAnything",
    "Reroute", "EmptyLatentImage",
    # 子图
    "MyQi21DaojieBase", "StringConstant", "StringConcatenate",
    "TextEncodeQwenImage21",
}

NOTE_TEXT = """## 道劫 · Qwen-Image-2.1 图生图(生修合一·编辑流骨架+九型装配;i2i 09-24)

**机制纠正(09-24)**:Qwen-Image-2.1 生修合一,**无传统 img2img(denoise 重绘不存在)——图输入即指令编辑**。
本件=edit 编辑骨架(PE-I2I 看图改写+多参考图双通道)+qi21 道劫九型装配的合体;对标 K2 线 krea2-daojie-i2i.json 同域同式。

### 指令×装配怎么拼(执行期定稿,05 库 §一四层装配口径)

- **指令=改什么**(①主体句位):[22] 原始用户词=唯一手写位(默认=官方换装例句);经 [15] PE 开关(false=直写/true=PE-I2I 看图改写,默认 false)接进 [40] 装配子图「指令」槽——**指令即主体**。
- **装配=道劫画风约束**(②③层恒挂):[40] 子图把 指令 + MyQi21DaojieBase 当前型 BASE(②型底座+④配色行,逐字=05 库↔qi21_bases.json 互锁)+通用锁层常量A(③层,库首节全文,全九型恒挂)按**换行分层**接成一段进编码;拼接次序照 05 库四层口径(①领头→②→③)。
- 跑图前过目 [28] 装配预览(接 [40] prompt 输出):显示将进编码的最终文本(指令+装配全文)。
- 装配全文过长挤压指令权重的风险(拼接次序/换行分层已按库口径;PE 开启时改写文与装配双写重复=同 09-22 三视图先例,可跑;嫌重复就关 PE 用直写)。

### 怎么换型(一处切换)

- 主画布点选 [40] 装配子图,面板「型选择」下拉九选一(默认①人物):人物/场景/道具/美宣/三视图/高清人脸/分镜剧情图/表情差分/概念气氛图——子图内 MyQi21DaojieBase 按选型出 BASE(真源=qi21_bases.json 磁盘热读,逐字=05 库)。
- **画幅随输入图,不随型**(i2i 语义):MyQi21DaojieBase 的 WIDTH/HEIGHT 输出本件不接(画幅联动行不移植)——分辨率=TextEncode.resolution 0(不重采样,输出跟随 image_1 预缩后比例);要自定义画幅开 [19] 输出画幅双路。

### 官方示例双图(须先放引擎 input 目录)

- image_1 = portrait_model_denim.png(编辑画布/人物)
- image_2 = clothing_light_blue_denim_shirt.png(参考/衬衫)
- **参考图语法**:指令里用 `<image1>`..`<image10>` 点名;image_1=编辑目标画布,其余是参考;模型契约上限 10 图(节点槽 16)。

### 参数圣经(官方模板 Note 要点)

- **cfg 恒 1**(官方路径):cfg=1 时负向提示词不参与采样。**步数 40(道劫产线完整档;官方区间 40-50)**;euler/simple/denoise 1.0;seed fixed 可复现。
- **resolution 是总像素预算非宽高**:[40] 子图编码器取 **0=不重采样**(仅取整到 32 的倍数),输出尺寸跟随 image_1(预缩后)。
- **输入图预缩**:加载后先 ImageScaleToTotalPixels(lanczos·32 倍数)——画布 1.5MP、参考图 1.0MP;控显存+稳输入尺寸。
- **QwenImage21Cache(auto/default)**:KV 缓存挂 UNETLoader 后,内存吃紧可调(cpu/int8)。

### PE-I2I 改写组([15] 开关,默认关=直写)

- 链路:[12] PE CLIPLoader(pe_i2i bf16·type=qwen_image)→ 三段 chatml 拼装([24] StringFormat {a}{b}{c}:a=[21] 官方 i2i 系统提示词/b=[22] 原始用户词/c=[23] assistant+`<think>` 预填)→ [26] TextGenerate(comfy-core)→ [27] RegexExtract(抓 rewritten_prompt,dotall)→ [15] 开关。
- **PE 看全部输入图(双通道)**:[25] BatchImagesNode 合批全部(预缩后)输入图喂 [26].image;[40] 子图编码器只吃选定图。
- [26] 参数:use_default_template=false+thinking=false(`<think>` 预填是官方刻意设计,勿改);temp 0.7/topK 20/topP 0.95/minP 0.05/repPen 1.05/maxLength 8192/seed 42;presence_penalty=1.5 暂保待 A/B。
- 旁路时 PE 组不进执行图(ComfySwitchNode 懒执行,PE 模型不加载)。
- PE 权重:text_encoders/qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors(bf16 自转件;官方 int8_convrot 在 MPS 首矩阵乘即死,勿装)。

### LoRA 加速槽([30] 开关,默认关=旁路;09-24 定案:出生只带 LoRA 槽)

- 接线:[1] UNET → [7] Cache → [32] MODEL 开关(false=直连/true=[31] LoraLoaderModelOnly)→ [8] KSampler;[31] name 预填 **Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors**(viggle 4-step 蒸馏 LoRA,已装机),strength 1.0。
- **开启后须把 [8] steps 调 4**(官方 4-step 档),cfg 保持 1;不调步数=白载 LoRA。
- 分工:PE=提示词优化(已在链)/LoRA=少步数加速(须调 steps)。
- **TE-Speed 槽不在本件**(提速件未装=画布红节点;R26.4 统一接线轮三件同构补入)。

### RGBA 透明图句式(存 PNG 才保 alpha;[40] 面板「RGBA透明开关」默认关)

This is an RGBA image with transparency. [装配全文,与 [28] 同源]. The image has alpha channel and the background is transparent.
中文同款:这是一张带有透明度的RGBA图像。……该图像具有alpha通道,背景是透明的。(头尾逐字=官方原文,子图 [160][161][162][163] 现拼)

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
        "人物": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
        "场景": "场景青绿=宣纸白+淡墨+石绿+石青+赭石",
        "道具": "道具旧金=宣纸白+浓墨+旧金+暗玉青",
        "美宣": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
        "三视图": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
        "高清人脸": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
        "分镜剧情图": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
        "表情差分": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
        "概念气氛图": "场景青绿=宣纸白+淡墨+石绿+石青+赭石",
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
            out_links: list[int], pos: list, typ: str = "STRING", size: list | None = None) -> dict:
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
        "widgets_values": [False],
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


# ── 子图构建(承 t2i 生成器任务一修好的装配段;裁画幅联动行与内部 PE)────
def build_subgraph(truth: dict) -> dict:
    """装配子图:指令+BASE+锁层A 四层装配 + RGBA 官方公式 + 双路编码。

    行式(design:从上到下=阶段行、行内从左到右):
      行1 y=0    源行:[150] 九选一底座 + [110] 锁层A + [160][161] RGBA 官方头尾
      行2 y=560  装配路由:[130] 拼接①(指令+BASE)→[131] 拼接②(+锁层A)→
                 [162][163] RGBA 公式拼接(头+装配全文+尾)
      行3 y=1060 编码输出:[143] RGBA 编码→[142] 主编码→[144] RGBA 开关
    (t2i 的画幅联动行 [151]-[158] 不移植——i2i 画幅随输入图,不随型。)
    """
    ROW_Y = (0, 560, 1060)
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
    links.append(_internal_link(9, -10, 4, CONCAT1_ID, 0, "STRING"))     # 指令 → 拼接①.string_a(①层占位)
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
    # 编码与 RGBA 开关(21-26)
    links.append(_internal_link(21, TE_ID, 0, RGBA_SW_ID, 0, "CONDITIONING"))
    links.append(_internal_link(22, TE_RGBA_ID, 0, RGBA_SW_ID, 1, "CONDITIONING"))
    links.append(_internal_link(23, RGBA_SW_ID, 0, -20, 0, "CONDITIONING"))   # → 输出 positive
    links.append(_internal_link(24, TE_ID, 1, -20, 1, "CONDITIONING"))        # 主编码.negative → 输出
    links.append(_internal_link(25, CONCAT2_ID, 0, -20, 2, "STRING"))         # 装配文本 → 输出 prompt
    links.append(_internal_link(26, TE_ID, 2, -20, 3, "LATENT"))              # 主编码.latent → 输出(画幅双路源)
    assert sorted(l["id"] for l in links) == list(range(1, 27))

    nodes: list[dict] = []
    # 行1 源行
    nodes.append({
        "id": BASE_ID, "type": "MyQi21DaojieBase",
        "title": "道劫·底座九选一(MyQi21DaojieBase:BASE=②+B+④ 逐字=05库/磁盘热读;W/H 本件不用=画幅随输入图)",
        "pos": [40, ROW_Y[0]], "size": [420, 200], "flags": {}, "order": 0, "mode": 0,
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
        LOCK_ID, truth["const_a"], [520, ROW_Y[0]], [13], [440, 400]))
    nodes.append(_string_constant(
        RGBA_HEAD_ID, RGBA_HEAD_EN, [1040, ROW_Y[0]], [17], [380, 120]))
    nodes.append(_string_constant(
        RGBA_TAIL_ID, RGBA_TAIL_EN, [1460, ROW_Y[0]], [19], [380, 120]))

    # 行2 装配路由(09-24 布局整治坐标承 t2i;无内部 PE 故无尾部开关)
    nodes.append(_concatenate(CONCAT1_ID, 9, 12, [14], [100, ROW_Y[1]]))
    nodes.append(_concatenate(CONCAT2_ID, 14, 13, [15, 16, 25], [560, ROW_Y[1]]))
    nodes.append(_concatenate(RGBA_CAT1_ID, 17, 16, [18], [1440, ROW_Y[1]], delimiter=" "))
    nodes.append(_concatenate(RGBA_CAT2_ID, 18, 19, [20], [1880, ROW_Y[1]], delimiter=" "))

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

    nodes.append(_textencode(TE_RGBA_ID, [2000, ROW_Y[2]], 2, 7, 4, 8, 20, [22]))
    nodes.append(_textencode(TE_ID, [2500, ROW_Y[2]], 1, 5, 3, 6, 15, [21]))
    nodes.append(_switch(
        RGBA_SW_ID, 21, 22, 11, [23], [2980, ROW_Y[2]], typ="CONDITIONING"))

    for order, n in enumerate(nodes):
        n["order"] = order

    groups: list[dict] = [
        {
            "id": 1, "title": "道劫·底座装配(行1 源行:九选一底座+锁层A恒挂+RGBA官方头尾)",
            "bounding": [0, -40, 1880, 480], "color": "#3f789e", "flags": {},
        },
        {
            "id": 2, "title": "道劫·装配路由(行2:拼接①② delimiter=\\n 分层·指令占①层;RGBA 公式拼接)",
            "bounding": [60, 520, 2200, 290], "color": "#a1309b", "flags": {},
        },
        {
            "id": 3, "title": "道劫·编码输出(行3:主编码+RGBA编码(官方公式路,默认旁路)+RGBA开关)",
            "bounding": [1960, 1020, 1450, 420], "color": "#886", "flags": {},
        },
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
        "e8f1a2b3-0001-4b01-8f01-d47c9e21b01",   # out-0 positive
        "e8f1a2b3-0002-4b02-8f02-d47c9e21b02",   # out-1 negative
        "e8f1a2b3-0003-4b03-8f03-d47c9e21b03",   # out-2 prompt
        "e8f1a2b3-0004-4b04-8f04-d47c9e21b04",   # out-3 latent
    ]
    # IO 槽 pos(clip/image_1/image_2 自行3 槽位高度带上方平入;vae/RGBA开关 落行3 下缘带
    # 自下而入;指令在行2 带;型选择在行1 带——长线恒向右,拐点不带 Reroute 即直入)
    inputs = [
        {"id": _IO_IDS[0], "name": "clip", "type": "CLIP", "linkIds": [1, 2], "pos": [-196, 1060]},
        {"id": _IO_IDS[1], "name": "vae", "type": "VAE", "linkIds": [3, 4], "pos": [-196, 1440]},
        {"id": _IO_IDS[2], "name": "image_1", "type": "IMAGE", "linkIds": [5, 7], "pos": [-196, 1100]},
        {"id": _IO_IDS[3], "name": "image_2", "type": "IMAGE", "linkIds": [6, 8], "pos": [-196, 1150]},
        {"id": _IO_IDS[4], "name": "指令", "type": "STRING", "linkIds": [9], "pos": [-196, 600]},
        {"id": _IO_IDS[5], "name": "型选择", "type": "COMBO", "linkIds": [10], "pos": [-196, 20]},
        {"id": _IO_IDS[6], "name": "RGBA透明开关", "type": "BOOLEAN", "linkIds": [11], "pos": [-196, 1500]},
    ]
    outputs = [
        {"id": _IO_IDS[7], "name": "positive", "type": "CONDITIONING", "linkIds": [23], "pos": [3600, 1120]},
        {"id": _IO_IDS[8], "name": "negative", "type": "CONDITIONING", "linkIds": [24], "pos": [3600, 1180]},
        {"id": _IO_IDS[9], "name": "prompt", "type": "STRING", "linkIds": [25], "pos": [3600, 620]},
        {"id": _IO_IDS[10], "name": "latent", "type": "LATENT", "linkIds": [26], "pos": [3600, 1240]},
    ]

    sg = {
        "id": SG_UUID,
        "version": 1,
        "state": {"lastGroupId": 3, "lastNodeId": 163, "lastLinkId": 26, "lastRerouteId": 0},
        "revision": 1,
        "config": {"defaultIOState": {}},
        "name": "[40] 道劫·装配子图(i2i:指令占①层+九型底座+锁层A 四层装配+RGBA 公式+双路编码;双击进入)",
        "inputNode": {"id": -10, "bounding": [-320, -260, 160, 1860]},
        "outputNode": {"id": -20, "bounding": [2900, 560, 2000, 900]},
        "inputs": inputs,
        "outputs": outputs,
        "widgets": [B_SEG, DEFAULT_TYPE, False],
        "nodes": nodes,
        "groups": groups,
        "links": links,
        "extra": {"ue_links": [], "links_added_by_ue": []},
    }
    return sg


# ── 主图构建(edit 骨架 + 宿主 + LoRA 加速槽 + 顶通道 Reroute)──────────
def build_main(truth: dict, sg: dict) -> dict:
    g = {
        "id": WF_UUID, "version": 0.4, "revision": 0, "config": {}, "extra": {},
        "groups": [
            {"id": 1, "title": "道劫·加载器(bf16 三件套+PE-I2I 专属文本编码器)",
             "bounding": [-1900, -510, 1780, 240], "color": "#3f789e", "flags": {}},
            {"id": 2, "title": "道劫·编辑主链(双图预缩→[40]装配子图→LoRA加速槽→采样→解码→保存;下排=输出画幅双路)",
             "bounding": [-1900, -150, 5230, 1150], "color": "#3f789e", "flags": {}},
            {"id": 3, "title": "道劫·PE-I2I 改写组(默认旁路·核心 TextGenerate·看全部输入图·edit 骨架原样)",
             "bounding": [-1900, 1150, 2980, 820], "color": "#8864a8", "flags": {}},
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
        # ── 行1 加载器(上)────────────────────────────────────────
        _core(1, "UNETLoader", [-1860, -460], [340, 84],
              [_combo("unet_name"), _combo("weight_dtype")],
              [{"name": "MODEL", "type": "MODEL", "links": [22]}],
              [UNET_FILE, "default"]),
        _core(2, "CLIPLoader", [-1440, -460], [360, 130],
              [_combo("clip_name"), _combo("type"), _combo("device", shape=7)],
              [{"name": "CLIP", "type": "CLIP", "links": [3]}],
              [CLIP_FILE, "qwen_image", "default"]),
        _core(3, "VAELoader", [-1000, -460], [340, 60],
              [_combo("vae_name")],
              [{"name": "VAE", "type": "VAE", "links": [4, 35]}],
              [VAE_FILE]),
        _core(12, "CLIPLoader", [-560, -460], [400, 130],
              [_combo("clip_name"), _combo("type"), _combo("device", shape=7)],
              [{"name": "CLIP", "type": "CLIP", "links": [9]}],
              [PE_CLIP_FILE, "qwen_image", "default"]),
        # ── 行2 主链前半:双图→预缩→[40] 装配子图宿主→装配预览 ──────
        _core(4, "LoadImage", [-1860, -100], [340, 420],
              [_combo("image"), {"name": "upload", "type": "IMAGEUPLOAD",
                                 "widget": {"name": "upload"}, "link": None}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [1]},
               {"name": "MASK", "type": "MASK", "links": None}],
              [IMG1, "image"]),
        _core(16, "ImageScaleToTotalPixels", [-1480, -100], [330, 130],
              [{"name": "image", "type": "IMAGE", "link": 1},
               _combo("upscale_method"), {"name": "megapixels", "type": "FLOAT",
                                          "widget": {"name": "megapixels"}, "link": None},
               {"name": "resolution_steps", "type": "INT",
                "widget": {"name": "resolution_steps"}, "link": None}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [5, 7]}],
              ["lanczos", 1.5, 32]),
        _core(5, "LoadImage", [-1100, -100], [340, 420],
              [_combo("image"), {"name": "upload", "type": "IMAGEUPLOAD",
                                 "widget": {"name": "upload"}, "link": None}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [2]},
               {"name": "MASK", "type": "MASK", "links": None}],
              [IMG2, "image"]),
        _core(17, "ImageScaleToTotalPixels", [-720, -100], [330, 130],
              [{"name": "image", "type": "IMAGE", "link": 2},
               _combo("upscale_method"), {"name": "megapixels", "type": "FLOAT",
                                          "widget": {"name": "megapixels"}, "link": None},
               {"name": "resolution_steps", "type": "INT",
                "widget": {"name": "resolution_steps"}, "link": None}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [6, 8]}],
              ["lanczos", 1.0, 32]),
        # [40] 装配子图宿主(widget 型输入=宿主面板;序列化口径=t2i [40] 实证)
        {
            "id": HOST_ID, "type": SG_UUID,
            "pos": [1000, -100], "size": [560, 480], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": 3},
                {"name": "vae", "type": "VAE", "link": 4},
                {"name": "image_1", "type": "IMAGE", "link": 5},
                {"name": "image_2", "type": "IMAGE", "link": 6},
                {"name": "指令", "type": "STRING", "widget": {"name": "指令"}, "link": 18},
                {"name": "型选择", "type": "COMBO", "widget": {"name": "型选择"}, "link": None},
                {"name": "RGBA透明开关", "type": "BOOLEAN", "widget": {"name": "RGBA透明开关"}, "link": None},
            ],
            "outputs": [
                {"name": "positive", "type": "CONDITIONING", "links": [19]},
                {"name": "negative", "type": "CONDITIONING", "links": [20]},
                {"name": "prompt", "type": "STRING", "links": [21]},
                {"name": "latent", "type": "LATENT", "links": [30]},
            ],
            "properties": {"subgraph": SG_UUID, "previewExposures": []},
            "widgets_values": [B_SEG, DEFAULT_TYPE, False],
            "widgets_values_named": {"指令": B_SEG, "型选择": DEFAULT_TYPE,
                                     "RGBA透明开关": False},
        },
        _core(PREVIEW_ID, "easy showAnything", [1620, -100], [480, 230],
              [{"label": "输入任何", "name": "anything", "shape": 7, "type": "*", "link": 21}],
              [{"name": "output", "type": "*", "links": None}],
              [""]),
        # ── 行3 加速槽+采样→解码→保存 ─────────────────────────────
        _core(7, "QwenImage21Cache", [1000, 480], [340, 120],
              [{"name": "model", "type": "MODEL", "link": 24},
               _combo("device"), _combo("dtype")],
              [{"name": "MODEL", "type": "MODEL", "links": [25, 26]}],
              ["auto", "default"]),
        _core(LORA_PB_ID, "PrimitiveBoolean", [1000, 640], [280, 90],
              [{"name": "value", "type": "BOOLEAN", "widget": {"name": "value"}, "link": None}],
              [{"name": "BOOLEAN", "type": "BOOLEAN", "links": [28]}],
              [False]),
        _core(LORA_ID, "LoraLoaderModelOnly", [1400, 480], [340, 130],
              [{"name": "model", "type": "MODEL", "link": 25},
               _combo("lora_name"), {"name": "strength_model", "type": "FLOAT",
                                     "widget": {"name": "strength_model"}, "link": None}],
              [{"name": "MODEL", "type": "MODEL", "links": [27]}],
              [LORA_FILE, 1.0]),
        _switch(LORA_SW_ID, 26, 27, 28, [29], [1800, 480], typ="MODEL", size=[300, 110]),
        _core(8, "KSampler", [2200, 480], [330, 260],
              [{"name": "model", "type": "MODEL", "link": 29},
               {"name": "positive", "type": "CONDITIONING", "link": 19},
               {"name": "negative", "type": "CONDITIONING", "link": 20},
               {"name": "latent_image", "type": "LATENT", "link": 33}],
              [{"name": "LATENT", "type": "LATENT", "links": [34]}],
              [0, "fixed", 40, 1, "euler", "simple", 1.0]),
        _core(9, "VAEDecode", [2590, 480], [240, 50],
              [{"name": "samples", "type": "LATENT", "link": 34},
               {"name": "vae", "type": "VAE", "link": 37}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [38]}]),
        _core(10, "SaveImage", [2890, 480], [380, 330],
              [{"name": "images", "type": "IMAGE", "link": 38}], [],
              ["QI21道劫图生图_"]),
        # ── 行3c 输出画幅双路 ──────────────────────────────────────
        _core(19, "PrimitiveBoolean", [1000, 860], [280, 90],
              [{"name": "value", "type": "BOOLEAN", "widget": {"name": "value"}, "link": None}],
              [{"name": "BOOLEAN", "type": "BOOLEAN", "links": [32]}],
              [False]),
        _core(18, "EmptyLatentImage", [1400, 860], [300, 120],
              [{"name": "width", "type": "INT", "widget": {"name": "width"}, "link": None},
               {"name": "height", "type": "INT", "widget": {"name": "height"}, "link": None},
               {"name": "batch_size", "type": "INT", "widget": {"name": "batch_size"}, "link": None}],
              [{"name": "LATENT", "type": "LATENT", "links": [31]}],
              [1024, 1024, 1]),
        _switch(20, 30, 31, 32, [33], [1780, 860], typ="LATENT", size=[280, 100]),
        # ── 行4 PE 链前半:chatml 三段 + 拼装 ───────────────────────
        _core(21, "PrimitiveStringMultiline", [-1440, 1200], [300, 180],
              [{"name": "value", "type": "STRING", "widget": {"name": "value"}, "link": None}],
              [{"name": "STRING", "type": "STRING", "links": [10]}],
              [A_SEG]),
        _core(22, "PrimitiveStringMultiline", [-1090, 1200], [340, 180],
              [{"name": "value", "type": "STRING", "widget": {"name": "value"}, "link": None}],
              [{"name": "STRING", "type": "STRING", "links": [11, 17]}],
              [B_SEG]),
        _core(23, "PrimitiveStringMultiline", [-700, 1200], [260, 180],
              [{"name": "value", "type": "STRING", "widget": {"name": "value"}, "link": None}],
              [{"name": "STRING", "type": "STRING", "links": [12]}],
              [C_SEG]),
        _core(24, "StringFormat", [-400, 1200], [300, 130],
              [{"name": "values.a", "type": "*", "shape": 7, "link": 10},
               {"name": "values.b", "type": "*", "shape": 7, "link": 11},
               {"name": "values.c", "type": "*", "shape": 7, "link": 12},
               {"name": "f_string", "type": "STRING", "widget": {"name": "f_string"}, "link": None}],
              [{"name": "STRING", "type": "STRING", "links": [13]}],
              ["{a}{b}{c}"]),
        # ── 行5 PE 链后半:合批→生成→正则→开关 ─────────────────────
        _core(25, "BatchImagesNode", [-400, 1460], [260, 170],
              [{"name": "images.image0", "type": "IMAGE", "link": 7},
               {"name": "images.image1", "type": "IMAGE", "shape": 7, "link": 8}],
              [{"name": "IMAGE", "type": "IMAGE", "links": [14]}]),
        _core(26, "TextGenerate", [-110, 1460], [400, 450],
              [{"name": "clip", "type": "CLIP", "link": 9},
               {"name": "image", "type": "IMAGE", "shape": 7, "link": 14},
               {"name": "video", "type": "IMAGE", "shape": 7, "link": None},
               {"name": "audio", "type": "AUDIO", "shape": 7, "link": None},
               {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": 13},
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
              [{"name": "generated_text", "type": "STRING", "links": [15]}],
              TG_WV),
        _core(27, "RegexExtract", [340, 1460], [330, 260],
              [{"name": "string", "type": "STRING", "widget": {"name": "string"}, "link": 15},
               {"name": "regex_pattern", "type": "STRING",
                "widget": {"name": "regex_pattern"}, "link": None},
               {"name": "mode", "type": "COMBO", "widget": {"name": "mode"}, "link": None},
               {"name": "case_insensitive", "type": "BOOLEAN",
                "widget": {"name": "case_insensitive"}, "link": None},
               {"name": "multiline", "type": "BOOLEAN",
                "widget": {"name": "multiline"}, "link": None},
               {"name": "dotall", "type": "BOOLEAN", "widget": {"name": "dotall"}, "link": None},
               {"name": "group_index", "type": "INT", "widget": {"name": "group_index"}, "link": None}],
              [{"name": "STRING", "type": "STRING", "links": [16]}],
              ["", REGEX, "First Group", False, False, True, 1]),
        _switch(15, 17, 16, None, [18], [720, 1460], typ="STRING", size=[300, 110]),
        # ── 说明卡(左缘独立,零重叠)──────────────────────────────
        _core(NOTE_ID, "MarkdownNote", [-3400, -100], [940, 1100], [], [],
              [NOTE_TEXT]),
        # ── 顶缘通道 Reroute(MODEL y=-560/VAE y=-640 两长横穿;样板=K2-角色设定-道劫.json)──
        _reroute(RR_M_A_ID, [-1200, -560], 22, 23, "MODEL"),
        _reroute(RR_M_B_ID, [950, -560], 23, 24, "MODEL"),
        _reroute(RR_V_A_ID, [-940, -640], 35, 36, "VAE"),
        _reroute(RR_V_B_ID, [2450, -640], 36, 37, "VAE"),
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
        [7, 16, 0, 25, 0, "IMAGE"],       # 预缩A → 合批(PE 看全图)
        [8, 17, 0, 25, 1, "IMAGE"],       # 预缩B → 合批
        [9, 12, 0, 26, 0, "CLIP"],        # PE loader → TextGenerate.clip
        [10, 21, 0, 24, 0, "STRING"],     # a 段 → 拼装
        [11, 22, 0, 24, 1, "STRING"],     # b 段(原始用户词/指令)→ 拼装
        [12, 23, 0, 24, 2, "STRING"],     # c 段 → 拼装
        [13, 24, 0, 26, 4, "STRING"],     # chatml 全文 → TextGenerate.prompt
        [14, 25, 0, 26, 1, "IMAGE"],      # 合批 → TextGenerate.image
        [15, 26, 0, 27, 0, "STRING"],     # 生成原文 → 正则
        [16, 27, 0, 15, 1, "STRING"],     # rewritten_prompt → PE 开关.on_true
        [17, 22, 0, 15, 0, "STRING"],     # 原始用户词 → PE 开关.on_false
        [18, 15, 0, HOST_ID, 4, "STRING"],   # PE 开关 → 宿主.指令(①层占位)
        [19, HOST_ID, 0, 8, 1, "CONDITIONING"],  # 宿主.positive → KSampler
        [20, HOST_ID, 1, 8, 2, "CONDITIONING"],  # 宿主.negative → KSampler
        [21, HOST_ID, 2, PREVIEW_ID, 0, "STRING"],  # 宿主.prompt → 装配预览
        [22, 1, 0, RR_M_A_ID, 0, "MODEL"],    # UNET → 顶通道(升)
        [23, RR_M_A_ID, 0, RR_M_B_ID, 0, "MODEL"],  # 顶横 y=-560
        [24, RR_M_B_ID, 0, 7, 0, "MODEL"],    # → Cache
        [25, 7, 0, LORA_ID, 0, "MODEL"],      # Cache → LoraLoader(加速槽 on_true 臂)
        [26, 7, 0, LORA_SW_ID, 0, "MODEL"],   # Cache → MODEL 开关.on_false(直连臂)
        [27, LORA_ID, 0, LORA_SW_ID, 1, "MODEL"],   # LoraLoader → 开关.on_true
        [28, LORA_PB_ID, 0, LORA_SW_ID, 2, "BOOLEAN"],  # LoRA 开关源 → 开关.switch
        [29, LORA_SW_ID, 0, 8, 0, "MODEL"],   # MODEL 开关 → KSampler.model
        [30, HOST_ID, 3, 20, 0, "LATENT"],    # 宿主.latent → 画幅开关.on_false
        [31, 18, 0, 20, 1, "LATENT"],         # 空潜 → 画幅开关.on_true
        [32, 19, 0, 20, 2, "BOOLEAN"],        # 布尔 → 画幅开关.switch
        [33, 20, 0, 8, 3, "LATENT"],          # 画幅开关 → KSampler.latent_image
        [34, 8, 0, 9, 0, "LATENT"],
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


# ── 干跑(静态 graphToPrompt 等价:默认态装配文本溯源与可达集)──────────
def _dry_run_default(g: dict, sg: dict) -> tuple[set[int], str]:
    """默认态(PE 开关 [15] false / RGBA 开关 false):装配文本溯源与子图可达集。

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
            if hi.get("link") is not None:  # 外链→主图源(指令←[15] 开关)
                src = m_nodes[m_links[hi["link"]][1]]
                if src["type"] == "ComfySwitchNode":
                    assert src["widgets_values"][0] is False, "干跑:默认链开关非 false"
                    texts.extend(resolve_main_switch(src["id"]))
                elif src["type"] == "PrimitiveStringMultiline":
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
            assert src["widgets_values"][0] is False, f"干跑:默认链开关非 false [{src['id']}]"
            texts.extend(resolve_internal(src["id"], 0))  # on_false(懒执行)
        elif src["type"] == "StringConcatenate":
            texts.extend(resolve_internal(src["id"], 0))
            texts.extend(resolve_internal(src["id"], 1))
        return texts

    def resolve_main_switch(nid: int) -> list[str]:
        """主图 [15] PE 开关 on_false 支路(默认)溯源=[22] 原始用户词。"""
        sw = m_nodes[nid]
        assert sw["widgets_values"][0] is False, "干跑:[15] PE 开关默认非 false"
        src = m_nodes[m_links[sw["inputs"][0]["link"]][1]]
        assert src["type"] == "PrimitiveStringMultiline"
        return [src["widgets_values"][0]]

    # 装配文本 = 主编码 [142].prompt 上游(拼接②)溯源
    texts = resolve_internal(TE_ID, 4)

    # 默认态参与执行的子图内部节点(懒执行:开关只走 on_false;从 RGBA 开关 on_false 臂走)
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

    walk(RGBA_SW_ID)  # positive 默认路终点开关(on_false=[142] 主编码臂)
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

    # 6 子图行排版:恰 3 行=三阶段(源/装配路由/编码输出);行间净距≥100;行内 x 严格递增
    sg_rows: dict[int, list[int]] = {}
    for n in sg["nodes"]:
        sg_rows.setdefault(n["pos"][1], []).append(n["id"])
    row_ys = sorted(sg_rows)
    want_rows = [
        [BASE_ID, LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID],
        [CONCAT1_ID, CONCAT2_ID, RGBA_CAT1_ID, RGBA_CAT2_ID],
        [TE_RGBA_ID, TE_ID, RGBA_SW_ID],
    ]
    if len(row_ys) != 3:
        errs.append(f"子图应恰 3 行(源/装配路由/编码),得 {len(row_ys)} 行")
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
    if len(g["groups"]) > 3:
        errs.append(f"主图 group 预算超限(≤3),得 {len(g['groups'])}")
    if len(sg["groups"]) > 4:
        errs.append(f"子图 group 预算超限(≤4),得 {len(sg['groups'])}")
    for grp in g["groups"]:
        if "道劫" not in grp["title"]:
            errs.append(f"主图 group {grp['title']!r} 缺道劫字号")
    if not any("PE-I2I 改写组" in grp.get("title", "") and "默认旁路" in grp.get("title", "")
               for grp in g["groups"]):
        errs.append("缺「PE-I2I 改写组(默认旁路…)」分组")
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

    # 10 节点标题铁律(0924-r8):核心/第三方零自定义 title,仅自研(My*)可命
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for n in scope_nodes:
            if "title" in n and not n["type"].startswith("My"):
                errs.append(f"{scope} node{n['id']}({n['type']}) 核心节点带自定义 title")

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

    # 13 KSampler 契约 + Cache 挂位
    ks = by_type(g["nodes"], "KSampler")
    if len(ks) != 1:
        errs.append("KSampler 应恰 1")
    else:
        wv = ks[0]["widgets_values"]
        if not (wv[2] == 40 and wv[3] == 1 and wv[4] == "euler" and wv[5] == "simple"
                and wv[6] == 1.0 and wv[1] == "fixed"):
            errs.append(f"KSampler 参数漂移(40步/cfg1/euler/simple/denoise1/fixed): {wv}")
    cache = by_type(g["nodes"], "QwenImage21Cache")
    if len(cache) != 1 or cache[0]["widgets_values"] != ["auto", "default"]:
        errs.append("QwenImage21Cache(auto/default) 应恰 1")
    else:
        up = _trace_reroute_main(m_links, m_nodes, cache[0]["inputs"][0]["link"])
        if m_nodes[up]["type"] != "UNETLoader":
            errs.append("Cache 上游应 UNETLoader(可穿顶通道 Reroute)")
        dn = m_links[cache[0]["outputs"][0]["links"][0]]
        if m_nodes[dn[3]]["type"] not in ("KSampler", "ComfySwitchNode", "LoraLoaderModelOnly"):
            errs.append("Cache 下游应在通往 KSampler 的 MODEL 链上")

    # 14 LoRA 加速槽(09-24 定案:出生只带 LoRA 槽,默认旁路)
    loras = by_type(g["nodes"], "LoraLoaderModelOnly")
    if len(loras) != 1 or loras[0]["id"] != LORA_ID:
        errs.append(f"LoraLoaderModelOnly[{LORA_ID}] 应恰 1")
    else:
        if loras[0]["widgets_values"] != [LORA_FILE, 1.0]:
            errs.append(f"LoRA 槽 name/strength 漂移: {loras[0]['widgets_values']}")
        if _trace_reroute_main(m_links, m_nodes, loras[0]["inputs"][0]["link"]) != 7:
            errs.append("LoRA 槽 model 上游应 QwenImage21Cache[7]")
    lsw = m_nodes[LORA_SW_ID]
    if lsw["type"] != "ComfySwitchNode" or lsw["outputs"][0]["type"] != "MODEL":
        errs.append(f"[{LORA_SW_ID}] 应为 MODEL 泛型开关")
    if lsw["widgets_values"][0] is not False:
        errs.append(f"[{LORA_SW_ID}] LoRA 开关默认应 false(旁路)")
    if _trace_reroute_main(m_links, m_nodes, lsw["inputs"][0]["link"]) != 7:
        errs.append("MODEL 开关 on_false 上游应 Cache[7](直连臂)")
    if m_links[lsw["inputs"][1]["link"]][1] != LORA_ID:
        errs.append("MODEL 开关 on_true 上游应 LoraLoaderModelOnly")
    if m_nodes[m_links[lsw["inputs"][2]["link"]][1]]["id"] != LORA_PB_ID:
        errs.append("MODEL 开关 switch 上游应 PrimitiveBoolean[30]")
    if m_nodes[LORA_PB_ID]["widgets_values"][0] is not False:
        errs.append("[30] LoRA 开关源默认应 false")
    if m_links[m_nodes[8]["inputs"][0]["link"]][1] != LORA_SW_ID:
        errs.append("KSampler.model 上游应 MODEL 开关(加速槽二选一)")

    # 15 PE-I2I 链(edit 骨架原样):TextGenerate 参数/chatml 三段/正则/开关接线
    tg = by_type(g["nodes"], "TextGenerate")
    if len(tg) != 1 or tg[0]["id"] != 26:
        errs.append("TextGenerate[26] 应恰 1")
    else:
        if tg[0]["widgets_values"] != TG_WV:
            errs.append(f"TextGenerate 参数漂移: {tg[0]['widgets_values']}")
        if m_links[tg[0]["inputs"][0]["link"]][1] != 12:
            errs.append("TextGenerate.clip 上游应 PE CLIPLoader[12]")
    fmt = by_type(g["nodes"], "StringFormat")
    if len(fmt) != 1 or fmt[0]["widgets_values"] != ["{a}{b}{c}"]:
        errs.append("StringFormat {a}{b}{c} 应恰 1")
    psm = {n["id"]: n["widgets_values"][0] for n in by_type(g["nodes"], "PrimitiveStringMultiline")}
    if psm.get(21) != A_SEG:
        errs.append("a 段(官方 i2i 系统提示词 chatml)漂移")
    if psm.get(22) != B_SEG:
        errs.append("b 段(原始用户词/指令)漂移")
    if psm.get(23) != C_SEG:
        errs.append("c 段(assistant+<think> 预填)漂移")
    rx = by_type(g["nodes"], "RegexExtract")
    if len(rx) != 1 or rx[0]["id"] != 27:
        errs.append("RegexExtract[27] 应恰 1")
    else:
        wv = rx[0]["widgets_values"]
        if wv[1] != REGEX or wv[2] != "First Group" or wv[5] is not True:
            errs.append("RegexExtract pattern/mode/dotall 漂移")
        if m_links[rx[0]["inputs"][0]["link"]][1] != 26:
            errs.append("RegexExtract 上游应 TextGenerate")
    sw = m_nodes[15]
    if sw["type"] != "ComfySwitchNode" or sw["widgets_values"][0] is not False:
        errs.append("[15] PE 开关默认应 false(直写)")
    if m_links[sw["inputs"][0]["link"]][1] != 22:
        errs.append("PE 开关 on_false 应原始用户词 [22]")
    if m_links[sw["inputs"][1]["link"]][1] != 27:
        errs.append("PE 开关 on_true 应 RegexExtract [27]")
    if m_links[m_nodes[HOST_ID]["inputs"][4]["link"]][1] != 15:
        errs.append("宿主.指令 上游应 PE 开关 [15]")

    # 16 多图双通道:合批喂 PE(看全图);宿主 image_1/image_2 ← 两预缩(编码器吃选图)
    batch = by_type(g["nodes"], "BatchImagesNode")
    if len(batch) != 1 or batch[0]["id"] != 25:
        errs.append("BatchImagesNode[25] 应恰 1")
    else:
        wired = [i for i in batch[0]["inputs"] if i.get("link")]
        ups = {m_links[i["link"]][1] for i in wired}
        if len(wired) < 2 or ups != {16, 17}:
            errs.append("合批应接 ≥2 路(两预缩图,PE 看全图)")
        if m_links[14][3] != 26:
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

    # 17 latent 双路(默认跟随 image_1)
    pb = by_type(g["nodes"], "PrimitiveBoolean")
    if sorted(n["id"] for n in pb) != sorted([19, LORA_PB_ID]):
        errs.append("PrimitiveBoolean 应恰 2([19] 画幅/[30] LoRA)")
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
    if host["widgets_values"] != [B_SEG, DEFAULT_TYPE, False]:
        errs.append("[40] 宿主 widgets_values 应=[官方换装例句, 人物, False]")
    if [i["name"] for i in host["inputs"] if "widget" in i] != ["指令", "型选择", "RGBA透明开关"]:
        errs.append("[40] 宿主面板 widget 型输入应为 指令+型选择+RGBA透明开关(槽序)")
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
    # 子图开关恰 1(RGBA);StringConstant 恰 3(锁层A+RGBA头尾);画幅联动件零移植
    switches = [n for n in sg["nodes"] if n["type"] == "ComfySwitchNode"]
    if sorted(n["id"] for n in switches) != [RGBA_SW_ID]:
        errs.append(f"子图开关应恰 1 枚(RGBA;提示词开关在外=主图[15]),得 {[n['id'] for n in switches]}")
    for banned in ("RegexExtract", "ComfyNumberConvert", "ComfyMathExpression"):
        if any(n["type"] == banned for n in sg["nodes"]):
            errs.append(f"子图不应有 {banned}(画幅联动行不移植)")
    sconsts = [n for n in sg["nodes"] if n["type"] == "StringConstant"]
    if sorted(n["id"] for n in sconsts) != sorted([LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID]):
        errs.append(f"子图 StringConstant 应恰 3 枚(锁层A+RGBA头尾),得 {[n['id'] for n in sconsts]}")

    # 20 真源互锁:锁层A 恒挂逐字=库;干跑默认装配逐字=指令+人物BASE+锁层A;懒执行
    if i_nodes[LOCK_ID]["widgets_values"][0] != truth["const_a"]:
        errs.append("[110] 通用锁层常量A 与库首节常量不逐字一致")
    lock_link = i_links[i_nodes[LOCK_ID]["outputs"][0]["links"][0]]
    if lock_link["target_id"] != CONCAT2_ID:
        errs.append("[110] 应恒挂直连拼接②(不随型走开关)")
    if _qi21_base_text(DEFAULT_TYPE) != truth["types"][0]["constant_text"]:
        errs.append("干跑 BASE(qi21_bases.json 人物)与 05 库人物型②层装配不逐字一致")
    reach_int, assembled = _dry_run_default(g, sg)
    if BASE_ID not in reach_int or LOCK_ID not in reach_int:
        errs.append(f"干跑:默认态应含 [{BASE_ID}]底座/[{LOCK_ID}]锁层,得 {sorted(reach_int)}")
    for nid in (RGBA_HEAD_ID, RGBA_TAIL_ID, RGBA_CAT1_ID, RGBA_CAT2_ID, TE_RGBA_ID):
        if nid in reach_int:
            errs.append(f"干跑:默认态 [{nid}] 不应可达(RGBA 懒执行旁路)")
    want_assembly = "\n".join([B_SEG, _qi21_base_text(DEFAULT_TYPE), truth["const_a"]])
    if assembled != want_assembly:
        errs.append("干跑:默认装配全文 ≠ 指令+人物BASE+锁层A 组合(逐字)")
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
    if i_links[rgba_sw["inputs"][1]["link"]]["origin_id"] != TE_RGBA_ID:
        errs.append("[144] on_true 应 RGBA 编码 [143]")

    # 22 子图输出接线:positive/negative→KSampler;prompt→[28] 预览;latent→[20] 画幅开关
    if [o["name"] for o in sg["outputs"]] != ["positive", "negative", "prompt", "latent"]:
        errs.append("子图输出应为 positive/negative/prompt/latent")
    pv = m_nodes[PREVIEW_ID]
    if pv["type"] != "easy showAnything" or m_links[pv["inputs"][0]["link"]][1] != HOST_ID:
        errs.append(f"[{PREVIEW_ID}] 应为 easy showAnything 且接 [40] prompt 输出")

    # 23 说明 Note 必含要点
    note = m_nodes[NOTE_ID]["widgets_values"][0]
    for token in ("生修合一", "指令=改什么", "指令即主体", "cfg 恒 1", "步数 40",
                  RGBA_HEAD_EN, RGBA_TAIL_EN, RGBA_HEAD_ZH, "qwen-image-2-1-prompter",
                  "05-道劫规范提示词库.md", "MyQi21DaojieBase", "LoraLoaderModelOnly",
                  "Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors", "steps 调 4",
                  "TE-Speed 槽不在本件", "BatchImagesNode", "TextGenerate",
                  "ImageScaleToTotalPixels", "画幅随输入图", "qi21_daojie_i2i_0924.py"):
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


def preflight(old: dict) -> str:
    """守卫:现文件必须是本脚本产物形(装配子图+核心 PE 链+LoRA 槽),否则拒写。"""
    types = {n["type"] for n in old.get("nodes", [])}
    sg_types = set()
    for sg in old.get("definitions", {}).get("subgraphs", []):
        sg_types |= {n["type"] for n in sg.get("nodes", [])}
    if not ("TextGenerate" in types and "BatchImagesNode" in types
            and "LoraLoaderModelOnly" in types and "MyQi21DaojieBase" in sg_types):
        sys.exit("拒写:现文件非本脚本产物形(缺 装配子图/核心 PE 链/LoRA 槽 三锚之一;"
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
          f"机制=生修合一(图输入即指令编辑,零 denoise 重绘);edit 骨架保留"
          f"(PE-I2I 核心链默认旁路/双图预缩 1.5+1.0MP/BatchImages 双通道/latent 双路);"
          f"九型装配移植(MyQi21DaojieBase combo 经宿主面板外露默认人物,锁层A 恒挂,"
          f"指令占①层+BASE+锁层A 换行分层,RGBA 官方公式默认旁路);LoRA 加速槽在位"
          f"(LoraLoaderModelOnly name 预填 viggle r64,默认旁路);TE-Speed 槽不在场;"
          f"steps=40/cfg1/denoise1/fixed;干跑默认装配逐字=指令+人物BASE+锁层A;"
          f"双向/横向(恒向右+顶通道 Reroute)/三行排版/零重叠/group int+预算"
          f"(主3·子3,各框单一阶段行)/子图 linkIds 逐项登记/懒执行旁路/零孤儿全绿")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
