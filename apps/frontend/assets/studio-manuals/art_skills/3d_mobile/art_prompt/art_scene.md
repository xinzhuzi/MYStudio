---
name: art_scene
description: 3D手游 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 3D手游

## 一、基础原则

- 生成 3D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

3D手游场景主视图概念图，stylized mobile game 3D render，hero character design, clean fantasy outfit, readable game asset silhouette，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
blue sky, fresh green, heroic gold，bright outdoor light, soft ambient light, polished game look，optimized clean material, stylized cloth and metal, vivid but controlled color，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (stylized mobile game 3D render:1.3), (hero character design, clean fantasy outfit, readable game asset silhouette:1.18), (bright outdoor light, soft ambient light, polished game look:1.1), optimized clean material, stylized cloth and metal, vivid but controlled color, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (风格化手游3D渲染:1.3), (主角级角色设计,干净奇幻装束,可读的游戏资产剪影:1.18), (明亮户外光,柔和环境光,精致游戏观感:1.1), 优化后的干净材质, 风格化布料与金属, 鲜艳而克制的色彩, 锐利焦点, 细节丰富的背景, 精致构图
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, 照片级噪点, 粗糙草稿, 像素化低质, 无纵深, 平面打光, 空白背景, 人物, 人影, 建筑被裁切, 季节不一致, 文字, 水印.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“3D手游”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | photorealistic noise, rough sketch, pixelated low quality |
