# 实弹记录 · 第 3/9 型「道具」(type-3-道具)

**结果:❌ 透明门红——其余机器判据全绿(18/19),本型为透明型(FACTS rgba_default=true),四角 alpha 门实测 2/4 角不透明,响亮失败**

- 日期:2026-10-06(排队 10:08:32 → 终态 10:15:15 CST)
- 引擎:`http://127.0.0.1:17000`(pid 92224,复用现役,与 FACTS §4.3 同一进程;**非本 run 所起,engineStartedByUs=false**)
- 工作流:`apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`(md5 `65d4708ff1d9557caa8813e913b516b6`,115,614B,mtime 2026-10-06 00:35:30——**实弹前复核未变,与 FACTS §1/2 型记录同版**;实弹后亦未改真源,仓库保存态保持)
- 主体句:135 字,md5 `122d7b2ff38d3cd64f343c63fbc38918`——三源逐字一致(docs/prompts/道劫_九型主体句示例.md §3(终极真源,程序化核 `in doc=True`)/ /tmp/qi21-ninetype-1004/ninetype_driver.mjs:48(FACTS §2 出处)/ /tmp/qi21-ninetype-1004/report-run1-types1to4.json shots[2].subject(1004 cfg4 实拍账))
- prompt_id:`fc46aba4-3c78-493b-8bf5-b82e8def7c7a`;client_id:`qi21-9xing-3-1791252512644`
- **与保存态偏差:无**——恰两处改动=型选择/[400] 主体句;seed=0 保存态未动;29/30 节点新鲜执行(仅 [4019] PE TE 加载器缓存),零缓存回声,无需 1 型裁定① seed 破缓存通道

## 1. 三段提示词全文逐字

### ① 输入主体句([400] 置值;canon=/tmp/type3-subject-canon.txt,md5 122d7b2f…)

```
一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹，剑格铸成兽首衔环，剑柄缠深红丝绳，穗尾垂一枚带裂纹的灵玉；上引线旁以端正的墨色小字注“全长110厘米（三尺三寸）”，靠剑格一端的引线旁注“刃长88厘米（二尺六寸）”，柄端引线旁注“柄长22厘米（七寸）”，字迹清晰可辨。
```

### ② PE 改写输出([6:4013] QwenImage21_T2IPromptRewrite 本拍新鲜推理——6:4013 在新鲜执行名单;全文=最终正向行0-10 共 3622 字(含 RGBA 头句前缀),md5 2d065e6e…;临时件 /tmp/type3-pe-full.txt)

> **溯源标注(引文外)**:本拍 PE 扩写=**新鲜推理**(29/30 节点新鲜,含 6:4013/6:4011/6:4014 装配链与 7:7013 采样链;对比 1 型拍的 PE 缓存回放)。**⚠️ 关键事实:PE 扩写首段主动开出了不透明暗背景**——「cinematic product-style photograph … laid diagonally across **a dark, rough wooden or stone-textured surface** … **The background is matte, grainy, and uneven, in dark brown-gray tones** … museum-display atmosphere」(与四重透明指令直接冲突,详见 §7 根因)。引文含行0头句「这是一张带有透明度的RGBA图像。 」(FinalOutput 透明包裹头句,非 PE 扩写本体)。

