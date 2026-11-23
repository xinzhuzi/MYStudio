"""Record current one-chapter assignments, preserving completed evidence."""
from pathlib import Path
from datetime import datetime,timezone
import json,shutil,hashlib
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
a=next(x for x in d['volume1']['chapters'] if x['chapter']==31);assert a['status']=='targeted_repair_complete_pending_independent';a['reviewer']='/root/fr031_diff_independent_retry';a['status']='independent_postfix_review_in_progress';a['failed_review_attempt']={'agent':'/root/fr031_diff_independent','reason':'model gpt-5.6-terra unavailable; zero review result'}
a=next(x for x in d['volume1']['chapters'] if x['chapter']==33);assert a['status']=='verified_findings_repair_pending';a.update(status='targeted_repair_in_progress',writer='/root/fr033_repair_after_limit',owner='/root/fr033_repair_after_limit',next_action='Eight verified groups only; previous writer terminal429 and no draft edits. New writer owns eight drafts; independent all-difference review and primary fresh afterwards. No full initial review repetition.')
a=next(x for x in d['volume1']['chapters'] if x['chapter']==34);assert a['status']=='historical_evidence_audited_content_review_pending';a.update(status='current_full_review_in_progress',reviewer='/root/fr034_full_review',writer=None,owner=None,next_action='Fill only missing full current content review; retain approved historical fixes and integrated134 shots. No history audit or rewriting.')
p=r/'chapter034-integrated-storyboard-1109.md';a['execution_support']={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
summary='当前43章闭合（001—030、032、259—270），032已登记直接复用。031修复完成，仅差异独审在途；033前作者429且八稿零改动，交新独占作者只接八组已核修复；034只补现稿全文内容独审。已完成初审/修复及全卷历史对账不重复。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='43 reusable closed.031 independent repair-difference review active;033 verified eight-group repair new exclusive writer after terminal429 with zero edits;034 full current review active. No completed-work replay.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=paths[-1];out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
b=r/('fr-stage031-review-033034-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print(d['next_action'])
