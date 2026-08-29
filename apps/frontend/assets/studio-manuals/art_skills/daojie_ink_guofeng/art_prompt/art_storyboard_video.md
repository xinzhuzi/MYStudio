# 视频提示词 · 视觉风格约束

生成视频提示词时，必须注入以下视觉风格标签：

| 模式 | 风格标签 |
|------|----------|
| **通用多参模式（英文）** | `Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, muted yet visible mineral-color palette with soft cyan-green and vermilion accents, smooth pale matte flat-wash ground, clear layered colored ink-wash composition with visible mineral pigments, atmospheric depth` |
| **通用首尾帧模式（英文）** | `Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, muted yet visible mineral-color palette with soft cyan-green and vermilion accents, smooth pale matte flat-wash ground, clear layered colored ink-wash composition with visible mineral pigments, atmospheric depth, crisp gongbi linework throughout` |
| **Seedance 2.0（中文）** | `水墨国风修仙，工笔线描，写意泼墨，青绿淡彩，浅净平涂底，墨色层次丰富，连环画叙事感，前中远景分明构图` |
| **Seedance 1.5（中文）** | `水墨国风，工笔线描，写意晕染，青绿淡彩，浅净平涂底，修仙题材，灵气流转，动态张力` |

## 视频特有约束

| 编号 | 规则 |
|---|---|
| V1 | 动作方向保持一致（左→右前进，右→左对抗） |
| V2 | 灵气效果以水墨晕染+对应颜色淡彩表现，禁止粒子特效 |
| V3 | 剑光以银白线条+墨色残影表现速度感 |
| V4 | 场景转换以墨色晕染过渡，禁止硬切 |
| V5 | 人物动态保持连环画叙事感，动作有起承转合 |
| V6 | 背景与角色层次分明，远景淡墨虚化 |

## 严禁

| 编号 | 严禁内容 |
|---|---|
| X1 | 3D渲染/CG动画质感 |
| X2 | 赛璐璐平涂/日式动漫风 |
| X3 | 高饱和荧光色/霓虹粒子特效 |
| X4 | 现代/科幻/西方奇幻元素 |
| X5 | 无质感的纯色平面背景 |

## 3D 纵深构图（水墨版 · 2.5D 渲染管线必需）

> 分镜帧图会进入「深度估计 → 2.5D 相机运镜」管线（推拉摇移等 35 种运镜）。水墨画同样需要纵深结构 — **构图纵深 ≠ 3D 写实渲染**：本节要求的层次与留白是构图法则，与 X1（严禁 3D 渲染质感）不冲突；深度运镜由渲染管线施加，不改变水墨媒介质感。受 `styleContractVersion=daojie-gongbi-v2` 约束：本节构图条款不得引入电影式布光或景深虚化。通用规则见 `production_skills/depth_friendly_3d.md`。

### 水墨纵深 Token（生成分镜帧提示词时注入）

| 模式 | 水墨纵深标签 |
|------|--------------|
| **通用多参模式（英文）** | `clear layered composition with foreground, midground and background separation, overlapping ink-wash depth layers, distant mountains in pale ink wash, ink-wash atmospheric perspective, foreground framing elements like branches or eaves, deep focus with crisp gongbi linework throughout` |
| **通用首尾帧模式（英文）** | 同上 |
| **Seedance 2.0（中文）** | `前中远景三层分明，近景枝叶或檐角入框，远山淡墨晕染，墨色近浓远淡，全画面笔意清晰` |
| **Seedance 1.5（中文）** | `前中远三层构图，远山淡墨，近浓远淡，画面清晰` |

### 水墨纵深规则

| 编号 | 规则 |
|------|------|
| DV1 | 构图三层分离：近景（枝叶/檐角/山石/人物肩背等入框元素）、中景（主体）、远景（淡墨山水/云雾留白），三层各自可辨 |
| DV2 | 优先安排近景遮挡元素入画框 — 水墨折枝构图天然适配，是视差感的最大放大器 |
| DV3 | 透视引导：山径/石阶/溪流/宫廊延伸至画面深处，用墨色浓淡渐变表现纵深（近浓远淡） |
| DV4 | 大气透视 = 墨分五色的近浓远淡 + 远景留白晕染；**主体工笔线条全程锐利**，禁止全图雾化（遵守通用画质禁用词） |
| DV5 | **景别虚化覆盖**：进入 2.5D 管线的分镜，任何「背景虚化/浅景深/shallow depth of field」描述（含首尾帧风格标签中的 shallow depth of field）一律改写为「远景淡墨、全画面笔意清晰」— 景深由渲染阶段按深度图施加，源图虚化会毁掉深度边缘 |
| DV6 | 主体轮廓以墨线/留白与背景分离明确，避免主体融入背景墨色 |
| DV7 | 禁止：正面平面化构图、无层次的平涂背景、大面积无结构宣纸空白（留白须有形 — 云气/水面/远山轮廓）
---

## 《道劫》成片主风格锁（ma-gongbi-v1 · 全文）

