# 实弹记录 · 第 8/9 型「表情差分」(type-8-表情差分)

**结果:✅ 机器判据全绿**(权威后核 `postcheck_type.py type-8-表情差分 --transparent` exit=0,**19/19 项含透明四角 alpha 门**,判据明细见 §7;驱动器自身 exit=1,唯一红项=§8① 已知 is_changed 假红,与 2/7 型拍同款,非判据红)

- 日期:2026-10-06(排队 13:07:50 → 终态 13:15:03 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,manifest port=17000 实查,comfyui 0.38.0/python 3.12.7/mps)——**复用现役,非本 run 所起(engineStartedByUs=false)**;发射前队列空(queue_running/pending 均 0,raw engine.precheck.queueAtStart)
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,根节点 20,与 FACTS §1/型 7 拍同版;驱动装载即此版,S4 实录)
- 主体句:390 字,md5 `e1dea2d1bbb9e90d7b6ce4d14816cbbd`——三源逐字一致(docs/prompts/道劫_九型主体句示例.md §8(节题「## 8. 表情差分(21:9 多格)」)/ /tmp/qi21-ninetype-1004/ninetype_driver.mjs:58(FACTS §2 出处)/ /tmp/qi21-subject-type8.txt 驱动输入件;程序化抽取+`subj in doc` 比对 True)
- prompt_id:`fec5c1d6-5ace-4e62-a9c3-35ccb1df382c`;client_id:`qi21-9xing-8-1791263270962`;入队序号 number=23
- **与保存态偏差:无**——恰两处改动=任务书恰许的两处(型选择/主体句);seed=0 保存态未动(表情差分句 390 字为首用,PE 链输入改变→22/30 节点新鲜执行含 6:4013 PE 改写本拍新鲜推理,零缓存回声,§7)
- **本拍取代注记(引文外)**:本 run 前同日 12:26 曾有一发 App 画布扫场拍(`app_sweep_7to10.mjs`,pid 91ea95a6-c61d-4fc8-8e20-0bb2f28dc1c1)落位同名文件——该拍仅置「型选择=表情差分」、[400] 主体句保持画布保存态=**§1 人物句(147 字)错配**,不满足本任务书「主体句=FACTS 该型出处原句」要件;其 history 存档已备份 `runs/type-8-表情差分.history.appcanvas-sweep-1226.bak`(引擎侧原图 QI21道劫文生图__00113_.png / MYStudio-2K_00034_.png,仍在引擎 output 可取),同名 history/图文件由本拍(规范拍)覆盖。

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;出处=道劫_九型主体句示例.md §8 原文逐字=FACTS §2 出处 ninetype_driver.mjs:58;390 字,md5 e1dea2d1bbb9e90d7b6ce4d14816cbbd)

```
青年刀修玄色劲装束袖束腰，长发高束马尾，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中；同一位青年刀修的九宫格表情差分，玄色劲装束袖束腰、黑革刀带、长发高束马尾九格逐格一致，九格仅面部表情不同，服饰发型姿态完全一致，背景九格同为赭石色山壁、光源九格同为暖金光自左上，朱红缨九格同缀于画面一角；九格情绪与五官状态——沉静：双目平和微垂、眉舒展、唇线平直；含笑：眼角弯起、嘴角上扬轻抿、眉梢微挑；怒：剑眉倒竖、怒目圆睁、牙关紧咬嘴角下压；哀：眉梢下垂呈八字、眼睑低垂含泪光、嘴角下弯；惧：眉毛高挑向眉心收拢、双眼圆睁、唇微张发颤；凌厉：双眼眯起、眉峰锐利下压、嘴角紧抿；惊讶：眉毛高高挑起、双眼睁大、唇微张成小圆；害羞：双颊染红晕、眼帘低垂、嘴角含羞轻抿；决然：目光坚定直视、眉宇紧锁、嘴角平直；各格头部角度与光源方向保持一致，全图多色相并陈，暖调中等饱和。
```

### ② PE 改写输出([6:4013].positive_prompt 经 [6:4021] 选定入装配;PE启用?=true 保存态;共 4788 字、19 行英文多段体;md5 924ae3f52ddbed9610cf545984561cd7)

> **溯源标注(引文外)**:本段为**本拍新鲜推理**——6:4013 在本拍新鲜执行名单(22/30 节点新鲜;缓存件=加载器类 8 件)。本段按「BASE 473 字逐字对拍真源(qi21_bases.json 表情差分条 positive_text)」从装配终稿定界切出(§8②:驱动器 R.prompts.peRewrite 字段仅截首行,非全段)。[6:4020] PE思考预览件不随 history outputs 回放(outputs 键=[8,401,504,505],thinkLen=0;§8③)。

```
这是一张带有透明度的RGBA图像。 The image is a square 3-by-3 stitched portrait collage made of nine rectangular photographic frames separated by thin, solid black divider lines. Each frame shows the same young East Asian man, approximately in his twenties, portrayed as a dark-fantasy warrior or blade cultivator. He has a slim-to-athletic build, fair-to-medium skin tone, sharp facial structure, straight nose, defined jawline, and long black hair tied high into a flowing ponytail. His clothing is consistently a black layered robe or martial jacket with wrapped sleeves, matte woven fabric, subtle embroidered trim, and a cinched black leather belt. Across the front of his waist hangs a sheathed short sword or dagger angled diagonally downward; the scabbard is black shark leather with visible wear, the handle is wrapped in gray rope, and the guard and fittings are aged brass or bronze. A deep red tassel ornament appears near his shoulder in every panel, attached beside dark cords and metal details. The background throughout all nine portraits is the same ochre stone wall with rough pitted texture, warm highlights, darker crevices, and dramatic directional light coming from the upper left, creating warm gold illumination, strong shadows, and a cinematic low-saturation color grade.

In the top-left panel, the man is shown from about mid-torso upward, positioned slightly left of center, looking calmly toward the viewer with eyes gently lowered, relaxed brows, and straight lips. His ponytail streams backward over his right shoulder, catching rim light along individual strands. The black robe folds around his chest and sleeve, and the sword hilt and brass guard sit prominently near the lower center of the frame.

In the top-center panel, he faces forward in a similar three-quarter portrait, now wearing a faint restrained smile. His eyes are softer, eyebrows slightly lifted at the outer edges, and the corners of his mouth curve upward subtly. The warm light strikes the left side of his face and hair, while the dark collar and leather belt anchor the lower portion of the composition.

In the top-right panel, his expression turns angry and confrontational. His brows draw downward sharply, eyes glare directly ahead, teeth are clenched, and the mouth line presses downward. The high ponytail rises behind him against the textured wall, and the red tassel is more visible on the right side of his shoulder. The sword remains sheathed at his waist, its black shaft descending diagonally through the lower part of the frame.

In the middle-left panel, the man’s expression is sorrowful and subdued. His eyebrows droop inward, eyelids are heavy, tears or glossy moisture gather beneath the eyes, and the mouth corners pull downward. The lighting remains warm but feels heavier on his shadowed face, emphasizing tired under-eye areas and the emotional strain in his features.

In the central panel, he appears frightened or startled. His eyebrows pull high toward the center of his forehead, his eyes are opened wide, and his lips part slightly as if breathing quickly or reacting in alarm. The face is tightly framed, with the long black ponytail fanning behind his head and the brass sword guard visible below his hand.

In the middle-right panel, his expression becomes fierce and piercing. His eyes narrow into a focused stare, brow ridges press downward, and the mouth is closed with a tight, determined line. The composition emphasizes the sharp contrast between glowing hair edges, dark robes, and the rugged ochre stone backdrop.

In the bottom-left panel, he looks surprised or shocked. His eyebrows rise dramatically toward the forehead, eyes are widened, and his mouth opens into a small rounded shape. The sword handle with gray rope wrapping, black leather belt, and worn scabbard remain clearly visible at the lower left and center, reinforcing the fantasy martial setting.

In the bottom-center panel, his expression shifts to shy or bashful hesitation. His cheeks are visibly flushed with a rosy tint, eyelids look lowered, and the mouth closes softly with a modest, vulnerable compression. The warm sunlight grazes his cheek and hair, giving the black robe a smoky brown-black sheen against the ochre wall.

In the bottom-right panel, he returns to a resolute, determined pose. His gaze is steady and direct, brows furrowed with tension, and the mouth remains straight and unsmiling. The red tassel, dark ponytail, leather belt, and black sheathed weapon form a cohesive silhouette on the right side of the collage. Overall, the image reads as a cinematic character-expression sheet or contact-sheet style portrait series, presenting multiple emotional variations of the same blade-cultivator figure under consistent warm lighting, wardrobe, props, and environment.
```

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 6076 字 = PE 扩写 4788 + 1 换行 + 型底座 BASE 473(逐字=qi21_bases.json 表情差分条 positive_text) + 1 换行 + 锁层A 739 + **透明尾缀 74 字**(rgba_default=True 跟型自动注入,db41519「透明自动跟型线」口径);md5 034d39b9e1cbc3b328a508cabc7709d8)

