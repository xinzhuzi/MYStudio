# 02 · ComfyUI 侧增强与官方模板实录

> **一句话结论**:在 ComfyUI 里,「提示词增强」是生成管线之外的可选外挂——官方两条模板不内嵌任何 PE 节点(实证零命中),自带的是两条按宪法手写的成品示范提示词;社区插件(benjiyaya/ComfyUI-Qwen-Image-2.1-Prompt-Enhancer)用原生 CLIPLoader 把 PE 9B 当文本编码器跑自回归改写,随包两份系统提示词与官方原文**逐字节一致**(本轮 diff/cmp/MD5 三重复验全过)。

- 证据基准日:2026-09-23。
- 原文档案:`.trellis/tasks/09-23-qwen-image-21-research/research/`(下称 `research/`);插件三件 = `research/pe_plugin_/pe_plugin_prompt_rewrite_nodes.py`(下称 `nodes.py`)+ 随包两份系统提示词,`research/pe_node_readme.md` 为插件 README。
- 本文标注「本轮实测」的命令均在 2026-09-23 由本任务实际执行;官方 vLLM 参数口径实读自 `research/pe_prompt_rewrite_readme.md`(= 官方 prompt_rewrite README 存档)。

---

## 1. 结论速览

1. **官方模板不含 PE**:两条官方模板(文生图 / 图像编辑)的节点类型全集(根层 + 子图)没有任何 PE / enhancer / rewrite 节点;模板默认提示词是官方手写的示范,不是 PE 产物。
2. **插件忠实度 = 逐字节**:插件随包 `system_prompt_t2i.txt` / `system_prompt_edit.txt` 与官方 PE 宪法原文 diff/cmp 零差异、MD5 相同(第 4 节)。
3. **增强是前置文本工序**:PE 节点的产物就是 `positive_prompt`,接回常规 CLIP Text Encode → KSampler,主流线零改动。

---

## 2. 插件机制链路(benjiyaya 插件,逐步有据)

总思路(插件自述,`research/pe_node_readme.md` L30-34):「The prompt enhancer models are Qwen3-VL 8B fine-tunes loaded as text encoders through ComfyUI's native **CLIPLoader** (`type=qwen_image`). Generation runs entirely on ComfyUI's built-in `clip.tokenize()` → `clip.generate()` → `clip.decode()` path — the same mechanism as the built-in TextGenerate node. No external server, no transformers pipeline.」(注:此处“Qwen3-VL 8B”为插件 README 笔误,官方口径是 Qwen3.5-VL 9B,见 `research/pe_prompt_rewrite_readme.md:10`;以官方为准。)

链路七步:

1. **安装**:`git clone` 进 `custom_nodes/`,`NODE_CLASS_MAPPINGS` 注册两节点 `QwenImage21_T2IPromptRewrite` / `QwenImage21_EditPromptRewrite`(nodes.py:335-338;显示名映射 340-343),分类 `CATEGORY = "Qwen Image"`(nodes.py:157/255)。
2. **装检查点**:插件 README 载明的 PE 检查点是 Comfy-Org 打包的 int8(`…_pe_t2i.int8_convrot.safetensors` / `…_pe_i2i.int8_convrot.safetensors`,各 9.47 GB,pe_node_readme.md:9-12)——但 int8 在 MPS 首次矩阵乘即死(`aten::_int_mm` 无 MPS 内核,09-23 实证 pe-mps-fail.txt),本机 T2I 已换自转 bf16 单件 `qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors`(约 19GB;按 int8 件 760 权重键清单从满血 bf16 原版取原值,转换脚本 `apps/build/scripts/qwen21_pe_bf16_convert_0923.py`,int8 旧件已清理)放 `models/text_encoders/`,用 ComfyUI **原生 CLIPLoader**(type=`qwen_image`)当普通文本编码器加载——零新加载器,VRAM 走原生模型管理(pe_node_readme.md:135-136)。
3. **手拼 chat 模板**:节点内手工拼 Qwen 对话格式(nodes.py:24-31):

