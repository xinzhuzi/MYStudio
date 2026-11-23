"""Register completed 028 repairs and next independent content reviews without closing them."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil
root=Path(__file__).resolve().parents[3];task=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=task/'research'
paths=[r/'fr-volumes-current-20261110.json',task/'task.json',task/'offline-progress.md',task/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};j=json.loads(old[paths[0]])
b=r/('fr-stage028030-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:shutil.copy2(p,b/p.name)
for n in [28,29,30]:
 c=next(x for x in j['volume1']['chapters'] if x['chapter']==n)
 assert c['status']==('targeted_repair_in_progress' if n==28 else 'historical_evidence_audited_content_review_pending')
 if n==28:
  for v in list(c['files'].values())+[c['execution_support']]:
   content=Path(v['path']).read_bytes();v.update(sha256=hashlib.sha256(content).hexdigest(),bytes=len(content))
  report='chapter028-review-repair-20261111.md';assert (r/report).is_file();c['evidence'].append(report);c.update(repair_report=report,status='targeted_repair_done_pending_independent_review',reviewer='/root/fr028_postfix_review',next_action='Five fixes implemented; only independent postfix review and primary fresh pending. Do not repeat repairs.')
 else:
  p=r/f'chapter{n:03d}-shot-breakdown-1104.md';content=p.read_bytes();c['execution_support']={'path':str(p),'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)}
  c.update(status='independent_content_review_in_progress',reviewer=f'/root/fr{n:03d}_full_review',next_action='Read current source and all actual drafts/support once; preserve completed historical work; report grounded gaps only. No regeneration.')
 c.update(writer=None,owner=None,current_independent_pass=False)
summary='当前39章闭合（001—027、259—270）。028五项局修与作者自验已完成并登记，交不同审阅者只核修后差异，再主fresh；029/030接现稿全文内容独审，无稿件写入者。已闭合身份未变章和全卷历史对账不重复。'
j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='39 reusable closed;028 repair complete, postfix review then primary fresh;029/030 independent current content reviews. No draft writers;no repeat completed work.'
t=json.loads(old[task/'task.json']);t['offlineTrack']['last_checkpoint']=j['next_action']
out={paths[0]:json.dumps(j,ensure_ascii=False,indent=2)+'\n',task/'task.json':json.dumps(t,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(task/'offline-progress.md','> 最新状态：'),(task/'prd.md','> **2026-11-11 最新离线进度**：')]:
 lines=old[p].decode().splitlines();idx=[i for i,x in enumerate(lines) if x.startswith(prefix)];assert len(idx)==1;lines[idx[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
for p in paths:assert p.read_bytes()==old[p]
for p in paths:p.write_text(out[p])
print(json.dumps({'staged':[28,29,30],'closed':39,'backup':str(b)},ensure_ascii=False))
