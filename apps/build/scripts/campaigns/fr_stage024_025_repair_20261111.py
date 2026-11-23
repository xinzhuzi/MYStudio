from pathlib import Path
import json,shutil,hashlib
from datetime import datetime,timezone
T=Path('.trellis/tasks/10-27-script-narrative-translation-cure');R=T/'research';B=R/'stage024-025-backup-20261111';B.mkdir(exist_ok=False)
for p in [T/'task.json',T/'offline-progress.md',T/'prd.md',R/'fr-volumes-current-20261110.json',R/'fr-volumes-resume-20261110.md']: shutil.copy2(p,B/p.name)
p=R/'fr-volumes-current-20261110.json';d=json.loads(p.read_text())
for c in d['volume1']['chapters']:
 if c['chapter'] in [24,25]:
  c.update(status='targeted_repair_in_progress',writer='/root/fr024_targeted_repair' if c['chapter']==24 else '/root',primary_findings_verified=True)
  c['next_action']='Only verified findings in full independent report; preserve source/voices/both separate budgets; then different independent reviewer and primary fresh.'
  q=R/f"chapter{c['chapter']:03d}-shot-breakdown-1105.md";b=q.read_bytes();c['execution_support']={'path':str(q.resolve()),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
 if c['chapter']==22: c['reviewer']='/root/fr022_postfix_review';c['status']='postfix_independent_review_in_progress'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='34 closed reused;022 postfix independent review in progress;024 worker/025 primary targeted fixes verified and underway;script exact-source recovery active;all historical audit complete.';p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=T/'task.json';t=json.loads(p.read_text());t['offlineTrack']['last_checkpoint']=d['next_action'];p.write_text(json.dumps(t,ensure_ascii=False,indent=2)+'\n')
status='022已交 `/root/fr022_postfix_review` 定点独审；024/025全文独审发现经主逐项核源属实，024由 `/root/fr024_targeted_repair` 独占三稿及200镜支持稿，025由主会话独占三稿及147镜支持稿局修。原著、原人物声、两套独立预算保留，修后另独审和主fresh。34闭合章及全卷历史对账不重复。'
for name in ['offline-progress.md','prd.md']:
 p=T/name;s=p.read_text();p.write_text(s+'\n> 2026-11-11 当前所有权：'+status+'\n')
p=R/'fr-volumes-resume-20261110.md';p.write_text(p.read_text()+'\n'+status+'\n')
print('024/025 primary confirmed and ownership recorded;022 review active')
