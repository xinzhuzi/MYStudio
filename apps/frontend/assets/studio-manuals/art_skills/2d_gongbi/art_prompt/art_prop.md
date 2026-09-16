---
name: art_prop
description: 2D工笔风 · 道具图像生成
metaData: art_skills
---

# 道具图像生成 · 2D工笔风

## 一、基础原则

- 生成 2D 道具设定图，用于独立道具资产入库。
- 道具必须独立陈列，不出现人物、手部或佩戴状态。

## 二、提示词模板

2D工笔风道具设定图，Chinese gongbi painting illustration，meticulous brushwork, elegant figure, refined ornament, ink wash background，
{道具类型}，{材质描述}，{工艺/纹样}，{使用痕迹或状态}，
纯道具静物展示，道具独立陈列，无人持有，无人佩戴，
同一画面四宫格：正面图+侧面图+背面图+细节特写，
soft paper light, delicate highlight, calm atmosphere，rice paper grain, fine mineral pigment, precise linework，ink black, jade green, mineral red，
(best quality, masterpiece, high detailed:1.2), (Chinese gongbi painting illustration:1.3), (meticulous brushwork, elegant figure, refined ornament, ink wash background:1.18), (soft paper light, delicate highlight, calm atmosphere:1.1), rice paper grain, fine mineral pigment, precise linework, clean composition, readable silhouette, high detail, finished illustration，
画面无字幕、无水印、无标题叠字，画面中不能出现任何人物、手部、手指、肢体

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (Chinese gongbi painting illustration:1.3), (meticulous brushwork, elegant figure, refined ornament, ink wash background:1.18), (soft paper light, delicate highlight, calm atmosphere:1.1), rice paper grain, fine mineral pigment, precise linework, clean composition, readable silhouette, high detail, finished illustration
道具类提示词必须明确类型、材质、工艺、磨损痕迹、陈列方式和多角度/细节特写。

### 反向规避提示词

(最差质量,低质量:1.4), 厚漫画描边,粗黑轮廓,卡通平涂阴影,现代动漫比例,夸张大眼, 摄影写实,3D渲染,CGI,塑料皮肤, 霓虹色,高饱和荧光色, 过度装饰,纹样堆砌,杂乱构图, 厚重西式油画,水彩晕染,泼墨写意, 做旧扫描感,重纸纹,纸面污渍,泛黄旧底,绢纹织物底,褶皱绉纹,横向条纹,色带, 文字,水印,签名,多余手指,畸形的手

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 道具轮廓清晰，材质和工艺可读 |
| 必守 | 四宫格布局或按调用方要求输出单张静物图 |
| 严禁 | 出现人物、手部、佩戴、握持、使用中动作 |
| 严禁 | western oil painting, neon color, rough sketch, 3D realism |
