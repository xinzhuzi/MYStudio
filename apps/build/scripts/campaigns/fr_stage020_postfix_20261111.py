from pathlib import Path
from datetime import datetime,timezone
import json,hashlib
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';d=json.loads(p.read_text());row=next(x for x in d['volume1']['chapters'] if x['chapter']==20);assert row['status']=='targeted_repair_in_progress'
expected={'screenplay':'005af6019c841eee755c1793e973481f6a3dafb238eb5404334b7e0d0b1678b1','director-plan':'b4a28fb0c195dbe43fe61c95845eb38789fcd5e43f12157a5b414e68e82de5d5','storyboard':'4e1d70d2da1fa86bbe945368bf807bc90f44c31bab8762d0826caf0c00fb00e5'}
for role,meta in row['files'].items():
 raw=Path(meta['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==expected[role];meta.update(sha256=expected[role],bytes=len(raw))
row.update(status='postfix_independent_review_pending',writer=None,reviewer='/root/fr020_postfix_review',next_action='Two repairs implemented; independent targeted review then parent fresh required.');row['evidence'].append('chapter020-review-repair-20261111.md');d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='31 reusable chapters;020 repaired awaiting independent review/main fresh;021 repair and351-370 historical audit active.';p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=t/'task.json';m=json.loads(p.read_text());m['offlineTrack']['last_checkpoint']=d['next_action'];p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();a='020全文独审发现1项P2与1项P3，已落盘，由 `/root/fr020_targeted_repair` 独占三稿局修；';assert a in s;p.write_text(s.replace(a,'020两项局修完成、所有权归还；由 `/root/fr020_postfix_review` 定点独审，随后主fresh；'))
p=t/'prd.md';s=p.read_text();a='020全文独审已落盘并进入两项局修；';assert a in s;p.write_text(s.replace(a,'020两项局修完成待定点独审及主fresh；'))
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();s+='\n第020章两项局修与实施者静态自验完成，所有权归还；由 `/root/fr020_postfix_review` 定点独审后再主fresh。当前仍31章闭合，021局修及351—370对账继续。\n';p.write_text(s)
print(json.dumps({'pass':True,'chapter':20,'status':row['status']},ensure_ascii=False))
