# 实弹记录 · 第 7/9 型「分镜剧情图」(type-7-分镜剧情图)

**结果:✅ 机器判据全绿**(权威后核 `postcheck_type.py type-7-分镜剧情图` exit=0,18/18 项;判据明细见 §7。驱动器自身 exit=1,唯一红项=§8① 已知 is_changed 假红,与 2 型拍同款,非判据红)

- 日期:2026-10-06(排队 12:50:38 → 终态 12:58:11 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,manifest port=17000 实查,comfyui 0.38.0/mps)——**复用现役,非本 run 所起(engineStartedByUs=false)**;发射前队列空(queue_running/pending 均 0)
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,根节点 20,与 FACTS §1 同版;**实弹后真源文件复测未变**=mtime Oct 6 00:35:30/115614B,仓库保存态保持;引擎家 ComfyUI git 0 行改动)
- 主体句:131 字,md5 `0cf065905bb98f958a20cb0b324a80cb`——三源逐字一致(docs/prompts/道劫_九型主体句示例.md:77(§7)/ /tmp/qi21-ninetype-1004/ninetype_driver.mjs:56(FACTS §2 出处)/ /tmp/qi21-subject-type7.txt 驱动输入件;程序化抽取+比对)
- prompt_id:`5b05816c-721e-4d65-a894-1a4d75fbf0d1`;client_id:`qi21-9xing-7-1791262238668`;入队序号 number=22
- **与保存态偏差:无**——恰两处改动=任务书恰许的两处(型选择/主体句);seed=0 保存态未动(分镜剧情图句本身即破缓存:29/30 节点新鲜执行,零缓存回声,§7)
- **本拍取代注记(引文外)**:本 run 前同日 12:19 曾有一发 App 画布扫场拍(`app_sweep_7to10.mjs`,pid 4945120e)落位同名文件——该拍仅置「型选择」、[400] 主体句保持画布保存态=**§1 人物句(147 字)错配**,不满足本任务书「主体句=FACTS 该型出处原句」要件;其 history 存档已备份 `runs/type-7-分镜剧情图.history.appcanvas-sweep-1219.bak`(引擎侧原图 QI21道劫文生图__00112_.png / MYStudio-2K_00033_.png,仍在引擎 output 可取),同名 history/图文件由本拍(规范拍)覆盖。

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;出处=道劫_九型主体句示例.md:77 §7 原文逐字=FACTS §2 出处 ninetype_driver.mjs:56;131 字)

```
山雨欲来的渡口，青年刀修玄色劲装束袖束腰，长发高束马尾，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中，第一次背起行囊离乡；老船工收篙回望，江天压满墨青雨云，渡口一盏朱红灯笼是画面唯一的暖色，两人的目光都投向江雾深处若隐若现的仙山轮廓。
```

### ② PE 改写输出(装配终稿前段全文=[6:4013].positive_prompt 经 [6:4021] 选定入装配;PE启用?=true 保存态;共 5563 字、英文 7 段、段间以空行分隔——PE 模型原生分段;md5 83963f5c0077bd477002a566b12a7a15)

> **溯源标注(引文外)**:本段为**本拍新鲜推理**——6:4013 在本拍新鲜执行名单(29/30 节点新鲜;唯一缓存件=6:4019 PE 模型加载器)。本段按「BASE 473 字逐字对拍真源(qi21_bases.json 分镜剧情图条 positive_text)」从装配终稿定界切出(§8②:驱动器 R.prompts.peRewrite 字段仅截首行 686 字,非全段)。[6:4020] PE思考预览件不随 history outputs 回放(outputs 键=[8,401,504,505],thinkLen=0;§8③)。