```
这是一张带有透明度的RGBA图像。 The image is a square 3-by-3 stitched portrait collage made of nine rectangular photographic frames separated by thin, solid black divider lines. Each frame shows the same young East Asian man, approximately in his twenties, portrayed as a dark-fantasy warrior or blade cultivator. He has a slim-to-athletic build, fair-to-medium skin tone, sharp facial structure, straight nose, defined jawline, and long black hair tied high into a flowing ponytail. His clothing is consistently a black layered robe or martial jacket with wrapped sleeves, matte woven fabric, subtle embroidered trim, and a cinched black leather belt. Across the front of his waist hangs a sheathed short sword or dagger angled diagonally downward; the scabbard is black shark leather with visible wear, the handle is wrapped in gray rope, and the guard and fittings are aged brass or bronze. A deep red tassel ornament appears near his shoulder in every panel, attached beside dark cords and metal details. The background throughout all nine portraits is the same ochre stone wall with rough pitted texture, warm highlights, darker crevices, and dramatic directional light coming from the upper left, creating warm gold illumination, strong shadows, and a cinematic low-saturation color grade.

In the top-left panel, the man is shown from about mid-torso upward, positioned slightly left of center, looking calmly toward the viewer with eyes gently lowered, relaxed brows, and straight lips. His ponytail streams backward over his right shoulder, catching rim light along individual strands. The black robe folds around his chest and sleeve, and the sword hilt and brass guard sit prominently near the lower center of the frame.

In the top-center panel, he faces forward in a similar three-quarter portrait, now wearing a faint restrained smile. His eyes are softer, eyebrows slightly lifted at the outer edges, and the corners of his mouth curve upward subtly. The warm light strikes the left side of his face and hair, while the dark collar and leather belt anchor the lower portion of the composition.

In the top-right panel, his expression turns angry and confrontational. His brows draw downward sharply, eyes glare directly ahead, teeth are clenched, and the mouth line presses downward. The high ponytail rises behind him against the textured wall, and the red tassel is more visible on the right side of his shoulder. The sword remains sheathed at his waist, its black shaft descending diagonally through the lower part of the frame.

In the middle-left panel, the man’s expression is sorrowful and subdued. His eyebrows droop inward, eyelids are heavy, tears or glossy moisture gather beneath the eyes, and the mouth corners pull downward. The lighting remains warm but feels heavier on his shadowed face, emphasizing tired under-eye areas and the emotional strain in his features.

In the central panel, he appears frightened or startled. His eyebrows pull high toward the center of his forehead, his eyes are opened wide, and his lips part slightly as if breathing quickly or reacting in alarm. The face is tightly framed, with the long black ponytail fanning behind his head and the brass sword guard visible below his hand.

In the middle-right panel, his expression becomes fierce and piercing. His eyes narrow into a focused stare, brow ridges press downward, and the mouth is closed with a tight, determined line. The composition emphasizes the sharp contrast between glowing hair edges, dark robes, and the rugged ochre stone backdrop.

In the bottom-left panel, he looks surprised or shocked. His eyebrows rise dramatically toward the forehead, eyes are widened, and his mouth opens into a small rounded shape. The sword handle with gray rope wrapping, black leather belt, and worn scabbard remain clearly visible at the lower left and center, reinforcing the fantasy martial setting.

In the bottom-center panel, his expression shifts to shy or bashful hesitation. His cheeks are visibly flushed with a rosy tint, eyelids look lowered, and the mouth closes softly with a modest, vulnerable compression. The warm sunlight grazes his cheek and hair, giving the black robe a smoky brown-black sheen against the ochre wall.

In the bottom-right panel, he returns to a resolute, determined pose. His gaze is steady and direct, brows furrowed with tension, and the mouth remains straight and unsmiling. The red tassel, dark ponytail, leather belt, and black sheathed weapon form a cohesive silhouette on the right side of the collage. Overall, the image reads as a cinematic character-expression sheet or contact-sheet style portrait series, presenting multiple emotional variations of the same blade-cultivator figure under consistent warm lighting, wardrobe, props, and environment.
主体的单人立绘，全身入画，头身比约七头半，解剖比例写实，下肢不过度拉长。运笔有提按顿挫的细墨线勾勒全身轮廓，线随结构时粗时细，转折衔接处轻重分明；墨色浓淡分明，干湿五阶层次清楚，近处轮廓清楚、墨线饱满，远景以淡墨晕染层层退开。背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，受控饱和而非一律低饱和；一块鲜明的点题色收束视线；均匀柔光，浅净平涂的底，画面疏朗有呼吸。
衣褶/裙摆：使用宽幅平静布面，正面仅允许两到四条长结构褶（稀疏结构褶 2-4 条）。
材质可以朴素或粗陋（灰布、素袍、劳动布）但须看起来可穿且完整；服饰保持结构安静：袖口和下摆是连续闭合布面。
头发存在：头皮须有可见头发，有清晰发量与发际线；短发、长发、扎发、平头或短寸均可。
鞋靴性别：鞋靴性别呈现须匹配角色生理性别与来源事实。
人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。
衣物完整性：服饰须完整、线条干净、可生产。
风格底座：现代修仙游戏的数字绘画资产（modern Chinese illustration）——中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、服饰、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术，不是把一幅古画直接搬进游戏。媒介：现代数字绘画完成度的 2D 传统绘画语言——连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明，干净空灵，清晰视觉焦点。底色：浅净哑光平涂底的完成度，多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位），保证可读性。画面保持干净平滑：墨与色落在平涂色场上，而非有纹理的纸面。工笔线条质量：连续铁线描；曲线自然顺滑，直线笔直稳定；线宽连续且有节奏，转折、衔接与起收笔干净；细稳基调上转折处轻重提按，墨线带手绘笔性，防机械勾边与矢量感。线描优先工笔结构：100% 视图下，脸部、手部、发丝、衣边、缝线、褶皱、配件和武器构造须先于上色或 shading 从连续纪律性 linework 保持可读。用白描/铁线描加薄透矿物罩染、反复轻分染与罩染建模；保持浅净平涂底面在层间呼吸。浅净哑光底须在每层色罩下保持可见，除非是刻意的墨线、紧凑发块或来源事实要求的深色主体（如尚黑阵营的甲胄旗纛）。成片质量：生产级最终画面清晰度——强制降噪泥糊 AI 伪影；边缘锐利但不产生过锐光晕；表面干净可读；颜料层纯净均匀。默认表面须保持干净精致：只用纯净罩染与克制的矿物颗粒。岁月、风霜或战痕仅在来源事实要求时作克制的叙事线索，须次要、不抢戏。电影级成片质量指干净的可读性与精致的工艺清晰度。 主体呈现为干净的平面剪裁,单一独立素材完整保持在画幅内,四周被空白透明度包围,轮廓至边缘清晰完整不断裂。 该图像具有alpha通道,背景是透明的。
```

### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,负向文本仍在链生成并预览,采样端不消费——[7016] Note 口径)

> **构成标注(引文外)**:共 388 字,以「, 」连接两段——首段=表情差分型负面 202 字(真源 qi21_bases.json 表情差分条 negative_text 逐字,程序化核对 in finalNeg=True;内容=布面破损/褶网/破烂造型禁令串+鞋靴禁令串,与 7 型同串);次段=锁层负面 184 字(美学禁令串)。[404] 负向主体句保存态空(history 回读 value=""),主体句负面第三源为空段(与保存态一致)。

```
模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，扇贝状/破损/分叉的裙摆或袍摆，分叉袍摆，分离的飘带状下摆条，下摆缺角，风碎流苏，乞丐破衣，撕裂下摆，碎边，破洞，磨损补丁，虫蛀布面，垂挂碎条，绳捆破布，刻意破烂造型，拉扯衣袍，分裂衣袍，分叉衣袍，破破烂烂，剃净头皮，透明头皮，无发干净圆顶，女性高跟鞋，细高跟，尖头女鞋，精巧女舞鞋，细带玛丽珍鞋，男性超大号通用工靴，异装鞋靴, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
```

## 2. 时间账

| 事件 | 时刻 |
|---|---|
| graphToPrompt 干跑+投前断言 10 项全绿 | 13:07:50 CST(2026-10-06T05:07:50.961Z) |
| POST /prompt 受理(tQueue) | 2026-10-06T05:07:50.962Z |
| 进入 running(tRunningSeen) | 2026-10-06T05:07:50.974Z(排队等待≈12ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06T05:13:33.101Z(13:13:33 CST) |
| 2K 落盘(引擎侧 mtime) | 2026-10-06T05:14:59.037Z(13:14:59 CST) |
| 终态 success(tDone) | 2026-10-06T05:15:03.421Z |

**排队→出图 = 7.21 分钟**(durationMin 实测;直出 +5.70min、2K +7.14min;含 PE 9B 模型新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大;预算 38min 帽内,任务书 45min 帽内)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode;路由 latent_funacc←[7:7013]) | 保存态 |
| seed | **0**([7:7014].inputs={"value": 0};[7:7013].seed=["7:7014",0] 连线) | **=保存态,未动** |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,model=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors,无外接采样器参数) | 档0 口径(FACTS §1 档位表);7010(cfg4/40步)、7012(cfg1/6步)在图未选 |
| 分辨率 | **2096×2096(1:1 方幅,4.39MP)**;[4].width/height=["4018",0/1] 连线驱动;[4015].resolution=1024 | 画幅听 PE 建议(PE启用=true⇒[4018] 联动);doc §8 节题标注「21:9 多格」为文档建议口径,本拍 PE 建议方幅 2096(2096/16=131 网格整);机制链(wh_ratio→/16 网格)引用 2 型 §8⑤ 定谳,本拍未另跑 wh_ratio 探针,分辨率本身=PIL 双图实测 |
| 透明 | 跟型=true([6:4010].透明覆盖=false+rgba_default=True 真源同)→正向尾缀 74 字透明句注入(§1③);产物 RGBA | 透明门见 §7(2K 四角 [0,0,0,0] ✅);直出四角不透明详 §8⑤ |
| PE | [6:4013] QwenImage21_T2IPromptRewrite(temp=1.0/top_p=0.95/top_k=20/presence_penalty=1.5/max_new_tokens=16256/seed=42;clip=[6:4019] qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16,缓存加载件) | 输出=本拍新鲜改写(§1②) |
| 负向编码 | [4015].negative_prompt=""(主 TE 侧空);型负面经 [6:4014]→[4016] 负编码口(§1③′) | 档0 采样端不消费负向 |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 引擎侧原文件(mtime) |
|---|---|---|---|---|
| [8] 直出 | `images/type-8-表情差分.direct.png` | 8596658 | 2096×2096 RGBA | QI21道劫文生图__00117_.png(2026-10-06T05:13:33.101Z) |
| [504] 2K | `images/type-8-表情差分.2k.png` | 7917663 | 2048×2048 RGBA | MYStudio-2K_00038_.png(2026-10-06T05:14:59.037Z) |

