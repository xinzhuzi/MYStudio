"""Small, backed-up documentation revisions. Historical quotations stay attributed."""
from pathlib import Path
import json
from qi21_prompt_revision import ROOT, write, replace
D=ROOT/'docs/prompts/Qwen-Image-2.1'; M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
def doc(pre): return next(D.glob(pre+'*.md'))
def update(p,fn,why):
 old=p.read_text(); new=fn(old); assert new!=old, p; write(p,new,why)
def line_map(p,fn,why): update(p,lambda t:'\n'.join(fn(l) for l in t.splitlines())+'\n',why)
def insert_note(p,note,why): update(p,lambda t:t.split('\n',1)[0]+'\n\n'+note+'\n'+t.split('\n',1)[1],why)
NOTE='> **2026-10-16 现行边界**：道劫自定义链使用中文，长度按任务复杂度，不套用官方 PE-T2I 的英文 400–500 词配方。共同底座只统一画法；设定图用漫射光，剧情图的明暗、光源、磨损、血痕和肢体状态服从来源事实。新建资产拼主体＋类型＋画法；局部编辑只拼操作与保留项；画风转换拼操作＋画法。布局只归类型层。仅运行 viggle 9 步双段，必要条件写入正向；固定 seed 仅用于对照，不保证身份一致。'
p=doc('07-')
repls={
 '本宪法色锚/否定式/修饰密度等纪律全量适用':'来源事实和色锚纪律适用；局部编辑不重描未变属性，否定式与修饰数量不作为模型硬门',
 '**禁写**:风格词(底座已定义)、质量标签、否定式、负面内容、每名词超一修饰':'**避免重复**:底座已有的风格词、空泛质量标签；必要限制优先写可观察状态，长修饰链宜拆句',
 '- 跨张一致性六同:身份段逐字同源/同 seed/同公式文结构/同款/同画幅/同 LoRA。':'- 文生图身份段同源；图生图指图保留身份。固定 seed 用于控制变量对照，不能保证跨图身份一致。',
 '身份锚必须每图亲写':'文生图身份锚须按事实写明；图生图未变发型指图保留',
 '每名词≤1修饰密度契约不变':'长修饰链宜拆句，不设每名词修饰数量硬门',
 '禁「未拔/未出鞘」否定式(必败)':'优先写完整收鞘的可观察状态，避免含糊指令',
 '手部质量句「五指完整清晰」级肯定式':'手部质量句「在场手部结构清晰」；缺失肢体按来源事实保留，完整角色才可写「五指完整清晰」',
 '## 八、光参数四要素(光型禁写)':'## 八、照明按用途与事实分配',
}
update(p,lambda t: __import__('functools').reduce(lambda s,kv:s.replace(*kv),repls.items(),t),'主体句规范取消全局光型与修饰数量硬门，区分文生图身份与编辑保留')
update(p,lambda t:t[:t.index('底座已锁光型')]+ '共同底座只统一线描与设色。设定图以均匀漫射光展示结构；剧情图按事实写时段、光源、方向、色与落点，夜景保留夜色。局部编辑保留原照明，改光任务才描述新光。透明素材不注入背景与环境底色；主体光照按交付需要描述。1009 透明消融结果仅适用于当时参数，不推成全型禁光。\n\n'+t[t.index('## 九、'):],'重写照明职责，保留透明消融证据的实验范围')
p=doc('09-')
repls={
 '②型底座+③美术风格底座+④配色行由装配自动拼':'「组装用途」明确选择：新建资产拼主体＋类型＋画法，局部编辑仅拼指令，画风转换拼指令＋画法；局部编辑默认保留原光照与构图',
 '必然走样':'会增加身份漂移风险',
 '**道劫产线取长规格文体**:一致性(跨图同源)与四层装配(①层是唯一手写变量位)都要求指令方确定性控制;短泛式仅适合无装配层的裸模板快试。':'**道劫按操作复杂度写指令**：简单换色用操作＋保留项；复杂换装或多图组合再展开规格，不为凑字重描未变属性。',
 '头身比(六至七头身)/全身入画/线描画法/多彩基底/背景山水基底/画风词全由②③④层携带——写进指令=与底座双写=漂移源(05 库五则1)':'局部编辑不拼类型句与画法；画风转换才追加画法，新建资产才追加类型布局。未变化的头身比、取景、背景与媒介指图保留',
 '**每名词≤1修饰**':'**长修饰链宜拆句（写作建议，不是模型硬门）**',
 '**发型=身份锚必写**(07 宪法§三:主体句不写发型=无人兜底)':'**发型只在本次改变时具体描述**；未变发型、脸部身份与体型指图保留',
 '## 四、写作模板(五段)':'## 四、复杂编辑参考模板（简单编辑只需操作＋保留项）',
 '2. 型选择对齐任务(人物系重绘/换装/降龄=「人物」);RGBA 三态按型自动。':'2. 先选组装用途：换色、换装与降龄用「局部编辑」，转画法用「画风转换」，重新设计资产用「新建资产」。类型和 RGBA 按实际交付选择。',
 '4. 速度档位:人物系轻编辑(换装/换细节/同主体重绘)=viggle 档;指令语义大幅偏离画布(整体替换类)或透明交付=「1 · 原生出图」;偶发黑屏=面板 seed 改数重跑,禁自动降档。':'4. 仅使用 viggle 9 步双段。透明或大变化任务失败时记录问题，不自动切换原生 40 步或其它慢档。',
 '5. **seed 每发必换**(生图铁令);PE 默认开,首跑前 `[401]` 装配预览过目终稿全文。':'5. 生产生成换 seed；控制变量 A/B 同题固定 seed 和参数。首跑前核对 `[401]` 实际终稿与用途，PE 依任务选择。',
}
update(p,lambda t:__import__('functools').reduce(lambda s,kv:s.replace(*kv),repls.items(),t),'图生图三用途、按复杂度写作、图中保身份、限定viggle验证')
insert_note(p,NOTE,'登记1016现行规范与官方配方范围')
# prefix: replace whole policy paragraphs individually, preserving unrelated identity/shoe rules.
p=M/'prefix.md'; b=json.loads((M/'json/qi21_bases.json').read_text()); style=b['art_style_base']['positive_text']
def prefixline(l):
 if l.startswith('| L1 硬约束'): return '| L1 画法约束 | 高 | 铁线描与矿物罩染；底色、饱和度与明暗服从来源事实 |'
 if l.startswith('| base |'): return '| base | 按用途和场景确定的画面底色 | 设定图可浅底，剧情图按时段 |'
 if l.startswith('| 质量锚定 |'): return '| 质量锚定 | '+style.replace('\n',' ')+' |'
 if l.startswith('| 反向规避 |'): return l.replace('硬投影, 浓重电影轮廓光, ','').replace('纸纹污渍','扫描纸纹伪影').replace('冷灰底, ','')
 if l.startswith('- **浅净平涂底**'): return '- **背景按用途**：设定图可用浅净底；剧情图保留场景与时段的明暗。宣纸白是色名，不要求实体纸纹或扫描滤镜。'
 if l.startswith('- **均匀平光**'): return '- **照明按用途**：设定图用均匀漫射光；剧情图按事实描述窗光、月光、火光及投影。局部编辑保留原光照。'
 if l.startswith('- **成片质量 ='): return '- **成片质量 = 成像清晰度**：线描与罩染层次清晰；角色和器物上的磨损、尘土与血痕按事实保留。'
 if l.startswith('- **衣物完整（'): return '- **衣物与肢体事实优先**：完整、破损、污渍、血痕、空袖和肢体缺失均按来源呈现；画法干净不等于物体崭新。'
 if l.startswith('| R3 |'): return '| R3 | 传统设色与修仙题材；宣纸白可作色名，不强制宣纸绢本纹理 |'
 if l.startswith('> 以下八把锁'): return '> 以下为现行职责。MA 原始快照保留在 `ma_sync/LOCK_SNAPSHOT.md`；2026-10-16 本地修订登记于 `runtime-contract.json#localRevision`，不再声明与外部 MA 逐字一致。'
 if l.startswith('风格底座（硬，'): return style
 if l.startswith('### 2. 工笔结构锁'): return '### 2. 工笔结构与照明职责'
 if l.startswith('线描优先工笔结构（硬）'): return '工笔结构：细稳铁线描交代轮廓与结构，矿物色分染罩染塑形；视觉焦点清楚，远景随空间退开。设定图采用均匀漫射光，剧情图按来源事实确定明暗与光源，不把浅底和平光作为全型要求。'
 if l.startswith('衣褶/裙摆（硬，全员）'): return '衣褶与裙摆按布料、动作和来源状态组织结构线，避免无意义密集褶网；来源明确的破损、缺角、碎边与动态衣褶如实呈现。'
 if l.startswith('### 5. 衣物完整锁'): return '### 5. 衣物与身体状态保留'
 if l.startswith('衣物完整性（硬，全员）'): return '衣物完整或破损、补丁、尘土、血痕、空袖，以及人物缺失肢体均服从来源事实。设定图也保持这些身份与剧情状态；不得因统一画法自动补齐或洗净。'
 if l.startswith('成片质量（硬，所有资产）'): return '成片质量：线条与罩染层次清晰，主体、材质和关键部件可读；物体的污渍与磨损服从来源事实。参考图只清成像缺陷，不清剧情事实。'
 if l.startswith('题材正文只写已核验事实,'): return '题材正文写已核验事实，不重复自动画法。必要限制优先写数量、部件状态和保留项；viggle BasicGuider 不消费负向，必需条件不能只放 Negative Prompt。'
 if l.startswith('Negative Prompt: <'): return 'Negative Prompt: <仅列本图不需要的成像伪影、错媒介或结构错误；不包含事实要求的血痕、磨损、断肢或剧情光。viggle 不消费本槽，关键条件写在正向。>'
 if l.startswith('<提示词正文：'): return '<提示词正文：按用途写自然语言；新建资产由类型层决定布局；局部编辑只写变化和未变项保留；画风转换追加目标画法。>'
 return l
