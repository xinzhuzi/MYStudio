---
name: art_scene_derivative
description: 粘土定格动画 · 场景衍生生成
metaData: art_skills
---

# 场景衍生生成 · 粘土定格动画

## 一、基础原则

- 保持原场景地标、空间结构、材质年代感和风格边界。
- 只改变时段、天候、景别、镜头角度或局部氛围。

## 二、提示词模板

以场景基础图为底图，保持原场景空间结构和识别地标不变，
粘土定格动画，clay stop-motion animation，{时段/天候/景别变化}，{氛围强化}，
warm softbox light, tabletop shadow, gentle depth of field，visible fingerprints, soft clay dents, handmade imperfection，clay orange, mint, cream，
前中后景层次保留，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (clay stop-motion animation:1.3), (plasticine character, handmade miniature set, rounded clay expression:1.18), (warm softbox light, tabletop shadow, gentle depth of field:1.1), visible fingerprints, soft clay dents, handmade imperfection, macro photography, tactile detail, frame-by-frame charm, high detail，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (clay stop-motion animation:1.3), (plasticine character, handmade miniature set, rounded clay expression:1.18), (warm softbox light, tabletop shadow, gentle depth of field:1.1), visible fingerprints, soft clay dents, handmade imperfection, macro photography, tactile detail, frame-by-frame charm, high detail
场景衍生提示词必须保持原场景地标、空间结构、材质年代感不变，只改变时段、天候、景别或镜头角度。

### 反向规避提示词

(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text, glossy plastic, smooth CGI, realistic human skin, changed location, lost landmark, added people, random architecture, inconsistent perspective, flat lighting, overclean material, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原场景身份必须可识别 |
| 必守 | 衍生变化必须围绕时段、天气、镜头和氛围展开 |
| 严禁 | 换场景、换世界观、加入无关人物 |
| 严禁 | glossy plastic, smooth CGI, realistic human skin |
