from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';d=json.loads(p.read_text());row=next(x for x in d['volume1']['chapters'] if x['chapter']==21);assert row['status']=='historical_evidence_audited_content_review_pending';assert d['evidence_audit_in_progress'] is None
for meta in row['files'].values():
 raw=Path(meta['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==meta['sha256'] and len(raw)==meta['bytes']
assert all(x['status']=='pending_evidence_audit' for x in d['volume1']['chapters'] if 331<=x['chapter']<=350)
row.update(status='full_independent_review_in_progress',reviewer='/root/fr021_full_review',writer=None,next_action='Complete current full source and three-draft independent content review; reuse existing work.')
d['evidence_audit_in_progress']={'chapters':list(range(331,351)),'reviewer':'/root/fr_history_331_350','status':'evidence_audit_in_progress'};d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='31 reusable chapters;020/021 full independent reviews active;331-350 historical audit active. Completed001-258/271-330 historical batches and closed chapters skipped.'
shutil.copy2(p,r/('fr-volumes-current-before-021-history331-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json'));p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=t/'task.json';m=json.loads(p.read_text());m['offlineTrack']['last_checkpoint']=d['next_action'];p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();a='020由 `/root/fr020_full_review` 只读全文独审在途。';assert a in s;s=s.replace(a,'020／021分别由 `/root/fr020_full_review`、`/root/fr021_full_review` 只读全文独审在途。');a='下一历史批331—350；';assert a in s;s=s.replace(a,'331—350由 `/root/fr_history_331_350` 只读历史对账在途；');p.write_text(s)
p=t/'prd.md';s=p.read_text();a='020当前全文独审在途。完成证据及SHA';assert a in s;s=s.replace(a,'020／021当前全文独审、331—350历史对账在途。完成证据及SHA');p.write_text(s)
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();s+='\n当前接续：020／021各自全文独审、331—350历史对账在途；无稿件写入者，当前31闭合章及已对账历史批不重复处理。\n';p.write_text(s)
print(json.dumps({'pass':True,'full_reviews':[20,21],'history':[331,350],'closed_reusable':31},ensure_ascii=False))
