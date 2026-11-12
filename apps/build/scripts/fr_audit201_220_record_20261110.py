"""Register201-220 historical evidence once; main verifies80 current inputs."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(201,221):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];fp=Path(z['path']);raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   q=cd[n]['files'][role];assert q['path']==z['path'] and q['sha256']==h and len(raw)==z['bytes']==q['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(fp.absolute()),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='560688b276c836d3af7b9d426d8ae55bc5545d3153f57ba7b0d2afeaa9d504f8',digest
rows=[
(201,10,44,475,'4253、4255','12','囚禁日数、记账买家、脚步先于活祭品、拾炭与念笼号已修；同伴缺药与数月囚禁、转笼上钉、石数和匕首待核'),
(202,10,42,460,'4257、4259','11','女孩与取水孩子分开、先发声再制止、撕书次序及残纸入水已修；转牢、铁栏破损、卷宗知情待核'),
(203,10,37,410,'4261','12','老剑修仅墙外听闻、踢入断剑、毒伤及死亡后果已修；场次、连胜、重伤与转送时序待核'),
(204,9,32,350,'4263','11','七夜标为梦境序次、伸手停空中已修；现实时间、食水、灯灭后灯苗、棋手及母死因待核'),
(205,10,38,410,'4265、4267','12','一拳碎锁、囚徒受伤、独自脱逃、渠底铁片及鼠后吞咽次序已修；锁体连接、食水伤情、三气与敲击来源待核'),
(206,10,61,730,'4275、4277','14','苏的经历和风险对白、炼气三层、半饼放墙根石上再折返取已修；铜铃、三日跟踪、鲁会合、日夜矛盾待核'),
(207,10,57,657,'4285、4287','14','夺身与左掌、身世主观性、铁牌挂回、硬饼与转北坡先后已修；刀回收、无火／火光、左右伤手和饼渣来源待核'),
(208,10,68,806,'4299','15','识海／现实声、伏兵先于第一声、独耳尤视点、饼留石上再取已修；161／162旧事、唯余三天、份量与鬼体触物待核'),
(209,10,87,1044,'4309','14','尸身玉简主观记忆、逐人刻字与伤臂、收内袋和警报次序已修；四层恢复、公开苏姓名、来源与饼待核'),
(210,10,112,1344,'4325','12、14','树记与地线分开、传讯线绕行、追魂符反应、水囊抛还及傍晚远望已修；春末到初秋数月、鬼体、伤情与路程待核'),
(211,10,89,1068,'4345','12','15人入峡、阿鸢右手扶人、晏只顿半息及三气主观反应已修；死亡清点、施针者、伤臂和鬼体能力待核'),
(212,10,72,860,'4365','13','沈离会、折痕、回望三禁制及茶盏与损耗顺序已修；统计口径、缺完整提问、下月与开春行动关系待核'),
(213,10,48,565,'4377','13','游先门外说话后入铺、靠近再压声、兵器柄木雕与墙脸异象先后已修；武器、人数、鬼体、衣摆与三气机制待核'),
(214,10,57,684,'4391','12、14','二十块离庙→送刀柄→威胁、众人应是与不准说不已修；不拍取钱收刀、不算三成，时季／分账／流民待核'),
(215,10,70,840,'4407','13','街民反应、示众与刀尖停顿已修，退供奉仅命令；十二颗是否含头目、旁观者伤亡、兵器与流民待核'),
(216,10,89,1044,'4427','12','三线三规则、收刀、名单与出洞省略已修；人数、千丈洞动线、七天、刀具及粮药结算待核'),
(217,10,69,697,'4439','13','木梳入怀、先查供词、矿车归来及封街清点仅命令已修；剑气、日期、义肢左右、木雕及站位待核'),
(218,10,111,1220,'4453','13','石梳入暗袋、挡风拢灰、刻名与眼线迟归旁白已修；木雕、义肢、碑、道士身份／消息和效果待核'),
(219,12,144,1483,'4473','13','五人回应、金币、起身腿麻、门口三星及识海声已修；留守人数、死因、首级、帮名和220星变时空待核'),
(220,12,144,1440,'4485','11、13','押送消息归游转述、众人提议未执行、先今晚不追再明早决定已修；被押者未救，剑／井／伤亡口径、星变与221季节七夜待核')]
report=r/'fr-history-evidence-201-220-20261110.md';fresh=r/'fr-history-201-220-mainfresh-20261110.json';assert not report.exists() and not fresh.exists()
text='''# 第一卷201—220历史证据对账（2026-11-10）

只读探子 `/root/fr_history_201_220` 返回。20章均沿用当前三稿和已实施局修；限定范围未见绑定当前SHA的全文独审＋修后主fresh闭合链，不能登记内容验收完成。本批历史对账完成，缺证据不证明稿件错误，不重复扫本批或重放repair。

限定顶部80份Markdown＝60三稿＋20核源底稿，无补表／汇编／试排件；当前执行入口均为三稿，旧预算不叠加、不回退。跨章续接尾段已纳入，尤其201:4255、202:4259、206:4277、207:4287。原进度independent_review仍为not_verified_this_run，较新续核明确不等于独立逐句审校。

探子只读Python探针exit 0：80源／稿SHA匹配baseline，60三稿路径／SHA／bytes匹配current，三稿单元编号／标题／预算一致，分镜编号连续、单镜5—15秒、单元／全章求和与头部明确数字通过；结束时80输入SHA／bytes未变。主代理另亲核80／80输入并点验4255、4277、4391、4485行，见 [主输入核验](fr-history-201-220-mainfresh-20261110.json)。

聚合SHA `560688b276c836d3af7b9d426d8ae55bc5545d3153f57ba7b0d2afeaa9d504f8`；UTF-8每行 `chapter<TAB>role<TAB>absolute_path<TAB>sha256<TAB>bytes<LF>`，201→220，角色source→screenplay→director-plan→storyboard。

|章|当前单元／镜／秒|最新续核与源图出处|沿用与待核|
|---|---|---|---|
'''
for n,u,shots,seconds,line,sm,note in rows:text+=f'|{n}|{u}／{shots}／{seconds}|volume-one-resume-1102.md:{line}；chapter{n:03d}-source-map-1103.md:{sm}|{note}|\n'
text+='\n只支持历史对账登记及沿用已有修订；未作20章全文语义重审、TTS、桌读、动作排演、动态、观众或生产验收。下一步补当前内容独审及其后主fresh，跨章疑点有据核验。\n'
backup=r/('fr-audit201-220-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
report.write_text(text);fresh.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'digest_format':'chapter TAB role TAB absolute_path TAB sha256 TAB bytes LF; source,screenplay,director-plan,storyboard','inputs':inputs,'additional_execution_files':[],'reviewer':'/root/fr_history_201_220','main_point_checks':['volume-one-resume-1102.md:4255','volume-one-resume-1102.md:4277','volume-one-resume-1102.md:4391','volume-one-resume-1102.md:4485'],'boundary':'Main input identity and selected historical claims; no full semantic review or production acceptance.'},ensure_ascii=False,indent=2)+'\n')
for n,u,shots,seconds,line,sm,note in rows:cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit='fr-history-evidence-201-220-20261110.md',evidence_audit_scope='60 drafts,20 source maps and latest relevant volume sections including cross-chapter tails; no full semantic review.',historical_execution_metrics={'units':u,'shots':shots,'seconds':seconds,'source':'fr-history-evidence-201-220-20261110.md','not_content_acceptance':True},next_action='Reuse current revisions; complete missing full content review and main fresh. Do not repeat historical audit or repair scripts.')
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(201,221)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='25 reusable chapters;014/015 read-only content reviews active. History001-220 registered; next history221-240. Skip unchanged completed work.';p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|201—220历史证据|对账完成；主80/80输入SHA匹配，跨章尾段的最新局修沿用|[对账报告](research/fr-history-evidence-201-220-20261110.md)、[主指纹核验](research/fr-history-201-220-mainfresh-20261110.json)|缺当前全文独审链；现稿不重做，旧预算不叠加；下批221起|\n'+anchor)
old=next(line for line in s.splitlines() if line.startswith('当前25章可复用（'));s=s.replace(old,'当前25章可复用（001—013、259—270）。014／015分别由 `/root/fr014_full_review`、`/root/fr015_full_review` 只读全文审阅，当前无稿件写入者。历史001—220已对账登记，下批221—240；已闭合章及已对账批次跳过，只有输入变化或新具体发现才定点重开。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('001—200章历史证据对账完成','001—220章历史证据对账完成',1).replace('历史对账001—200已完成登记','历史对账001—220已完成登记',1);anchor='第一卷整体及第二卷仍未完成。';s=s.replace(anchor,'当前014／015只读全文审阅在途；201—220历史对账及主80/80输入核验已登记；第一卷整体及第二卷仍未完成。',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('001—200历史证据对账也已落盘','001—220历史证据对账也已落盘',1).replace('当前无在途执行，下一步014／015内容审阅和201—220历史对账','当前014／015只读内容审阅在途，201—220历史对账及主80/80输入核验已登记，下批221—240',1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:25 reusable chapters (001-013,259-270).014/015 read-only content reviews active. Historical001-220 registered; latest80/80 input hashes match, cross-chapter final revisions retained. No manuscript writers. Next history221-240; skip completed work.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'checks_passed':80,'protected_80_digest':digest,'historical_audit_through':220}))
