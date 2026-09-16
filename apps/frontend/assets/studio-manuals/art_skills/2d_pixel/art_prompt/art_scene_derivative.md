---
name: art_scene_derivative
description: 2D像素 · 场景衍生生成
metaData: art_skills
---

# 场景衍生生成 · 2D像素

## 一、基础原则

- 保持原场景地标、空间结构、材质年代感和风格边界。
- 只改变时段、天候、景别、镜头角度或局部氛围。

## 二、提示词模板

以场景基础图为底图，保持原场景空间结构和识别地标不变，
2D像素，clean pixel art style，{时段/天候/景别变化}，{氛围强化}，
simple light direction, crisp pixel shadow, no blur，hard pixel edges, dithering, limited palette，retro green, blue, magenta，
前中后景层次保留，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (clean pixel art style:1.3), (16-bit sprite look, tile-based environment, readable silhouette, retro game asset:1.18), (simple light direction, crisp pixel shadow, no blur:1.1), hard pixel edges, dithering, limited palette, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (干净利落的像素艺术风格:1.3), (16-bit sprite 观感,图块式拼接场景,可读剪影,复古游戏资产:1.18), (简明光照方向,利落像素阴影,无模糊:1.1), 硬朗像素边缘,抖动过渡(dithering),有限色板,干净构图,可读剪影,高细节,完成度高的插画
场景衍生提示词必须保持原场景地标、空间结构、材质年代感不变，只改变时段、天候、景别或镜头角度。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 抗锯齿平滑线, 矢量图, 3D写实感, 模糊, 地点被改变, 地标丢失, 添加人物, 随机建筑, 透视不一致, 平面打光, 过度干净的材质, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原场景身份必须可识别 |
| 必守 | 衍生变化必须围绕时段、天气、镜头和氛围展开 |
| 严禁 | 换场景、换世界观、加入无关人物 |
| 严禁 | anti-aliased smooth line, vector art, 3D realism, blur |