```python
"<|im_start|>system\n" + system_prompt + "<|im_end|>\n"
"<|im_start|>user\n" + user_text + "<|im_end|>\n"
"<|im_start|>assistant\n"
```

   为什么手拼——源码注释原文(nodes.py:25-26):「Qwen chat format, assembled manually (not via llama_template) because the PE system prompts contain literal braces that the template .format() would eat.」(PE 系统提示词含字面大括号,走模板 `.format()` 会被吃掉。)
4. **编码**:`clip.tokenize(chat, skip_template=True, min_length=1, thinking=True)`(nodes.py:177-182;Edit 版另传 `images=image_list`,并把 `<imageN> <|vision_start|><|image_pad|><|vision_end|>` 按序排在 user 文本前,nodes.py:291-302)。`thinking=True` 硬编码不可关(nodes.py:181/301)。
5. **生成**:`clip.generate(do_sample=True, max_length, temperature, top_k, top_p, min_p=0.0, repetition_penalty=1.0, presence_penalty, seed)`(T2I nodes.py:183-194;Edit nodes.py:303-314)——与 ComfyUI 内置 TextGenerate 同一条原生自回归路径,零外部服务。
6. **拆思考 + 解析 JSON**:`_split_thinking` 按 `</think>` 切出思考迹(nodes.py:111-119);`_balanced_braces` 从后往前扫平衡花括号取最后一个 JSON 对象,`json.loads` 失败再 `json_repair` 兜底,取 `rewritten_prompt`(容错拼错 `rewrited_prompt`)/`wh_ratio`/`ratio_follow`,失败则整段原文当 `positive_prompt` 且 `parse_ok=False`(nodes.py:54-108)。
7. **出参接线**:输出 `positive_prompt` / `negative_prompt`(恒空串,nodes.py:204/324)/ `wh_ratio` /(Edit 多 `ratio_follow`)/ `thinking` / `parse_ok`;`positive_prompt` 接常规 CLIP Text Encode → KSampler(pe_node_readme.md:121-131 工作流图)。

类比:PE 模型在这个插件里不是「新装的发动机」,而是「借用了原厂喷油嘴的另一块 ECU」——加载、显存、推理全部走 ComfyUI 原生机制,插件只贡献对话拼装与 JSON 拆包两段胶水。

---

## 3. 参数对照:插件节点 vs 官方 vLLM 口径

官方口径:`research/pe_prompt_rewrite_readme.md:175-183`(表)+ L185-197(注)。插件侧实读 `nodes.py`。

| 参数 | 官方 t2i | 官方 edit | T2I 节点(nodes.py) | Edit 节点(nodes.py) |
|---|---|---|---|---|
| temperature | 1.0 | 1.0 | 暴露,FLOAT default 1.0 [0,2] step0.05(L140) | 暴露,default 1.0(L239) |
| top_p | 0.95 | 0.95 | 暴露,default 0.95 [0,1](L141) | 暴露,default 0.95(L240) |
| top_k | 20 | 20 | 暴露,default 20 [1,200](L142) | **不暴露**,generate 硬编码 `top_k=20`(L308) |
| presence_penalty | **1.5** | **0** | 暴露,default 1.5 [0,5],tooltip「Should be 1.5 for T2I」(L143-146) | 暴露,default 0.0,tooltip「Should be 0 for Edit」(L241-244) |
| max tokens | 16256 | 24000 | 暴露为 `max_new_tokens` default 16256(L147-149) | 暴露为 `max_length` default 24000(L245-247) |
| thinking | on (required) | on (required) | 硬编码 `thinking=True`(L181) | 硬编码(L301) |
| seed | API 无(离线默认 42) | 同左 | 加 `seed` default 42 求可复现(L150) | 同(L248) |
| min_p / repetition_penalty | 0 / 未提 | 0 / 未提 | 固定 0.0 / 1.0(L190-191) | 固定 0.0 / 1.0(L310-311) |
| do_sample | 采样制 | 采样制 | 固定 `True`(L185) | 固定(L305) |

点评三处:

