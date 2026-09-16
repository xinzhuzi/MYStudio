---
name: art_character_derivative
description: 3D美式 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 3D美式

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
3D美式，rounded western 3D animation，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
large expressive eyes, friendly proportions, readable silhouette, colorful town background，warm key light, soft fill light, cheerful daylight，smooth stylized material, soft edges, polished character surface，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (rounded western 3D animation:1.3), (large expressive eyes, friendly proportions, readable silhouette, colorful town background:1.18), (warm key light, soft fill light, cheerful daylight:1.1), smooth stylized material, soft edges, polished character surface, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (圆润美式3D动画:1.3), (大而传神的眼睛,友善的身体比例,可读剪影,缤纷小镇背景:1.18), (温暖主光,柔和补光,明快日光:1.1), 平滑风格化材质, 柔和边缘, 精致角色表面, 锐利焦点, 细节丰富的背景, 精致构图
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, 阴暗粗粝写实, 恐怖氛围, 僵硬写实皮肤, 面部漂移, 身份改变, 不同人物, 姿势改变, 加入无关场景, 各视图服装不一致, 身体裁切.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | dark gritty realism, horror mood, hard realistic skin |
