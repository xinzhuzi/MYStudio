# 实弹记录 · 第 4/9 型「美宣」(type-4-美宣)

**结果:✅ 机器判据全绿**(权威后核 `postcheck_type.py type-4-美宣` exit=0,18/18 项;非透明型,无透明门;判据明细见 §7)

- 日期:2026-10-06(排队 10:31:23 → 终态 10:38:17 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,manifest port=17000,comfyui 0.38.0/mps,投前投后 ps 复核同一进程)——**复用现役,非本 run 所起(engineStartedByUs=false)**
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,115,614B,根节点 20,与 FACTS §1 同版;**实弹后真源复核未变**(md5/mtime 仍 00:35:30/115614B,`git status --porcelain -- apps/backend/engines/comfyui/workflows/ apps/backend/engines/comfyui/my_nodes/` 空输出),仓库保存态保持)
- 主体句:111 字,md5 `fd458160f19f91832186498c57847e96`——**三源逐字一致**(docs/prompts/道劫_九型主体句示例.md §4(终极真源,程序化 `in doc=True`)/ /tmp/qi21-ninetype-1004/ninetype_driver.mjs:50(FACTS §2 出处)/ /tmp/qi21-ninetype-1004/report-run1-types1to4.json shots[3].subject(1004 cfg4 实拍账);canon 落 /tmp/type4-subject-canon.txt)
- prompt_id:`ad8280e7-62cf-4cd7-81b7-c266f18a1c6a`;client_id:`qi21-9xing-4-1791253883664`
- **与保存态偏差:无**——恰两处改动=型选择(人物→美宣)/[400] 主体句(147字人物句→111字美宣 canon);seed=0 保存态未动;**29/30 节点新鲜执行**(仅 [4019] PE TE 加载器模型级缓存,与 2/3 型同款),零缓存回声,无需 1 型裁定① seed 破缓存通道(美宣在新版工作流上无先前同参拍,预判成立)
- 引擎队列投前空(running=0/pending=0,独占跑拍)

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;canon=/tmp/type4-subject-canon.txt,md5 fd458160f19f91832186498c57847e96,111 字)

```
雷劫降临的至暗时刻，白衣剑修独立孤峰之巅，长发高束马尾，束发紧实，腰束石青丝绦、暗红剑穗，周身剑气化作金色光罩，九道紫雷自翻墨般的劫云中劈落，他在最后一瞬反身拔剑迎击，衣袍与剑穗在罡风中猎猎狂舞；远景群山在雷光明灭中沉浮。
```

### ② PE 改写输出(装配终稿前段全文=[6:4013].positive_prompt 经 [6:4021] 选定入装配;PE启用?=true 保存态;共 4514 字、英文 5 段、段间以空行分隔——PE 模型原生分段;md5 `eef78a57c111e0495e8bfe0cf7e093e3`)

> **溯源标注(引文外)**:本段为**本拍新鲜推理**——6:4013 在本拍新鲜执行名单(29/30 节点新鲜;仅 6:4019 PE TE 加载器模型级缓存,不影响改写本体新鲜性,输入=本拍新主体句)。本段按「BASE 473 字逐字对拍真源(qi21_bases.json 美宣条 positive_text)」从装配终稿定界切出(2/3 型 §8/§9 同款方法;驱动器 R.prompts.peRewrite 字段仅截装配首行,非全段)。**⚠️ 行0 自报画幅「A dramatic vertical fantasy illustration」——竖幅**,与型 canon 21:9 Ultrawide 相悖(型级观察一,§8①)。[6:4020] PE思考预览件不随 history outputs 回放(outputs 键=[8,401,504,505],thinkLen=0),与 1/2/3 型拍现象一致。

