---
name: art_prop_derivative
description: 真人复古武侠 · 道具衍生生成
metaData: art_skills
---

# 道具衍生生成 · 真人复古武侠

## 一、基础原则

- 以道具基础图为底图，保持轮廓、核心材质和识别纹样。
- 只改变状态、年代感、光效、局部纹理或展示角度。

## 二、提示词模板

以道具基础图为底图，保持道具核心轮廓与材质不变，
真人复古武侠，vintage live-action wuxia cinema，{衍生状态}，{局部纹理升级}，{光效或年代感变化}，
独立静物陈列，无人物无手部，hard side light, dusty backlight, retro film contrast，film grain, worn fabric, real weapon surface，
(best quality, masterpiece, high detailed:1.2), (vintage live-action wuxia cinema:1.3), (martial arts stance, old inn, forest duel, practical costume:1.18), (hard side light, dusty backlight, retro film contrast:1.1), film grain, worn fabric, real weapon surface, real lens optics, natural skin texture, cinematic framing, high detail，画面无字幕、无水印、无标题叠字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (vintage live-action wuxia cinema:1.3), (martial arts stance, old inn, forest duel, practical costume:1.18), (hard side light, dusty backlight, retro film contrast:1.1), film grain, worn fabric, real weapon surface, real lens optics, natural skin texture, cinematic framing, high detail
道具衍生提示词必须保持原道具轮廓、核心材质和识别纹样不变，只做状态、光效、局部纹理或视角升级。

### 反向规避提示词

(worst quality, low quality:1.4), 3D render, CGI, anime, illustration, cartoon, plastic skin, over-smoothed face, bad anatomy, watermark, signature, text, modern clothing, sci-fi tech, CGI magic excess, anime, changed prop type, wrong silhouette, added hand, added character, worn or held, lost core pattern, excessive glow hiding shape, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原道具身份必须清晰可识别 |
| 必守 | 衍生强度不应遮挡轮廓和材质 |
| 严禁 | 更换为其他道具类型或加入人物互动 |
| 严禁 | modern clothing, sci-fi tech, CGI magic excess, anime |
