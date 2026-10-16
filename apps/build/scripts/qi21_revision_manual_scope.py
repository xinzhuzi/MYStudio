"""Separate historical K2 recipes and remove remaining global light-ground locks."""
from qi21_prompt_revision import ROOT, write
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
plans={
'style_guide/07_九型配方.md':[
 ('> **定位**:道劫九型出图的**用法篇**','> **2026-10-16 适用范围**：本篇 K2 节点、LoRA 数值、4/12 步和旧布局是历史配方记录，不能直接用于 Qwen-Image-2.1；现行类型与三用途指令见 `../art_prompt/art_subject_ten_types.md`，当前生成仅用 viggle 9 步双段。\n\n> **历史定位**:道劫九型出图的**用法篇**'),
 ('> **单源声明**:配方数值的**唯一真源 = `daojie_ink_guofeng/json/qi21_bases.json`**','> **历史单源声明（旧 K2 配方并非现行 Qwen 只读投影）**:现行 Qwen 数值真源为 **`daojie_ink_guofeng/json/qi21_bases.json`**'),
 ('跨区一致=同身份段+同 seed','跨区身份事实同源；同 seed 仅用于控制变量，不能保证同脸'),
],
'style_guide/06_新中式设计语言.md':[
 ('底色永远是浅净哑光平涂色场','浅净底仅用于相应设定图；剧情背景的色相、明暗和光源服从场景时段'),
 ('prefix.md 浅净平涂底硬锁','prefix.md 数字绘画工艺约束'),
],
'style_guide/00_总纲.md':[
 ('prefix.md 浅净平涂底硬锁，prefix.md:102','prefix.md 数字绘画工艺约束；浅净底只用于相应设定图，剧情照明与背景服从场景时段'),
],
'style_guide/04_留白与构图.md':[
 ('留白区底色用色名写法(如「宣纸白」「米白」)','留白区若采用浅色底，可用色名写法(如「宣纸白」「米白」)；剧情图仍服从场景时段'),
 ('prefix 浅净平涂底硬锁','prefix 数字绘画工艺约束'),
],
'style_guide/03_色彩体系.md':[
 ('prefix.md 浅净平涂底硬锁','prefix.md 数字绘画工艺约束；浅净底仅用于相应设定图'),
 ('| base | 画面底色(浅净平涂底) | 宣纸白、米色、浅象牙、米白 |','| base | 设定图可选底色；剧情图按场景时段取色 | 宣纸白、米色、浅象牙、米白（按用途选用） |'),
],
'driector_skills/director_storyboard.md':[
 ('浅净平涂底','背景色相与明暗服从场景时段'),
 ('smooth pale matte flat-wash ground','ground color and lighting consistent with the scene and time'),
 ('## 固定风格锚定词（所有输出必须包含）','## 风格词参考（仅需手工画法时使用，自动装配链不重复）'),
 ('模式B（英文）——默认：','模式B（英文）——英文调用方参考；Qwen 道劫自定义链默认中文：'),
 ('> ⚠️ Seedream（模式A）**不支持负向提示词**，负向词仅适用于模式B。','> ⚠️ Seedream（模式A）**不支持负向提示词**；模式B 仅在采样器支持独立负向时使用下列参考词，Qwen viggle cfg≈1 不把负向当生效保障。'),
],
'driector_skills/director_planning_style.md':[
 ('阴影使用淡墨层叠渲染，禁止纯黑硬阴影','阴影以分染罩染表达，明暗与光源服从场景时段'),
 ('工笔线描、写意泼墨、浅净平涂底、墨色浓淡干湿','工笔线描、薄透分染罩染、按场景时段的底色与明暗、墨色浓淡干湿'),
],
'driector_skills/director_storyboard_table_style.md':[
 ('阴影使用淡墨层叠渲染（禁止纯黑硬阴影）','阴影以分染罩染表达，明暗和光源服从场景时段'),
 ('- **阴影色** — 淡墨层叠渲染，禁止纯黑硬阴影','- **阴影色** — 按场景时段与光源确定，以分染罩染表达'),
],
}
for rel,pairs in plans.items():
 p=M/rel;s=p.read_text()
 for old,new in pairs:
  assert old in s,(rel,old);s=s.replace(old,new)
 write(p,s,'最终手册覆盖：K2配方限定历史范围；清除导演、总纲和色彩篇的全局浅底与阴影锁')
print('updated',len(plans),'manual files')
