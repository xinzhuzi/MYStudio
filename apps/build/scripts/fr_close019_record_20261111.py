from pathlib import Path
from datetime import datetime, timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';lp=r/'fr-volumes-current-20261110.json';d=json.loads(lp.read_text());row=next(x for x in d['volume1']['chapters'] if x['chapter']==19)
assert row['status']=='postfix_independent_review_pending'
raw_name='chapter019-mainfresh-raw-20261111.json';raw=json.loads((r/raw_name).read_text());assert raw['ok'] and raw['results'][0]['checks']==551 and not raw['results'][0]['failures'] and len(raw['results'])==8 and all(x['accepted'] for x in raw['results'])
for role,meta in row['files'].items():
 b=Path(meta['path']).read_bytes();assert hashlib.sha256(b).hexdigest()==raw['summary']['draft_sha256'][role]==meta['sha256'] and len(b)==meta['bytes']
review='chapter019-postfix-independent-20261111.md';assert 'pass=true' in (r/review).read_text()
now=datetime.now(timezone.utc).isoformat();fresh={'chapter':19,'pass':True,'recorded_at_utc':now,'scope':'offline text only; full review followed by independent targeted review and main fresh','command':'python3 apps/build/scripts/chapter019_review_verify_20261111.py --negative-controls','exit_code':0,'raw':raw_name,'source_sha256':raw['summary']['source_sha256'],'input_sha256':raw['summary']['draft_sha256'],'checks':551,'negative_controls_rejected':7,'scenes':4,'narrative_units':32,'seconds':977,'voice_records':64,'source_quote_fragments':56,'nonempty_source_lines_mapped':159,'full_independent_review':'chapter019-independent-full-20261111.md','postfix_independent_review':review,'reviewer':row['reviewer'],'boundary':'Source uncertainties retained. No TTS, material, dynamic, audience or production acceptance. 977 seconds exceeds production195 by782.'}
fp=r/'chapter019-mainfresh-20261110.json';assert not fp.exists()
row.update(status='offline_content_closed_current_sha',current_independent_pass=True,writer=None,owner=None,main_fresh_exit_code=0,p2_groups_open=0,p3_groups_open=0,scenes=4,narrative_units=32,seconds=977,voice_records=64,next_action='Reuse current content and fingerprints; no repeat repair/full review unless changed inputs or concrete new findings. Source uncertainties and cross-chapter/dynamic boundaries retained.')
for name in [review,raw_name,fp.name]:
 assert (r/name).is_file() or name==fp.name
 if name not in row['evidence']:row['evidence'].append(name)
d['volume1']['current_run_closed_chapters']=sorted(set(d['volume1']['current_run_closed_chapters']+[19]));d['as_of']=now;d['next_action']='31 reusable chapters (001-019,259-270);020 full review active;311-330 historical audit returned, main identity verification and recording pending. Skip unchanged closed work.'
progress=t/'offline-progress.md';s=progress.read_text();assert '|019|' not in s
insert='|019|4场／32单元／977|[全文独审](research/chapter019-independent-full-20261111.md)及[定点修后独审](research/chapter019-postfix-independent-20261111.md)|[exit 0；551检查、7负例全拒](research/chapter019-mainfresh-20261110.json)|蓝光方向及话间动作修正；草茎未知留证，64声条与预算保留，动态另列|\n'
s=s.replace('|260|12／104／1078|',insert+'|260|12／104／1078|',1)
a='此表是本次明确闭合的28章，另有259／261历史复用，合计30章（001—018及259—270）';assert a in s;s=s.replace(a,'此表是本次明确闭合的29章，另有259／261历史复用，合计31章（001—019及259—270）')
paragraph=next(x for x in s.splitlines() if x.startswith('当前30章可复用'))
s=s.replace(paragraph,'当前31章可复用（001—019、259—270）。019两P3及草茎源未知备注已修，不同审阅者定点独审及主fresh exit0完成；原64声与977秒预算保持，当前SHA已登记。020由 `/root/fr020_full_review` 只读全文独审在途。历史001—258、271—310已登记，311—330历史对账已返回，待主身份核验落账；已完成且输入未变不重做。')
prd=t/'prd.md';p=prd.read_text();old=next(x for x in p.splitlines() if x.startswith('> **2026-11-11 最新离线进度**'));new='> **2026-11-11 最新离线进度**：31章已闭合（001—019、259—270）；019两P3及源未知备注已修，不同审阅者定点独审和主fresh exit0完成，551检查与7负例通过。历史001—258、271—310已对账登记；311—330对账已返回，待主身份核验及登记。020当前全文独审在途。完成证据及SHA见offline-progress.md；已闭合内容不重复实施。';p=p.replace(old,new)
plan=r/'fr-volumes-resume-20261110.md';q=plan.read_text();q+='\n第019章两P3及草茎源未知备注局修、不同审阅者定点独审与主fresh exit0均已闭合；当前31章（001—019、259—270）直接沿用。020全文独审在途；311—330历史对账已返回待主核身份后登记。本条优先于上文阶段性在途快照。\n'
meta=t/'task.json';m=json.loads(meta.read_text());m['offlineTrack']['last_checkpoint']=d['next_action']
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');shutil.copy2(lp,r/f'fr-volumes-current-before-close019-{stamp}.json')
fp.write_text(json.dumps(fresh,ensure_ascii=False,indent=2)+'\n');lp.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');progress.write_text(s);prd.write_text(p);plan.write_text(q);meta.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'closed':19,'total_reusable':len(d['volume1']['current_run_closed_chapters'])+len(d['volume1']['historical_reused_closed_chapters']),'main_fresh_exit_code':0},ensure_ascii=False))
