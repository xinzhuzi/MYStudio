---
name: art_prop
description: 2D像素 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 2D像素

## 一、基础原则

- 生成 2D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

2D像素道具设定图，clean pixel art style，16-bit sprite look, tile-based environment, readable silhouette, retro game asset，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
simple light direction, crisp pixel shadow, no blur，hard pixel edges, dithering, limited palette，retro green, blue, magenta，
(best quality, masterpiece, high detailed:1.2), (clean pixel art style:1.3), (16-bit sprite look, tile-based environment, readable silhouette, retro game asset:1.18), (simple light direction, crisp pixel shadow, no blur:1.1), hard pixel edges, dithering, limited palette, clean composition, readable silhouette, high detail, finished illustration，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (干净利落的像素艺术风格:1.3), (16-bit sprite 观感,图块式拼接场景,可读剪影,复古游戏资产:1.18), (简明光照方向,利落像素阴影,无模糊:1.1), 硬朗像素边缘,抖动过渡(dithering),有限色板,干净构图,可读剪影,高细节,完成度高的插画
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 抗锯齿平滑线, 矢量图, 3D写实感, 模糊, 手部, 手指, 人体, 被角色穿戴, 被角色握持, 无支撑悬浮, 剪影不清, 材质错误, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | anti-aliased smooth line, vector art, 3D realism, blur |
