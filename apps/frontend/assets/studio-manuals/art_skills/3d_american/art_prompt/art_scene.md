---
name: art_scene
description: 3D美式 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 3D美式

## 一、基础原则

- 生成 3D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

3D美式场景主视图概念图，rounded western 3D animation，large expressive eyes, friendly proportions, readable silhouette, colorful town background，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
sunny amber, sky blue, soft coral，warm key light, soft fill light, cheerful daylight，smooth stylized material, soft edges, polished character surface，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (rounded western 3D animation:1.3), (large expressive eyes, friendly proportions, readable silhouette, colorful town background:1.18), (warm key light, soft fill light, cheerful daylight:1.1), smooth stylized material, soft edges, polished character surface, sharp focus, detailed background, polished composition，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (圆润美式3D动画:1.3), (大而传神的眼睛,友善的身体比例,可读剪影,缤纷小镇背景:1.18), (温暖主光,柔和补光,明快日光:1.1), 平滑风格化材质, 柔和边缘, 精致角色表面, 锐利焦点, 细节丰富的背景, 精致构图
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(最差质量,低质量,劣质:1.4), 模糊, 糊化, 变形, 失焦, 畸形身体, 多余肢体, 水印, 签名, 文字, 阴暗粗粝写实, 恐怖氛围, 僵硬写实皮肤, 无纵深, 平面打光, 空白背景, 人物, 人影, 建筑被裁切, 季节不一致, 文字, 水印.

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“3D美式”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | dark gritty realism, horror mood, hard realistic skin |
