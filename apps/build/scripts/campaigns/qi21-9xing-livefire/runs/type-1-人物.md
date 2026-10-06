# 实弹记录 · 第 1/9 型「人物」(type-1-人物)

**结果:✅ 机器判据全绿**(后核 `postcheck_type.py` exit=0,判据见 §7;驱动器原始终判两红系收割代码 bug,见 §8 勘误)

- 日期:2026-10-06(排队 09:19:53 → 终态 09:24:07 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,manifest port=17000,comfyui 0.38.0/mps)——**复用现役,非本 run 所起(engineStartedByUs=false)**
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,根节点 20,与 FACTS §1 同版)
- 主体句:147 字,md5 `d5823ac89e03`——四源逐字一致(docs/prompts/道劫_九型主体句示例.md §1 / /tmp/i6-subject.txt / /tmp/qi21-ninetype-1004/ninetype_driver.mjs:44 / 工作流 [400] 默认值)
- prompt_id:`9c4d3719-5d46-4f91-8dac-eac84336f713`;client_id:`qi21-9xing-1-1791249593604`

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;出处=道劫_九型主体句示例.md §1 原文逐字)

```
一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，腰侧石青剑绦悬一柄长剑，乌木剑鞘、白玉剑格、剑柄缠灰银丝、鞘口垂暗红剑穗，剑身完整收在鞘中，右手轻按剑柄，视线越过阶下青灰云海望向远处，旧金色晨光自左侧斜照，衣袂被山风微微掀起。
```

### ② PE 改写输出(装配全文首行=[6:4013] positive_prompt;PE启用?=true 保存态)

> **溯源标注(引文外,owner 裁定记账②)**:本段为**缓存回放**——6:4013 在本拍 execution_cached 名单(18/30 节点缓存;seed 破缓存只作用于加速链,PE 链输入未变→引擎沿用缓存条目),与 2026-10-06 00:38 E2E 拍 ebe48f94 同源逐字,非本拍新鲜改写。[6:4020] thinking 同因缓存未随本拍 outputs 回放(空)。

```
A vertical fantasy portrait shows a young adult East Asian-looking woman standing on ancient stone steps high above a sea of clouds at sunrise. The upper-left portion of the image is filled with a warm golden sun partially diffused by haze, casting strong backlight across pale cream, peach, and gray clouds. Below the sky, rugged mountain ranges recede into atmospheric perspective, their silhouettes softened by mist and low sunlight. In the central area, the woman occupies most of the frame in a three-quarter full-body view, positioned slightly right of center and facing toward the right with her head turned into the distance. She has a slim build, fair skin, an oval face, delicate features, straight brows, defined eyeliner, long lashes, a softly highlighted nose bridge, and muted rose lips. Her expression is calm, serious, and contemplative. Her long black hair is styled partly up in a high ponytail with loose strands blown sideways by the wind, and a simple silver hairpin pierces the hairstyle near the crown. She wears dangling earrings and subtle jewelry that catch the warm light. Her clothing is an elegant qipao-inspired fantasy robe ensemble in translucent jade green, with layered flowing sleeves, fine embroidered patterns, silver trim, and sheer fabric that moves dramatically to the left in the wind. A stone-blue sword tassel hangs at her waist. Around her waist is a moon-white belt tied in a large knot, with decorative metallic ornaments and tassels. At her side hangs a sheathed sword with a dark red tassel hanging from the scabbard mouth; the weapon has a dark wooden or bronze-toned scabbard, ornate metal fittings, engraved details, and a hanging ribbon, positioned vertically beside her body. Her right hand rests lightly near the sword hilt, reinforcing a poised martial identity. The garments have smooth, satin-like and gauzy textures, with embroidered floral or vine-like motifs visible on the bodice and outer robe. The wind lifts the wide sleeves and trailing robe panels, creating sweeping diagonal shapes across the left side of the composition. In the lower-left and mid-background, a traditional Chinese-style pavilion or temple complex sits among trees and cliffs, rendered in muted gray-brown wood tones with layered tiled roofs and small architectural silhouettes. It is partially obscured by mist and depth-of-field blur, making it feel distant and elevated. On the right side, a large rocky cliff face rises diagonally from the lower-right corner toward the upper-right edge. The rock surface is dark gray and brown, rough, cracked, and mossy in places, with warm highlights along protruding edges. Behind and beneath the rocks, dense white and gray clouds fill the valleys like rolling mist. Across the bottom foreground, broad stone steps lead upward from the viewer’s position toward the woman. The steps are weathered rectangular slabs with chipped edges, cracks, uneven surfaces, patches of moisture or shadow, and warm rim lighting along their front edges. A carved stone railing appears at the lower-left edge, cylindrical and blocky with aged ornamentation, aligned diagonally with the staircase. The overall composition uses dramatic backlighting, shallow depth of field, cinematic contrast, and a soft painterly-realistic finish. The color palette combines golden sunrise tones, smoky grays, muted greens, and cool mountain shadows. The image reads as a high-fantasy wuxia or xianxia character portrait, emphasizing elegance, solitude, elevation, and heroic quietness within a vast mountain landscape.
```

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 4776 字 = PE 扩写 3562 + BASE 段 467 + 锁层A 739;行序=主体句→型底座→(增量锁/配色行)→锁层A)

