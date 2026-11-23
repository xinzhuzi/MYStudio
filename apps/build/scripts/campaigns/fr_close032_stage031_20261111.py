"""Close032 on fresh evidence; record031 completed implementation without replay."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
raw=json.loads((r/'chapter032-mainfresh-raw-20261111.json').read_text());q=raw['result'];assert raw['pass'] and raw['exit_code']==0 and raw['runtime_start_sha256']==raw['runtime_end_sha256']
for s,h in raw['runtime_end_sha256'].items():assert hashlib.sha256(Path(s).read_bytes()).hexdigest()==h,s
c=next(x for x in d['volume1']['chapters'] if x['chapter']==32);assert c['status']=='targeted_repair_complete_pending_independent'
for v in [*c['files'].values(),c['execution_support']]:
 p=Path(v['path']);v.update(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size)
baseline=json.loads((r/'chapter032-review-repair-backup-20261111.json').read_text());final='chapter032-postfix-independent-20261111.md';assert 'pass=true' in (r/final).read_text()
fresh={'chapter':32,'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'scope':'Full initial content review, eight-group repair plus primary handoff fixes, independent all45 differences and six historical labels, primary fresh','command':raw['command'],'exit_code':0,'raw':'chapter032-mainfresh-raw-20261111.json','source_sha256':raw['runtime_end_sha256'][baseline['source']['path']],'input_sha256':{k:v['sha256'] for k,v in c['files'].items()},'execution_support_sha256':c['execution_support']['sha256'],'checks':61,'checks_definition':'8 grouped source-carrier checks plus53 voice/action/narration checks; structure, protected units, identity gates additionally true','negative_controls_rejected':12,'narrative_units':18,'seconds':934,'trial_shots':130,'trial_seconds':1252,'full_independent_review':'chapter032-independent-full-20261111.md','postfix_review':final,'final_independent_review':final,'reviewer':'/root/fr032_diff_independent','verifier_sha256':raw['runtime_end_sha256'][str(root/'apps/build/scripts/chapter032_review_verify_20261111.py')],'boundary':'Offline content only; source seams, actual TTS/read-through/dynamics/media/audience/production unverified.'}
canonical=r/'chapter032-mainfresh-20261110.json';assert not canonical.exists();canonical.write_text(json.dumps(fresh,ensure_ascii=False,indent=2)+'\n')
c.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,writer=None,owner=None,reviewer='/root/fr032_diff_independent',p2_groups_open=0,p3_groups_open=0,next_action='Reuse closed current source/draft/execution SHA; no repeated repair, full review or history audit. Source seams and production validation remain separate.')
c['evidence'] += [final,'chapter032-mainfresh-raw-20261111.json',canonical.name]
c['failed_review_attempt']={'agent':'/root/fr032_postfix_review','reason':'429; zero review result','request_id':'95bbc0de-4510-4f0d-be57-86005c431eec'}
assert 32 not in d['volume1']['current_run_closed_chapters'];d['volume1']['current_run_closed_chapters'].append(32);d['volume1']['current_run_closed_chapters'].sort()
a=next(x for x in d['volume1']['chapters'] if x['chapter']==31);assert a['status']=='partial_repair_primary_takeover'
for v in [*a['files'].values(),a['execution_support']]:
 p=Path(v['path']);v.update(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size)
a.update(status='targeted_repair_complete_pending_independent',writer=None,owner=None,reviewer=None,repair_report='chapter031-review-repair-20261111.md',repair_snapshot='chapter031-repair-handoff-20261111.json',repair_validation='chapter031-handoff-verification-20261111.json',next_action='Ten-group repair and primary seven-line synchronization complete; only new independent all68 differences/affected-window review, then primary fresh. No replay/full initial review.')
a['evidence'] += ['chapter031-review-repair-20261111.md','chapter031-handoff-verification-20261111.json']
summary='当前43章闭合（001—030、032、259—270）。032全部45差异及六个历史标签独审通过，主fresh exit0、8组+53检查/12负例，现SHA已登记。031十组及三稿7行同步已修完，自验430/430与15负例通过，只接差异独审和主fresh；033八组已核源待修。闭合身份未变章、完成初审及全卷历史对账不重复。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='43 reusable closed (001-030,032,259-270).031 implementation and primary sync complete; independent68 differences review then primary fresh.033 verified findings repair pending. Reuse completed unchanged evidence.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+summary;s='\n'.join(lines)+'\n'
 if p.name=='offline-progress.md':
  anchor=next(l for l in lines if l.startswith('|260|12／104'))
  s=s.replace(anchor,'|032|18单元934；130镜1252（分账）|[全文独审](research/chapter032-independent-full-20261111.md)及[全部差异/六标签独审](research/chapter032-postfix-independent-20261111.md)|[exit0；8组+53检查/12负例](research/chapter032-mainfresh-20261110.json)|603字旁白；源缝/真实声音/动态另列|\n'+anchor,1)
  before='此表是本次明确闭合的40章，另有259／261历史复用，合计42章（001—030及259—270）';assert before in s;s=s.replace(before,'此表是本次明确闭合的41章，另有259／261历史复用，合计43章（001—030、032及259—270）',1)
 out[p]=s
p=paths[-1];out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
b=r/('fr-close032-stage031-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
print(json.dumps({'closed_chapter':32,'total':43,'031':'implementation_complete_pending_independent','five_documents_synced':True},ensure_ascii=False))
