"""One-time closeout using completed independent reviews and primary runtime evidence."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil
root=Path(__file__).resolve().parents[3];task=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=task/'research'
paths=[r/'fr-volumes-current-20261110.json',task/'task.json',task/'offline-progress.md',task/'prd.md',r/'fr-volumes-resume-20261110.md']
original={p:p.read_bytes() for p in paths};ledger=json.loads(original[paths[0]])
backup=r/('fr-close026027-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for p in paths:shutil.copy2(p,backup/p.name)
baseline=json.loads((r/ledger['baseline']).read_text())
for n in [26,27]:
 c=next(x for x in ledger['volume1']['chapters'] if x['chapter']==n);assert c['status']=='targeted_repair_done_pending_independent_review'
 raw_name=f'chapter{n:03d}-mainfresh-raw-20261111.json';raw=json.loads((r/raw_name).read_text());q=raw['result']
 assert raw['pass'] and raw['exit_code']==0 and raw['runtime_start_sha256']==raw['runtime_end_sha256']
 for path,expected in raw['runtime_end_sha256'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==expected,path
 report=f'chapter{n:03d}-postfix-independent-20261111.md';assert 'pass=true' in (r/report).read_text()
 if n==26:
  for role,item in zip(['sound-cues','sound-placement-01-12','sound-placement-13-36'],c['additional_execution_support']):c['files'][role]=item.copy()
 source=next(x for x in baseline['volumes'][0]['chapters'] if x['chapter']==n)
 source_sha=hashlib.sha256(Path(source['path']).read_bytes()).hexdigest();assert source_sha==source['sha256']
 for item in list(c['files'].values())+[c['execution_support']]:assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()==item['sha256']
 checks=q['checks'] if n==26 else q['results'][0]['checks'];neg=q['negative_passed'] if n==26 else sum(x.get('caught') is True for x in q['results'][1:])
 canonical=f'chapter{n:03d}-mainfresh-20261110.json';assert not (r/canonical).exists()
 fresh={'chapter':n,'pass':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'scope':'Existing full independent review, bounded repair, different independent postfix review, primary fresh; paper content only','command':raw['command'],'exit_code':0,'raw':raw_name,'source_sha256':source_sha,'input_sha256':{k:v['sha256'] for k,v in c['files'].items()},'execution_support_sha256':c['execution_support']['sha256'],'checks':checks,'checks_include_negative_controls':n==26,'negative_controls_rejected':neg,'budgets':q['budgets'],'full_independent_review':f'chapter{n:03d}-independent-full-20261111.md','postfix_independent_review':report,'reviewer':f'/root/fr{n:03d}_postfix_review','verifier_sha256':raw['runtime_end_sha256'][str(root/f'apps/build/scripts/chapter{n:03d}_review_verify_20261111.py')],'boundary':'Only offline paper content. Source seams remain; actual TTS, dynamics, media, audience and production not verified.'}
 (r/canonical).write_text(json.dumps(fresh,ensure_ascii=False,indent=2)+'\n')
 c.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,reviewer=fresh['reviewer'],writer=None,owner=None,p2_groups_open=0,p3_groups_open=0,next_action='Reuse current source, draft and all registered execution/sound identities. Do not repeat implementation or full review; reopen only for changed input or new concrete findings. Source seams and dynamic validation remain separate.')
 for name in [report,raw_name,canonical]:
  if name not in c['evidence']:c['evidence'].append(name)
 ledger['volume1']['current_run_closed_chapters'].append(n)
ledger['volume1']['current_run_closed_chapters'].sort()
summary='当前39章闭合（001—027、259—270）。026七组、027四组局修均经不同审阅者定点独审及主fresh exit0；026为899检查（含14负例），027为747正向检查加11负例。原声及两套预算保留；026三份声音支持件也纳入接续指纹门。028五项局修在途，029为下一内容独审章。已闭合身份未变章及全卷历史对账不重复。'
ledger['as_of']=datetime.now(timezone.utc).isoformat();ledger['next_action']='39 reusable closed (001-027,259-270);028 targeted repair active, then different independent postfix review and primary fresh;029 next content review. All history reconciled;no repeat unchanged completed work.'
t=json.loads(original[task/'task.json']);t['offlineTrack']['last_checkpoint']=ledger['next_action']
outputs={paths[0]:json.dumps(ledger,ensure_ascii=False,indent=2)+'\n',task/'task.json':json.dumps(t,ensure_ascii=False,indent=2)+'\n'}
p=task/'offline-progress.md';s=original[p].decode();lines=s.splitlines();idx=[i for i,x in enumerate(lines) if x.startswith('> 最新状态：')];assert len(idx)==1;lines[idx[0]]='> 最新状态：'+summary;s='\n'.join(lines)+'\n'
anchor=next(x for x in lines if x.startswith('|260|12／104'))
newrows='|026|36单元1161；v3 86镜763（分账）|[全文独审](research/chapter026-independent-full-20261111.md)及[七组修后独审](research/chapter026-postfix-independent-20261111.md)|[exit0；899检查含14负例](research/chapter026-mainfresh-20261110.json)|原65声保留，新增13字旁白；七稿指纹保护，源缝/动态另列|\n|027|28单元727；81镜710（分账）|[全文独审](research/chapter027-independent-full-20261111.md)及[四组修后独审](research/chapter027-postfix-independent-20261111.md)|[exit0；747检查/11负例](research/chapter027-mainfresh-20261110.json)|原81声音字段保留，新增213字分12镜；源缝/动态另列|\n'
s=s.replace(anchor,newrows+anchor,1)
old='此表是本次明确闭合的35章，另有259／261历史复用，合计37章（001—025及259—270）';assert old in s;s=s.replace(old,'此表是本次明确闭合的37章，另有259／261历史复用，合计39章（001—027及259—270）',1)
outputs[p]=s+'\n> 最新接续：'+summary+' 本条取代此前在途快照。\n'
p=task/'prd.md';lines=original[p].decode().splitlines();idx=[i for i,x in enumerate(lines) if x.startswith('> **2026-11-11 最新离线进度**')];assert len(idx)==1;lines[idx[0]]='> **2026-11-11 最新离线进度**：'+summary+' 第一卷整体及第二卷未完成。';outputs[p]='\n'.join(lines)+'\n'
p=r/'fr-volumes-resume-20261110.md';outputs[p]=original[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
for p in paths:assert p.read_bytes()==original[p],f'Concurrent change: {p}'
for p in paths:p.write_text(outputs[p])
print(json.dumps({'closed':[26,27],'total_closed':39,'backup':str(backup),'five_documents_synced':True},ensure_ascii=False))
