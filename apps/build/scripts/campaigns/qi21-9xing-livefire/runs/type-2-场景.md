# 实弹记录 · 第 2/9 型「场景」(type-2-场景)

**结果:✅ 机器判据全绿**(权威后核 `postcheck_type.py type-2-场景` exit=0,18/18 项;判据明细见 §7)

- 日期:2026-10-06(排队 09:37:35 → 终态 09:44:28 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,manifest port=17000,comfyui 0.38.0/mps)——**复用现役,非本 run 所起(engineStartedByUs=false)**
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,根节点 20,与 FACTS §1 同版;**实弹后真源文件 md5/mtime 复核未变**=00:35:30/115614B,仓库保存态保持)
- 主体句:70 字,md5 `ac7e1dee9248a71a1e39a568a4d61205`——三源逐字一致(docs/prompts/道劫_九型主体句示例.md §2 / /tmp/qi21-ninetype-1004/ninetype_driver.mjs:46(FACTS §2 出处) / /tmp/type2-subject-canon.txt 驱动输入件)
- prompt_id:`c1707be8-c301-44d5-b0d7-6411439d04a3`;client_id:`qi21-9xing-2-1791250655010`
- **与保存态偏差:无**——恰两处改动=任务书恰许的两处(型选择/主体句);seed=0 保存态未动(对比 1 型的裁定① seed 破缓存:本型主体句本身即破缓存,全链新鲜执行,见 §6)

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;出处=道劫_九型主体句示例.md §2 原文逐字=FACTS §2 出处 ninetype_driver.mjs:46)

```
暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。
```

### ② PE 改写输出(装配终稿首段全文=[6:4013].positive_prompt 经 [6:4021] 选定入装配;PE启用?=true 保存态;共 3495 字、英文 5 段、段间以空行分隔——PE 模型原生分段)

> **溯源标注(引文外)**:本段为**本拍新鲜推理**——6:4013 在本拍新鲜执行名单(23/30 节点新鲜;仅 1/2/3/404/501/502/6:4019 七件加载器/空件缓存)。对比 1 型拍的缓存回放(该拍 6:4013 在缓存名单,见其记录 §1② 标注),本拍为九型战役**首个 PE 链全新鲜改写**。本段按「BASE 段 190 字逐字对拍真源(qi21_bases.json 场景条 positive_text)」从装配终稿定界切出(§8 勘误②:驱动器 R.prompts.peRewrite 字段仅截首行 743 字,非全段)。[6:4020] PE思考预览件不随 history outputs 回放(outputs 键=[8,401,504,505],与 00:38 E2E 拍 ebe48f94 现象一致,§8 勘误③)。

```
A wide panoramic landscape shows an ancient ruined sanctuary set inside a dramatic mountain valley at sunset. The composition is dominated by rugged cliffs and distant layered peaks, with the tallest dark rocky wall rising along the upper-left edge and continuing into steep ridgelines that recede toward the center. The sky occupies the upper portion of the image, filled with large billowing clouds in warm gold, orange, peach, and smoky gray tones. Sunlight breaks through gaps in the clouds near the right side of the horizon, creating a bright glowing area and long warm highlights across the entire scene. The sun sits low above the distant mountains slightly right of center, casting a vivid reflection onto a shallow water basin below.

Across the middle and background, multiple ranges of jagged mountains fade into atmospheric haze, shifting from dark charcoal-gray silhouettes in the foreground to softer blue-gray and lavender tones in the distance. Low mist and drifting fog fill the valley, especially around the central water surface and among the rock formations, giving the environment a cinematic, ethereal quality. The air appears humid and cool, with soft vapor curling horizontally through the midground and partially obscuring the bases of the pillars and distant hills.

In the foreground and center, a circular or oval stone platform surrounds a still pool of water. The water basin reflects the sunset, the dark vertical stone forms, and the surrounding rocks with slight ripples and mirror-like distortions. Around the basin stand nine broken stone pillars arranged in a broad semicircle. These pillars vary in height and thickness, with several taller rectangular monoliths positioned toward the outer edges and shorter broken columns closer to the inner curve. Their surfaces are rough, weathered, dark brown-gray stone with cracks, chipped edges, carved grooves, eroded reliefs, and patches of pale lichen or mineral staining. Some columns have ornate base rings and worn decorative capitals, suggesting an old ceremonial or architectural structure abandoned long ago.

The foreground includes uneven rocky terrain with scattered stones, moss, grass, small wildflowers, and low vegetation growing between cracks. On the lower-left side, darker rocks and partial carved stone fragments sit beside the largest pillars, including a visible circular carved motif resembling an ornamental wheel or seal. Near the lower center and lower right, small green plants and tufts of grass line the water’s edge, contrasting with the cold stone and warm sunset glow. The right foreground contains additional dark rocks and moss-covered ground, partially framing the scene and adding depth.

The viewpoint is slightly elevated and wide-angle, looking inward toward the circular basin and sunlit horizon. The ruins form a strong leading-line arrangement around the water, guiding the eye from the foreground pillars toward the reflected sun and distant valley. Lighting is highly dramatic and directional: warm golden backlight outlines the stone edges, creates rim highlights on pillars, and illuminates clouds from behind, while shaded faces of rocks remain cool and shadowed. The color grading emphasizes complementary warm oranges and ambers against cool grays, greens, and misty blues. The overall style is realistic digital matte painting or high-end cinematic fantasy concept art, with detailed textures, atmospheric perspective, volumetric fog, and epic environmental scale.
```

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 4426 字 = PE 扩写 3495(5 段) + 1 换行 + 型底座 BASE 190(逐字=qi21_bases.json 场景条 positive_text) + 1 换行 + 锁层A 739;行序=PE 扩写 5 段→空行→型底座(空镜场景句/设色配比两行)→锁层A)

