"""Register141-160 historical audit once, retaining supplementary execution inputs."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(141,161):
 assert cd[n]['status']=='pending_evidence_audit'
 for role,z in [('source',bs[n])]+list(bd[n]['files'].items()):
  fp=Path(z['path']);raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   q=cd[n]['files'][role];assert q['path']==z['path'] and q['sha256']==h;assert len(raw)==z['bytes']==q['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(fp.absolute()),'sha256':h})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='7c0b0faf257623f93e87c9c9e3f3931bd80818501070e6e5acfa9517685f68e5'
extras={157:['chapter157-integrated-storyboard-1110.md'],158:['chapter158-integrated-53-shots-1110.md'],159:['chapter159-cliff-scene-source-1110.md','chapter159-door-motive-insert-1110.md'],160:['chapter160-integrated-43-shots-1110.md']};extra_rows={}
for n,names in extras.items():
 extra_rows[n]=[]
 for name in names:
  fp=r/name;raw=fp.read_bytes();extra_rows[n].append({'path':str(fp),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
e=r/'fr-history-141-160-mainfresh-20261110.json';assert not e.exists()
backup=r/('fr-audit141-160-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
e.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'inputs':inputs,'additional_execution_files':extra_rows,'reviewer':'/root/fr_history_141_160','main_point_checks':['chapter152-source-map-1103.md:18','chapter152-source-map-1103.md:20','chapter152-polished-storyboard-1103.md:91','chapter155-source-map-1103.md:29','chapter156-source-map-1103.md:23','chapter157-integrated-storyboard-1110.md:3','chapter158-integrated-53-shots-1110.md:7','chapter159-cliff-scene-source-1110.md:55','chapter159-door-motive-insert-1110.md:14','chapter160-integrated-43-shots-1110.md:51'],'boundary':'Main current identity and selected historical claims only, no repeated full semantic review. Extra execution documents recorded as inputs for later content review.'},ensure_ascii=False,indent=2)+'\n')
for n in range(141,161):cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit='fr-history-evidence-141-160-20261110.md',evidence_audit_scope='Chapter reports and corresponding volume sections; supplementary execution documents checked separately.',next_action='Reuse current revisions and latest integrated/insert tables; complete missing full content review and main fresh. No repeated historical audit or repair scripts.')
for n,entries in extra_rows.items():cd[n]['current_execution_artifacts']=entries
for n,shots,seconds in [(157,44,541),(158,53,630),(159,49,635),(160,43,549)]:cd[n]['historical_execution_metrics']={'units':12,'shots':shots,'seconds':seconds,'source':'fr-history-evidence-141-160-20261110.md','not_content_acceptance':True}
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(141,161)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='21 reusable chapters.010/011 targeted repair writers active. History001-160 registered; next history161-180.';p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|141—160历史证据|对账完成；主80/80输入SHA匹配，157—160最新汇编/补表另记5份SHA|[对账报告](research/fr-history-evidence-141-160-20261110.md)、[主指纹核验](research/fr-history-141-160-mainfresh-20261110.json)|缺当前全文独审链；152/155/156已修沿用；157—160不能只审旧主表；下批161起|\n'+anchor)
old=next(x for x in s.splitlines() if x.startswith('当前21章可复用（'));s=s.replace(old,'当前21章可复用（001—009、259—270）。010/011全文独审已落盘，分别由 `/root/fr010_targeted_repair`、`/root/fr011_targeted_repair` 定点局修，修后不同审阅者复核和主fresh待续；不重复全审。历史对账001—160及主输入核验已登记，下批161—180。已闭合章节与已对账批次跳过。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('001—140章历史证据对账完成','001—160章历史证据对账完成',1).replace('历史对账001—140已完成登记','历史对账001—160已完成登记',1).replace('当前010/011只读全文审阅、141—160历史证据对账在途，无写稿者','010/011全文独审已落盘、分章定点局修在途；历史对账141—160及主80/80输入核验已登记',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('001—140历史证据对账也已落盘','001—160历史证据对账也已落盘',1).replace('当前010/011只读全文审阅','010/011全文独审已落盘，分章局修在途',1).replace('当前141—160只读对账。','141—160历史对账及主80/80指纹核验已登记，下批161—180。',1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:21 reusable chapters (001-009,259-270).010/011 full reviews recorded, chapter-owned targeted repairs underway. Historical evidence001-160 registered; latest80/80 hashes plus5 execution documents recorded. Next history161-180; skip completed work.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'checks_passed':80,'additional_execution_files':sum(map(len,extra_rows.values())),'protected_80_digest':digest,'historical_audit_through':160}))
