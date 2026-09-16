---
name: art_scene
description: 3DQ版 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 3DQ版

## 一、基础原则

- 生成 3D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

3DQ版场景主视图概念图，chibi collectible 3D toy render，super deformed body, oversized head, cute face, miniature scene，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
cream beige, pastel green, warm peach，soft studio lighting, gentle rim light, clean shadow，smooth toy material, rounded surface, tactile miniature detail，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (chibi collectible 3D toy render:1.3), (super deformed body, oversized head, cute face, miniature scene:1.18), (soft studio lighting, gentle rim light, clean shadow:1.1), smooth toy material, rounded surface, tactile miniature detail, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (chibi 收藏级3D玩具渲染:1.3), (super deformed 比例身材,超大头部,可爱面容,微缩场景:1.18), (柔和棚拍布光,温和轮廓光,干净阴影:1.1), 光滑玩具材质, 圆润表面, 可触微缩细节, 锐利焦点, 细节丰富的背景, 精致构图
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, 写实成人比例, 粗糙材质, 惊悚氛围, 无纵深, 平面打光, 空白背景, 人物, 人影, 建筑被裁切, 季节不一致, 文字, 水印.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“3DQ版”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | realistic adult proportion, rough material, scary mood |
