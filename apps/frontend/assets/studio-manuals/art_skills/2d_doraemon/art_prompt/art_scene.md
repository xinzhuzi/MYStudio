---
name: art_scene
description: 2D圆润儿童动画 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 2D圆润儿童动画

## 一、基础原则

- 生成 2D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

2D圆润儿童动画场景主视图概念图，rounded child-friendly 2D animation，simple round character design, friendly face, clean prop shapes, playful room，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
primary blue, warm yellow, clean white，bright even light, cheerful color, soft shadow，clean outline, simple flat color, low detail density，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (rounded child-friendly 2D animation:1.3), (simple round character design, friendly face, clean prop shapes, playful room:1.18), (bright even light, cheerful color, soft shadow:1.1), clean outline, simple flat color, low detail density, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (圆润的儿童向 2D 动画:1.3), (简洁圆润的角色设计,友善面容,干净的道具造型,趣味房间:1.18), (明亮均匀光线,明快色彩,柔和阴影:1.1), 干净轮廓,简洁平涂色,低细节密度, 干净构图,可读剪影,高细节,完成度高的插画
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 复杂写实细节, 阴暗恐怖, 锐利棱角面孔, 无纵深, 平面打光, 空白背景, 人物, 人影, 建筑被裁切, 季节不一致, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“2D圆润儿童动画”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | complex realistic detail, dark gloomy horror, sharp angular face |
