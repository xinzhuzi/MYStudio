"""Register each016/017 once after independent postfix pass and observed main exit0."""
from pathlib import Path
from datetime import datetime, timezone
import argparse,json,hashlib,shutil
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('chapter',type=int,choices=[16,17]);args=parser.parse_args();n=args.chapter
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json'
j=json.loads(p.read_text());x=next(z for z in j['volume1']['chapters'] if z['chapter']==n);assert x['status']=='postfix_independent_review_in_progress'
raw_path=r/f'chapter{n:03d}-mainfresh-raw-20261110.json';raw=json.loads(raw_path.read_text());assert raw['pass' if n==16 else 'ok'] is True
review=r/f'chapter{n:03d}-postfix-independent-20261110.md';review_text=review.read_text();assert 'pass=true' in review_text
fresh_path=r/f'chapter{n:03d}-mainfresh-20261110.json';assert not fresh_path.exists()
baseline=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());source=next(z for z in baseline['volumes'][0]['chapters'] if z['chapter']==n);inputs={}
for role in ['source','screenplay','director-plan','storyboard']:
 z=source if role=='source' else x['files'][role];fp=Path(z['path']);content=fp.read_bytes();h=hashlib.sha256(content).hexdigest()
 assert h==z['sha256']
 expected=(raw['source_sha_end'] if role=='source' else raw['draft_sha256'][role]['after']) if n==16 else (raw['summary']['source_sha256'] if role=='source' else raw['summary']['draft_sha256'][role])
 assert h==expected and h in review_text,(role,h)
 inputs[role]={'path':str(fp),'sha256':h,'bytes':len(content)}
verifier=root/f'apps/build/scripts/chapter{n:03d}_review_verify_20261110.py';verifier_sha=hashlib.sha256(verifier.read_bytes()).hexdigest()
if n==16:
 metric=next(z for z in raw['checks'] if z['check']=='budgets');units=metric['units'];seconds=metric['seconds'];scenes=metric['scene_seconds'];voices=next(z for z in raw['checks'] if z['check']=='sound_protection')['named_voice_segments'];beats=None
else:
 metric=raw['summary'];units=metric['shots'];seconds=metric['duration_seconds'];scenes=metric['scene_seconds'];voices=metric['voice_lines'];beats=metric['internal_beats']
fresh={'pass':True,'units':units,'seconds':seconds,'scene_seconds':scenes,'voice_segments':voices,'inputs':inputs,'input_sha256':{k:v['sha256'] for k,v in inputs.items()},'source_sha256':inputs['source']['sha256'],'independent_evidence':review.name,'verifier_sha256':verifier_sha,'execution':{'executor':'main_agent','exit_code':0,'command':f'python3 apps/build/scripts/chapter{n:03d}_review_verify_20261110.py'+(' --negative-controls' if n==17 else ''),'raw_output':raw_path.name,'after_independent_review':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat()},'main_review':'All changed manuscript lines and corresponding source ranges read; verifier read in full. Full prior independent review plus distinct local postfix review; no repeat full review.','boundary':'Offline content closure at current SHA only; source conflicts/cross-chapter and dynamic/TTS/production remain separately unverified.'}
if beats is not None:fresh['internal_beats']=beats
backup=r/(f'fr-close{n:03d}-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
fresh_path.write_text(json.dumps(fresh,ensure_ascii=False,indent=2)+'\n')
for role,z in x['files'].items():z.update(sha256=inputs[role]['sha256'],bytes=inputs[role]['bytes'])
x.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,p2_groups_open=0,p3_groups_open=0,writer=None,reviewer=None,owner=None,scenes=len(scenes),narrative_units=units,seconds=seconds,voice_segments=voices,evidence=[f'chapter{n:03d}-independent-full-20261110.md',f'chapter{n:03d}-review-repair-20261110.md',review.name,raw_path.name,fresh_path.name],next_action='Reuse current SHA; no repeated repair or full review. Reopen only changed input or new concrete finding. Cross-chapter/source conflicts and dynamic/production separate.')
if beats is not None:x['internal_beats']=beats
j['volume1']['current_run_closed_chapters']=sorted(set(j['volume1']['current_run_closed_chapters'])|{n});j['as_of']=datetime.now(timezone.utc).isoformat();closed=len(j['volume1']['current_run_closed_chapters'])+len(j['volume1']['historical_reused_closed_chapters']);assert closed==(28 if n==16 else 29)
active='017独立修后复核在途，主fresh待做' if n==16 else '当前本批无在途写稿者／审阅者；下一内容批018／019'
j['next_action']=f'{closed} reusable chapters001-{n:03d},259-270. Historical001-258 and271-290 registered. '+('017 postfix review active, main fresh pending.' if n==16 else 'No active writers/reviewers. Next content018/019 and historical291-310.')+' Volume2 waits volume1 content and continuity closure.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|260|12／104／1078|';assert s.count(anchor)==1
row=(f'|016|6场／44单元／1245|[全文独审](research/chapter016-independent-full-20261110.md)及[五项定点独审](research/chapter016-postfix-independent-20261110.md)|[exit 0](research/chapter016-mainfresh-20261110.json)|握囊次数与四处声画先后修正；44声音字段逐字保留，动态另列|\n' if n==16 else f'|017|4场／36单元（106内部节拍）／992|[全文独审](research/chapter017-independent-full-20261110.md)及[修后定点独审](research/chapter017-postfix-independent-20261110.md)|[exit 0；10负例全拒](research/chapter017-mainfresh-20261110.json)|五处话间动作、尸坑气味因果与三次蹲停修正；原声保留、增1旁白，动态另列|\n')
s=s.replace(anchor,row+anchor,1).replace(f'本次明确闭合的{closed-3}章',f'本次明确闭合的{closed-2}章',1).replace(f'合计{closed-1}章（001—{n-1:03d}及259—270）',f'合计{closed}章（001—{n:03d}及259—270）',1)
old=next(line for line in s.splitlines() if line.startswith(f'当前{closed-1}章可复用（'));s=s.replace(old,f'当前{closed}章可复用（001—{n:03d}、259—270）。{n:03d}局修、不同审阅者定点复核及主fresh已闭合；{active}。历史001—258、271—290已登记，259—270闭合跳过；下一历史批291—310。已完成且输入未变的内容不重复实施或全文审阅。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace(f'本轮第001—{n-1:03d}、260',f'本轮第001—{n:03d}、260',1).replace(f'当前{closed-1}章可复用',f'当前{closed}章可复用',1)
anchor='> **本轮最新操作边界（2026-10-29）**';s=s.replace(anchor,f'> **第{n:03d}章本轮闭合**：局修、不同审阅者定点独审及主fresh exit0完成，新SHA已登记；当前{closed}章可复用。{active}。已完成且输入未变不重做。\n\n'+anchor,1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace(f'当前001—{n-1:03d}及259—270共{closed-1}章',f'当前001—{n:03d}及259—270共{closed}章',1);anchor='## 交付判定与执行';s=s.replace(anchor,f'第{n:03d}章局修、不同审阅者定点复核及主fresh已闭合，新SHA登记，直接沿用。{active}。\n\n'+anchor,1);p.write_text(s)
p=t/'task.json';data=json.loads(p.read_text());data['offlineTrack']['last_checkpoint']=j['next_action'];p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'closed_chapter':n,'reusable_chapters':closed,'main_exit_code':0,'verifier_sha256':verifier_sha,'seconds':seconds,'voice_segments':voices}))
