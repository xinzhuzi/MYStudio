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

(best quality, masterpiece, high detailed:1.2), (stylized mobile game 3D render:1.3), (hero character design, clean fantasy outfit, readable game asset silhouette:1.18), (bright outdoor light, soft ambient light, polished game look:1.1), optimized clean material, stylized cloth and metal, vivid but controlled color, sharp focus, detailed background, polished composition
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, photorealistic noise, rough sketch, pixelated low quality, no depth, flat lighting, empty white background, people, human silhouette, cropped architecture, inconsistent season, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“3D手游”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | photorealistic noise, rough sketch, pixelated low quality |
