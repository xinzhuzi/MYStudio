"""One-time read-only identity probe and evidence snapshot for371-390."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';c=json.loads((r/'fr-volumes-current-20261110.json').read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(371,391):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];p=Path(z['path']);raw=p.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':assert cd[n]['files'][role]['path']==str(p) and cd[n]['files'][role]['sha256']==h and len(raw)==z['bytes']==cd[n]['files'][role]['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(p),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==80 and digest=='529f183e92049bc82794c0278f5374059fe062ccf0047788bdc1161e780b9867'
paths=[Path(x) for x in subprocess.check_output(['fd','--hidden','--no-ignore','--max-depth','1','--type','f','^chapter(37[1-9]|38[0-9]|390)[-.]',str(r)],text=True).splitlines()];backups={p.name for p in paths if any(x in p.name for x in ['backup','.bak','before','pre-continuation'])};prefix=sorted(p.name for p in paths if p.name not in backups);assert len(prefix)==128 and len(backups)==233;assert not any(p.suffix=='.json' for p in paths)
revisions='''chapter371-continuation-review-1109-d.md
chapter372-timing-review-1109-refine372.md
chapter373-voice-continuation-review-refine373-1109.md
chapter374-continuation-review-1109-e.md
chapter375-continuation-review-1109-e.md
chapter376-continuation-review-1109-f.md
chapter377-continuation-review-1109-f.md
chapter378-source-sound-audit-1109-refine378.md
chapter379-continuation-review-1109-g.md
chapter380-continuation-review-1109-g.md
chapter381-continuation-review-1109-g.md
chapter382-continuation-review-1109-h.md
chapter383-continuation-review-1109-h.md
chapter384-continuation-review-1109-h.md
chapter385-continuation-review-1109-h.md
chapter386-integration-report-1109.md
chapter387-integration-review-1109-integrate387.md
chapter388-continuation-review-1109-i.md
chapter389-integration-review-20261109-integrate389.md
chapter390-continuation-report-1109-v390j.md'''.splitlines()
extra='''chapters369-372-independent-audit-1109.md
chapters371-374-375-audit-1109.md
chapters380-381-independent-audit-1109.md
chapters383-385-independent-audit-1109.md
chapters384-390-395-approved-fixes-1109.md
chapters384-394-395-independent-audit-1109.md
chapters386-388-audit-1109.md
chapters389-391-independent-audit-1109.md
chapters390-392-393-independent-audit-1109.md
fr-volumes-baseline-20261110.json
volume-one-coverage-1102.md
volume-one-progress.json
volume-one-resume-1102.md
volume-one-resume-1108.md'''.splitlines();scripts=['check_chapter386_integration_1109.py','check_chapter386_second_repair.py']
core={Path(bd[n]['files'][role]['path']).name for n in range(371,391) for role in ['screenplay','director-plan','storyboard']};core.update(f'chapter{n}-source-map-1104.md' for n in range(371,391));core.update(revisions);assert len(core)==100 and core.issubset(prefix);records={}
for name in set(prefix+extra+scripts)|backups:
 p=r/name;raw=p.read_bytes();records[name]={'basename':name,'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
groups={}
for label,names,count,expected in [('core',sorted(core),100,'1b93816c0af038831ba82a70caa4a8ea9cd2c5beeddaf1dd0fcb777708b2e608'),('prefix_evidence',prefix,128,'a6d3bfa55cd3f3ecbcf2fc5c7f76c657a30e0f6fd3a34ecf2e7430ba940b509a'),('prefix_support',sorted(set(prefix)-core),28,'e042d73eb2fb4402a185850a8eb88cb0a382756e8847f64a78b2e3f0ad9881e1'),('backups',sorted(backups),233,'3ff49b91eed4e51cb4a4216581c6670212d7da6491372e3dc321b91ca4b9e07c'),('historical_extra',sorted(extra),14,'dcbb126f1980672df68daec0ecfa55785d0b2af4ed582b7c0078b5623fe54c5e'),('support_scripts',sorted(scripts),2,'efe91aa7d1f455280cb59c34d6607f81c13083d0ab6f5e661edeb0242c3328ae'),('stable_extra',sorted(extra+scripts),16,'a4918cfc9ce86a5d0bf4b2341ddcf920a0b164ed91daf67f880823a1ae709169'),('stable_evidence',sorted(prefix+extra+scripts),144,'e8a6d266dc84e8098d4cb3e9c582e892109b6b7c7ef401f61fcdb52d421b964e'),('stable_support',sorted((set(prefix)|set(extra+scripts))-core),44,'15492c824944ad497e9f9c9d568b6d8ac93f3bef6da5f7f8005c397705bfdfbd')]:
 rows=[records[n] for n in names];assert len(rows)==count;h=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in rows).encode()).hexdigest();assert h==expected,(label,h);groups[label]={'count':count,'sha256':h,'bytes':sum(x['bytes'] for x in rows),'files':rows}
shared=[]
for name,expected,size in [('fr-volumes-current-20261110.json','40ee60bde97dbf2c64af118b8e6c4b7268d85477e18254bdc39d07d38319746d',706966),('fr-volumes-resume-20261110.md','cf9f4b162c3aa2acce0f44e3c702f7bd256164405fcb16b0f9c56d69179ff485',9005),('offline-progress.md','2cf58bcb083df1f2a38bbbca6d123b989cd1e376be982ccf570aaf0fb000615a',21677)]:
 p=(t if name=='offline-progress.md' else r)/name;raw=p.read_bytes();h=hashlib.sha256(raw).hexdigest();shared.append({'basename':name,'reviewer_snapshot_sha256':expected,'reviewer_bytes':size,'main_snapshot_sha256':h,'main_bytes':len(raw),'unchanged_since_reviewer':h==expected})
p=r/'fr-history-371-390-mainfresh-20261111.json';assert not p.exists();p.write_text(json.dumps({'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'reviewer':'/root/fr_history_371_390','checks_passed':80,'input_digest':digest,'inputs':inputs,'groups':groups,'revision_slots':revisions,'latest_chapter_json_count':0,'shared_task_snapshots':shared,'boundary':'Historical identity only; current full content review and main fresh still required. Shared task metadata may legitimately change as parent records other chapters.'},ensure_ascii=False,indent=2)+'\n');print(json.dumps({'pass':True,'inputs':80,'digest':digest,'groups':{k:{a:b for a,b in v.items() if a!='files'} for k,v in groups.items()},'shared_snapshot_matches':[x['unchanged_since_reviewer'] for x in shared]},ensure_ascii=False))
