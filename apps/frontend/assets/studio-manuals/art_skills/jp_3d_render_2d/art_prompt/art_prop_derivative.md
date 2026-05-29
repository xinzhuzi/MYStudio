---
name: art_prop_derivative
description: 日式3D渲染2D · 道具衍生生成
metaData: art_skills
---

# 道具衍生生成 · 日式3D渲染2D

## 一、基础原则

- 以道具基础图为底图，保持轮廓、核心材质和识别纹样。
- 只改变状态、年代感、光效、局部纹理或展示角度。

## 二、提示词模板

以道具基础图为底图，保持道具核心轮廓与材质不变，
日式3D渲染2D，Japanese cel shaded 3D action render，{衍生状态}，{局部纹理升级}，{光效或年代感变化}，
独立静物陈列，无人物无手部，hard rim light, high contrast stage lighting, motion streaks，crisp toon shader, clear line accents, stylized material breakups，
(best quality, masterpiece, high detailed:1.2), (Japanese cel shaded 3D action render:1.3), (sharp anime silhouette, dynamic camera angle, bold costume shapes, action pose:1.18), (hard rim light, high contrast stage lighting, motion streaks:1.1), crisp toon shader, clear line accents, stylized material breakups, sharp focus, detailed background, polished composition，画面无字幕、无水印、无标题叠字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (Japanese cel shaded 3D action render:1.3), (sharp anime silhouette, dynamic camera angle, bold costume shapes, action pose:1.18), (hard rim light, high contrast stage lighting, motion streaks:1.1), crisp toon shader, clear line accents, stylized material breakups, sharp focus, detailed background, polished composition
道具衍生提示词必须保持原道具轮廓、核心材质和识别纹样不变，只做状态、光效、局部纹理或视角升级。

### 反向规避提示词

(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, photorealistic rendering, dull flat color, western cartoon softness, changed prop type, wrong silhouette, added hand, added character, worn or held, lost core pattern, excessive glow hiding shape, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原道具身份必须清晰可识别 |
| 必守 | 衍生强度不应遮挡轮廓和材质 |
| 严禁 | 更换为其他道具类型或加入人物互动 |
| 严禁 | photorealistic rendering, dull flat color, western cartoon softness |
