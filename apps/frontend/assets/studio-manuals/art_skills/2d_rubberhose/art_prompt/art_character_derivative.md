---
name: art_character_derivative
description: 2D橡皮管动画 · 角色衍生服化
metaData: art_skills
---

# 人物衍生生成 · 2D橡皮管动画

## 一、基础原则

- 以角色基础形象为底图，只叠加服装、妆造、配饰、状态和局部风格强化。
- 不改变底模面容、身高、头身比、体态和核心身份。

## 二、提示词模板

以角色基础形象图为底图，img2img 叠加服化妆造，
2D橡皮管动画，1930s rubber hose cartoon，保持基础形象面容不变，保持同一人物身份，
{妆容/面部状态}，{发型变化}，{服饰款式}，{配饰与材质}，
bouncy limbs, pie-cut eyes, vintage mascot character, simple stage，old film light, vignette, soft grain，inked black line, limited palette, analog film texture，
四视图一致性，保持自然站立，背景简洁，
(best quality, masterpiece, high detailed:1.2), (1930s rubber hose cartoon:1.3), (bouncy limbs, pie-cut eyes, vintage mascot character, simple stage:1.18), (old film light, vignette, soft grain:1.1), inked black line, limited palette, analog film texture, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (1930年代橡皮管卡通:1.3), (摆动肢体,派切双眼,复古吉祥物角色,简约舞台:1.18), (老式胶片光感,暗角,柔和颗粒:1.1), 墨黑描线,有限色板,模拟胶片质感,干净构图,可读剪影,高细节,完成度高的插画
人物衍生提示词必须保持底模面容、体态、发型识别点不变，只叠加服化妆造与局部风格升级。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 现代anime, 写实3D, 僵硬动作, 面容漂移, 身份改变, 变成另一个人, 姿势改变, 添加无关场景, 各视图服装不一致, 身体被裁切

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 叠加后仍是同一人物，不改变底模身份 |
| 必守 | 衍生内容只改变服化妆造、状态和局部风格强度 |
| 严禁 | 把人物改成其他作品、其他画风或其他媒介 |
| 严禁 | modern anime, realistic 3D, stiff motion |
