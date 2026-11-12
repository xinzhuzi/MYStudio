"""Primary one-time fresh run after independent entrance-line review."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,sys
root=Path(__file__).resolve().parents[3];r=root/'.trellis/tasks/10-27-script-narrative-translation-cure/research'
out=r/'chapter029-mainfresh-raw-20261111.json';assert not out.exists(),'Do not replay'
assert 'pass=true' in (r/'chapter029-entrance-final-independent-20261111.md').read_text()
m=json.loads((r/'chapter029-repair-backup-20261111/manifest.json').read_text())
paths=[r/name for name in m['targets']]+[Path(x) for x in m['readonly']]+[root/'apps/build/scripts/chapter029_review_verify_20261111.py']
start={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
command=[sys.executable,'-B',str(paths[-1]),'--negative-self-test'];when=datetime.now(timezone.utc).isoformat()
run=subprocess.run(command,cwd=root,capture_output=True,text=True);end={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
q=json.loads(run.stdout);verdict=run.returncode==0 and q['ok'] and start==end
record={'pass':verdict,'run_by':'primary /root','started_at_utc':when,'ended_at_utc':datetime.now(timezone.utc).isoformat(),'command':command,'exit_code':run.returncode,'runtime_start_sha256':start,'runtime_end_sha256':end,'stderr':run.stderr,'result':q}
out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps(record,ensure_ascii=False,indent=2))
raise SystemExit(0 if verdict else 1)