line_map(p,prefixline,'全局手册收窄画法、照明、衣物状态与负向规则，登记本地运行合同修订')
insert_note(p,NOTE,'全局手册声明Qwen现行用途边界；应用300–1600是传输门非模型字数要求')
# Exact remaining legacy clauses in the scoped handbooks.
for name in ['art_prompt/art_character.md','art_prompt/art_character_derivative.md','art_prompt/art_subject_ten_types.md','json/README.md']:
 p=M/name
 def revise(t):
  t=t.replace('同一画面从左至右并排四视图','布局由所选类型句唯一决定；人物多视图采用正方形四区').replace('底座只锁浅净','底座不锁背景明暗').replace('每名词≤1修饰（连修饰拆句）','长修饰链宜拆句（不是模型硬门）').replace('透明交付走「1·原生出图」档','透明交付仍使用 viggle 9 步双段，失败记录问题，不切慢档').replace('跨区一致性锚＝同身份段逐字＋同 seed','跨区身份事实同源；同 seed 不保证身份一致').replace('画种/线条/罩染/表面工艺/平光契约','画种/线条/罩染/成像工艺；照明按用途')
  return t.split('\n',1)[0]+'\n\n'+NOTE+'\n'+t.split('\n',1)[1]
 update(p,revise,'同步用法层、布局唯一归类型、三用途与事实照明')