(2K=SeedVR2 短边2048 放大;2096×2096→2048×2048,方幅保持。alpha 统计(venv PIL 实测):直出 alpha≥248 占 99.98%、四角 5px 均值≈248-255;2K alpha≥248 占 99.59%、alpha=0 散点占 0.19%、四角单像素=[0,0,0,0]。)

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 73-75,原文逐字;全量JSON 行 6787 字符见存档)

```
[MY出图][入队][2026-10-06 13:07:50] number=23 prompt_id=fec5c1d6-5ace-4e62-a9c3-35ccb1df382c
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetenso… ×1.0 | KSampler: seed=['7:7014', 0] cfg=1.0 steps=6 sampler=euler scheduler=simple denoise=1.0 | KSampler: seed=['7:7014', 0] cfg=4.0 steps=40 sampler=euler scheduler=simple denoise=1.0
```

(摘要行为**源日志行逐字全文**——行内「safatenso… ×1.0」的省略号是引擎侧日志钩子对 LoRA 文件名的原生截断,在源行内,非本记录截断;与 1/2/7 型拍摘要行同形(该行不含提示词内容)。[全量JSON] 行 6787 字符全文见 `logs/type-8-表情差分.image-prompts.excerpt.log`。)

## 6. 与保存态偏差

**无。**两处改动恰为任务书允许的两处:

