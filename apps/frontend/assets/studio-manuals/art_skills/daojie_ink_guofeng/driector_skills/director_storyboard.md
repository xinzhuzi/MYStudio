---
name: director_storyboard
description: 导演分镜提示词技法 · 水墨国风修仙
metaData: director_skills
---

# 分镜提示词 · 水墨国风修仙 · 风格专属技法

---

## 适用范围

本 Skill 专用于**水墨国风修仙**风格的分镜提示词生成。

---

## 情绪 → 面容/眼神词映射

| 情绪输入 | 面容词 | 眼神词 | 微表情补充 |
|----------|--------|--------|-----------|
| 温柔 / 深情 | 神情温柔，眉目含情 | 眼神专注柔和，目光温暖 | 嘴角微扬，表情治愈 |
| 坚定 / 道心 | 神情坚毅，目光清亮 | 眼神坚定，目光如炬 | 下巴微抬，表情果敢 |
| 羞涩 / 腼腆 | 脸颊泛红，眼神躲闪 | 眼神羞涩，目光低垂 | 嘴角轻抿，表情可爱 |
| 凌厉 / 杀意 | 神情冷峻，目光如剑 | 眼神锐利，杀意凛然 | 下颌收紧，表情威严 |
| 悟道 / 顿悟 | 表情空灵，眼神深邃 | 眼神明亮，目光悠远 | 嘴角微扬，表情超然 |
| 忧伤 / 道侣离别 | 神情哀婉，眼神黯淡 | 眼神含泪，目光低垂 | 嘴角下沉，表情哀伤 |
| 惊讶 / 突破 | 眼睛微睁，表情震动 | 眼神明亮，目光聚焦 | 嘴巴微张，表情意外 |
| 入定 / 冥想 | 神情淡淡，目光内敛 | 眼神半阖，目光内收 | 表情平静，气质出尘 |
| 疲惫 / 力竭 | 眼神朦胧，表情柔和 | 目光略显疲惫，眼神涣散 | 微微喘息，表情倦怠 |
| 期待 / 渡劫前 | 眼神发光，表情肃然 | 眼神期待，目光坚定 | 嘴角紧抿，表情庄重 |

---

## 光影氛围词库（水墨国风修仙）

### 时间段光线

| 时间段 | 主光词 | 色调词 | 气氛词 |
|--------|--------|--------|--------|
| 清晨 | 柔和晨光，散射侧光 | 宣纸白 + 青绿 | 灵雾弥漫，空气清新 |
| 正午 | 明亮阳光，直射散光 | 青绿 + 旧金微光 | 光影清晰，灵气充盈 |
| 傍晚/黄昏 | 逆光剪影，暖色渐变 | 赭石 + 靛蓝渐变 | 夕阳余晖，轮廓光 |
| 夜间 | 冷色背景 + 灵火点缀 | 靛蓝主调 + 暖黄灵光 | 宁静清冷，灵灯柔和 |
| 灵雨天 | 漫射冷光，无主光源 | 青绿 + 宣纸白 | 空气湿润，灵气弥漫 |

### 情绪光影

| 情绪基调 | 光线类型 | 补充约束 |
|----------|----------|----------|
| 修炼悟道 | 散光漫射，灵气微光 | 青绿色调，景深虚化，水墨晕染 |
| 宗门盛典 | 暖光照明，灵光高光 | 朱红色调，旧金高光，层次分明 |
| 日常修行 | 局部散光，柔和阴影 | 宣纸白色调，近景特写，清新氛围 |
| 斗法肃杀 | 冷调阴影，硬光对比 | 靛蓝 + 浓墨，低饱和度，紧张氛围 |
| 月下悟道 | 月华照明，冷暖对比 | 靛蓝背景，灵光点缀，清冷意境 |

---

## 场景质感约束词（按场景类型）