```
这是一张带有透明度的RGBA图像。 A single cinematic product-style photograph shows an ornate antique Chinese sword laid diagonally across a dark, rough wooden or stone-textured surface. The sword runs from the lower-left area toward the upper-right corner, photographed from an overhead oblique angle with shallow depth of field, warm directional lighting, and dramatic low-key color grading. The background is matte, grainy, and uneven, in dark brown-gray tones with subtle cracks, scratches, and natural surface texture, creating a historical museum-display atmosphere.

The main object occupies most of the frame: a long fantasy-historical ceremonial sword with a dark brass or bronze-toned blade, aged patina, and raised decorative swirling patterns engraved or cast along the steel surface. The blade is broad and slightly tapering, with a pointed tip near the lower-left side of the image; its edges are darker and worn, while the central face has ornate gold-bronze linework resembling clouds, waves, or traditional filigree motifs. Near the middle-right of the blade, a thin black annotation line with a small black dot points toward the blade area, accompanied by small clear black Chinese serif-style label text reading "全长110厘米（三尺三寸）". This label functions as a measurement annotation for the full length of the sword.

Near the upper portion of the blade, close to the guard, another thin black leader line points downward toward the blade/guard region. Beside it, small clear black Chinese annotation text reads "刃长88厘米（二尺六寸）", identifying the blade length. The sword guard is highly elaborate and sits slightly left of center: it has a weathered bronze-and-teal patina finish, sculptural guardian-beast or dragon-like heads on both sides with bulging eyes, open mouths, curling horns, fangs, and layered flame-like ridges. Between these beast heads is a decorated cylindrical crossguard with carved geometric borders and cloud-like reliefs. A large circular ring rises vertically from the guard, made of dark aged metal with a bronze rim and visible patina; the ring passes through the hilt and visually forms a prominent oval arc above the sword.

The handle extends from the guard toward the upper-right corner. It is wrapped tightly in deep burgundy-red cord with a twisted textile texture, producing a repeated ribbed pattern along the shaft. The pommel at the far upper-right end is capped with dark bronze metal, including a small rounded ring or loop at the very top. The metal surfaces throughout the sword appear scratched, oxidized, and antiqued, combining gold, bronze, dark teal, and blackened shadow tones.

Below the rear guard, red braided cords hang downward in loose strands, tied into knots and fringed tassels. Suspended among them is a pale translucent jade-like pendant, irregularly round and rectangular-rounded in shape, with cloudy white-green coloring, visible crack-like veins, and a polished but aged surface. The pendant hangs beneath the guard near the lower-center-left area, adding contrast against the dark background. Around this hanging section, a third thin black leader line with a small black dot points toward the handle/tassel assembly, next to small clear black Chinese annotation text reading "柄长22厘米（七寸）", labeling the handle length.

The overall composition emphasizes craftsmanship and age: the sword is sharply focused while the surrounding surface falls into softer blur toward the edges. Thin black annotation lines and dots resemble technical documentation or museum catalog callouts, placed over the realistic photograph without obscuring the sword’s detailed ornamentation.
```

### ③ 最终正向全文([6:4014]→[4015] 主编码;[401] 预览逐字,共 4711 字;行序=头句+PE 扩写 6 段→空行→型底座 BASE 226(尺寸标注设定图段,逐字=qi21_bases.json 道具条 positive_text,末句「图为带透明通道的 RGBA 透明底图，背景透明。」)→设色配比 47→锁层A 739+W1收束句+RGBA尾句)

