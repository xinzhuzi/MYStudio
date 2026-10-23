"""Back up and copy this revision's data/docs only. No build, app exit, engine restart, or GUI changes."""
from pathlib import Path
import hashlib,json
from qi21_base_swap_tool import Tool,ROOT,MANUAL,SOURCE
new=json.loads(SOURCE.read_text())['art_style_base']['positive_text']
t=Tool({'out_dir':'qi21-anime-1018','positive_old':'','positive_new':new})
rows=json.loads((t.out/'changes.json').read_text())
# Verify main-session files still match our last writes before touching any mirror.
for row in rows:
 p=Path(row['path'])
 assert hashlib.sha256(p.read_bytes()).hexdigest()==row['after'],'Concurrent edit: '+str(p)
sources=[Path(r['path']) for r in rows if Path(r['path']).is_relative_to(MANUAL)]
installed=next(p for p in Path('/Applications').iterdir() if p.name=='漫影工作室.app')/'Contents/Resources'
builds=list((ROOT/'apps/release/build').glob('*/*/*.app/Contents/Resources'))
support=next(p for p in (Path.home()/'Library/Application Support').iterdir() if p.name=='漫影工作室')
engine=(support/'comfyui').resolve()
mirrors=[installed/'studio-manuals/art_skills/daojie_ink_guofeng']
mirrors += [p/'studio-manuals/art_skills/daojie_ink_guofeng' for p in builds]
for parent in [ROOT.parent.parent/'IP/MA/skills/art_skills',engine.parent/'skills/art_skills']:
 p=parent/'daojie_ink_guofeng'
 if p.is_dir():mirrors.append(p)
plan=[]
for src in sources:
 for mirror in mirrors:
  dst=mirror/src.relative_to(MANUAL)
  if dst.is_file():plan.append((src,dst))
plan.append((SOURCE,engine/'daojie-data/qi21_bases.json'))
backend=ROOT/'apps/backend/comfyui'
for row in rows:
 src=Path(row['path'])
 if not src.is_relative_to(backend) or src.suffix!='.json':continue
 if '/workflows/' not in str(src) and '/subgraphs/' not in str(src):continue
 for res in [installed]+builds:
  dst=res/'backend/comfyui'/src.relative_to(backend)
  if dst.is_file():plan.append((src,dst))
 if '/subgraphs/' in str(src):
  dst=engine/'ComfyUI/custom_nodes/my-nodes/subgraphs'/src.name
  if dst.is_file():plan.append((src,dst))
 else:
  dst=engine/'ComfyUI/user/default/workflows'/src.relative_to(backend/'workflows')
  # Preserve the zero-seeding policy: update only copies that already exist.
  if dst.is_file():plan.append((src,dst))
unique={str(dst.resolve()):(src,dst.resolve()) for src,dst in plan}
manifest=[]
for src,dst in unique.values():
 assert dst.is_file(),dst
 before=dst.read_bytes();data=src.read_bytes()
 # Existing mirrors are read before writing, backed up by ledger_write.
 assert dst.read_bytes()==before,'Concurrent mirror edit: '+str(dst)
 if data!=before:t.ledger_write(dst,data,'提示词及手册磁盘副本随源；未重打包或重启')
 assert dst.read_bytes()==src.read_bytes()
 manifest.append({'source':str(src),'target':str(dst),'changed':before!=data,'sha256':hashlib.sha256(data).hexdigest()})
(t.out/'distribution.json').write_text(json.dumps({'files':manifest,'note':'仅磁盘资源同文；前端ASAR内联合同未重新编译，已开画布未重载；未进行出图。'},ensure_ascii=False,indent=2)+'\n')
print('disk copies',len(manifest),'changed',sum(r['changed'] for r in manifest))
