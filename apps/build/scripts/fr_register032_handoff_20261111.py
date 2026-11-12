"""Register completed032 implementation, without claiming independent acceptance."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
c=next(x for x in d['volume1']['chapters'] if x['chapter']==32);assert c['status']=='partial_repair_primary_takeover'
for v in [*c['files'].values(),c['execution_support']]:
 p=Path(v['path']);raw=p.read_bytes();v.update(sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw))
c.update(status='targeted_repair_complete_pending_independent',writer=None,owner=None,reviewer=None,next_action='Eight-group implementation and primary handoff corrections complete; only new independent all-difference/affected-window review, then primary fresh. Do not repeat implementation or full initial review.',repair_report='chapter032-review-repair-20261111.md',repair_snapshot='chapter032-repair-handoff-20261111.json',repair_validation='chapter032-handoff-verification-20261111.json',unit_seconds=934,execution_seconds=1252,execution_shots=130)
c['evidence']+=['chapter032-review-repair-20261111.md','chapter032-handoff-verification-20261111.json']
summary='当前42章闭合（001—030、259—270）。032八组及三处接管精修已完成，当前SHA/45差异块/自验8组+53检查/12负例已登记，只接新独审和主fresh；031部分成果由主接管待核，033八组已核源待修。已闭合章、完成的初审和全卷历史对账不重复。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='42 reusable closed.032 implementation complete and SHA recorded; next independent differences review then primary fresh.031 partial repair primary takeover;033 verified findings repair pending. No repeated completed work.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=paths[-1];out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
b=r/('fr-register032-handoff-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print(d['next_action'])