1. 型选择:人物→**表情差分**([6] 宿主面板 widget;投前排队图断言 [6:4010].base=「表情差分」✓;型底座 BASE 473 字逐字进装配 §1③)。
2. 主体句:[400] value→**表情差分 canon 390 字**(逐字,md5 对拍✓)。

其余全保存态:PE启用?=true / 透明未动([6:4010].透明覆盖=false) / 速度档位=0 · Fun-Acc 4步 / seed=0 / [404] 负向主体句空——改前读回(host6=["人物",true]→型选择置值,host7=["0 · Fun-Acc 4步",0])改后读回逐项一致(driver S7 五读回门全绿)。**无破缓存需要**:表情差分句为首用输入→PE 链输入改变→22/30 节点新鲜执行(含 6:4013/6:4011/6:4014 装配链与 7:7013 采样链),真渲染,零缓存回声(§7)。

## 7. 机器判据(后核 `verify/type-8-表情差分.postcheck.json`,exit=0,19/19)

| 判 | 项 | 实测 |
|---|---|---|
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=fec5c1d6-5ace-4e62-a9c3-35ccb1df382c |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=8/30(加载器类;6:4013 PE 改写本拍新鲜) |
| ✅ | seed 回读=[7:7014] | {"value": 0} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,504 |
| ✅ | 产物图存在且>0字节([8] type-8-表情差分.direct.png) | 8596658B |
| ✅ | PNG 魔数([8]) |  |
| ✅ | PNG 可解析(PIL,[8]) | RGBA 2096×2096,metaLen=13702,cornerAlpha=[255,255,253,255] |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=13702 |
| ✅ | 产物图存在且>0字节([504] type-8-表情差分.2k.png) | 7917663B |
| ✅ | PNG 魔数([504]) |  |
| ✅ | PNG 可解析(PIL,[504]) | RGBA 2048×2048,metaLen=13702,metaMd5=90aad7c23fe8a43d51c6caa94d94707d,cornerAlpha=[0,0,0,0] |
| ✅ | **透明门:四角 alpha<=8(FACTS rgba_default 型)** | **[0,0,0,0](2K [504];先例 3/5/6 型此门均红,本型为首个过门透明型拍;直出侧对照见 §8⑤)** |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=13702 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=6076 negLen=388 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:73 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:73 起 3 行 |

