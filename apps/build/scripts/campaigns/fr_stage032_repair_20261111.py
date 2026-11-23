"""Persist chapter032 completed full review and current writers; no content replay."""
from pathlib import Path
from datetime import datetime,timezone
import json,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
c=next(x for x in d['volume1']['chapters'] if x['chapter']==32);assert c['status']=='current_full_review_in_progress'
c.update(status='targeted_repair_in_progress',reviewer='/root/fr032_full_review',writer='/root/fr032_targeted_repair',owner='/root/fr032_targeted_repair',p2_groups_open=4,p3_groups_open=4,primary_findings_verified=True,evidence=['chapter032-independent-full-20261111.md'],next_action='Full review completed; primary verified all8 groups. One writer owns4 drafts, then different independent repair-difference review and primary fresh. Do not repeat full review or history audit.')
c['capacity_decision']={'status':'primary_approved_necessary_paper_expansion','date':'2026-11-11','reason':'Restore missing source content and actual voices with adequate windows. Old485/948 are independent historical budgets; no real TTS/staging approval.'}
summary='当前42章闭合（001—030、259—270）。031十组、032八组全文独审结论均已落盘并经主核源，分别由独占作者局修；033现稿全文独审在途。两章修后只接差异独审和主fresh，不重复全文初审；闭合身份未变章与全卷历史对账直接沿用。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='42 reusable closed;031 ten-group and032 eight-group confirmed repairs active with separate ownership;033 full current review active. No duplicate implementation, completed review or historical audit.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,x in enumerate(lines) if x.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
b=r/('fr-stage032-repair-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print(d['next_action'])
