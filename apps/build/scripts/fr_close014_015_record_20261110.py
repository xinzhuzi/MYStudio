"""Register014/015 once after distinct postfix reviews and observed main exit0."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';j=json.loads(p.read_text());records={}
verifiers={14:'4f565bb0677c241ae26945a1b24fa5dcf551dc2bd26d432765cf9d16b2ac4de7',15:'7d4f5e8dcd12cdd50db6529c77c5ee32a90eaaae59d532ab4d1bd1e993650e18'}
for n in [14,15]:
 x=next(x for x in j['volume1']['chapters'] if x['chapter']==n);assert x['status']=='postfix_independent_review_in_progress';f=json.loads((r/f'chapter{n:03d}-mainfresh-raw-20261110.json').read_text());assert f['pass'];assert not (r/f'chapter{n:03d}-mainfresh-20261110.json').exists()
 for z in f['inputs'].values():assert hashlib.sha256(Path(z['path']).read_bytes()).hexdigest()==z['sha256']
 assert hashlib.sha256((root/f'apps/build/scripts/chapter{n:03d}_review_verify_20261110.py').read_bytes()).hexdigest()==verifiers[n]
 assert (r/f'chapter{n:03d}-postfix-independent-20261110.md').is_file();records[n]=f
backup=r/('fr-close014-015-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
for n,f in records.items():
 f['execution']={'executor':'main_agent','exit_code':0,'command':f'python3 apps/build/scripts/chapter{n:03d}_review_verify_20261110.py','raw_output':f'chapter{n:03d}-mainfresh-raw-20261110.json','after_independent_review':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat()};f['independent_evidence']=f'chapter{n:03d}-postfix-independent-20261110.md';f['verifier_sha256']=verifiers[n]
 f['scene_seconds']=[382,295,352] if n==14 else [286,328,366,108]
 (r/f'chapter{n:03d}-mainfresh-20261110.json').write_text(json.dumps(f,ensure_ascii=False,indent=2)+'\n')
 x=next(x for x in j['volume1']['chapters'] if x['chapter']==n)
 for role,z in x['files'].items():z.update(sha256=f['input_sha256'][role],bytes=f['inputs'][role]['bytes'])
 x.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,p2_groups_open=0,p3_groups_open=0,writer=None,reviewer=None,owner=None,scenes=len(f['scene_seconds']),narrative_units=f['units'],internal_beats=f['internal_beats'],seconds=f['seconds'],evidence=[f'chapter{n:03d}-independent-full-20261110.md',f'chapter{n:03d}-review-repair-20261110.md',f'chapter{n:03d}-postfix-independent-20261110.md',f'chapter{n:03d}-mainfresh-raw-20261110.json',f'chapter{n:03d}-mainfresh-20261110.json'],next_action='Reuse current SHA without repeating repair/full review; reopen only changed input or new concrete finding. Source conflicts/cross-chapter and dynamic execution remain separate.')
 if n==14:x['execution_sync_watch_units']=[4,15,27,38]
j['volume1']['current_run_closed_chapters']=sorted(set(j['volume1']['current_run_closed_chapters'])|{14,15});j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='27 reusable chapters (001-015,259-270).014/015 closed with independent postfix and main exit0. History001-220 registered;221-240 returned pending main registration. No active manuscript writers/reviewers.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|260|12／104／1078|';assert s.count(anchor)==1
rows='|014|3场／40单元（116内部节拍）／1029|[全文独审](research/chapter014-independent-full-20261110.md)及[两项修后独审](research/chapter014-postfix-independent-20261110.md)|[exit 0](research/chapter014-mainfresh-20261110.json)|指刀与闭眼恢复话间顺序；原声保留，04/15/27/38排演同步风险另列|\n|015|4场／42单元（126内部节拍）／1088|[全文独审](research/chapter015-independent-full-20261110.md)及[两项修后独审](research/chapter015-postfix-independent-20261110.md)|[exit 0](research/chapter015-mainfresh-20261110.json)|两处收抱恢复原文时点；原声与预算保留，动态另列|\n'
s=s.replace(anchor,rows+anchor).replace('本次明确闭合的23章','本次明确闭合的25章',1).replace('合计25章（001—013及259—270）','合计27章（001—015及259—270）',1)
old=next(line for line in s.splitlines() if line.startswith('当前25章可复用（'));s=s.replace(old,'当前27章可复用（001—015、259—270）。014／015定点局修、不同审阅者复核及主fresh均已闭合，当前无稿件写入者或在途内容审阅者。历史001—220已登记，221—240回报已收待主指纹核验落账；下批内容016／017。已闭合章与已对账批次跳过，只对输入变化或新具体发现定点重开。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('本轮第001—013、260','本轮第001—015、260',1).replace('当前25章可复用','当前27章可复用',1).replace('当前014／015只读全文审阅在途','014／015定点局修、不同审阅者复核及主fresh均闭合；221—240历史对账返回待主落账',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('当前001—013及259—270共25章','当前001—015及259—270共27章',1).replace('当前014／015只读内容审阅在途','014／015局修、独立修后复核及主fresh均闭合',1).replace('下批221—240','221—240历史对账已返回待主落账；下一内容批016／017',1);p.write_text(s)
p=t/'task.json';s=json.loads(p.read_text());s['offlineTrack']['last_checkpoint']='2026-11-10:27 reusable chapters (001-015,259-270).014/015 targeted edits independently reviewed, main fresh exit0, current SHA registered. History001-220 registered;221-240 returned pending main registration. No active manuscript writers/reviewers. Next content016/017; skip completed unchanged work.';p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'closed':[14,15],'reusable_chapters':27,'main_exit_codes':[0,0]}))
