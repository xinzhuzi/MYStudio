from pathlib import Path
from datetime import datetime,timezone
import json,shutil
root=Path(__file__).resolve().parents[3];task=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=task/'research'
paths=[r/'fr-volumes-current-20261110.json',task/'task.json',task/'offline-progress.md',task/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};j=json.loads(old[paths[0]])
b=r/('fr-register029030-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:shutil.copy2(p,b/p.name)
for n,p2,p3 in [(29,2,5),(30,3,5)]:
 c=next(x for x in j['volume1']['chapters'] if x['chapter']==n);assert c['status']=='independent_content_review_in_progress'
 report=f'chapter{n:03d}-independent-full-20261111.md';assert (r/report).is_file()
 c.update(status='targeted_repair_in_progress',writer=f'/root/fr{n:03d}_targeted_repair',owner=f'/root/fr{n:03d}_targeted_repair',p2_groups_open=p2,p3_groups_open=p3,primary_findings_verified=True,current_independent_pass=False,evidence=[report],next_action='Full independent review complete; primary verified findings. Implement only listed groups preserving all prior work, then different independent postfix review and primary fresh.')
 if n==30:c['additional_primary_corrections']=['Tree scene has no established cave; correct SH7','No proof Wu knew insufficient energy before departure; correct DP7']
summary='当前39章闭合（001—027、259—270）。028仅剩握拳承接P3专项局修；029全文独审2P2/5P3、030全文独审3P2/5P3及两项主裁均已落盘并经主核源，分别独占局修。三章修后均需另一审阅者与主fresh。全文审阅、历史对账和闭合身份未变章不重复。'
j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='39 reusable closed;028 one clench P3 repair;029/030 verified bounded repairs active. Full reviews completed and preserved; no repeat history/closed work.'
t=json.loads(old[task/'task.json']);t['offlineTrack']['last_checkpoint']=j['next_action'];out={paths[0]:json.dumps(j,ensure_ascii=False,indent=2)+'\n',task/'task.json':json.dumps(t,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(task/'offline-progress.md','> 最新状态：'),(task/'prd.md','> **2026-11-11 最新离线进度**：')]:
 lines=old[p].decode().splitlines();idx=[i for i,x in enumerate(lines) if x.startswith(prefix)];assert len(idx)==1;lines[idx[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
for p in paths:assert p.read_bytes()==old[p]
for p in paths:p.write_text(out[p])
print('029/030 full reviews registered; primary-verified targeted repair ownership assigned; closed count39')