```
这是一张带有透明度的RGBA图像。 A single cinematic product-style photograph shows an ornate antique Chinese sword laid diagonally across a dark, rough wooden or stone-textured surface. The sword runs from the lower-left area toward the upper-right corner, photographed from an overhead oblique angle with shallow depth of field, warm directional lighting, and dramatic low-key color grading. The background is matte, grainy, and uneven, in dark brown-gray tones with subtle cracks, scratches, and natural surface texture, creating a historical museum-display atmosphere.

The main object occupies most of the frame: a long fantasy-historical ceremonial sword with a dark brass or bronze-toned blade, aged patina, and raised decorative swirling patterns engraved or cast along the steel surface. The blade is broad and slightly tapering, with a pointed tip near the lower-left side of the image; its edges are darker and worn, while the central face has ornate gold-bronze linework resembling clouds, waves, or traditional filigree motifs. Near the middle-right of the blade, a thin black annotation line with a small black dot points toward the blade area, accompanied by small clear black Chinese serif-style label text reading "全长110厘米（三尺三寸）". This label functions as a measurement annotation for the full length of the sword.

Near the upper portion of the blade, close to the guard, another thin black leader line points downward toward the blade/guard region. Beside it, small clear black Chinese annotation text reads "刃长88厘米（二尺六寸）", identifying the blade length. The sword guard is highly elaborate and sits slightly left of center: it has a weathered bronze-and-teal patina finish, sculptural guardian-beast or dragon-like heads on both sides with bulging eyes, open mouths, curling horns, fangs, and layered flame-like ridges. Between these beast heads is a decorated cylindrical crossguard with carved geometric borders and cloud-like reliefs. A large circular ring rises vertically from the guard, made of dark aged metal with a bronze rim and visible patina; the ring passes through the hilt and visually forms a prominent oval arc above the sword.

The handle extends from the guard toward the upper-right corner. It is wrapped tightly in deep burgundy-red cord with a twisted textile texture, producing a repeated ribbed pattern along the shaft. The pommel at the far upper-right end is capped with dark bronze metal, including a small rounded ring or loop at the very top. The metal surfaces throughout the sword appear scratched, oxidized, and antiqued, combining gold, bronze, dark teal, and blackened shadow tones.

Below the rear guard, red braided cords hang downward in loose strands, tied into knots and fringed tassels. Suspended among them is a pale translucent jade-like pendant, irregularly round and rectangular-rounded in shape, with cloudy white-green coloring, visible crack-like veins, and a polished but aged surface. The pendant hangs beneath the guard near the lower-center-left area, adding contrast against the dark background. Around this hanging section, a third thin black leader line with a small black dot points toward the handle/tassel assembly, next to small clear black Chinese annotation text reading "柄长22厘米（七寸）", labeling the handle length.

The overall composition emphasizes craftsmanship and age: the sword is sharply focused while the surrounding surface falls into softer blur toward the edges. Thin black annotation lines and dots resemble technical documentation or museum catalog callouts, placed over the realistic photograph without obscuring the sword’s detailed ornamentation.
主体的尺寸标注设定图：器物主体以正侧面平视图水平居中平放，占画面大部；器物上方与下方各伸出一条细墨线引线，引线两端各带一枚短箭头，箭头轻触器物两端；每条引线旁注一行端正的墨色小字尺寸标注，数字清晰可辨；同一件器物，材质、底色、纹样与器身一致。运笔有提按顿挫的细墨线勾勒轮廓，线随结构时粗时细，转折处轻重分明，细稳处带手绘笔性；墨色浓淡分明。传统色多色相铺陈，旧金、玉青、赭石、朱红各安其位，薄透罩染轻敷。图为带透明通道的 RGBA 透明底图，背景透明。
道具设色配比：大面积淡墨为稳定基底，旧金、玉青、赭石为中等强度器物色，朱红为少量高识别强调色。
风格底座：现代修仙游戏的数字绘画资产（modern Chinese illustration）——中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组：第一眼是现代游戏，第二眼见中国传统绘画底蕴，第三眼线条、服饰、色彩、留白、构图来源可辨；把中国传统绘画的视觉规则重新组织为现代游戏美术，不是把一幅古画直接搬进游戏。媒介：现代数字绘画完成度的 2D 传统绘画语言——连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明，干净空灵，清晰视觉焦点。底色：浅净哑光平涂底的完成度，多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位），保证可读性。画面保持干净平滑：墨与色落在平涂色场上，而非有纹理的纸面。工笔线条质量：连续铁线描；曲线自然顺滑，直线笔直稳定；线宽连续且有节奏，转折、衔接与起收笔干净；细稳基调上转折处轻重提按，墨线带手绘笔性，防机械勾边与矢量感。线描优先工笔结构：100% 视图下，脸部、手部、发丝、衣边、缝线、褶皱、配件和武器构造须先于上色或 shading 从连续纪律性 linework 保持可读。用白描/铁线描加薄透矿物罩染、反复轻分染与罩染建模；保持浅净平涂底面在层间呼吸。浅净哑光底须在每层色罩下保持可见，除非是刻意的墨线、紧凑发块或来源事实要求的深色主体（如尚黑阵营的甲胄旗纛）。成片质量：生产级最终画面清晰度——强制降噪泥糊 AI 伪影；边缘锐利但不产生过锐光晕；表面干净可读；颜料层纯净均匀。默认表面须保持干净精致：只用纯净罩染与克制的矿物颗粒。岁月、风霜或战痕仅在来源事实要求时作克制的叙事线索，须次要、不抢戏。电影级成片质量指干净的可读性与精致的工艺清晰度。 主体呈现为干净的平面剪裁,单一独立素材完整保持在画幅内,四周被空白透明度包围,轮廓至边缘清晰完整不断裂。 该图像具有alpha通道,背景是透明的。
```