# Historical design library is not a production text source: mark sections explicitly.
p=doc('05-')
update(p,lambda t:t.replace('## 一、用法(四层装配·一处换句)','## 一、历史用法记录（四层装配；现行用法见页首）').replace('## 二、美术风格底座常量(供工作流恒挂层直接取用)','## 二、历史美术风格底座快照（禁止直接取用；现值见 qi21_bases.json）').replace('## 三、十型装配(','## 三、历史十型装配快照(').replace('## 四、禁混条款(五则)','## 四、历史禁混条款（现行规则见 07、08、09 篇）').replace('## 五、覆盖矩阵自检(','## 五、历史覆盖矩阵自检('),'历史底座和矩阵明确退役为记录，不覆盖现行生产规则')
insert_note(p,NOTE+'\n> 现行真源：`qi21_bases.json`、`prompt_layering.json`；本页既有长底座、四层装配和覆盖矩阵均为历史快照，不能复制到现行提示词。','现行规则与历史快照分开标识')
p=doc('08-'); insert_note(p,NOTE+'\n> 本次教材按用途保留来源事实与剧情光，不设最低字数；下方 v9–v12 的字数和实验数据为历史记录，不构成当前模型门槛。','扩写规范登记当前规则与历史版本范围')
# Official PE analyses/quotations retain their original recipes, with an explicit scope note.
for pre in ['00-','01-','02-','03-','06-']:
 p=doc(pre); insert_note(p,'> **1016 范围勘正**：本文的英文 400–500 词、约 20 句与原生步数属于官方 PE-T2I 配方或历史材料，不是 Qwen-Image-2.1 的统一输入要求。道劫现行中文自定义链按 07–09 篇执行，生成只用 viggle 9 步双段。','保留官方与历史实录，明确不套用到道劫当前链')
