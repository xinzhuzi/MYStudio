"""One-time closeout for Chapter004; synchronize completed004/005 and audit001-080."""
from pathlib import Path
from datetime import datetime,timezone
import json
import hashlib
import shutil

root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
p=r/'fr-volumes-current-20261110.json';j=json.loads(p.read_text());rows={x['chapter']:x for x in j['volume1']['chapters']}
assert rows[4]['status']=='postfix_independent_review_in_progress'
assert rows[5]['status']=='offline_content_closed_current_sha'
raw=json.loads((r/'chapter004-mainfresh-raw-20261110.json').read_text());assert raw['pass']
for k,f in rows[4]['files'].items():
 data=Path(f['path']).read_bytes();actual=hashlib.sha256(data).hexdigest();assert actual==raw['input_sha256'][k]
raw['execution']={'executor':'main_agent','exit_code':0,'command':'python3 apps/build/scripts/chapter004_review_verify_20261110.py --self-test','raw_output':'chapter004-mainfresh-raw-20261110.json','after_independent_review':True,'recorded_at_utc':datetime.now(timezone.utc).isoformat()}
raw['independent_evidence']='chapter004-postfix-independent-20261110.md';assert (r/raw['independent_evidence']).is_file()
fresh=r/'chapter004-mainfresh-20261110.json';assert not fresh.exists();fresh.write_text(json.dumps(raw,ensure_ascii=False,indent=2)+'\n')
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup=r/('fr-close004005-metadata-backup-'+stamp);backup.mkdir()
for file in [p,t/'offline-progress.md',t/'task.json',t/'prd.md',r/'fr-volumes-resume-20261110.md']:shutil.copy2(file,backup/file.name)
row=rows[4]
for k,f in row['files'].items():f.update(sha256=raw['input_sha256'][k],bytes=Path(f['path']).stat().st_size)
row.update(status='offline_content_closed_current_sha',current_independent_pass=True,main_fresh_exit_code=0,scenes=4,narrative_units=23,internal_beats=110,seconds=1034,voice_events=183,voice_characters=2014,writer=None,reviewer=None,owner=None,evidence=['chapter004-independent-full-20261110.md','chapter004-review-repair-20261110.md','chapter004-postfix-independent-20261110.md','chapter004-mainfresh-raw-20261110.json',fresh.name],next_action='Reuse current unchanged SHA; no repeated repair or full review. Source conflicts/cross-chapter continuity and actual material/dynamic validation remain separate.')
j['volume1']['current_run_closed_chapters']=sorted(set(j['volume1']['current_run_closed_chapters'])|{4});j['as_of']=datetime.now(timezone.utc).isoformat();j['next_action']='Next missing content review006; historical evidence audit081 onward pending. Reuse closed001-005 and259-270 (17 total); historical audit001-080 complete. No active manuscript writers/reviewers.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|005|3场／12单元（75内部节拍）／754|';assert s.count(anchor)==1;s=s.replace(anchor,'|004|4场／23单元（110内部节拍）／1034|[当前全文独审](research/chapter004-independent-full-20261110.md)及[三组修后定点独审](research/chapter004-postfix-independent-20261110.md)|[exit 0；10负例全拒](research/chapter004-mainfresh-20261110.json)|沿用三稿SHA；07四素材窗仅为计划，源冲突与动态未验|\n'+anchor)
s=s.replace('此表是本次明确闭合的14章，另有259／261历史复用，合计16章（001—003、005及259—270）','此表是本次明确闭合的15章，另有259／261历史复用，合计17章（001—005及259—270）',1)
anchor='|021—040历史证据|';assert s.count(anchor)==1;s=s.replace(anchor,'|004／005|已转入上方闭合表；局修、修后定点独审和主fresh通过|初次全文内容审阅与修后证据已绑定当前SHA|不重复实施或全文重审；只在输入改变或具体新发现时重开|\n'+anchor)
old='004局修已完成交回所有权，`/root/fr004_postfix_independent` 正只读复核，主fresh尚待；005五项修复、定点独审及主fresh均闭合并绑定当前SHA，直接沿用。061—080历史对账已落盘，下批081起。001—003、005、259—270与001—080历史对账均从待办中跳过。'
new='本批执行者均已交回所有权，无在途写稿或待收审阅。004／005局修、修后独审及主fresh均闭合，当前共17章可复用。下一处缺少当前全文内容独审的是006；历史证据对账已到080，下一批081起。001—005、259—270与001—080历史对账均从待办中跳过。'
assert s.count(old)==1;s=s.replace(old,new);p.write_text(s)
p=t/'task.json';m=json.loads(p.read_text());m['offlineTrack']['last_checkpoint']='2026-11-10: chapters001-005 and259-270 closure registered (17 total);004/005 full review, bounded repair, independent postfix checks and main fresh passed. Historical evidence audit001-080 complete. All workers returned ownership. Next content006; next historical audit081. Do not repeat closed unchanged work.';p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
p=t/'prd.md';s=p.read_text();s=s.replace('本轮第001—003、260、262—270章文本闭合','本轮第001—005、260、262—270章文本闭合',1);s=s.replace('004/005全文独审已完成，确证局部问题正在修复，修后独审及主fresh待续','004/005全文独审后的局修、独立修后复核及主fresh均已闭合，当前17章可复用；本批无在途写稿，内容独审从006、历史对账从081接续',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();old='当前001—003及259—270共15章已登记文本闭合（含历史复用），并非全部历史完成数。';new='004/005全文独审发现的局部缺口已修复，经另一审阅者定点复核及主fresh闭合。当前001—005及259—270共17章已登记文本闭合（含历史复用），并非全部历史完成数；下一内容章006、历史证据批081起。';assert s.count(old)==1;s=s.replace(old,new);p.write_text(s)
print(json.dumps({'pass':True,'closed_chapters':sorted(j['volume1']['current_run_closed_chapters']+j['volume1']['historical_reused_closed_chapters']),'audited_through':max(j['volume1']['historical_evidence_audited_chapters']),'next_content':6,'next_evidence_audit':81,'backup':str(backup)},ensure_ascii=False,indent=2))