### ③′ 最终负向全文([6:4014]→[4016] 负向编码;档0 Fun-Acc 无负槽,负向文本仍在链生成并预览,采样端不消费——[7016] Note 口径)

> **构成标注(引文外)**:共 200 字,以「, 」连接两段——首段=道具型负面「模糊，水印，多手指，文字错误」(真源 qi21_bases.json 道具条 negative_text 逐字,已在档核对);次段=锁层负面(基础负面串+美学禁令串,整 token 去重不跨段合并基础串故两现——与 2 型拍同构)。**注意:现行负向链无任何透明底指令**(对比 1004 cfg4 时代中文 PE 负向「负面清单：无额外边框、无关水印、无关人物、环境场景、现代背景元素。保持透明底（以灰白棋盘格示意）。」——该拍 alpha0 占比 76.5% 透明合格,见 §7 对照表)。[404] 负向主体句保存态空,主体句负面第三源为空段(与保存态一致)。

```
模糊，水印，多手指，文字错误, 模糊，水印，多手指，文字错误，网文封面美人，古风美女/帅哥偶像海报，光面现代 CG 特写，赛璐璐，好莱坞三点电影光，深重写实投影，禁止电影级主光/填充/轮廓光三点布光，电影级主光，轮廓光，大块不透明色面，厚数字颜料块，喷枪明暗法，软3D体积塑形，油亮高光，油黑渐变，古画直接搬进游戏，商业人物/UI/logo 复制，泥糊死黑块，黑白滤镜化，满幅泼墨，霓虹色，糖果饱和度
```

## 2. 时间账

| 事件 | 时刻(CST) |
|---|---|
| graphToPrompt 干跑+投前断言 12 项全绿 | 10:08:32 |
| POST /prompt 受理(tQueue) | 2026-10-06T02:08:32.644Z |
| 进入 running(tRunningSeen) | 2026-10-06T02:08:32.662Z(排队等待≈18ms) |
| 直出落盘(引擎侧 mtime) | 2026-10-06 10:13:43 |
| 2K 落盘(引擎侧 mtime) | 2026-10-06 10:15:12 |
| 终态 success(tDone) | 2026-10-06T02:15:15.648Z |

**排队→出图 = 6.72 分钟**(durationMin,实测;含 PE 9B 模型新鲜改写+Fun-Acc 4 步采样+SeedVR2 2K 放大;预算 38min 帽内;耗时与 2 型(6.9)同量级)。

## 3. 实际参数回读(history entry.prompt[2],以回读为准)

| 参数 | 实测 | 备注 |
|---|---|---|
| 档位 | `0 · Fun-Acc 4步`([7:7015].mode) | 保存态 |
| seed | **0**([7:7014].inputs={"value": 0};[7:7013].seed=["7:7014",0] 连线) | **=保存态,未动**(无 1 型裁定① 破缓存需要——本拍 29/30 新鲜) |
| 步数/cfg | Fun-Acc 4 步/cfg 内置([7:7013]=T8QwenImage21FunAccPDD4Step,model=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors,positive←[4015,0],latent←[4,0]) | 档0 口径(FACTS §1 档位表;7010/7012 两支路在图未选) |
| 分辨率 | **2560×1712(横幅≈3:2,4.38MP)**;[4].width/height=["4018",0/1] 连线驱动 | **PE建议路**(型底座道具 1:1@1.0MP→1024×1024 为回退臂未走——该回退值恰被 dedup(PE关)实拍互证,见 §7)。**wh_ratio="3:2" 确定性探针实测**(pid 97878877-c854-4531-8a07-1bec68edd34d,CLIPLoader(pe_t2i)+QwenImage21_T2IPromptRewrite(同排队图 6:4013 全参:seed=42/temp=1.0/top_p=0.95/top_k=20/pp=1.5/max_new_tokens=16256,主体句=①逐字)+easy showAnything(pe出2);status=success,输出="3:2",与 2 型拍探针同值)。4018 建议路恒锚 4.2MP(round(a·sqrt(4.2·1024²/(a·b))/8)·8,my_qi21_wh_suggest.py:2-10 公式逐字)→(2568,1712)→实测 2560=2568 经 /16 网格截 8(**推断**,与 2 型 §8④ 同款形态:三方同构=2型/3型/E2E 00:38 拍均落 2560) |
| 透明 | **跟型=true 在链生效**:[6:4010].透明覆盖=false(九型透明=型默认优先)+rgba_default=true(道具,真源 qi21_bases.json 程序化核对)→[6:4014].透明模式←[6:4010,3](透明值口,**透明自动跟型连线在拍**)→正向文本头句/W1/尾句三短语各恰 1 次(§1③ 计数,与 dedup 去重后形态同) | **链路通,渲染结果未从**——详见 §7 |
| PE | [6:4013] QwenImage21_T2IPromptRewrite,pe_t2i 权重(本拍缓存加载([4019] 唯一缓存件);改写本体=新鲜推理(seed=42/temp=1.0/top_p=0.95/top_k=20/pp=1.5/max_new_tokens=16256)) | 输出=本拍新鲜改写(§1②) |

