# 实弹记录 · 第 6/9 型「高清人脸」(type-6-高清人脸)

**结果:❌ 透明门红——其余机器判据全绿(18/19),本型为透明型(FACTS rgba_default=true,真源 qi21_bases.json 高清人脸条程序化核对 rgba_default=true/aspect_ratio="1:1 (Square)"/megapixels=1.0),四角 alpha 门实测直出图 4/4 角全不透明([255,255,254,254]),2K 图 4/4 角全不透明([255,255,255,218]),直出整幅 100.00% 像素 alpha>250(0.00% 像素 alpha<8,连透明残量都没有),响亮失败;与 3 型道具(2/4 角红)/5 型多视图(4/4 角红)同款透明门红——**透明型三连红**(道具→多视图→高清人脸),仅剩表情差分未测**

- 日期:2026-10-06(排队 11:15:50 → 终态 11:22:03 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,manifest port=17000,comfyui 0.38.0/mps,与 FACTS §4.3 同一进程)——**复用现役,非本 run 所起(engineStartedByUs=false)**;投前队列空(running=0/pending=0,独占跑拍)
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,115,614B,根节点 20,与 FACTS §1 及 1-5 型记录同版;驱动器装载后画布根节点=20 复核同;引擎家活代码 my-nodes 与仓内逐字节同(本役 wh 探针2 顺带复核 my_qi21_wh_suggest.py 双家 md5 同=6c333ff8…))
- 主体句:197 字,md5 `70373a76f2b996d724d04767b6cfb36b`——**两源逐字一致 + canon 文件**(docs/prompts/道劫_九型主体句示例.md §6(终极真源,fenced 原文程序化抽取)/ /tmp/qi21-ninetype-1004/ninetype_driver.mjs:54(FACTS §2 出处,程序化 `==` 核 True)/ canon 落 /tmp/type6-subject-canon.txt(与 docs §6 逐字节相等))。FACTS §2 标签:透明四型之一;docs §6 注锚法=人脸主体句=人物句(§1)身份段**原样搬运**+特写取景段(同脸锚)+0926 构图锚四段+0927 色相锚轮/二轮定形(暖金顶光光晕只落发际肩线/背景一角青灰远山剪影淡入薄雾)
- prompt_id:`a00b747a-301e-432b-bd15-819538c072b7`;client_id:`qi21-9xing-6-1791256550491`
- **与保存态偏差:无**——恰两处改动=型选择(人物→高清人脸)/[400] 主体句(147字人物句→197字高清人脸canon);seed=0 保存态未动;**22/30 节点新鲜执行**(缓存 8 件=纯模型加载器[1/2/3/6:4019/501/502]+常量件[404 空串/7:7014 PrimitiveInt seed=0],**装配链与 PE 改写本体(6:4010/4011/4012/4013/4014/4021)全数新鲜**),零缓存回声,无需 1 型裁定① seed 破缓存通道(本型在新版工作流上无先前同参拍,与 2-5 型同款预判成立)

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;canon=/tmp/type6-subject-canon.txt,md5 70373a76f2b996d724d04767b6cfb36b,197 字)

````
一位筑基后期的年轻女修面容特写：眉目沉静中带一点锋芒，长发半束只簪一支素银簪，几缕碎发垂在颊边；画面为正脸面朝摄像机的特写照——人物直视镜头，五官完整正对观者、左右对称呈现，视线落进镜头；头顶至肩线构图，双肩水平入画，画面下缘止于肩线，头部占画面大半；肩线以上，不见腰部以下，神情沉静，暖金顶光的光晕只落在发际与肩线，面部呈暖赭光影，背景一角青灰远山剪影淡入薄雾，全图多色相并陈，暖调中等饱和。
````

### ② PE 改写输出(装配终稿内段全文=[6:4013].positive_prompt 经 [6:4021] 选定入装配;PE启用?=true 保存态;共 3342 字、英文 5 段、段间以空行分隔——PE 模型原生分段;md5 `44598d34fe1c37250b9749bba33c2b5c`)

> **溯源标注(引文外)**:本段为**本拍新鲜推理**——6:4013 在本拍新鲜执行名单(22/30 节点新鲜;缓存 8 件中不含 6:4013,6:4019 PE TE 加载器模型级缓存不影响改写本体新鲜性,改写输入=本拍新主体句)。本段按「BASE 473 字逐字对拍真源(qi21_bases.json 高清人脸条 positive_text=人物立绘块,md5 e179439da1701c801650091af1c66aa5,与人物/多视图/美宣三型共享同款 473 字块)」从装配终稿定界切出(3/4/5 型 §8/§9 同款方法;驱动器 R.prompts.peRewrite 字段仅截装配首行,非全段,§9②)。**⚠️ 本段是透明门红的直接根因载体之一**:PE 在 canon 自带背景子句「背景一角青灰远山剪影淡入薄雾」的基础上,把「一角剪影」扩写成了**全景沉浸式山水环境叙事**(段3:天空/山脊/树/金色日光/头部光晕/景深虚化,通篇持之,§7 证据)。身份件上 PE 保住了人脸型构图锚与身份锚大部(正脸直视镜头/左右对称/头顶至肩线构图/半束发+素银簪+碎发/暖金光/暖赭光影/青灰远山逐项承接,§7⑥),但光源方向偏移(顶光→右上方斜射,段3 引文自证「golden sunlight entering from the upper right」)。[6:4020] PE思考预览件不随 history outputs 回放(outputs 键=[8,401,504,505]),与 1-5 型拍现象一致。

