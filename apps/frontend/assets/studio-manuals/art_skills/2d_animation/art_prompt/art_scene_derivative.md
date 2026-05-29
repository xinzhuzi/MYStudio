---
name: art_scene_derivative
description: 2D动画 · 场景衍生生成
metaData: art_skills
---

# 场景衍生生成 · 2D动画

## 一、基础原则

- 保持原场景地标、空间结构、材质年代感和风格边界。
- 只改变时段、天候、景别、镜头角度或局部氛围。

## 二、提示词模板

以场景基础图为底图，保持原场景空间结构和识别地标不变，
2D动画，clean 2D anime animation style，{时段/天候/景别变化}，{氛围强化}，
soft animation lighting, clear cel shadow, readable composition，smooth digital paint, crisp outline, controlled detail density，sky blue, warm skin tone, vivid accent，
前中后景层次保留，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (clean 2D anime animation style:1.3), (clean lineart, flat color, expressive eyes, balanced character design:1.18), (soft animation lighting, clear cel shadow, readable composition:1.1), smooth digital paint, crisp outline, controlled detail density, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (clean 2D anime animation style:1.3), (clean lineart, flat color, expressive eyes, balanced character design:1.18), (soft animation lighting, clear cel shadow, readable composition:1.1), smooth digital paint, crisp outline, controlled detail density, clean composition, readable silhouette, high detail, finished illustration
场景衍生提示词必须保持原场景地标、空间结构、材质年代感不变，只改变时段、天候、景别或镜头角度。

### 反向规避提示词

(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, 3D render, photorealistic, messy sketch, changed location, lost landmark, added people, random architecture, inconsistent perspective, flat lighting, overclean material, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原场景身份必须可识别 |
| 必守 | 衍生变化必须围绕时段、天气、镜头和氛围展开 |
| 严禁 | 换场景、换世界观、加入无关人物 |
| 严禁 | 3D render, photorealistic, messy sketch |
