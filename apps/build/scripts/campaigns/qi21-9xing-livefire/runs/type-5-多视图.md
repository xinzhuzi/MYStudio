# 实弹记录 · 第 5/9 型「多视图」(type-5-多视图)

**结果:❌ 透明门红——其余机器判据全绿(17/18),本型为透明型(FACTS rgba_default=true,真源 qi21_bases.json 多视图条程序化核对 rgba_default=true/aspect_ratio="3:4 (Portrait Standard)"),四角 alpha 门实测直出图 4/4 角全不透明([255,255,255,255]),整幅 100.00% 像素 alpha>250(0.00% 像素 alpha<8,连透明残量都没有),响亮失败;与 3 型道具同款透明门红且形态更彻底(3 型 2/4 角不透明/整幅 90.6% 不透明,本型 4/4 角/100.00%)**

- 日期:2026-10-06(排队 10:56:55 → 终态 11:03:45 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,manifest port=17000,comfyui 0.38.0/mps,与 FACTS §4.3 同一进程)——**复用现役,非本 run 所起(engineStartedByUs=false)**;投前队列空(running=0/pending=0,独占跑拍)
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,115,614B,根节点 20,与 FACTS §1/1-4 型记录同版;驱动器装载后画布根节点=20 复核同)
- 主体句:77 字,md5 `5aa333feaae436fb974053ee4a4d1233`——**两源逐字一致 + canon 文件**(docs/prompts/道劫_九型主体句示例.md §5(终极真源,fenced 原文程序化抽取)/ /tmp/qi21-ninetype-1004/ninetype_driver.mjs:52(FACTS §2 出处,程序化 `==` 核 True)/ canon 落 /tmp/type5-subject-canon.txt(与 docs §5 逐字节相等);第四源 driver2.log 仅有 1004 夜排队行(99b4bd0f,单发超时 60min 未出图),无主体句回显,如实记)。FACTS §2 标签:**「分张无持械版」77 字,正面单视图**(cfg4 口径 implement.md:45)
- prompt_id:`c972ae02-8ccb-4678-b663-a19b23f70f1f`;client_id:`qi21-9xing-5-1791255415805`
- **与保存态偏差:无**——恰两处改动=型选择(人物→多视图)/[400] 主体句(147字人物句→77字多视图 canon);seed=0 保存态未动;**29/30 节点新鲜执行**(仅 [4019] PE TE 加载器模型级缓存,cached=['6:4019']),零缓存回声,无需 1 型裁定① seed 破缓存通道(多视图在新版工作流上无先前同参拍,与 2/3/4 型同款预判成立)

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;canon=/tmp/type5-subject-canon.txt,md5 5aa333feaae436fb974053ee4a4d1233,77 字)

```
青年刀修玄色劲装束袖束腰，长发高束马尾，腰侧黑革刀带悬一柄短刀，黑鲨皮鞘、黄铜刀格、缠灰绳刀柄，刀身完整收在鞘中；画面为正面全身像，人物正身正对观者站立。
```

### ② PE 改写输出(装配终稿内段全文=[6:4013].positive_prompt 经 [6:4021] 选定入装配;PE启用?=true 保存态;共 4534 字、英文 6 段、段间以空行分隔——PE 模型原生分段;md5 `530698ad94d580332d2040c9182bc937`)

> **溯源标注(引文外)**:本段为**本拍新鲜推理**——6:4013 在本拍新鲜执行名单(29/30 节点新鲜;仅 6:4019 PE TE 加载器模型级缓存,不影响改写本体新鲜性,输入=本拍新主体句)。本段按「BASE 473 字逐字对拍真源(qi21_bases.json 多视图条 positive_text=人物立绘块)」从装配终稿定界切出(3/4 型 §8/§9 同款方法;驱动器 R.prompts.peRewrite 字段仅截装配首行 688 字,非全段,§9②)。**⚠️ 本段是透明门红的直接根因载体**:PE 主动开出了完整建筑场景(石门殿口/木柱/铁链/山雾/石板地面)且通篇持之(§7 证据);身份件上 PE 保住了正面全身像与短刀四件套(黄铜刀格/缠灰绳刀柄/黑鲨皮鞘逐字承接),但发式偏移(马尾→topknot+冠饰,段0 引文自证「topknot with a small ornamental crown-like hairpiece」,canon「长发高束马尾」未被逐字承接)。[6:4020] PE思考预览件不随 history outputs 回放(outputs 键=[8,401,504,505]),与 1-4 型拍现象一致。