> 与 MA `美术成片风格提示词模板库.md` 词级一致（快照见 ma_sync）。分镜帧/成片画面提示词按下方「成片模板速查」选用一个模板骨架后，主体/地点/动作/剧情替换为当前分镜内容。

```text
《道劫》默认主风格：工笔结构层用细密、稳定、清楚的墨线刻画脸、手、发丝、衣褶、器物轮廓和建筑边缘；写意气韵层用彩色矿物分染、罩染与克制泼墨处理山水、雾、灵气、远景和动作余韵。前中远景与空气透视清楚。按场景使用至多 2-3 个低饱和点缀色：石青、石绿、靛青、玉青、赭石、朱砂、矿物朱、旧金或血红形成连续可见色区。色量由来源事实决定；30%-70% 仅作人工观察与报告，不是生成硬门。指定一个明确自然光、窗光或灵光方向，照亮脸、手、关键道具与路径。画面清雅、细腻、透气、旧而不脏，但不得灰白化、黑白化、低饱和化或单一灰蓝化。默认不要多视图、资料卡、UI板、厚涂油画、照片写实、3D塑料、赛璐璐平涂、文字水印或伪字题跋。
```

## 通用成片负面约束（全文，并入 Negative Prompt 段）

```text
不要现代都市霓虹，不要西幻板甲，不要日式校园制服，不要赛博风主导，不要欧美厚涂奇幻，不要纯黑白滤镜，不要低清模糊，不要塑料感3D渲染，不要廉价网红脸，不要过度磨皮，不要大面积脏污，不要文字水印，不要logo，不要乱码，不要伪字题跋，不要错误肢体，不要多余手指，不要重复人物，不要拼贴感，不要把背景画成空泛山水。画面必须主体明确、线条干净、纸面透气、水墨为主、彩色点缀、古雅、有真实场景和动作。
```

## 成片模板速查（按用途只选 1 个，骨架要点版）

> 每次成片提示词从下表选**一个**模板作骨架，替换主体/地点/动作；不要多模板整段拼接。骨架要点必须保留（媒介/构图/色彩/光影句），成片主风格锁与通用负面全文另行携带。

### 02. 青绿山水长卷人物
适用：山水大场景、游历、宗门远景。要点：人物小比例停立山门/古桥/云台前，山水空间成为叙事；石青石绿玉青靛青赭石朱砂旧金矿物罩染层层退远；前景松枝石阶溪水，远景群山云气；像可展开的中式画卷。画幅 21:9 或 16:9 远景。

### 03. 连环画剧情关键格
适用：章节插图、剧情瞬间、漫剧分镜。要点：表现冲突/发现/转折的一瞬间（回头/伸手/压住伤口/递出卷轴），不是摆拍海报；前景遮挡+中景人物+远景环境三层；背景用具体物件说明地点（破门/石阶/灯盏/残符）；像高质量国风漫画单格。画幅 16:9 或 4:3 中景。

### 07. 国风漫剧电影帧
适用：AI 漫剧、影视感剧情图、章节封面。要点：镜头像影视剧一帧，绘制方式是工笔线描与彩色矿物罩染；前景少量遮挡物制造纵深，中景人物动作，远景地点信息；柔和侧光或窗光照亮脸和手；影视感构图+国风绘本质感。画幅 16:9 中近景。

### 09. 雨夜竹林冷青
适用：追杀、密谈、悬疑氛围。要点：雨线细密但不遮人物；冷青墨绿灰蓝+宣纸暗米为主，朱红只来自血迹/灯笼/符纸；竹叶雨水工笔线描+淡墨晕染，脸手由微弱侧光照出；冷、静、有危险感。画幅 16:9 夜景中近景。

### 13. 冥府冷青官像
适用：幽冥、阴司、冷调权力空间。要点：官袍结构玉牌印绶但不复制现实官服；冷青墨黑灰白暗玉+幽蓝灯火朱砂印；黑水灯笼石案封条背景；肃冷不恐怖。画幅 4:5 或 16:9。

### 21. 水墨战斗瞬间
适用：动作图、技能击中、漫剧高潮。要点：劈斩/掌击/闪身动作方向明确重心真实；水墨飞白与淡彩灵气沿动作轨迹但不遮挡脸手武器轮廓；背景简化场景三层；朱红或金只做击中焦点。画幅 16:9 动态中景。

### 24. 角色半身立绘加叙事背景
适用：角色宣传、人物卡。要点：半身到七分身正在持剑/捧卷/抬眼；人物占画面约 60%，背景说明身份（山门/书斋/雨竹/冥府案台）且降低细节不抢脸手。画幅 4:5。

### 25. 角色全身立绘加地面故事
适用：角色首次亮相、章节封面。要点：全身站姿有情绪和重心（停步回望/刚落地/负伤站稳）；地面脚边有故事物件（残符/落叶/铜钱/碎瓦/剑鞘）；矿物色连续可见大色区。画幅 4:5 或 3:4。

