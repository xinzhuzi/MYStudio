from pathlib import Path
from datetime import datetime,timezone
import json,shutil
root=Path(__file__).resolve().parents[3];task=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=task/'research'
paths=[r/'fr-volumes-current-20261110.json',task/'task.json',task/'offline-progress.md',task/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};j=json.loads(old[paths[0]]);c=next(x for x in j['volume1']['chapters'] if x['chapter']==28)
assert c['status']=='targeted_repair_done_pending_independent_review'
b=r/('fr-register028-clench-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:shutil.copy2(p,b/p.name)
c.update(status='targeted_p3_repair_in_progress',writer='/root/fr028_clench_repair',owner='/root/fr028_clench_repair',current_independent_pass=False,p2_groups_open=0,p3_groups_open=1,next_action='Five repaired factual groups reviewed; preserve them. Fix only source191/227-251 first clench and later numb-arm reclench continuity; then new targeted independent reviewer and primary fresh.')
c['evidence'].append('chapter028-postfix-independent-20261111.md')
summary='当前39章闭合（001—027、259—270）。028五项修复已独审，另发现一项握拳承接P3：主核源191/227—251确认先攥紧、后麻臂再次攥回，仅交专项修复，不重做五项。029/030全文内容独审接续，已闭合章及历史对账不重复。'
j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='39 reusable closed;028 one verified clench continuity P3 repair;029/030 full review findings pending primary integration. Preserve completed work.'
t=json.loads(old[task/'task.json']);t['offlineTrack']['last_checkpoint']=j['next_action'];out={paths[0]:json.dumps(j,ensure_ascii=False,indent=2)+'\n',task/'task.json':json.dumps(t,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(task/'offline-progress.md','> 最新状态：'),(task/'prd.md','> **2026-11-11 最新离线进度**：')]:
 lines=old[p].decode().splitlines();idx=[i for i,x in enumerate(lines) if x.startswith(prefix)];assert len(idx)==1;lines[idx[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
for p in paths:assert p.read_bytes()==old[p]
for p in paths:p.write_text(out[p])
print('028 P3 registered; closed count remains39')
