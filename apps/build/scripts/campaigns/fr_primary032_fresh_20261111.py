"""One primary fresh run after independent032 acceptance; no content mutation."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,sys
root=Path(__file__).resolve().parents[3];r=root/'.trellis/tasks/10-27-script-narrative-translation-cure/research';out=r/'chapter032-mainfresh-raw-20261111.json'
assert not out.exists(),'Do not replay completed primary fresh'
review=(r/'chapter032-postfix-independent-20261111.md').read_text();assert 'pass=true' in review
b=json.loads((r/'chapter032-review-repair-backup-20261111.json').read_text())
paths=[r/n for n in b['drafts']]+[Path(b['source']['path']),root/b['source_map']['path'],root/'apps/build/scripts/chapter032_review_verify_20261111.py',r/'chapter032-review-repair-backup-20261111.json',r/'chapter032-review-repair-shot-map-20261111.json']
start={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths};command=[sys.executable,'-B',str(root/'apps/build/scripts/chapter032_review_verify_20261111.py')];when=datetime.now(timezone.utc).isoformat()
run=subprocess.run(command,cwd=root,capture_output=True,text=True)
end={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths};result=json.loads(run.stdout)
verdict=run.returncode==0 and result['pass'] and start==end
record={'pass':verdict,'run_by':'primary /root','started_at_utc':when,'ended_at_utc':datetime.now(timezone.utc).isoformat(),'command':command,'exit_code':run.returncode,'runtime_start_sha256':start,'runtime_end_sha256':end,'stderr':run.stderr,'result':result}
out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':verdict,'exit_code':run.returncode,'groups':len(result['groups']),'handoff_checks':len(result['handoff_checks']),'negative_controls':len(result['negative_controls']),'unit_seconds':result['unit_seconds'],'shot_seconds':result['shot_seconds'],'runtime_identity_stable':start==end},ensure_ascii=False))
raise SystemExit(0 if verdict else 1)
