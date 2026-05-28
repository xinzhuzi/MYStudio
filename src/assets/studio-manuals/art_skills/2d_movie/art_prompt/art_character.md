---
name: art_character
description: 2D电影 · 角色基础形象生成
metaData: art_skills
---

# 人物基础形象生成 · 2D电影

## 一、基础原则

- 生成 2D 角色设定图，用于角色首次定型。
- 必须保持“high budget 2D animated movie still”和“2D 动画 / 插画”媒介边界。
- 人物需具备清晰身份、年龄、性别、五官、体态、发型、基础服装和气质标签。

## 二、提示词模板

{性别}角色四视图设定图，2D电影，high budget 2D animated movie still，detailed background, emotional sky, cinematic character framing, atmospheric depth，
character design sheet, character turnaround,
{五官特征}，{整体气质}，{年龄段}，{身份职业}，
{身高描述}，{头身比}，{体型描述}，{体态描述}，
{发色发型}，{基础服装}，{服装材质与色彩}，
同一画面左至右并排：人像特写+正视图+侧视图+后视图，
人像特写从头顶到锁骨完整展示，全身立像从头顶到脚底完整展示，
dramatic sunset light, layered clouds, soft glow，painterly background, clean character line, film-like composition，golden sunset, deep blue, soft cloud white，
(best quality, masterpiece, high detailed:1.2), (high budget 2D animated movie still:1.3), (detailed background, emotional sky, cinematic character framing, atmospheric depth:1.18), (dramatic sunset light, layered clouds, soft glow:1.1), painterly background, clean character line, film-like composition, clean composition, readable silhouette, high detail, finished illustration，
图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (high budget 2D animated movie still:1.3), (detailed background, emotional sky, cinematic character framing, atmospheric depth:1.18), (dramatic sunset light, layered clouds, soft glow:1.1), painterly background, clean character line, film-like composition, clean composition, readable silhouette, high detail, finished illustration
角色类提示词必须保留身份、年龄、性别、五官、身高、头身比、体态、服装、发型和四视图一致性。

### 反向规避提示词

(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, simple flat cartoon, low resolution, dull color, bad anatomy, deformed face, asymmetrical eyes, extra limbs, missing limbs, fused fingers, cropped head, cropped feet, inconsistent identity, inconsistent clothing.

## 四、必守 / 严禁

| 类型 | 规则 |
|---|---|
| 必守 | 四视图同一人物，面容/体型/发型/服装/光影完全一致 |
| 必守 | 全身从头到脚完整入画，特写从头顶到锁骨完整入画 |
| 严禁 | 直接套用具体作品角色造型或版权角色名称 |
| 严禁 | simple flat cartoon, low resolution, dull color |
