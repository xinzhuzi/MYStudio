---
name: art_character_derivative
description: 2D工笔风 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 2D工笔风

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
2D工笔风，Chinese gongbi painting illustration，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
meticulous brushwork, elegant figure, refined ornament, ink wash background，soft paper light, delicate highlight, calm atmosphere，rice paper grain, fine mineral pigment, precise linework，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (Chinese gongbi painting illustration:1.3), (meticulous brushwork, elegant figure, refined ornament, ink wash background:1.18), (soft paper light, delicate highlight, calm atmosphere:1.1), rice paper grain, fine mineral pigment, precise linework, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (Chinese gongbi painting illustration:1.3), (meticulous brushwork, elegant figure, refined ornament, ink wash background:1.18), (soft paper light, delicate highlight, calm atmosphere:1.1), rice paper grain, fine mineral pigment, precise linework, clean composition, readable silhouette, high detail, finished illustration
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量:1.4), 厚漫画描边,粗黑轮廓,卡通平涂阴影,现代动漫比例,夸张大眼, 摄影写实,3D渲染,CGI,塑料皮肤, 霓虹色,高饱和荧光色, 过度装饰,纹样堆砌,杂乱构图, 厚重西式油画,水彩晕染,泼墨写意, 做旧扫描感,重纸纹,纸面污渍,泛黄旧底,绢纹织物底,褶皱绉纹,横向条纹,色带, 文字,水印,签名,多余手指,畸形的手

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | western oil painting, neon color, rough sketch, 3D realism |
