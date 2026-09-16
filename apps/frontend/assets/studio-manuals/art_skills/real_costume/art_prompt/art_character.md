---
name: art_character
description: 真人古装 · 角色基础形象生成
metaData: art_skills
---

# 人物基础形象生成 · 真人古装

## 一、基础原则

- 生成 真人人物参考摄影，用于角色首次定型。
- 必须保持“live-action Chinese period drama still”和“真人摄影”媒介边界。
- 人物需具备清晰身份、年龄、性别、五官、体态、发型、基础服装和气质标签。

## 二、提示词模板

{性别}角色四视图设定图，真人古装，live-action Chinese period drama still，period costume, embroidered fabric, ancient interior, elegant posture，
character design sheet, character turnaround,
{五官特征}，{整体气质}，{年龄段}，{身份职业}，
{身高描述}，{头身比}，{体型描述}，{体态描述}，
{发色发型}，{基础服装}，{服装材质与色彩}，
同一画面左至右并排：人像特写+正视图+侧视图+后视图，
人像特写从头顶到锁骨完整展示，全身立像从头顶到脚底完整展示，
soft lantern light, daylight through lattice, cinematic haze，real silk folds, hair ornament detail, natural skin texture，ivory, red lacquer, warm gold，
(最佳质量,杰作,高细节:1.2), (真人中国古装剧剧照:1.3), (古装服饰,刺绣织物,古代室内,优雅仪态:1.18), (柔和灯笼光,花窗透进的日光,电影感薄雾:1.1), 真丝绸缎褶皱,发饰细节,自然皮肤质感,真实镜头光学,自然皮肤质感,电影感构图,高细节，
图中不要有任何文字

## 三、提示词质量增强

### 正向质量锚点

(最佳质量,杰作,高细节:1.2), (真人中国古装剧剧照:1.3), (古装服饰,刺绣织物,古代室内,优雅仪态:1.18), (柔和灯笼光,花窗透进的日光,电影感薄雾:1.1), 真丝绸缎褶皱,发饰细节,自然皮肤质感,真实镜头光学,自然皮肤质感,电影感构图,高细节
角色类提示词必须保留身份、年龄、性别、五官、身高、头身比、体态、服装、发型和四视图一致性。

### 反向规避提示词

(最差质量,低质量:1.4), 3D渲染, CGI, anime, 插画, 卡通, 塑料感皮肤, 过度磨皮的面孔, 解剖错误, 水印, 签名, 文字, 现代服装, 眼镜, 手表, 面部变形, 双眼不对称, 多余肢体, 缺失肢体, 手指粘连, 头部裁切, 脚部裁切, 身份不一致, 服装不一致.

## 四、必守 / 严禁

| 类型 | 规则 |
|---|---|
| 必守 | 四视图同一人物，面容/体型/发型/服装/光影完全一致 |
| 必守 | 全身从头到脚完整入画，特写从头顶到锁骨完整入画 |
| 严禁 | 直接套用具体作品角色造型或版权角色名称 |
| 严禁 | modern clothes, glasses, watch, 3D render, anime |
