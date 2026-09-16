---
name: art_scene_derivative
description: 3D块面 · 场景衍生生成
metaData: art_skills
---

# 场景衍生生成 · 3D块面

## 一、基础原则

- 保持原场景地标、空间结构、材质年代感和风格边界。
- 只改变时段、天候、景别、镜头角度或局部氛围。

## 二、提示词模板

以场景基础图为底图，保持原场景空间结构和识别地标不变，
3D块面，low poly geometric 3D art，{时段/天候/景别变化}，{氛围强化}，
clear daylight, simple ambient occlusion, readable shadow，flat shaded polygons, crisp edges, minimal texture，fresh green, sky blue, sandstone orange，
前中后景层次保留，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (low poly geometric 3D art:1.3), (faceted shapes, angular silhouette, simple forms, clean environment:1.18), (clear daylight, simple ambient occlusion, readable shadow:1.1), flat shaded polygons, crisp edges, minimal texture, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (low-poly 几何3D美术:1.3), (分面形体,棱角剪影,简洁造型,干净环境:1.18), (清澈日光,简练环境光遮蔽,可读阴影:1.1), 平面着色多边形, 干脆利落的边缘, 极简纹理, 锐利焦点, 细节丰富的背景, 精致构图
场景衍生提示词必须保持原场景地标、空间结构、材质年代感不变，只改变时段、天候、景别或镜头角度。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, high-poly 写实, 有机圆润形体, 噪点纹理, 地点改变, 丢失地标, 多出人物, 随机建筑, 透视不一致, 平面打光, 过度干净材质, 文字, 水印.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原场景身份必须可识别 |
| 必守 | 衍生变化必须围绕时段、天气、镜头和氛围展开 |
| 严禁 | 换场景、换世界观、加入无关人物 |
| 严禁 | high-poly realism, organic smooth shapes, noisy texture |
