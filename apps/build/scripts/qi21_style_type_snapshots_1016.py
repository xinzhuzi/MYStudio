"""Update only style display snapshots and matching source type texts."""
from qi21_style_type_revision_1016 import ROOT,OUT,SOURCE,save_json
from pathlib import Path
import json
old=json.loads((OUT/'data-before.json').read_text())
new=json.loads(SOURCE.read_text())
style=new['art_style_base']
replacements={}
for a,b in zip(old['types'],new['types']):
 for key in ('positive_text','negative_text','rgba_positive'):
  if a.get(key) and a.get(key)!=b.get(key): replacements[a[key]]=b[key]
prior=json.loads((ROOT/'apps/output/automation/daojie-qi21-style-correction-1016/distribution-plan.json').read_text())
paths={Path(r['source']) for r in prior['files'] if '/workflows/' in r['source'] or '/subgraphs/' in r['source']}
paths.update((ROOT/'apps/backend/engines/comfyui/my_nodes/subgraphs').glob('qi21-*.json'))
rows=[]
def transform(x,where,changes):
 if isinstance(x,str):
  if x in replacements:
   changes.append(where);return replacements[x]
  return x
 if isinstance(x,list): return [transform(v,f'{where}/{i}',changes) for i,v in enumerate(x)]
 if not isinstance(x,dict):return x
 out={k:transform(v,f'{where}/{k}',changes) for k,v in x.items()}
 if out.get('type')=='MyQi21美术风格底座':
  out['widgets_values']=[style['positive_text'],style['negative_text']]
  out['widgets_values_named']={'美术风格':style['positive_text'],'负向词表':style['negative_text']}
  out['properties']={**out.get('properties',{}),'qi21StyleSchema':2}
  out['size']=[560,400]
  changes.append(where+'/style-display')
 if out.get('class_type')=='MyQi21美术风格底座':
  out['inputs']={'美术风格':style['positive_text'],'负向词表':style['negative_text']}
  changes.append(where+'/style-inputs')
 return out
for path in sorted(paths):
 before=json.loads(path.read_text())
 changes=[]
 after=transform(before,'',changes)
 if before != after:
  save_json(path,after)
 rows.append({'path':str(path),'changed':before!=after,'updates':changes})
(OUT/'workflow-snapshots.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print('scanned',len(rows),'changed',sum(r['changed'] for r in rows))
