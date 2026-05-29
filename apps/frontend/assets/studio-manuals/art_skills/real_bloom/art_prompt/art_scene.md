---
name: art_scene
description: 真实光晕 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 真实光晕

## 一、基础原则

- 生成 真人场景摄影，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

真实光晕场景主视图概念图，dreamy backlit live-action photography，real person, glowing rim light, soft focus portrait, airy environment，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
cream, pale gold, soft blue，strong bloom, lens flare, warm backlight, shallow depth of field，film softness, skin texture retained, optical glow，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (dreamy backlit live-action photography:1.3), (real person, glowing rim light, soft focus portrait, airy environment:1.18), (strong bloom, lens flare, warm backlight, shallow depth of field:1.1), film softness, skin texture retained, optical glow, real lens optics, natural skin texture, cinematic framing, high detail，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (dreamy backlit live-action photography:1.3), (real person, glowing rim light, soft focus portrait, airy environment:1.18), (strong bloom, lens flare, warm backlight, shallow depth of field:1.1), film softness, skin texture retained, optical glow, real lens optics, natural skin texture, cinematic framing, high detail
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, harsh contrast, dark gritty mood, anime, 3D render, no depth, flat lighting, empty white background, people, human silhouette, cropped architecture, inconsistent season, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“真实光晕”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | harsh contrast, dark gritty mood, anime, 3D render |
