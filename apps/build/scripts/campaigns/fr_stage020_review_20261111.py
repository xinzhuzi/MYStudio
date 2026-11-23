from pathlib import Path
from datetime import datetime, timezone
import json, hashlib, shutil
root=Path(__file__).resolve().parents[3];task=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=task/'research';p=r/'fr-volumes-current-20261110.json';d=json.loads(p.read_text())
row19=next(x for x in d['volume1']['chapters'] if x['chapter']==19);assert row19['status']=='postfix_independent_review_pending';row19['reviewer']='/root/fr019_postfix_review_available';row19['dispatch_error']='fr019_postfix_review: unavailable gpt-5.6-terra; no verification performed; replacement reviewer assigned.'
row20=next(x for x in d['volume1']['chapters'] if x['chapter']==20);assert row20['status']=='historical_evidence_audited_content_review_pending'
for meta in row20['files'].values():
 raw=Path(meta['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==meta['sha256'] and len(raw)==meta['bytes']
row20.update(status='full_independent_review_in_progress',reviewer='/root/fr020_full_review',writer=None,next_action='Read current source and all three drafts completely; preserve existing repairs; report findings with source and draft locations.')
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='30 reusable chapters;019 repair completed awaiting independent review/main fresh;020 current full review active;311-330 historical audit active.'
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');shutil.copy2(p,r/f'fr-volumes-current-before-020-review-{stamp}.json');p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=task/'task.json';t=json.loads(p.read_text());t['offlineTrack']['last_checkpoint']=d['next_action'];p.write_text(json.dumps(t,ensure_ascii=False,indent=2)+'\n')
p=task/'offline-progress.md';s=p.read_text();assert s.count('`/root/fr019_postfix_review`')==1;s=s.replace('`/root/fr019_postfix_review`','`/root/fr019_postfix_review_available`（首次启动模型不可用，未执行核验）');a='修复记录见 research/chapter019-review-repair-20261111.md。';assert a in s;s=s.replace(a,a+'020由 `/root/fr020_full_review` 只读全文独审在途。');p.write_text(s)
p=task/'prd.md';s=p.read_text();a='018局修、独审与主fresh已闭合，019两处P3局修在途；';assert s.count(a)==1;p.write_text(s.replace(a,'018已闭合；019两P3及源未知备注已修，待不同审阅者定点复核与主fresh；020当前全文独审在途；'))
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();a='018四行局修、独审与主fresh已闭合，019两P3局修在途；';assert s.count(a)==1;p.write_text(s.replace(a,'018已闭合，019两P3及源未知备注已修待定点独审与主fresh，020当前全文独审在途；'))
print(json.dumps({'pass':True,'19':row19['status'],'20':row20['status']},ensure_ascii=False))
