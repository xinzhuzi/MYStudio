---
name: art_prop_derivative
description: 2D简单线条 · 道具衍生生成
metaData: art_skills
---

# 道具衍生生成 · 2D简单线条

## 一、基础原则

- 以道具基础图为底图，保持轮廓、核心材质和识别纹样。
- 只改变状态、年代感、光效、局部纹理或展示角度。

## 二、提示词模板

以道具基础图为底图，保持道具核心轮廓与材质不变，
2D简单线条，minimal clean line art，{衍生状态}，{局部纹理升级}，{光效或年代感变化}，
独立静物陈列，无人物无手部，plain even light, no heavy shadow, graphic clarity，thin black line, vector-like edge, minimal fill，
(best quality, masterpiece, high detailed:1.2), (minimal clean line art:1.3), (continuous line drawing, elegant figure, simple object, blank composition:1.18), (plain even light, no heavy shadow, graphic clarity:1.1), thin black line, vector-like edge, minimal fill, clean composition, readable silhouette, high detail, finished illustration，画面无字幕、无水印、无标题叠字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (极简干净线稿:1.3), (连续线条绘画,优雅人物,简洁物件,留白构图:1.18), (平实均匀光,无厚重阴影,图形化清晰:1.1), 纤细黑线,矢量感边缘,极简填色,干净构图,可读剪影,高细节,完成度高的插画
道具衍生提示词必须保持原道具轮廓、核心材质和识别纹样不变，只做状态、光效、局部纹理或视角升级。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 凌乱草稿, 密集背景, 3D着色, 写实感, 道具类型改变, 剪影错误, 添加手部, 添加人物, 被佩戴或握持, 丢失核心纹样, 过度光效遮挡造型, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原道具身份必须清晰可识别 |
| 必守 | 衍生强度不应遮挡轮廓和材质 |
| 严禁 | 更换为其他道具类型或加入人物互动 |
| 严禁 | messy sketch, dense background, 3D shading, realism |
