"""Record011 once after returned independent review and observed main exit0."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil
root=Path(__file__).resolve().parents[3]
t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
p=r/'fr-volumes-current-20261110.json';j=json.loads(p.read_text())
x=next(x for x in j['volume1']['chapters'] if x['chapter']==11)
assert x['status']=='postfix_independent_review_in_progress'
f=json.loads((r/'chapter011-mainfresh-raw-20261110.json').read_text());assert f['pass']
assert not (r/'chapter011-mainfresh-20261110.json').exists()
expected={'source':'f19ea415608de13262aff6cc1e2d3b5f92d84894a934d47e67bbc83796ce9357','screenplay':'bbf6c75a7a00f2cabf4f763a6dcdeeaa2e35bc3a59f8efe0e1d3e073c6003903','director-plan':'45236c7b10a60e555fd09f08057f76038754e17c3eaf8be5a736033eefddd576','storyboard':'29bdbbd43ad6bac5c49b2a81bf105d44a8cee641f516d9378cd25b7a138cb4ee'}
assert f['input_sha256']==expected
for role,z in f['inputs'].items():assert hashlib.sha256(Path(z['path']).read_bytes()).hexdigest()==expected[role]
verifier=root/'apps/build/scripts/chapter011_review_verify_20261110.py'
assert hashlib.sha256(verifier.read_bytes()).hexdigest()=='48e688cbf0f1916c3d4c011478640927359041f89db668b4bac63a0c357d3372'
assert (r/'chapter011-postfix-independent-20261110.md').is_file()
backup=r/('fr-close011-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
f['execution']={'executor':'main_agent','exit_code':0,'command':'python3 apps/build/scripts/chapter011_review_verify_20261110.py','raw_output':'chapter011-mainfresh-raw-20261110.json','after_independent_review':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat()}
f['independent_evidence']='chapter011-postfix-independent-20261110.md'
f['verifier_sha256']=hashlib.sha256(verifier.read_bytes()).hexdigest()
f['boundary']='Main fresh verifies current source/backup identity, preserved voices, approved sequence and paper budgets after independent content review. Recording, action, dynamic, audience and production unverified.'
(r/'chapter011-mainfresh-20261110.json').write_text(json.dumps(f,ensure_ascii=False,indent=2)+'\n')
for role,z in x['files'].items():z.update(sha256=expected[role],bytes=Path(z['path']).stat().st_size)
x.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,p2_groups_open=0,p3_groups_open=0,writer=None,reviewer=None,owner=None,scenes=3,narrative_units=13,internal_beats=79,seconds=688,original_voice_events=49,preserved_voice_events_after_split=50,evidence=['chapter011-independent-full-20261110.md','chapter011-review-repair-20261110.md','chapter011-postfix-independent-20261110.md','chapter011-mainfresh-raw-20261110.json','chapter011-mainfresh-20261110.json'],next_action='Reuse current SHA without repeated repair/full review; reopen only for changed inputs or new specific findings. Source conflicts, cross-chapter, dynamic and production remain separate.')
j['volume1']['current_run_closed_chapters']=sorted(set(j['volume1']['current_run_closed_chapters'])|{11})
j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='23 reusable chapters (001-011,259-270). History161-180 returned and pending main identity/registration; next content012/013. No manuscript writers.'
p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|260|12／104／1078|';assert s.count(anchor)==1
s=s.replace(anchor,'|011|3场／13单元（79内部节拍）／688|[全文独审](research/chapter011-independent-full-20261110.md)及[四项定点独审](research/chapter011-postfix-independent-20261110.md)|[exit 0](research/chapter011-mainfresh-20261110.json)|原49声保留；官宗联系及玄清判断恢复，源冲突与动态另列|\n'+anchor)
s=s.replace('本次明确闭合的20章','本次明确闭合的21章',1).replace('合计22章（001—010及259—270）','合计23章（001—011及259—270）',1)
old=next(line for line in s.splitlines() if line.startswith('当前22章可复用（'))
s=s.replace(old,'当前23章可复用（001—011、259—270）。011四项局修已由另一审阅者定点复核，主fresh亲跑exit 0，已登记当前SHA；无稿件写入者。历史对账001—160已登记，161—180回报已收，待主输入核验落账；随后接012/013内容审阅与181—200历史对账。已闭合章与已对账批次跳过，不重复全审或修复。')
p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('本轮第001—010、260','本轮第001—011、260',1).replace('当前22章可复用','当前23章可复用',1).replace('011已交回688秒局修稿，独立定点复核在途，当前无写稿者；161—180历史对账在途','011四项局修、独立定点复核及主fresh已闭合，当前无写稿者；161—180历史对账已返回待主核验落账',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('当前001—010及259—270共22章','当前001—011及259—270共23章',1).replace('011已交回688秒局修稿，定点独审在途，主fresh待续','011四项局修、另一审阅者定点独审及主fresh均已闭合',1).replace('161—180只读对账在途','161—180只读对账已返回待主核验落账',1);p.write_text(s)
p=t/'task.json';s=json.loads(p.read_text());s['offlineTrack']['last_checkpoint']='2026-11-10:23 reusable chapters (001-011,259-270).011 four targeted fixes independently reviewed; main fresh exit0; SHA registered. History001-160 recorded;161-180 returned pending main identity/registration. No manuscript writers. Next content012/013 and history181-200; skip unchanged closed work.';p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'closed':11,'reusable_chapters':23,'main_exit_code':0,'seconds':688,'internal_beats':79}))
