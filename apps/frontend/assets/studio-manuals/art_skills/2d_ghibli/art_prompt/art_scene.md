---
name: art_scene
description: 2D自然手绘动画 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 2D自然手绘动画

## 一、基础原则

- 生成 2D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

2D自然手绘动画场景主视图概念图，hand-painted nature 2D animation，gentle character, lush countryside, peaceful daily life, charming background，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
moss green, cream white, soft sky blue，soft daylight, diffused cloud light, calm atmosphere，watercolor-like background, warm hand-drawn line, organic texture，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (hand-painted nature 2D animation:1.3), (gentle character, lush countryside, peaceful daily life, charming background:1.18), (soft daylight, diffused cloud light, calm atmosphere:1.1), watercolor-like background, warm hand-drawn line, organic texture, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (hand-painted nature 2D animation:1.3), (gentle character, lush countryside, peaceful daily life, charming background:1.18), (soft daylight, diffused cloud light, calm atmosphere:1.1), watercolor-like background, warm hand-drawn line, organic texture, clean composition, readable silhouette, high detail, finished illustration
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, sharp digital neon, 3D CGI, horror darkness, no depth, flat lighting, empty white background, people, human silhouette, cropped architecture, inconsistent season, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“2D自然手绘动画”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | sharp digital neon, 3D CGI, horror darkness |
