"""Update only current character-sheet guidance, retaining dated historical snapshots."""
from pathlib import Path
import json,shutil,hashlib,re
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-full-board-1016';M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng';rows=[]
def write(p,s):
 old=p.read_bytes();new=s.encode()
 if old==new:return
 b=OUT/'doc-backups'/p.relative_to(ROOT);b.parent.mkdir(parents=True,exist_ok=True);assert not b.exists();shutil.copy2(p,b)
 assert p.read_bytes()==old;p.write_bytes(new);rows.append({'path':str(p),'backup':str(b),'before':hashlib.sha256(old).hexdigest(),'after':hashlib.sha256(new).hexdigest()})
p=ROOT/'.agents/skills/daojie-charsheet-prompter/SKILL.md';s=p.read_text()
s=s.replace('固定六区角色设定卡:主立绘+正侧背三视图+面部+腰部局部,文字色卡后期合成','完整角色设定板:主立绘+来源资料与色样+正侧背三视图+双头部近景+四格细节+底部武器/材质/装备/能力四区')
start=s.index('## 道劫 / Qwen 当前执行路由');end=s.index('## 核心定位',start)
s=s[:start]+'''## 道劫 / Qwen 当前执行路由（2026-10-16 完整设定板，优先于下文通用模板）

- 先读 `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json` 中 `zh=设定卡` 的完整类型句，不得缩为六区卡。上部左栏为主视觉、来源资料和五枚色样；上部右栏三行依次为三幅全身视图、两幅头部近景、四幅人物细节；底部左起为武器、材质、装备、能力四个专项区。各格位置与取景逐项服从真源。
- 既有工作流主体句只提供来源身份、物件及明确的能力事实；类型句与当前美术风格由工作流装配。独立完整提示词取当前类型句与风格原文，不从旧通用模板另造排版。
- 简短中文资料、视图标签与色样在完整板内生成；文字有误可后期校对。未知姓名、年龄、境界、经历和能力不得编造，能力未提供时固定能力区留空标注“能力未设定”。主体没有武器或装备时对应槽位留空，不能为填满版面造物。
- 灵兽只在来源明确时另用附板；下文通用模板中的自动特效、深色背景及扩展分区不覆盖当前道劫排版与已批准画风。主视觉、三视图、头部、细节与专项展示必须同一设计。
- 当前类型参数为 21:9、3MP、默认不透明，从数据读取，不把像素与比例写入正文。PE 只润色人物描述，完整类型句全部段落按空白归一后原文保留。同 seed 不保证跨区一致，实图仍须验收。

'''+s[end:];write(p,s)
p=M/'art_prompt/art_subject_ten_types.md';s=p.read_text();start=s.index('## §10 设定卡');end=s.index('**文生图主体句·骨架句式**',start)
s=s[:start]+'''## §10 设定卡（完整横向角色设定板）

**型格一句话**：保留完整角色资料结构，逐格指定内容；主立绘、来源资料与五枚色样、三视图、两幅头部近景、四幅人物细节，以及底部武器／材质／装备／能力四区。类型默认 21:9、3MP、不透明，参数不写入主体句。

**分区与逐格内容（执行原文唯一真源=`json/qi21_bases.json#types[zh=设定卡]`）**：

| 固定位置 | 内容与取景 |
|---|---|
| 上部左栏上方 | 主视觉全身，头顶、发饰、手脚完整 |
| 上部左栏下方 | 来源明文资料，下方横排五枚实际设色色样 |
| 上部右栏第一行左／中／右格 | 正面／纯九十度侧面／背面全身，等高、头脚对齐 |
| 上部右栏第二行左格 | 正面面部，完整头顶至锁骨 |
| 上部右栏第二行右格 | 侧面头部，头部轮廓、束发与发饰完整 |
| 上部右栏第三行第一格 | 单眼与眉形 |
| 上部右栏第三行第二格 | 束发或发饰连接 |
| 上部右栏第三行第三格 | 袖口与腕部结构 |
| 上部右栏第三行第四格 | 腰带／腰封与配器挂载连接 |
| 底部第一区 | 左完整武器；右上握柄与护手；右下鞘口与连接 |
| 底部第二区上／中／下格 | 主要衣料／腰带腰封材质／实际绑绳包边或第二衣料 |
| 底部第三区上／下格 | 实际配饰装备／该物件与身体衣装佩带的连接 |
| 底部第四区上／下格 | 来源明确的能力效果／关键形态；未提供则整区净空并标注“能力未设定” |

上部／底部高度约八成／两成，上部左／右宽约三成半／六成半。右栏三行高度为该栏六成／两成／两成；底部四区宽度四成／两成／两成／两成。每格取自身真实设计，灵兽按来源另做附板。

'''+s[end:]
s=s.replace('- 档案文字、视图标签与色卡**后期合成**；生成期固定六区，不额外生成档案区、色样区或其他人物格。','- 资料、中文标签与色样纳入完整板；仅用明文事实，文字错误可后期校正。未知能力留空标注，未知物件不为填格而增造。')
s=s.replace('（专项图单独制作，按当前六区路由使用，不自动向卡面加格）','（按当前完整设定板路由使用，灵兽另做附板，不任意改动固定区位）');write(p,s)
p=next(p for p in (ROOT/'docs/prompts').iterdir() if p.name=='道劫_类型主体句示例.md');s=p.read_text();s=s.replace('## 10. 设定卡(16:9 固定六区角色卡,1016 六区版)','## 10. 设定卡(21:9 完整角色设定板,1016 完整版)')
s=re.sub(r'^> 1016 六区版：.*$', '> 1016 完整版：主体代码块保留来源身份事实；排版全归当前类型句。恢复主视觉、来源资料与五枚色样、正侧背三视图、两幅头部近景、四幅逐格人物细节，以及底部武器／材质／装备／能力四区。能力未提供则留空标注，灵兽另附板；默认不透明、21:9、3MP。同 seed 不保证一致，须看实图验收。',s,flags=re.M);write(p,s)
p=next(p for p in (ROOT/'docs/prompts').iterdir() if p.name=='道劫_类型配方.md');s=p.read_text();s=s.replace('| 设定卡(1015 入列) | 16:9·1.5(1672×944) |','| 设定卡(1015 入列) | 21:9·3.0(2712×1160)，默认不透明 |')
s=s.replace('固定六区：四全身+面部+腰部局部；档案文字/格名/色卡后期合成；本轮实图验收见六区报告','完整设定板：主视觉/来源资料/色样/三视图/双头部/四格细节/底部武器材质装备能力四区；逐格位置取真源，待完整版实图验收');write(p,s)
p=next((ROOT/'docs/prompts/Qwen-Image-2.1').glob('05-*'));s=p.read_text();s=re.sub(r'^> \*\*1016 当前六区版覆盖说明\*\*.*$', '> **1016 当前完整设定板覆盖说明**：以下装配全文与画幅、透明口径均为历史快照，不得作为当前型文或参数复制。当前唯一真源为 `qi21_bases.json` 的 `zh=设定卡`：主视觉、来源资料和五枚色样、三视图、两幅头部近景、四幅逐格人物细节、底部武器／材质／装备／能力四区。默认 21:9、3MP、不透明；能力未提供时留空标注，灵兽另附板。六区实验已被完整板取代，旧实图不能算完整版验收。',s,flags=re.M);write(p,s)
p=M/'json/README.md';s=p.read_text();s=s.replace('道具/多视图/高清人脸/表情差分/设定卡五型 true','道具/多视图/高清人脸/表情差分四型 true；1016 完整设定卡 false');write(p,s)
(OUT/'doc-changes.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print('updated docs',len(rows))