```
A vertically oriented, full-body fantasy portrait shows a young East Asian male warrior standing centered in a dark stone doorway or temple entrance. He appears to be in his early twenties, with a slim athletic build, pale-to-light skin tone, sharp oval face, straight brows, narrow focused eyes, a straight nose, and a calm, stern expression. His black hair is tied high in a traditional-style topknot with a small ornamental crown-like hairpiece, while long loose strands fall around his face and flow outward slightly, suggesting wind or motion. He faces directly forward in a formal, symmetrical stance, arms relaxed at his sides, conveying confidence and readiness.

The upper background is filled with misty, towering mountain peaks in cool gray-blue tones, partially obscured by atmospheric haze. Dark wooden pillars frame the scene on both the far left and far right edges, their surfaces rough, aged, and heavily textured with deep brown grain, cracks, and worn carved details. Metal studs and reinforced plates appear near the lower portions of the pillars, adding a fortified architectural quality. Behind the figure, the interior wall consists of dark wooden doors or panels with vertical planks, subtle metal hardware, and shadowed recesses. Heavy iron chains hang along both sides of the doorway, descending from above toward the midsection of the frame; they are thick, dark, matte, and weathered, contributing to a medieval or xianxia-inspired atmosphere.

The central figure wears layered black martial-arts robes resembling hanfu-inspired fantasy costume design. The garment has a high mandarin-style collar, overlapping front closure, wide draped sleeves, and multiple wrap layers crossing diagonally over the chest. The fabric is predominantly black and charcoal gray, with matte woven textures, embroidered-looking patterns, scuffed highlights, frayed edges, and dust-like wear. A pale inner collar peeks out at the neck and along parts of the sleeve cuffs, adding thin contrasting lines of beige-gray fabric. Across his torso and waist are several black leather belts and straps with metallic buckles, loops, rivets, and hanging ornamentation. Decorative cords, tassels, small metal pendants, and chain-like accessories hang from the waist area, especially along the center and viewer’s right side, creating intricate vertical details against the dark clothing.

His right hand, positioned near the viewer’s right side of his waist, rests near a sheathed dagger or short sword. The weapon hangs from the belt at an angle, with a dark handle accented by gray rope wrapping, a round brass-colored guard, and a black shark skin sheath attached to black leather straps secured around the waist. His forearms are covered with dark bracers or wrapped guards, visibly textured with layered bands and seams. The robe sleeves extend broadly outward on both sides, forming soft triangular silhouettes that emphasize the figure’s stance. Below the tunic, he wears loose cropped black trousers gathered around the knees and calves, tucked into tall black leather boots. The boots are rugged, ankle-to-mid-calf in height, with folded cuffs, creases, laces or seam details, and worn matte leather surfaces.

The ground occupies the lower portion of the image and consists of uneven stone slabs in gray and slate tones. The stones are irregularly shaped, cracked, and slightly reflective, suggesting dampness or polished wear. Small patches of scattered debris, dirt, and moss-like dark marks appear between the stones. Soft shadows from the warrior’s boots spread across the floor, while faint highlights along the slab edges catch the diffused light from behind.

The composition is highly symmetrical and cinematic, with the warrior placed almost exactly on the central vertical axis. The camera angle is straight-on at approximately eye level, using a full-body framing that places the figure from head to boots within the architectural frame. The lighting is dramatic and directional, with a bright, cloudy glow behind the mountains and figure, producing rim highlights around the hair, shoulders, sleeves, and weapon edges. The overall palette is subdued and desaturated, dominated by black, charcoal, gunmetal gray, muted bronze, weathered brown, and cold misty blue-gray. The visual style is realistic yet stylized like a high-end fantasy concept artwork or promotional game character portrait, combining detailed costume design, moody historical-fantasy architecture, shallow atmospheric depth, and cinematic contrast.
```

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 5840 字 = 透明头句 18(含尾随空格)+ PE 扩写 4534 + 1 换行 + 型底座 BASE 473(逐字=qi21_bases.json 多视图条 positive_text=人物立绘块:主体立绘句/衣褶裙摆/材质朴素/头发存在/鞋靴性别/设色配比/衣物完整性七行)+ 1 换行 + 锁层A 739(风格底座块)+ W1透明收束段 74;行序=头句「这是一张带有透明度的RGBA图像。」→PE 扩写 6 段→空行→型底座七行→锁层A→W1收束句+尾句)

