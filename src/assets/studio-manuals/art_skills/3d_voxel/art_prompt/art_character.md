---
name: art_character
description: 3D方块世界 · 角色基础形象生成
metaData: art_skills
---

# 人物基础形象生成 · 3D方块世界

## 一、基础原则

- 生成 3D 角色设定图，用于角色首次定型。
- 必须保持“voxel block world 3D art”和“3D 渲染”媒介边界。
- 人物需具备清晰身份、年龄、性别、五官、体态、发型、基础服装和气质标签。

## 二、提示词模板

{性别}角色四视图设定图，3D方块世界，voxel block world 3D art，cubic character, blocky trees, grid-based village, isometric readability，
character design sheet, character turnaround,
{五官特征}，{整体气质}，{年龄段}，{身份职业}，
{身高描述}，{头身比}，{体型描述}，{体态描述}，
{发色发型}，{基础服装}，{服装材质与色彩}，
同一画面左至右并排：人像特写+正视图+侧视图+后视图，
人像特写从头顶到锁骨完整展示，全身立像从头顶到脚底完整展示，
bright daylight, crisp shadow, cheerful atmosphere，voxel cubes, pixel-like material, clean toy blocks，grass green, clear blue, flower red，
(best quality, masterpiece, high detailed:1.2), (voxel block world 3D art:1.3), (cubic character, blocky trees, grid-based village, isometric readability:1.18), (bright daylight, crisp shadow, cheerful atmosphere:1.1), voxel cubes, pixel-like material, clean toy blocks, sharp focus, detailed background, polished composition，
图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(best quality, masterpiece, high detailed:1.2), (voxel block world 3D art:1.3), (cubic character, blocky trees, grid-based village, isometric readability:1.18), (bright daylight, crisp shadow, cheerful atmosphere:1.1), voxel cubes, pixel-like material, clean toy blocks, sharp focus, detailed background, polished composition
角色类提示词必须保留身份、年龄、性别、五官、身高、头身比、体态、服装、发型和四视图一致性。

### 反向规避提示词

(worst quality, low quality, bad quality:1.4), blurry, fuzzy, distorted, out of focus, malformed body, extra limbs, watermark, signature, text, round organic forms, smooth realistic texture, blur, bad anatomy, deformed face, asymmetrical eyes, extra limbs, missing limbs, fused fingers, cropped head, cropped feet, inconsistent identity, inconsistent clothing.

## 四、必守 / 严禁

| 类型 | 规则 |
|---|---|
| 必守 | 四视图同一人物，面容/体型/发型/服装/光影完全一致 |
| 必守 | 全身从头到脚完整入画，特写从头顶到锁骨完整入画 |
| 严禁 | 直接套用具体作品角色造型或版权角色名称 |
| 严禁 | round organic forms, smooth realistic texture, blur |
