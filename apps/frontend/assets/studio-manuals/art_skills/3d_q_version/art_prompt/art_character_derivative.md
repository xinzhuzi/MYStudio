---
name: art_character_derivative
description: 3DQ版 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 3DQ版

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
3DQ版，chibi collectible 3D toy render，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
super deformed body, oversized head, cute face, miniature scene，soft studio lighting, gentle rim light, clean shadow，smooth toy material, rounded surface, tactile miniature detail，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (chibi collectible 3D toy render:1.3), (super deformed body, oversized head, cute face, miniature scene:1.18), (soft studio lighting, gentle rim light, clean shadow:1.1), smooth toy material, rounded surface, tactile miniature detail, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (chibi 收藏级3D玩具渲染:1.3), (super deformed 比例身材,超大头部,可爱面容,微缩场景:1.18), (柔和棚拍布光,温和轮廓光,干净阴影:1.1), 光滑玩具材质, 圆润表面, 可触微缩细节, 锐利焦点, 细节丰富的背景, 精致构图
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, 写实成人比例, 粗糙材质, 惊悚氛围, 面部漂移, 身份改变, 不同人物, 姿势改变, 加入无关场景, 各视图服装不一致, 身体裁切.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | realistic adult proportion, rough material, scary mood |
