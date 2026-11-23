"""Record completed033 review and ownership; never replay completed work."""
from pathlib import Path
from datetime import datetime, timezone
import json, shutil, hashlib
root=Path(__file__).resolve().parents[3]
t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md']
old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
c=next(x for x in d['volume1']['chapters'] if x['chapter']==33)
assert c['status']=='current_full_review_in_progress'
assert (r/'chapter033-independent-full-20261111.md').is_file()
c.update(status='targeted_repair_in_progress',reviewer='/root/fr033_full_review',writer='/root/fr033_targeted_repair',owner='/root/fr033_targeted_repair',p2_groups_open=6,p3_groups_open=2,primary_findings_verified=True,evidence=['chapter033-independent-full-20261111.md'],next_action='Full review completed and eight groups source-verified. Single writer owns eight drafts; only targeted repairs, then new independent repair-difference review and primary fresh. No repeated full review or history audit.')
for k in ['opening','village','stone-return','temple-ending']:
 p=r/f'chapter033-{k}-shots-1105.md';raw=p.read_bytes();c['files'][k+'-shots']={'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
c['capacity_decision']={'status':'primary_approved_necessary_paper_expansion','date':'2026-11-11','reason':'Restore source-grounded playable content in adequate windows. Old516/912 remain independent historical budgets; no real TTS/staging acceptance.'}
summary='当前42章闭合（001—030、259—270）。031十组、032八组、033六组P2及两处P3均已全文独审、主核源并落盘，分别交独占作者定点修复；修后仅接全部差异独审和主fresh，不重复实施或全文初审。闭合身份未变章及全卷历史对账直接沿用。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='42 reusable closed;031 ten-group,032 eight-group,033 sixP2/twoP3 confirmed repairs active with separate ownership. Completed full reviews persisted; next only repair differences and primary fresh. No duplicate review or history audit.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action']
out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1
 lines[hits[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
b=r/('fr-stage033-repair-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print(d['next_action'])