```
A wide panoramic landscape shows an ancient ruined sanctuary set inside a dramatic mountain valley at sunset. The composition is dominated by rugged cliffs and distant layered peaks, with the tallest dark rocky wall rising along the upper-left edge and continuing into steep ridgelines that recede toward the center. The sky occupies the upper portion of the image, filled with large billowing clouds in warm gold, orange, peach, and smoky gray tones. Sunlight breaks through gaps in the clouds near the right side of the horizon, creating a bright glowing area and long warm highlights across the entire scene. The sun sits low above the distant mountains slightly right of center, casting a vivid reflection onto a shallow water basin below.

Across the middle and background, multiple ranges of jagged mountains fade into atmospheric haze, shifting from dark charcoal-gray silhouettes in the foreground to softer blue-gray and lavender tones in the distance. Low mist and drifting fog fill the valley, especially around the central water surface and among the rock formations, giving the environment a cinematic, ethereal quality. The air appears humid and cool, with soft vapor curling horizontally through the midground and partially obscuring the bases of the pillars and distant hills.

In the foreground and center, a circular or oval stone platform surrounds a still pool of water. The water basin reflects the sunset, the dark vertical stone forms, and the surrounding rocks with slight ripples and mirror-like distortions. Around the basin stand nine broken stone pillars arranged in a broad semicircle. These pillars vary in height and thickness, with several taller rectangular monoliths positioned toward the outer edges and shorter broken columns closer to the inner curve. Their surfaces are rough, weathered, dark brown-gray stone with cracks, chipped edges, carved grooves, eroded reliefs, and patches of pale lichen or mineral staining. Some columns have ornate base rings and worn decorative capitals, suggesting an old ceremonial or architectural structure abandoned long ago.

The foreground includes uneven rocky terrain with scattered stones, moss, grass, small wildflowers, and low vegetation growing between cracks. On the lower-left side, darker rocks and partial carved stone fragments sit beside the largest pillars, including a visible circular carved motif resembling an ornamental wheel or seal. Near the lower center and lower right, small green plants and tufts of grass line the water’s edge, contrasting with the cold stone and warm sunset glow. The right foreground contains additional dark rocks and moss-covered ground, partially framing the scene and adding depth.

The viewpoint is slightly elevated and wide-angle, looking inward toward the circular basin and sunlit horizon. The ruins form a strong leading-line arrangement around the water, guiding the eye from the foreground pillars toward the reflected sun and distant valley. Lighting is highly dramatic and directional: warm golden backlight outlines the stone edges, creates rim highlights on pillars, and illuminates clouds from behind, while shaded faces of rocks remain cool and shadowed. The color grading emphasizes complementary warm oranges and ambers against cool grays, greens, and misty blues. The overall style is realistic digital matte painting or high-end cinematic fantasy concept art, with detailed textures, atmospheric perspective, volumetric fog, and epic environmental scale.
空镜场景，前景、中景、远景三层分明。近处以运笔有提按顿挫的细墨线勾勒，线随结构时粗时细；中景用色块晕开，墨与色相互接晕；远景交给淡墨，墨色浓淡分明，层层退远、渐淡渐虚。色彩层次承担画面呼吸，传统色多色相铺陈，青绿、赭石、青灰、朱红、旧金各安其位，受控饱和而非一律低饱和；均匀柔光，平涂的底，颜色清透。
场景设色配比：大面积淡墨、青灰为稳定基底，青绿、赭石、旧金多色相铺陈各安其位。
风格底座：现代修仙游戏的数字绘画资产（modern Chinese illustration）——中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、服饰、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术，不是把一幅古画直接搬进游戏。媒介：现代数字绘画完成度的 2D 传统绘画语言——连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明，干净空灵，清晰视觉焦点。底色：浅净哑光平涂底的完成度，多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位），保证可读性。画面保持干净平滑：墨与色落在平涂色场上，而非有纹理的纸面。工笔线条质量：连续铁线描；曲线自然顺滑，直线笔直稳定；线宽连续且有节奏，转折、衔接与起收笔干净；细稳基调上转折处轻重提按，墨线带手绘笔性，防机械勾边与矢量感。线描优先工笔结构：100% 视图下，脸部、手部、发丝、衣边、缝线、褶皱、配件和武器构造须先于上色或 shading 从连续纪律性 linework 保持可读。用白描/铁线描加薄透矿物罩染、反复轻分染与罩染建模；保持浅净平涂底面在层间呼吸。浅净哑光底须在每层色罩下保持可见，除非是刻意的墨线、紧凑发块或来源事实要求的深色主体（如尚黑阵营的甲胄旗纛）。成片质量：生产级最终画面清晰度——强制降噪泥糊 AI 伪影；边缘锐利但不产生过锐光晕；表面干净可读；颜料层纯净均匀。默认表面须保持干净精致：只用纯净罩染与克制的矿物颗粒。岁月、风霜或战痕仅在来源事实要求时作克制的叙事线索，须次要、不抢戏。电影级成片质量指干净的可读性与精致的工艺清晰度。
```

### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,负向文本仍在链生成并预览,采样端不消费——[7016] Note 口径)

> **构成标注(引文外)**:共 200 字,以「, 」连接两段——首段=场景型负面「模糊，水印，多手指，文字错误」(真源 qi21_bases.json 场景条 negative_text 逐字,已程序化核对 in finalNeg=True);次段=锁层负面(以同一基础负面串开头+美学禁令串,整 token 去重不跨段合并基础串故两现)。[404] 负向主体句保存态空,主体句负面第三源为空段(与保存态一致)。

```
模糊，水印，多手指，文字错误, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
```

## 2. 时间账

| 事件 | 时刻(CST) |
|---|---|
| graphToPrompt 干跑+投前断言 12 项全绿 | 09:37:35 |
| POST /prompt 受理(tQueue) | 2026-10-06T01:37:35.010Z |
| 进入 running(tRunningSeen) | 2026-10-06T01:37:35.026Z(排队等待≈16ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06 09:42:50 |
| 2K 落盘(引擎侧 mtime) | 2026-10-06 09:44:26 |
| 终态 success(tDone) | 2026-10-06T01:44:28.792Z |

**排队→出图 = 6.9 分钟**(durationMin,实测;含 PE 9B 模型新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大;预算 38min 帽内)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode) | 保存态 |
| seed | **0**([7:7014].inputs={"value": 0};[7:7013].seed=["7:7014",0] 连线) | **=保存态,未动**(1 型为裁定① 4101,本型无需) |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,无外接采样器;model=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors) | 档0 口径(FACTS §1 档位表;7010/7012 两支路在图未选) |
| 分辨率 | **2560×1712(横幅≈3:2,4.38MP)**;[4].width/height=["4018",0/1] 连线驱动 | **画幅听 PE 建议(非型底座 16:9)**——PE启用=true⇒[4018]联动开关=true(排队图联动开关=[6:4012,2]=PE开关 true路)⇒建议路;PE 对本场景句输出 wh_ratio=**"3:2"**(§8⑤ 确定性探针实测)→4018 公式 4.2MP/8 取整→(2568,1712)→实测 2560=**2568 经 /16 网格截 8**(§8⑤:截格点未逐行定谳,推断自两型对偶形态+16 倍数证据)。型底座 16:9→2800×1576 为回退臂未走。三方旁证:E2E 00:38(人物,PE新鲜)=1712×2560 纵幅对偶(§8⑤) |
| 透明 | 跟型=false([6:4010].透明覆盖=false;PNG RGBA 但四角 alpha=255 全不透明) | 场景 rgba_default=false(FACTS §2 对账),非透明型不开 alpha 门仅记录 |
| PE | [6:4013] QwenImage21_T2IPromptRewrite,pe_t2i 权重([6:4019] qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16,本拍缓存加载;seed=42/temp=1.0/top_p=0.95/max_tokens=16256) | 输出=本拍新鲜改写(§1②) |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 引擎侧原文件(mtime) |
|---|---|---|---|---|
| [8] 直出 | `images/type-2-场景.direct.png` | 9102292 | 2560×1712 RGBA(四角 alpha=255) | QI21道劫文生图__00107_.png(09:42:50) |
| [504] 2K | `images/type-2-场景.2k.png` | 11659631 | 3062×2048 RGBA(四角 alpha=255) | MYStudio-2K_00028_.png(09:44:26) |