| 场景类型 | 必加约束词 |
|----------|-----------|
| 修炼场景 | 灵雾缭绕、灵山仙境、灵气可视、青绿山水、水墨晕染 |
| 宗门场景 | 灵石宫墙、飞檐斗拱、阵纹铺地、灵灯高悬、工笔线描 |
| 洞府室内 | 灵石壁面、灵火通明、蒲团静室、灵纱帷幔、宣纸质感 |
| 斗法场景 | 碎石裂地/劫云压顶/灵气激荡、冷色调、泼墨写意、飞白笔触 |
| 大典庆典 | 灵灯/灵旗/祥云、朱红旧金、氛围庄严、工笔重彩 |
| 冥界幽境 | 黄泉/忘川/幽冥之火、冷色浓墨、阴森压抑、水墨渲染 |

---

## 固定风格锚定词（所有输出必须包含）

**水墨国风锚定（必选）：**

水墨国风，修仙古韵，工笔线描，写意晕染，宣纸质感

**人物质感（含人物镜头时必选）：**

水墨国风造型，工笔白描清晰，服饰细节精致，水墨光影层次丰富

**场景质感（含场景镜头时必选）：**

水墨国风场景，传统建筑细节丰富，水墨渲染技术，光影质感细腻

**一致性锚定（参考图模式必选）：**

保持人物造型与参考图一致，保持场景风格与参考图一致，保持光影色彩基调统一

**Toonflow 式参考图绑定（分镜参考图模式必选）：**

每条分镜提示词必须先声明 `@图1 为{资产名称}{资产类型}`、`@图2 为...`，并在 `【画面】` 正文中用对应的 `@图N` 直接替代角色、场景、道具名称；禁止正文继续写原始角色名、场景名或道具名来替代参考图绑定。参考图只锁定身份、服饰、场景结构、道具轮廓和核心颜色，镜头、动作、表情、局部光影可随当前分镜变化。不得再追加英文 `Based on the reference image...` 段落，避免与 `@图N` 绑定机制重复冲突。

**风格收尾（固定）：**

水墨国风电影质感，修仙古韵，传统水墨技法，工笔写意融合

**画质锁定词（所有输出必须包含，置于风格收尾之后）：**

模式A（中文）——默认（画面无画内文字需求时）：
水墨国风高清渲染，高细节，工笔线描，写意晕染感，电影质感，画面无字幕、无水印、无标题叠字

模式A（中文）——画内文字场景（画面描述中含牌匾/对联/玉简等道具文字时）：
水墨国风高清渲染，高细节，工笔线描，写意晕染感，电影质感，画面无字幕、无水印、无标题叠字，牌匾/对联等场景道具上的文字清晰可辨

模式B（英文）——默认：
Chinese ink-wash xianxia, gongbi line drawing, xieyi splash ink, xuan paper texture, cinematic quality, high detail, no subtitles, no captions, no watermark, no title overlay

模式B（英文）——画内文字场景：
Chinese ink-wash xianxia, gongbi line drawing, xieyi splash ink, xuan paper texture, cinematic quality, high detail, no subtitles, no captions, no watermark, no title overlay, legible text on in-scene props such as plaques and couplets

**负向词模板（模式B 必须包含，置于提示词末尾）：**

> ⚠️ Seedream（模式A）**不支持负向提示词**，负向词仅适用于模式B。模式A 通过正向词中的质感锚定和画质锁定来保证画面质量。

模式B（英文）：
no photorealistic, no realistic photography, no 3D render, no cel shading, no anime style, no low-poly, no rough modeling, no plastic texture, no harsh lines, no western fantasy, no cyberpunk, no sci-fi, no modern elements, no cartoon style, no subtitles, no captions, no watermark, no title overlay, no UI text

---

## 美学禁止项（生成时严格规避）

以下词汇/风格不得出现于输出提示词中：

- ❌ 写实摄影/3D写实渲染/照片级真实感词
- ❌ 赛璐璐平涂/日式动画渲染/anime style
- ❌ 高饱和动漫色/荧光色/霓虹色
- ❌ 西方奇幻/赛博朋克/过度现代元素
- ❌ 粗劣线条/模糊画质/低精度建模
- ❌ 扁平设计/无水墨纵深感
- ❌ 色彩混乱/光影错误/透视错误
- ❌ 现代建筑/现代服饰元素