## 8. 勘误与标注(工具链,不影响判据)

- **① 驱动器原始终判红=2/7 型 §8① 同款收割 bug 假红**:驱动器内嵌「PNG 元数据=history prompt」比对不剥节点级 `is_changed` 缓存指纹(pngMd5=5562a716…≠histMd5=3696747d…)→其终判 ok=false/真实 exit=1(console log 末行 DRIVER_EXIT=1);权威判据=后核剥指纹后稳态同比对(§7 表「剥 is_changed 指纹」行✅,唯一差异域=6:4010,与 1/2/7 型同)。驱动 raw 数据域(时间账/读回/断言/收据/图)全绿可用,本记录全部引证自 raw 与后核。
- **② R.prompts.peRewrite 只含装配首行**(driver 取 finalPos.split("\n")[0]):本拍 PE 扩写为多行体(4788 字),§1② 改用「BASE 473 字逐字对拍真源」从装配终稿定界切出完整段引用并记 md5 924ae3f52ddbed9610cf545984561cd7。
- **③ [6:4020] PE思考预览不随 history outputs 回放**(outputs 键=[8,401,504,505],thinkLen=0):与 00:38 E2E 拍及 2/7 型拍现象一致,系本代工作流该件 UI 输出回收行为,非本拍缺陷;PE 改写输出溯源=装配前段逐字(§1②)。
- **④ 分辨率机制链引用 2 型 §8⑤ 定谳**(PE wh_ratio→/16 网格取整):本拍未另跑确定性探针(避免额外占用引擎);分辨率事实本身(2096×2096 方幅)为 PIL 双图复核**实测**。doc §8 节题「21:9 多格」为文档侧建议口径,本拍 PE 建议为方幅——两口径差异如实记档,机制归因标注为**引用**。
- **⑤ 透明口径如实记(引文外)**:任务书透明加验=四角 alpha=0;战役机器门(postcheck_type.py)锚在 **2K [504]** 产物——实测四角单像素 [0,0,0,0] **过门**。直出 [8] 四角 [255,255,253,255] 不透明,alpha≥248 占 99.98%;2K 侧 alpha=0 仅散点 0.19%(四角 5px 均值≈141-148)。图面主体不透明与型句设计一致(§1①「背景九格同为赭石色山壁」=九格绘满背景,非通体镂空剪裁);「跟型透明」在本拍的落点=RGBA 通道+正向尾缀 74 字透明句(§1③)——透明门以战役成文机器门为准判绿,两侧数字俱录不隐。
- **⑥ 本拍取代 App 画布扫场拍**(见头部取代注记):规范判据全部基于本拍 pid fec5c1d6;sweep 拍仅作历史存档(.bak)。