````
A vertically oriented, close-up cinematic portrait shows a young adult woman of East Asian appearance facing directly toward the viewer, centered slightly above the middle of the frame. Her face occupies much of the image, with the forehead near the upper third and the shoulders extending across the lower portion. She has a slim build, warm fair-to-medium skin tone, an oval face, straight dark eyebrows, almond-shaped brown eyes, a straight nose, and softly defined lips with muted rose-brown lipstick. Her expression is calm, serious, and introspective, with relaxed eyelids and a steady forward gaze. Subtle makeup includes warm-toned eyeshadow, delicate eyeliner, lightly defined lashes, gentle contouring, and a slight highlight on the bridge of the nose and cheekbones. Small natural moles or beauty marks are visible on her face and neck area, adding realism to the skin texture.

Her long black hair is styled in a traditional-inspired half-up arrangement. The back section is gathered into a rounded bun near the upper right side of her head, secured with a plain silver hairpin placed diagonally from the upper center-left toward the bun. The hairpin has pointed decorative ends with tiny bead-like details. Loose strands fall around her cheeks, temples, neck, and shoulders, with fine flyaway hairs catching the warm backlight. The hair has a glossy, slightly windswept texture, with individual strands illuminated by sunlight along the right edge.

She wears layered, ancient-style garments resembling hanfu or wuxia-inspired clothing. The inner collar is light beige with a V-shaped opening, edged with patterned trim in muted gold and gray tones. Over it are broad draped outer layers in gray-beige and taupe fabric, textured like woven linen or matte silk. The fabric wraps diagonally across her chest and shoulders, creating soft folds and overlapping planes. A thin chain necklace descends from her neck, holding a small metallic pendant near the center of her upper chest. The jewelry appears bronze or antique gold, matching the subdued historical aesthetic.

The background is an outdoor mountainous landscape rendered with strong depth of field blur. On the right side and behind the woman, soft silhouettes of rocky peaks and forested ridgelines recede into mist. A faint, leafy tree form appears behind her left side, partially obscured by haze. The sky and distant mountains are washed in pale cream, gray-blue, and warm sepia tones. The lighting suggests sunrise or sunset, with intense golden sunlight entering from the upper right, producing rim light along her hair and shoulder and creating a luminous halo effect around the back of her head. The overall color grading is warm, earthy, and atmospheric, dominated by amber, beige, bronze, charcoal-black hair tones, and smoky blue-gray mountains.

The composition uses a tight portrait crop from roughly the upper chest upward, with the subject sharply focused against a soft bokeh background. The camera angle is straight-on at eye level, emphasizing symmetry in the face while the diagonal hairpin and draped robe introduce visual movement. The scene has a high-resolution realistic photographic style with fantasy historical costuming, shallow depth of field, detailed skin rendering, natural hair texture, cinematic backlighting, and painterly misty scenery.
````

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 4648 字 = 透明头句 18(含尾随空格)+ PE 扩写 3342 + 1 换行 + 型底座 BASE 473(逐字=qi21_bases.json 高清人脸条 positive_text=人物立绘块:主体立绘句/衣褶裙摆/材质朴素/头发存在/鞋靴性别/设色配比/衣物完整性七行)+ 1 换行 + 锁层A 739(风格底座块)+ W1透明收束段 74;行序=头句「这是一张带有透明度的RGBA图像。」→PE 扩写 5 段→空行→型底座七行→锁层A→W1收束句+尾句;结构与全串程序化核验=18+3342+1+473+1+739+74=4648 ✓)

````
这是一张带有透明度的RGBA图像。 A vertically oriented, close-up cinematic portrait shows a young adult woman of East Asian appearance facing directly toward the viewer, centered slightly above the middle of the frame. Her face occupies much of the image, with the forehead near the upper third and the shoulders extending across the lower portion. She has a slim build, warm fair-to-medium skin tone, an oval face, straight dark eyebrows, almond-shaped brown eyes, a straight nose, and softly defined lips with muted rose-brown lipstick. Her expression is calm, serious, and introspective, with relaxed eyelids and a steady forward gaze. Subtle makeup includes warm-toned eyeshadow, delicate eyeliner, lightly defined lashes, gentle contouring, and a slight highlight on the bridge of the nose and cheekbones. Small natural moles or beauty marks are visible on her face and neck area, adding realism to the skin texture.

Her long black hair is styled in a traditional-inspired half-up arrangement. The back section is gathered into a rounded bun near the upper right side of her head, secured with a plain silver hairpin placed diagonally from the upper center-left toward the bun. The hairpin has pointed decorative ends with tiny bead-like details. Loose strands fall around her cheeks, temples, neck, and shoulders, with fine flyaway hairs catching the warm backlight. The hair has a glossy, slightly windswept texture, with individual strands illuminated by sunlight along the right edge.

She wears layered, ancient-style garments resembling hanfu or wuxia-inspired clothing. The inner collar is light beige with a V-shaped opening, edged with patterned trim in muted gold and gray tones. Over it are broad draped outer layers in gray-beige and taupe fabric, textured like woven linen or matte silk. The fabric wraps diagonally across her chest and shoulders, creating soft folds and overlapping planes. A thin chain necklace descends from her neck, holding a small metallic pendant near the center of her upper chest. The jewelry appears bronze or antique gold, matching the subdued historical aesthetic.

The background is an outdoor mountainous landscape rendered with strong depth of field blur. On the right side and behind the woman, soft silhouettes of rocky peaks and forested ridgelines recede into mist. A faint, leafy tree form appears behind her left side, partially obscured by haze. The sky and distant mountains are washed in pale cream, gray-blue, and warm sepia tones. The lighting suggests sunrise or sunset, with intense golden sunlight entering from the upper right, producing rim light along her hair and shoulder and creating a luminous halo effect around the back of her head. The overall color grading is warm, earthy, and atmospheric, dominated by amber, beige, bronze, charcoal-black hair tones, and smoky blue-gray mountains.