# Discovered reference page, kept as an official recipe reference.
p=next((ROOT/'docs/comfyui-kb').rglob('Qwen-Image-2.1-文生图.md')); insert_note(p,NOTE,'参考页说明官方配方和道劫用途边界')
p=ROOT/'.agents/skills/qwen-image-2-1-prompter/SKILL.md'
replace(p,'The descriptive prose is **always in English**, regardless of user input language.','When reproducing the **official PE-T2I recipe**, descriptive prose is English. For direct prompts and the Daojie custom chain, follow the user language (Chinese is supported).','技能语言规则限定官方配方，支持道劫中文')
replace(p,'Exactly one long paragraph (~20 sentences, ~400–500 words),','For the official PE-T2I recipe only: one long paragraph (~20 sentences, ~400–500 words),','官方PE长度不泛化为模型硬门')
insert_note(p,'> Daojie custom-chain override (2026-10-16): choose new asset / local edit / style transfer explicitly. Local edits use only operation and preservation instructions; style transfer adds the target drawing language. Source wear, blood, limb state and scene lighting take priority. Prompt length follows complexity; do not pad to the PE recipe. Use only viggle 9-step two-stage validation.','技能同步三用途、事实优先和验证档位')
p=ROOT/'.agents/skills/qwen-image-2-1-prompter/references/t2i_rules.md'; insert_note(p,'> Scope: the following is the official PE-T2I rewriting recipe, retained for faithful reproduction. English and 400–500 words are recipe choices, not diffusion-model input requirements. Daojie custom prompts follow the user language and complexity.','官方原文保留并声明适用范围')
p=ROOT/'.agents/skills/qwen-image-prompt-en/SKILL.md'
replace(p,'**Write descriptive prompts in English**, whatever language the user speaks.','**Follow the requested language** for direct prompts; Chinese is supported. Use English when explicitly requested or reproducing the official PE-T2I recipe.','通用技能取消强制英文')
replace(p,'Draft the prompt in English.','Draft the prompt in the requested language, with length matched to complexity.','技能起草步骤语言与任务一致')
insert_note(p,'> Daojie (2026-10-16): new assets may combine subject, type and drawing style; local edits preserve the input style, layout and lighting unless explicitly changed. Style transfer adds drawing language while preserving source facts. The official PE length recipe does not impose a minimum length.','通用技能同步用途与保留规则')
print('documentation updated')