## 4. 产物图

| 图 | 本仓拷贝 | 字节 | 尺寸/模式 | 四角 alpha | 引擎侧原文件(mtime) |
|---|---|---|---|---|---|
| [8] 直出 | `images/type-3-道具.direct.png` | 7,013,317 | 2560×1712 RGBA | **[255, 255, 1, 0]** | QI21道劫文生图__00108_.png(10:13:43) |
| [504] 2K | `images/type-3-道具.2k.png` | 9,851,067 | 3062×2048 RGBA | **[255, 255, 0, 0]** | MYStudio-2K_00029_.png(10:15:12) |

(2K=SeedVR2 短边2048 放大;2560×1712→3062×2048,比例保持≈1.495=3:2,与 2 型拍同规格。)

### alpha 形态实测(引擎 venv PIL+numpy,现场跑)

- **直出 [8]**:完全透明(alpha=0)占 **8.53%**,不透明(alpha≥247)占 **90.65%**;按行 20 带平均 alpha=[255×18 带, 38.1, 0]——**上 90% 全不透明,仅底部约 10% 高度带透明**;左上/右上 128×128 角块不透明占比 100%;不透明区域 bbox=rows[0,1553]×cols[0,2559](全覆盖)。
- **2K [504]**:同形态(不透明 90.62%;底部 2 带透明;角块同)。
- 顶部不透明区 RGB:四角/顶中≈(248,250,253)近白;画面中上带采样点(73,65,57)深色——剑体;底部透明带 RGB 为预乘残值(alpha=0)。
- **机器门**:任务书「四角 alpha=0」→ 2/4 角=255,**FAIL**;战役门(b3d8647 口径四角≤8)→ 同判 **FAIL**。

## 5. 引擎日志时间窗摘录(image-prompts-20261006.log 行 22-24,原文逐字;全量JSON 行 6530 字符见存档)

```
[MY出图][入队][2026-10-06 10:08:32] number=5 prompt_id=fc46aba4-3c78-493b-8bf5-b82e8def7c7a
[MY出图][摘要] UNETLoader: qwen_image_2.1_bf16.safetensors | CLIPLoader: qwen3vl_8b_bf16_heretic.safetensors | VAELoader: qwen_image_2.1_vae_bf16.safetensors | 分辨率: ['4018', 0]x['4018', 1] batch=1 | 保存前缀: QI21道劫文生图_ | 保存前缀: MYStudio-2K | CLIPLoader: qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors | LoRA: Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safatenso… ×1.0 | KSampler: seed=['7:7014', 0] cfg=1.0 steps=6 sampler=euler scheduler=simple denoise=1.0 | KSampler: seed=['7:7014', 0] cfg=4.0 steps=40 sampler=euler scheduler=simple denoise=1.0
```

(摘要行为源日志行逐字全文——行内「safatenso… ×1.0」省略号是引擎侧日志钩子对 LoRA 文件名的原生截断,在源行内,非本记录截断;与 1/2 型拍摘要行逐字符相同(同形属预期)。[全量JSON] 行 6530 字符全文见 `logs/type-3-道具.image-prompts.excerpt.log`。)

