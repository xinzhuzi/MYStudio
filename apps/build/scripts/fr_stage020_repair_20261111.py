from pathlib import Path
from datetime import datetime,timezone
import json
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';d=json.loads(p.read_text());row=next(x for x in d['volume1']['chapters'] if x['chapter']==20);assert row['status']=='full_independent_review_in_progress'
row.update(status='targeted_repair_in_progress',writer='/root/fr020_targeted_repair',reviewer=None,p2_groups_open=1,p3_groups_open=1,evidence=['chapter020-independent-full-20261111.md'],next_action='Repair only name-triggered sword vibration and delayed look-up, then independent targeted review and main fresh.')
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='31 reusable chapters;020 targeted repair active;021 full review and331-350 historical audit active;completed work skipped.';p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=t/'task.json';m=json.loads(p.read_text());m['offlineTrack']['last_checkpoint']=d['next_action'];p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();a='020／021分别由 `/root/fr020_full_review`、`/root/fr021_full_review` 只读全文独审在途。';assert a in s;p.write_text(s.replace(a,'020全文独审发现1项P2与1项P3，已落盘，由 `/root/fr020_targeted_repair` 独占三稿局修；021由 `/root/fr021_full_review` 只读全文独审在途。'))
p=t/'prd.md';s=p.read_text();a='020／021当前全文独审、331—350历史对账在途。';assert a in s;p.write_text(s.replace(a,'020全文独审已落盘并进入两项局修；021全文独审、331—350历史对账在途。'))
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();s+='\n第020章全文独审已落盘，1项P2（名字触发剑震）、1项P3（抬头时点）经主核实，交 `/root/fr020_targeted_repair` 独占局修；021与331—350仍只读审阅在途。\n';p.write_text(s)
print(json.dumps({'pass':True,'chapter':20,'status':row['status'],'open':{'P2':1,'P3':1}},ensure_ascii=False))
