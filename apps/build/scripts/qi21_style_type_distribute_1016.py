"""Plan and apply exact matching source copies; never overwrite an unrelated drift."""
from qi21_style_type_revision_1016 import ROOT,OUT,SOURCE,save,sha
from pathlib import Path
import json,sys
prior=json.loads((ROOT/'apps/output/automation/daojie-qi21-style-correction-1016/distribution.json').read_text())
ledger=json.loads((OUT/'changes.json').read_text())
deployed_path=OUT/'distribution.json'
deployed={r['target']:r['after_sha'] for r in json.loads(deployed_path.read_text())} if deployed_path.is_file() else {}
manual=SOURCE.parent.parent
resources=[Path(p) for p in prior['resources']]
mirrors=[Path(p) for p in prior['mirrors']]
engine=Path(prior['engine_home'])
node_root=ROOT/'apps/backend/engines/comfyui/my_nodes'
pairs={}
for item in ledger:
 src=Path(item['path'])
 if not src.is_relative_to(ROOT) or '/tests/' in str(src) or src.read_bytes()==Path(item['backup']).read_bytes():continue
 targets=[]
 for row in prior['files']:
  if Path(row['source'])==src:targets.append(Path(row['target']))
 if src.is_relative_to(manual):
  targets += [p/src.relative_to(manual) for p in mirrors]
 if src.is_relative_to(node_root):
  targets += [p/'backend/engines/comfyui/my_nodes'/src.relative_to(node_root) for p in resources]
  targets.append(engine/'ComfyUI/custom_nodes/my-nodes'/src.relative_to(node_root))
 for dst in targets:
  if not dst.is_file():continue
  pairs[str(dst)]={'source':str(src),'target':str(dst),'baseline':item['backup']}
rows=[]
for item in pairs.values():
 src,dst,before=[Path(item[k]) for k in ('source','target','baseline')]
 a,b,c=before.read_text(),src.read_text(),dst.read_text()
 status='equal' if b==c else ('ready' if a==c else 'drift')
 if status=='drift' and deployed.get(str(dst))==sha(dst.read_bytes()):
  status='ready_previous_distribution'
 if status=='drift' and src==SOURCE and dst in [p/src.relative_to(manual) for p in mirrors]:
  # The two external manual mirrors predate the charsheet fallback field.
  # Accept exactly that missing field, while keeping every other drift blocking.
  baseline_data=json.loads(a)
  mirror_data=json.loads(c)
  if 'rgba_positive' not in mirror_data['types'][9]:
   baseline_data['types'][9].pop('rgba_positive')
   if baseline_data==mirror_data:status='known_missing_charsheet_rgba'
 rows.append({**item,'status':status,'before_sha':sha(c.encode()),'after_sha':sha(b.encode())})
(OUT/'distribution-plan.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print('targets',len(rows), {k:sum(r['status']==k for r in rows) for k in ('equal','ready','ready_previous_distribution','known_missing_charsheet_rgba','drift')})
for row in rows:
 if row['status']=='drift':print('DRIFT',row['target'])
if '--apply' in sys.argv:
 if any(r['status']=='drift' for r in rows):raise SystemExit('Review drift before distribution')
 for row in rows:
  dst=Path(row['target'])
  if sha(dst.read_bytes()) != row['before_sha']: raise RuntimeError(f'Concurrent modification: {dst}')
  if row['status'] in ('ready','ready_previous_distribution','known_missing_charsheet_rgba'):save(dst,Path(row['source']).read_text())
  row['verified']=dst.read_bytes()==Path(row['source']).read_bytes()
 (OUT/'distribution.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
 print('verified',sum(r['verified'] for r in rows))