(2K=SeedVR2 短边2048 放大;2560×1712→3062×2048,比例保持≈1.495=3:2。)

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 16-18,原文逐字;全量JSON 行 6465 字符见存档)

```
[MY出图][入队][2026-10-06 09:37:35] number=3 prompt_id=c1707be8-c301-44d5-b0d7-6411439d04a3
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safatenso… ×1.0 | KSampler: seed=['7:7014', 0] cfg=1.0 steps=6 sampler=euler scheduler=simple denoise=1.0 | KSampler: seed=['7:7014', 0] cfg=4.0 steps=40 sampler=euler scheduler=simple denoise=1.0
```

(摘要行 594 字符为**源日志行逐字全文**——行内「safatenso… ×1.0」的省略号是引擎侧日志钩子对 LoRA 文件名的原生截断,在源行内,非本记录截断;与 1 型拍摘要行 L14 逐字符相同(该行不含提示词内容,同形属预期)。[全量JSON] 行 6465 字符全文见 `logs/type-2-场景.image-prompts.excerpt.log`。)

## 6. 与保存态偏差

**无。**两处改动恰为任务书允许的两处:

1. 型选择:人物→**场景**([6] 宿主面板 widget;投前排队图断言 [6:4010].base=「场景」✓;型底座 BASE 190 字逐字进装配 §1③)。
2. 主体句:[400] value→**场景 canon 70 字**(逐字,md5 对拍✓)。

其余全保存态:PE启用?=true / 透明未动([6:4010].透明覆盖=false) / 速度档位=0 · Fun-Acc 4步 / seed=0 / [404] 负向主体句空——改前改后读回逐项一致(driver S7 五读回门全绿)。**无 1 型的裁定① seed 破缓存需要**:场景句本身即改变 PE 链输入→23/30 节点新鲜执行(含 6:4013/6:4011/6:4014 装配链与 7:7013 采样链),真渲染,零缓存回声(§7)。

## 7. 机器判据(后核 `verify/type-2-场景.postcheck.json`,exit=0,18/18)

