from pathlib import Path
import json,shutil
from datetime import datetime,timezone
T=Path('.trellis/tasks/10-27-script-narrative-translation-cure');R=T/'research';B=R/'close025-stage027-backup-20261111';B.mkdir(exist_ok=False)
for p in [T/'task.json',T/'offline-progress.md',T/'prd.md',R/'fr-volumes-current-20261110.json',R/'fr-volumes-resume-20261110.md']:shutil.copy2(p,B/p.name)
p=R/'fr-volumes-current-20261110.json';d=json.loads(p.read_text())
for c in d['volume1']['chapters']:
 if c['chapter']==25:
  c.update(status='offline_content_closed_current_sha',current_independent_pass=True,writer=None,owner=None,p2_groups_open=0,p3_groups_open=0,main_fresh_exit_code=0,narrative_units=36,seconds=1029,trial_shots=147,trial_seconds=1285,voice_records=62,next_action='Reuse current SHA and closed content; no repeat full review/repair absent changed inputs or concrete new findings. Source seams and dynamic/production separate.')
  c['evidence']=['chapter025-independent-full-20261111.md','chapter025-review-repair-20261111.md','chapter025-postfix-independent-20261111.md','chapter025-mainfresh-raw-20261111.json','chapter025-mainfresh-20261110.json']
 if c['chapter']==27:c.update(status='current_full_independent_review_in_progress',reviewer='/root/fr027_full_review',writer=None,next_action='Complete missing current source/trio content review using existing81-shot710-second execution support; no regeneration or manuscript edits.')
d['volume1']['current_run_closed_chapters']=sorted(set(d['volume1']['current_run_closed_chapters']+[25]));d['as_of']=datetime.now(timezone.utc).isoformat();summary='36 reusable chapters(001-023,025,259-270);024 targeted repair finishing;026/027 full independent reviews;all historical audit complete;script paths recovered/exact verified without content reruns.';d['next_action']=summary;p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=T/'task.json';t=json.loads(p.read_text());t['offlineTrack']['last_checkpoint']=summary;p.write_text(json.dumps(t,ensure_ascii=False,indent=2)+'\n')
status='当前36章闭合（001—023、025、259—270）。025三项局修、不同审阅者定点复核及主fresh exit0完成，358检查/10负例通过，原61声保留，仅增20字有据旁白；1029秒与1285秒分别不变。024局修收尾，026/027现稿全文独审在途。第一卷历史对账全完，26脚本现盘与原文字节一致已登记；已闭合且输入未变不重做。'
p=T/'offline-progress.md';s=p.read_text();needle='|260|12／104／1078|';idx=s.index(needle);s=s[:idx]+'|025|36单元1029；147镜试排1285（分账）|[全文独审](research/chapter025-independent-full-20261111.md)及[三项定点独审](research/chapter025-postfix-independent-20261111.md)|[exit0；358检查、10负例全拒](research/chapter025-mainfresh-20261110.json)|原61声保留、增20字旁白，源缝/动态另列|\n'+s[idx:];s=s.replace('此表是本次明确闭合的33章，另有259／261历史复用，合计35章（001—023及259—270）','此表是本次明确闭合的34章，另有259／261历史复用，合计36章（001—023、025及259—270）');s=s.replace('## 已完成：直接沿用，不重新实施','> 最新状态：'+status+'\n\n## 已完成：直接沿用，不重新实施',1);p.write_text(s+'\n> 最新接续：'+status+'\n')
p=T/'prd.md';s=p.read_text();ls=s.splitlines();idx=[i for i,l in enumerate(ls) if l.startswith('> **2026-11-11 最新离线进度**')];assert len(idx)==1;ls[idx[0]]='> **2026-11-11 最新离线进度**：'+status+' 第一卷内容/连续性及第二卷仍未完成。';p.write_text('\n'.join(ls)+'\n')
p=R/'fr-volumes-resume-20261110.md';p.write_text(p.read_text()+'\n'+status+' 本条优先于此前在途快照。\n')
print('025 closed;36 total;027 staged;five shared records saved')