```
A cinematic fantasy-style landscape illustration shows a rugged riverside setting beneath a heavy storm sky. Across the upper portion, vast dark clouds fill most of the frame, rendered in layered grays, blue-grays, and charcoal tones with soft glowing breaks where pale sunlight filters through. The cloud texture is dense, turbulent, and volumetric, creating a dramatic sense of approaching rain. In the upper-left and central background, a tall jagged mountain formation rises steeply from mist, its rocky ridges sharply textured and partially veiled by fog. Smaller mountain silhouettes recede into the distance along the left side, forming a hazy valley that opens toward the river.

The middle distance contains a broad river or lake running horizontally through the scene, reflecting muted gray-green light from the sky. Several small sailboats and wooden vessels appear far away on the water, reduced to delicate silhouettes and vertical masts against the mist. Low banks, scattered trees, and fog layers soften the horizon. On the far bank, a multi-tiered East Asian pagoda-like building sits among dark trees and vegetation, its rooflines tiered and angular, colored in subdued browns and grays. The surrounding forest includes dense coniferous and deciduous tree forms, with autumnal muted greens, ochres, and brown leaves blending into the shadowed terrain.

In the foreground, the viewer looks from a rocky stone dock or path beside the water. The ground is made of uneven wet stone slabs with puddles, cracks, moss, grass tufts, and reflective highlights. A large vermilion paper lantern hangs from a dark wooden post near the center-right foreground, slightly left of the main figure. The lantern is cylindrical with rounded caps at top and bottom, ribbed vertical segments, dark metal bands, and a warm orange flame glowing inside. Its vermilion color provides the primary warm accent in the otherwise cool, desaturated palette. Around it are rough wooden planks, posts, ropes, barrels, crates, and weathered dock structures arranged irregularly along the riverbank. Thin smoke or mist curls upward near the lantern and around the trees, reinforcing the damp, cold atmosphere.

The dominant human subject stands in the right-center foreground, shown from behind in three-quarter profile facing toward the distant mountains and river. The person appears to be a young adult East Asian man with a slim-to-athletic build, average height, and light-to-medium skin tone. He has long black hair tied high into a thick ponytail, with loose strands blown sideways by wind. His face is visible in side profile, showing a straight nose, defined jawline, focused eyes, and a serious, contemplative expression. He wears dark, layered, worn travel robes or martial-arts-inspired garments in black and charcoal gray, with a cinched belt and wrapped sleeves. The clothing has a matte, weathered fabric texture with subtle folds, frayed edges, and decorative embroidered-looking trim on the shoulder and back area. A large backpack or bundled gear sack rests on his back, secured with straps, cords, and buckles. Long belts, sashes, and hanging fabric strips trail from his waist, emphasizing movement and wind. At his waist and hip, a short sword with a black shark hide scabbard, brass guard, and gray rope-wrapped handle hangs visibly from the side; the blade is fully sheathed, with metallic highlights along the brass fittings and a narrow, sharp silhouette suggesting a weapon carried for travel or combat.

To the right, near the riverboat, an elderly East Asian man stands partly turned toward the younger traveler. He has a lean, wiry build, deeply wrinkled facial features, gray-white hair tied into a small bun, and a weathered, serious expression. He wears dark ragged clothing with layered, torn sleeves and rough fabric textures. His posture is bent slightly forward as he grips a long pole or oar extending diagonally into the water. The interaction between the two men is quiet and tense: the older man looks toward the younger figure while standing beside the boat, and the younger figure faces away into the landscape, visually separated by the dock space and their opposing orientations.

Behind the older man, a wooden riverboat occupies the lower-right middle ground. It has a dark curved roof with upturned eaves, weathered railings, vertical support beams, and a hull sitting low on the rippling water. The boat’s surfaces appear aged, soaked, and uneven, with dark brown wood and muted black shadows. Reflections shimmer faintly beneath it in the river. The dock edge, posts, and mooring lines connect the boat to the stone path, creating a dense arrangement of practical travel objects.

The overall composition uses strong depth perspective: the stone path leads from the bottom foreground toward the travelers, then across the river toward the misty pagoda and towering mountains. The main figure occupies the right half of the frame, while the mountain peak and storm sky balance the left and upper portions. Lighting is dramatic and directional, with cool ambient storm light from the cloudy sky and a localized warm glow from the lantern. The color grading is cinematic, dominated by desaturated blue-gray, slate, black, deep green, and earthy brown, contrasted by the lantern’s amber-orange light. The image has the appearance of high-detail digital painting or AI-generated fantasy concept art, with realistic environmental rendering, painterly textures, atmospheric haze, and a historical wuxia or xianxia-inspired visual language.
```

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 6777 字 = PE 扩写 5563(7 段) + 1 换行 + 型底座 BASE 473(逐字=qi21_bases.json 分镜剧情图条 positive_text,7 行) + 1 换行 + 锁层A 739;行序=PE 扩写段→空行→型底座(叙事/设色 7 行)→锁层A(风格底座 1 行);md5 def6c734c28f334f8d0933ebb36d848a)

