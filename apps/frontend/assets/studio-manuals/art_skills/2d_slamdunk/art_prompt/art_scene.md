---
name: art_scene
description: 2D运动写实漫画 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 2D运动写实漫画

## 一、基础原则

- 生成 2D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

2D运动写实漫画场景主视图概念图，realistic sports manga animation，athletic body proportion, sweat detail, court atmosphere, intense eye focus，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
court orange, white, deep red，gymnasium top light, hard rim light, action freeze frame，inked muscle line, textured shading, energetic motion，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (realistic sports manga animation:1.3), (athletic body proportion, sweat detail, court atmosphere, intense eye focus:1.18), (gymnasium top light, hard rim light, action freeze frame:1.1), inked muscle line, textured shading, energetic motion, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (写实运动漫画动画:1.3), (运动员体型比例,汗水细节,球场氛围,锐利眼神注视:1.18), (体育馆顶光,硬朗轮廓光,动作定格瞬间:1.1), 墨线肌肉线条,肌理化阴影,力量感动态,干净构图,可读剪影,高细节,完成度高的插画
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, Q版可爱体型, 奇幻长袍, 解剖结构松散, 无纵深, 平面打光, 空白背景, 人物, 人影, 建筑被裁切, 季节不一致, 文字, 水印

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“2D运动写实漫画”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | chibi cute body, fantasy robe, weak anatomy |