The composition uses a tight portrait crop from roughly the upper chest upward, with the subject sharply focused against a soft bokeh background. The camera angle is straight-on at eye level, emphasizing symmetry in the face while the diagonal hairpin and draped robe introduce visual movement. The scene has a high-resolution realistic photographic style with fantasy historical costuming, shallow depth of field, detailed skin rendering, natural hair texture, cinematic backlighting, and painterly misty scenery.
主体的单人立绘，全身入画，头身比约七头半，解剖比例写实，下肢不过度拉长。运笔有提按顿挫的细墨线勾勒全身轮廓，线随结构时粗时细，转折衔接处轻重分明；墨色浓淡分明，干湿五阶层次清楚，近处轮廓清楚、墨线饱满，远景以淡墨晕染层层退开。背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，受控饱和而非一律低饱和；一块鲜明的点题色收束视线；均匀柔光，浅净平涂的底，画面疏朗有呼吸。
衣褶/裙摆：使用宽幅平静布面，正面仅允许两到四条长结构褶（稀疏结构褶 2-4 条）。
材质可以朴素或粗陋（灰布、素袍、劳动布）但须看起来可穿且完整；服饰保持结构安静：袖口和下摆是连续闭合布面。
头发存在：头皮须有可见头发，有清晰发量与发际线；短发、长发、扎发、平头或短寸均可。
鞋靴性别：鞋靴性别呈现须匹配角色生理性别与来源事实。
人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。
衣物完整性：服饰须完整、线条干净、可生产。
风格底座：现代修仙游戏的数字绘画资产（modern Chinese illustration）——中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、服饰、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术，不是把一幅古画直接搬进游戏。媒介：现代数字绘画完成度的 2D 传统绘画语言——连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明，干净空灵，清晰视觉焦点。底色：浅净哑光平涂底的完成度，多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位），保证可读性。画面保持干净平滑：墨与色落在平涂色场上，而非有纹理的纸面。工笔线条质量：连续铁线描；曲线自然顺滑，直线笔直稳定；线宽连续且有节奏，转折、衔接与起收笔干净；细稳基调上转折处轻重提按，墨线带手绘笔性，防机械勾边与矢量感。线描优先工笔结构：100% 视图下，脸部、手部、发丝、衣边、缝线、褶皱、配件和武器构造须先于上色或 shading 从连续纪律性 linework 保持可读。用白描/铁线描加薄透矿物罩染、反复轻分染与罩染建模；保持浅净平涂底面在层间呼吸。浅净哑光底须在每层色罩下保持可见，除非是刻意的墨线、紧凑发块或来源事实要求的深色主体（如尚黑阵营的甲胄旗纛）。成片质量：生产级最终画面清晰度——强制降噪泥糊 AI 伪影；边缘锐利但不产生过锐光晕；表面干净可读；颜料层纯净均匀。默认表面须保持干净精致：只用纯净罩染与克制的矿物颗粒。岁月、风霜或战痕仅在来源事实要求时作克制的叙事线索，须次要、不抢戏。电影级成片质量指干净的可读性与精致的工艺清晰度。 主体呈现为干净的平面剪裁,单一独立素材完整保持在画幅内,四周被空白透明度包围,轮廓至边缘清晰完整不断裂。 该图像具有alpha通道,背景是透明的。
````

### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,负向文本仍在链生成并预览,采样端不消费——[7016] Note 口径,与 1-5 型同)

> **构成标注(引文外)**:共 388 字,以「, 」连接两段——首段=**高清人脸型负面 202 字**(真源 qi21_bases.json 高清人脸条 negative_text 逐字,程序化核 in finalNeg=True;与美宣/多视图型负面 202 字**逐字节全等**(同为褶网系+发系+鞋靴系块,人物族型共享同款型负面));次段=锁层负面段 186 字(含「, 」前缀整段,md5 `5fd2241467d1af2e6fd1a09e5ba693ff`)。全串与 4 型美宣拍/5 型多视图拍 finalNegative **逐字节全等**(md5 `28f123671bbfb89bb876cbbd10b6077c`,跨型一致性程序化核 True;型5记录 §1③′ 跨型链延续)。[404] 负向主体句保存态空(主体句负面第三源为空段,与保存态一致)。**本型负面清单无任何透明底指令**(§7⑤)。

````
模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，扇贝状/破损/分叉的裙摆或袍摆，分叉袍摆，分离的飘带状下摆条，下摆缺角，风碎流苏，乞丐破衣，撕裂下摆，碎边，破洞，磨损补丁，虫蛀布面，垂挂碎条，绳捆破布，刻意破烂造型，拉扯衣袍，分裂衣袍，分叉衣袍，破破烂烂，剃净头皮，透明头皮，无发干净圆顶，女性高跟鞋，细高跟，尖头女鞋，精巧女舞鞋，细带玛丽珍鞋，男性超大号通用工靴，异装鞋靴, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
````

## 2. 时间账