```
A dramatic vertical fantasy illustration shows a lone male-presenting warrior-like figure standing on the jagged summit of a dark rocky mountain peak beneath an immense storm sky. The upper portion of the image is dominated by towering, turbulent thunderclouds in deep charcoal, black, slate gray, and muted violet tones, with dense billowing textures and strong chiaroscuro shading. Bright white-purple lightning bolts cut downward from multiple points across the sky: one enters from the upper-left edge and forks diagonally toward the center-left; another descends near the central area behind the figure; several more strike from the upper-right and mid-right regions, creating branching arcs with glowing cores, soft purple halos, and intense rim light that illuminates the surrounding clouds. The overall sky has a cinematic, high-contrast look, with small warm breaks of light visible in some cloud gaps near the upper-right and upper-center areas.

In the central-lower portion, the figure stands with his back turned toward the viewer, occupying roughly the middle third of the composition. He appears slender and athletic, dressed in flowing ancient East Asian-style robes or martial fantasy garments. His clothing is primarily white and silver-gray, layered with long sleeves, wrapped fabric, belts, cords, and trailing scarves. The garments have a weathered, wind-torn texture, with many ribbon-like strips extending outward in different directions. Around his waist, a stone blue silk belt and a dark red sword tassel stand out clearly against the pale fabric. A very high, tightly bound ponytail streams backward and outward in the storm wind, rendered as thin, detailed strands catching highlights from the lightning and the golden energy around him. His visible head and face are mostly obscured by the rear-facing pose and sweeping hair, so facial features and expression are not clearly readable. His posture is tense and dynamic: he leans slightly backward and turns his upper body toward the left side of the frame while gripping a long sword raised diagonally upward in his right hand. The sword has a bright metallic blade, ornate hilt, and decorative streamers or tassels trailing behind it, suggesting motion and battle readiness.

Surrounding the figure is a large translucent golden energy sphere or protective aura, centered around his body and extending across much of the lower-middle frame. The sphere is nearly circular but subtly distorted by perspective and overlap with the terrain, with a thin luminous rim in warm gold and amber. Inside and along the edge of the sphere, fine crackling lines, sparks, and lightning-like filaments create a magical plasma effect. The sphere partially blocks the view of the distant valleys behind him and overlaps visually with the lightning strikes outside its boundary, making the golden barrier appear to resist or absorb the storm’s electrical forces. Its warm glow contrasts strongly with the cold purple-white lightning and dark mountainous environment.

The foreground consists of a steep, uneven, dark stone peak with rough cracks, sharp ridges, small tufts of dry grass, and moss-like textures along the edges. The warrior stands near the highest point of this crag, silhouetted against the brighter storm light beyond. On both sides of the lower frame, mist and low clouds drift through additional rocky formations, including smaller pointed cliffs on the left and right. In the far background, layered mountain ranges recede into atmospheric haze, colored in cool gray-blue and desaturated green tones. The valleys are filled with fog, giving the landscape great depth and scale. The lighting is highly theatrical: cold violet lightning illuminates the clouds and edges of the figure, while the golden aura casts warm highlights onto the robes, rocks, and airborne particles.

The composition uses a low-angle heroic viewpoint, looking upward from behind the character toward the storm-filled sky. The central figure, sword, and golden energy dome form the focal axis, while the lightning bolts radiate around them like a circular threat. The palette is dominated by black, gray, violet, white, gold, and muted earth tones. The visual style is painterly digital fantasy art with realistic detail, cinematic lighting, volumetric clouds, dramatic motion blur in the fabric and hair, and epic xianxia-inspired imagery. The scene conveys tension, isolation, supernatural power, and a climactic confrontation with a violent celestial storm.
```

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 5728 字 = PE 扩写 4514 + 1 换行 + 型底座 BASE 473(逐字=qi21_bases.json 美宣条 positive_text,含稀疏结构褶/头发存在/鞋靴性别/衣物完整性四道增量锁) + 1 换行 + 锁层A 739;行序=PE 扩写 5 段→空行→型底座七行(主体立绘句/衣褶裙摆/材质朴素/头发存在/鞋靴性别/设色配比/衣物完整性)→锁层A)

