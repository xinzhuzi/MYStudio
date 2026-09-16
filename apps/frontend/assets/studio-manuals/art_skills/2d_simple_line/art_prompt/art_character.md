---
name: art_character
description: 2D简单线条 · 角色基础形象生成
metaData: art_skills
---

# 人物基础形象生成 · 2D简单线条

## 一、基础原则

- 生成 2D 角色设定图，用于角色首次定型。
- 必须保持“minimal clean line art”和“2D 动画 / 插画”媒介边界。
- 人物需具备清晰身份、年龄、性别、五官、体态、发型、基础服装和气质标签。

## 二、提示词模板

{性别}角色四视图设定图，2D简单线条，minimal clean line art，continuous line drawing, elegant figure, simple object, blank composition，
character design sheet, character turnaround,
{五官特征}，{整体气质}，{年龄段}，{身份职业}，
{身高描述}，{头身比}，{体型描述}，{体态描述}，
{发色发型}，{基础服装}，{服装材质与色彩}，
同一画面左至右并排：人像特写+正视图+侧视图+后视图，
人像特写从头顶到锁骨完整展示，全身立像从头顶到脚底完整展示，
plain even light, no heavy shadow, graphic clarity，thin black line, vector-like edge, minimal fill，black, white, single accent color，
(best quality, masterpiece, high detailed:1.2), (minimal clean line art:1.3), (continuous line drawing, elegant figure, simple object, blank composition:1.18), (plain even light, no heavy shadow, graphic clarity:1.1), thin black line, vector-like edge, minimal fill, clean composition, readable silhouette, high detail, finished illustration，
图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (极简干净线稿:1.3), (连续线条绘画,优雅人物,简洁物件,留白构图:1.18), (平实均匀光,无厚重阴影,图形化清晰:1.1), 纤细黑线,矢量感边缘,极简填色,干净构图,可读剪影,高细节,完成度高的插画
角色类提示词必须保留身份、年龄、性别、五官、身高、头身比、体态、服装、发型和四视图一致性。

### 反向规避提示词

(最差质量,低质量:1.4), 模糊, 凌乱线稿, 解剖错误, 3D渲染, 照片写实, CGI, 水印, 签名, 文字, 凌乱草稿, 密集背景, 3D着色, 写实感, 解剖错误, 面部变形, 双眼不对称, 多余肢体, 缺失肢体, 并指, 头部裁切, 脚部裁切, 身份不一致, 服装不一致

## 四、必守 / 严禁

| 类型 | 规则 |
|---|---|
| 必守 | 四视图同一人物，面容/体型/发型/服装/光影完全一致 |
| 必守 | 全身从头到脚完整入画，特写从头顶到锁骨完整入画 |
| 严禁 | 直接套用具体作品角色造型或版权角色名称 |
| 严禁 | messy sketch, dense background, 3D shading, realism |
