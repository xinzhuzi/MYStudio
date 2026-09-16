---
name: art_prop
description: 3D块面 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 3D块面

## 一、基础原则

- 生成 3D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

3D块面道具设定图，low poly geometric 3D art，faceted shapes, angular silhouette, simple forms, clean environment，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
clear daylight, simple ambient occlusion, readable shadow，flat shaded polygons, crisp edges, minimal texture，fresh green, sky blue, sandstone orange，
(best quality, masterpiece, high detailed:1.2), (low poly geometric 3D art:1.3), (faceted shapes, angular silhouette, simple forms, clean environment:1.18), (clear daylight, simple ambient occlusion, readable shadow:1.1), flat shaded polygons, crisp edges, minimal texture, sharp focus, detailed background, polished composition，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (low-poly 几何3D美术:1.3), (分面形体,棱角剪影,简洁造型,干净环境:1.18), (清澈日光,简练环境光遮蔽,可读阴影:1.1), 平面着色多边形, 干脆利落的边缘, 极简纹理, 锐利焦点, 细节丰富的背景, 精致构图
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, high-poly 写实, 有机圆润形体, 噪点纹理, 手部, 手指, 人体, 被角色穿戴, 被角色手持, 无支撑悬浮, 剪影不清, 材质错误, 文字, 水印.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | high-poly realism, organic smooth shapes, noisy texture |
