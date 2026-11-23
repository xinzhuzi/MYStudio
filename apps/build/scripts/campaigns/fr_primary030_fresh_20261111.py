"""Primary one-time fresh run for chapter030, preserving actual runtime hashes."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,sys
root=Path(__file__).resolve().parents[3];r=root/'.trellis/tasks/10-27-script-narrative-translation-cure/research'
out=r/'chapter030-mainfresh-raw-20261111.json';assert not out.exists(),'Do not replay completed primary fresh'
review=(r/'chapter030-postfix-independent-20261111.md').read_text();assert 'pass=true' in review
m=json.loads((r/'chapter030-review-backup-20261111/start-sha256.json').read_text())
paths=[Path(x['path']) for x in m['files'].values()]+[root/'apps/build/scripts/chapter030_review_verify_20261111.py']
start={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
command=[sys.executable,'-B',str(paths[-1])];when=datetime.now(timezone.utc).isoformat()
run=subprocess.run(command,cwd=root,capture_output=True,text=True)
end={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
result=json.loads(run.stdout)
verdict=run.returncode==0 and result['pass'] and start==end
record={'pass':verdict,'run_by':'primary /root','started_at_utc':when,'ended_at_utc':datetime.now(timezone.utc).isoformat(),'command':command,'exit_code':run.returncode,'runtime_start_sha256':start,'runtime_end_sha256':end,'stderr':run.stderr,'result':result}
out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in record.items() if k!='result'},ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in result.items() if k not in ('voice_load','changes')},ensure_ascii=False,indent=2))
assert len(result['voice_load'])==85 and len(result['changes'])==4
raise SystemExit(0 if verdict else 1)
