---
name: art_prop
description: 3D手游 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 3D手游

## 一、基础原则

- 生成 3D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

3D手游道具设定图，stylized mobile game 3D render，hero character design, clean fantasy outfit, readable game asset silhouette，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
bright outdoor light, soft ambient light, polished game look，optimized clean material, stylized cloth and metal, vivid but controlled color，blue sky, fresh green, heroic gold，
(best quality, masterpiece, high detailed:1.2), (stylized mobile game 3D render:1.3), (hero character design, clean fantasy outfit, readable game asset silhouette:1.18), (bright outdoor light, soft ambient light, polished game look:1.1), optimized clean material, stylized cloth and metal, vivid but controlled color, sharp focus, detailed background, polished composition，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (风格化手游3D渲染:1.3), (主角级角色设计,干净奇幻装束,可读的游戏资产剪影:1.18), (明亮户外光,柔和环境光,精致游戏观感:1.1), 优化后的干净材质, 风格化布料与金属, 鲜艳而克制的色彩, 锐利焦点, 细节丰富的背景, 精致构图
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, 照片级噪点, 粗糙草稿, 像素化低质, 手部, 手指, 人体, 被角色穿戴, 被角色手持, 无支撑悬浮, 剪影不清, 材质错误, 文字, 水印.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | photorealistic noise, rough sketch, pixelated low quality |
