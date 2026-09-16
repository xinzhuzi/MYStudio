---
name: art_prop
description: 2D奇幻动画 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 2D奇幻动画

## 一、基础原则

- 生成 2D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

2D奇幻动画道具设定图，fantasy 2D anime illustration，magical city, glowing symbols, ornate robes, dreamy atmosphere，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
mystic particle glow, moonlit rim light, magical haze，clean lineart, luminous color, layered fantasy detail，violet, sapphire, starlight gold，
(best quality, masterpiece, high detailed:1.2), (fantasy 2D anime illustration:1.3), (magical city, glowing symbols, ornate robes, dreamy atmosphere:1.18), (mystic particle glow, moonlit rim light, magical haze:1.1), clean lineart, luminous color, layered fantasy detail, clean composition, readable silhouette, high detail, finished illustration，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (奇幻 2D 动漫插画:1.3), (魔法之城,发光符文,华美长袍,梦幻氛围:1.18), (神秘粒子微光,月光轮廓光,魔法雾霭:1.1), 干净线稿,明亮通透的色彩,层次丰富的奇幻细节, 干净构图,可读剪影,高细节,完成度高的插画
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 现代日常场景, 科幻机械, 冷硬写实, 手部, 手指, 人体, 被人物佩戴, 被人物握持, 无支撑悬浮, 剪影不清, 材质错误, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | modern daily setting, sci-fi machinery, gritty realism |
