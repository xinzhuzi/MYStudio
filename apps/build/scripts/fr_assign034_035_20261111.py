from pathlib import Path
from datetime import datetime, timezone
import json, shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
c=next(x for x in d['volume1']['chapters'] if x['chapter']==34);assert c['status']=='targeted_repair_ready';c.update(status='targeted_repair_in_progress',writer='/root/fr034_targeted_repair',owner='/root/fr034_targeted_repair')
c=next(x for x in d['volume1']['chapters'] if x['chapter']==35);assert c['status']=='historical_evidence_audited_content_review_pending';c.update(status='current_full_review_in_progress',reviewer='/root/fr035_full_review',writer=None,owner=None,next_action='Only missing full current content review; preserve six execution tables and approved fixes. No historical audit replay.')
s='当前44章闭合（001—032、259—270），现SHA与证据直接复用。033八组修复作者收尾自审中，未交还所有权；034全文独审已落盘，三组已核源问题由 /root/fr034_targeted_repair 独占修复；035由 /root/fr035_full_review 只补现稿全文独审。已完成初审、闭合章及全卷历史对账不重复。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='44 closed reusable.033 repair author finishing;034 targeted repair owned by /root/fr034_targeted_repair;035 full review owned by /root/fr035_full_review. No replay.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+s;out[p]='\n'.join(lines)+'\n'
out[paths[-1]]=old[paths[-1]].decode()+'\n'+s+' 本条取代此前在途快照。\n';b=r/('fr-assign034035-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print('034 repair and 035 review ownership recorded in five documents')
