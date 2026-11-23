from pathlib import Path
import json, hashlib, shutil
from datetime import datetime, timezone
T=Path('.trellis/tasks/10-27-script-narrative-translation-cure'); R=T/'research'
reports={
24:'''# 第024章全文独立内容审阅（2026-11-11）

审阅者 `/root/fr024_full_review`，只读终报由主会话登记。pass=false，P1=0、P2=1组、P3=2组（其中声画顺序4点）。本次登记时主会话尚未定点核实，不将审阅者结论伪装为主fresh。

## 阅读与静态边界

完整阅读原著420行/206正文段，剧本838行、导演902行、分镜93行，各47单元；另完整阅读 `chapter024-shot-breakdown-1105.md` 287行/200镜。邻章只定点核023:179—241、025:1—23。只读静态命令exit0：三稿470项字段一致，47单元1366秒，五场565/293/230/115/163；200镜试排1781秒，每镜6—10秒。两套预算不相加。85明确发声：独孤42、晏29、旁白9、晏心声3、鲁1、灰役1。

## 待主核实的发现

1. P2：错误把本章昼鸣回忆改成昨夜。原著53清晨断剑极低震响，315明写“白昼里那声剑鸣又在耳边一震”。剧本532“记忆中的昨夜剑鸣”、536/825以同前章夜鸣冲突作理由；导演630/634/883、分镜45/74同。导演29“全章只有前章剑鸣的短记忆”同样遗漏本章导演115—118和试排30已经承载的清晨铁震。
2. P3声画顺序四处：原著81“绕远才能活命”→剧咳→“先离开五十里迷障”，试排38/镜28先咳、39/镜29才说整句；原著151撑身肩渗血→停三息咽回血气→153“大约两年”，试排100/镜68撑身时已说两年、101/镜69才停三息（剧本228—231仍正确）；原著237“实在跑不掉…”→239推棍半尺抬头→晏复述，试排161/镜116在“跑，往灵气紊乱…”已推、162/镜117才说跑不掉；原著389“松手”→391松不开→393扣后领拽出，试排259/镜187动作串先抽不出/扣后领、声音另列松手，278覆盖说明“说话并扣后领往外拉”，未锁三拍。
3. P3过隙竞争口径：导演23总调度鲁→巫→晏→独孤；导演902引用最新试排，但试排278采用巫出后独孤先到外侧回身拉晏的假设。须标明最新假设对旧顺序的覆盖，保留“调度假设、非原著事实、待排演”。

## 保留源文未明

023尾已起/024晨仍睡；旧屋基精位、州国几何、独孤出隙时点、鲁与棍同过、025鞋时点，不编桥。200镜映射已经存在，不重造另一套。TTS、素材、动态走位、观众与生产195秒均未验。

## 终报输入SHA

source 45c51403e2ef912e262679f5a852ac15525a25ffdf2376828a77f64981453606
screenplay 13cd13eb439ba2483716f6305f54c3ad55189df8824e5046e7ba955447fbb596
director-plan 1a3304022acb89933df13e832fbc47f7c64b1242f31bce7933c1913f8740fb6e
storyboard 275a4de30d479d5e35d505ba539ae53ccb174a57bd0e5349543605068c711199
trial c1c8b6bb44dcae96f9b0a3345ee3fa3d5f044102b3df6dc017faa4206d5286e1
''',
25:'''# 第025章全文独立内容审阅（2026-11-11）

审阅者 `/root/fr025_full_review`，只读终报由主会话登记。pass=false，P1=0、P2=1、P3=2。登记时主会话尚未定点核实，不代签主fresh。

## 阅读与静态核验

完整阅读原著287行/140正文段，剧本457行、导演687行、分镜94行，各36单元；另完整阅读 `chapter025-shot-breakdown-1105.md` 217行/147镜。邻章定点核24:363—419、26:1—55/155—177/285—297，未重审相邻章。只读Python最终两次exit0：36单元1029秒，140/140源段有索引映射，三稿身份/来源/时长与导演节拍一致。61发声字段=旁白24/巫5/鲁15/独孤13/晏4，共1232汉字（不含标签标点动作备注低应拟音）。试排147镜1285秒、7—10秒/镜；分句合并与剧本同说话人同序，不与1029秒相加。

## 待主核实的发现

1. P2截肢判断仅在制作说明中。原著67看膝骨、没把“截肢”说出口；69毒草勉强吊经络、否则腿恐仅余白骨。剧本103/导演187/分镜22只有看膝嘴动；两句旁白仅伤口恶化与暂吊经络。试排44明确“不说出截肢”。极端判断无观众可辨载体，须主裁有据叙述声或明确接受信息留白；不得让人物听见，不能写成已截肢或确定必须截肢。
2. P3镜20视线反序：导演379“袖破后晏看血再看槽”；剧本249、分镜32、试排109为看槽再低头看血。原著未限该新增视线，但执行稿竞争，须统一。
3. P3镜35药碗冲突：导演637“巫不动药碗”；剧本421、分镜47、试排177为巫慢慢压低药碗。须统一且保留未喂药、未施术。

## 已修内容与源缝

保留肩骨伤先于逼气顶管（剧本449/试排209）；刮断残线藏扣后低应、换木片敷药（453/213）；城心井碑及撤手→让位→膝软撑碑→撤手按胸（457/217）。未发现三色稳定融合、追兵放弃、提前认出人皇或两种铜物混同的新事实错误。

源235“刚才”/21“三日前”，213“手背”/开篇与24右掌，167残句，265城门外残碑/147—155城心井碑；26救不了第二次、昨夜挡阵、昨夜铜钉缺本章场面。三天药效与次晨移动承重未解，不编桥。真实录音/TTS、素材/口型、动作排演、动态承接、观众、生成及195秒生产门均未验。早期两次只读解析因SHA表误匹配与单行源范围exit1，改解析器后通过，未改稿。

## 终报输入SHA

四输入起止相同且匹配current/baseline：
source c7650a1be834e025b94a279f8d7c8c6bb221bde796da35628189a18d7b308808
screenplay 9c3ccccb117713d0ced3bdc095b68d82125794aa23c2e4be8994c247f7584550
director-plan 0e87d55d0cb510c708cd0e3c3ce93b815d50f2c3e50d92b081100bdb5eb2e567
storyboard f0646133e5e9287dd3e60244044540a3b7fe73f177599e49fda3e2f0e3a5edb3
试排SHA未由审阅者终报提供，主派修前须实核固定。
'''}
for ch,body in reports.items():
 p=R/f'chapter{ch:03d}-independent-full-20261111.md'
 assert not p.exists(),p
 p.write_text(body)
