---
name: art_scene
description: 3D块面 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 3D块面

## 一、基础原则

- 生成 3D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

3D块面场景主视图概念图，low poly geometric 3D art，faceted shapes, angular silhouette, simple forms, clean environment，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
fresh green, sky blue, sandstone orange，clear daylight, simple ambient occlusion, readable shadow，flat shaded polygons, crisp edges, minimal texture，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (low poly geometric 3D art:1.3), (faceted shapes, angular silhouette, simple forms, clean environment:1.18), (clear daylight, simple ambient occlusion, readable shadow:1.1), flat shaded polygons, crisp edges, minimal texture, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (low-poly 几何3D美术:1.3), (分面形体,棱角剪影,简洁造型,干净环境:1.18), (清澈日光,简练环境光遮蔽,可读阴影:1.1), 平面着色多边形, 干脆利落的边缘, 极简纹理, 锐利焦点, 细节丰富的背景, 精致构图
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, high-poly 写实, 有机圆润形体, 噪点纹理, 无纵深, 平面打光, 空白背景, 人物, 人影, 建筑被裁切, 季节不一致, 文字, 水印.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“3D块面”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | high-poly realism, organic smooth shapes, noisy texture |