```
A cinematic fantasy-style landscape illustration shows a rugged riverside setting beneath a heavy storm sky. Across the upper portion, vast dark clouds fill most of the frame, rendered in layered grays, blue-grays, and charcoal tones with soft glowing breaks where pale sunlight filters through. The cloud texture is dense, turbulent, and volumetric, creating a dramatic sense of approaching rain. In the upper-left and central background, a tall jagged mountain formation rises steeply from mist, its rocky ridges sharply textured and partially veiled by fog. Smaller mountain silhouettes recede into the distance along the left side, forming a hazy valley that opens toward the river.

The middle distance contains a broad river or lake running horizontally through the scene, reflecting muted gray-green light from the sky. Several small sailboats and wooden vessels appear far away on the water, reduced to delicate silhouettes and vertical masts against the mist. Low banks, scattered trees, and fog layers soften the horizon. On the far bank, a multi-tiered East Asian pagoda-like building sits among dark trees and vegetation, its rooflines tiered and angular, colored in subdued browns and grays. The surrounding forest includes dense coniferous and deciduous tree forms, with autumnal muted greens, ochres, and brown leaves blending into the shadowed terrain.

In the foreground, the viewer looks from a rocky stone dock or path beside the water. The ground is made of uneven wet stone slabs with puddles, cracks, moss, grass tufts, and reflective highlights. A large vermilion paper lantern hangs from a dark wooden post near the center-right foreground, slightly left of the main figure. The lantern is cylindrical with rounded caps at top and bottom, ribbed vertical segments, dark metal bands, and a warm orange flame glowing inside. Its vermilion color provides the primary warm accent in the otherwise cool, desaturated palette. Around it are rough wooden planks, posts, ropes, barrels, crates, and weathered dock structures arranged irregularly along the riverbank. Thin smoke or mist curls upward near the lantern and around the trees, reinforcing the damp, cold atmosphere.

The dominant human subject stands in the right-center foreground, shown from behind in three-quarter profile facing toward the distant mountains and river. The person appears to be a young adult East Asian man with a slim-to-athletic build, average height, and light-to-medium skin tone. He has long black hair tied high into a thick ponytail, with loose strands blown sideways by wind. His face is visible in side profile, showing a straight nose, defined jawline, focused eyes, and a serious, contemplative expression. He wears dark, layered, worn travel robes or martial-arts-inspired garments in black and charcoal gray, with a cinched belt and wrapped sleeves. The clothing has a matte, weathered fabric texture with subtle folds, frayed edges, and decorative embroidered-looking trim on the shoulder and back area. A large backpack or bundled gear sack rests on his back, secured with straps, cords, and buckles. Long belts, sashes, and hanging fabric strips trail from his waist, emphasizing movement and wind. At his waist and hip, a short sword with a black shark hide scabbard, brass guard, and gray rope-wrapped handle hangs visibly from the side; the blade is fully sheathed, with metallic highlights along the brass fittings and a narrow, sharp silhouette suggesting a weapon carried for travel or combat.

To the right, near the riverboat, an elderly East Asian man stands partly turned toward the younger traveler. He has a lean, wiry build, deeply wrinkled facial features, gray-white hair tied into a small bun, and a weathered, serious expression. He wears dark ragged clothing with layered, torn sleeves and rough fabric textures. His posture is bent slightly forward as he grips a long pole or oar extending diagonally into the water. The interaction between the two men is quiet and tense: the older man looks toward the younger figure while standing beside the boat, and the younger figure faces away into the landscape, visually separated by the dock space and their opposing orientations.

Behind the older man, a wooden riverboat occupies the lower-right middle ground. It has a dark curved roof with upturned eaves, weathered railings, vertical support beams, and a hull sitting low on the rippling water. The boat’s surfaces appear aged, soaked, and uneven, with dark brown wood and muted black shadows. Reflections shimmer faintly beneath it in the river. The dock edge, posts, and mooring lines connect the boat to the stone path, creating a dense arrangement of practical travel objects.

The overall composition uses strong depth perspective: the stone path leads from the bottom foreground toward the travelers, then across the river toward the misty pagoda and towering mountains. The main figure occupies the right half of the frame, while the mountain peak and storm sky balance the left and upper portions. Lighting is dramatic and directional, with cool ambient storm light from the cloudy sky and a localized warm glow from the lantern. The color grading is cinematic, dominated by desaturated blue-gray, slate, black, deep green, and earthy brown, contrasted by the lantern’s amber-orange light. The image has the appearance of high-detail digital painting or AI-generated fantasy concept art, with realistic environmental rendering, painterly textures, atmospheric haze, and a historical wuxia or xianxia-inspired visual language.
主体的单人立绘，全身入画，头身比约七头半，解剖比例写实，下肢不过度拉长。运笔有提按顿挫的细墨线勾勒全身轮廓，线随结构时粗时细，转折衔接处轻重分明；墨色浓淡分明，干湿五阶层次清楚，近处轮廓清楚、墨线饱满，远景以淡墨晕染层层退开。背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，受控饱和而非一律低饱和；一块鲜明的点题色收束视线；均匀柔光，浅净平涂的底，画面疏朗有呼吸。
衣褶/裙摆：使用宽幅平静布面，正面仅允许两到四条长结构褶（稀疏结构褶 2-4 条）。
材质可以朴素或粗陋（灰布、素袍、劳动布）但须看起来可穿且完整；服饰保持结构安静：袖口和下摆是连续闭合布面。
头发存在：头皮须有可见头发，有清晰发量与发际线；短发、长发、扎发、平头或短寸均可。
鞋靴性别：鞋靴性别呈现须匹配角色生理性别与来源事实。
人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。
衣物完整性：服饰须完整、线条干净、可生产。
风格底座：现代修仙游戏的数字绘画资产（modern Chinese illustration）——中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、服饰、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术，不是把一幅古画直接搬进游戏。媒介：现代数字绘画完成度的 2D 传统绘画语言——连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明，干净空灵，清晰视觉焦点。底色：浅净哑光平涂底的完成度，多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位），保证可读性。画面保持干净平滑：墨与色落在平涂色场上，而非有纹理的纸面。工笔线条质量：连续铁线描；曲线自然顺滑，直线笔直稳定；线宽连续且有节奏，转折、衔接与起收笔干净；细稳基调上转折处轻重提按，墨线带手绘笔性，防机械勾边与矢量感。线描优先工笔结构：100% 视图下，脸部、手部、发丝、衣边、缝线、褶皱、配件和武器构造须先于上色或 shading 从连续纪律性 linework 保持可读。用白描/铁线描加薄透矿物罩染、反复轻分染与罩染建模；保持浅净平涂底面在层间呼吸。浅净哑光底须在每层色罩下保持可见，除非是刻意的墨线、紧凑发块或来源事实要求的深色主体（如尚黑阵营的甲胄旗纛）。成片质量：生产级最终画面清晰度——强制降噪泥糊 AI 伪影；边缘锐利但不产生过锐光晕；表面干净可读；颜料层纯净均匀。默认表面须保持干净精致：只用纯净罩染与克制的矿物颗粒。岁月、风霜或战痕仅在来源事实要求时作克制的叙事线索，须次要、不抢戏。电影级成片质量指干净的可读性与精致的工艺清晰度。
```

### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,负向文本仍在链生成并预览,采样端不消费——[7016] Note 口径)

> **构成标注(引文外)**:共 388 字,以「, 」连接两段——首段=分镜剧情图型负面 202 字(真源 qi21_bases.json 分镜剧情图条 negative_text 逐字,已程序化核对 in finalNeg=True;内容=布面破损/褶网/破烂造型禁令串+鞋靴禁令串);次段=锁层负面 184 字(美学禁令串)。[404] 负向主体句保存态空(history 回读 value=""),主体句负面第三源为空段(与保存态一致)。

```
模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，扇贝状/破损/分叉的裙摆或袍摆，分叉袍摆，分离的飘带状下摆条，下摆缺角，风碎流苏，乞丐破衣，撕裂下摆，碎边，破洞，磨损补丁，虫蛀布面，垂挂碎条，绳捆破布，刻意破烂造型，拉扯衣袍，分裂衣袍，分叉衣袍，破破烂烂，剃净头皮，透明头皮，无发干净圆顶，女性高跟鞋，细高跟，尖头女鞋，精巧女舞鞋，细带玛丽珍鞋，男性超大号通用工靴，异装鞋靴, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
```

## 2. 时间账

| 事件 | 时刻 |
|---|---|
| graphToPrompt 干跑+投前断言 12 项全绿 | 12:50:38 CST(2026-10-06T04:50:38.668Z) |
| POST /prompt 受理(tQueue) | 2026-10-06T04:50:38.668Z |
| 进入 running(tRunningSeen) | 2026-10-06T04:50:38.692Z(排队等待≈24ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06T04:56:39.443Z(12:56:39 CST) |
| 2K 落盘(引擎侧 mtime) | 2026-10-06T04:58:11.593Z(12:58:11 CST) |
| 终态 success(tDone) | 2026-10-06T04:58:11.793Z |

**排队→出图 = 7.55 分钟**(durationMin 实测;含 PE 9B 模型新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大;预算 38min 帽内,任务书 45min 帽内)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode;路由 latent_funacc←[7:7013]) | 保存态 |
| seed | **0**([7:7014].inputs={"value": 0};[7:7013].seed=["7:7014",0] 连线) | **=保存态,未动** |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,model=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors,无外接采样器参数) | 档0 口径(FACTS §1 档位表);7010(cfg4/40步)、7012(cfg1/6步)在图未选 |
| 分辨率 | **2560×1712(横幅≈3:2,4.38MP)**;[4].width/height=["4018",0/1] 连线驱动;[4015].resolution=1024 | 画幅听 PE 建议(PE启用=true⇒[4018] 联动);3:2 形态与 2 型 §8⑤ 定谳机制一致(该役探针实锤 wh_ratio="3:2"→(2568,1712)→2560 经 /16 网格截 8;**本拍未另跑 wh_ratio 探针,机制链引用 2 型定谳,分辨率本身=PIL 双图实测**) |
| 透明 | 跟型=false([6:4010].透明覆盖=false;rgba_default=False 真源同) | 非透明型不开 alpha 门仅记录:直出四角 [255,254,255,255]、2K [255,199,255,255](postcheck 实测) |
| PE | [6:4013] QwenImage21_T2IPromptRewrite(temp=1.0/top_p=0.95/top_k=20/presence_penalty=1.5/max_new_tokens=16256/seed=42;clip=[6:4019] qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16,本拍缓存加载件) | 输出=本拍新鲜改写(§1②) |
| 负向编码 | [4015].negative_prompt=""(主 TE 侧空);型负面经 [6:4014]→[4016] 负编码口(§1③′) | 档0 采样端不消费负向 |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 引擎侧原文件(mtime) |
|---|---|---|---|---|
| [8] 直出 | `images/type-7-分镜剧情图.direct.png` | 8288741 | 2560×1712 RGBA | QI21道劫文生图__00116_.png(2026-10-06T04:56:39.443Z) |
| [504] 2K | `images/type-7-分镜剧情图.2k.png` | 10853940 | 3062×2048 RGBA | MYStudio-2K_00037_.png(2026-10-06T04:58:11.593Z) |

