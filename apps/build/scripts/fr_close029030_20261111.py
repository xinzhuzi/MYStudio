"""One-time registration of two completed chapters. No validation or repair replay."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];task=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=task/'research'
paths=[r/'fr-volumes-current-20261110.json',task/'task.json',task/'offline-progress.md',task/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};j=json.loads(old[paths[0]])
base=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());sources={c['chapter']:c for v in base['volumes'] for c in v['chapters']}
b=r/('fr-close029030-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:shutil.copy2(p,b/p.name)
for n in (29,30):
 c=next(x for x in j['volume1']['chapters'] if x['chapter']==n)
 assert c['status'] in ('targeted_p3_repair_done_pending_independent_review','independent_postfix_passed_primary_fresh_pending')
 raw_name=f'chapter{n:03d}-mainfresh-raw-20261111.json';raw=json.loads((r/raw_name).read_text());q=raw['result']
 assert raw['pass'] and raw['exit_code']==0 and raw['runtime_start_sha256']==raw['runtime_end_sha256']
 for path,h in raw['runtime_end_sha256'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==h,path
 final='chapter029-entrance-final-independent-20261111.md' if n==29 else 'chapter030-postfix-independent-20261111.md'
 assert 'pass=true' in (r/final).read_text()
 for item in list(c['files'].values())+[c['execution_support']]:assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()==item['sha256']
 reviewer='/root/fr029_entrance_final_review' if n==29 else '/root/fr030_postfix_review'
 fresh={'chapter':n,'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'scope':'Full content review followed by bounded repairs, independent complete repair-difference review and primary fresh; chapter029 final entrance-line separately reviewed','command':raw['command'],'exit_code':0,'raw':raw_name,'source_sha256':raw['runtime_end_sha256'][sources[n]['path']],'input_sha256':{k:v['sha256'] for k,v in c['files'].items()},'execution_support_sha256':c['execution_support']['sha256'],'checks':q['checks'] if n==29 else q['results'][0]['checks'],'negative_controls_rejected':8 if n==29 else 20,'narrative_units':q['budget']['units'],'seconds':q['budget']['unit_seconds'],'trial_shots':q['budget']['shots'],'trial_seconds':q['budget']['shot_seconds'],'full_independent_review':f'chapter{n:03d}-independent-full-20261111.md','postfix_review':f'chapter{n:03d}-postfix-independent-20261111.md','final_independent_review':final,'reviewer':reviewer,'verifier_sha256':raw['runtime_end_sha256'][str(root/f'apps/build/scripts/chapter{n:03d}_review_verify_20261111.py')],'boundary':'Offline content only; source seams, real TTS/read-through/dynamics/media/audience/production remain unverified.'}
 canonical=f'chapter{n:03d}-mainfresh-20261110.json';assert not (r/canonical).exists();(r/canonical).write_text(json.dumps(fresh,ensure_ascii=False,indent=2)+'\n')
 c.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,writer=None,owner=None,reviewer=reviewer,p2_groups_open=0,p3_groups_open=0,next_action='Reuse current content and SHA. Do not repeat completed fixes, full review or history audit. Source seams and production validation remain separate.')
 for name in (final,raw_name,canonical):
  if name not in c['evidence']:c['evidence'].append(name)
 assert n not in j['volume1']['current_run_closed_chapters'];j['volume1']['current_run_closed_chapters'].append(n)
j['volume1']['current_run_closed_chapters'].sort()
summary='当前42章闭合（001—030、259—270）。029七项修后独审及最后入场摘要一行新独审完成，主fresh exit0、321检查/8负例；030全部差异与85镜声栏独审通过，主fresh exit0、550检查/20负例。两章719/903秒及683/809秒分别分账，实际声音/动态未验。031新审阅者正在交回全文内容结果；已闭合身份未变章及全卷历史对账不重复。'
j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='42 reusable closed (001-030,259-270);031 new full content review active, then primary evidence checks and only confirmed repairs.032 next pending content review. Do not repeat completed work.'
t=json.loads(old[task/'task.json']);t['offlineTrack']['last_checkpoint']=j['next_action'];out={paths[0]:json.dumps(j,ensure_ascii=False,indent=2)+'\n',task/'task.json':json.dumps(t,ensure_ascii=False,indent=2)+'\n'}
p=task/'offline-progress.md';lines=old[p].decode().splitlines();hits=[i for i,x in enumerate(lines) if x.startswith('> 最新状态：')];assert len(hits)==1;lines[hits[0]]='> 最新状态：'+summary
s='\n'.join(lines)+'\n';anchor=next(x for x in lines if x.startswith('|260|12／104'))
rows='|029|21单元719；97镜903（分账）|[全文独审](research/chapter029-independent-full-20261111.md)、[修后独审](research/chapter029-postfix-independent-20261111.md)及[最后一行独审](research/chapter029-entrance-final-independent-20261111.md)|[exit0；321检查/8负例](research/chapter029-mainfresh-20261110.json)|原46声保留、423字旁白；源缝/实读/动态另列|\n|030|15单元683；85镜809（分账）|[全文独审](research/chapter030-independent-full-20261111.md)及[全部差异独审](research/chapter030-postfix-independent-20261111.md)|[exit0；550检查/20负例](research/chapter030-mainfresh-20261110.json)|971有效声字只为纸面负荷；源缝/实读/动态另列|\n'
s=s.replace(anchor,rows+anchor,1);before='此表是本次明确闭合的38章，另有259／261历史复用，合计40章（001—028及259—270）';assert before in s;s=s.replace(before,'此表是本次明确闭合的40章，另有259／261历史复用，合计42章（001—030及259—270）',1);out[p]=s+'\n> 最新接续：'+summary+' 本条取代此前在途快照。\n'
p=task/'prd.md';lines=old[p].decode().splitlines();hits=[i for i,x in enumerate(lines) if x.startswith('> **2026-11-11 最新离线进度**')];assert len(hits)==1;lines[hits[0]]='> **2026-11-11 最新离线进度**：'+summary+' 第一卷整体及第二卷仍未完成。';out[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
for p in paths:assert p.read_bytes()==old[p],f'Concurrent change: {p}'
for p in paths:p.write_text(out[p])
print(json.dumps({'closed':[29,30],'closed_total':42,'five_documents_synced':True,'backup':str(b)},ensure_ascii=False))
