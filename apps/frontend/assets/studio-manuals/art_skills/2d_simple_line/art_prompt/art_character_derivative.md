---
name: art_character_derivative
description: 2D简单线条 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 2D简单线条

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
2D简单线条，minimal clean line art，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
continuous line drawing, elegant figure, simple object, blank composition，plain even light, no heavy shadow, graphic clarity，thin black line, vector-like edge, minimal fill，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (minimal clean line art:1.3), (continuous line drawing, elegant figure, simple object, blank composition:1.18), (plain even light, no heavy shadow, graphic clarity:1.1), thin black line, vector-like edge, minimal fill, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (极简干净线稿:1.3), (连续线条绘画,优雅人物,简洁物件,留白构图:1.18), (平实均匀光,无厚重阴影,图形化清晰:1.1), 纤细黑线,矢量感边缘,极简填色,干净构图,可读剪影,高细节,完成度高的插画
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 凌乱草稿, 密集背景, 3D着色, 写实感, 面容漂移, 身份改变, 变成他人, 姿势改变, 添加无关场景, 各视图服装不一致, 身体裁切

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | messy sketch, dense background, 3D shading, realism |
