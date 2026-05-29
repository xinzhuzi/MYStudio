---
name: art_prop_derivative
description: 3D玄幻 · 道具衍生生成
metaData: art_skills
---

# 道具衍生生成 · 3D玄幻

## 一、基础原则

- 以道具基础图为底图，保持轮廓、核心材质和识别纹样。
- 只改变状态、年代感、光效、局部纹理或展示角度。

## 二、提示词模板

以道具基础图为底图，保持道具核心轮廓与材质不变，
3D玄幻，Chinese fantasy 3D animation render，{衍生状态}，{局部纹理升级}，{光效或年代感变化}，
独立静物陈列，无人物无手部，soft volumetric fog, cinematic backlight, glowing aura，polished PBR cloth, fine metal ornaments, ethereal depth，
(best quality, masterpiece, high detailed:1.2), (Chinese fantasy 3D animation render:1.3), (traditional oriental robes, embroidered fabric, layered mountains, spiritual atmosphere:1.18), (soft volumetric fog, cinematic backlight, glowing aura:1.1), polished PBR cloth, fine metal ornaments, ethereal depth, sharp focus, detailed background, polished composition，画面无字幕、无水印、无标题叠字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (Chinese fantasy 3D animation render:1.3), (traditional oriental robes, embroidered fabric, layered mountains, spiritual atmosphere:1.18), (soft volumetric fog, cinematic backlight, glowing aura:1.1), polished PBR cloth, fine metal ornaments, ethereal depth, sharp focus, detailed background, polished composition
道具衍生提示词必须保持原道具轮廓、核心材质和识别纹样不变，只做状态、光效、局部纹理或视角升级。

### 反向规避提示词

(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, western fantasy, modern city, neon sci-fi, changed prop type, wrong silhouette, added hand, added character, worn or held, lost core pattern, excessive glow hiding shape, text, watermark.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原道具身份必须清晰可识别 |
| 必守 | 衍生强度不应遮挡轮廓和材质 |
| 严禁 | 更换为其他道具类型或加入人物互动 |
| 严禁 | western fantasy, modern city, neon sci-fi |