## 9. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-8-表情差分.image-prompts.excerpt.log` | 源 image-prompts-20261006.log 行 73-75(入队+摘要+全量JSON 6787 字符) |
| ② PNG 元数据 | `verify/type-8-表情差分.png-prompt-metadata.json` | tEXt prompt(13,702B,30 节点,剥 is_changed 后与 history 稳态同;metaMd5=90aad7c23fe8a43d51c6caa94d94707d) |
| ③ history prompt JSON | `runs/type-8-表情差分.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-8-表情差分.json` | 断言 10 项/读回前后/改动两笔/时间账(终判红=§8①假红) |
| 驱动控制台 | `logs/type-8-表情差分.driver.console.log` | 全程日志(真实 DRIVER_EXIT=1=§8①假红) |
| 后核 | `verify/type-8-表情差分.postcheck.json` | 机器判据权威判(19/19,exit=0) |
| 产物图 | `images/type-8-表情差分.direct.png` / `images/type-8-表情差分.2k.png` | §4 |
| 主体句 canon | /tmp/qi21-subject-type8.txt(临时)+ 本记录 §1① 全文引 | 390 字 md5 e1dea2d1bbb9e90d7b6ce4d14816cbbd |
| PE 扩写全文 | 本记录 §1② 全文引(+ /tmp/t8-pe-full.txt 临时件,md5 924ae3f52ddbed9610cf545984561cd7) | 4788 字 |
| sweep 拍存档 | `runs/type-8-表情差分.history.appcanvas-sweep-1226.bak` | 被取代的 App 画布扫场拍(12:26,主体句错配=§1 人物句) |
