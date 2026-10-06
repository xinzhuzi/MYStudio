# 实弹记录 · 第 9/9 型「概念气氛图」(type-9-概念气氛图)

**结果:✅ 机器判据全绿**(权威后核 `postcheck_type.py type-9-概念气氛图` exit=0,**18/18 项**——本型 rgba_default=false 非透明型,无透明四角门;判据明细见 §7;驱动器自身 exit=1,唯一红项=§8① 已知 is_changed 假红,与 2/7/8 型拍同款,非判据红)

- 日期:2026-10-06(排队 13:24:32 → 终态 13:31:40 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,本 run 实测 ps 在跑=FACTS §4.3 同一进程;comfyui 0.38.0/python 3.12.7/mps)——**复用现役,非本 run 所起(engineStartedByUs=false)**;发射前队列空(queue_running/pending 均 0,raw engine.precheck.queueAtStart)
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,根节点 20,与 FACTS §1/型 7/8 拍同版;驱动 S4 装载即此版)
- 主体句:173 字,md5 `8789b0349ae77464e925aa1d9a706b89`——三源逐字一致(docs/prompts/道劫_九型主体句示例.md §9 代码块(节题「## 9. 概念气氛图(16:9/21:9,重留白)」)/ /tmp/qi21-ninetype-1004/ninetype_driver.mjs:59-60(FACTS §2 出处,idx:9 条目 subject)/ /tmp/qi21-subject-type9.txt 驱动输入件;程序化抽取+三源相等比对 True)
- prompt_id:`aae7ec8e-c170-4617-b2b6-90fcb31fddc2`;client_id:`qi21-9xing-9-1791264272047`;入队序号 number=24
- **与保存态偏差:无**——恰两处改动=任务书恰许的两处(型选择/主体句);seed=0 保存态未动(概念气氛图句 173 字为首用输入,PE 链输入改变→22/30 节点新鲜执行含 6:4013 PE 改写本拍新鲜推理,零缓存回声,§7)
- **本拍取代注记(引文外)**:本 run 前同日 12:33 曾有一发 App 画布扫场拍(`app_sweep_7to10.mjs`,pid 2bb4e36f-19bc-4375-8468-c621480593ab)落位同名文件——该拍仅置「型选择=概念气氛图」、[400] 主体句保持画布保存态=**§1 人物句(147 字)错配**(旧 history 实读 [400] value 头=「一位筑基后期的年轻女修，青玉色道袍束月白腰带…」),不满足本任务书「主体句=FACTS 该型出处原句」要件;其 history 存档已备份 `runs/type-9-概念气氛图.history.appcanvas-sweep-1233.bak`(引擎侧原图 QI21道劫文生图__00114_.png / MYStudio-2K_00035_.png 仍在引擎 output 可取),同名 history/图文件由本拍(规范拍)覆盖。

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;出处=道劫_九型主体句示例.md §9 代码块原文逐字=FACTS §2 出处 ninetype_driver.mjs:59-60;173 字,md5 8789b0349ae77464e925aa1d9a706b89)

```
千年一次的灵潮涨落之夜，悬浮的碎裂古殿群沐浴在夜色与灵光中，殿瓦飞檐敷压沉一档的青蓝色、檐角悬旧金铃铎，万千萤火状灵尘随气流缓缓升腾，暖金与朱红双色的灵光染亮殿群四周的夜雾，粒尘辉光聚于殿群与灵光带，山间平涂区保持干净平滑，全图多色相并陈、受控中等饱和；画面九成留给静谧的蓝灰夜空与雾，只余殿群一角与一株横生孤松的剪影，全色相并陈，受控中等饱和。
```

### ② PE 改写输出([6:4013].positive_prompt 经 [6:4021] 选定入装配;PE启用?=true 保存态;共 4751 字、13 行英文多段体;md5 fb65e60d3884c6fbde91e8f8aae940e6)

> **溯源标注(引文外)**:本段为**本拍新鲜推理**——6:4013 在本拍新鲜执行名单(22/30 节点新鲜;缓存件=加载器类 8 件)。本段按「BASE 188 字逐字对拍真源(qi21_bases.json 概念气氛图条 positive_text)」从装配终稿定界切出(§8②:驱动器 R.prompts.peRewrite 字段仅截首行,非全段)。[6:4020] PE思考预览件不随 history outputs 回放(outputs 键=[8,401,504,505],thinkLen=0;§8③)。

```
A vertical fantasy landscape shows an ancient East Asian architectural complex suspended high above mist-filled clouds and distant mountains at night. The upper portion is dominated by a vast deep blue-gray sky, graded from very dark navy at the top to cooler blue-gray tones near the horizon, with soft layered cloud bands, faint stars, subtle speckled cosmic textures, and sweeping cloudy nebula-like formations. Near the left-center horizon, a slim crescent moon glows pale white-blue just above the cloud line, partially surrounded by diffused moonlight and mist. Small golden and vermilion star-like points and ember-like particles are scattered throughout the sky, especially around the structures below, creating a magical nocturnal atmosphere.

On the far left edge, a large windswept pine tree grows from a dark rocky cliff. Its trunk leans diagonally upward from the lower-left corner, with rough dark bark and twisting branches extending horizontally toward the center. The foliage is dense, irregular, and shadowed, nearly black-green against the dim sky, functioning as a strong foreground silhouette. Beneath it, the cliff face is steep, jagged, and textured with cracks, ledges, and deep shadows, colored in dark charcoal, muted brown, and bluish gray.

Across the lower middle and right side, a fragmented cluster of traditional pagoda-style buildings floats or perches on a massive suspended stone-and-wood platform. The architecture features layered curved tiled roofs with upturned eaves, ornate ridge ornaments, carved beams, balconies, columns, railings, stairways, and illuminated wooden interiors. The largest building sits near the center-right, occupying roughly the lower third of the image, with warm amber light glowing from within its rooms and windows. Its roof tiles are rendered in a cyan-blue tone with ridged texture, while the trim is accented by reddish-brown and gilded highlights. Several smaller pavilions and attached structures extend to the left and right, connected by narrow walkways, stairs, and elevated bridges. Red banners or draped fabric strips hang from some corners and poles, subtly catching the warm light.

Golden bells hang from the eaves of multiple rooftops, including a prominent dangling bell under the central roof’s right-facing overhang and several smaller bells along the extended pavilions. They appear metallic, polished, and warm bronze-gold, catching highlights from the surrounding glow. Numerous tiny luminous particles, sparks, and floating flecks surround the buildings, particularly beneath the roofs and along the right side, forming swirling trails of warm orange-gold and vermilion energy. These light particles vary in size from pinpoints to small glowing dots, with some clustered densely near the architecture and others drifting upward into the sky. Their motion-like arrangement suggests wind, magic, or embers carried by the night air.

The platform beneath the buildings consists of broken stone slabs, timber supports, carved columns, exposed beams, latticework, and weathered architectural fragments. The surface appears uneven and ancient, with chipped edges, gaps, stacked planks, ropes or cables stretching between sections, and debris-like protrusions hanging downward. The underside descends into darkness, where shadowed rock and structural remnants fade into mist. At the bottom center, translucent waterfalls pour from the floating cliff face into the clouds below, rendered as pale blue-white streams with soft streaks and droplets, giving the suspended platform a dreamlike levitating quality.

In the background behind the main structure, distant mountain silhouettes rise through thick layers of fog. The mountains are softly blurred and desaturated, colored in cool blue-gray and pale gray, with their peaks emerging from cloud banks. Atmospheric haze fills the valley areas, and the lighting creates a strong contrast between the cold moonlit environment and the warm architectural illumination. The overall composition places the dark tree and cliff on the left as a framing element, the glowing temple complex in the lower-right as the focal point, and the expansive starry sky above as a dramatic sense of scale.

The image is a highly detailed digital fantasy illustration with cinematic lighting, realistic material rendering, and painterly atmospheric effects. It uses a vertical composition, a slightly low-to-mid vantage point looking across the floating ruins, and a cool blue night palette contrasted by warm gold and vermilion highlights. The style combines xianxia-inspired fantasy architecture, ancient Chinese pavilion forms, ethereal mountain scenery, volumetric fog, luminous particle effects, and epic environmental concept-art detail.
```

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 5680 字 = PE 扩写 4751 + 1 换行 + 型底座 BASE 188(逐字=qi21_bases.json 概念气氛图条 positive_text,md5 c128e35601d52f9216b0af31ac31e2ab) + 1 换行 + 锁层A 739;md5 90f0d4e29c7400232cb8d5d476471146)