print('registered 024/025 independent reports; no manuscript changes')
B=R/'checkpoint-register022-025-backup-20261111'; B.mkdir(exist_ok=False)
paths=[T/'task.json',T/'offline-progress.md',T/'prd.md',R/'fr-volumes-current-20261110.json',R/'fr-volumes-resume-20261110.md']
for p in paths: shutil.copy2(p,B/p.name)
p=R/'fr-volumes-current-20261110.json'; d=json.loads(p.read_text())
for c in d['volume1']['chapters']:
 if c['chapter']==22:
  for v in c['files'].values():
   q=Path(v['path']); b=q.read_bytes(); v.update(sha256=hashlib.sha256(b).hexdigest(),bytes=len(b))
  c.update(status='postfix_independent_review_pending',writer=None,owner=None,next_action='Four targeted fixes and 138 paper windows implemented. Independent review of all changed lines/windows and primary fresh remain; do not repeat repair.')
  c['evidence'].append('chapter022-review-repair-20261111.md')
 if c['chapter'] in [24,25]:
  c.update(status='independent_findings_pending_primary_check',writer=None,owner=None,p2_groups_open=1,p3_groups_open=2,next_action='Full independent review completed and recorded; primary must verify exact findings before targeted repair. Do not repeat full review.')
  c['evidence']=[f"chapter{c['chapter']:03d}-independent-full-20261111.md"]
summary='34 reusable chapters(001-021,023,259-270);volume1 historical reconciliation complete.022 implemented awaiting independent postfix review and primary fresh;024/025 full reviews recorded awaiting verified targeted fixes. Necessary verification scripts recovery in progress;no repeat content work.'
d.update(as_of=datetime.now(timezone.utc).isoformat(),next_action=summary,verification_script_recovery={'status':'in_progress','owner':'/root/fr_verifier_recovery','scope':'24 chapter verification scripts and 2 resume/checkpoint scripts; restore exact sources only','report':'verification-script-recovery-20261111.md','content_reopened':False})
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=T/'task.json'; d=json.loads(p.read_text()); d['offlineTrack']['last_checkpoint']=summary; p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
status='当前34章闭合（001—021、023、259—270）沿用；第一卷历史证据对账全部完成，不再扫描。022四项局修及138纸面窗已完成、所有权交还，待新独立审阅者定点复核与主fresh；024/025全文独审已完成并落盘，各1P2/2P3待主定点核实后修复，不重复全文审阅。必要的26个验证/接续脚本路径缺失，正从精确会话原文恢复；原因未知，不据此重做已闭合内容。'
p=T/'offline-progress.md'; s=p.read_text(); old='当前34章可复用（001—021、023、259—270）。023三项9行局修、不同审阅者定点独审与主fresh exit0闭合，393检查/7负例通过，32声音字段与893秒保持。022由 `/root/fr022_targeted_repair` 独占局修和38段纸面分窗；024由 `/root/fr024_full_review`、025由 `/root/fr025_full_review` 全文独审。第一卷历史对账全部完成登记（001—258、271—395；259—270闭合跳过），不再重复。'; assert s.count(old)==1; p.write_text(s.replace(old,status))
p=T/'prd.md'; s=p.read_text(); lines=s.splitlines(); ids=[i for i,x in enumerate(lines) if x.startswith('> **2026-11-11 最新离线进度**')]; assert len(ids)==1; lines[ids[0]]='> **2026-11-11 最新离线进度**：'+status+' 第一卷整体与第二卷未完成。'; p.write_text('\n'.join(lines)+'\n')
p=R/'fr-volumes-resume-20261110.md'; s=p.read_text(); p.write_text(s+'\n'+status+' 本条取代上文在途快照。\n')
print('five shared records updated; closed count remains 34')