```
这是一张带有透明度的RGBA图像。 A vertically oriented, full-body fantasy portrait shows a young East Asian male warrior standing centered in a dark stone doorway or temple entrance. He appears to be in his early twenties, with a slim athletic build, pale-to-light skin tone, sharp oval face, straight brows, narrow focused eyes, a straight nose, and a calm, stern expression. His black hair is tied high in a traditional-style topknot with a small ornamental crown-like hairpiece, while long loose strands fall around his face and flow outward slightly, suggesting wind or motion. He faces directly forward in a formal, symmetrical stance, arms relaxed at his sides, conveying confidence and readiness.

The upper background is filled with misty, towering mountain peaks in cool gray-blue tones, partially obscured by atmospheric haze. Dark wooden pillars frame the scene on both the far left and far right edges, their surfaces rough, aged, and heavily textured with deep brown grain, cracks, and worn carved details. Metal studs and reinforced plates appear near the lower portions of the pillars, adding a fortified architectural quality. Behind the figure, the interior wall consists of dark wooden doors or panels with vertical planks, subtle metal hardware, and shadowed recesses. Heavy iron chains hang along both sides of the doorway, descending from above toward the midsection of the frame; they are thick, dark, matte, and weathered, contributing to a medieval or xianxia-inspired atmosphere.

The central figure wears layered black martial-arts robes resembling hanfu-inspired fantasy costume design. The garment has a high mandarin-style collar, overlapping front closure, wide draped sleeves, and multiple wrap layers crossing diagonally over the chest. The fabric is predominantly black and charcoal gray, with matte woven textures, embroidered-looking patterns, scuffed highlights, frayed edges, and dust-like wear. A pale inner collar peeks out at the neck and along parts of the sleeve cuffs, adding thin contrasting lines of beige-gray fabric. Across his torso and waist are several black leather belts and straps with metallic buckles, loops, rivets, and hanging ornamentation. Decorative cords, tassels, small metal pendants, and chain-like accessories hang from the waist area, especially along the center and viewer’s right side, creating intricate vertical details against the dark clothing.

His right hand, positioned near the viewer’s right side of his waist, rests near a sheathed dagger or short sword. The weapon hangs from the belt at an angle, with a dark handle accented by gray rope wrapping, a round brass-colored guard, and a black shark skin sheath attached to black leather straps secured around the waist. His forearms are covered with dark bracers or wrapped guards, visibly textured with layered bands and seams. The robe sleeves extend broadly outward on both sides, forming soft triangular silhouettes that emphasize the figure’s stance. Below the tunic, he wears loose cropped black trousers gathered around the knees and calves, tucked into tall black leather boots. The boots are rugged, ankle-to-mid-calf in height, with folded cuffs, creases, laces or seam details, and worn matte leather surfaces.

The ground occupies the lower portion of the image and consists of uneven stone slabs in gray and slate tones. The stones are irregularly shaped, cracked, and slightly reflective, suggesting dampness or polished wear. Small patches of scattered debris, dirt, and moss-like dark marks appear between the stones. Soft shadows from the warrior’s boots spread across the floor, while faint highlights along the slab edges catch the diffused light from behind.

The composition is highly symmetrical and cinematic, with the warrior placed almost exactly on the central vertical axis. The camera angle is straight-on at approximately eye level, using a full-body framing that places the figure from head to boots within the architectural frame. The lighting is dramatic and directional, with a bright, cloudy glow behind the mountains and figure, producing rim highlights around the hair, shoulders, sleeves, and weapon edges. The overall palette is subdued and desaturated, dominated by black, charcoal, gunmetal gray, muted bronze, weathered brown, and cold misty blue-gray. The visual style is realistic yet stylized like a high-end fantasy concept artwork or promotional game character portrait, combining detailed costume design, moody historical-fantasy architecture, shallow atmospheric depth, and cinematic contrast.
主体的单人立绘，全身入画，头身比约七头半，解剖比例写实，下肢不过度拉长。运笔有提按顿挫的细墨线勾勒全身轮廓，线随结构时粗时细，转折衔接处轻重分明；墨色浓淡分明，干湿五阶层次清楚，近处轮廓清楚、墨线饱满，远景以淡墨晕染层层退开。背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，受控饱和而非一律低饱和；一块鲜明的点题色收束视线；均匀柔光，浅净平涂的底，画面疏朗有呼吸。
衣褶/裙摆：使用宽幅平静布面，正面仅允许两到四条长结构褶（稀疏结构褶 2-4 条）。
材质可以朴素或粗陋（灰布、素袍、劳动布）但须看起来可穿且完整；服饰保持结构安静：袖口和下摆是连续闭合布面。
头发存在：头皮须有可见头发，有清晰发量与发际线；短发、长发、扎发、平头或短寸均可。
鞋靴性别：鞋靴性别呈现须匹配角色生理性别与来源事实。
人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。
衣物完整性：服饰须完整、线条干净、可生产。
风格底座：现代修仙游戏的数字绘画资产（modern Chinese illustration）——中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、服饰、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术，不是把一幅古画直接搬进游戏。媒介：现代数字绘画完成度的 2D 传统绘画语言——连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明，干净空灵，清晰视觉焦点。底色：浅净哑光平涂底的完成度，多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位），保证可读性。画面保持干净平滑：墨与色落在平涂色场上，而非有纹理的纸面。工笔线条质量：连续铁线描；曲线自然顺滑，直线笔直稳定；线宽连续且有节奏，转折、衔接与起收笔干净；细稳基调上转折处轻重提按，墨线带手绘笔性，防机械勾边与矢量感。线描优先工笔结构：100% 视图下，脸部、手部、发丝、衣边、缝线、褶皱、配件和武器构造须先于上色或 shading 从连续纪律性 linework 保持可读。用白描/铁线描加薄透矿物罩染、反复轻分染与罩染建模；保持浅净平涂底面在层间呼吸。浅净哑光底须在每层色罩下保持可见，除非是刻意的墨线、紧凑发块或来源事实要求的深色主体（如尚黑阵营的甲胄旗纛）。成片质量：生产级最终画面清晰度——强制降噪泥糊 AI 伪影；边缘锐利但不产生过锐光晕；表面干净可读；颜料层纯净均匀。默认表面须保持干净精致：只用纯净罩染与克制的矿物颗粒。岁月、风霜或战痕仅在来源事实要求时作克制的叙事线索，须次要、不抢戏。电影级成片质量指干净的可读性与精致的工艺清晰度。 主体呈现为干净的平面剪裁,单一独立素材完整保持在画幅内,四周被空白透明度包围,轮廓至边缘清晰完整不断裂。 该图像具有alpha通道,背景是透明的。
```

### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,负向文本仍在链生成并预览,采样端不消费——[7016] Note 口径,与 1-4 型同)

> **构成标注(引文外)**:共 388 字,以「, 」连接两段——首段=**多视图型负面 202 字**(真源 qi21_bases.json 多视图条 negative_text 逐字,程序化核 in finalNeg=True;与美宣型负面 202 字**逐字节全等**(同为褶网系+发系+鞋靴系块,程序化 `==` 核 True——人物族型共享同款型负面));次段=锁层负面段 186 字(**与 4 型拍跨型逐字节全等**,md5 `5fd2241467d1af2e6fd1a09e5ba693ff`;含「, 」前缀整段)。全串与 4 型美宣拍 finalNegative **逐字节全等**(md5 `28f123671bbfb89bb876cbbd10b6077c`),跨型一致性程序化核 True。[404] 负向主体句保存态空(主体句负面第三源为空段,与保存态一致)。**本型负面清单同样无任何透明底指令**(§7⑤)。

```
模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，扇贝状/破损/分叉的裙摆或袍摆，分叉袍摆，分离的飘带状下摆条，下摆缺角，风碎流苏，乞丐破衣，撕裂下摆，碎边，破洞，磨损补丁，虫蛀布面，垂挂碎条，绳捆破布，刻意破烂造型，拉扯衣袍，分裂衣袍，分叉衣袍，破破烂烂，剃净头皮，透明头皮，无发干净圆顶，女性高跟鞋，细高跟，尖头女鞋，精巧女舞鞋，细带玛丽珍鞋，男性超大号通用工靴，异装鞋靴, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
```

## 2. 时间账

| 事件 | 时刻(CST) |
|---|---|
| graphToPrompt 干跑+投前断言 12 项全绿 | 10:56:55 |
| POST /prompt 受理(tQueue) | 2026-10-06T02:56:55.805Z |
| 进入 running(tRunningSeen) | 2026-10-06T02:56:55.829Z(排队等待≈24ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06 11:02:06 |
| 2K 落盘(引擎侧 mtime) | 2026-10-06 11:03:42 |
| 终态 success(tDone) | 2026-10-06T03:03:45.736Z |

**排队→出图 = 6.83 分钟**(durationMin,实测;含 PE 9B 模型新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大;预算 38min 帽内;耗时与 2 型(6.9)/3 型(6.72)/4 型(6.89)同量级)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode) | 保存态 |
| seed | **0**([7:7014].inputs={"value": 0};[7:7013].seed=["7:7014",0] 连线) | **=保存态,未动**(本拍 29/30 新鲜,无裁定① 破缓存需要) |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors,positive←[4015,0],latent←[4,0],seed←[7:7014,0]) | 档0 口径(FACTS §1 档位表;7010/7012 两支路在图未选,日志摘要双 KSampler 行仍在=两支路加载器在拍,采样走 7013) |
| 分辨率 | **1712×2560(竖幅 2:3,4.38MP)**;[4].width/height=["4018",0/1] 连线驱动 | **PE建议路**——PE 段行0 自报「A **vertically oriented**, full-body fantasy portrait」;**wh_ratio 探针本型未拍**(§9⑤),归因证据=排队图连线断言([4018].wh_ratio←[6:4021,1]←[6:4013,2] PE路)+实测 1712×2560 与 2:3 公式唯一命中(4018 建议路恒锚 4.2MP,my_qi21_wh_suggest.py:2-10;2:3 精算宽=2·sqrt(4.2·1024²/6)=1713→1712=107×16 恰 /16 对齐;**3:4 型线精算宽≈1816-1824≠1712**)+先例 4 型 §3 探针 ac5735bc 同公式实测 "2:3" 同数。**型 canon=3:4 (Portrait Standard) 4.2MP(qi21_bases.json 多视图条 aspect_ratio)**——方向同为竖幅,比例被 PE 建议路改写(3:4→2:3,归因证据链=本行上引+§4 实测分辨率) |
| 透明 | **跟型=true 在链生效**:[6:4010].透明覆盖=false+rgba_default=true(多视图,真源 qi21_bases.json 程序化核对)→[6:4014] 透明模式←[6:4010,3] 透明值口→透明模式=开,最终正向**透明三重指令全在**(头句/W1收束句/尾句各恰 1 次,程序化计数;**注:多视图型 BASE(=人物立绘块 473 字)无透明末句,链上透明指令=三重,比 3 型道具拍(四重)少一重**——§7③) | **透明门红**(四角实测全 255,§4/§7) |
| PE | [6:4013] QwenImage21_T2IPromptRewrite,pe_t2i 权重(qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors;本拍 TE 加载器级缓存([4019] 唯一缓存件);改写本体=新鲜推理(seed=42/temp=1.0/top_p=0.95/top_k=20/pp=1.5/max_new_tokens=16256,history 回读=与 3/4 型拍同参同值)) | 输出=本拍新鲜改写(§1②) |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 四角 alpha | 引擎侧原文件(mtime) |
|---|---|---|---|---|---|
| [8] 直出 | `images/type-5-多视图.direct.png` | 8,296,120 | 1712×2560 RGBA | **[255, 255, 255, 255](4/4 角全不透明,透明门红原始证据)** | QI21道劫文生图__00110_.png(11:02:06) |
| [504] 2K | `images/type-5-多视图.2k.png` | 10,776,016 | 2048×3062 RGBA | **[0, 255, 255, 188]** | MYStudio-2K_00031_.png(11:03:42) |

