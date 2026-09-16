---
name: art_scene
description: 2D橡皮管动画 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 2D橡皮管动画

## 一、基础原则

- 生成 2D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

2D橡皮管动画场景主视图概念图，1930s rubber hose cartoon，bouncy limbs, pie-cut eyes, vintage mascot character, simple stage，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
black, cream, warm grey，old film light, vignette, soft grain，inked black line, limited palette, analog film texture，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (1930s rubber hose cartoon:1.3), (bouncy limbs, pie-cut eyes, vintage mascot character, simple stage:1.18), (old film light, vignette, soft grain:1.1), inked black line, limited palette, analog film texture, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (1930年代橡皮管卡通:1.3), (摆动肢体,派切双眼,复古吉祥物角色,简约舞台:1.18), (老式胶片光感,暗角,柔和颗粒:1.1), 墨黑描线,有限色板,模拟胶片质感,干净构图,可读剪影,高细节,完成度高的插画
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 现代anime, 写实3D, 僵硬动作, 无纵深, 平面打光, 空白背景, 人物, 人影, 建筑被裁切, 季节不一致, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“2D橡皮管动画”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | modern anime, realistic 3D, stiff motion |
