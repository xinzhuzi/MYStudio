"""Register007 once after independent repair review and observed main exit0."""
from pathlib import Path
from datetime import datetime, timezone
import json, hashlib, shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());rows={x['chapter']:x for x in c['volume1']['chapters']}
f=json.loads((r/'chapter007-mainfresh-20261110.json').read_text());assert f['pass'] and f['execution']['exit_code']==0 and f['execution']['after_independent_review']
assert rows[7]['status']=='targeted_repair_in_progress'
for role,v in rows[7]['files'].items():
 data=Path(v['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==f['input_sha256'][role]
backup=r/('fr-close007-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for path in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(path,backup/path.name)
for role,v in rows[7]['files'].items():v.update(sha256=f['input_sha256'][role],bytes=Path(v['path']).stat().st_size)
rows[7].update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,p2_groups_open=0,p3_groups_open=0,reviewer=None,writer=None,owner=None,scenes=3,narrative_units=10,internal_beats=56,seconds=518,voice_events=51,voice_characters=825,evidence=['chapter007-independent-full-20261110.md','chapter007-review-repair-20261110.md','chapter007-postfix-independent-20261110.md','chapter007-mainfresh-raw-20261110.json','chapter007-mainfresh-20261110.json'],next_action='Reuse unchanged current content and SHA. No repeated repair or full review; source conflicts and cross-chapter/dynamic boundaries remain separate.')
rows[6].update(status='postfix_independent_review_in_progress',writer=None,owner=None,reviewer='/root/fr006_postfix_independent',evidence=['chapter006-independent-full-20261110.md','chapter006-review-repair-20261110.md'],next_action='Targeted repairs implemented; await independent postfix conclusion and main fresh. Do not repeat full review or implementation.')
c['volume1']['current_run_closed_chapters']=sorted(set(c['volume1']['current_run_closed_chapters'])|{7});c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='007 closed;18 chapters reusable.006 postfix independent review completing;101-120 history findings returned, main registration pending.';p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|260|12／104／1078|';assert s.count(anchor)==1;s=s.replace(anchor,'|007|3场／10单元（56内部节拍）／518|[当前全文独审](research/chapter007-independent-full-20261110.md)及[三项修后定点独审](research/chapter007-postfix-independent-20261110.md)|[exit 0；10负例全拒](research/chapter007-mainfresh-20261110.json)|沿用三稿SHA；令牌6＋1＋3保持，跨章及动态另列|\n'+anchor)
s=s.replace('本次明确闭合的15章','本次明确闭合的16章',1).replace('合计17章（001—005及259—270）','合计18章（001—005、007及259—270）',1)
old=next(x for x in s.splitlines() if x.startswith('当前17章可复用。'))
s=s.replace(old,'当前18章可复用，007局修、另一审阅者定点复核与主fresh均已闭合。006局修已交回，`/root/fr006_postfix_independent` 正完成定点复核；完整独审证据见 [006独审](research/chapter006-independent-full-20261110.md)，不重复已做全文审阅或实现。101—120历史对账结果已返回，主指纹核验及登记接续；001—005、007、259—270与001—100历史对账从待办跳过。');p.write_text(s)
p=t/'prd.md';s=p.read_text();s=s.replace('本轮第001—005、260','本轮第001—005、007、260',1).replace('当前17章可复用','当前18章可复用',1).replace('006/007全文独审已完成并登记确证问题，目前各章局修在途，修后独审及主fresh待续；历史对账101—120在途','007局修、修后独审及主fresh已闭合；006局修已交回、修后独审接续；历史对账101—120已回报待主核登记',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();s=s.replace('当前001—005及259—270共17章','当前001—005、007及259—270共18章',1).replace('006/007全文独审已落盘，确证缺口正由分章执行者局修；下一步为不同审阅者定点复核及主fresh。历史证据101—120在途。','007三项局修、修后定点独审及主fresh已闭合；006局修已交回、定点独审接续。历史证据101—120已回报，待主核并登记。',1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:18 chapters closed (001-005,007,259-270).007 independent postfix and main fresh exit0/10 negative controls passed.006 repair returned ownership and postfix review completing. History001-100 registered;101-120 audit returned, main registration pending. Skip completed unchanged work.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print('007 closure registered;18 reusable;006 independent postfix pending')
