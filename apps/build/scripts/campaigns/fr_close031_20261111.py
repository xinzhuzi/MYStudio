"""Close031 from independent review plus primary fresh; no repair replay."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
c=next(x for x in d['volume1']['chapters'] if x['chapter']==31);assert c['status']=='independent_postfix_review_in_progress'
raw=json.loads((r/'chapter031-mainfresh-raw-20261111.json').read_text());q=raw['result'];assert raw['pass'] and raw['exit_code']==0 and raw['runtime_start_sha256']==raw['runtime_end_sha256']
for s,h in raw['runtime_end_sha256'].items():assert hashlib.sha256(Path(s).read_bytes()).hexdigest()==h,s
for v in [*c['files'].values(),c['execution_support']]:assert hashlib.sha256(Path(v['path']).read_bytes()).hexdigest()==v['sha256']
b=json.loads((r/'chapter031-repair-backup-20261111/manifest.json').read_text());final='chapter031-postfix-independent-20261111.md';assert 'pass=true' in (r/final).read_text()
fresh={'chapter':31,'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'scope':'Full initial content review; ten groups repaired, seven primary synchronization lines, independent all68 differences/810 mapping fields, primary fresh','command':raw['command'],'exit_code':0,'raw':'chapter031-mainfresh-raw-20261111.json','source_sha256':raw['runtime_end_sha256'][b['source']['path']],'input_sha256':{k:v['sha256'] for k,v in c['files'].items()},'execution_support_sha256':c['execution_support']['sha256'],'checks':q['checks'],'negative_controls_rejected':len(q['negative_tests']),'narrative_units':19,'seconds':1010,'trial_shots':162,'trial_seconds':1496,'full_independent_review':'chapter031-independent-full-20261111.md','postfix_review':final,'final_independent_review':final,'reviewer':'/root/fr031_diff_independent_retry','verifier_sha256':raw['runtime_end_sha256'][str(root/'apps/build/scripts/chapter031_review_verify_20261111.py')],'boundary':'Offline content only; source seams, actual TTS/read-through/dynamics/media/audience/production unverified.'}
canonical=r/'chapter031-mainfresh-20261110.json';assert not canonical.exists();canonical.write_text(json.dumps(fresh,ensure_ascii=False,indent=2)+'\n')
c.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,writer=None,owner=None,reviewer='/root/fr031_diff_independent_retry',p2_groups_open=0,p3_groups_open=0,next_action='Reuse current source/draft/all execution-support SHA. Do not repeat completed repair, full review or historical audit. Source seams and production remain separate.')
c['evidence'] += [final,'chapter031-mainfresh-raw-20261111.json',canonical.name];assert 31 not in d['volume1']['current_run_closed_chapters'];d['volume1']['current_run_closed_chapters'].append(31);d['volume1']['current_run_closed_chapters'].sort()
summary='当前44章闭合（001—032、259—270）。031十组/7行同步及全部68差异独审通过，主fresh exit0、430/430和15负例；032八组/45差异/六标签独审及主fresh已闭合。两章现SHA登记直接复用，不重做。033八组定点修复、034现稿全文独审在途；全卷历史对账沿用。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='44 reusable closed (001-032,259-270).031 and032 independent reviews and primary fresh closed with current SHA.033 eight-group repair active;034 full current review active. No completed-work replay.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+summary;s='\n'.join(lines)+'\n'
 if p.name=='offline-progress.md':
  anchor=next(l for l in lines if l.startswith('|032|18单元'))
  s=s.replace(anchor,'|031|19单元1010；162镜1496（分账）|[全文独审](research/chapter031-independent-full-20261111.md)及[全部68差异独审](research/chapter031-postfix-independent-20261111.md)|[exit0；430检查/15负例](research/chapter031-mainfresh-20261110.json)|两原表及汇编SHA纳入；源缝/真实声音/动态另列|\n'+anchor,1)
  before='此表是本次明确闭合的41章，另有259／261历史复用，合计43章（001—030、032及259—270）';assert before in s;s=s.replace(before,'此表是本次明确闭合的42章，另有259／261历史复用，合计44章（001—032及259—270）',1)
 out[p]=s
p=paths[-1];out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
b=r/('fr-close031-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print(json.dumps({'closed':31,'total':44,'five_documents_synced':True},ensure_ascii=False))