## 6. 与保存态偏差

**无。**两处改动恰为任务书允许的两处:

1. 型选择:人物→**道具**([6] 宿主面板 widget;投前排队图断言 [6:4010].base=「道具」✓;型底座 BASE 226 字逐字进装配 §1③)。
2. 主体句:[400] value→**道具 canon 135 字**(逐字,md5 对拍✓;改前=147 字人物句)。

其余全保存态:PE启用?=true / 透明未动([6:4010].透明覆盖=false) / 速度档位=0 · Fun-Acc 4步 / seed=0 / [404] 负向主体句空——改前改后读回逐项一致(driver S7 五读回门全绿+投前 12 断言全绿,含 D5 三闸/BASE←型底座/锁层A 739 字逐字)。

## 7. ★ 透明门红——根因定谳(证据链)

**现象**:道具 rgba_default=true(FACTS §2 对账;真源 qi21_bases.json 道具条 rgba_default=true 程序化核对)→ 任务书加验四角 alpha=0 → 实测四角 [8]=[255,255,1,0]、[504]=[255,255,0,0],**上两角不透明,FAIL**;整幅 90.6% 不透明,仅底部 ~10% 高度带透明(§4)。

**链路取证(链是通的)**:
1. **透明机制=纯提示词驱动**:`my_qi21_final_output.py:190-193` compose 在透明模式=true 时仅做文本包裹(头句+装配全文+W1收束句+尾句),**全管线无任何 alpha 后处理抠图/rembg**——是否真出透明底全凭模型对提示的服从性。
2. **跟型连线在拍**:[6:4014].透明模式←[6:4010,3](透明值口;型≠自由→透明值=rgba_default=true,`my_qi21_base.py:259-279`)。
3. **包裹已生效**:最终正向含「这是一张带有透明度的RGBA图像」「主体呈现为干净的平面剪裁」「该图像具有alpha通道」各恰 1 次(§1③ 计数=dedup b3d8647 去重后形态)+BASE 末句「图为带透明通道的 RGBA 透明底图，背景透明。」——**四重透明指令全在正向**。

**根因(直接证据)**:PE启用?=true(保存态)⇒ 主体句过 QwenImage21_T2IPromptRewrite(pe_t2i)——**PE 扩写首段主动开出了不透明暗背景且通篇持之**:「laid diagonally across **a dark, rough wooden or stone-textured surface**」「**The background is matte, grainy, and uneven, in dark brown-gray tones** with subtle cracks, scratches, and natural surface texture, creating a historical museum-display atmosphere」(§1② 行0);后段「adding contrast against **the dark background**」「placed over **the realistic photograph**」持续强化(行4/行10)。模型(PDD T8 FunAcc 4步)在四重中文透明指令 vs 英文扩写主体叙事的冲突中**跟随了后者**——上 90% 画面为哑光暗背景实拍场景,仅底部约 10% 高度带被敲为透明。

**跨拍对照(该组合首测即红,先例全部异组合)**:

| 拍 | 型 | PE | 档/seed | 分辨率 | alpha 结果 |
|---|---|---|---|---|---|
| 1004 cfg4(pidor af50c297,10-04) | 道具 | **中文 PE(MyQi21ChinesePE)** | 档1 直出40步/cfg4,seed=4103 | 2800×1568 | **alpha0 占比 76.5%,alphaOk=true**(合格透明;负向含「保持透明底（以灰白棋盘格示意）」) |
| dedup(b3d8647 先例,pid 7b39fb65,10-05 16:30) | 道具 | **false(关)** | FunAcc 4步,seed=1(破缓存) | **1024×1024**(=道具型底座回退臂 1:1@1.0MP) | **四角 alpha=[0,0,2,0] 全≤8,PASS**(20/20 全过) |
| **本拍(fc46aba4,10-06)** | 道具 | **true(开,保存态)** | FunAcc 4步,seed=0(保存态) | 2560×1712(=PE建议 3:2@4.2MP) | **四角 [255,255,1,0],2/4 角不透明,FAIL**(整幅 90.6% 不透明) |

