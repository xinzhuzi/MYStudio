from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil
root=Path(__file__).resolve().parents[3]
task=root/'.trellis/tasks/10-27-script-narrative-translation-cure'
r=task/'research'
p=r/'fr-volumes-current-20261110.json'
d=json.loads(p.read_text());row=next(x for x in d['volume1']['chapters'] if x['chapter']==19)
assert row['status']=='targeted_repair_in_progress'
expected={'screenplay':'22dbb2fe72740d69c251b0f02db7cf4c41556be8e2e4f0d429b49ca55d0ce4f0','director-plan':'cee514db8e523d64cedb5fe4f93490d931f9fbfca3770e48f17b852f226cecca','storyboard':'4bd998d9a76cdc378ecb2e28d67901671a9d22a39f001c4293c9d79bfc823905'}
for role,meta in row['files'].items():
 raw=Path(meta['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==expected[role]
 meta.update(sha256=expected[role],bytes=len(raw))
row.update(status='postfix_independent_review_pending',writer=None,reviewer='/root/fr019_postfix_review',next_action='Implemented two P3 repairs and source-gap note; independent targeted review then main fresh required.')
row['evidence'].append('chapter019-review-repair-20261111.md')
d['as_of']=datetime.now(timezone.utc).isoformat()
d['next_action']='30 reusable chapters;019 repaired awaiting independent review/main fresh;311-330 historical audit active. Completed work is not repeated.'
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
shutil.copy2(p,r/f'fr-volumes-current-before-019-review-{stamp}.json')
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=task/'offline-progress.md';s=p.read_text();a='019由 `/root/fr019_targeted_repair` 独占局修两P3并补记草茎源缺口，随后独审和主fresh。';b='019两P3及草茎源缺口备注已修，三稿所有权已归还；由 `/root/fr019_postfix_review` 定点独审，随后主fresh。修复记录见 research/chapter019-review-repair-20261111.md。';assert s.count(a)==1;p.write_text(s.replace(a,b))
p=task/'task.json';t=json.loads(p.read_text());t['offlineTrack']['last_checkpoint']=d['next_action'];p.write_text(json.dumps(t,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'chapter':19,'status':row['status'],'writer':None,'reviewer':row['reviewer'],'pass':True},ensure_ascii=False))