```
A dramatic vertical fantasy illustration shows a lone male-presenting warrior-like figure standing on the jagged summit of a dark rocky mountain peak beneath an immense storm sky. The upper portion of the image is dominated by towering, turbulent thunderclouds in deep charcoal, black, slate gray, and muted violet tones, with dense billowing textures and strong chiaroscuro shading. Bright white-purple lightning bolts cut downward from multiple points across the sky: one enters from the upper-left edge and forks diagonally toward the center-left; another descends near the central area behind the figure; several more strike from the upper-right and mid-right regions, creating branching arcs with glowing cores, soft purple halos, and intense rim light that illuminates the surrounding clouds. The overall sky has a cinematic, high-contrast look, with small warm breaks of light visible in some cloud gaps near the upper-right and upper-center areas.

In the central-lower portion, the figure stands with his back turned toward the viewer, occupying roughly the middle third of the composition. He appears slender and athletic, dressed in flowing ancient East Asian-style robes or martial fantasy garments. His clothing is primarily white and silver-gray, layered with long sleeves, wrapped fabric, belts, cords, and trailing scarves. The garments have a weathered, wind-torn texture, with many ribbon-like strips extending outward in different directions. Around his waist, a stone blue silk belt and a dark red sword tassel stand out clearly against the pale fabric. A very high, tightly bound ponytail streams backward and outward in the storm wind, rendered as thin, detailed strands catching highlights from the lightning and the golden energy around him. His visible head and face are mostly obscured by the rear-facing pose and sweeping hair, so facial features and expression are not clearly readable. His posture is tense and dynamic: he leans slightly backward and turns his upper body toward the left side of the frame while gripping a long sword raised diagonally upward in his right hand. The sword has a bright metallic blade, ornate hilt, and decorative streamers or tassels trailing behind it, suggesting motion and battle readiness.

Surrounding the figure is a large translucent golden energy sphere or protective aura, centered around his body and extending across much of the lower-middle frame. The sphere is nearly circular but subtly distorted by perspective and overlap with the terrain, with a thin luminous rim in warm gold and amber. Inside and along the edge of the sphere, fine crackling lines, sparks, and lightning-like filaments create a magical plasma effect. The sphere partially blocks the view of the distant valleys behind him and overlaps visually with the lightning strikes outside its boundary, making the golden barrier appear to resist or absorb the storm’s electrical forces. Its warm glow contrasts strongly with the cold purple-white lightning and dark mountainous environment.

The foreground consists of a steep, uneven, dark stone peak with rough cracks, sharp ridges, small tufts of dry grass, and moss-like textures along the edges. The warrior stands near the highest point of this crag, silhouetted against the brighter storm light beyond. On both sides of the lower frame, mist and low clouds drift through additional rocky formations, including smaller pointed cliffs on the left and right. In the far background, layered mountain ranges recede into atmospheric haze, colored in cool gray-blue and desaturated green tones. The valleys are filled with fog, giving the landscape great depth and scale. The lighting is highly theatrical: cold violet lightning illuminates the clouds and edges of the figure, while the golden aura casts warm highlights onto the robes, rocks, and airborne particles.

The composition uses a low-angle heroic viewpoint, looking upward from behind the character toward the storm-filled sky. The central figure, sword, and golden energy dome form the focal axis, while the lightning bolts radiate around them like a circular threat. The palette is dominated by black, gray, violet, white, gold, and muted earth tones. The visual style is painterly digital fantasy art with realistic detail, cinematic lighting, volumetric clouds, dramatic motion blur in the fabric and hair, and epic xianxia-inspired imagery. The scene conveys tension, isolation, supernatural power, and a climactic confrontation with a violent celestial storm.
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

> **构成标注(引文外)**:共 388 字,以「, 」连接两段——首段=**美宣型负面 202 字**(真源 qi21_bases.json 美宣条 negative_text 逐字,程序化核对 in finalNeg=True;含三簇增量负面=**褶网系**(密集褶网/撕裂下摆/分离飘带/风碎流苏/乞丐破衣…)+**发系**(剃净头皮/透明头皮/无发干净圆顶——0926 发锚役的对位禁令)+**鞋靴系**(女高跟/尖头女鞋/男超大工靴/异装鞋靴),系 0925/0926/0928 三轮锚定修复在真源的家);次段=锁层负面段 186 字(**与 2 型拍跨型逐字节全等**,md5 `5fd2241467d1af2e6fd1a09e5ba693ff`——以「, 模糊，水印，多手指，文字错误，网文封面美人」起,含跨段重复的基础负面串,整 token 去重不跨段合并)。[404] 负向主体句保存态空,主体句负面第三源为空段(与保存态一致)。

```
模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，扇贝状/破损/分叉的裙摆或袍摆，分叉袍摆，分离的飘带状下摆条，下摆缺角，风碎流苏，乞丐破衣，撕裂下摆，碎边，破洞，磨损补丁，虫蛀布面，垂挂碎条，绳捆破布，刻意破烂造型，拉扯衣袍，分裂衣袍，分叉衣袍，破破烂烂，剃净头皮，透明头皮，无发干净圆顶，女性高跟鞋，细高跟，尖头女鞋，精巧女舞鞋，细带玛丽珍鞋，男性超大号通用工靴，异装鞋靴, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
```

## 2. 时间账

| 事件 | 时刻(CST) |
|---|---|
| graphToPrompt 干跑+投前断言 12 项全绿 | 10:31:23 |
| POST /prompt 受理(tQueue) | 2026-10-06T02:31:23.664Z |
| 进入 running(tRunningSeen) | 2026-10-06T02:31:23.686Z(排队等待≈22ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06 10:36:42 |
| 2K 落盘(引擎侧 mtime) | 2026-10-06 10:38:16 |
| 终态 success(tDone) | 2026-10-06T02:38:17.252Z |

**排队→出图 = 6.89 分钟**(durationMin,实测;含 PE 9B 模型新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大;预算 38min 帽内;耗时与 2 型(6.9)/3 型(6.72)同量级)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode) | 保存态 |
| seed | **0**([7:7014].inputs={"value": 0};[7:7013].seed=["7:7014",0] 连线) | **=保存态,未动**(本拍 29/30 新鲜,无裁定① 破缓存需要) |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,model=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors,positive←[4015,0],latent←[4,0],seed←[7:7014,0]) | 档0 口径(FACTS §1 档位表;7010/7012 两支路在图未选,日志摘要双 KSampler 行仍在=两支路加载器在拍,采样走 7013) |
| 分辨率 | **1712×2560(竖幅 2:3,4.38MP)**;[4].width/height=["4018",0/1] 连线驱动(跟型/PE 画幅) | **PE建议路**——PE 自报「vertical」(§1② 行0)+**确定性探针实测 wh_ratio="2:3"**(pid `ac5735bc-a137-4afc-a60f-c7591247e9c2`,CLIPLoader(pe_t2i,type=qwen_image)+QwenImage21_T2IPromptRewrite(同排队图 6:4013 全参:seed=42/temp=1.0/top_p=0.95/top_k=20/pp=1.5/max_new_tokens=16256,主体句=①逐字)+easy showAnything(pe出2);status=success,输出="2:3",与 3 型 §8⑤ 同款探针法)。4018 建议路恒锚 4.2MP(round(a·sqrt(4.2·1024²/(a·b))/8)·8,my_qi21_wh_suggest.py:2-10 公式真源=子图[155][156] widgets)→宽 round(2·sqrt(4.2·1024²/6)/8)·8=1712 精算命中/高=2576→实测 2560=2576 经 /16 网格截 8(**推断**,与 2/3 型 §8④ 同款形态;宽 1712=107×16 恰 /16 对齐无截) |
| 透明 | **跟型=false 在链生效**:[6:4010].透明覆盖=false+rgba_default=false(美宣,真源 qi21_bases.json 程序化核对)→[6:4014] 透明模式←[6:4010,3] 透明值口→非透明型,最终正向**无透明三短语包裹**(程序化核:「这是一张带有透明度的RGBA图像」「主体呈现为干净的平面剪裁」「该图像具有alpha通道」各 0 次,与 2 型非透明拍同形态;对比 3 型透明拍四重包裹+头句) | 非透明型,无透明门 |
| PE | [6:4013] QwenImage21_T2IPromptRewrite,pe_t2i 权重(qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors;本拍 TE 加载器级缓存([4019] 唯一缓存件);改写本体=新鲜推理(seed=42/temp=1.0/top_p=0.95/top_k=20/pp=1.5/max_new_tokens=16256)) | 输出=本拍新鲜改写(§1②) |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 四角 alpha | 引擎侧原文件(mtime) |
|---|---|---|---|---|---|
| [8] 直出 | `images/type-4-美宣.direct.png` | 8,466,985 | 1712×2560 RGBA | [255, 255, 254, 254](全不透明,非透明型预期形态,不设门) | QI21道劫文生图__00109_.png(10:36:42) |
| [504] 2K | `images/type-4-美宣.2k.png` | 11,060,543 | 2048×3062 RGBA | [255, 255, 186, 190](同上;下两角 alpha<255 为 2K 放大边缘插值残量,非透明底) | MYStudio-2K_00030_.png(10:38:16) |

(2K=SeedVR2 短边2048 放大;1712×2560→2048×3062,比例保持≈0.667=2:3,与 2/3 型拍同规格放大链。)

### 补充色彩落点实测(引擎 venv PIL+numpy,现场跑;**非门,型级观察佐证,§8②)**

| 指标(阈值在括号内,ad-hoc 探针) | 直出 [8] | 2K [504] |
|---|---|---|
| 金/暖金(r>120 且 g>80 且 r>b+40 且 g>b+20) | **10.89%** | 10.76% |
| 紫·宽(b>r+10 且 b>=g+5,任意亮度) | 3.21% | — |
| 紫·冷调·亮度中上(b>r+10 且 b>=g+5 且 lum>80) | 2.26% | — |
| 紫·严格饱和(b>r+20 且 b>g+20 且 b>40) | **0.08%** | 0.07% |
| 石青/青蓝(b>r+15 且 g>r+15 且 b>40) | **0.00%** | — |
| 暗红·深(r>g+25 且 r>b+25 且 lum<90) | 0.07% | — |

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 28-30,原文逐字;全量JSON 行 6506 字符见存档)

```
[MY出图][入队][2026-10-06 10:31:23] number=7 prompt_id=ad8280e7-62cf-4cd7-81b7-c266f18a1c6a
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safatenso… ×1.0 | KSampler: seed=['7:7014', 0] cfg=1.0 steps=6 sampler=euler scheduler=simple denoise=1.0 | KSampler: seed=['7:7014', 0] cfg=4.0 steps=40 sampler=euler scheduler=simple denoise=1.0
```

(摘要行为源日志行逐字全文——行内「safatenso… ×1.0」省略号是引擎侧日志钩子对 LoRA 文件名的原生截断,在源行内,非本记录截断;与 1/2/3 型拍摘要行逐字符相同(同形属预期)。[全量JSON] 行 6506 字符全文见 `logs/type-4-美宣.image-prompts.excerpt.log`。)

## 6. 与保存态偏差

**无。**两处改动恰为任务书允许的两处:

1. 型选择:人物→**美宣**([6] 宿主面板 widget;投前排队图断言 [6:4010].base=「美宣」✓;型底座 BASE 473 字逐字进装配 §1③)。
2. 主体句:[400] value→**美宣 canon 111 字**(逐字,md5 对拍✓;改前=147 字人物句)。

其余全保存态:PE启用?=true / 透明未动([6:4010].透明覆盖=false) / 速度档位=0 · Fun-Acc 4步 / seed=0 / [404] 负向主体句空——改前改后读回逐项一致(driver S7 五读回门全绿+投前 12 断言全绿,含 D5 三闸/BASE←型底座/锁层A 739 字逐字)。

## 7. 机器判据(后核 `verify/type-4-美宣.postcheck.json`,exit=0,18/18)

| 判 | 项 | 实测 |
|---|---|---|
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=ad8280e7-62cf-4cd7-81b7-c266f18a1c6a |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=1/30(29 节点新鲜) |
| ✅ | seed 回读=[7:7014] | {"value": 0} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,401,504,505 |
| ✅ | 产物图存在且>0字节([8]) | 8,466,985B |
| ✅ | PNG 魔数+PIL 可解析([8]) | {"mode": "RGBA", "size": [1712, 2560], "metaLen": 12004, "metaMd5": "9dc4eb9c97490f25f7a04d12e0a5166c", "cornerAlpha": [255, 255, 254, 254]} |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12004 |
| ✅ | 产物图存在且>0字节([504]) | 11,060,543B |
| ✅ | PNG 魔数+PIL 可解析([504]) | {"mode": "RGBA", "size": [2048, 3062], "metaLen": 12004, "metaMd5": "9dc4eb9c97490f25f7a04d12e0a5166c", "cornerAlpha": [255, 255, 186, 190]} |
| ✅ | PNG 元数据=history prompt(剥指纹;[504]) | metaLen=12004 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=5728 negLen=388 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:28 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:28 起 3 行 |
| — | 透明门(四角 alpha≤8) | **不适用**——美宣非透明型(rgba_default=false,FACTS §2 对账;3 型道具已实测同款透明门组合风险,美宣不设此门) |

## 8. 型级观察与补充实测(如实记档,不构成机器判据;**5-9 型后续役的先验**)

### ① 画幅比:PE 建议路赢了型 canon——美宣拍出竖幅 2:3,canon 是 21:9 Ultrawide

- **型 canon 侧**:真源 qi21_bases.json 美宣条 `aspect_ratio="21:9 (Ultrawide)"`+`megapixels=4.2`(positive_text 内不含画幅字样);终极真源 docs/prompts/道劫_九型主体句示例.md:37 节头「**美宣(16:9/21:9 叙事瞬间,可拉高视觉强度)**」。
- **实拍侧**:PE 扩写行0 自报「A dramatic **vertical** fantasy illustration」(§1②);确定性探针 wh_ratio=**"2:3"**(§3);产物图 1712×2560 竖幅。
- **机制**:[4].width/height←[4018]←wh_ratio←[6:4021,1]←[6:4013,2](PE宽高比口)——**PE启用?=true(保存态)时 PE 建议路接管画幅**([4018] MyQi21WhSuggest 九型WIDTH/HEIGHT 输入在拍但被 PE 路盖过;排队图断言「宽高连线←[4018,0/1]」✓=链路形态断言,未断言终值方向)。2/3 型先例:PE 建议路 3:2 横幅(恰与场景/道具 canon 同向,未暴露分歧);**本型首次暴露 PE 建议与型 canon 画幅反向**。
- **判读边界(如实)**:这是**保存态管线(PE开)对型 canon 画幅的系统性改写**,非本役驱动缺陷——任务书恰许两处改动,PE启用?=false 为第三处改动=越权,本拍内无合规通道验证 PE关×美宣 组合(先例=3 型 §7 同款边界声明)。后续 5-9 型中**分镜剧情图(16:9)/概念气氛图(16:9/21:9)**同走 PE开保存态,画幅反向风险同类,留先验。

### ② 色彩落点:金罩强,紫雷去饱和,石青/暗红锚未落

- §4 表实测:金 10.89%(金罩主导,「周身剑气化作金色光罩」落图);紫严格饱和 0.08%/冷紫 2.26%——**紫雷以「white-purple」形态渲染**(PE 文本行0「Bright white-purple lightning bolts」自述),彩度紫接近零。
- **与终极真源自带注记对读**(docs/prompts/道劫_九型主体句示例.md:44,0925 锚):「原句色彩全押在『淡金色光罩』特效上…0925 直写批拍实锤紫雷零落色(全图紫相像素 0%);补强=色词落到实物(石青丝绦/暗红剑穗)+『淡金』升『金』」——**直写批曾实测紫 0%;本拍 PE开 批实测紫 0.08%**,同病延续;补强锚(石青丝绦/暗红剑穗)在 PE 扩写文本层有承接(§1② 段2「a stone blue silk belt and a dark red sword tassel stand out clearly」逐字在),但**像素层未落**(石青 0.00%/暗红 0.07%;细件小目标+阈值 ad-hoc,量级参考非精确判)。
- **张力注记**:PE 扩写段2 自述「garments have a weathered, **wind-torn texture, with many ribbon-like strips extending outward**」——与美宣型负面褶网系禁令(密集褶网/撕裂下摆/分离的飘带状下摆条/风碎流苏…)反向,而档0 FunAcc 无负槽禁令不消费;正向侧 BASE 473 内「衣褶/裙摆:使用宽幅平静布面,正面仅允许两到四条长结构褶」稀疏褶锚在拍(§1③)。**褶皱形态本役未做人眼复核**(本会话无视觉输入,如实声明),色彩统计不覆盖褶皱形态——5-9 型后续役如需褶皱判读须人眼或形态学补测。

### ③ 跨型一致性(账面对拍)

- 锁层A 739 字/锁层负面段 186 字——与 1/2/3 型拍逐字节全等(锁层负面段 md5 `5fd2241467d1af2e6fd1a09e5ba693ff`=2 型同值,跨型全等程序化核对)。
- 日志摘要行与 1/2/3 型逐字符相同(同形属预期,§5)。
- 耗时 6.89min 与 2 型(6.9)/3 型(6.72)同量级;产线日志第 7 条入队(number=7;前 6 条=00:38 E2E 拍+1 型 attempt1 缓存回声拍+1/2/3 型产线拍,本役 wh 探针为纯三节点零保存件拍不入产线日志,账目合)。

## 9. 勘误与标注(工具链,不影响判据)

- **驱动器原始终判红=1/2/3 型 §8/§9 同款收割 bug 假红(两项)**:「PNG 元数据=history prompt」不剥节点级 `is_changed` 指纹(pngMd5=a6fccbea…≠histMd5=68b6eaf5…)→后核剥指纹后稳态同✅(唯一差异域=6:4010,与 1/2/3 型同);其「★ 终判」为该项级联。驱动器真实 exit=1(DRIVER_EXIT=1,以重定向+追加方式捕获);本型**权威终判=后核 exit=0**——驱动器假红两项不计红,真判据 18/18 全绿。
- **R.prompts.peRewrite 只含装配首行**(driver:335 取 finalPos.split("\n")[0]):本拍 PE 扩写为 5 段多行体(4514 字),§1② 改用「BASE 473 字逐字对拍真源」从装配终稿定界切出完整段引用并记 md5 eef78a57c111e0495e8bfe0cf7e093e3(方法与 2/3 型 §8 同)。
- **[6:4020] PE思考预览不随 history outputs 回放**(outputs 键=[8,401,504,505];thinkLen=0):与 1/2/3 型拍现象一致,系本代工作流该件 UI 输出回收行为;PE 改写输出溯源=装配前段逐字(§1②)。
- **[4019] 为本拍唯一缓存件**(PE TE 加载器;1/30 cached)——模型加载器级缓存,不影响 6:4013 改写本体新鲜性(改写输入=本拍新主体句,输出经探针确定性交叉验证=§3 wh_ratio 同参同输出"2:3")。
- **wh_ratio 探针拍 ac5735bc-a137-4afc-a60f-c7591247e9c2 为本型记录内独立取证件**(非产线拍;仅 CLIPLoader+PE改写+showAnything 三节点,零写盘零产线节点,与 3 型 §8⑤ 同款;探针 CLIPLoader.type=qwen_image 为在拍件 6:4019 同值——首投 400 系手拼 type=chinese 拒答,当场弃拼读在拍值重投,账目如实)。
- **分辨率机制链含一处推断标注**:/16 网格截 8(2576→2560)未逐行核源,与 2/3 型 §8④ 同款口径;其余环节(PE建议路在拍/wh_ratio=2:3 探针实测/4.2MP 公式真源 my_qi21_wh_suggest.py:2-10/宽 1712 精算命中)全为实测或代码引证。
- **驱动器 check 名模板本型拍前已修**(2 型 §8 遗留项已在拍前修复,本型拍 12 断言名含「${TYPE_KEY}」渲染=美宣,正确)。

## 10. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-4-美宣.image-prompts.excerpt.log` | 源 image-prompts-20261006.log 行 28-30(入队+摘要+全量JSON) |
| ② PNG 元数据 | `verify/type-4-美宣.png-prompt-metadata.json` | tEXt prompt(12,004B,30 节点,剥 is_changed 后与 history 稳态同;metaMd5=9dc4eb9c97490f25f7a04d12e0a5166c) |
| ③ history prompt JSON | `runs/type-4-美宣.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-4-美宣.json` | 断言 12 项/读回前后/改动两笔/时间账(终判红=§9①假红×2,权威判据见 §7) |
| 驱动控制台 | `logs/type-4-美宣.driver.console.log` | 全程日志(DRIVER_EXIT=1 自证=假红级联) |
| 后核 | `verify/type-4-美宣.postcheck.json` | 机器判据权威判(18/18 全绿,exit=0) |
| 产物图 | `images/type-4-美宣.direct.png` / `images/type-4-美宣.2k.png` | §4(1712×2560 RGBA 竖幅 2:3 / 2048×3062 2K) |
| 主体句 canon | `/tmp/type4-subject-canon.txt`(临时)+ 本记录 §1① 全文引 | 111 字 md5 fd458160f19f91832186498c57847e96 |
| PE 扩写全文 | 本记录 §1② 全文引(+ /tmp/type4-pe-full.txt 临时件,md5 eef78a57c111e0495e8bfe0cf7e093e3) | 4514 字(5 段) |
| wh_ratio 探针 | /tmp/type4-whprobe.json(临时;pid=ac5735bc-a137-4afc-a60f-c7591247e9c2) | "2:3"(§3 分辨率机制链取证件) |