即:**「道具×PE启用?=true(官方英文 pe_t2i)×FunAcc 档0」组合为首次实弹门测,透明底未兑现**;先例合格的两种组合(中文 PE×cfg4 / PE 关×FunAcc)均已不在现行工作流保存态上。现行负向链(型负面+锁层负面)亦无透明底指令(§1③′ 标注;1004 时代中文 PE 负向有「保持透明底」句,且该拍合格)。

**判读与边界(如实)**:
- 这是**产品线在保存态默认组合下的透明交付能力问题**,非本役驱动/取证缺陷——恰为九型实弹战役要抓的型级风险(4-9 型中多视图/高清人脸/表情差分三型同 rgba_default=true 且同走 PE开保存态,风险同类)。
- 本役受任务书「恰两处改动」约束,无合规通道在本拍内验证缓解组合(PE启用?=false 为第三处改动=越权;裁定① seed 破缓存通道仅授权于全缓存回声场景,本拍非回声,不适用,且换 seed 属门值重掷非根因修复)。
- 产物图按机器判据(存在/>0字节/PNG 可解析/三层收据)全数在档合格,**仅透明门红**;产物图与全部收据保留现场,未做任何补救性重投。

## 8. 机器判据(后核 `verify/type-3-道具.postcheck.json`,exit=1,18/19)

| 判 | 项 | 实测 |
|---|---|---|
| ✅ | history 收据文件可解析(键=prompt/outputs/status) | pid=fc46aba4-3c78-493b-8bf5-b82e8def7c7a |
| ✅ | history status=success | success |
| ✅ | 非全缓存回声(真渲染;owner 裁定③禁回声记账) | cached=1/30(29 节点新鲜) |
| ✅ | seed 回读=[7:7014] | {"value": 0} |
| ✅ | [7:7013]=T8QwenImage21FunAccPDD4Step(档0 支路,4步/cfg 内置) |  |
| ✅ | history outputs 含 [8]直出+[504]2K | 8,504 |
| ✅ | 产物图存在且>0字节([8] type-3-道具.direct.png) | 7013317B |
| ✅ | PNG 魔数([8]) |  |
| ✅ | PNG 可解析(PIL,[8]) | {"mode": "RGBA", "size": [2560, 1712], "metaLen": 12113, "metaMd5": "6b14dc528da9e6b500bac6e67e17b56c", "cornerAlpha": [255, 255, 1, 0]} |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12113 |
| ✅ | 产物图存在且>0字节([504] type-3-道具.2k.png) | 9851067B |
| ✅ | PNG 魔数([504]) |  |
| ✅ | PNG 可解析(PIL,[504]) | {"mode": "RGBA", "size": [3062, 2048], "metaLen": 12113, "metaMd5": "6b14dc528da9e6b500bac6e67e17b56c", "cornerAlpha": [255, 255, 0, 0]} |
| **❌** | **透明门:四角 alpha<=8(FACTS rgba_default 型)** | **[255, 255, 0, 0]——上两角=255 不透明**(任务书口径「四角 alpha=0」同判 FAIL;根因见 §7) |
| ✅ | PNG 元数据 tEXt prompt=history prompt(稳态同,剥 is_changed 指纹;剥离项=['6:4010']) | metaLen=12113 |
| ✅ | [401] 正负双预览终稿在(pos>1000 且 neg>0) | posLen=4711 negLen=200 |
| ✅ | 最终正向含锁层A 逐字(739 字真值) | lockA=739字 pos含=True |
| ✅ | image-prompts 日志段:该 pid 入队行在 | image-prompts-20261006.log:22 |
| ✅ | 日志段三行俱在(入队+摘要+全量JSON) | image-prompts-20261006.log:22 起 3 行 |

## 9. 勘误与标注(工具链,不影响判据)

