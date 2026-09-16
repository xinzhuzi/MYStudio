---
name: art_character_derivative
description: 2D电影感松散漫画 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 2D电影感松散漫画

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
2D电影感松散漫画，loose cinematic manga drawing，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
sketchy linework, casual pose, realistic emotional beat, movie-like composition，natural side light, muted contrast, grounded atmosphere，rough ink texture, visible hand-drawn marks, restrained color，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (loose cinematic manga drawing:1.3), (sketchy linework, casual pose, realistic emotional beat, movie-like composition:1.18), (natural side light, muted contrast, grounded atmosphere:1.1), rough ink texture, visible hand-drawn marks, restrained color, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (松逸的电影感 manga 绘画:1.3), (写意 linework,随意姿态,真实的情绪节拍,电影式构图:1.18), (自然侧光,低对比,质朴踏实的氛围:1.1), 粗粝墨感,可见手绘笔痕,克制的配色, 干净构图,可读剪影,高细节,完成度高的插画
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 过度精细的数码光泽, 套路化可爱 anime, 3D渲染, 面容漂移, 身份改变, 变成他人, 姿势改变, 添加无关场景, 各视图服装不一致, 身体裁切

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | over-polished digital gloss, standard cute anime, 3D render |