```
A vertical fantasy landscape shows an ancient East Asian architectural complex suspended high above mist-filled clouds and distant mountains at night. The upper portion is dominated by a vast deep blue-gray sky, graded from very dark navy at the top to cooler blue-gray tones near the horizon, with soft layered cloud bands, faint stars, subtle speckled cosmic textures, and sweeping cloudy nebula-like formations. Near the left-center horizon, a slim crescent moon glows pale white-blue just above the cloud line, partially surrounded by diffused moonlight and mist. Small golden and vermilion star-like points and ember-like particles are scattered throughout the sky, especially around the structures below, creating a magical nocturnal atmosphere.

On the far left edge, a large windswept pine tree grows from a dark rocky cliff. Its trunk leans diagonally upward from the lower-left corner, with rough dark bark and twisting branches extending horizontally toward the center. The foliage is dense, irregular, and shadowed, nearly black-green against the dim sky, functioning as a strong foreground silhouette. Beneath it, the cliff face is steep, jagged, and textured with cracks, ledges, and deep shadows, colored in dark charcoal, muted brown, and bluish gray.

Across the lower middle and right side, a fragmented cluster of traditional pagoda-style buildings floats or perches on a massive suspended stone-and-wood platform. The architecture features layered curved tiled roofs with upturned eaves, ornate ridge ornaments, carved beams, balconies, columns, railings, stairways, and illuminated wooden interiors. The largest building sits near the center-right, occupying roughly the lower third of the image, with warm amber light glowing from within its rooms and windows. Its roof tiles are rendered in a cyan-blue tone with ridged texture, while the trim is accented by reddish-brown and gilded highlights. Several smaller pavilions and attached structures extend to the left and right, connected by narrow walkways, stairs, and elevated bridges. Red banners or draped fabric strips hang from some corners and poles, subtly catching the warm light.

Golden bells hang from the eaves of multiple rooftops, including a prominent dangling bell under the central roof’s right-facing overhang and several smaller bells along the extended pavilions. They appear metallic, polished, and warm bronze-gold, catching highlights from the surrounding glow. Numerous tiny luminous particles, sparks, and floating flecks surround the buildings, particularly beneath the roofs and along the right side, forming swirling trails of warm orange-gold and vermilion energy. These light particles vary in size from pinpoints to small glowing dots, with some clustered densely near the architecture and others drifting upward into the sky. Their motion-like arrangement suggests wind, magic, or embers carried by the night air.

The platform beneath the buildings consists of broken stone slabs, timber supports, carved columns, exposed beams, latticework, and weathered architectural fragments. The surface appears uneven and ancient, with chipped edges, gaps, stacked planks, ropes or cables stretching between sections, and debris-like protrusions hanging downward. The underside descends into darkness, where shadowed rock and structural remnants fade into mist. At the bottom center, translucent waterfalls pour from the floating cliff face into the clouds below, rendered as pale blue-white streams with soft streaks and droplets, giving the suspended platform a dreamlike levitating quality.

In the background behind the main structure, distant mountain silhouettes rise through thick layers of fog. The mountains are softly blurred and desaturated, colored in cool blue-gray and pale gray, with their peaks emerging from cloud banks. Atmospheric haze fills the valley areas, and the lighting creates a strong contrast between the cold moonlit environment and the warm architectural illumination. The overall composition places the dark tree and cliff on the left as a framing element, the glowing temple complex in the lower-right as the focal point, and the expansive starry sky above as a dramatic sense of scale.

The image is a highly detailed digital fantasy illustration with cinematic lighting, realistic material rendering, and painterly atmospheric effects. It uses a vertical composition, a slightly low-to-mid vantage point looking across the floating ruins, and a cool blue night palette contrasted by warm gold and vermilion highlights. The style combines xianxia-inspired fantasy architecture, ancient Chinese pavilion forms, ethereal mountain scenery, volumetric fog, luminous particle effects, and epic environmental concept-art detail.
一幅以气氛为主的画面，主体落在画面偏侧。细墨线只勾近处轮廓，运笔有提按顿挫，线随结构时粗时细；墨色浓淡分明，远处交给淡墨，层层退远，整体对比低。色彩层次承担画面呼吸，远景轻轻压住，近处轮廓清楚而细节少；底色浅净，少数焦点色可二到三色相，青绿、赭石、淡朱各安其位，受控饱和；均匀柔光，平涂的底。
概念气氛设色配比：大面积淡墨、青灰为稳定基底，青绿、赭石、淡朱二到三色相作焦点色。
风格底座：现代修仙游戏的数字绘画资产（modern Chinese illustration）——中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、服饰、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术，不是把一幅古画直接搬进游戏。媒介：现代数字绘画完成度的 2D 传统绘画语言——连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明，干净空灵，清晰视觉焦点。底色：浅净哑光平涂底的完成度，多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位），保证可读性。画面保持干净平滑：墨与色落在平涂色场上，而非有纹理的纸面。工笔线条质量：连续铁线描；曲线自然顺滑，直线笔直稳定；线宽连续且有节奏，转折、衔接与起收笔干净；细稳基调上转折处轻重提按，墨线带手绘笔性，防机械勾边与矢量感。线描优先工笔结构：100% 视图下，脸部、手部、发丝、衣边、缝线、褶皱、配件和武器构造须先于上色或 shading 从连续纪律性 linework 保持可读。用白描/铁线描加薄透矿物罩染、反复轻分染与罩染建模；保持浅净平涂底面在层间呼吸。浅净哑光底须在每层色罩下保持可见，除非是刻意的墨线、紧凑发块或来源事实要求的深色主体（如尚黑阵营的甲胄旗纛）。成片质量：生产级最终画面清晰度——强制降噪泥糊 AI 伪影；边缘锐利但不产生过锐光晕；表面干净可读；颜料层纯净均匀。默认表面须保持干净精致：只用纯净罩染与克制的矿物颗粒。岁月、风霜或战痕仅在来源事实要求时作克制的叙事线索，须次要、不抢戏。电影级成片质量指干净的可读性与精致的工艺清晰度。
```

### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,负向文本仍在链生成并预览,采样端不消费——[7016] Note 口径)

> **构成标注(引文外)**:共 200 字,以「, 」连接两段——首段=概念气氛图型负面 14 字(真源 qi21_bases.json 概念气氛图条 negative_text 逐字,程序化核对 neg.startswith=True;内容=通用四禁令短串,九型中最短型负面);次段=锁层负面 184 字(美学禁令串)。[404] 负向主体句保存态空(history 回读 value=""),主体句负面第三源为空段(与保存态一致)。

```
模糊，水印，多手指，文字错误, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
```

## 2. 时间账

| 事件 | 时刻 |
|---|---|
| graphToPrompt 干跑+投前断言 10 项全绿 | 13:24:32 CST(2026-10-06T05:24:32.046Z) |
| POST /prompt 受理(tQueue) | 2026-10-06T05:24:32.047Z |
| 进入 running(tRunningSeen) | 2026-10-06T05:24:32.059Z(排队等待≈12ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06T05:30:04.190Z(13:30:04 CST) |
| 2K 落盘(引擎侧 mtime) | 2026-10-06T05:31:37.378Z(13:31:37 CST) |
| 终态 success(tDone) | 2026-10-06T05:31:40.168Z |

**排队→出图 = 7.14 分钟**(durationMin 实测;直出 +5.54min、2K +7.09min;含 PE 9B 模型新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大;预算 38min 帽内,任务书 45min 帽内)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode;路由 latent_funacc←[7:7013]) | 保存态 |
| seed | **0**([7:7014].inputs={"value": 0};[7:7013].seed=["7:7014",0] 连线) | **=保存态,未动** |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,model=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors,无外接采样器参数) | 档0 口径(FACTS §1 档位表);7010(cfg4/40步)、7012(cfg1/6步)在图未选 |
| 分辨率 | **1712×2560 直出(2:3 竖幅,4.39MP)/ 2048×3062 2K**;[4].width/height=["4018",0/1] 连线驱动;[4015].resolution=1024 | 画幅听 PE 建议(PE启用=true⇒[4018] 联动);doc §9 节题标注「16:9/21:9」为文档建议口径,本拍 PE 建议 2:3 竖幅(1712/16=107、2560/16=160 网格整),两口径差异如实记档(§8④);机制链(wh_ratio→/16 网格)引用 2 型 §8⑤ 定谳,分辨率本身=PIL 双图实测 |
| 透明 | 跟型=false([6:4010].透明覆盖=false+rgba_default=False 真源同)→**无透明头句/尾缀注入**(程序化探测「这是一张带有透明度的RGBA图像」/「该图像具有alpha通道」均不在终稿) | 非透明型,无透明门(§8⑤) |
| PE | [6:4013] QwenImage21_T2IPromptRewrite(temp=1.0/top_p=0.95/top_k=20/presence_penalty=1.5/max_new_tokens=16256/seed=42;clip=[6:4019] qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16,缓存加载件) | 输出=本拍新鲜改写(§1②) |
| 负向编码 | [4015].negative_prompt=""(主 TE 侧空);型负面经 [6:4014]→[4016] 负编码口(§1③′) | 档0 采样端不消费负向 |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 引擎侧原文件(mtime) |
|---|---|---|---|---|
| [8] 直出 | `images/type-9-概念气氛图.direct.png` | 7935560 | 1712×2560 RGBA | QI21道劫文生图__00118_.png(2026-10-06T05:30:04.190Z) |
| [504] 2K | `images/type-9-概念气氛图.2k.png` | 10648626 | 2048×3062 RGBA | MYStudio-2K_00039_.png(2026-10-06T05:31:37.378Z) |

