"""Synchronize current six-zone documentation; keep dated historical snapshots intact."""
from pathlib import Path
import hashlib
import json
import shutil
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/daojie-charsheet-six-zone-1016'
rows=[]
def change(p, pairs):
    old=p.read_text();s=old
    for a,b in pairs:
        assert s.count(a)==1,(p,a,s.count(a));s=s.replace(a,b,1)
    backup=OUT/'doc-backups'/p.relative_to(ROOT);backup.parent.mkdir(parents=True,exist_ok=True)
    assert not backup.exists();shutil.copy2(p,backup);assert p.read_text()==old
    p.write_text(s)
    rows.append({'path':str(p.relative_to(ROOT)),'backup':str(backup.relative_to(ROOT)),
        'before':hashlib.sha256(old.encode()).hexdigest(),'after':hashlib.sha256(s.encode()).hexdigest()})
p=ROOT/'.agents/skills/daojie-charsheet-prompter/SKILL.md'
route='''## 道劫 / Qwen 当前执行路由（2026-10-16，优先于下文通用模板）

- 道劫设定卡先读 `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json` 中 `zh=设定卡` 的当前类型句。固定六个图像区：左主立绘，右上正面／朝画面右侧纯侧面／背面三视图，右下面部／腰部佩挂结构两幅特写；合计四幅全身、一幅面部、一幅局部。
- 进入既有道劫工作流时只提供来源身份事实的主体句；类型句与已批准美术风格由工作流装配。用户要求独立完整提示词时，取当前类型句与风格原文装配，不从下文旧模板另造分区。
- 档案文字、视图标签和色卡后期合成；默认不增设档案图像区、表情格、武器展示格、灵兽区或特效。来源存在灵兽、武器等专项需求时单独做专项图；不得自动挤入六区。
- 下文第二、五至十、十三节中的通用大设定板模板，仅在用户明确要求通用扩展设定板时使用；“修仙”“古风”本身不触发深色背景、多格细节、自动特效或文字系统。
- 道劫画幅与透明模式从类型参数读取，不写像素或比例到提示词正文；来源色、衣装形制、身体状态与配器逐区继承。同 seed 不保证跨区身份或视角一致，必须看实图验收。

'''
change(p,[('一图多区档案卡:主视觉+三视图+特写+档案区','固定六区角色设定卡:主立绘+正侧背三视图+面部+腰部局部,文字色卡后期合成'),('## 核心定位',route+'## 核心定位')])
p=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md'
change(p,[('示例库文件名沿用「九型」历史名（2026-09-19 立），1015 设定卡入列后内含 §1–§10 **十型**例句；文档历史台账不改写，引用时认 § 节号、不认文件名数字。','示例库与配方现统一使用「类型」文件名，内含 §1–§10 十型；按日期保存的九型实验台账保留历史称谓。'),('## §10 设定卡（16:9 多区档案卡）','## §10 设定卡（16:9 固定六区角色卡）'),('**型格一句话**：一图多区角色档案卡——主视觉立绘＋正侧背三视图＋面部与细节特写＋服饰配器局部＋档案区，一卡集齐角色资产概览（1015 入十型）。','**型格一句话**：固定六区角色设定卡——左侧一幅主立绘；右上正面、朝画面右侧的纯侧面、背面三幅全身；右下面部与腰部佩挂结构两幅特写。合计四幅全身、一幅面部、一幅局部（1016 六区版）。'),('- 档案区字段文字**后期贴字**（生成期负向已压乱码与英文）。','- 档案文字、视图标签与色卡**后期合成**；生成期固定六区，不额外生成档案区、色样区或其他人物格。'),('（型层排版语言与本技能主体句写法互为配套、可叠加使用）；参考备份','（专项图单独制作，按当前六区路由使用，不自动向卡面加格）；参考备份')])
p=next(p for p in (ROOT/'docs/prompts').iterdir() if p.name=='道劫_类型主体句示例.md')
s=p.read_text();old=next(l for l in s.splitlines() if l.startswith('> 1015 设定卡入列轮:'))
change(p,[('## 10. 设定卡(16:9 多区档案卡,1015 入十型)','## 10. 设定卡(16:9 固定六区角色卡,1016 六区版)'),(old,'> 1016 六区版：主体句仍为来源身份段单段，卡面结构全归类型句。左侧主立绘；右上正面、朝画面右侧的纯侧面、背面三视图；右下面部与腰部佩挂连接结构两幅特写，共四幅全身、一幅面部、一幅局部。档案文字、视图标签与色卡后期合成，不增额外图像区；灵兽、武器展示、表情差分另做专项图。同 seed 不保证跨区身份与视角一致，须看实图验收。')])
p=next(p for p in (ROOT/'docs/prompts').iterdir() if p.name=='道劫_类型配方.md')
change(p,[('档案区字段后期贴字;特写格放大走 SeedVR2;recipe v0.1 待实弹终审','固定六区：四全身+面部+腰部局部；档案文字/格名/色卡后期合成；本轮实图验收见六区报告')])
p=next((ROOT/'docs/prompts/Qwen-Image-2.1').glob('05-*'))
change(p,[('### 设定卡-基础\n','### 设定卡-基础\n\n> **1016 当前六区版覆盖说明**：以下装配全文是历史快照，禁止作为当前型文复制。现行类型句以 `qi21_bases.json` 的 `zh=设定卡` 为唯一真源：左主立绘，右上正面／朝画面右侧纯侧面／背面三幅全身，右下面部／腰部佩挂结构两幅特写，共六区。档案文字、格名、色卡后期合成；武器、灵兽、表情专项另做，不自动加格。同 seed 不保证跨区身份一致。当前主体例句仍取《道劫_类型主体句示例》§10，当前实图结果见 `apps/output/automation/daojie-charsheet-six-zone-1016/report.md`。\n')])
(OUT/'doc-changes.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print('updated',len(rows),'documents')
