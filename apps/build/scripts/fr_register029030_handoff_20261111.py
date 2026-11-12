"""One-time handoff registration only; not content approval. Do not replay."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil
root=Path(__file__).resolve().parents[3]
task=root/'.trellis/tasks/10-27-script-narrative-translation-cure'
r=task/'research'
lp=r/'fr-volumes-current-20261110.json'
ledger=json.loads(lp.read_text())
selected=[c for c in ledger['volume1']['chapters'] if c['chapter'] in (29,30)]
assert len(selected)==2 and all(c['status']=='targeted_repair_in_progress' for c in selected)
paths=[lp,task/'task.json',task/'offline-progress.md',task/'prd.md',r/'fr-volumes-resume-20261110.md']
originals={p:p.read_bytes() for p in paths}
backup=r/('fr-repair029030-handoff-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
backup.mkdir()
for p in paths: shutil.copy2(p,backup/p.name)
for c in selected:
 n=c['chapter'];report=f'chapter{n:03d}-review-repair-20261111.md';report_text=(r/report).read_text()
 for item in list(c['files'].values())+[c['execution_support']]:
  b=Path(item['path']).read_bytes();sha=hashlib.sha256(b).hexdigest()
  assert sha in report_text, f'Handoff SHA mismatch: {item["path"]}'
  item.update(sha256=sha,bytes=len(b))
 c.update(status='targeted_repair_done_pending_independent_review',writer=None,owner=None,reviewer=None,current_independent_pass=False,repair_report=report,next_action='Repairs and author selfchecks are complete. Review only all repair differences and affected source/action/voice context with a different reviewer, then primary fresh. Do not repeat implementation or whole-chapter review.')
 if report not in c['evidence']: c['evidence'].append(report)
 c['author_selfcheck']={'exit_code':0,'positive_checks':320 if n==29 else 550,'negative_checks':7 if n==29 else 20,'report':report,'counts_basis':'Author report only; primary fresh pending'}
 c['paper_budget']={'units':21 if n==29 else 15,'unit_seconds':719 if n==29 else 683,'shots':97 if n==29 else 85,'shot_seconds':903 if n==29 else 809,'actual_audio_or_staging_verified':False}
summary='当前40章闭合（001—028、259—270）；029七项、030八项及两项主裁局修已交还，作者自验分别320/320加7负例、550/550加20负例，已登记新SHA。两章只接修后差异独审及主fresh，不重复实施或全文审阅。031前次429零审阅结果，仍待审；闭合身份未变章及全卷历史对账不重复。'
ledger['as_of']=datetime.now(timezone.utc).isoformat();ledger['next_action']='40 reusable closed;029/030 repairs handed off and new SHA registered, independent postfix reviews and primary fresh pending.031 prior review failed429 without result, pending. No repeat unchanged completed work.'
t=json.loads(originals[task/'task.json']);t['offlineTrack']['last_checkpoint']=ledger['next_action']
outputs={lp:json.dumps(ledger,ensure_ascii=False,indent=2)+'\n',task/'task.json':json.dumps(t,ensure_ascii=False,indent=2)+'\n'}
for p in [task/'offline-progress.md',r/'fr-volumes-resume-20261110.md']: outputs[p]=originals[p].decode()+'\n> 最新接续：'+summary+' 本条取代此前在途快照。\n'
p=task/'prd.md';lines=originals[p].decode().splitlines();hits=[i for i,x in enumerate(lines) if x.startswith('> **2026-11-11 最新离线进度**')];assert len(hits)==1
lines[hits[0]]='> **2026-11-11 最新离线进度**：'+summary+' 第一卷整体及第二卷未完成。';outputs[p]='\n'.join(lines)+'\n'
for p in paths: assert p.read_bytes()==originals[p],f'Concurrent change: {p}'
for p in paths: p.write_text(outputs[p])
print(json.dumps({'registered':[29,30],'closed_count':40,'backup':str(backup),'semantic_approval':False},ensure_ascii=False))
