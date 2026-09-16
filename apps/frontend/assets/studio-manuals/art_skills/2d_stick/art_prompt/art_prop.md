---
name: art_prop
description: 2D简笔画 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 2D简笔画

## 一、基础原则

- 生成 2D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

2D简笔画道具设定图，minimalist stick figure doodle，simple stick figure, sketchbook charm, clean blank space, cute expression，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
flat paper light, no complex shadow, minimal contrast，hand-drawn pencil line, plain white background, sparse detail，black line, white, tiny color accent，
(best quality, masterpiece, high detailed:1.2), (minimalist stick figure doodle:1.3), (simple stick figure, sketchbook charm, clean blank space, cute expression:1.18), (flat paper light, no complex shadow, minimal contrast:1.1), hand-drawn pencil line, plain white background, sparse detail, clean composition, readable silhouette, high detail, finished illustration，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (极简简笔画涂鸦:1.3), (简约简笔画,速写本趣味,干净留白,可爱表情:1.18), (平面纸面光,无复杂阴影,极简对比:1.1), 手绘铅笔线条,素白背景,稀疏细节,干净构图,可读剪影,高细节,完成度高的插画
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 复杂写实细节, 满幅填色, 3D着色, 手部, 手指, 人体, 被人物佩戴, 被人物握持, 无支撑悬浮, 剪影不清, 材质错误, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | complex realistic detail, filled color, 3D shading |
