"""Register returned121-140 audit and008/009 findings once; no manuscript edits."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
p=r/'fr-volumes-current-20261110.json';c=json.loads(p.read_text());b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text())
bs={x['chapter']:x for x in b['volumes'][0]['chapters']};bd={x['chapter']:x for x in b['volume1_drafts']};cd={x['chapter']:x for x in c['volume1']['chapters']};inputs=[]
for n in range(121,141):
 assert cd[n]['status']=='pending_evidence_audit'
 for role,z in [('source',bs[n])]+list(bd[n]['files'].items()):
  fp=Path(z['path']);raw=fp.read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==z['sha256']
  if role!='source':
   q=cd[n]['files'][role];assert q['path']==z['path'] and q['sha256']==h;assert len(raw)==z['bytes']==q['bytes']
  inputs.append({'chapter':n,'role':role,'path':str(fp.absolute()),'sha256':h})
digest=hashlib.sha256(''.join(f"{x['chapter']}\t{x['role']}\t{x['path']}\t{x['sha256']}\n" for x in inputs).encode()).hexdigest()
assert len(inputs)==80 and digest=='71e46d7a8f87b3582cea28f34bab6d661163ad6306ca82aa1b18a48a18602f67'
e=r/'fr-history-121-140-mainfresh-20261110.json';assert not e.exists()
backup=r/('fr-audit121-140-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));backup.mkdir()
for fp in [p,t/'offline-progress.md',t/'prd.md',t/'task.json',r/'fr-volumes-resume-20261110.md']:shutil.copy2(fp,backup/fp.name)
e.write_text(json.dumps({'pass':True,'checks_passed':80,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'protected_80_digest':digest,'inputs':inputs,'reviewer':'/root/fr_history_121_140','main_point_checks':['chapter122-source-map-1103.md:27','chapter124-source-map-1103.md:21','chapter136-dialogue-track-1109.md:7','chapter139-source-map-1103.md:19','volume-one-resume-1102.md:5650'],'boundary':'Main identity and selected document checks only; no repeated full semantic review.'},ensure_ascii=False,indent=2)+'\n')
for n in range(121,141):cd[n].update(status='historical_evidence_audited_content_review_pending',evidence_audit_date='2026-11-10',evidence_audit='fr-history-evidence-121-140-20261110.md',evidence_audit_scope='Chapter reports and relevant volume sections, no historical chat rescan or full manuscript rereview.',next_action='Reuse current revisions. Complete missing full content review and subsequent main fresh; do not repeat historical audit or repair scripts.')
for n in [8,9]:
 assert cd[n]['status']=='current_content_review_in_progress'
 cd[n].update(status='targeted_repair_in_progress',reviewer=None,writer='/root',evidence=[f'chapter{n:03}-independent-full-20261110.md'],p2_groups_open=3 if n==8 else 0,p3_groups_open=0 if n==8 else 1,next_action='Full review complete and recorded; targeted fixes only, then different reviewer and main fresh. No repeated full review.')
c['volume1']['historical_evidence_audited_chapters']=sorted(set(c['volume1']['historical_evidence_audited_chapters'])|set(range(121,141)));c['evidence_audit_in_progress']=None;c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='19 reusable chapters.008/009 full review recorded; main targeted repairs. History001-140 registered; next batch141.';p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();anchor='|第一卷其余章|';assert s.count(anchor)==1;s=s.replace(anchor,'|121—140历史证据|对账完成；主核80/80输入SHA匹配，已有修订沿用|[对账报告](research/fr-history-evidence-121-140-20261110.md)、[主指纹核验](research/fr-history-121-140-mainfresh-20261110.json)|缺当前全文独审及其后主fresh；122已裁已改；124吃饼待裁记录保留；下批141起|\n'+anchor)
old=next(x for x in s.splitlines() if x.startswith('当前19章可复用（'))
s=s.replace(old,'当前19章可复用（001—007、259—270）。008/009全文独审已完成并落盘，主代理仅处理008三项保真/顺序缺口及009一处P3标注，随后定点独审及主fresh；不重复全文审阅。历史对账001—140及对应输入核验已登记，下一批141。已闭合章与已对账批次从待办跳过。');p.write_text(s)
p=t/'prd.md';s=p.read_text().replace('001—120章历史证据对账完成','001—140章历史证据对账完成',1).replace('历史对账001—120已完成登记，当前008/009只读全文独审、121—140历史对账在途，无稿件写入者','历史对账001—140已完成登记；008/009全文独审已落盘，主代理定点局修后接独审与主fresh',1);p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text().replace('001—120历史证据对账也已落盘','001—140历史证据对账也已落盘',1).replace('当前无写稿者，008/009只读全文独审在途。历史证据101—120及主80/80指纹核验已登记，121—140正在只读对账。','008/009全文独审已落盘，主仅修确证缺口，不重复全审。历史证据121—140及主80/80输入核验已登记，下批141。',1);p.write_text(s)
p=t/'task.json';j=json.loads(p.read_text());j['offlineTrack']['last_checkpoint']='2026-11-10:19 chapters reusable (001-007,259-270).008/009 full reviews recorded, main targeted repairs then independent postfix and main fresh. Historical evidence001-140 registered, latest80/80 hashes match; next batch141. Skip unchanged completed work.';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'checks_passed':80,'protected_80_digest':digest,'historical_audit_through':140,'closed_count':19}))