(2K=SeedVR2 短边2048 放大;2560×1712→3062×2048,比例保持≈1.495≈3:2。)

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 70-72,原文逐字;全量JSON 行 6529 字符见存档)

```
[MY出图][入队][2026-10-06 12:50:38] number=22 prompt_id=5b05816c-721e-4d65-a894-1a4d75fbf0d1
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetenso… ×1.0 | KSampler: seed=['7:7014', 0] cfg=1.0 steps=6 sampler=euler scheduler=simple denoise=1.0 | KSampler: seed=['7:7014', 0] cfg=4.0 steps=40 sampler=euler scheduler=simple denoise=1.0
```

(摘要行为**源日志行逐字全文**——行内「safatenso… ×1.0」的省略号是引擎侧日志钩子对 LoRA 文件名的原生截断,在源行内,非本记录截断;与 1/2 型拍摘要行同形(该行不含提示词内容)。[全量JSON] 行 6529 字符全文见 `logs/type-7-分镜剧情图.image-prompts.excerpt.log`。)

## 6. 与保存态偏差

**无。**两处改动恰为任务书允许的两处:

1. 型选择:人物→**分镜剧情图**([6] 宿主面板 widget;投前排队图断言 [6:4010].base=「分镜剧情图」✓;型底座 BASE 473 字逐字进装配 §1③)。
2. 主体句:[400] value→**分镜剧情图 canon 131 字**(逐字,md5 对拍✓)。

其余全保存态:PE启用?=true / 透明未动([6:4010].透明覆盖=false) / 速度档位=0 · Fun-Acc 4步 / seed=0 / [404] 负向主体句空——改前读回(host6=["人物",true]→型选择置值,host7=["0 · Fun-Acc 4步",0])改后读回逐项一致(driver S7 五读回门全绿)。**无破缓存需要**:分镜剧情图句改变 PE 链输入→29/30 节点新鲜执行(含 6:4013/6:4011/6:4014 装配链与 7:7013 采样链),真渲染,零缓存回声(§7)。

## 7. 机器判据(后核 `verify/type-7-分镜剧情图.postcheck.json`,exit=0,18/18)

