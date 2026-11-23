"""Record023 author repair and independent review handoff."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';lp=r/'fr-volumes-current-20261110.json';c=json.loads(lp.read_text());row=next(x for x in c['volume1']['chapters'] if x['chapter']==23);assert row['status']=='current_full_independent_review_in_progress';expected={'screenplay':'2925342d163722e0cb2c63294175054ed37577b7824b4d63a93a703979631e1f','director-plan':'19d93d30fbecb205db596c8d5c7c8099cad0c644d02ae238566cf1e731c14491','storyboard':'5644e56c2a257dfec15030aff6838bd854325ef989d2104d63fe57ee9290a4fd'}
for role,z in row['files'].items():
 raw=Path(z['path']).read_bytes();h=hashlib.sha256(raw).hexdigest();assert h==expected[role];z.update(sha256=h,bytes=len(raw))
row.update(status='postfix_independent_review_pending',writer=None,reviewer='/root/fr023_postfix_review',current_independent_pass=False,p2_groups_open=0,p3_groups_open=3,next_action='Three execution-cue clarifications implemented by parent; another independent targeted reviewer then parent fresh required. Original32 sound fields and893s unchanged.');row.setdefault('evidence',[]).extend(['chapter023-independent-full-20261111.md','chapter023-review-repair-20261111.md']);row['cross_chapter_open']='023 source229/231-233 companions awake vs024 source49 asleep; retain as source seam, no invented resleeping.'
c['as_of']=datetime.now(timezone.utc).isoformat();c['next_action']='33 reusable chapters;022 repair active;023 author repair complete awaiting independent review/main fresh;391-395 historical audit active.'
p=t/'offline-progress.md';s=p.read_text();a='023由 `/root/fr023_full_review` 全文独审。';assert a in s;s=s.replace(a,'023全文独审三P3经主核实已局修，交 `/root/fr023_postfix_review` 定点独审后主fresh。')
pd=t/'prd.md';pt=pd.read_text();a='022四项局修、023全文独审、最后391—395历史对账在途。';assert a in pt;pt=pt.replace(a,'022四项局修、023三项局修后的定点独审、最后391—395历史对账在途。')
plan=r/'fr-volumes-resume-20261110.md';qt=plan.read_text()+'\n第023章全文独审三P3已落盘，主只改9行执行提示并完成393检查/7负例自验；32声音字段与893秒不变，交 `/root/fr023_postfix_review` 独立定点复核后再主fresh。022修复和391—395历史对账在途，33闭合章沿用。\n'
meta=t/'task.json';m=json.loads(meta.read_text());m['offlineTrack']['last_checkpoint']=c['next_action'];bk=r/('fr-stage023-metadata-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));bk.mkdir()
for p in [lp,t/'offline-progress.md',pd,plan,meta]:shutil.copy2(p,bk/p.name)
lp.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n');(t/'offline-progress.md').write_text(s);pd.write_text(pt);plan.write_text(qt);meta.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print('PASS 023 repair recorded;independent review pending,33 closed retained')
