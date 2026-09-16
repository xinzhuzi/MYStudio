---
name: art_prop_derivative
description: 3D块面 · 道具衍生生成
metaData: art_skills
---

# 道具衍生生成 · 3D块面

## 一、基础原则

- 以道具基础图为底图，保持轮廓、核心材质和识别纹样。
- 只改变状态、年代感、光效、局部纹理或展示角度。

## 二、提示词模板

以道具基础图为底图，保持道具核心轮廓与材质不变，
3D块面，low poly geometric 3D art，{衍生状态}，{局部纹理升级}，{光效或年代感变化}，
独立静物陈列，无人物无手部，clear daylight, simple ambient occlusion, readable shadow，flat shaded polygons, crisp edges, minimal texture，
(best quality, masterpiece, high detailed:1.2), (low poly geometric 3D art:1.3), (faceted shapes, angular silhouette, simple forms, clean environment:1.18), (clear daylight, simple ambient occlusion, readable shadow:1.1), flat shaded polygons, crisp edges, minimal texture, sharp focus, detailed background, polished composition，画面无字幕、无水印、无标题叠字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (low-poly 几何3D美术:1.3), (分面形体,棱角剪影,简洁造型,干净环境:1.18), (清澈日光,简练环境光遮蔽,可读阴影:1.1), 平面着色多边形, 干脆利落的边缘, 极简纹理, 锐利焦点, 细节丰富的背景, 精致构图
道具衍生提示词必须保持原道具轮廓、核心材质和识别纹样不变，只做状态、光效、局部纹理或视角升级。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, high-poly 写实, 有机圆润形体, 噪点纹理, 道具类型改变, 剪影错误, 多出的手, 多出的人物, 被穿戴或手持, 丢失核心纹样, 过度辉光掩盖造型, 文字, 水印.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 原道具身份必须清晰可识别 |
| 必守 | 衍生强度不应遮挡轮廓和材质 |
| 严禁 | 更换为其他道具类型或加入人物互动 |
| 严禁 | high-poly realism, organic smooth shapes, noisy texture |