| 判 | 项 | 实测 |
|---|---|---|
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=5b05816c-721e-4d65-a894-1a4d75fbf0d1 |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=1/30(仅 6:4019 PE 加载器) |
| ✅ | seed 回读=[7:7014] | {"value": 0} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,504 |
| ✅ | 产物图存在且>0字节([8] type-7-分镜剧情图.direct.png) | 8288741B |
| ✅ | PNG 魔数([8]) |  |
| ✅ | PNG 可解析(PIL,[8]) | RGBA 2560×1712,metaLen=12160,cornerAlpha=[255,254,255,255] |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12160 |
| ✅ | 产物图存在且>0字节([504] type-7-分镜剧情图.2k.png) | 10853940B |
| ✅ | PNG 魔数([504]) |  |
| ✅ | PNG 可解析(PIL,[504]) | RGBA 3062×2048,metaLen=12160,cornerAlpha=[255,199,255,255] |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12160 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=6777 negLen=388 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:70 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:70 起 3 行 |

(透明底 alpha 门:FACTS §2 分镜剧情图 rgba_default=false,非透明型不设门——四角 alpha 仅记录,见 §3/§7 表内。)

## 8. 勘误与标注(工具链,不影响判据)

- **① 驱动器原始终判红=2 型 §8① 同款收割 bug 假红**:驱动器内嵌「PNG 元数据=history prompt」比对不剥节点级 `is_changed` 缓存指纹(pngMd5=1dbc481f…≠histMd5=368e8537…)→其终判 ok=false/真实 exit=1(pipestatus 实录 DRIVER_EXIT=1);权威判据=后核剥指纹后稳态同比对(§7 表「剥 is_changed 指纹」行✅,唯一差异域=6:4010,与 1/2 型同)。驱动 raw 数据域(时间账/读回/断言/收据/图)全绿可用,本记录全部引证自 raw 与后核。
- **② R.prompts.peRewrite 只含装配首行**(686 字,driver 取 finalPos.split("\n")[0]):本拍 PE 扩写为 7 段多行体(5563 字),§1② 改用「BASE 473 字逐字对拍真源」从装配终稿定界切出完整段引用并记 md5 83963f5c0077bd477002a566b12a7a15。
- **③ [6:4020] PE思考预览不随 history outputs 回放**(outputs 键=[8,401,504,505],thinkLen=0):与 00:38 E2E 拍及 2 型拍现象一致,系本代工作流该件 UI 输出回收行为,非本拍缺陷;PE 改写输出溯源=装配前段逐字(§1②)。
- **④ 分辨率机制链引用 2 型 §8⑤ 定谳**(PE wh_ratio=3:2→(2568,1712)→/16 网格截 8→2560):本拍未另跑确定性探针(避免额外占用引擎);分辨率事实本身(2560×1712 横幅,3:2)为 PIL 双图复核**实测**,机制归因标注为**引用**。
- **⑤ 本拍取代 App 画布扫场拍**(见头部取代注记):规范判据全部基于本拍 pid 5b05816c;sweep 拍仅作历史存档(.bak)。

## 9. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-7-分镜剧情图.image-prompts.excerpt.log` | 源 image-prompts-20261006.log 行 70-72(入队+摘要+全量JSON 6529 字符) |
| ② PNG 元数据 | `verify/type-7-分镜剧情图.png-prompt-metadata.json` | tEXt prompt(12,160B,30 节点,剥 is_changed 后与 history 稳态同;metaMd5=c83f7e1f30562a5733222cf9e3e690e4) |
| ③ history prompt JSON | `runs/type-7-分镜剧情图.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-7-分镜剧情图.json` | 断言 12 项/读回前后/改动两笔/时间账(终判红=§8①假红) |
| 驱动控制台 | `logs/type-7-分镜剧情图.driver.console.log` | 全程日志(真实 DRIVER_EXIT=1=§8①假红) |
| 后核 | `verify/type-7-分镜剧情图.postcheck.json` | 机器判据权威判(18/18,exit=0) |
| 产物图 | `images/type-7-分镜剧情图.direct.png` / `images/type-7-分镜剧情图.2k.png` | §4 |
| 主体句 canon | /tmp/qi21-subject-type7.txt(临时)+ 本记录 §1① 全文引 | 131 字 md5 0cf065905bb98f958a20cb0b324a80cb |
| PE 扩写全文 | 本记录 §1② 全文引(+ /tmp/t7-pe-full.txt 临时件,md5 83963f5c0077bd477002a566b12a7a15) | 5563 字 7 段 |
| sweep 拍存档 | `runs/type-7-分镜剧情图.history.appcanvas-sweep-1219.bak` | 被取代的 App 画布扫场拍(12:19,主体句错配=§1 人物句) |
