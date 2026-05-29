---
name: art_scene
description: 积木定格动画 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 积木定格动画

## 一、基础原则

- 生成 定格场景设定图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

积木定格动画场景主视图概念图，brick toy stop-motion animation，block figure, construction bricks, modular toy town, snapped-together props，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
primary red, blue, yellow，macro toy light, crisp shadow, colorful plastic reflection，hard plastic brick surface, molded studs, clean toy edges，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (brick toy stop-motion animation:1.3), (block figure, construction bricks, modular toy town, snapped-together props:1.18), (macro toy light, crisp shadow, colorful plastic reflection:1.1), hard plastic brick surface, molded studs, clean toy edges, macro photography, tactile detail, frame-by-frame charm, high detail，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (brick toy stop-motion animation:1.3), (block figure, construction bricks, modular toy town, snapped-together props:1.18), (macro toy light, crisp shadow, colorful plastic reflection:1.1), hard plastic brick surface, molded studs, clean toy edges, macro photography, tactile detail, frame-by-frame charm, high detail
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(worst quality, low quality:1.4), fluid CGI animation, 2D anime, photorealistic human scale, smooth digital texture, bad anatomy, watermark, signature, text, soft clay, melted curved shapes, realistic human body, no depth, flat lighting, empty white background, people, human silhouette, cropped architecture, inconsistent season, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“积木定格动画”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | soft clay, melted curved shapes, realistic human body |
