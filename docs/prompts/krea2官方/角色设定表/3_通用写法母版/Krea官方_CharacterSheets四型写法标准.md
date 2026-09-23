# Krea 官方《Krea 2 Character Sheets: Turnarounds, Expressions & More》写法标准

- 真源:https://www.krea.ai/blog/character-design-with-krea-2 (Krea Team,2026-05-23 发布,2026-09 更新)
- 抓取核账:2026-09-22(全文实抓)
- 路由坑:旧路由 `/blog-posts/character-design-with-krea-2` 已 404——博客迁 Astro 后老链接死,新路由为 `/blog/<slug>`;搜索引擎快照只回域名根,须从 `/blog` 列表页定位 slug
- 定位:**Krea 2 官方唯一的角色设定表提示词标准**,四型(turnaround/expression/costume/portrait)各给一个提示词模式;本文档逐条摘录原文并给出与道劫三视图的对照

---

## 一、Turnaround(转面/三视图)官方写法

官方定义:同一角色多角度——**通常 front, three-quarter, side, back 四视角**——比例一致、干净背景。

官方提示词模式(原文逐字):

> prompt for the specific views — "shown from four angles — front view, three-quarter view, side view, and back view."

配套规则(原文要点):

- **Lock the character description tightly (hair, eyes, outfit, accessories)** —— 把角色描述锁死(发型/眼睛/服装/配饰),让每格是同一个人;一致性靠"描述锁死"达成,官方**不写**"keep consistent"类指令
- **Use a clean white background** —— 纯白背景
- 跨格像素级一致:**t2i 做不到**。官方 FAQ 原文:"They will be visually consistent — same outfit, same hair color, same proportions — but not pixel-perfect. For pixel-perfect multi-view work, generate the front view first, then use it as an image reference for the other views."(视觉一致✓像素级✗;要像素级=先出正面再当参考图喂)
- 身份永久锁定=训 LoRA("Train a LoRA once the design is locked")
- 画幅:**16:9 wide for lineup sheets, turnarounds, and costume variations**(表情格用方图,单肖像用 3:4/4:5)

## 二、Expression(表情格)官方写法

> Prompt for a specific grid layout — "a 4x2 grid" or "a row of six expressions." Name the expressions you want: "neutral, smiling, laughing, surprised, angry, embarrassed, determined, tearful." Keep the character description short and tight so it does not drift across the grid.

要点:格局一次声明("a 4x2 grid" 这种计数写在**格局位**是合法的)+ 逐个点名情绪 + 角色描述**短而紧**(比 turnaround 更短,防漂移)。官方只点名情绪名;道劫裁定13(情绪名必须配五官物理描述)是本地 K2 服从度增强,与官方方向兼容、更严,保留。

## 三、Costume variations(换装)官方写法

> "the same original character shown in five outfits — school uniform, casual streetwear, formal kimono, sci-fi pilot suit, summer beach outfit."

要点:角色描述恒定,服装是每格唯一变量;"the same original character" 是官方 sanctioned 的一致性点名写法(道劫「同一位…」同款)。Krea 2 holds the face and hair stable while changing only the clothes。

## 四、Key portrait(关键肖像/美宣)官方写法

> prompt for the framing explicitly — "three-quarter portrait," "close-up," "key visual," "dramatic lighting." Name the lighting direction (front, side, three-quarter, backlit). Use a neutral background ("neutral gray," "soft gradient")

要点:景别词显式 + 光位命名。**Key visual(美宣)允许丰富环境**——官方 workflow tips 原文:"Save the rich environments for key visuals and panel work."(白底是设定板的事,美宣就该有环境)

## 五、通用纪律(官方 workflow tips 全录)

1. 先剪影后上色(同阵容白底剪影版,剪影不分=上色后读不开)
2. **调色板早锁:每角色 3-5 个颜色词,每张 sheet 复用**——"Drift in palette is the biggest cause of inconsistency"
3. 设定板一律白/中性底
4. 设计定稿即训 LoRA(约 20 分钟,此后按需出该角色)
5. 三类 sheet 用同一提示词种子配对——角色描述跨 sheet 类型逐字一致,参考才对得上

## 六、非人角色(生物/机甲)

命名物种("fox-like," "wolf-like," "draconic")+ 具体项:肢体数/纹样/眼色/皮毛质感/体型/表情特征;强剪影+清晰识别特征。

---

## 七、对照道劫三视图现行提示词(2026-09-22 审计)

| 维度 | 官方标准 | 道劫现行 | 判定 |
|---|---|---|---|
| 视图枚举 | 一次、描述性("shown from four angles — …") | 主体句一次 + **底座又一次**(127 字六格枚举重复) | ✗ 双写待除(底座归纯风格) |
| 视角数 | 默认 4(front/¾/side/back) | 6(特写+正+侧+背+¾背+¾斜) | 六格含特写=游戏业惯例(ddokkang2 同款),合法;但视角越多漂移风险越大,官方默认 4 |
| 计数断言 | 无("恰N格/无第N+1格"零出现) | "恰六格…无第七格" | ✗ 违反官方语法,亦违反本地实证(计数指令不认) |
| 否定式 | 零否定 | "非侧背""非海报""无任何场景元素""无重复形态、无无关个体" | ✗ 官方全文零否定;本地实证否定式放大反效果 |
| 跨格对齐 | 不写;官方明说 t2i 只保视觉一致不保像素级,像素级走"正面图当参考图"或 LoRA | "头顶至脚底跨格对齐,头身肩宽一致" | ✗ 向 t2i 索要官方明说给不了的东西 |
| 一致性点名 | "the same original character"(服装型里 sanctioned) | "同一位…跨格完全一致" | ✓ 写法同款 |
| 白底 | clean white background | 纯白无色背景 | ✓(但"无任何场景元素"是否定式,改陈述式"纯白背景"即可) |
| 角色锁定 | hair/eyes/outfit/accessories 四件锁死 | 服装+配刀有,发型/瞳色视主体句而定 | △ 按 [50] 主体句纪律补齐 |
| 画幅 | 16:9 横幅 | 3072×1024(3:1) | 道劫为行业标准裁定(每全身≥1024px,21Draw/A4 口径),六格 3:1 比 16:9 更合理,维持 |
| 姿态统一 | (未提,靠描述锁) | "自然站姿、双臂拢袖自然下垂,腰侧佩刀不持握" | ✓ 陈述式,加分 |

**结论:道劫三视图的结构骨架(六格枚举一次+同一位点名+白底+姿态锚)与官方同构;病灶集中在三处——底座重复枚举、计数/否定断言、跨格对齐这类 t2i 给不了的指令。**

## 八、编辑路线佐证(同一抓取批次)

- HF `tarn59/character_turnaround_sheet_qwen_image_edit_2509_dataset`(33 例,Qwen-Image-Edit 2509 训练集):caption 就是极简标签 "Character turnaround sheet"——**编辑模型的提示词极简**,一致性由参考图承载,与 t2i 的"描述锁死"是两套逻辑;印证本地两条路线分工(t2i=描述锁死,QuadView/编辑=参考图承载)
- 游戏业面板惯例(ddokkang2/build-character-sheet-prompt):front panel 不含脸、脸单独特写面板——道劫六格"第一格上半身特写"同款