(2K=SeedVR2 短边2048 放大;1712×2560→2048×3062,比例保持≈0.667=2:3,与 2/3/4 型拍同规格放大链。)

### 补充 alpha/亮度落点实测(引擎 venv PIL+numpy,现场跑;**alpha 分布=透明门定量证据(§7),亮度/色彩=型级观察佐证(§8),非门)**

| 指标(直出 [8];2K [504] 见备注) | 实测 |
|---|---|
| alpha==0 占比 | **0.00%**(2K 0.02%=放大边缘插值残量) |
| alpha<8 占比 | **0.00%**(2K 0.02%) |
| alpha>250 占比 | **100.00%**(2K 99.84%) |
| alpha==255 占比 | 75.75%(2K 96.13%;其余为 251-250 半透明过渡带,无真透明区) |
| 逐行 alpha255 占比(2%→98% 采样行) | 98%/81%/89%/81%/78%/60%/30%(顶部最满,底部渐薄但**无一行 alpha0>0%**——底部只是半透明暗影,非透明底) |
| 四角+中心 RGB(直出) | 左上(26,22,14)/右上(16,13,8)/左下(65,61,64)/右下(81,80,76)/中心(50,48,47)——全暗色场景像素(与 PE 自报 palette 命中,§7④) |
| 均值亮度/中位(直出) | 104.7/76.6(暗像素<60 占 42.4%,中暗<120 占 61.8%,亮>200 占 15.9%=山雾发光区) |
| 石青/青蓝(b>r+15 且 g>r+15 且 b>40) | **0.00%** |
| 青绿(g>r+15 且 g>b+10 且 g>40) | **0.00%** |
| 赭石(暖中亮,r>100 且 r>g+10 且 g>b+5) | 6.45%(木柱/哑铜金属系) |
| 旧金(r>120 且 g>80 且 r>b+40 且 g>b+20) | 0.40% |
| 朱红(r>120 且 r>g+40 且 r>b+40) | 0.01% |
| 淡墨冷中性(|r-g|<12 且 |g-b|<12 且 60<lum<180) | 27.2%(「black, charcoal, gunmetal gray」主色带) |

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 34-36,原文逐字;全量JSON 行 6473 字符见存档)

```
[MY出图][入队][2026-10-06 10:56:55] number=10 prompt_id=c972ae02-8ccb-4678-b663-a19b23f70f1f
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safatenso… ×1.0 | KSampler: seed=['7:7014', 0] cfg=1.0 steps=6 sampler=euler scheduler=simple denoise=1.0 | KSampler: seed=['7:7014', 0] cfg=4.0 steps=40 sampler=euler scheduler=simple denoise=1.0
```

(摘要行为源日志行逐字全文——行内「safatenso… ×1.0」省略号是引擎侧日志钩子对 LoRA 文件名的原生截断,在源行内,非本记录截断;与 1-4 型拍摘要行逐字符相同(同形属预期)。[全量JSON] 行 6473 字符全文见 `logs/type-5-多视图.image-prompts.excerpt.log`。本拍=当日产线日志第 12 条入队(number=10;序号序列 0,0,0,1,2,3,4,5,6,7,9,10——缺 8,服务端序号器口径无对应入队行,如实记;number=9=4 型 wh 探针 ac5735bc(10:43:40),**该探针在产线日志有行**——对 4 型记录 §3「探针不入产线日志」句的实况勘正,§9⑤)。)

## 6. 与保存态偏差

**无。**两处改动恰为任务书允许的两处:

1. 型选择:人物→**多视图**([6] 宿主面板 widget;投前排队图断言 [6:4010].base=「多视图」✓;型底座 BASE 473 字逐字进装配 §1③)。
2. 主体句:[400] value→**多视图 canon 77 字**(逐字,md5 对拍✓;改前=147 字人物句)。

