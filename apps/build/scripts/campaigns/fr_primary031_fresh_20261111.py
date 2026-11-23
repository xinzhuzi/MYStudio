"""Primary fresh after independent031 difference review."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,sys
root=Path(__file__).resolve().parents[3];r=root/'.trellis/tasks/10-27-script-narrative-translation-cure/research';out=r/'chapter031-mainfresh-raw-20261111.json'
assert not out.exists(),'Do not replay completed primary fresh'
assert 'pass=true' in (r/'chapter031-postfix-independent-20261111.md').read_text()
b=json.loads((r/'chapter031-repair-backup-20261111/manifest.json').read_text());paths=[]
for v in b.values():
 p=Path(v['path']);paths.append(p if p.is_absolute() else root/p)
paths += [root/'apps/build/scripts/chapter031_review_verify_20261111.py',r/'chapter031-repair-backup-20261111/manifest.json']
start={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths};command=[sys.executable,'-B',str(root/'apps/build/scripts/chapter031_review_verify_20261111.py'),'--negative-self-test'];when=datetime.now(timezone.utc).isoformat()
run=subprocess.run(command,cwd=root,capture_output=True,text=True);end={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths};result=json.loads(run.stdout);verdict=run.returncode==0 and result['pass'] and start==end
record={'pass':verdict,'run_by':'primary /root','started_at_utc':when,'ended_at_utc':datetime.now(timezone.utc).isoformat(),'command':command,'exit_code':run.returncode,'runtime_start_sha256':start,'runtime_end_sha256':end,'stderr':run.stderr,'result':result};out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':verdict,'exit_code':run.returncode,'checks':result['checks'],'passed':result['passed'],'negative_controls':len(result['negative_tests']),'metrics':result['metrics'],'identity_stable':start==end},ensure_ascii=False));raise SystemExit(0 if verdict else 1)