(2K=SeedVR2 短边2048 放大;1712×2560→2048×3062,2:3 竖幅保持。四角 alpha 后核实测:直出 [255,255,255,254] / 2K [255,255,255,215]——夜空满幅绘到边,与 rgba_default=false 非透明型一致,§8⑤。)

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 76-78,原文逐字;全量JSON 行 6571 字符见存档)

```
[MY出图][入队][2026-10-06 13:24:32] number=24 prompt_id=aae7ec8e-c170-4617-b2b6-90fcb31fddc2
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetenso… ×1.0 | KSampler: seed=['7:7014', 0] cfg=1.0 steps=6 sampler=euler scheduler=simple denoise=1.0 | KSampler: seed=['7:7014', 0] cfg=4.0 steps=40 sampler=euler scheduler=simple denoise=1.0
```

(摘要行为**源日志行逐字全文**——行内「safatenso… ×1.0」的省略号是引擎侧日志钩子对 LoRA 文件名的原生截断,在源行内,非本记录截断;与 1/2/7/8 型拍摘要行同形(该行不含提示词内容)。[全量JSON] 行 6571 字符全文见 `logs/type-9-概念气氛图.image-prompts.excerpt.log`。)

## 6. 与保存态偏差

**无。**两处改动恰为任务书允许的两处:

