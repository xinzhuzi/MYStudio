"""Run the primary chapter checks once, retaining actual runtime input identities."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys
root=Path(__file__).resolve().parents[3];r=root/'.trellis/tasks/10-27-script-narrative-translation-cure/research'
ledger=json.loads((r/'fr-volumes-current-20261110.json').read_text());baseline=json.loads((r/ledger['baseline']).read_text())
for n in [26,27]:
 row=next(c for c in ledger['volume1']['chapters'] if c['chapter']==n)
 source=Path(next(c['path'] for c in baseline['volumes'][0]['chapters'] if c['chapter']==n))
 script=root/f'apps/build/scripts/chapter{n:03d}_review_verify_20261111.py'
 report=r/f'chapter{n:03d}-postfix-independent-20261111.md'
 assert 'pass=true' in report.read_text()
 paths=[source,*[Path(v['path']) for v in row['files'].values()],Path(row['execution_support']['path']),*[Path(v['path']) for v in row.get('additional_execution_support',[])],script,report]
 output=r/f'chapter{n:03d}-mainfresh-raw-20261111.json';assert not output.exists(), 'Do not repeat already recorded main fresh'
 before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
 started=datetime.now(timezone.utc).isoformat()
 command=[sys.executable,'-B',str(script)]+(['--self-test'] if n==26 else [])
 run=subprocess.run(command,cwd=root,capture_output=True,text=True)
 after={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
 result=json.loads(run.stdout) if run.stdout.strip() else None
 envelope={'chapter':n,'started_at_utc':started,'ended_at_utc':datetime.now(timezone.utc).isoformat(),'command':command,'exit_code':run.returncode,'runtime_start_sha256':before,'runtime_end_sha256':after,'inputs_unchanged':before==after,'stderr':run.stderr,'result':result,'pass':run.returncode==0 and before==after and result is not None and result.get('ok' if n==26 else 'pass') is True}
 output.write_text(json.dumps(envelope,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'chapter':n,'exit_code':run.returncode,'pass':envelope['pass'],'inputs_unchanged':before==after,'result_keys':list(result) if result else None,'summary':result.get('summary') if result else None,'results':result.get('results') if result and n==27 else None,'raw':str(output)},ensure_ascii=False))
 if not envelope['pass']:sys.exit(1)
