---
name: art_scene_derivative
description: 3D方块世界 · 场景衍生生成
metaData: art_skills
---

# 场景衍生生成 · 3D方块世界

## 一、基础原则

- 保持原场景地标、空间结构、材质年代感和风格边界。
- 只改变时段、天候、景别、镜头角度或局部氛围。

## 二、提示词模板

以场景基础图为底图，保持原场景空间结构和识别地标不变，
3D方块世界，voxel block world 3D art，{时段/天候/景别变化}，{氛围强化}，
bright daylight, crisp shadow, cheerful atmosphere，voxel cubes, pixel-like material, clean toy blocks，grass green, clear blue, flower red，
前中后景层次保留，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (voxel block world 3D art:1.3), (cubic character, blocky trees, grid-based village, isometric readability:1.18), (bright daylight, crisp shadow, cheerful atmosphere:1.1), voxel cubes, pixel-like material, clean toy blocks, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (voxel block world 3D art:1.3), (cubic character, blocky trees, grid-based village, isometric readability:1.18), (bright daylight, crisp shadow, cheerful atmosphere:1.1), voxel cubes, pixel-like material, clean toy blocks, sharp focus, detailed background, polished composition
场景衍生提示词必须保持原场景地标、空间结构、材质年代感不变，只改变时段、天候、景别或镜头角度。

### 反向规避提示词

(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, round organic forms, smooth realistic texture, blur, changed location, lost landmark, added people, random architecture, inconsistent perspective, flat lighting, overclean material, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原场景身份必须可识别 |
| 必守 | 衍生变化必须围绕时段、天气、镜头和氛围展开 |
| 严禁 | 换场景、换世界观、加入无关人物 |
| 严禁 | round organic forms, smooth realistic texture, blur |
