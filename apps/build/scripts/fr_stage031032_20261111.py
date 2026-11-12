"""Register completed review and active ownership; never replay implementation."""
from pathlib import Path
from datetime import datetime,timezone
import json,shutil,hashlib
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
b=r/('fr-stage031032-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:shutil.copy2(p,b/p.name)
for c in d['volume1']['chapters']:
 if c['chapter']==31:
  assert c['status']=='current_full_review_in_progress'
  c.update(status='targeted_repair_in_progress',reviewer='/root/fr031_full_review_retry',writer='/root/fr031_targeted_repair',owner='/root/fr031_targeted_repair',p2_groups_open=4,p3_groups_open=6,primary_findings_verified=True,current_independent_pass=False,evidence=['chapter031-independent-full-20261111.md'],next_action='Full review completed and all10 groups source-verified. One writer owns6 drafts; only those repairs, then new independent repair-difference review and primary fresh. No whole review or history repeat.')
  for key,name,sha,size in [('opening-shots','chapter031-opening-shots-1105.md','418171619abf3ef16007edf562327bf81f0b41a596bb9d6ae676d61cee2c709d',5658),('gate-observation-shots','chapter031-gate-observation-shots-1105.md','3ec6a584536f89b19fa526e8eca1b289f77703367b09729e015e9ea119ab56e4',16623)]:
   c['files'][key]={'path':str(r/name),'sha256':sha,'bytes':size,'identity_basis':'primary pre-repair inspection; writer will hand off final identity'}
  c['capacity_decision']={'status':'primary_approved_necessary_paper_expansion','date':'2026-11-11','reason':'Restored facts and voices require actual sound carriers and adequate windows; old529/1250 independent budgets do not constrain restoration. No real TTS/staging approval.'}
 if c['chapter']==32:
  assert c['status']=='historical_evidence_audited_content_review_pending'
  p=r/'chapter032-inner-gate-shots-1105.md';raw=p.read_bytes();c['execution_support']={'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
  c.update(status='current_full_review_in_progress',reviewer='/root/fr032_full_review',writer=None,owner=None,next_action='Existing current content full review active; no other reviewer or implementation until report and primary source checks.')
summary='当前42章闭合（001—030、259—270）。031全文独审4组P2/6组P3已交回、主逐项核源确认并登记，只交独占作者修六稿；032现稿全文独审在途。029/030及其余闭合身份未变章直接复用，全卷历史对账不重复。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='42 reusable closed;031 source-verified10-group repair active,032 full current review active. No repeat completed work.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,x in enumerate(lines) if x.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
for p in paths:assert p.read_bytes()==old[p]
for p in paths:p.write_text(out[p])
print(d['next_action'])