1. 型选择:人物→**概念气氛图**([6] 宿主面板 widget;投前排队图断言 [6:4010].base=「概念气氛图」✓;型底座 BASE 188 字逐字进装配 §1③)。
2. 主体句:[400] value→**概念气氛图 canon 173 字**(逐字,md5 对拍✓)。

其余全保存态:PE启用?=true / 透明未动([6:4010].透明覆盖=false) / 速度档位=0 · Fun-Acc 4步 / seed=0 / [404] 负向主体句空——改前读回(host6=["人物",true]→型选择置值,host7=["0 · Fun-Acc 4步",0])改后读回逐项一致(driver S7 五读回门全绿)。**无破缓存需要**:概念气氛图句为首用输入→PE 链输入改变→22/30 节点新鲜执行(含 6:4013/6:4011/6:4014 装配链与 7:7013 采样链),真渲染,零缓存回声(§7)。

## 7. 机器判据(后核 `verify/type-9-概念气氛图.postcheck.json`,exit=0,18/18)

| 判 | 项 | 实测 |
|---|---|---|
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=aae7ec8e-c170-4617-b2b6-90fcb31fddc2 |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=8/30(加载器类;6:4013 PE 改写本拍新鲜) |
| ✅ | seed 回读=[7:7014] | {"value": 0} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,504 |
| ✅ | 产物图存在且>0字节([8] type-9-概念气氛图.direct.png) | 7935560B |
| ✅ | PNG 魔数([8]) |  |
| ✅ | PNG 可解析(PIL,[8]) | RGBA 1712×2560,metaLen=12412,cornerAlpha=[255,255,255,254] |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12412 |
| ✅ | 产物图存在且>0字节([504] type-9-概念气氛图.2k.png) | 10648626B |
| ✅ | PNG 魔数([504]) |  |
| ✅ | PNG 可解析(PIL,[504]) | RGBA 2048×3062,metaLen=12412,metaMd5=a995bd329728f037b3672a1411daccbf,cornerAlpha=[255,255,255,215] |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12412 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=5680 negLen=200 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:76 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:76 起 3 行 |

