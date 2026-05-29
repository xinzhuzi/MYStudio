---
name: art_character_derivative
description: 真人电影 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 真人电影

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
真人电影，live-action cinematic movie still，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
real actor presence, natural costume, film set atmosphere, grounded composition，35mm film light, dramatic key light, color graded frame，film grain, real skin pores, optical lens texture，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (live-action cinematic movie still:1.3), (real actor presence, natural costume, film set atmosphere, grounded composition:1.18), (35mm film light, dramatic key light, color graded frame:1.1), film grain, real skin pores, optical lens texture, real lens optics, natural skin texture, cinematic framing, high detail，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (live-action cinematic movie still:1.3), (real actor presence, natural costume, film set atmosphere, grounded composition:1.18), (35mm film light, dramatic key light, color graded frame:1.1), film grain, real skin pores, optical lens texture, real lens optics, natural skin texture, cinematic framing, high detail
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, 3D render, CGI, anime, illustration, artificial plastic face, face drift, identity changed, different person, pose changed, added unrelated scene, inconsistent costume between views, cropped body.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | 3D render, CGI, anime, illustration, artificial plastic face |
