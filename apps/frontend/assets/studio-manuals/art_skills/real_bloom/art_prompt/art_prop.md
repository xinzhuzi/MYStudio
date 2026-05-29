---
name: art_prop
description: 真实光晕 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 真实光晕

## 一、基础原则

- 生成 真人静物摄影，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

真实光晕道具设定图，dreamy backlit live-action photography，real person, glowing rim light, soft focus portrait, airy environment，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
strong bloom, lens flare, warm backlight, shallow depth of field，film softness, skin texture retained, optical glow，cream, pale gold, soft blue，
(best quality, masterpiece, high detailed:1.2), (dreamy backlit live-action photography:1.3), (real person, glowing rim light, soft focus portrait, airy environment:1.18), (strong bloom, lens flare, warm backlight, shallow depth of field:1.1), film softness, skin texture retained, optical glow, real lens optics, natural skin texture, cinematic framing, high detail，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (dreamy backlit live-action photography:1.3), (real person, glowing rim light, soft focus portrait, airy environment:1.18), (strong bloom, lens flare, warm backlight, shallow depth of field:1.1), film softness, skin texture retained, optical glow, real lens optics, natural skin texture, cinematic framing, high detail
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, harsh contrast, dark gritty mood, anime, 3D render, hands, fingers, human body, worn by character, held by character, floating without support, unclear silhouette, wrong material, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | harsh contrast, dark gritty mood, anime, 3D render |