### 26. 双人对话电影帧
适用：谈判、冲突、师徒、对峙。要点：只有角色 A 与 B；明确前后或左右关系，眼神方向和手部动作说明关系张力；背景具体道具（灯/卷轴/门框/雨帘）；工笔线描照亮脸和手。画幅 16:9 双人中景。

### 28. 古籍档案与线索图
适用：调查、卷宗、AI 漫剧转场。要点：卷宗/地图/玉简铺在木案，旁有手/毛笔/印章/灯盏；空白框线条印痕短占位符但不生成大段文字；宣纸米白墨灰旧木褐朱砂暗玉青。画幅 16:9 或 4:3 俯视。

### 30. 宣纸留白孤影
适用：孤独、顿悟、章节情绪图。要点：人物/背影/孤亭位于画面三分之一处；大面积留白表现天空水面雪地雾气，远景淡墨轻压；细节少轮廓准，颜色集中在衣带/灯火/符纸。画幅 16:9 或 21:9。

### 31. 水墨灵气特写
适用：法术、灵气、抽象可叙事画面。要点：手掌/法器/符纸/剑锋与灵气属性互动；灵气用墨迹飞白淡彩光晕细符纹，颜色最多三种；主体清晰占中心，背景简化。画幅 1:1 或 16:9 特写。

## 提示词质量增强

> 生成最终提示词时，必须把本节融合进现有提示词模板；不要另起说明文字。支持 negative prompt 的模型，把“反向规避提示词”单独放入负面提示词；不支持 negative prompt 的模型，改写成正向规避要求。

### 正向质量锚点

水墨国风修仙，Chinese ink wash xianxia，gongbi linework，smooth pale matte flat-wash ground，muted yet visible mineral-color palette with soft cyan-green and vermilion accents，layered ink wash，spiritual aura as ink diffusion，clear layered composition，clean finished image，readable detail。
视频提示词必须补充镜头运动、主体运动、起承转合、淡墨空气透视变化、光影连续性和首尾帧一致性；补充 ink-wash motion, temporal continuity, stable composition, consistent subject identity。

### 反向规避提示词

low quality, 3D render, CGI, photorealistic, cel-shaded anime, neon cyberpunk palette, western fantasy, sci-fi, modern city, plastic texture, messy ink, bad anatomy, watermark, text, signature。
flicker, jitter, morphing face, identity drift, inconsistent costume, warped hands, broken motion, sudden scene jump, overexposed effect, text, watermark, logo。

### 输出净化规则

- 正向提示词只写画面主体、风格、构图、光影、材质、动作和质量锚点；不要把“不要/禁止/严禁”混入正向主体。
- 反向提示词只写低质量、错媒介、错风格、结构错误、身份漂移、文字水印、裁切和画面伪影等排除项。
- 若调用方要求中文输出，保留中文风格术语；若调用方要求英文输出，可翻译锚点，但不得改变本风格的媒介边界。

---

## 分镜帧生图风格锁（代码注入源）

> 以下三个标记块由 `lib/studio/visual-manual-style-tokens.ts` 解析：
> `storyboard-image-style-tokens` — 追加到分镜帧生图提示词末尾的风格 token（每行一个）；
> `storyboard-style-guide` — 注入分镜提示词撰写 LLM 系统提示的风格指南。
> `storyboard-frame-negative` — 分镜帧生图工作流建流时预填进 Negative Prompt 的五类英文负面词(错媒介/错风格光/纸纹脏污/低质量结构/文字水印)。
> 标记块缺失时不注入任何内容（fail-empty）。修改本节即全局生效。

<!-- storyboard-image-style-tokens:start -->
Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, muted yet visible mineral-color palette with soft cyan-green and vermilion accents, smooth pale matte flat-wash ground
工笔线描，写意晕染，浅净平涂底，墨色层次丰富，青绿朱砂赭石淡彩点缀
clear layered colored ink-wash composition with visible mineral pigments, atmospheric depth, crisp gongbi linework throughout, clean finished gongbi quality
<!-- storyboard-image-style-tokens:end -->

<!-- storyboard-frame-negative:start -->
photorealistic photography, 3D render, CGI, cel shading, anime style, western oil painting, western fantasy, cyberpunk, sci-fi, neon cyberpunk palette, three-point Hollywood lighting, heavy cinematic rim light, paper-wrinkle texture, crumpled-sheet folds, wave-like surface ripples, fiber streaks, pulp grain mesh, scanned-paper filter, yellowed aged sheet, full-frame paper texture, AI muddy noise, dirty texture, compression artifacts, oversharpening halos, low quality, blurry, messy ink, broken linework, bad anatomy, extra limbs, weapon passing through body, unstable stance, text, watermark, logo, subtitle, webtoon cover beauty portrait, idol poster, tattered clothing, ragged hems, monochrome, grayscale, black and white, ink-only lineart, washed-out colorless image

8. 画面洁净纪律：做旧止于淡灰晕染——禁止霉斑、污渍团块、泥点飞溅、灰蒙积垢；白衣与浅色区域保持干净底色，墙面至多轻微斑驳；纹理密度宁少勿多，保住工笔线描的清晰与画面通透。
<!-- storyboard-style-guide:end -->