```
A vertical fantasy portrait shows a young adult East Asian-looking woman standing on ancient stone steps high above a sea of clouds at sunrise. The upper-left portion of the image is filled with a warm golden sun partially diffused by haze, casting strong backlight across pale cream, peach, and gray clouds. Below the sky, rugged mountain ranges recede into atmospheric perspective, their silhouettes softened by mist and low sunlight. In the central area, the woman occupies most of the frame in a three-quarter full-body view, positioned slightly right of center and facing toward the right with her head turned into the distance. She has a slim build, fair skin, an oval face, delicate features, straight brows, defined eyeliner, long lashes, a softly highlighted nose bridge, and muted rose lips. Her expression is calm, serious, and contemplative. Her long black hair is styled partly up in a high ponytail with loose strands blown sideways by the wind, and a simple silver hairpin pierces the hairstyle near the crown. She wears dangling earrings and subtle jewelry that catch the warm light. Her clothing is an elegant qipao-inspired fantasy robe ensemble in translucent jade green, with layered flowing sleeves, fine embroidered patterns, silver trim, and sheer fabric that moves dramatically to the left in the wind. A stone-blue sword tassel hangs at her waist. Around her waist is a moon-white belt tied in a large knot, with decorative metallic ornaments and tassels. At her side hangs a sheathed sword with a dark red tassel hanging from the scabbard mouth; the weapon has a dark wooden or bronze-toned scabbard, ornate metal fittings, engraved details, and a hanging ribbon, positioned vertically beside her body. Her right hand rests lightly near the sword hilt, reinforcing a poised martial identity. The garments have smooth, satin-like and gauzy textures, with embroidered floral or vine-like motifs visible on the bodice and outer robe. The wind lifts the wide sleeves and trailing robe panels, creating sweeping diagonal shapes across the left side of the composition. In the lower-left and mid-background, a traditional Chinese-style pavilion or temple complex sits among trees and cliffs, rendered in muted gray-brown wood tones with layered tiled roofs and small architectural silhouettes. It is partially obscured by mist and depth-of-field blur, making it feel distant and elevated. On the right side, a large rocky cliff face rises diagonally from the lower-right corner toward the upper-right edge. The rock surface is dark gray and brown, rough, cracked, and mossy in places, with warm highlights along protruding edges. Behind and beneath the rocks, dense white and gray clouds fill the valleys like rolling mist. Across the bottom foreground, broad stone steps lead upward from the viewer’s position toward the woman. The steps are weathered rectangular slabs with chipped edges, cracks, uneven surfaces, patches of moisture or shadow, and warm rim lighting along their front edges. A carved stone railing appears at the lower-left edge, cylindrical and blocky with aged ornamentation, aligned diagonally with the staircase. The overall composition uses dramatic backlighting, shallow depth of field, cinematic contrast, and a soft painterly-realistic finish. The color palette combines golden sunrise tones, smoky grays, muted greens, and cool mountain shadows. The image reads as a high-fantasy wuxia or xianxia character portrait, emphasizing elegance, solitude, elevation, and heroic quietness within a vast mountain landscape.
主体的单人立绘，全身入画，头身比约七头半，解剖比例写实，下肢不过度拉长。运笔有提按顿挫的细墨线勾勒全身轮廓，线随结构时粗时细，转折衔接处轻重分明；墨色浓淡分明，干湿五阶层次清楚，近处轮廓清楚、墨线饱满，远景以淡墨晕染层层退开。背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，受控饱和而非一律低饱和；一块鲜明的点题色收束视线；均匀柔光，浅净平涂的底，画面疏朗有呼吸。
衣褶/裙摆：使用宽幅平静布面，正面仅允许两到四条长结构褶（稀疏结构褶 2-4 条）。
材质可以朴素或粗陋（灰布、素袍、劳动布）但须看起来可穿且完整；服饰保持结构安静：袖口和下摆是连续闭合布面。
头发存在：头皮须有可见头发，有清晰发量与发际线；短发、长发、扎发、平头或短寸均可。
鞋靴性别：鞋靴性别呈现须匹配角色生理性别与来源事实。
人物设色配比：大面积淡墨为稳定基底，石青、青绿、赭石为中等强度人物色，旧金、朱红为少量高识别强调色。
衣物完整性：服饰须完整、线条干净、可生产。
风格底座：现代修仙游戏的数字绘画资产（modern Chinese illustration）——中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、服饰、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术，不是把一幅古画直接搬进游戏。媒介：现代数字绘画完成度的 2D 传统绘画语言——连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明，干净空灵，清晰视觉焦点。底色：浅净哑光平涂底的完成度，多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位），保证可读性。画面保持干净平滑：墨与色落在平涂色场上，而非有纹理的纸面。工笔线条质量：连续铁线描；曲线自然顺滑，直线笔直稳定；线宽连续且有节奏，转折、衔接与起收笔干净；细稳基调上转折处轻重提按，墨线带手绘笔性，防机械勾边与矢量感。线描优先工笔结构：100% 视图下，脸部、手部、发丝、衣边、缝线、褶皱、配件和武器构造须先于上色或 shading 从连续纪律性 linework 保持可读。用白描/铁线描加薄透矿物罩染、反复轻分染与罩染建模；保持浅净平涂底面在层间呼吸。浅净哑光底须在每层色罩下保持可见，除非是刻意的墨线、紧凑发块或来源事实要求的深色主体（如尚黑阵营的甲胄旗纛）。成片质量：生产级最终画面清晰度——强制降噪泥糊 AI 伪影；边缘锐利但不产生过锐光晕；表面干净可读；颜料层纯净均匀。默认表面须保持干净精致：只用纯净罩染与克制的矿物颗粒。岁月、风霜或战痕仅在来源事实要求时作克制的叙事线索，须次要、不抢戏。电影级成片质量指干净的可读性与精致的工艺清晰度。
```

### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,负向文本仍在链生成并预览,采样端不消费)

```
模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，扇贝状/破损/分叉的裙摆或袍摆，分叉袍摆，分离的飘带状下摆条，下摆缺角，风碎流苏，乞丐破衣，撕裂下摆，碎边，破洞，磨损补丁，虫蛀布面，垂挂碎条，绳捆破布，刻意破烂造型，拉扯衣袍，分裂衣袍，分叉衣袍，破破烂烂，剃净头皮，透明头皮，无发干净圆顶，女性高跟鞋，细高跟，尖头女鞋，精巧女舞鞋，细带玛丽珍鞋，男性超大号通用工靴，异装鞋靴, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
```

## 2. 时间账

| 事件 | 时刻(CST) |
|---|---|
| graphToPrompt 干跑+投前断言 12 项全绿 | 09:19:53 |
| POST /prompt 受理(tQueue) | 2026-10-06T01:19:53.604Z |
| 进入 running(tRunningSeen) | 2026-10-06T01:19:53.621Z(排队等待≈17ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06 09:22:30 |
| 2K 落盘(引擎侧 mtime) | 2026-10-06 09:24:05 |
| 终态 success(tDone) | 2026-10-06T01:24:07.227Z |

**排队→出图 = 4.23 分钟**(durationMin,实测;含模型重载+Fun-Acc 4 步采样+SeedVR2 2K 放大)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode) | 保存态 |
| seed | **4101**([7:7014].inputs={"value": 4101}) | **偏差:保存态=0,裁定①破缓存**(见 §6) |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,无外接采样器) | 档0 口径(FACTS §1 档位表) |
| 分辨率 | 1712×2560(3:4 竖幅;PE 开→画幅跟 [4018] 建议) | 与文档 §1「人物(3:4 竖幅)」一致 |
| 透明 | 跟型=false([6:4010].透明覆盖=false) | 人物 rgba_default=false;PNG 为 RGBA 但四角 alpha=255/254(全不透明),非透明型不开 alpha 门仅记录 |
| PE | [6:4013] QwenImage21_T2IPromptRewrite,pe_t2i 权重,seed=42/temp1.0/pp1.5(保存态) | 输出缓存回放(§1②标注) |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 引擎侧原文件(mtime) |
|---|---|---|---|---|
| [8] 直出 | `images/type-1-人物.direct.png` | 8372893 | 1712×2560 RGBA | QI21道劫文生图__00106_.png(09:22:30) |
| [504] 2K | `images/type-1-人物.2k.png` | 10949704 | 2048×3062 RGBA | MYStudio-2K_00027_.png(09:24:05) |

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 13-15,原文逐字;全量JSON 行 6545 字符见存档)

```
[MY出图][入队][2026-10-06 09:19:53] number=2 prompt_id=9c4d3719-5d46-4f91-8dac-eac84336f713
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors ×1.0 | KSampler: seed=['7:7014', 0] …
```

(摘要行为原文首段截断续以「…」;KSampler 段完整原文与 [全量JSON] 行见 `logs/type-1-人物.image-prompts.excerpt.log`。)