其余全保存态:PE启用?=true / 透明未动([6:4010].透明覆盖=false) / 速度档位=0 · Fun-Acc 4步 / seed=0 / [404] 负向主体句空——改前改后读回逐项一致(driver S7 五读回门全绿+投前 12 断言全绿,含 D5 三闸/BASE←型底座/锁层A 739 字逐字/主体句源 canon 全文逐字)。

## 7. ★ 透明门红——根因定谳(证据链)

**现象**:多视图 rgba_default=true(FACTS §2 对账;真源 qi21_bases.json 多视图条 rgba_default=true 程序化核对)→ 任务书加验四角 alpha=0 → 实测四角 [8]=**[255,255,255,255](4/4 角全不透明)**、[504]=[0,255,255,188],**全图 alpha>250 占比 100.00%、alpha<8 占比 0.00%**——比 3 型道具(2/4 角不透明/整幅 90.6% 不透明/底部尚余 ~10% 透明带)**更彻底,连透明残量都没有**;FAIL。

**链路取证(链是通的)**:
1. **透明机制=纯提示词驱动**:`my_qi21_final_output.py:190-193` compose 在透明模式=true 时仅做文本包裹(头句+装配全文+W1收束句+尾句),**全管线无任何 alpha 后处理抠图/rembg**——是否真出透明底全凭模型对提示的服从性(与 3 型 §7 同款取证)。
2. **跟型连线在拍**:[6:4014].透明模式←[6:4010,3](透明值口;型≠自由→透明值=rgba_default=true,`my_qi21_base.py:259-279`;投前排队图断言「[6:4010].透明覆盖=false」✓)。
3. **包裹已生效(三重全在)**:最终正向含头句「这是一张带有透明度的RGBA图像。」(行0)+W1收束句「主体呈现为干净的平面剪裁,单一独立素材完整保持在画幅内,四周被空白透明度包围,轮廓至边缘清晰完整不断裂。」+尾句「该图像具有alpha通道,背景是透明的。」(锁层A 后 74 字段)——**三重透明指令各恰 1 次,全在正向**。注:3 型道具拍是四重(BASE 末句另有「图为带透明通道的 RGBA 透明底图，背景透明。」);**多视图型 BASE=人物立绘块(473 字)无透明末句,链上透明指令比 3 型少一重**——透明指令冗余度更低,但 3 型四重也失效,指令数量非决定性变量。

**根因(直接证据)**:PE启用?=true(保存态)⇒ 主体句过 QwenImage21_T2IPromptRewrite(pe_t2i)——**PE 扩写通篇开出了完整建筑场景叙事且自报暗色 palette**(§1②):
- 段0 行0:「standing centered in **a dark stone doorway or temple entrance**」——人物被放进石门殿口;
- 段1:「**The upper background is filled with misty, towering mountain peaks** in cool gray-blue tones, partially obscured by atmospheric haze. **Dark wooden pillars frame the scene on both the far left and far right edges**…**Heavy iron chains hang along both sides of the doorway**…」——上背景山雾+两侧木柱+铁链;
- 段4:「**The ground occupies the lower portion of the image** and consists of **uneven stone slabs** in gray and slate tones…**Soft shadows from the warrior's boots spread across the floor**」——石板地面+人物投影(投影存在=实底场景叙事,与透明底直接互斥);
- 段5 palette 自报:「subdued and desaturated, **dominated by black, charcoal, gunmetal gray, muted bronze, weathered brown, and cold misty blue-gray**」——与实测色锚命中(§4 石青/青绿 0.00%/淡墨冷中性 27.2%/四角+中心全暗 RGB)。

模型(PDD T8 FunAcc 4步)在三重中文透明指令 vs 英文扩写建筑场景叙事的冲突中**完全跟随了后者**——整幅 100.00% 像素 alpha>250,0.00% 像素 alpha<8;3 型尚余底部 ~10% 高度带透明,本型**连边缘残量都没有**(逐行实测底部行仅 alpha255 占比降至 30%,为半透明暗影而非 alpha=0 真透明)。**且主体句 canon 侧「禁写背景物象」纪律(docs §5 0927 多视图轮军令①)对 PE 扩写不生效——canon 主体句自身确实零背景物象(① 逐字核),但 PE 改写环节自由补全了环境叙事,透明底公式路在现行链形上没有独立通道**(docs §5 的「RGBA 官方公式路+[40:143] 直塞纯英文公式短文」为 0927 旧管线口径,现行工作流为 [6:4014] 文本包裹路,FACTS §1 现役件口径)。

**跨拍对照(透明型连续两红;先例全部异组合)**:

| 拍 | 型 | PE | 档/seed | 分辨率 | alpha 结果 |
|---|---|---|---|---|---|
| 1004 cfg4(pid af50c297,10-04) | 道具 | **中文 PE(MyQi21ChinesePE)** | 档1 直出40步/cfg4,seed=4103 | 2800×1568 | **alpha0 占比 76.5%,alphaOk=true**(合格透明;负向含「保持透明底(以灰白棋盘格示意)」) |
| dedup(b3d8647 先例,pid 7b39fb65,10-05 16:30) | 道具 | **false(关)** | FunAcc 4步,seed=1(破缓存) | **1024×1024**(=道具型底座回退臂 1:1@1.0MP) | **四角 alpha=[0,0,2,0] 全≤8,PASS**(20/20 全过) |
| 本役 3 型(pid fc46aba4,10-06 10:08) | 道具 | **true(开,保存态,官方英文 pe_t2i)** | FunAcc 4步,seed=0(保存态) | 2560×1712(=PE建议 3:2@4.2MP) | **四角 [255,255,1,0],2/4 角不透明,FAIL**(整幅 90.6% 不透明,底部余 ~10% 透明带) |
| 本役 4 型(pid ad8280e7,10-06 10:31) | 美宣 | true(开,保存态) | FunAcc 4步,seed=0(保存态) | 1712×2560(=PE建议 2:3@4.2MP) | 非透明型(rgba_default=false),无门 |
| **本拍(pid c972ae02-8ccb-4678-b663-a19b23f70f1f,10-06 10:56)** | **多视图** | **true(开,保存态,官方英文 pe_t2i)** | FunAcc 4步,seed=0(保存态) | 1712×2560(=PE建议 2:3@4.2MP) | **四角 [255,255,255,255],4/4 角全不透明,FAIL(整幅 100.00% alpha>250,0.00% alpha<8,透明残量=零)** |

即:**「透明型×PE启用?=true(官方英文 pe_t2i)×FunAcc 档0」组合实弹门测二连红(道具 2/4 角红→多视图 4/4 角红且形态加重)**;先例合格的两种组合(中文 PE×cfg4 / PE 关×FunAcc)均已不在现行工作流保存态上。现行负向链(型负面 202+锁层负面 186)亦无透明底指令(§1③′;1004 时代中文 PE 负向有「保持透明底」句,且该拍合格)。

**判读与边界(如实)**:
- 这是**产品线在保存态默认组合下的透明交付能力问题**,非本役驱动/取证缺陷——恰为九型实弹战役要抓的型级风险;**透明四型(道具/多视图/高清人脸/表情差分)中已测两个(道具/多视图)双双透明门红,剩余 高清人脸/表情差分 两型同类风险高,且无「BASE 透明末句」冗余的高清人脸型链上透明指令可能同样只有三重**。
- 本役受任务书「恰两处改动」约束,无合规通道在本拍内验证缓解组合(PE启用?=false 为第三处改动=越权;裁定① seed 破缓存通道仅授权于全缓存回声场景,本拍非回声(1/30),不适用,且换 seed 属门值重掷非根因修复——PE seed=42 恒参下改写输出主要由主体句驱动,主体句已为 canon 逐字,无操纵空间)。
- 产物图按机器判据(存在/>0字节/PNG 可解析/三层收据)全数在档合格,**仅透明门红**;产物图与全部收据保留现场,未做任何补救性重投。

## 8. 机器判据(后核 `verify/type-5-多视图.postcheck.json`,exit=1,17/18;**权威判=后核**)
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=c972ae02-8ccb-4678-b663-a19b23f70f1f |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=1/30 |
| ✅ | seed 回读=[7:7014] | {"value": 0} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,504 |
| ✅ | 产物图存在且>0字节([8] type-5-多视图.direct.png) | 8296120B |
| ✅ | PNG 魔数([8]) |  |
| ✅ | PNG 可解析(PIL,[8]) | {"mode": "RGBA", "size": [1712, 2560], "metaLen": 11812, "metaMd5": "bcd6da80bdfd480605de681d485752d8", "cornerAlpha": [255, 255, 255, 255]} |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=11812 |
| ✅ | 产物图存在且>0字节([504] type-5-多视图.2k.png) | 10776016B |
| ✅ | PNG 魔数([504]) |  |
| ✅ | PNG 可解析(PIL,[504]) | {"mode": "RGBA", "size": [2048, 3062], "metaLen": 11812, "metaMd5": "bcd6da80bdfd480605de681d485752d8", "cornerAlpha": [0, 255, 255, 188]} |
| ❌ | 透明门:四角 alpha<=8(FACTS rgba_default 型) | [0, 255, 255, 188] |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=11812 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=5840 negLen=388 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:34 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:34 起 3 行 |

| — | 透明门结论 | **红**:任务书口径「四角 alpha=0」同判 FAIL(0/4 角达标);战役门(b3d8647 口径四角≤8)同判 FAIL(0/4 角达标)——**透明四型二连红**(3 型道具红→本型多视图红,§7) |

## 9. 勘误与标注(工具链,不影响判据)

