---
name: art_character_derivative
description: 3D块面 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 3D块面

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
3D块面，low poly geometric 3D art，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
faceted shapes, angular silhouette, simple forms, clean environment，clear daylight, simple ambient occlusion, readable shadow，flat shaded polygons, crisp edges, minimal texture，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (low poly geometric 3D art:1.3), (faceted shapes, angular silhouette, simple forms, clean environment:1.18), (clear daylight, simple ambient occlusion, readable shadow:1.1), flat shaded polygons, crisp edges, minimal texture, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (low-poly 几何3D美术:1.3), (分面形体,棱角剪影,简洁造型,干净环境:1.18), (清澈日光,简练环境光遮蔽,可读阴影:1.1), 平面着色多边形, 干脆利落的边缘, 极简纹理, 锐利焦点, 细节丰富的背景, 精致构图
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, high-poly 写实, 有机圆润形体, 噪点纹理, 面部漂移, 身份改变, 不同人物, 姿势改变, 加入无关场景, 各视图服装不一致, 身体裁切.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | high-poly realism, organic smooth shapes, noisy texture |
