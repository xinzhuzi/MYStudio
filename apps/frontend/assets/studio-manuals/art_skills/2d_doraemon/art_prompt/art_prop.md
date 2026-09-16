---
name: art_prop
description: 2D圆润儿童动画 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 2D圆润儿童动画

## 一、基础原则

- 生成 2D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

2D圆润儿童动画道具设定图，rounded child-friendly 2D animation，simple round character design, friendly face, clean prop shapes, playful room，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
bright even light, cheerful color, soft shadow，clean outline, simple flat color, low detail density，primary blue, warm yellow, clean white，
(best quality, masterpiece, high detailed:1.2), (rounded child-friendly 2D animation:1.3), (simple round character design, friendly face, clean prop shapes, playful room:1.18), (bright even light, cheerful color, soft shadow:1.1), clean outline, simple flat color, low detail density, clean composition, readable silhouette, high detail, finished illustration，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (圆润的儿童向 2D 动画:1.3), (简洁圆润的角色设计,友善面容,干净的道具造型,趣味房间:1.18), (明亮均匀光线,明快色彩,柔和阴影:1.1), 干净轮廓,简洁平涂色,低细节密度, 干净构图,可读剪影,高细节,完成度高的插画
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 复杂写实细节, 阴暗恐怖, 锐利棱角面孔, 手部, 手指, 人体, 被人物佩戴, 被人物握持, 无支撑悬浮, 剪影不清, 材质错误, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | complex realistic detail, dark gloomy horror, sharp angular face |
