"""Register returned181-200 evidence audit once after main80-input identity check."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(181,201):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];fp=Path(z['path']);raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   q=cd[n]['files'][role];assert q['path']==z['path'] and q['sha256']==h and len(raw)==z['bytes']==q['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(fp.absolute()),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='af9455b64c637d32806af474f5f59f45f783161f78da4e5f0cc2009cd2789a56',digest
rows=[
(181,12,36,420,4091,14,'弃修机关臂先做锅、草根称谓已修；重聚、名册木牌交接、半日与同夜及药圃转场待核'),
(182,12,39,450,4099,14,'猎物拖回、跌打药暂缺、收剑后料理已修；首句铁锅指代、人物重聚、灵气与教学年限待核'),
(183,12,42,480,4105,14,'出猎因果、家事围祠、断链、留药时间与西北改道已修；铜钱数、离梁报讯、灵气状态待核'),
(184,12,42,480,4111,13,'折寿代价、赠水及第二场风暴落实对白；境界、启蜡与185完封、沙脸至回营待核'),
(185,12,41,470,4117,12,'挑焦皮、劝郁吃鱼与后续分鱼保留；小熊身份、草饼有无、蜡封与用水时距待核'),
(186,12,38,418,4123,12,'阿铁身世口述、气海主观短暂变化已修；治疗水量、会合地点、老李身份、境界与封气待核'),
(187,12,39,393,4129,12,'跟班未跨门槛、追踪印记提醒先后已修；188赠物未交接、季节时距、黄牙身份待核'),
(188,12,38,381,4135,13,'绑回背刀→徒手迎狼→收紧刀带已修；阿铁赠物、日距方向、刀上狼血与徒手击狼张力待核'),
(189,8,31,334,4143,11,'攥拳及反震担忧先于浸臂，保留有限进展；标题、阿铁经历、黄牙身份、日距与伤势待核'),
(190,10,33,345,4151,12,'攥碗停顿、放碗起身及十六天跨章间隔保留；入驿顺序、消息来源、妖丹取得与气机外露待核'),
(191,12,38,416,4159,12,'合眼→避额伤照顾→呼吸稍稳已修；柴刀断剑、此前幻术、192人数重聚与伤情待核'),
(192,9,32,325,4167,12,'拦手取剑、归字分工及拓印记录拆镜已修；重聚、十七人与四人、兵器交接、人影身份待核'),
(193,12,46,522,4177,13,'宣令、老李／翠娘／阿铁、收殓、告示与取四砖均续修；194临终交刀冲突、孩子去向与死亡时间待核'),
(194,10,41,450,4185,12,'试刀、报警未全阻断、四砖与双刻字、五石取物已修；193临终交刀、物件交接与人物伤情待核'),
(195,12,45,492,4193,13,'塔规、前三层六枚、外援、破墙和十二枚总额已修；押金净额、三十枚突入、重聚及肩伤待核'),
(196,10,51,525,4203,12,'死人坑、断杖交接、扶巫及众人前行已修；单臂调度、灵石账、游鸦／酆归队与箭伤待核'),
(197,9,50,530,4213,12,'旧夹伤、钉尾解弹、麸饼前置与巫走位已修；麸饼硬度、猎笼、人员伤情和198重聚待核'),
(198,9,56,569,4223,11,'水囊递接、三日及一天两夜组接已修；伤手操作、物资炉期、酆去向及199地点时间待核'),
(199,10,54,554,4235,12,'三幻境与空镜、短管顺序、施术代价、撤离及匕首接力已修；“你……”归属、镜数、重复拾管、断后及200时距待核'),
(200,10,72,758,4251,11,'报价演练、纸石考问、陶碗→掌中三石、三包归灰布→取第一块及导演63镜引用已修；木牌残角包石、201石数及卖匕决定、199—200时间待核')]
report=r/'fr-history-evidence-181-200-20261110.md';fresh=r/'fr-history-181-200-mainfresh-20261110.json';assert not report.exists() and not fresh.exists()
text='''# 第一卷181—200历史证据对账（2026-11-10）

只读探子 `/root/fr_history_181_200` 返回；主代理点验181、193／194、200最后交接记录，并亲核80输入当前SHA。20章都应沿用现稿及已实施局修；限定范围未见绑定当前SHA的全文独审＋修后主fresh闭合链，不能登记内容验收完成。缺证据不证明稿件错误；本批历史对账已完成，不重复扫或跑旧repair。

限定顶部80份Markdown＝60三稿＋20source-map，无补表／汇编／试排件。当前执行入口均为现有三稿，旧初稿镜数预算不叠加、不回退。探子最终只读Python检查exit 0：80源／稿SHA匹配baseline，60三稿路径／SHA／bytes匹配current，三稿单元编号／标题／预算一致，分镜连续、单镜5—15秒、单元与全章求和及头部明确数字通过。前两次探针因187头部无镜数、192起时长列位置变化失败，读取实际格式修正后通过，稿件未变。

主代理本轮80／80输入匹配，详见 [主输入核验](fr-history-181-200-mainfresh-20261110.json)。digest为 `af9455b64c637d32806af474f5f59f45f783161f78da4e5f0cc2009cd2789a56`；UTF-8每行 `chapter<TAB>role<TAB>absolute_path<TAB>sha256<TAB>bytes<LF>`，章181→200，角色source→screenplay→director-plan→storyboard。

|章|当前单元／镜／秒|最新续核与源图出处|沿用与待核|
|---|---|---|---|
'''
for n,u,shots,seconds,line,sm,note in rows:text+=f'|{n}|{u}／{shots}／{seconds}|volume-one-resume-1102.md:{line}；chapter{n:03d}-source-map-1103.md:{sm}|{note}|\n'
text+='''
主点验补充：探子200条目引用4249行；主进一步读4251行，确认更后的200—201接续已补三块分别包好收进灰布、再取第一块，并更正导演第63镜引用。现稿SHA仍与本轮指纹一致，必须一并沿用；不是再做这些修复。193／194的临终、守尸与交刀冲突仍为原文未裁，不擅自补桥。

上述仅是历史证据及静态结构对账，不冒称20章全文语义重审。下一步补当前全文独审和其后主fresh，跨章疑点有据核验。TTS、桌读、动态、观众及生产未验。
'''
backup=r/('fr-audit181-200-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
report.write_text(text);fresh.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'digest_format':'chapter TAB role TAB absolute_path TAB sha256 TAB bytes LF; source,screenplay,director-plan,storyboard','inputs':inputs,'additional_execution_files':[],'reviewer':'/root/fr_history_181_200','main_point_checks':['volume-one-resume-1102.md:4091','volume-one-resume-1102.md:4177','volume-one-resume-1102.md:4185','volume-one-resume-1102.md:4249','volume-one-resume-1102.md:4251','chapter200-source-map-1103.md:11'],'boundary':'Main current identity and selected historical claims only; no repeated full semantic review or production validation.'},ensure_ascii=False,indent=2)+'\n')
for n,u,shots,seconds,line,sm,note in rows:cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit='fr-history-evidence-181-200-20261110.md',evidence_audit_scope='60 drafts,20 source maps and relevant volume sections; no full current semantic review.',historical_execution_metrics={'units':u,'shots':shots,'seconds':seconds,'source':'fr-history-evidence-181-200-20261110.md','not_content_acceptance':True},next_action='Reuse current revisions; complete missing full content review and main fresh. Do not repeat historical audit or repair scripts.')
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(181,201)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='24 reusable chapters (001-011,013,259-270).012 targeted repair active. History001-200 registered; next history201-220. Skip closed unchanged work.';p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|181—200历史证据|对账完成；主80/80输入SHA匹配，200最后灰布交接及导演63镜更正一并沿用|[对账报告](research/fr-history-evidence-181-200-20261110.md)、[主指纹核验](research/fr-history-181-200-mainfresh-20261110.json)|缺当前全文独审链；现有三稿与定点修订保留，不重扫本批；下批201起|\n'+anchor)
old=next(line for line in s.splitlines() if line.startswith('当前24章可复用（'));s=s.replace(old,'当前24章可复用（001—011、013、259—270）。013定点独审、主fresh已闭合；012两组P2由 `/root/fr012_targeted_repair` 独占局修，随后不同审阅者复核及主fresh。历史001—200已对账登记，下批201—220。已闭合章与已对账批次跳过，不重复全审或修复。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('001—180章历史证据对账完成','001—200章历史证据对账完成',1).replace('历史对账001—180已完成登记','历史对账001—200已完成登记',1).replace('181—200历史对账已返回待主落账','181—200历史对账及主80/80输入核验已登记',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('001—180历史证据对账也已落盘','001—200历史证据对账也已落盘',1).replace('181—200历史对账已返回待主落账','181—200历史对账及主80/80输入核验已登记，下批201—220',1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:24 reusable chapters (001-011,013,259-270).012 targeted repair active then different independent reviewer/main fresh. History001-200 registered; latest80/80 identity matches,200 final cloth handoff and director63 correction retained. Next history201-220; skip completed work.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'checks_passed':80,'protected_80_digest':digest,'historical_audit_through':200}))