- **唯一不能乱动的是 presence_penalty**:官方原话「the two values are not interchangeable, and a wrong penalty does not fail loudly」(pe_prompt_rewrite_readme.md:185-187)。插件给两个节点分别预置正确默认值并写进 tooltip,是对官方口径最忠实的落地。
- **命名瑕疵**:同为 max tokens,T2I 节点叫 `max_new_tokens`、Edit 节点叫 `max_length`——插件自身命名不一致,接线时别当成两个参数族。
- **seed 是插件加戏**:官方 API 无 seed(在线同 seed 也不可复现,pe_prompt_rewrite_readme.md:199-207);插件加 default 42 换取图内可复现,属工程便利、不违官方。

---

## 4. 随包系统提示词 vs 官方原文:逐字节一致(本轮实测)

基准:官方原文 = `research/pe_t2i_system_prompt.txt` / `research/pe_i2i_system_prompt.txt`(HF 直下存档,已与 GitHub 官方仓库逐字节校验一致);插件随包 = `research/pe_plugin_/pe_plugin_system_prompt_t2i.txt` / `…_system_prompt_edit.txt`。

本轮(2026-09-23)实际执行的命令与结果:

```bash
diff pe_t2i_system_prompt.txt pe_plugin_/pe_plugin_system_prompt_t2i.txt   # exit 0,零行差异
cmp  pe_t2i_system_prompt.txt pe_plugin_/pe_plugin_system_prompt_t2i.txt   # exit 0,无输出(逐字节相同)
diff pe_i2i_system_prompt.txt pe_plugin_/pe_plugin_system_prompt_edit.txt  # exit 0
cmp  pe_i2i_system_prompt.txt pe_plugin_/pe_plugin_system_prompt_edit.txt  # exit 0
md5  pe_t2i_system_prompt.txt pe_plugin_/pe_plugin_system_prompt_t2i.txt \
     pe_i2i_system_prompt.txt pe_plugin_/pe_plugin_system_prompt_edit.txt \
     official_system_prompt_t2i.txt official_system_prompt_edit.txt
```

MD5 原样输出(行序与命令参数一致,按 T2I/I2I 交错:T2I 组 = HF 直下基准第 1 行 / 插件随包第 2 行 / GitHub 存档第 5 行;I2I 组 = HF 直下基准第 3 行 / 插件随包第 4 行 / GitHub 存档第 6 行——**T2I 三份同为 `a5e1…`,I2I 三份同为 `4932…`**):

```text
MD5 (pe_t2i_system_prompt.txt) = a5e1efc49aad097648079b734969045f
MD5 (pe_plugin_/pe_plugin_system_prompt_t2i.txt) = a5e1efc49aad097648079b734969045f
MD5 (pe_i2i_system_prompt.txt) = 493264f3621269df0f9ff727671fba28
MD5 (pe_plugin_/pe_plugin_system_prompt_edit.txt) = 493264f3621269df0f9ff727671fba28
MD5 (official_system_prompt_t2i.txt) = a5e1efc49aad097648079b734969045f
MD5 (official_system_prompt_edit.txt) = 493264f3621269df0f9ff727671fba28
```

结论:**插件把官方 PE 宪法原样打包,提示词层零改动**。唯一「改编」在工程层——手拼 chat 模板绕开字面大括号问题(第 2 节第 3 步),不动宪法一个字。

---

## 5. 官方模板两条默认提示词逐字全文

出处:官方 ComfyUI 模板 `research/image_qwen_image_2_1_t2i.json` / `research/image_qwen_image_2_1_image_edit.json`,根层子图实例节点 **id=459** 的 `widgets_values_named.prompt`,透传给子图内 `TextEncodeQwenImage21`(t2i 子图内 id=452;edit 子图内 id=474;两处 `negative_prompt` 默认空串)。本轮脚本提取,长度核对:1718 / 378 字符。

**① t2i 模板默认 prompt(1718 字符,完整逐字)**:

```text
Greyscale fashion editorial portrait of an avant-garde woman tilted upwards in profile, captured with striking high-contrast chiaroscuro lighting. She wears oversized, thick-rimmed circular black sunglasses with matte dark lenses, concealing her upward gaze. Her attire merges high couture with tactical abstraction: a high-necked structural dress tailored from heavyweight fabric featuring a disrupted optical camouflage pattern—interlocking oversized polka dots, pixelated stippling, and organic contour blotches in stark monochrome that mimic military disruptive patterns in a refined runway style. Around her shoulders, asymmetric pleated webbing and tailored cargo straps are integrated seamlessly into the garment’s architecture. In her gloved hand, she clutches a structured matte-leather geometric handbag accented with subtle tactical buckles, utility stitching, and dark brushed-metal hardware. Her skin texture is rendered with hyper-detailed clarity, sculpted by intense, razor-sharp studio key light and deep graphite shadows. The striking background is a vivid mixed-media graphic collage, composed of flat vibrant lime green planes, stark black and white overlapping circles, segmented semi-circles with bold zebra striping, dense micro-halftone dot matrices, and vector topographic contour lines. The clash between monochromatic disruptive camo elements on her clothing and the saturated, retro-futuristic pop-art backdrop creates an intense visual dissonance, emphasizing sharp silhouettes, paper cut-out edges, dynamic compositional balance, and clean graphic novel textures. Absolutely no text, no typography, no letters, no words, no numbers, no logos, no watermark, no captions, pure imagery only.
```

**② image_edit 模板默认 prompt(378 字符,完整逐字;配套 LoadImage ×2 = portrait_model_denim.png(→`<image1>`)+ clothing_light_blue_denim_shirt.png(→`<image2>`))**:

```text
Keep the character and pose in <image1> unchanged, put this light blue denim shirt from <image2> on the character, preserve the original facial features, hair, body shape and pose, the denim shirt fits naturally on body, realistic denim fabric texture, natural clothing folds, keep the original background and original lighting, high fashion editorial photography, sharp details
```

两条的性质标注:均为**官方真源**,但是官方模板给「直生图 / 直编辑」预填的默认 prompt——**不是 PE 模型的产物**(模板里没有 PE 节点,见第 6 节)。五件套对位解剖见 01 篇第 8.4 节。

---

## 6. 官方模板不内嵌 PE:节点实证(本轮实测)

本轮用脚本列全两条模板的节点类型(根层 + `definitions.subgraphs`),并 grep PE 关键词:

```text
image_qwen_image_2_1_t2i.json
  根层:        MarkdownNote, ResolutionSelector, SaveImageAdvanced, <子图实例 c291ceec-…>
  子图 'Text to Image (Qwen Image 2.1)':
               CLIPLoader, EmptyLatentImage, KSampler, TextEncodeQwenImage21,
               UNETLoader, VAEDecode, VAELoader
image_qwen_image_2_1_image_edit.json
  根层:        ImageCompare, LoadImage, MarkdownNote, ResolutionSelector,
               SaveImageAdvanced, <子图实例 bc1c967a-…>
  子图 'Image Edit (Qwen Image 2.1)':
               CLIPLoader, ComfySwitchNode, EmptyLatentImage, KSampler,
               QwenImage21Cache, TextEncodeQwenImage21, UNETLoader, VAEDecode, VAELoader
```

- `grep -ioE 'enhancer|promptrewrite|pe_t2i|pe_i2i'` 两文件**零命中**(exit 1,本轮实测)。注意必须带 `-E`:不带时 `|` 在 BRE 下是字面量,该模式对任何文件恒零命中、毫无证明力——本轮拿实含 `pe_t2i` 字样的 `pe_node_readme.md`(`grep -c 'pe_t2i'` = 2)做过对照:裸 `|` 形态零命中(exit 1),加 `-E` 即命中;早期无 `-E` 的命令呈现作废,以本条为准。
- 两模板子图内 CLIPLoader 的 widgets 均为 `['qwen3vl_8b_int8_convrot.safetensors', 'qwen_image', 'default']`——常规文本编码器,非 PE 检查点。

即:官方模板主流线 = LoadCLIP(常规 qwen3vl_8b)→ TextEncodeQwenImage21 → KSampler,一条 PE 链都没有。

---

## 7. 辨析:「增强是外挂,模板默认词即官方手写示范」

把第 5、6 节的事实合起来,官方对「增强」的定位就清楚了:

- **PE 是可选外挂,不是管线内置步**。想在 ComfyUI 用 PE,要么装社区插件(第 2 节链路:PE 9B 当文本编码器图内自回归,产物 `positive_prompt` 再接回 TextEncode),要么在图外跑官方 vLLM 服务,把成品提示词粘进模板的 prompt 框。主流线两种情况都不改。
- **图外 vLLM 路线起手式**(出处:`research/pe_prompt_rewrite_readme.md:137-164`;检查点仓 = HF 的 `Qwen/Qwen-Image-2.1-PE-T2I` / `Qwen/Qwen-Image-2.1-PE-I2I`,原生权重「~20 GB in `bfloat16`」L52-53——注意这与第 2 节 Comfy-Org 打包的 int8(9.47 GB)是**两条不同下载线**,后者只服务插件路线):

```bash
# 离线批量(官方推荐的真活路径;edit 同构:--task edit --ckpt Qwen/Qwen-Image-2.1-PE-I2I)
python run_vllm.py --task t2i \
    --ckpt Qwen/Qwen-Image-2.1-PE-T2I \
    --input data/t2i_example.jsonl --output out.jsonl
# 起服务 + 单发
CKPT=Qwen/Qwen-Image-2.1-PE-T2I PORT=8100 bash serve.sh
# in another shell, once `curl -sf localhost:8100/health` answers:
python client.py --task t2i --model Qwen/Qwen-Image-2.1-PE-T2I \
    --system-prompt Qwen/Qwen-Image-2.1-PE-T2I/system_prompt.txt \
    "a corgi playing guitar in the rain"
```
- **模板自带的两条默认提示词,本身就是「已经增强好的成品示范」**:
  - Greyscale 长文是按 PE-T2I 宪法手写的观察者式描述:单段长文、现在时第三人称、零 masterpiece/8K 质量词、光照显式(「sculpted by intense, razor-sharp studio key light」折入皮肤句)、收尾唯一构图总结句、显式无文字声明——宪法条款逐条兑现(01 篇 8.4 对位)。体量上它是浓缩版(约 227 词/9 句,低于宪法约 20 句/400-500 词),官方没有因为「要示范」就塞满配额。
  - 换装句是按编辑宪法手写的精确编辑指令:锚定 `<image1>` 不变项 → `<image2>` 换装项 → preserve 清单 → 材质/褶皱/背景/光照保持 → 风格收尾。
- **官方用示范告诉你「终点长这样」,把「怎么到终点」留给你**:手写达标(照 01 篇宪法写)或跑 PE(机器代写)都行,模板不预设立场。

一句话:ComfyUI 生态里的「提示词增强」= **生成前的一道可选文本工序**。手写、插件前置、图外 vLLM 三条路,产物都是同一个 `positive_prompt`,进同一个 TextEncodeQwenImage21——增强改的是「喂什么」,不动「怎么画」。

---

## 8. 版本与证据清单

| 证据 | 文件 | 本轮实测 |
|---|---|---|
| 插件源码 344 行 | research/pe_plugin_/pe_plugin_prompt_rewrite_nodes.py | 全文实读,行号引用 |
| 插件随包系统提示词 ×2 | research/pe_plugin_/pe_plugin_system_prompt_t2i.txt / …edit.txt | diff/cmp exit 0;MD5 三份一致 |
| 官方 PE 宪法基准 ×2 | research/pe_t2i_system_prompt.txt / pe_i2i_system_prompt.txt | 同上(另有 official_system_prompt_*.txt GitHub 存档同 MD5) |
| 官方模板 ×2 | research/image_qwen_image_2_1_t2i.json / image_qwen_image_2_1_image_edit.json | 脚本提取 prompt(1718/378 字符)、列节点类型(根层+子图)、grep PE 关键词零命中、查 CLIPLoader widgets |
| 插件 README | research/pe_node_readme.md | 实读(注:L3「Qwen3-VL 8B fine-tunes」与官方 Qwen3.5-VL 9B 矛盾,以官方为准) |
| 官方 vLLM 参数口径 | research/pe_prompt_rewrite_readme.md:175-197 | 实读 |

插件仓库:github.com/benjiyaya/ComfyUI-Qwen-Image-2.1-Prompt-Enhancer(pe_node_readme.md:26);PE 检查点下载:HuggingFace Comfy-Org/Qwen-Image-2.1 `text_encoders/`(pe_node_readme.md:9-12)。行号若随插件更新漂移,以仓库现行版为准重新对账。
