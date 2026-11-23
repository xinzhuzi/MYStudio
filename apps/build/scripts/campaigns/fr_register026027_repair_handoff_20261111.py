"""One-time registration of completed repairs; this does not close content review."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil
root=Path(__file__).resolve().parents[3]
task=root/'.trellis/tasks/10-27-script-narrative-translation-cure'
r=task/'research'
ledger_path=r/'fr-volumes-current-20261110.json'
ledger=json.loads(ledger_path.read_text())
selected=[c for c in ledger['volume1']['chapters'] if c['chapter'] in (26,27)]
assert len(selected)==2
assert all(c['status']=='targeted_repair_in_progress' for c in selected), 'Already registered or changed; do not replay'
paths=[ledger_path,task/'task.json',task/'offline-progress.md',task/'prd.md',r/'fr-volumes-resume-20261110.md']
originals={p:p.read_bytes() for p in paths}
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
backup=r/f'fr-repair026027-handoff-backup-{stamp}'
backup.mkdir()
for p in paths:shutil.copy2(p,backup/p.name)
for c in selected:
 n=c['chapter'];report=f'chapter{n:03d}-review-repair-20261111.md'
 assert (r/report).is_file()
 for item in list(c['files'].values())+[c['execution_support']]:
  b=Path(item['path']).read_bytes();item.update(sha256=hashlib.sha256(b).hexdigest(),bytes=len(b))
 c.update(status='targeted_repair_done_pending_independent_review',writer=None,owner=None,reviewer=None,current_independent_pass=False,repair_report=report,next_action='Repairs already implemented. Review all repair differences and affected source/action/voice context with a different reviewer; then primary fresh. Do not repeat implementation or whole-chapter review.')
 if report not in c['evidence']:c['evidence'].append(report)
 c['author_selfcheck']={'exit_code':0,'positive_checks':885 if n==26 else 747,'negative_checks':14 if n==26 else 11,'report':report,'counts_basis':'author report; primary fresh pending'}
 if n==26:
  c['additional_execution_support']=[]
  for name in ['chapter026-sound-cues-1104.md','chapter026-sound-placement-01-12-1104.md','chapter026-sound-placement-13-36-1104.md']:
   p=r/name;b=p.read_bytes();c['additional_execution_support'].append({'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)})
summary='当前37章闭合（001—025、259—270）；026七组及027四组局修和作者自验已完成，所有权交还，已登记新SHA与修复报告，只接修后定点独审及主fresh，不重复实施。028五项局修在途，029为下一内容独审章。已闭合且身份未变章及全卷历史对账不重复。'
ledger['as_of']=datetime.now(timezone.utc).isoformat();ledger['next_action']='37 reusable closed;026/027 repairs complete and registered, independent postfix reviews and primary fresh pending;028 targeted repair active;029 next content review. No repeat unchanged completed work.'
t=json.loads(originals[task/'task.json']);t['offlineTrack']['last_checkpoint']=ledger['next_action']
outputs={ledger_path:json.dumps(ledger,ensure_ascii=False,indent=2)+'\n',task/'task.json':json.dumps(t,ensure_ascii=False,indent=2)+'\n'}
for p in [task/'offline-progress.md',r/'fr-volumes-resume-20261110.md']:
 outputs[p]=originals[p].decode()+'\n> 最新接续：'+summary+' 本条取代此前在途快照。\n'
p=task/'prd.md';lines=originals[p].decode().splitlines();indexes=[i for i,x in enumerate(lines) if x.startswith('> **2026-11-11 最新离线进度**')];assert len(indexes)==1
lines[indexes[0]]='> **2026-11-11 最新离线进度**：'+summary+' 第一卷整体及第二卷未完成。';outputs[p]='\n'.join(lines)+'\n'
for p in paths:assert p.read_bytes()==originals[p], f'Concurrent change: {p}'
for p in paths:p.write_text(outputs[p])
print(json.dumps({'registered':[26,27],'closed_count':37,'backup':str(backup),'changed_docs':[str(p) for p in paths]},ensure_ascii=False))