(无透明四角门——本型 FACTS §2 rgba_default=false,任务书透明加验条件不成立;后核按非透明型 18 项判。)

## 8. 勘误与标注(工具链,不影响判据)

- **① 驱动器原始终判红=2/7/8 型 §8① 同款收割 bug 假红**:驱动器内嵌「PNG 元数据=history prompt」比对不剥节点级 `is_changed` 缓存指纹(pngMd5=0500ffc4…≠histMd5=ecf07220…)→其终判 ok=false/真实 exit=1(console log 末行 DRIVER_EXIT=1);权威判据=后核剥指纹后稳态同比对(§7 表「剥 is_changed 指纹」行✅,唯一差异域=6:4010,与 1/2/7/8 型同)。驱动 raw 数据域(时间账/读回/断言/收据/图)全绿可用,本记录全部引证自 raw 与后核。
- **② R.prompts.peRewrite 只含装配首行**(driver 取 finalPos.split("\n")[0]):本拍 PE 扩写为多行体(4751 字),§1② 改用「BASE 188 字逐字对拍真源」从装配终稿定界切出完整段引用并记 md5 fb65e60d3884c6fbde91e8f8aae940e6。
- **③ [6:4020] PE思考预览不随 history outputs 回放**(outputs 键=[8,401,504,505],thinkLen=0):与 00:38 E2E 拍及 2/7/8 型拍现象一致,系本代工作流该件 UI 输出回收行为,非本拍缺陷;PE 改写输出溯源=装配前段逐字(§1②)。
- **④ 分辨率机制链引用 2 型 §8⑤ 定谳**(PE wh_ratio→/16 网格取整):本拍未另跑确定性探针(避免额外占用引擎);分辨率事实本身(1712×2560 直出/2048×3062 2K,2:3 竖幅)为 PIL 双图复核**实测**。doc §9 节题「16:9/21:9」为文档侧建议口径,本拍 PE 建议为 2:3 竖幅——两口径差异如实记档,机制归因标注为**引用**。
- **⑤ 非透明口径如实记(引文外)**:任务书透明加验条件=「FACTS 标明本型透明底」——概念气氛图 rgba_default=false(FACTS §2 表),四角 alpha 门**不适用**;后核实录四角(直出 [255,255,255,254]/2K [255,255,255,215])不透明,与「画面九成留给静谧的蓝灰夜空与雾」满幅夜空绘到边的设计一致,数字俱录不隐。
- **⑥ 本拍取代 App 画布扫场拍**(见头部取代注记):规范判据全部基于本拍 pid aae7ec8e;sweep 拍仅作历史存档(.bak)。

## 9. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-9-概念气氛图.image-prompts.excerpt.log` | 源 image-prompts-20261006.log 行 76-78(入队+摘要+全量JSON 6571 字符) |
| ② PNG 元数据 | `verify/type-9-概念气氛图.png-prompt-metadata.json` | tEXt prompt(12,412B,30 节点,剥 is_changed 后与 history 稳态同;metaMd5=a995bd329728f037b3672a1411daccbf) |
| ③ history prompt JSON | `runs/type-9-概念气氛图.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-9-概念气氛图.json` | 断言 10 项/读回前后/改动两笔/时间账(终判红=§8①假红) |
| 驱动控制台 | `logs/type-9-概念气氛图.driver.console.log` | 全程日志(真实 DRIVER_EXIT=1=§8①假红) |
| 后核 | `verify/type-9-概念气氛图.postcheck.json` | 机器判据权威判(18/18,exit=0) |
| 产物图 | `images/type-9-概念气氛图.direct.png` / `images/type-9-概念气氛图.2k.png` | §4 |
| 主体句 canon | /tmp/qi21-subject-type9.txt(临时)+ 本记录 §1① 全文引 | 173 字 md5 8789b0349ae77464e925aa1d9a706b89 |
| PE 扩写全文 | 本记录 §1② 全文引(+ /tmp/t9-pe-full.txt 临时件,md5 fb65e60d3884c6fbde91e8f8aae940e6) | 4751 字 |
| sweep 拍存档 | `runs/type-9-概念气氛图.history.appcanvas-sweep-1233.bak` | 被取代的 App 画布扫场拍(12:33,主体句错配=§1 人物句) |
