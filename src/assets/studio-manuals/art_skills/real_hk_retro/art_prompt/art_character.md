---
name: art_character
description: 真人复古港片 · 角色基础形象生成
metaData: art_skills
---

# 人物基础形象生成 · 真人复古港片

## 一、基础原则

- 生成 真人人物参考摄影，用于角色首次定型。
- 必须保持“1990s Hong Kong-inspired live-action cinema”和“真人摄影”媒介边界。
- 人物需具备清晰身份、年龄、性别、五官、体态、发型、基础服装和气质标签。

## 二、提示词模板

{性别}角色四视图设定图，真人复古港片，1990s Hong Kong-inspired live-action cinema，rainy street, neon shop light, moody actor gaze, urban night，
character design sheet, character turnaround,
{五官特征}，{整体气质}，{年龄段}，{身份职业}，
{身高描述}，{头身比}，{体型描述}，{体态描述}，
{发色发型}，{基础服装}，{服装材质与色彩}，
同一画面左至右并排：人像特写+正视图+侧视图+后视图，
人像特写从头顶到锁骨完整展示，全身立像从头顶到脚底完整展示，
neon side light, motion blur, high contrast practical lighting，film grain, wet pavement reflection, vintage lens softness，red neon, green tint, deep shadow，
(best quality, masterpiece, high detailed:1.2), (1990s Hong Kong-inspired live-action cinema:1.3), (rainy street, neon shop light, moody actor gaze, urban night:1.18), (neon side light, motion blur, high contrast practical lighting:1.1), film grain, wet pavement reflection, vintage lens softness, real lens optics, natural skin texture, cinematic framing, high detail，
图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (1990s Hong Kong-inspired live-action cinema:1.3), (rainy street, neon shop light, moody actor gaze, urban night:1.18), (neon side light, motion blur, high contrast practical lighting:1.1), film grain, wet pavement reflection, vintage lens softness, real lens optics, natural skin texture, cinematic framing, high detail
角色类提示词必须保留身份、年龄、性别、五官、身高、头身比、体态、服装、发型和四视图一致性。

### 反向规避提示词

(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, sterile modern digital look, anime, 3D render, clean daylight, bad anatomy, deformed face, asymmetrical eyes, extra limbs, missing limbs, fused fingers, cropped head, cropped feet, inconsistent identity, inconsistent clothing.

## 四、必守 / 严禁

| 类型 | 规则 |
|---|---|
| 必守 | 四视图同一人物，面容/体型/发型/服装/光影完全一致 |
| 必守 | 全身从头到脚完整入画，特写从头顶到锁骨完整入画 |
| 严禁 | 直接套用具体作品角色造型或版权角色名称 |
| 严禁 | sterile modern digital look, anime, 3D render, clean daylight |