| 判 | 项 | 实测 |
|---|---|---|
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=c1707be8-c301-44d5-b0d7-6411439d04a3 |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=7/30 |
| ✅ | seed 回读=[7:7014] | {"value": 0} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,504 |
| ✅ | 产物图存在且>0字节([8] type-2-场景.direct.png) | 9102292B |
| ✅ | PNG 魔数([8]) |  |
| ✅ | PNG 可解析(PIL,[8]) | {"mode": "RGBA", "size": [2560, 1712], "metaLen": 11758, "metaMd5": "fa02294db3c06904516131f62923e2da", "cornerAlpha": [ |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=11758 |
| ✅ | 产物图存在且>0字节([504] type-2-场景.2k.png) | 11659631B |
| ✅ | PNG 魔数([504]) |  |
| ✅ | PNG 可解析(PIL,[504]) | {"mode": "RGBA", "size": [3062, 2048], "metaLen": 11758, "metaMd5": "fa02294db3c06904516131f62923e2da", "cornerAlpha": [ |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=11758 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=4426 negLen=200 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:16 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:16 起 3 行 |

## 8. 勘误与标注(工具链,不影响判据)

- **驱动器原始终判红=1 型 §8 同款收割 bug 假红**:驱动器内嵌「PNG 元数据=history prompt」比对不剥节点级 `is_changed` 缓存指纹(pngMd5=0d2729b0…≠histMd5=968aa45e…)→其终判 ok=false/exit=1;权威判据=后核剥指纹后稳态同比对(§7 表「剥 is_changed 指纹」行✅,唯一差异域=6:4010,与 1 型同)。驱动器真实 exit=1;启动命令行末尾打印的「DRIVER_EXIT=0」系 zsh 无 PIPESTATUS、$? 取到 tee 退出码所致(命令书写问题,非驱动器退出码;如实按 1 记)。
- **R.prompts.peRewrite 只含装配首行**(743 字,driver:335 取 finalPos.split("\n")[0]):本拍 PE 扩写为 5 段多行体(3495 字),§1② 改用「BASE 190 字逐字对拍真源」从装配终稿定界切出完整段引用并记 md5 1945d63a…。
- **[6:4020] PE思考预览不随 history outputs 回放**(outputs 键=[8,401,504,505]):与 00:38 E2E 拍 ebe48f94 现象一致(FACTS §3.3 实测同),系本代工作流该件 UI 输出回收行为,非本拍缺陷;PE 改写输出溯源=装配首段逐字(§1②)。
- **驱动器 check 名模板本型拍前已修**:两处硬编码「型选择=人物」改为 ${TYPE_KEY}(1 型 §8 遗漏项;纯显示名,判据表达式未动,1 型拍判据不受影响)。
- **分辨率机制链(本拍定谳,含一处推断标注)**:①PE启用=true⇒[4018] MyQi21WhSuggest 联动开关=true(连线:排队图 4018.联动开关=["6:4012",2]=PE开关「true路」出;wh_ratio←["6:4021",1]←[6:4013] PE 改写的 wh_ratio 出)——**PE开=画幅听PE建议**,型底座 16:9(→2800×1576)为回退臂未走;②**PE wh_ratio="3:2" 实测**:出图后投确定性探针 prompt(pid=`b3a04803-0305-444f-919d-fd6ebf7cdec4`,prompt=b3a04803…;CLIPLoader(pe_t2i)+QwenImage21_T2IPromptRewrite(同排队图 6:4013 全参:seed=42/temp=1.0/top_p=0.95/top_k=20/pp=1.5/max_tokens=16256,主体句=①逐字)+easy showAnything(pe出2=wh_ratio);status=success,输出="3:2";seed 固定=确定性,与本拍 6:4013 同参同输出);③4018 公式(引擎家副本与仓库 diff 逐字节同):w=round(3×√(4.2·1024²/(3·2))/8)×8=**2568**,h=round(2×…/8)×8=**1712**(面积约束反证:4.2MP/8 取整公式对任何比例均不可直接产出 (2560,1712)——产物 4.38MP 恒低于 4.2MP 公差下界);④实测 2560=2568−8:**截格点未逐行定谳(推断)**——2560=16×160、2568 非 16 倍数;1 型对偶(PE 缓存竖幅 2:3→(1712,2568)→(1712,2560))与 E2E 00:38 拍(1712×2560,PIL 复核)三方同构/16 网格截 8 形态一致;EmptyLatentImage 逐源核过(nodes.py:1271 `width // 8` 整除=2568→321 格,无截),T8 FunAcc 件 latent 原样直通(nodes.py:142-146),Qwen2.1 模型 build_sequence 逐 latent 像素成 token 且带奇偶 RoPE 对齐(model.py:316-320)——三处均无 /16 截格代码,截格环节在 T8 采样管线/VAE 解码内部何处未逐行核源,如实标注为**推断**;⑤分辨率事实本身(2560×1712,横幅,与② 3:2 比例一致)为 PIL 双图复核**实测**,机制链中仅④的截格点为推断标注。
- **驱动器控制台末两行**与 raw(json) 的 ok=false 为上述①假红所致;raw 数据域(时间账/读回/断言/收据/图)全绿可用,本记录全部引证自 raw 与后核。
- **探针拍 b3a04803 为本型记录内独立取证件**(非产线拍;仅 CLIPLoader+PE改写+showAnything 三节点,零写盘零产线节点;4019 CLIP 缓存命中、PE 改写确定性重算),用于②的 wh_ratio 实测取证;不改本型产物收据链(①-⑤ 收据均属产线拍 c1707be8)。

## 9. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-2-场景.image-prompts.excerpt.log` | 源 image-prompts-20261006.log 行 16-18(入队+摘要+全量JSON) |
| ② PNG 元数据 | `verify/type-2-场景.png-prompt-metadata.json` | tEXt prompt(11,758B,30 节点,剥 is_changed 后与 history 稳态同;metaMd5=fa02294db3c06904516131f62923e2da) |
| ③ history prompt JSON | `runs/type-2-场景.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-2-场景.json` | 断言 12 项/读回前后/改动两笔/时间账(终判红=§8①假红) |
| 驱动控制台 | `logs/type-2-场景.driver.console.log` | 全程日志 |
| 后核 | `verify/type-2-场景.postcheck.json` | 机器判据权威判(18/18) |
| 产物图 | `images/type-2-场景.direct.png` / `images/type-2-场景.2k.png` | §4 |
| 主体句 canon | `/tmp/type2-subject-canon.txt`(临时)+ 本记录 §1① 全文引 | 70 字 md5 ac7e1dee… |
| PE 扩写全文 | 本记录 §1② 全文引(+ /tmp/type2-pe-full.txt 临时件,md5 1945d63a…) | 3495 字 5 段 |