- **驱动器原始终判红=1-4 型同款收割 bug 假红(两项)**:「PNG 元数据=history prompt」不剥节点级 `is_changed` 指纹(pngMd5=729a8ca8…≠histMd5=fd5a1d1e…)→后核剥指纹后稳态同✅(唯一差异域=6:4010,与 1-4 型同);其「★ 终判」为该项级联。驱动器真实 exit=1(DRIVER_EXIT=1,以重定向+追加方式捕获,`logs/type-5-多视图.driver.console.log` 尾行自证);本型**权威终判=后核 exit=1**——驱动器假红两项不计红,透明门一项计红(§7)。
- **R.prompts.peRewrite 只含装配首行**(driver:335 取 finalPos.split("\n")[0],按首个 \n 切,6 段体只留段0 共 688 字,含透明头句——该字段的切界方式对多段体天然失真,3/4 型同款):本拍 PE 扩写为 6 段多行体(4534 字),§1② 改用「BASE 473 字逐字对拍真源」从装配终稿定界切出完整段引用并记 md5 530698ad94d580332d2040c9182bc937,并做结构校验和核对(头句18+PE段4534+1换行+BASE473+1换行+锁层A739+W1透明收束段74=5840 ✓,引文逐字含在校验集内)。/tmp/type5-pe-full.txt 临时件与 §1② 同文。
- **[6:4020] PE思考预览不随 history outputs 回放**(outputs 键=[8,401,504,505])——与 1-4 型拍现象一致,系本代工作流该件 UI 输出回收行为;PE 改写输出溯源=装配终稿内段逐字(§1②)。
- **[4019] 为本拍唯一缓存件**(PE TE 加载器;1/30 cached)——模型加载器级缓存,不影响 6:4013 改写本体新鲜性(改写输入=本拍新主体句)。
- **wh_ratio 探针本型未拍**:归因证据链已足(§3——排队图连线断言+实测 1712×2560 与 2:3 公式唯一命中+PE 段自述 vertically oriented+先例 4 型 §3 探针 ac5735bc 同公式实测 "2:3" 同数);避免再开独立三节点拍。**账目勘正(如实)**:4 型记录 §3 称其探针拍「不入产线日志」——本役日志实测 ac5735bc 在 image-prompts-20261006.log 行 31(number=9,10:43:40)**有入队行在案**,探针拍(带保存节点与否均)入产线日志,该句与实况不符,以本役实测为准(对 5-9 型后续役的日志序号账先验)。
- **产线日志序号账**:本拍 number=10(当日第 12 条入队;序号序列 0,0,0,1,2,3,4,5,6,7,9,10——**缺 8**,服务端序号器口径,日志内无对应入队行,如实记不推测)。
- **分辨率机制链含推断标注**:2:3 公式唯一命中(1712=107×16 恰 /16 对齐/3:4 型线精算宽≈1816-1824≠1712)沿用 4 型 §3 探针实证口径(本型未重拍探针);其余环节(PE建议路在拍/排队图连线断言/4.2MP 公式真源 my_qi21_wh_suggest.py:2-10)全为实测或代码引证。
- **人眼复核未做**(本会话无视觉输入,如实声明,与 3/4 型同款口径):图像内容判读全部基于像素统计(alpha/亮度/色锚/逐行)+PE 文本自报对照;「是否同一人/四件套是否逐项在场」类部件级判读未做——但透明门判据(四角 alpha/全图 alpha 分布)为纯机器判据,不受此限。

## 10. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-5-多视图.image-prompts.excerpt.log` | 源 image-prompts-20261006.log行 34-36(入队+摘要+全量JSON) |
| ② PNG 元数据 | `verify/type-5-多视图.png-prompt-metadata.json` | tEXt prompt(11,812B,30 节点,剥 is_changed 后与 history 稳态同;metaMd5=bcd6da80bdfd480605de681d485752d8) |
| ③ history prompt JSON | `runs/type-5-多视图.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-5-多视图.json` | 断言 12 项/读回前后/改动两笔/时间账(终判红=§9①假红×2,权威判据见 §8) |
| 驱动控制台 | `logs/type-5-多视图.driver.console.log` | 全程日志(DRIVER_EXIT=1 自证=假红级联;后核 POSTCHECK_EXIT=1 追加自证=透明门红) |
| 后核 | `verify/type-5-多视图.postcheck.json` | 机器判据权威判(17/18,透明门红,exit=1) |
| 产物图 | `images/type-5-多视图.direct.png` / `images/type-5-多视图.2k.png` | §4(1712×2560 RGBA 竖幅 2:3 / 2048×3062 2K;四角 alpha=255,255,255,255 / 0,255,255,188——透明门红的原始证据) |
| 主体句 canon | `/tmp/type5-subject-canon.txt`(临时)+ 本记录 §1① 全文引 | 77 字 md5 5aa333feaae436fb974053ee4a4d1233 |
| PE 扩写全文 | 本记录 §1② 全文引(+ /tmp/type5-pe-full.txt 临时件,md5 530698ad94d580332d2040c9182bc937) | 4534 字(6 段) |
