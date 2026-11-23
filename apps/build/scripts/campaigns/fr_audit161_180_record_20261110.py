"""Register161-180 returned historical evidence audit after main input checks, once."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text())
bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(161,181):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role]
  fp=Path(z['path']);raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   q=cd[n]['files'][role];assert q['path']==z['path'] and q['sha256']==h;assert len(raw)==z['bytes']==q['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(fp.absolute()),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest()
assert len(inputs)==80 and digest=='38276ad54882c33c19a7585ac9ca58113d688fab575b0e62c9d6dbbb796696d8',digest
extras_text='''chapter161-capture-arrival-1110.md e9d8cb6857737b7f3a1decd6e8694887521daa3cf8cfdf171053fac8c1a14295
chapter161-escape-trace-1110.md ead2365db98925b2a81274e2fdb1bfd5dba184e5b6df8cc1a1909a86828efa72
chapter161-first-meeting-insert-1110.md 40a8d312c67b07369ecde9e6baae860709c8350ee2bf80b2755d6d626b37e76e
chapter161-integrated-60-shots-1110.md 8719a445842e4b0255beac71568b250a9f931b700c06ef7bd9fc42d605081a11
chapter161-integrated-66-shots-1110.md 2f6521c3f9f01d37aeb66f54809d875c20c20b85117d22e593543690917cad2a
chapter161-integrated-71-shots-1110.md f1190a4cc108b93565ba74fe394926436376c47e3eed84bf5666df295a624b22
chapter161-integrated-76-shots-1110.md 728c4c1fe292cb5d58e99999f3a698e2c84b42ee2fca95b2bf99960869941e4e
chapter161-memory-oath-continuity-1110.md fd55b8835a764517bf5764748b67af2c4f95d6f2ac3ddab4b501e7c3a4bc05ed
chapter161-third-night-promise-1110.md 8b27c5924bf91a88c6108ced09f7b456935778f4b4e89a61a42ace7be46dbdb6
chapter161-veteran-last-choice-1110.md fa59ad99f99ab2b7958dc8ee2b469ac81a85915bc27126d42ba12a7a4b9546aa
chapter166-195-source-mapping-1110.md 2adcc3e741117256e0943597f4d329036e4b68f150bc1855e66356eae10b2128
chapter166-195s-trial-1110.md e5d77a06a0080c80ef09d300f96824276e50e25c05a479f4a608aeb7417d14de'''
extras={}
for line in extras_text.splitlines():
 name,want=line.split();fp=r/name;raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==want,name
 extras[name]={'path':str(fp),'sha256':h,'bytes':len(raw)}
rows=[
(161,14,76,920,'chapter161-polished-storyboard-1103.md:128；chapter161-integrated-76-shots-1110.md:5','76镜920秒最新汇编替代旧表，不叠旧49镜630秒；十息、余气、柱体、狗子、站位及162接续待核'),
(162,12,46,586,'chapter162-source-map-1103.md:24','送画、画道与刻花记忆修订沿用；持画、过溪与跨章待核'),
(163,12,48,607,'chapter163-source-map-1103.md:20','购药代价、柜台问答与东南路线沿用；读时与跨章待核'),
(164,12,39,515,'chapter164-source-map-1103.md:21','三月期限及两东一西分水已修；“天道有缺，我来补”未承载且归属未明待核'),
(165,10,53,685,'chapter165-source-map-1103.md:31','七国、田埂回忆、眼伤、声音与盐粒沿用；交易时点待核'),
(166,10,56,740,'volume-one-resume-1102.md:5466；chapter166-195s-trial-1110.md:3','主长稿740秒保留；另19镜195秒试排及20组源映射不覆盖、不相加；入矿、拾剑、重聚与取舍待核'),
(167,12,59,785,'chapter167-source-map-1103.md:44','已修声部、原话、旁白及增镜沿用；越缝两句说话人、经过及跨章待核'),
(168,10,31,410,'chapter168-source-map-1103.md:13','赠水与缺水、师父生死、肩伤矿期及断剑时序待核'),
(169,12,38,520,'chapter169-source-map-1103.md:13','鲁处境、伤手方向及村关系待核'),
(170,11,33,460,'chapter170-source-map-1103.md:13','20余／37人、四／五天、采叶主语及离村待核'),
(171,11,34,455,'chapter171-source-map-1103.md:14','玄武城转述与风险两面沿用；离村绕行、重聚及女孩时距待核'),
(172,12,37,523,'chapter172-source-map-1103.md:15','纸鸢线沿用；女孩身份、眼睛、材料、昏醒及重扎待核'),
(173,12,38,505,'chapter173-source-map-1103.md:13','标题、人数、时距、天气及游踪迹待核'),
(174,12,37,468,'chapter174-source-map-1103.md:13','水囊交接适配沿用；追踪七日、行程与物资待核'),
(175,12,37,517,'chapter175-source-map-1103.md:14','五国发言者视角沿用；齐秦履历、剑鞘与物资接续待核'),
(176,13,41,540,'chapter176-source-map-1103.md:15','天气、村落、蚂蚱位置、伤侧、两年及挖布接续待核'),
(177,13,41,538,'chapter177-source-map-1103.md:14','独孤生死及同行、217人物骰局、食物与聚散待核'),
(178,14,44,578,'chapter178-source-map-1103.md:15','场景、工钱、311动机、缺对白及丝去向待核'),
(179,15,46,630,'chapter179-source-map-1103.md:15','牢笼儿童数量、重聚、火兽吼与180时序待核'),
(180,12,39,443,'chapter180-source-map-1103.md:13','十日／三日／半月、游去向、暗号、阵法与名册待核')]
report=r/'fr-history-evidence-161-180-20261110.md';fresh=r/'fr-history-161-180-mainfresh-20261110.json'
assert not report.exists() and not fresh.exists()
text='''# 第一卷161—180历史证据对账（2026-11-10）

只读探子 `/root/fr_history_161_180` 返回；主代理已点验161最新汇编头尾及入口、164未承载记录、166试排及续接记录，并亲核当前80份输入和12份补件指纹。20章均缺当前SHA全文独审＋修后主fresh闭合链；已有修订沿用，缺证据不等于稿件错误。此批历史对账完成，不应重复扫同批或重放旧修复。

探子限定检查92份Markdown（60三稿、20source-map、12补件）。其最终只读探针exit 0：80源／稿SHA匹配基线与当前台账，60稿字节数一致，20章基础结构、镜序、分拍和总秒检查通过；另核161最新76镜连续时码、直接输入指纹及166试排19镜195秒。首轮180末列时长解析不兼容，读取表头修正探针后通过，未改稿。

主代理本轮80／80输入匹配，并核12补件SHA；详见 [主输入核验](fr-history-161-180-mainfresh-20261110.json)。本批摘要序列每行是 `chapter<TAB>role<TAB>absolute_path<TAB>sha256<TAB>bytes<LF>`，角色顺序source→screenplay→director-plan→storyboard；digest `38276ad54882c33c19a7585ac9ca58113d688fab575b0e62c9d6dbbb796696d8`。该格式包含bytes，不与前批无bytes摘要混用。

|章|当前单元／镜／秒|最新依据|沿用与待核|
|---|---|---|---|
'''
for n,u,shots,seconds,evidence,note in rows:text+=f'|{n}|{u}／{shots}／{seconds}|{evidence}|{note}|\n'
text+='''
161以76镜920秒汇编为当前执行件；60／66／71镜及其他补件是历史或支持材料，不再相加。旧60镜表的基础SHA与当前不同，不能据此回退当前稿。166以56镜740秒长稿为主，195秒试排和映射另记支线；source-map中的旧78b1指纹不是当前试排，续接记录与当前e5d77指纹一致，试排时点已改时间未明。

上述待核是历史记录或接续疑点，不自动判定当前稿错误。下一步仅补当前全文内容审阅及其后主fresh，并定点核跨章证据。TTS、动态、观众及生产均未验，195秒试排不等于内容或生产通过。
'''
backup=r/('fr-audit161-180-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
report.write_text(text)
fresh.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'digest_format':'chapter TAB role TAB absolute_path TAB sha256 TAB bytes LF; source,screenplay,director-plan,storyboard','inputs':inputs,'additional_artifacts':extras,'reviewer':'/root/fr_history_161_180','main_point_checks':['chapter161-polished-storyboard-1103.md:128','chapter161-integrated-76-shots-1110.md:5','chapter164-source-map-1103.md:19','chapter166-195s-trial-1110.md:3','chapter166-source-map-1103.md:38','volume-one-resume-1102.md:5466'],'boundary':'Main current identity and selected historical claims only; no repeated full semantic review. Supplementary files retain execution versus historical/trial roles.'},ensure_ascii=False,indent=2)+'\n')
for n,u,shots,seconds,evidence,note in rows:
 cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit='fr-history-evidence-161-180-20261110.md',evidence_audit_scope='Chapter reports and relevant volume sections plus12 supplementary documents; no current full semantic review.',historical_execution_metrics={'units':u,'shots':shots,'seconds':seconds,'source':'fr-history-evidence-161-180-20261110.md','not_content_acceptance':True},next_action='Reuse current revisions and execution artifacts; complete missing full content review and main fresh. Do not repeat historical audit or repair scripts.')
cd[161]['current_execution_artifacts']=[extras['chapter161-integrated-76-shots-1110.md']]
cd[161]['historical_support_artifacts']=[v for k,v in extras.items() if k.startswith('chapter161-') and k!='chapter161-integrated-76-shots-1110.md']
cd[166]['alternative_trial_artifacts']=[v for k,v in extras.items() if k.startswith('chapter166-')]
cd[166]['alternative_trial_metrics']={'shots':19,'seconds':195,'main_long_draft_seconds':740,'additive':False,'production_acceptance':False}
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(161,181)))
c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='23 reusable chapters (001-011,259-270). History001-180 recorded. Next content012/013 and history181-200; skip completed unchanged work.';p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1
s=s.replace(anchor,'|161—180历史证据|对账完成；主80/80输入及12补件SHA匹配，161最新76镜与166试排身份分开登记|[对账报告](research/fr-history-evidence-161-180-20261110.md)、[主指纹核验](research/fr-history-161-180-mainfresh-20261110.json)|缺当前全文独审链；161只审最新执行稿，166长稿740秒与195试排不相加；下批181起|\n'+anchor)
old=next(line for line in s.splitlines() if line.startswith('当前23章可复用（'))
s=s.replace(old,'当前23章可复用（001—011、259—270）。011四项局修、不同审阅者定点独审及主fresh已闭合；历史对账001—180已登记，161最新76镜执行件及166另支195试排均记录身份。当前无稿件写入者；下一步012/013全文内容审阅与181—200历史对账。已闭合章与已对账批次跳过，不重复全审或修复。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('001—160章历史证据对账完成','001—180章历史证据对账完成',1).replace('历史对账001—160已完成登记','历史对账001—180已完成登记',1).replace('161—180历史对账已返回待主核验落账','161—180历史对账、主80/80输入及12补件SHA已登记',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('001—160历史证据对账也已落盘','001—180历史证据对账也已落盘',1).replace('161—180只读对账已返回待主核验落账','161—180历史对账、主80/80输入及12补件指纹已登记；下一批181—200',1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:23 reusable chapters (001-011,259-270);011 independently reviewed and main fresh exit0. History001-180 registered; latest80/80 inputs and12 supplements match.161 uses76-shot execution,166 long740s and alternative195s tracked separately. Next content012/013 and history181-200. Skip completed work.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'checks_passed':80,'supplementary_hashes_matched':12,'protected_80_digest':digest,'historical_audit_through':180}))
