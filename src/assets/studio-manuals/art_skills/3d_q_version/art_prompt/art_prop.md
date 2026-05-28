---
name: art_prop
description: 3DQ版 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 3DQ版

## 一、基础原则

- 生成 3D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

3DQ版道具设定图，chibi collectible 3D toy render，super deformed body, oversized head, cute face, miniature scene，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
soft studio lighting, gentle rim light, clean shadow，smooth toy material, rounded surface, tactile miniature detail，cream beige, pastel green, warm peach，
(best quality, masterpiece, high detailed:1.2), (chibi collectible 3D toy render:1.3), (super deformed body, oversized head, cute face, miniature scene:1.18), (soft studio lighting, gentle rim light, clean shadow:1.1), smooth toy material, rounded surface, tactile miniature detail, sharp focus, detailed background, polished composition，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (chibi collectible 3D toy render:1.3), (super deformed body, oversized head, cute face, miniature scene:1.18), (soft studio lighting, gentle rim light, clean shadow:1.1), smooth toy material, rounded surface, tactile miniature detail, sharp focus, detailed background, polished composition
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, realistic adult proportion, rough material, scary mood, hands, fingers, human body, worn by character, held by character, floating without support, unclear silhouette, wrong material, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | realistic adult proportion, rough material, scary mood |
