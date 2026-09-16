---
name: art_character_derivative
description: 2D圆润儿童动画 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 2D圆润儿童动画

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
2D圆润儿童动画，rounded child-friendly 2D animation，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
simple round character design, friendly face, clean prop shapes, playful room，bright even light, cheerful color, soft shadow，clean outline, simple flat color, low detail density，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (rounded child-friendly 2D animation:1.3), (simple round character design, friendly face, clean prop shapes, playful room:1.18), (bright even light, cheerful color, soft shadow:1.1), clean outline, simple flat color, low detail density, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (圆润的儿童向 2D 动画:1.3), (简洁圆润的角色设计,友善面容,干净的道具造型,趣味房间:1.18), (明亮均匀光线,明快色彩,柔和阴影:1.1), 干净轮廓,简洁平涂色,低细节密度, 干净构图,可读剪影,高细节,完成度高的插画
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 复杂写实细节, 阴暗恐怖, 锐利棱角面孔, 面容漂移, 身份改变, 变成他人, 姿势改变, 添加无关场景, 各视图服装不一致, 身体裁切

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | complex realistic detail, dark gloomy horror, sharp angular face |