| 事件 | 时刻(CST) |
|---|---|
| graphToPrompt 干跑+投前断言 12 项全绿 | 2026-10-06 11:15:50(干跑 03:15:50.490Z) |
| POST /prompt 受理(tQueue) | 2026-10-06T03:15:50.491Z |
| 进入 running(tRunningSeen) | 2026-10-06T03:15:50.508Z(排队等待≈17ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06 11:20:39(03:20:39.921Z) |
| 2K 落盘(引擎侧 mtime) | 2026-10-06 11:21:58(03:21:58.955Z) |
| 终态 success(tDone) | 2026-10-06T03:22:03.278Z |

**排队→出图 = 6.21 分钟**(durationMin,实测;含 PE 9B 模型新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大;预算 38min 驱动帽/45min 任务帽内,耗时与 1-5 型(6.2-6.9)同量级;全役含两发 wh 探针+后核+分析墙钟≈25min,实测)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode) | 保存态 |
| seed | **0**([7:7014].inputs={"value": 0};[7:7013].seed=["7:7014",0] 连线) | **=保存态,未动**(本拍 22/30 新鲜,无裁定① 破缓存需要) |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors,positive←[4015,0],latent←[4,0],seed←[7:7014,0]) | 档0 口径(FACTS §1 档位表;7010/7012 两支路在图未选,日志摘要双 KSampler 行仍在=两支路加载器在拍,采样走 7013) |
| 分辨率 | **1712×2560(竖幅 2:3,≈4.17MP)**;[4].width/height=["4018",0/1] 连线驱动 | **PE建议路,归因链本役全闭合零推断残留**:①接线=[4018].wh_ratio←[6:4021,1]←[6:4013,2](PE宽高比口,投前排队图断言「宽高连线←[4018,0/1]」✓)+PE启用?=true 保存态→联动开关(←[6:4012,2])恒开;②**探针1(pid d021e881,11:34:28,新推理 130.2s)**:CLIPLoader(pe_t2i,type=qwen_image)+QwenImage21_T2IPromptRewrite(prompt=型6canon197字逐字,余参同在拍件:seed=42/temp=1.0/top_p=0.95/top_k=20/pp=1.5/max_new_tokens=16256)→easy showAnything(pe出2)→**wh_ratio="2:3"**(WS 实时捕获,/history outputs 不回放,§9①);③**探针2(pid d53b7e88,11:37:23)**:同图加 MyQi21WhSuggest(wh_ratio←pe出2,联动开)→**活引擎建议值=(1712, 2568)**(WS 捕获 5/6 口 INT 原值,与仓内公式 round(a·sqrt(4.2·1024²/(a·b))/8)·8 精算值逐位一致;节点 1-3 续探针1 节点缓存);④**主拍实测 1712×2560=(1712,2568) 长边-8=floor(2568/16)×16**(宽 1712=107×16 已 /16 对齐无截;/16 网格截断定律=本役 1-6 型拍全部直出图尺寸实测所证:1/4/5/6 型 1712×2560、2/3 型 2560×1712,恒=(1712,2568) 或 (2568,1712) 的 /16 截断形;**截断动作本体发生在引擎内核哪一环节未逐行核源,系推断标注**——与 2/3/4/5 型记录 §8④/§3 同款口径)。**型 canon=1:1 (Square) @1.0MP**——PE建议路把画幅改写为 2:3 竖幅@4.2MP 档(**方向+分辨率档位双偏离**;型3 道具同款双偏离 1:1@1.0→3:2@4.2,型5 多视图为比例单偏离 3:4@4.2→2:3@4.2,型4 美宣 21:9→2:3 反向单偏离;**九型回退路(1:1@1.0MP≈1024 方形)与建议路公式值(2568)均与实测 2560 不等,已由探针实测排除**) |
| 透明 | **跟型=true 在链生效**:[6:4010].透明覆盖=false+rgba_default=true(高清人脸,真源 qi21_bases.json 程序化核对)→[6:4014] 透明模式←[6:4010,3] 透明值口→透明模式=开,最终正向**透明三重指令全在**(头句/W1收束句/尾句各恰 1 次,程序化计数;**注:高清人脸型 BASE(=人物立绘块 473 字)无透明末句,链上透明指令=三重,与 3 型道具拍(四重)少一重,与 4/5 型拍同形**) | **透明门红**(四角实测全 255 级,§4/§7) |
| PE | [6:4013] QwenImage21_T2IPromptRewrite,pe_t2i 权重(qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors;TE 加载器 6:4019 模型级缓存;**改写本体=本拍新鲜推理**(seed=42/temp=1.0/top_p=0.95/top_k=20/pp=1.5/max_new_tokens=16256,history 回读=与 2-5 型拍同参同值)) | 输出=本拍新鲜改写(§1②)+wh_ratio="2:3"(§3 分辨率归因②探针实测) |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 四角 alpha | 引擎侧原文件(mtime) |
|---|---|---|---|---|---|
| [8] 直出 | `images/type-6-高清人脸.direct.png` | 7,971,532 | 1712×2560 RGBA | **[255, 255, 254, 254](4/4 角全不透明,透明门红原始证据)** | QI21道劫文生图__00111_.png(11:20:39) |
| [504] 2K | `images/type-6-高清人脸.2k.png` | 10,774,601 | 2048×3062 RGBA | **[255, 255, 255, 218]** | MYStudio-2K_00032_.png(11:21:58) |

(2K=SeedVR2 短边2048 放大;1712×2560→2048×3062,比例保持≈0.667=2:3,与 1-5 型拍同规格放大链。)

### 补充 alpha/亮度落点实测(引擎 venv PIL+numpy,现场跑;**alpha 分布=透明门定量证据(§7),亮度/色彩=型级观察佐证(§8),非门**)

