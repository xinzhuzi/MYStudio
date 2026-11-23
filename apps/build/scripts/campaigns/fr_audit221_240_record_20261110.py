"""Register221-240 returned historical audit once; main verifies80 input identities."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil,re
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(221,241):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];fp=Path(z['path']);raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   q=cd[n]['files'][role];assert q['path']==z['path'] and q['sha256']==h and len(raw)==z['bytes']==q['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(fp.absolute()),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='8c66095dae0b92d95ec92c728df9ec2c863ce2a9e26e4cbca86e7b277fda900c',digest
names=sorted(fp.name for fp in r.iterdir() if fp.is_file() and re.match(r'^chapter(22[1-9]|23[0-9]|240).*\.md$',fp.name));expected=sorted([Path(bd[n]['files'][role]['path']).name for n in range(221,241) for role in ['screenplay','director-plan','storyboard']]+[f'chapter{n:03d}-source-map-1103.md' for n in range(221,241)]);assert names==expected
rows=[(221,12,119,1193,4493),(222,10,146,1460,4511),(223,12,156,1560,4529),(224,12,175,1750,4551),(225,12,172,1538,4575),(226,10,116,1051,4595),(227,10,114,1020,4615),(228,12,132,1187,4639),(229,10,139,1251,4657),(230,9,94,846,4663),(231,10,110,990,4671),(232,8,102,918,4679),(233,8,94,846,4689),(234,9,95,855,4695),(235,9,97,873,4703),(236,10,105,900,4713),(237,10,116,1037,4725),(238,12,136,1211,4739),(239,11,192,1728,4761),(240,11,212,1978,4791)]
report=r/'fr-history-evidence-221-240-20261110.md';fresh=r/'fr-history-221-240-mainfresh-20261110.json';assert not report.exists() and not fresh.exists()
text='''# 第一卷221—240历史证据对账（2026-11-10）

只读探子 `/root/fr_history_221_240` 返回；20章应登记历史对账完成、内容独审待补，沿用现有三稿及局修。本次核对尚不足以证明绑定当前SHA的全章独审＋修后主fresh闭合链；不据状态或静态通过关闭文本验收。

探子亲跑只读验证exit 0：80源／稿SHA匹配baseline，60三稿路径／SHA／bytes匹配current，预算、编号与单镜5—15秒检查通过，结束输入未变。主代理另亲核80／80输入及限定顶部文件名：恰为60三稿＋20source-map，没有本范围的独立报告或补充执行件；最新执行入口为现三稿。较早预算不叠加或回退，既有局修按以下最新续核行沿用，不再次执行。

[主输入核验](fr-history-221-240-mainfresh-20261110.json) 聚合SHA `8c66095dae0b92d95ec92c728df9ec2c863ce2a9e26e4cbca86e7b277fda900c`；UTF-8每行 `chapter<TAB>role<TAB>absolute_path<TAB>sha256<TAB>bytes<LF>`，221→240，角色source→screenplay→director-plan→storyboard。

|章|当前单元／镜／秒|最新续核出处（既有修订沿用）|当前内容状态|
|---|---|---|---|
'''
for n,u,shots,seconds,line in rows:
 note='缺当前全文独审闭合链；跨章时空、人物伤情、道具与源冲突仍须核源'
 if n==221:note='封锁／藏身／女孩感知及砸泥顺序已局修；锁链伤处、月光、鲁位置等源疑点保留'
 if n==239:note='尸坑原句旁白已补；普通铁矿单价、劣酒等消费细节仍记暂未转译，待内容审阅判定'
 if n==240:note='李天元故事后的具体鉴定机制已补；05提前概括不等于原文顺序，矿场／时地／残剑／241重聚待核'
 text+=f'|{n}|{u}／{shots}／{seconds}|volume-one-resume-1102.md:{line}|{note}|\n'
text+='''
主代理点验4493、4761、4791行：221明确仅定点核源非独立逐句审校；239消费细节“暂未转译”不被静态通过掩盖；240记录提前概括“不能视为与原文顺序等效”。未把这些记录自动推成稿件错误或擅改，后续全文内容审阅须处理其实际功能。

仅支持历史对账及现稿复用，不是20章全文语义重审。TTS、桌读、动作排演、动态、观众及生产未验。不得重扫同批或重放已完成局修。
'''
backup=r/('fr-audit221-240-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
report.write_text(text);fresh.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'digest_format':'chapter TAB role TAB absolute_path TAB sha256 TAB bytes LF; source,screenplay,director-plan,storyboard','inputs':inputs,'top_level_markdown_files':names,'additional_execution_files':[],'reviewer':'/root/fr_history_221_240','main_point_checks':['volume-one-resume-1102.md:4493','volume-one-resume-1102.md:4761','volume-one-resume-1102.md:4791'],'boundary':'Main current identity, filename inventory and selected historical claims; full semantic content closure not established, production unverified.'},ensure_ascii=False,indent=2)+'\n')
for n,u,shots,seconds,line in rows:cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit='fr-history-evidence-221-240-20261110.md',evidence_audit_scope='Current/baseline source and drafts,20 source-map entries and latest corresponding resume sections; main filename inventory and selected points. No full current semantic review.',historical_execution_metrics={'units':u,'shots':shots,'seconds':seconds,'source':'fr-history-evidence-221-240-20261110.md','not_content_acceptance':True},next_action='Reuse current revisions/latest volume record; complete missing full content review and main fresh. No repeated historical audit or repair scripts.')
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(221,241)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='27 reusable chapters (001-015,259-270);historical evidence001-240 registered. No active manuscript writers/reviewers. Next content016/017 and history241-258 (259-270 already closed); volume2 waits volume1 content and continuity closure.';p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|221—240历史证据|对账完成；主80/80输入SHA匹配，60三稿及20源图入口核对，最新局修沿用|[对账报告](research/fr-history-evidence-221-240-20261110.md)、[主指纹核验](research/fr-history-221-240-mainfresh-20261110.json)|缺当前全文独审链；239未转译细节、240提前概括另留证；下批241—258，跳过闭合259—270|\n'+anchor)
old=next(line for line in s.splitlines() if line.startswith('当前27章可复用（'));s=s.replace(old,'当前27章可复用（001—015、259—270）。014／015定点局修、不同审阅者复核及主fresh均已闭合；历史001—240已对账登记。当前无稿件写入者或在途审阅者；下一步016／017内容审阅、241—258历史对账，直接跳过已闭合259—270。已完成且输入未变的章与批次不重复实施或全审。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('001—220章历史证据对账完成','001—240章历史证据对账完成',1).replace('历史对账001—220已完成登记','历史对账001—240已完成登记',1).replace('221—240历史对账返回待主落账','221—240历史对账及主80/80输入核验已登记',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('001—220历史证据对账也已落盘','001—240历史证据对账也已落盘',1).replace('221—240历史对账已返回待主落账；下一内容批016／017','221—240历史对账及主80/80输入核验已登记；下一内容批016／017，下一历史批241—258，跳过已闭合259—270',1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:27 reusable chapters (001-015,259-270),014/015 independent postfix and main fresh exit0. Historical audit001-240 registered; latest80/80 inputs match. No active writers/reviewers. Next content016/017 and history241-258, skip closed259-270 and all unchanged completed work. Whole volume1/volume2 not complete.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'checks_passed':80,'protected_80_digest':digest,'historical_audit_through':240,'top_markdown_count':len(names)}))
