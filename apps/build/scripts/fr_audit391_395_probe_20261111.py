"""Verify last five chapter historical identities without rerunning old work."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';c=json.loads((r/'fr-volumes-current-20261110.json').read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(391,396):
 assert cd[n]['status']=='pending_evidence_audit'
 for role in ['source','screenplay','director-plan','storyboard']:
  z=bs[n] if role=='source' else bd[n]['files'][role];p=Path(z['path']);raw=p.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':assert cd[n]['files'][role]['path']==str(p) and cd[n]['files'][role]['sha256']==h and len(raw)==z['bytes']==cd[n]['files'][role]['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(p),'sha256':h,'bytes':len(raw)})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\t{x['bytes']}\n" for x in inputs).encode()).hexdigest();assert len(inputs)==20 and digest=='59bbb813c05cb8158b400eed119b2df80e9422a10fc539dd255cfb0fbc6ab87a'
paths=[Path(x) for x in subprocess.check_output(['fd','--hidden','--no-ignore','--max-depth','1','--type','f','^chapter39[1-5][-.]',str(r)],text=True).splitlines()];all_prefix=sorted(p.name for p in paths);backups={p.name for p in paths if any(x in p.name for x in ['.bak','-before-','.before-','.pre-'])};prefix=sorted(set(all_prefix)-backups);assert len(paths)==97 and len(backups)==66 and len(prefix)==31;assert not any((r/n).suffix=='.json' for n in prefix)
revisions=['chapter391-continuation-report-v391j-1109.md','chapter392-report-v392j-1109.md','chapter393-continuation-report-1109.md','chapter394-continuation-review-1109-v394k.md','chapter395-continuation-report-v395k-1109.md'];audit=['chapters389-391-independent-audit-1109.md','chapters390-392-393-independent-audit-1109.md','chapters384-394-395-independent-audit-1109.md','chapters384-390-395-approved-fixes-1109.md'];extra=['fr-current-inventory-20261110.md','fr-source-integrity-20261110.json','fr-volumes-baseline-20261110.json','volume-one-coverage-1102.md','volume-one-draft-inventory-1105.md','volume-one-progress.json','volume-one-resume-1102.md','volume-one-resume-1108.md','volume-one-static-baseline-1107.json','volume-one-handoff-static-1108.json','volume-one-handoff-findings-1108.md','volume-one-handoff-recovery-1108.md']
extra_bak='''volume-one-progress.before-approved-384-390-395-1109.bak
volume-one-progress.before-chapters384-394-395-audit-1109.json
volume-one-progress.before-chapters389-391-audit-1109.json
volume-one-progress.before-chapters390-392-393-audit-1109.json
volume-one-resume-1102.md.bak-20261110-075735-695163
volume-one-resume-1102.md.bak-20261110-075954-824357
volume-one-resume-1102.md.bak-20261110-080146-255204
volume-one-resume-1102.md.bak-20261110-080405-586505
volume-one-resume-1102.md.bak-20261110-392shot30voice
volume-one-resume-1102.md.bak-20261110-393voice-1
volume-one-resume-1102.md.bak-20261110-393voice-2
volume-one-resume-1102.md.bak-20261110-393voice-final
volume-one-resume-1102.md.bak-20261110-394voice-ledger
volume-one-resume-1102.md.bak-20261110-395voice-ledger'''.splitlines()
core={Path(bd[n]['files'][role]['path']).name for n in range(391,396) for role in ['screenplay','director-plan','storyboard']};core.update(f'chapter{n}-source-map-1104.md' for n in range(391,396));core.update(revisions);assert len(core)==25 and core.issubset(prefix);records={}
for name in set(all_prefix+audit+extra+extra_bak):
 p=r/name;raw=p.read_bytes();records[name]={'basename':name,'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
groups={}
for label,names,count,expected in [('all_prefix',all_prefix,97,'cd2bc2d49da6119a38cbb27b4b1a276e8323f2c43603ecc308c2a8ef9437b02b'),('core',sorted(core),25,'38275c41ed984917726163eef091e43340dbc19d1f8e285b5d7a5a0fb104b2d5'),('prefix_support',sorted(set(prefix)-core),6,'0f7be86cb436246c866ee60218ac19af2d7da37d2db24072988274b46219a898'),('audit_support',sorted(audit),4,'5ac1274114d236feee2008a007bc1c747bc644e6cbb3663d141a54e6dad6c9b0'),('extra',sorted(extra),12,'1f84fad368a6aa69d121cec8f27137affbc4a8dda7570d7ec3d56de2838f4e44'),('stable_support',sorted((set(prefix)|set(audit+extra))-core),22,'3386b372be616a87d9ea5c6ef237b9bb830870e56fc81eed887cad23300e6ab8'),('stable_evidence',sorted(prefix+audit+extra),47,'48437fe7cc2f684a4dfdd687764d10591d444e03c872116b51571f47e5e03382'),('prefix_backups',sorted(backups),66,'2dfa8fc2b8b2c9183fd36fe0251e09dd3584e547ead205362b1880b71f836e0d'),('summary_backups',sorted(extra_bak),14,'084db98ee0adec46effd3e2c75ff5a29aba0a7bb2616814a68fb32fe919fe61d'),('all_backups',sorted(backups|set(extra_bak)),80,'a85e5b3f8c69dcbcc52e9aa3bbd0a7d20310ff613055e9c2995edcdb84f61965')]:
 rows=[records[n] for n in names];assert len(rows)==count;h=hashlib.sha256(''.join(f"{x['basename']}\t{x['sha256']}\t{x['bytes']}\n" for x in rows).encode()).hexdigest();assert h==expected,(label,h);groups[label]={'count':count,'sha256':h,'bytes':sum(x['bytes'] for x in rows),'files':rows}
stale=[]
for name in ['volume-one-static-baseline-1107.json','volume-one-handoff-static-1108.json']:
 j=json.loads((r/name).read_text());chapters={x['chapter']:x for x in j['chapters']};matches=[]
 for n in range(391,396):
  for role in ['screenplay','director-plan','storyboard']:
   if chapters[n]['files'][role]['sha256']==bd[n]['files'][role]['sha256']:matches.append([n,role])
 assert not matches;stale.append({'report':name,'current_matched_roles':0,'total_roles':15,'scope':j['limitations']})
p=r/'fr-history-391-395-mainfresh-20261111.json';assert not p.exists();p.write_text(json.dumps({'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'reviewer':'/root/fr_history_391_395','checks_passed':20,'input_digest':digest,'inputs':inputs,'groups':groups,'revision_slots':revisions,'chapter_json_count':0,'stale_global_reports':stale,'boundary':'Historical evidence identity only. Shared mutable task metadata excluded. Full current content review and main fresh still required.'},ensure_ascii=False,indent=2)+'\n');print(json.dumps({'pass':True,'inputs':20,'input_digest':digest,'groups':{k:{a:b for a,b in v.items() if a!='files'} for k,v in groups.items()},'global_reports_current_matches':[x['current_matched_roles'] for x in stale]},ensure_ascii=False))
