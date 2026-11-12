"""Read-only historical identity probe; save the successful evidence snapshot once."""
from pathlib import Path
from datetime import datetime, timezone
import json, hashlib, subprocess
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
c=json.loads((r/'fr-volumes-current-20261110.json').read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text())
bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(351,371):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];p=Path(z['path']);raw=p.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':assert cd[n]['files'][role]['path']==str(p) and cd[n]['files'][role]['sha256']==h and len(raw)==z['bytes']==cd[n]['files'][role]['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(p),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='f395ee8fab829f1b834a4e788a33c0dc6e847209a126b2f8f1baead405282634'
paths=[Path(x) for x in subprocess.check_output(['fd','--hidden','--no-ignore','--max-depth','1','--type','f','^chapter(35[1-9]|36[0-9]|370)[-.]',str(r)],text=True).splitlines()]
backups={p.name for p in paths if any(x in p.name for x in ['backup','.bak','before']) and not p.name.endswith('-handoff-before.json')}
prefix=sorted(p.name for p in paths if p.name not in backups);assert len(prefix)==201 and len(backups)==151
extra=['chapter336-355-current-status-1110.md','chapters350-352-independent-audit-1109.md','chapters353-355-independent-audit-1109.md','chapters356-358-independent-audit-1109.md','chapters367-368-370-independent-audit-1109.md','chapters369-372-independent-audit-1109.md','fr-volumes-baseline-20261110.json','fr-volumes-current-20261110.json','fr-volumes-resume-20261110.md','offline-progress.md','volume-one-coverage-1102.md','volume-one-progress.json','volume-one-resume-1102.md','volume-one-resume-1108.md']
revisions=[f'chapter{n}-revision-review.md' for n in range(351,359)]+['chapter359-handoff-review.md','chapter360-revision-review-1109-c360.md','chapter361-revision-review-1109.md','chapter362-revision-review-1109.md','chapter363-continuation-review-1109-finish363.md','chapter364-continuation-review-1109-verify364.md','chapter365-continuation-review-1109-verify365.md','chapter366-continuation-review-1109-verify366.md','chapter367-continuation-review-1109-b.md','chapter368-continuation-review-1109-c.md','chapter369-continuation-review-1109-c.md','chapter370-continuation-review-1109-d.md']
core={Path(bd[n]['files'][role]['path']).name for n in range(351,371) for role in ['screenplay','director-plan','storyboard']};core.update(f'chapter{n}-source-map-1104.md' for n in range(351,371));core.update(revisions);assert len(core)==100 and core.issubset(prefix)
records={}
for name in set(prefix+extra)|backups:
 p=(t if name=='offline-progress.md' else r)/name;raw=p.read_bytes();records[name]={'basename':name,'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
latest=[];latest_names=[];counts=[952,858,915,820,944,1044,974,927]
for n,count in zip(range(351,359),counts):
 v=2 if n==352 else 3;hn=f'chapter{n}-mainfresh-handoff-v{v}.json';sn=f'chapter{n}-mainfresh-structure-v2.json';hj=json.loads((r/hn).read_text());sj=json.loads((r/sn).read_text());assert hj['summary']['pass'] and hj['summary']['checks']==count and hj['source_sha256']==bs[n]['sha256']
 sf=next(x for x in sj['chapters'] if x['chapter']==n)['files']
 for role in ['screenplay','director-plan','storyboard']:assert hj['current_sha256'][role]==sf[role]['sha256']==bd[n]['files'][role]['sha256']
 latest.append({'chapter':n,'handoff':hn,'structure':sn,'historical_checks':count,'mismatched_roles':[],'scope':hj['scope'],'independent_content_review':False});latest_names += [hn,sn]
sets=[('core',sorted(core),100,'f1919fc7501ed02737a802e406d3251aa50c9dd4910ea2b8e3e83d74f639719c'),('prefix_evidence',prefix,201,'48868ae1b045d1cadf07dc11ba5af8db8039a26d19cec584d5e8e1320b95debc'),('prefix_support',sorted(set(prefix)-core),101,'024cc424af6d4030b55dc94d8e451d873764c04ac9a5fd065ab2f60a29f924cb'),('extra',sorted(extra),14,'1682e7c2f0adbc314cbff5a63c08cf2cb9d943c3a29556dd27bb3485a9372df5'),('evidence',sorted(prefix+extra),215,'3438d07e8920cc852168ece577c8910912cbe0c86e37bf05ac5ab048e9a2976d'),('support',sorted((set(prefix)|set(extra))-core),115,'d92f93e0a2641e5823c24eecf8f717e437482824b3234756ccc6c2635aea9beb'),('backups',sorted(backups),151,'7ddc304580bcbaab6951f041622d12bd3fcbdc53652c655b51b5746474a3b28f'),('latest_json',sorted(latest_names),16,'0ec4cbe086e57f4d622b58274df2cec126481c4aa1aa5d8f29aa428d3b2aad0c')]
groups={}
for label,names,count,expected in sets:
 rows=[records[n] for n in names];assert len(rows)==count
 h=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in rows).encode()).hexdigest();assert h==expected,(label,h)
 groups[label]={'count':count,'bytes':sum(x['bytes'] for x in rows),'sha256':h,'files':rows}
p=r/'fr-history-351-370-mainfresh-20261111.json';assert not p.exists()
p.write_text(json.dumps({'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'reviewer':'/root/fr_history_351_370','checks_passed':80,'input_digest':digest,'inputs':inputs,'groups':groups,'latest_report_identity':latest,'historical_latest_checks':sum(counts),'boundary':'Historical identity and evidence reconciliation only; no manuscript content closure. Extra shared task files are this pre-registration snapshot and will change when results are registered.'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'input_count':80,'input_digest':digest,'groups':{k:{a:b for a,b in v.items() if a!='files'} for k,v in groups.items()},'matched_latest_roles':48,'historical_checks_not_rerun':sum(counts)},ensure_ascii=False))
