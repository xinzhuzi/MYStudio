---
name: art_scene
description: 2D工笔风 · 场景图生成
metaData: art_skills
---

# 场景图生成 · 2D工笔风

## 一、基础原则

- 生成 2D 场景概念图，用于场景资产与分镜背景。
- 场景默认不出现人物，除非调用方明确要求。
- 必须体现前景、中景、后景和光源逻辑。

## 二、提示词模板

2D工笔风场景主视图概念图，Chinese gongbi painting illustration，meticulous brushwork, elegant figure, refined ornament, ink wash background，
{室内/室外}，{场景类型}，{时代/地域/题材线索}，{季节+时间}，
前景：{元素}，中景：{元素}，后景：{元素}，
ink black, jade green, mineral red，soft paper light, delicate highlight, calm atmosphere，rice paper grain, fine mineral pigment, precise linework，
空间纵深清晰，材质细节可读，单画面构图，画面中无任何人物，
(best quality, masterpiece, high detailed:1.2), (Chinese gongbi painting illustration:1.3), (meticulous brushwork, elegant figure, refined ornament, ink wash background:1.18), (soft paper light, delicate highlight, calm atmosphere:1.1), rice paper grain, fine mineral pigment, precise linework, clean composition, readable silhouette, high detail, finished illustration，图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (Chinese gongbi painting illustration:1.3), (meticulous brushwork, elegant figure, refined ornament, ink wash background:1.18), (soft paper light, delicate highlight, calm atmosphere:1.1), rice paper grain, fine mineral pigment, precise linework, clean composition, readable silhouette, high detail, finished illustration
场景类提示词必须强化前景/中景/后景、空间纵深、主光源方向、材质痕迹和情绪色调。

### 反向规避提示词

(最差质量,低质量:1.4), 厚漫画描边,粗黑轮廓,卡通平涂阴影,现代动漫比例,夸张大眼, 摄影写实,3D渲染,CGI,塑料皮肤, 霓虹色,高饱和荧光色, 过度装饰,纹样堆砌,杂乱构图, 厚重西式油画,水彩晕染,泼墨写意, 做旧扫描感,重纸纹,纸面污渍,泛黄旧底,绢纹织物底,褶皱绉纹,横向条纹,色带, 文字,水印,签名,多余手指,畸形的手

## 四、约束规则

| 类型 | 规则 |
|---|---|
| 必守 | 必须有空间层次与明确光源 |
| 必守 | 色彩和材质应服务于“2D工笔风”风格 |
| 严禁 | 场景图中随机出现人物、人影或人体轮廓 |
| 严禁 | western oil painting, neon color, rough sketch, 3D realism |
