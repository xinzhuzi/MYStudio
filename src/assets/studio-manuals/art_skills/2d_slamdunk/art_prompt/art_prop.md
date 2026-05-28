---
name: art_prop
description: 2D运动写实漫画 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 2D运动写实漫画

## 一、基础原则

- 生成 2D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

2D运动写实漫画道具设定图，realistic sports manga animation，athletic body proportion, sweat detail, court atmosphere, intense eye focus，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
gymnasium top light, hard rim light, action freeze frame，inked muscle line, textured shading, energetic motion，court orange, white, deep red，
(best quality, masterpiece, high detailed:1.2), (realistic sports manga animation:1.3), (athletic body proportion, sweat detail, court atmosphere, intense eye focus:1.18), (gymnasium top light, hard rim light, action freeze frame:1.1), inked muscle line, textured shading, energetic motion, clean composition, readable silhouette, high detail, finished illustration，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (realistic sports manga animation:1.3), (athletic body proportion, sweat detail, court atmosphere, intense eye focus:1.18), (gymnasium top light, hard rim light, action freeze frame:1.1), inked muscle line, textured shading, energetic motion, clean composition, readable silhouette, high detail, finished illustration
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(worst quality, low quality:1.4), blurry, messy lineart, bad anatomy, 3D render, photorealistic, CGI, watermark, signature, text, chibi cute body, fantasy robe, weak anatomy, hands, fingers, human body, worn by character, held by character, floating without support, unclear silhouette, wrong material, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | chibi cute body, fantasy robe, weak anatomy |
