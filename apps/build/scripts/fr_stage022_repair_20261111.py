"""Register verified chapter022 findings and exclusive repair ownership."""
from pathlib import Path
from datetime import datetime,timezone
import json,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';lp=r/'fr-volumes-current-20261110.json';c=json.loads(lp.read_text());row=next(x for x in c['volume1']['chapters'] if x['chapter']==22);assert row['status']=='current_full_independent_review_in_progress';report='chapter022-independent-full-20261111.md';assert (r/report).exists()
row.update(status='targeted_repair_in_progress',reviewer='/root/fr022_full_review',writer='/root/fr022_targeted_repair',current_independent_pass=False,p2_groups_open=1,p3_groups_open=3,next_action='Repair four verified findings; preserve38 narrative units/1342s and original voices; add paper material-window mapping. Then another reviewer and main fresh required.');row.setdefault('evidence',[]).append(report)
c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='33 reusable chapters;022 four-finding repair,023 full review,371-390 historical audit active. Completed work is skipped.'
p=t/'offline-progress.md';s=p.read_text();a='022由 `/root/fr022_full_review`、023由 `/root/fr023_full_review` 全文独审。';assert a in s;s=s.replace(a,'022全文独审1P2/3P3已落盘，经主核实由 `/root/fr022_targeted_repair` 独占三稿局修；023由 `/root/fr023_full_review` 全文独审。')
pd=t/'prd.md';pt=pd.read_text();a='022/023全文独审、371—390历史对账在途。';assert a in pt;pt=pt.replace(a,'022全文独审已落盘，四项缺口进入局修；023全文独审、371—390历史对账在途。')
plan=r/'fr-volumes-resume-20261110.md';qt=plan.read_text()+'\n第022章全文独审1P2/3P3经主核实：记忆载体、授谱时点、晨夜小计及纸面素材窗映射，交 `/root/fr022_targeted_repair` 独占三稿局修；保持38单元1342秒和原人物声。023与371—390仍只读在途，33闭合章沿用。\n'
meta=t/'task.json';m=json.loads(meta.read_text());m['offlineTrack']['last_checkpoint']=c['next_action'];bk=r/('fr-stage022-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));bk.mkdir()
for p in [lp,t/'offline-progress.md',pd,plan,meta]:shutil.copy2(p,bk/p.name)
lp.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n');(t/'offline-progress.md').write_text(s);pd.write_text(pt);plan.write_text(qt);meta.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print('PASS chapter022 repair ownership recorded;33 closed retained')
