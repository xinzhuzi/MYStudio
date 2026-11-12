from pathlib import Path
from datetime import datetime,timezone
import json
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research';p=r/'fr-volumes-current-20261110.json';d=json.loads(p.read_text());row=next(x for x in d['volume1']['chapters'] if x['chapter']==21);assert row['status']=='full_independent_review_in_progress';assert d['evidence_audit_in_progress'] is None
row.update(status='targeted_repair_in_progress',writer='/root/fr021_targeted_repair',reviewer=None,p2_groups_open=1,p3_groups_open=2,evidence=['chapter021-independent-full-20261111.md'],next_action='Repair shared cold-weight sensation, whistle/action order and first-shake transition only; independent postfix review/main fresh required.')
assert all(x['status']=='pending_evidence_audit' for x in d['volume1']['chapters'] if 351<=x['chapter']<=370)
d['evidence_audit_in_progress']={'chapters':list(range(351,371)),'reviewer':'/root/fr_history_351_370','status':'evidence_audit_in_progress'};d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='31 reusable chapters;020/021 targeted repair active;351-370 historical audit active;historical001-258/271-350 completed and skipped.';p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=t/'task.json';m=json.loads(p.read_text());m['offlineTrack']['last_checkpoint']=d['next_action'];p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
p=t/'offline-progress.md';s=p.read_text();a='021由 `/root/fr021_full_review` 只读全文独审在途。';assert a in s;s=s.replace(a,'021全文独审1项P2/2项P3已落盘，由 `/root/fr021_targeted_repair` 独占三稿局修。');a='下一历史批351—370；';assert a in s;s=s.replace(a,'351—370由 `/root/fr_history_351_370` 只读历史对账在途；');p.write_text(s)
p=t/'prd.md';s=p.read_text();a='021全文独审在途；331—350历史对账及主身份核验已登记，下一历史批351—370。';assert a in s;p.write_text(s.replace(a,'021全文独审已落盘并进入三项局修；331—350历史对账及主身份核验已登记，351—370历史对账在途。'))
p=r/'fr-volumes-resume-20261110.md';s=p.read_text();s+='\n第021章全文独审已落盘，1项P2/2项P3经主核实后由 `/root/fr021_targeted_repair` 独占局修；020局修仍在途，351—370历史对账已启动。\n';p.write_text(s)
print(json.dumps({'pass':True,'repairs':[20,21],'history':[351,370]},ensure_ascii=False))