- **驱动器原始终判红=1/2 型 §8 同款收割 bug 假红(两项)**:「PNG 元数据=history prompt」不剥节点级 `is_changed` 指纹(pngMd5=65f4fb14…≠histMd5=cb649a12…)→后核剥指纹后稳态同✅(唯一差异域=6:4010,与 1/2 型同);其「★ 终判」为该项级联。驱动器真实 exit=1(DRIVER_EXIT=1,以重定向+追加方式捕获,无 2 型 tee 退出码歧义);本型**权威终判=后核 exit=1**——驱动器假红两项不计红,透明门一项计红(§7)。
- **R.prompts.peRewrite 只含装配首行**(driver:335 取 finalPos.split("\n")[0]):本拍 PE 扩写为 6 段多行体(3622 字含头句),§1② 改用「BASE 226 字逐字对拍真源」从装配终稿定界切出完整段引用并记 md5 2d065e6e…(方法与 2 型 §8② 同)。
- **[6:4020] PE思考预览不随 history outputs 回放**(outputs 键=[8,401,504,505];thinkLen=0):与 1/2 型拍现象一致,系本代工作流该件 UI 输出回收行为;PE 改写输出溯源=装配行0-10 逐字(§1②)。
- **[4019] 为本拍唯一缓存件**(PE TE 加载器;1/30 cached)——其缓存属模型加载器级缓存,不影响 6:4013 改写本体的新鲜性(改写输入=本拍新主体句,输出经探针确定性交叉验证=§3 wh_ratio 同参同输出"3:2")。
- **wh_ratio 探针拍 97878877 为本型记录内独立取证件**(非产线拍;仅 CLIPLoader+PE改写+showAnything 三节点,零写盘零产线节点,与 2 型 §8⑤ 同款);不改本型产物收据链(收据均属产线拍 fc46aba4)。
- **分辨率机制链含一处推断标注**:/16 网格截 8(2568→2560)未逐行核源,与 2 型 §8④ 同款口径;其余环节(PE建议路在拍/wh_ratio=3:2 探针实测/4.2MP 公式逐字/回退臂值互证)全为实测或代码引证。
- **后核计数勘正(2026-10-06 12:1x 复核收账)**:本记录首行结果括号/§8 标题/§10 后核行原写「17/18」系计数笔误——经对 `verify/type-3-道具.postcheck.json` 实数复核:checks=19 项、绿 18、红 1(唯一红=透明门「四角 alpha<=8(FACTS rgba_default 型)」;ok=False/exit=1 与「透明门红」判定属实),正确计数=**18/19**;三处已就地勘正(ok 型 1/2/4 记录的 18/18 与其 JSON 实数相符,不受影响)。

## 10. 三层收据存档

| 层 | 存档 | 说明 |
|---|---|---|
| ① image-prompts 日志段 | `logs/type-3-道具.image-prompts.excerpt.log` | 源 image-prompts-20261006.log 行 22-24(入队+摘要+全量JSON) |
| ② PNG 元数据 | `verify/type-3-道具.png-prompt-metadata.json` | tEXt prompt(12,113B,30 节点,剥 is_changed 后与 history 稳态同;metaMd5=6b14dc528da9e6b500bac6e67e17b56c) |
| ③ history prompt JSON | `runs/type-3-道具.history.json` | 全量 entry(prompt 五元组+outputs+status) |
| 驱动 raw | `runs/type-3-道具.json` | 断言 12 项/读回前后/改动两笔/时间账(终判红=§9①假红×2,权威判据见 §8) |
| 驱动控制台 | `logs/type-3-道具.driver.console.log` | 全程日志(DRIVER_EXIT=1 自证) |
| 后核 | `verify/type-3-道具.postcheck.json` | 机器判据权威判(18/19,**透明门红**) |
| 产物图 | `images/type-3-道具.direct.png` / `images/type-3-道具.2k.png` | §4(四角 alpha=255,255,1,0 / 255,255,0,0——透明门红的原始证据) |
| 主体句 canon | `/tmp/type3-subject-canon.txt`(临时)+ 本记录 §1① 全文引 | 135 字 md5 122d7b2f… |
| PE 扩写全文 | 本记录 §1② 全文引(+ /tmp/type3-pe-full.txt 临时件,md5 2d065e6e…) | 3622 字含头句(6 段) |
| wh_ratio 探针 | /tmp/type3-whprobe.json(临时;pid=97878877…) | "3:2"(§3 分辨率机制链取证件) |