| 指标(直出 [8];2K [504] 见备注) | 实测 |
|---|---|
| alpha==0 占比 | **0.00%**(2K 0.00%) |
| alpha<8 占比 | **0.00%**(2K 0.00%) |
| alpha>250 占比 | **100.00%**(2K 99.94%) |
| alpha==255 占比 | **43.57%**(2K 96.13%;其余为 251-254 半透明过渡带,无真透明区) |
| 逐行 alpha255 占比(2%→98% 采样行) | 100%/93%/47%/44%/30%/26%/19%/28%/37%(顶部最满,中部行仅 19-30% **但 alpha0 行占比恒 0%**——中部是半透明过渡带,非透明底) |
| 四角+中心 RGB(直出) | 左上(237,230,216)/右上(253,245,226)/左下(173,163,148)/右下(179,159,133)/中心(195,155,121)——四角全亮暖奶油色系(天空/雾光/山雾,与 PE 段3 自报「pale cream, gray-blue, and warm sepia tones」「intense golden sunlight」背景叙事命中,§7) |
| 均值亮度/中位(直出) | 130.1/117.7(暗像素<60 占 12.7%,中暗<120 占 51.9%,亮>200 占 19.0%=天空与光晕发光区) |
| 石青/青蓝(b>r+15 且 g>r+15 且 b>40) | **0.01%** |
| 青绿(g>r+15 且 g>b+10 且 g>40) | **0.00%** |
| 赭石(暖中亮,r>100 且 r>g+10 且 g>b+5) | **40.35%**(面部暖赭光影+古金饰件+山雾暖调全域) |
| 旧金(r>120 且 g>80 且 r>b+40 且 g>b+20) | **17.07%** |
| 朱红(r>120 且 r>g+40 且 r>b+40) | 2.22%(唇色+饰件点缀) |
| 淡墨冷中性( |r-g|<12 且 |g-b|<12 且 60<lum<180) | 11.7%(远山烟青灰带,PE 自报「smoky blue-gray mountains」命中) |

(全图暖调主导:赭石+旧金+暖金琥珀系合计≈74%,冷色系(石青/青绿)≈0%——canon「全图多色相并陈」的多色相诉求在像素面表现为暖色全域+冷色仅余烟青灰远山带,§7⑥ 型级观察。)

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 37-39,原文逐字;全量JSON 行 6594 字符见存档)

````
[MY出图][入队][2026-10-06 11:15:50] number=11 prompt_id=a00b747a-301e-432b-bd15-819538c072b7
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetenso… ×1.0 | KSampler: seed=['7:7014', 0] cfg=1.0 steps=6 sampler=euler scheduler=simple denoise=1.0 | KSampler: seed=['7:7014', 0] cfg=4.0 steps=40 sampler=euler scheduler=simple denoise=1.0
````

