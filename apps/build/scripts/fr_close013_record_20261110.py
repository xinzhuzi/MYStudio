"""Register chapter013 current closure once following independent review and main exit0."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';j=json.loads(p.read_text());x=next(x for x in j['volume1']['chapters'] if x['chapter']==13)
assert x['status']=='postfix_independent_review_in_progress';f=json.loads((r/'chapter013-mainfresh-raw-20261110.json').read_text());assert f['pass'];assert not (r/'chapter013-mainfresh-20261110.json').exists()
for role,z in f['inputs'].items():assert hashlib.sha256(Path(z['path']).read_bytes()).hexdigest()==z['sha256']
backup=r/('fr-close013-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
f['execution']={'executor':'main_agent','exit_code':0,'command':'python3 apps/build/scripts/chapter013_review_verify_20261110.py','raw_output':'chapter013-mainfresh-raw-20261110.json','after_independent_review':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat()}
f['probe_correction']='Initial exit1 compared screenplay blank paragraph separators as doubled br; inspecting actual unit02 showed identical voice text. Normalize paragraph separators, final exit0; no manuscript change.'
f['independent_evidence']='chapter013-postfix-independent-20261110.md';(r/'chapter013-mainfresh-20261110.json').write_text(json.dumps(f,ensure_ascii=False,indent=2)+'\n')
for role,z in x['files'].items():z.update(sha256=f['input_sha256'][role],bytes=f['inputs'][role]['bytes'])
x.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,p2_groups_open=0,p3_groups_open=0,writer=None,reviewer=None,owner=None,scenes=5,narrative_units=32,internal_beats=96,seconds=863,evidence=['chapter013-independent-full-20261110.md','chapter013-review-repair-20261110.md','chapter013-postfix-independent-20261110.md','chapter013-mainfresh-raw-20261110.json','chapter013-mainfresh-20261110.json'],next_action='Reuse current SHA without repeated repair or full review. Reopen only for changed input or specific new finding; cross-chapter and dynamic boundaries separate.')
j['volume1']['current_run_closed_chapters']=sorted(set(j['volume1']['current_run_closed_chapters'])|{13});j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='24 reusable chapters (001-011,013,259-270).012 targeted repair active;181-200 history returned pending main registration.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|260|12／104／1078|';assert s.count(anchor)==1
s=s.replace(anchor,'|013|5场／32单元（96内部节拍）／863|[全文独审](research/chapter013-independent-full-20261110.md)及[单项定点独审](research/chapter013-postfix-independent-20261110.md)|[exit 0](research/chapter013-mainfresh-20261110.json)|仅三稿各一行声音时点；其余字节保留，动态另列|\n'+anchor)
s=s.replace('本次明确闭合的21章','本次明确闭合的22章',1).replace('合计23章（001—011及259—270）','合计24章（001—011、013及259—270）',1)
old=next(line for line in s.splitlines() if line.startswith('当前23章可复用（'))
s=s.replace(old,'当前24章可复用（001—011、013、259—270）。013三行声音指令已定点独审、主fresh通过并登记SHA；012两组P2由 `/root/fr012_targeted_repair` 独占局修。历史001—180已对账，181—200回报已收待主落账。已闭合章与已对账批次跳过，不重复全审或修复。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('本轮第001—011、260','本轮第001—011、013、260',1).replace('当前23章可复用','当前24章可复用',1).replace('当前012/013全文只读独审与181—200历史对账在途，无稿件写入者','013唯一P3修复、独审及主fresh已闭合；012两组P2局修在途；181—200历史对账已返回待主落账',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('当前001—011及259—270共23章','当前001—011、013及259—270共24章',1).replace('181—200只读对账在途，012/013全文独审在途；无稿件写入者','181—200历史对账已返回待主落账；013唯一P3修复、独审及主fresh已闭合；012两组P2定点局修在途',1);p.write_text(s)
p=t/'task.json';s=json.loads(p.read_text());s['offlineTrack']['last_checkpoint']='2026-11-10:24 reusable chapters (001-011,013,259-270).013 one P3 fixed and independently verified; main exit0.012 targeted repair active. History001-180 registered;181-200 returned pending main registration. Skip closed unchanged work.';p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
print('013 closed;24 reusable;012 targeted repair active')
