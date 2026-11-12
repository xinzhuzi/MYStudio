"""Register chapter028 closure without rerunning repair or previously completed reviews."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];task=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=task/'research'
paths=[r/'fr-volumes-current-20261110.json',task/'task.json',task/'offline-progress.md',task/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};j=json.loads(old[paths[0]]);c=next(x for x in j['volume1']['chapters'] if x['chapter']==28)
assert c['status']=='targeted_p3_repair_done_pending_independent_review'
raw_name='chapter028-mainfresh-raw-20261111.json';raw=json.loads((r/raw_name).read_text());q=raw['result'];assert raw['pass'] and raw['exit_code']==0 and raw['runtime_start_sha256']==raw['runtime_end_sha256']
for path,h in raw['runtime_end_sha256'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==h,path
final='chapter028-clench-final-independent-20261111.md';assert 'pass=true' in (r/final).read_text()
b=r/('fr-close028-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:shutil.copy2(p,b/p.name)
for item in list(c['files'].values())+[c['execution_support']]:assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()==item['sha256']
fresh={'chapter':28,'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'scope':'Full independent content review, five bounded repairs with postfix review, last clench-chain repair with new independent review, primary fresh','command':raw['command'],'exit_code':0,'raw':raw_name,'source_sha256':q['actual_input_sha256_end']['source'],'input_sha256':{k:v['sha256'] for k,v in c['files'].items()},'execution_support_sha256':c['execution_support']['sha256'],'checks':q['current_checks'],'negative_controls_rejected':sum(x['caught'] for x in q['negative_controls']),'narrative_units':24,'seconds':611,'trial_shots':75,'trial_seconds':658,'new_narration_han':95,'full_independent_review':'chapter028-independent-full-20261111.md','postfix_review':'chapter028-postfix-independent-20261111.md','final_independent_review':final,'reviewer':'/root/fr028_clench_final_review','verifier_sha256':raw['runtime_end_sha256'][str(root/'apps/build/scripts/chapter028_review_verify_20261111.py')],'boundary':'Paper content only. Source seams and actual TTS/dynamics/media/audience/production remain unverified.'}
canonical='chapter028-mainfresh-20261110.json';assert not (r/canonical).exists();(r/canonical).write_text(json.dumps(fresh,ensure_ascii=False,indent=2)+'\n')
c.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,writer=None,owner=None,reviewer=fresh['reviewer'],p2_groups_open=0,p3_groups_open=0,next_action='Reuse current content and SHA. Do not repeat closed fixes or full review. Source seams, sound/action capacity and production remain separate.')
for name in [final,raw_name,canonical]:
 if name not in c['evidence']:c['evidence'].append(name)
j['volume1']['current_run_closed_chapters'].append(28);j['volume1']['current_run_closed_chapters'].sort()
summary='当前40章闭合（001—028、259—270）。028五项修复及最后握拳链11行均经不同审阅者复核，主fresh exit0、285检查/32负例通过；611/658秒与95字旁白保持，旧失败报告保留。029/030独占局修在途，已批准必要纸面扩窗。闭合身份未变章及全卷历史对账不重复。'
j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='40 reusable closed (001-028,259-270);029/030 targeted repairs active with approved paper expansion, then independent postfix reviews and primary fresh;031 next content review.'
t=json.loads(old[task/'task.json']);t['offlineTrack']['last_checkpoint']=j['next_action'];out={paths[0]:json.dumps(j,ensure_ascii=False,indent=2)+'\n',task/'task.json':json.dumps(t,ensure_ascii=False,indent=2)+'\n'}
p=task/'offline-progress.md';lines=old[p].decode().splitlines();idx=[i for i,x in enumerate(lines) if x.startswith('> 最新状态：')];assert len(idx)==1;lines[idx[0]]='> 最新状态：'+summary;s='\n'.join(lines)+'\n';anchor=next(x for x in lines if x.startswith('|260|12／104'))
s=s.replace(anchor,'|028|24单元611；75镜658（分账）|[全文独审](research/chapter028-independent-full-20261111.md)、[五项修后独审](research/chapter028-postfix-independent-20261111.md)及[握拳链最终独审](research/chapter028-clench-final-independent-20261111.md)|[exit0；285检查/32负例](research/chapter028-mainfresh-20261110.json)|原角色声保留、95字旁白；两次握拳同源序，源缝/动态另列|\n'+anchor,1)
s=s.replace('此表是本次明确闭合的37章，另有259／261历史复用，合计39章（001—027及259—270）','此表是本次明确闭合的38章，另有259／261历史复用，合计40章（001—028及259—270）',1);out[p]=s+'\n> 最新接续：'+summary+' 本条取代此前在途快照。\n'
p=task/'prd.md';lines=old[p].decode().splitlines();idx=[i for i,x in enumerate(lines) if x.startswith('> **2026-11-11 最新离线进度**')];assert len(idx)==1;lines[idx[0]]='> **2026-11-11 最新离线进度**：'+summary;out[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
for p in paths:assert p.read_bytes()==old[p]
for p in paths:p.write_text(out[p])
print(json.dumps({'chapter':28,'closed_total':40,'five_documents_synced':True,'backup':str(b)},ensure_ascii=False))