## 6. 与保存态偏差(owner 2026-10-06 裁定①诚实记账;总报告须列「与保存态偏差」节)

1. **seed=4101(保存态=0)**:首拍(严格两处改动:型选择=人物+[400]=canon 原句)与本引擎 00:38 E2E 拍(ebe48f94)执行面 30/30 节点逐字全同(工作流保存态的 [400] 默认句恰=人物型 canon 句)→ 100% 节点缓存命中(25/25 execution_cached,188ms"success",零真渲染,产物指向旧文件 00105/00026)。owner 裁定①:允许 seed=4100+型序号 破缓存重投一次(先例=cfg4 战役固定 seed);裁定②重启引擎禁;裁定③缓存回声禁。证据:`runs/type-1-人物.attempt1-cache-echo.json`(首拍 raw,pid f3539410-34ba-48f6-bd68-7fb3d199a31f)、`runs/type-1-人物.history.attempt1-cache-echo.json`、`verify/type-1-人物.cache-collision-diff.json`(30/30 全同)、引擎日志行 10-12(首拍入队块)。
2. **PE 改写输出=缓存回放**(见 §1② 溯源标注):与 ebe48f94 同源逐字,非本拍新鲜改写。
3. **出图与耗时=本拍真实实测**(§2/§4;引擎侧新文件 00106/00027 mtime 落窗;18/30 节点缓存、12 键不在缓存名单(含 7:7013/7:7014/5/8/503/504 采样保存链新鲜执行))。
4. 九型通例(裁定原文,本拍起生效):任何型合规拍若 100% 节点缓存命中,一律改 seed=4100+型序号 后重投一次(仍全缓存才算失败;ALLOW_CACHE_ECHO 门保持关闭)。

## 7. 机器判据(后核 `verify/type-1-人物.postcheck.json`,exit=0)

| 判 | 项 | 实测 |
|---|---|---|
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=9c4d3719-5d46-4f91-8dac-eac84336f713 |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=18/30 |
| ✅ | seed 回读=[7:7014] | {"value": 4101} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,504 |
| ✅ | 产物图存在且>0字节([8] type-1-人物.direct.png) | 8372893B |
| ✅ | PNG 魔数([8]) |  |
| ✅ | PNG 可解析(PIL,[8]) | {"mode": "RGBA", "size": [1712, 2560], "metaLen": 12223, "metaMd5": "fe7c503668a2877eb020df955602ef93", "cornerAlpha": [255, 255, 254, 255]} |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12223 |
| ✅ | 产物图存在且>0字节([504] type-1-人物.2k.png) | 10949704B |
| ✅ | PNG 魔数([504]) |  |
| ✅ | PNG 可解析(PIL,[504]) | {"mode": "RGBA", "size": [2048, 3062], "metaLen": 12223, "metaMd5": "fe7c503668a2877eb020df955602ef93", "cornerAlpha": [255, 255, 255, 255]} |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12223 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=4776 negLen=388 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:13 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:13 起 3 行 |

## 8. 勘误(工具链,不影响判据)

- 驱动器 `drive_type.mjs` 收割段两 bug 于本拍发现并已修复(供 2-9 型):①history `entry.prompt` 为五元组,prompt 字典在 `[2]`(S12 参数回读与 PNG 元数据比对曾误读);②ESM 内 `require("node:fs")` 未定义(引擎侧 mtime 曾 null)。驱动器原始终判(`runs/type-1-人物.json` 的 ok=false)即此二 bug 所致;权威判据=独立后核(§7)。
- 后核比对 PNG 元数据与 history prompt 时剥节点级 `is_changed`(IS_CHANGED 缓存指纹;唯一差异域=6:4010,PNG 侧在/history 侧被服务端消费;剥离项记录在 postcheck.json)。

## 9. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-1-人物.image-prompts.excerpt.log` | 源 image-prompts-20261006.log 行 13-15(入队+摘要+全量JSON) |
| ② PNG 元数据 | `verify/type-1-人物.png-prompt-metadata.json` | [504] 2K 图 tEXt prompt(12,223B,30 节点,剥 is_changed 后与 history 稳态同) |
| ③ history prompt JSON | `runs/type-1-人物.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-1-人物.json` | 断言 12 项/读回/改动三笔/时间账 |
| 驱动控制台 | `logs/type-1-人物.driver.console.log` | 全程日志 |
| 首拍(回声)存档 | `runs/type-1-人物.attempt1-cache-echo.json` 等 | 见 §6.1 |
| 后核 | `verify/type-1-人物.postcheck.json` | 机器判据权威判 |
| 产物图 | `images/type-1-人物.direct.png` / `images/type-1-人物.2k.png` | §4 |
