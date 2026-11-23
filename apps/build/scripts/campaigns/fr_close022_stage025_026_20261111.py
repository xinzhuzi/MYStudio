from pathlib import Path
import json,hashlib,shutil
from datetime import datetime,timezone
T=Path('.trellis/tasks/10-27-script-narrative-translation-cure');R=T/'research'
manifest=json.loads((R/'verification-script-recovery-20261111/manifest.json').read_text());checks=[]
for row in manifest['targets']:
 p=Path(row['target']);b=p.read_bytes();compile(b,str(p),'exec');checks.append({'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'matches_manifest':hashlib.sha256(b).hexdigest()==row['sha256']})
assert len(checks)==26 and all(c['matches_manifest'] for c in checks)
p=R/'verification-script-recovery-mainfresh-20261111.json';assert not p.exists();p.write_text(json.dumps({'pass':True,'scope':'primary exact hash and in-memory compile only; no chapter reruns','targets':checks,'target_writes':0},ensure_ascii=False,indent=2)+'\n')
B=R/'close022-stage025-026-backup-20261111';B.mkdir(exist_ok=False)
for p in [T/'task.json',T/'offline-progress.md',T/'prd.md',R/'fr-volumes-current-20261110.json',R/'fr-volumes-resume-20261110.md']:shutil.copy2(p,B/p.name)
p=R/'fr-volumes-current-20261110.json';d=json.loads(p.read_text())
for c in d['volume1']['chapters']:
 if c['chapter']==22:
  c.update(status='offline_content_closed_current_sha',current_independent_pass=True,writer=None,owner=None,p2_groups_open=0,p3_groups_open=0,main_fresh_exit_code=0,scenes=4,narrative_units=38,material_windows=138,seconds=1342,next_action='Reuse current SHA and closed content; no repeat review/repair absent changed inputs or concrete new findings. Dynamic/production separate.')
  c['evidence']=['chapter022-independent-full-20261111.md','chapter022-review-repair-20261111.md','chapter022-postfix-independent-20261111.md','chapter022-mainfresh-raw-20261111.json','chapter022-mainfresh-20261110.json']
 if c['chapter']==25:
  for v in c['files'].values():
   b=Path(v['path']).read_bytes();v.update(sha256=hashlib.sha256(b).hexdigest(),bytes=len(b))
  v=c['execution_support'];b=Path(v['path']).read_bytes();v.update(sha256=hashlib.sha256(b).hexdigest(),bytes=len(b))
  c.update(status='postfix_independent_review_in_progress',writer=None,owner=None,reviewer='/root/fr025_postfix_review',next_action='Three verified fixes implemented. Only changed scope independent review then primary fresh; do not repeat full review.')
  c['evidence'].append('chapter025-review-repair-20261111.md')
 if c['chapter']==26:c.update(status='current_full_independent_review_in_progress',reviewer='/root/fr026_full_review',writer=None,next_action='Complete missing current source/trio content review using manual v3 and existing execution support; no regeneration or manuscript edits.')
d['volume1']['current_run_closed_chapters']=sorted(set(d['volume1']['current_run_closed_chapters']+[22]));d['as_of']=datetime.now(timezone.utc).isoformat()
summary='35 reusable chapters(001-023,259-270);all volume1 historical evidence audit complete.024 targeted repair active;025 postfix independent review;026 full current content review.26 verification scripts present/exact sources confirmed, no content reruns.'
d['next_action']=summary;d['verification_script_recovery'].update(status='all_present_exact_sources_primary_verified',owner=None,primary_evidence='verification-script-recovery-mainfresh-20261111.json',target_writes=0,cause='unknown');p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=T/'task.json';t=json.loads(p.read_text());t['offlineTrack']['last_checkpoint']=summary;p.write_text(json.dumps(t,ensure_ascii=False,indent=2)+'\n')
status='当前35章闭合（001—023、259—270）沿用。022四项局修及138窗经不同审阅者全差异/全窗复核，主fresh exit0、3444检查/14负例通过；024局修在途，025三项修完交不同审阅者定点独审，026只补现稿内容独审。全卷历史对账全部完成，不重扫；26个验证/接续脚本已在原位置且日志原文字节一致，主亲核SHA/内存compile通过，目标覆盖0、出现原因未知，不重做已闭合内容。'
p=T/'offline-progress.md';s=p.read_text();needle='|023|4场／32单元';idx=s.index(needle);s=s[:idx]+'|022|4场／38单元（138窗）／1342|[全文独审](research/chapter022-independent-full-20261111.md)及[全部差异/138窗独审](research/chapter022-postfix-independent-20261111.md)|[exit0；3444检查、14负例全拒](research/chapter022-mainfresh-20261110.json)|四项修复闭合；原声保留，仅增12字记忆旁白，动态另列|\n'+s[idx:];s=s.replace('此表是本次明确闭合的32章，另有259／261历史复用，合计34章（001—021、023及259—270）','此表是本次明确闭合的33章，另有259／261历史复用，合计35章（001—023及259—270）');p.write_text(s+'\n> 最新接续：'+status+'\n')
p=T/'prd.md';s=p.read_text();ls=s.splitlines();idx=[i for i,l in enumerate(ls) if l.startswith('> **2026-11-11 最新离线进度**')];assert len(idx)==1;ls[idx[0]]='> **2026-11-11 最新离线进度**：'+status+' 第一卷内容/连续性整体及第二卷未完成。';p.write_text('\n'.join(ls)+'\n')
p=R/'fr-volumes-resume-20261110.md';p.write_text(p.read_text()+'\n'+status+' 本条优先于此前在途快照。\n')
print('35 closed;025/026 staged;26 recovery identities verified;five shared docs saved')