(摘要行为源日志行逐字全文——行内「safatenso… ×1.0」省略号是引擎侧日志钩子对 LoRA 文件名的原生截断,在源行内,非本记录截断;与 1-5 型拍摘要行逐字符相同(同形属预期)。[全量JSON] 行 6594 字符全文见 `logs/type-6-高清人脸.image-prompts.excerpt.log`。本拍=当日产线日志第 14 条入队(number=11;序号序列 0,0,0,1,2,3,4,5,6,7,9,10,11,12,13——缺 8,服务端序号器口径,型5记录已记;number=9=型4 wh探针,number=10=型5拍,number=11=本拍,number=12/13=本役型6 wh探针1/2(§3②③,探针拍入产线日志,型5记录 §9⑤ 账目勘正先例延续)。)

## 6. 与保存态偏差

**无。**两处改动恰为任务书允许的两处:

1. 型选择:人物→**高清人脸**([6] 宿主面板 widget;投前排队图断言 [6:4010].base=「高清人脸」✓;型底座 BASE 473 字逐字进装配 §1③)。
2. 主体句:[400] value→**高清人脸 canon 197 字**(逐字,md5 对拍✓;改前=147 字人物句)。

其余全保存态:PE启用?=true / 透明未动([6:4010].透明覆盖=false) / 速度档位=0 · Fun-Acc 4步 / seed=0 / [404] 负向主体句空——改前改后读回逐项一致(driver S7 五读回门全绿+投前 12 断言全绿,含 D5 三闸/BASE←型底座/锁层A 739 字逐字/主体句源 canon 全文逐字)。探针1/2 为**主拍完成后的独立取证件**(非主拍改动;§3②③),不在「两处改动」约束域内。


## 7. ★ 透明门红——根因定谳(证据链)

**现象**:高清人脸 rgba_default=true(FACTS §2 对账;真源 qi21_bases.json 高清人脸条 rgba_default=true 程序化核对)→ 任务书加验四角 alpha=0 → 实测四角 [8]=**[255,255,254,254](4/4 角全不透明)**、[504]=**[255,255,255,218]**,全图 alpha>250 占比 100.00%、alpha<8 占比 0.00%——透明型三连红中最彻底形态之一(与 5 型多视图同形:0.00% 透明残量;3 型道具尚余 2/4 角 alpha≤1+底部带);FAIL。

**链路取证(链是通的)**:
1. **透明机制=纯提示词驱动**:`my_qi21_final_output.py:172-195` compose 在透明模式=true 时仅做文本包裹(_RGBA_HEAD+空格+(装配全文+空格+_TAIL)+空格+_RGBA_TAIL),**全管线无任何 alpha 后处理抠图/rembg**——是否真出透明底全凭模型对提示的服从性(与 3/5 型 §7 同款取证,代码行号本役现场重核)。
2. **跟型连线在拍**:[6:4014].透明模式←[6:4010,3](透明值口;型≠自由→透明值=rgba_default=true;投前排队图断言「[6:4010].透明覆盖=false」✓)。
3. **包裹已生效(三重全在)**:最终正向含头句「这是一张带有透明度的RGBA图像。」(行0)+W1收束句「主体呈现为干净的平面剪裁,单一独立素材完整保持在画幅内,四周被空白透明度包围,轮廓至边缘清晰完整不断裂。」+尾句「该图像具有alpha通道,背景是透明的。」(锁层A 后 74 字段)——**三重透明指令各恰 1 次,全在正向**。注:3 型道具拍是四重(BASE 末句另有透明末句);**高清人脸型 BASE=人物立绘块(473 字)无透明末句,链上透明指令比 3 型少一重**——与 5 型同形;指令数量非决定性变量(3 型四重也失效)。

**根因(直接证据;本型特有结构——canon 内生冲突)**:
- **PE启用?=true(保存态)⇒ 主体句过 QwenImage21_T2IPromptRewrite(pe_t2i)扩写**——本型 canon 主体句**自带背景子句**「背景一角青灰远山剪影淡入薄雾」(0927 色相锚轮/二轮定形产物:剪影压山形纹理+薄雾正向限定,docs §6 注引)——**该子句与 rgba_default=true 的透明底诉求在同一主体句内即已正面冲突**(「背景有山雾」vs「背景透明」),PE 扩写环节站在了背景叙事一边:
  - 段3:「**The background is an outdoor mountainous landscape rendered with strong depth of field blur. On the right side and behind the woman, soft silhouettes of rocky peaks and forested ridgelines recede into mist. A faint, leafy tree form appears behind her left side, partially obscured by haze. The sky and distant mountains are washed in pale cream, gray-blue, and warm sepia tones. The lighting suggests sunrise or sunset, with intense golden sunlight entering from the upper right, producing rim light along her hair and shoulder and creating a luminous halo effect around the back of her head.**」——**全景沉浸式山水环境**:天空+山脊剪影+树形+金色日光+头部光晕+景深虚化,把 canon 的「一角/剪影/淡入」三重限定(一角→全域/剪影→有形山脊树林/淡入薄雾→强烈景深虚化下的实底场景)全部放开;
  - 段4 构图自报:「**tightly cropped portrait** against a **soft bokeh background**」——bokeh 背景叙事=实底场景,与透明底直接互斥;
  - 实测像素面命中:四角全亮暖奶油色(237-253 级 RGB=天空/雾光实底,§4)+暖调全域≈74%(赭石 40.35%+旧金 17.07%)+亮>200 占 19.0%(天空与光晕发光区)——**不是透明底空画幅,是被画满了的暖色天空**。
- 模型(PDD T8 FunAcc 4步)在三重中文透明指令 vs 英文扩写全景山水叙事的冲突中**完全跟随了后者**——整幅 100.00% 像素 alpha>250,0.00% 像素 alpha<8;与 5 型多视图(0.00% 残量)同形,比 3 型道具(尚余 2/4 角+底部带)更彻底。**且 canon 主体句自身确实带「背景一角青灰远山剪影淡入薄雾」子句**(① 逐字核在案)——本型与 5 型(「禁写背景物象」纪律被 PE 自由补全)的差别在于:**高清人脸的背景叙事源头就在 canon 里,透明底公式路在现行链形上对本型是主体句级内生矛盾,非 PE 幻觉单独引入**。

**身份件承接(PE 文本自报对照,非人眼判读,§9⑦)**:正脸直视镜头(facing directly toward the viewer/steady forward gaze)✓/五官左右对称(emphasizing symmetry in the face)✓/头顶至肩线构图(forehead near the upper third/shoulders extending across the lower portion/tight portrait crop from roughly the upper chest upward)≈✓(「upper chest」≈肩线档,比 canon「下缘止于肩线」略松半档)/半束发+素银簪(half-up arrangement…plain silver hairpin)✓/碎发垂颊(loose strands fall around her cheeks)✓/暖金光(golden sunlight)≈(方向偏移:canon 顶光→PE 右上方斜射)/暖赭光影(warm, earthy…amber)✓/青灰远山(smoky blue-gray mountains)✓/多色相暖调中等饱和≈(暖色全域主导,冷色仅余 11.7% 烟青灰带,石青/青绿实测≈0%,§4 色锚表)。

**跨拍对照(透明型三连红;先例合格组合均不在现行保存态上)**:

| 拍 | 型 | PE | 档/seed | 分辨率 | alpha 结果 |
|---|---|---|---|---|---|
| 1004 cfg4(pid af50c297,10-04) | 道具 | **中文 PE(MyQi21ChinesePE)** | 档1 直出40步/cfg4,seed=4103 | 2800×1568 | **alpha0 占比 76.5%,alphaOk=true**(合格透明;负向含「保持透明底(以灰白棋盘格示意)」) |
| dedup(b3d8647 先例,pid 7b39fb65,10-05 16:30) | 道具 | **false(关)** | FunAcc 4步,seed=1(破缓存) | **1024×1024**(=道具型底座回退臂 1:1@1.0MP) | **四角 alpha=[0,0,2,0] 全≤8,PASS**(20/20 全过) |
| 本役 3 型(pid fc46aba4,10-06 10:08) | 道具 | **true(开,官方英文 pe_t2i)** | FunAcc 4步,seed=0(保存态) | 2560×1712(=PE建议 3:2@4.2MP) | **四角 [255,255,1,0],2/4 角不透明,FAIL**(整幅 90.6% 不透明,底部余 ~10% 透明带) |
| 本役 5 型(pid c972ae02,10-06 10:56) | 多视图 | true(开,保存态) | FunAcc 4步,seed=0(保存态) | 1712×2560(=PE建议 2:3@4.2MP) | **四角 [255,255,255,255],4/4 角全不透明,FAIL(整幅 100.00% alpha>250)** |
| **本拍(pid a00b747a,10-06 11:15)** | **高清人脸** | **true(开,保存态,官方英文 pe_t2i)** | FunAcc 4步,seed=0(保存态) | **1712×2560(=PE建议 2:3@4.2MP;canon=1:1@1.0MP 双偏离)** | **四角 [255,255,254,254],4/4 角全不透明,FAIL(整幅 100.00% alpha>250,0.00% alpha<8,透明残量=零)** |

即:**「透明型×PE启用?=true(官方英文 pe_t2i)×FunAcc 档0」组合实弹门测三连红(道具 2/4 角红→多视图 4/4 角红→高清人脸 4/4 角红)**;先例合格的两种组合(中文 PE×cfg4 / PE 关×FunAcc)均已不在现行工作流保存态上。现行负向链(型负面 202+锁层负面 186)亦无透明底指令(§1③′;1004 时代中文 PE 负向有「保持透明底」句,且该拍合格)。

**判读与边界(如实)**:
- 这是**产品线在保存态默认组合下的透明交付能力问题**,非本役驱动/取证缺陷——恰为九型实弹战役要抓的型级风险;**透明四型已测三个(道具/多视图/高清人脸)三连红,剩余 表情差分 一型同类风险极高**(其 canon 亦无 BASE 透明末句冗余、同为人物族 1:1 型线)。
- 本型额外暴露**画幅双偏离轴**(1:1@1.0MP→2:3@4.2MP,§3):透明头像资产的预期消费形态(方形小图,1.0MP≈1024²)被 PE建议路改写为 4.2MP 竖幅——即使透明门过,产物也不是 canon 预期消费形态的方形头像。
- 本役受任务书「恰两处改动」约束,无合规通道在本拍内验证缓解组合(PE启用?=false 为第三处改动=越权;裁定① seed 破缓存通道仅授权于全缓存回声场景,本拍非回声(8/30 加载器级),不适用;换 seed 亦属门值重掷非根因修复——PE seed=42 恒参下改写输出主要由主体句驱动,主体句已为 canon 逐字,canon 内生的背景子句无法在「主体句=canon 逐字」约束下移除)。
- 产物图按机器判据(存在/>0字节/PNG 可解析/三层收据)全数在档合格,**仅透明门红**;产物图与全部收据保留现场,未做任何补救性重投。

## 8. 机器判据(后核 `verify/type-6-高清人脸.postcheck.json`,exit=1,18/19;**权威判=后核**)
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=a00b747a-301e-432b-bd15-819538c072b7 |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=8/30 |
| ✅ | seed 回读=[7:7014] | {"value": 0} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,504 |
| ✅ | 产物图存在且>0字节([8] type-6-高清人脸.direct.png) | 7971532B |
| ✅ | PNG 魔数([8]) |  |
| ✅ | PNG 可解析(PIL,[8]) | {"mode": "RGBA", "size": [1712, 2560], "metaLen": 12544, "metaMd5": "b7a7d0d42e510673292858f2405856cb", "cornerAlpha": [255, 255, 254, 254]} |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12544 |
| ✅ | 产物图存在且>0字节([504] type-6-高清人脸.2k.png) | 10774601B |
| ✅ | PNG 魔数([504]) |  |
| ✅ | PNG 可解析(PIL,[504]) | {"mode": "RGBA", "size": [2048, 3062], "metaLen": 12544, "metaMd5": "b7a7d0d42e510673292858f2405856cb", "cornerAlpha": [255, 255, 255, 218]} |
| ❌ | 透明门:四角 alpha<=8(FACTS rgba_default 型) | [255, 255, 255, 218] |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12544 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=4648 negLen=388 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:37 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:37 起 3 行 |

| — | 透明门结论 | **红**:任务书口径「四角 alpha=0」同判 FAIL(0/4 角达标);战役门(b3d8647 口径四角≤8)同判 FAIL(0/4 角达标;254>8)——**透明四型三连红**(3 型道具红→5 型多视图红→本型高清人脸红,§7;仅剩表情差分未测) |

## 9. 勘误与标注(工具链,不影响判据)

- **驱动器原始终判红=1-5 型同款收割 bug 假红(一项)**:「PNG 元数据=history prompt」不剥节点级 `is_changed` 指纹(pngMd5=983f0d4a…≠histMd5=4f22c16d…;差异域与 1-5 型同=6:4010 型值选择件 IS_CHANGED 缓存指纹)→后核剥指纹后稳态同✅;其「★ 终判」为该项级联。驱动器真实 exit=1(DRIVER_EXIT=1,`logs/type-6-高清人脸.driver.console.log` 尾行自证);本型**权威终判=后核 exit=1**——驱动器假红一项不计红,透明门一项计红(§7)。
- **R.prompts.peRewrite 只含装配首行**(driver 同款字段切界,3-5 型已记):本拍 PE 扩写为 5 段多行体(3342 字),§1② 改用「BASE 473 字逐字对拍真源」从装配终稿定界切出完整段引用并记 md5 44598d34fe1c37250b9749bba33c2b5c,结构校验和核对(头句18+PE段3342+1换行+BASE473+1换行+锁层A739+W1透明收束段74=4648 ✓,引文逐字含在校验集内)。/tmp/type6-pe-full.txt 临时件与 §1② 同文。
- **wh探针取件形态(型4记录 §3 探针法的取件面补充)**:探针1首发即发现 easy showAnything 文本口**不随 /history outputs 回放**(outputs 键在但 ui 空)——探针2改用 WS 实时捕获 executed 消息取到原值("2:3"与 INT 对 1712/2568)。型4记录 §3 称其探针「输出='2:3'」——其取件通道未记(推测同经 WS;以本役实测:该件 /history 回放为空,取值须 WS),如实记供后续役复用。
- **探针2 节点缓存形态**:探针2 图中节点 1-3(CLIPLoader/PE改写/wh原串showAnything)与探针1 图同构同输入→**执行时续探针1 节点缓存**(execution_cached nodes=[1,2,3]),节点 4-6(suggest+两 INT 口)新鲜——wh_ratio="2:3" 的真值源头=探针1 的新鲜推理(130.2s),探针2 只是把该值接进活 suggest 算了 INT(零额外 PE 推理;账目如实)。
- **型4记录 §3 分辨率机制链中间数勘正(如实)**:其「高=2576→实测 2560=2576 经 /16 网格截 8(推断)」一句的中间数 2576 系对原始值 2570.22 先行 /16 四舍五入(round(160.76)=161→161×16=2576)所得,**非 /8 取整公式精确值**——公式(round(2570.22/8)×8=round(321.28)×8=321×8)精确值=**2568**(本役探针2 活引擎实测 INT 原值=2568,与精算逐位一致);实测 2560=floor(2568/16)×16,截断量=8。结论(实测值=公式值经 /16 网格截断)两役一致,本役以活引擎实测取代推断标注;/16 截断动作本体发生在引擎内核哪一环节仍未逐行核源(EmptyLatentImage 原生件零 /16 逻辑;T8 nodes.py 可见部分无显式 /16;疑在 Qwen 2.1 DiT patch 化路径(321 潜在单位→160.5 patch 非整→对齐下取整),**系推断**,1-6 型拍尺寸定律+探针2 活建议值实测双锚)。
- **[6:4020] PE思考预览不随 history outputs 回放**(outputs 键=[8,401,504,505];thinkLen=0)——与 1-5 型拍现象一致;PE 改写输出溯源=装配终稿内段逐字(§1②)+wh_ratio 探针实测(§3)。
- **缓存 8/30 明细**:['1','2','3','404','501','502','6:4019','7:7014']=UNET/主TE/VAE/PE TE/SeedVR2 双件五加载器+404 空串常量+7014 seed 常量——比 4/5 型的 1/30(cached=仅 6:4019)多 7 件=**本役连拍产线模型常驻与常量件恒等的自然结果**(加载器与常量件输入与 5 型拍逐值同,节点缓存命中属预期;**装配链/编码器/建议器/采样器/存图件全数新鲜**,主拍真渲染性不受影响,§8「非全缓存回声」门=✅ cached=8/30)。
- **产线日志序号账**:本拍 number=11(当日第 14 条入队;序号序列 0,0,0,1,2,3,4,5,6,7,9,10,11,12,13——缺 8,服务端序号器口径,型5记录已记);本役两发 wh 探针=number=12(行40,11:34:28)/number=13(行43,11:37:23),均入产线日志,账目合。
- **人眼复核未做**(本会话无视觉输入,如实声明,与 1-5 型同款口径):图像内容判读全部基于像素统计(alpha/亮度/色锚/逐行)+PE 文本自报对照;「是否同脸/五官是否逐项在场」类部件级判读未做——但透明门判据(四角 alpha/全图 alpha 分布)为纯机器判据,不受此限;§7 身份件承接表=PE 文本自报与 canon 逐词对照,已标注口径。
- **后核计数勘正(2026-10-06 12:1x 复核收账)**:本记录首行结果括号/§8 标题/§10 后核行原写「17/18」系计数笔误——经对 `verify/type-6-高清人脸.postcheck.json` 实数复核:checks=19 项、绿 18、红 1(唯一红=透明门「四角 alpha<=8(FACTS rgba_default 型)」;ok=False/exit=1 与「透明门红」判定属实),正确计数=**18/19**;三处已就地勘正(ok 型 1/2/4 记录的 18/18 与其 JSON 实数相符,不受影响)。

## 10. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-6-高清人脸.image-prompts.excerpt.log` | 源 image-prompts-20261006.log行 37-39(入队+摘要+全量JSON) |
| ② PNG 元数据 | `verify/type-6-高清人脸.png-prompt-metadata.json` | tEXt prompt(12,544B,30 节点,剥 is_changed 后与 history 稳态同;metaMd5=b7a7d0d42e510673292858f2405856cb;[8]与[504]同源同元数据) |
| ③ history prompt JSON | `runs/type-6-高清人脸.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-6-高清人脸.json` | 断言 12 项/读回前后/改动两笔/时间账/缓存名单(终判红=§9①假红级联,权威判据见 §8) |
| 驱动控制台 | `logs/type-6-高清人脸.driver.console.log` | 全程日志(DRIVER_EXIT=1 自证=假红级联;后核 POSTCHECK_EXIT=1 追加自证=透明门红) |
| 后核 | `verify/type-6-高清人脸.postcheck.json` | 机器判据权威判(18/19,透明门红,exit=1) |
| 产物图 | `images/type-6-高清人脸.direct.png` / `images/type-6-高清人脸.2k.png` | §4(1712×2560 RGBA 竖幅 2:3 / 2048×3062 2K;四角 alpha=255,255,254,254 / 255,255,255,218——透明门红的原始证据) |
| 主体句 canon | `/tmp/type6-subject-canon.txt`(临时)+ 本记录 §1① 全文引 | 197 字 md5 70373a76f2b996d724d04767b6cfb36b |
| PE 扩写全文 | 本记录 §1② 全文引(+ /tmp/type6-pe-full.txt 临时件,md5 44598d34fe1c37250b9749bba33c2b5c) | 3342 字(5 段) |
| wh 探针取证件 | /tmp/type6-whprobe.json(探针1)/ /tmp/type6-whprobe2.json(探针2 WS 捕获,临时) | 探针1=PE原值"2:3"(历史回放空,§9①);探针2=活建议值(1712,2568)(§3 归因链) |
