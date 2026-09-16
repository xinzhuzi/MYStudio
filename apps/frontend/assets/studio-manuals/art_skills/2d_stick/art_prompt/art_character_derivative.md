---
name: art_character_derivative
description: 2D简笔画 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 2D简笔画

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
2D简笔画，minimalist stick figure doodle，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
simple stick figure, sketchbook charm, clean blank space, cute expression，flat paper light, no complex shadow, minimal contrast，hand-drawn pencil line, plain white background, sparse detail，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (minimalist stick figure doodle:1.3), (simple stick figure, sketchbook charm, clean blank space, cute expression:1.18), (flat paper light, no complex shadow, minimal contrast:1.1), hand-drawn pencil line, plain white background, sparse detail, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (极简简笔画涂鸦:1.3), (简约简笔画,速写本趣味,干净留白,可爱表情:1.18), (平面纸面光,无复杂阴影,极简对比:1.1), 手绘铅笔线条,素白背景,稀疏细节,干净构图,可读剪影,高细节,完成度高的插画
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 复杂写实细节, 满幅填色, 3D着色, 面容漂移, 身份改变, 变成他人, 姿势改变, 添加无关场景, 各视图服装不一致, 身体裁切

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | complex realistic detail, filled color, 3D shading |
