---
name: art_prop_derivative
description: 2D像素 · 道具衍生生成
metaData: art_skills
---

# 道具衍生生成 · 2D像素

## 一、基础原则

- 以道具基础图为底图，保持轮廓、核心材质和识别纹样。
- 只改变状态、年代感、光效、局部纹理或展示角度。

## 二、提示词模板

以道具基础图为底图，保持道具核心轮廓与材质不变，
2D像素，clean pixel art style，{衍生状态}，{局部纹理升级}，{光效或年代感变化}，
独立静物陈列，无人物无手部，simple light direction, crisp pixel shadow, no blur，hard pixel edges, dithering, limited palette，
(best quality, masterpiece, high detailed:1.2), (clean pixel art style:1.3), (16-bit sprite look, tile-based environment, readable silhouette, retro game asset:1.18), (simple light direction, crisp pixel shadow, no blur:1.1), hard pixel edges, dithering, limited palette, clean composition, readable silhouette, high detail, finished illustration，画面无字幕、无水印、无标题叠字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (干净利落的像素艺术风格:1.3), (16-bit sprite 观感,图块式拼接场景,可读剪影,复古游戏资产:1.18), (简明光照方向,利落像素阴影,无模糊:1.1), 硬朗像素边缘,抖动过渡(dithering),有限色板,干净构图,可读剪影,高细节,完成度高的插画
道具衍生提示词必须保持原道具轮廓、核心材质和识别纹样不变，只做状态、光效、局部纹理或视角升级。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 抗锯齿平滑线, 矢量图, 3D写实感, 模糊, 道具类型被更换, 剪影错误, 多出手部, 多出角色, 被穿戴或握持, 丢失核心纹样, 过度光效掩盖造型, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原道具身份必须清晰可识别 |
| 必守 | 衍生强度不应遮挡轮廓和材质 |
| 严禁 | 更换为其他道具类型或加入人物互动 |
| 严禁 | anti-aliased smooth line, vector art, 3D realism, blur |
