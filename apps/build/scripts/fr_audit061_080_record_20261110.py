"""Record a one-time historical evidence audit; never modify manuscripts."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil

root=Path(__file__).resolve().parents[3]
t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text())
p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());cur={x['chapter']:x for x in c['volume1']['chapters']}
sources=[x for x in b['volumes'][0]['chapters'] if 61<=x['chapter']<=80]
drafts=[x for x in b['volume1_drafts'] if 61<=x['chapter']<=80]
assert len(sources)==len(drafts)==20
checks=[]
for x in sources:
 actual=hashlib.sha256(Path(x['path']).read_bytes()).hexdigest();assert actual==x['sha256'];checks.append({'path':x['path'],'sha256':actual})
for x in drafts:
 for role,f in x['files'].items():
  actual=hashlib.sha256(Path(f['path']).read_bytes()).hexdigest();assert actual==f['sha256']==cur[x['chapter']]['files'][role]['sha256'];assert f['path']==cur[x['chapter']]['files'][role]['path'];checks.append({'path':f['path'],'sha256':actual})
assert len(checks)==80
protected=[(x['path'],x['sha256']) for x in sources]+[(f['path'],f['sha256']) for x in drafts for k,f in sorted(x['files'].items())]
digest=hashlib.sha256(json.dumps(protected,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
assert digest=='2dadce327b9cd2cf0629eb25939f603721ca1020fb1ad96d7ab4217807bd397a'
report={'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'checks_passed':80,'protected_80_digest':digest,'inputs':checks,'reviewer':'/root/fr_history_061_080','main_point_checks':['volume-one-resume-1102.md:3683','volume-one-resume-1102.md:3741','volume-one-resume-1102.md:3819','chapter080-source-map-1103.md:35','chapter080-source-map-1103.md:39'],'boundary':'Current identity and selected historical claims only; no full semantic rereview.'}
evidence=r/'fr-history-061-080-mainfresh-20261110.json';assert not evidence.exists();evidence.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup=r/('fr-audit061-080-metadata-backup-'+stamp);backup.mkdir()
paths=[p,t/'offline-progress.md',t/'task.json',t/'prd.md',r/'fr-volumes-resume-20261110.md']
for path in paths:shutil.copy2(path,backup/path.name)
for n in range(61,81):
 row=cur[n];assert row['status']=='pending_evidence_audit';row.update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit='fr-history-evidence-061-080-20261110.md',evidence_audit_scope='Research top-level chapter reports and relevant volume sections; no historical chat search or manuscript rereview.',next_action='Reuse existing drafts, source-map repairs and split shots; complete missing current full content review and main fresh. Do not rerun prior repair scripts.')
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(61,81)))
for n in [4,5]:cur[n].update(status='targeted_repair_in_progress',writer=f'/root/fr{n:03d}_targeted_repair',evidence=[f'chapter{n:03d}-independent-full-20261110.md'],next_action='Repair confirmed findings only, then a different independent reviewer and main fresh; do not repeat historical audit.')
c['as_of']=datetime.now(timezone.utc).isoformat();c['evidence_audit_in_progress']=None;c['next_action']='004/005 targeted repairs underway; evidence audit001-080 complete, next batch081. Reuse closed001-003 and259-270.'
p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();old='|第一卷其余章|';assert s.count(old)==1;s=s.replace(old,'|061—080历史证据|对账完成；主核80/80输入SHA匹配，已有核源/修订/拆镜沿用|[对账报告](research/fr-history-evidence-061-080-20261110.md)、[主指纹核验](research/fr-history-061-080-mainfresh-20261110.json)|缺当前全文独审及主fresh；不重做080已续修旧缺口；下批081起|\n'+old)
old='当前无在途写稿；只读审阅由 `/root/fr004_current_review`、`/root/fr005_current_review` 分别负责004、005，`/root/fr_history_061_080` 对账061—080历史证据。主代理维护共享台账，收到结论后核据、必要局修并补独审/fresh。001—003、259—270与001—060历史对账均从待办中跳过。'
assert s.count(old)==1;s=s.replace(old,'004、005全文独审已完成并确证局部缺口，分别由 `/root/fr004_targeted_repair`、`/root/fr005_targeted_repair` 独占本章三稿局修；独立修后复核及主fresh尚待。061—080历史对账已落盘，下批081起。001—003、259—270与001—080历史对账均从待办中跳过。');p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10: 15 closed chapters retained; historical evidence audit001-080 complete (latest80/80 SHA). 004/005 full reviews complete with findings; targeted repair writers own their three manuscripts. Next historical audit081.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'prd.md';s=p.read_text();s=s.replace('001—060章历史证据对账完成','001—080章历史证据对账完成',1);s=s.replace('本批无在途写稿，内容独审从004接续','004/005全文独审已完成，确证局部问题正在修复，修后独审及主fresh待续',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();s=s.replace('001—060历史证据对账也已落盘','001—080历史证据对账也已落盘',1);p.write_text(s)
print(json.dumps({'pass':True,'checks_passed':80,'protected_80_digest':digest,'evidence':str(evidence),'history_audited_through':80,'current_closed_count':15,'repairs_in_progress':[4,5]},ensure_ascii=False,indent=2))