> 💡 **例外**：某些现代渲染技术（如体积光、景深虚化）可以合理使用，但应保持水墨国风美学基调。

---

## 完整生成示例

> 以下为同一输入分别使用模式A和模式B的对照展示，实际使用时**仅输出其中一种**。

### 输入（分镜表行数据）

| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 情绪 | 光影氛围 |
|------|---------|------|-------------|------|------|------|---------|------|----------|
| 1 | 修仙少女站在灵山崖边，手持灵剑，眼神坚定 | 灵山 | 修仙少女 | 6s | 中景 | 缓推 | 持剑而立，眼神坚定 | 坚定 / 道心 | 散光清透 |

### 示例输出A（模式A · Seedream）

[Prompt]
@图1 为修仙少女角色；@图2 为灵山场景
【画面】@图2崖边，中景构图，@图1手持灵剑凌风而立，神情坚毅，眼神如炬，衣袖和发带顺风后扬，主体轮廓清楚。
【光影】散光清透，青绿山水背景，灵雾缭绕，旧金微光点缀，人物脸和手保留柔和侧光。
【风格】水墨国风，修仙古韵，工笔线描，写意晕染，宣纸质感，水墨国风电影质感，传统水墨技法，工笔写意融合，水墨国风高清渲染，高细节，画面无字幕、无水印、无标题叠字。保持 @图1 面部特征、发型、服饰与参考图一致，保持 @图2 场景结构与光影基调一致。

### 示例输出B（模式B · Nanobanana）

```xml
<role>
You are an ink-wash xianxia storyboard artist.
Maintain strict visual continuity across all shots.
</role>
<character_reference>
Image [1]: 修仙少女 — 水墨国风造型，仙道服饰，工笔线描美学
</character_reference>
<continuity_rules>
- Same outfit, hairstyle, face features across ALL shots
- Same ink-wash style, gongbi line drawing rendering
- Same scene lighting, Chinese ink-wash aesthetic
- Do NOT introduce cel shading, anime style or western fantasy elements
</continuity_rules>
<shot>
Medium shot, xianxia girl in elegant dao robe standing at spirit mountain cliff edge, holding spirit sword, determined expression, resolute gaze, cinematic lighting, volumetric fog, depth of field blur, gongbi line drawing with xieyi splash ink, Chinese ink-wash xianxia, traditional brushwork, xuan paper texture, high detail, no subtitles, no captions, no watermark, no title overlay.
</shot>
<negative>
no photorealistic, no realistic photography, no 3D render, no cel shading, no anime style, no low-poly, no rough modeling, no plastic texture, no harsh lines, no western fantasy, no cyberpunk, no sci-fi, no modern elements, no cartoon style, no subtitles, no captions, no watermark, no title overlay, no UI text
</negative>
```

## 快速参考卡

### 情绪 → 画面词速查

| 情绪 | 面容关键词 | 光线匹配 |
|------|-----------|---------|
| 温柔 | 神情温柔，眼神专注 | 散光漫射 + 暖光 |
| 坚定 | 神情坚毅，目光如炬 | 暖光侧射 + 清晰轮廓 |
| 羞涩 | 脸颊泛红，眼神躲闪 | 暖光侧射 + 腮红 |
| 凌厉 | 神情冷峻，目光如剑 | 冷调阴影 + 硬光 |
| 悟道 | 表情空灵，眼神深邃 | 灵光漫射 + 体积光 |
| 忧伤 | 神情哀婉，眼神黯淡 | 冷调阴影 + 低对比 |
| 疲惫 | 眼神朦胧，表情柔和 | 柔和光线 + 低对比 |
| 入定 | 神情淡淡，目光内敛 | 体积光 + 灵雾 |
| 期待 | 眼神发光，表情肃然 | 暖光侧射 + 高亮 |
