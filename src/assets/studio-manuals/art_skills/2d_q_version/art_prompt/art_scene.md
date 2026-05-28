---
name: art_scene
description: 2DQ版 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 2DQ版

## 一、基础原则

- 生成 2D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

2DQ版场景主视图概念图，kawaii chibi 2D illustration，super deformed body, cute face, tiny hands, adorable costume，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
pastel pink, mint, cream，soft pastel light, gentle highlight, clean background，rounded line, simple cel shadow, candy color，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (kawaii chibi 2D illustration:1.3), (super deformed body, cute face, tiny hands, adorable costume:1.18), (soft pastel light, gentle highlight, clean background:1.1), rounded line, simple cel shadow, candy color, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (kawaii chibi 2D illustration:1.3), (super deformed body, cute face, tiny hands, adorable costume:1.18), (soft pastel light, gentle highlight, clean background:1.1), rounded line, simple cel shadow, candy color, clean composition, readable silhouette, high detail, finished illustration
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, realistic adult proportion, horror mood, harsh dark lighting, no depth, flat lighting, empty white background, people, human silhouette, cropped architecture, inconsistent season, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“2DQ版”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | realistic adult proportion, horror mood, harsh dark lighting |
