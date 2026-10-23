"""Distribute only this revision's files, preserving a backup of every existing target."""
from pathlib import Path
import json,hashlib
from qi21_prompt_revision import ROOT,OUT,LEDGER,write,sha
MAN=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
rows=json.loads(LEDGER.read_text());sources=[Path(r['path']) for r in rows if Path(r['path']).is_relative_to(ROOT) and not Path(r['path']).is_relative_to(ROOT/'apps/release')]
support=next(p for p in (Path.home()/'Library/Application Support').iterdir() if p.name=='漫影工作室');home=(support/'comfyui').resolve()
installed=next(p for p in Path('/Applications').iterdir() if p.name=='漫影工作室.app')/'Contents/Resources'
build=next((ROOT/'apps/release/build/mac-arm64/mac-arm64').glob('*.app'))/'Contents/Resources'
mirrors=[installed/'studio-manuals/art_skills/daojie_ink_guofeng',build/'studio-manuals/art_skills/daojie_ink_guofeng',Path('/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng'),support/'skills/art_skills/daojie_ink_guofeng']
plan=[]
for src in sources:
 if src.is_relative_to(MAN):
  for m in mirrors:
   assert m.is_dir(),m
   plan.append((src,m/src.relative_to(MAN)))
 backend=ROOT/'apps/backend/comfyui'
 if src.is_relative_to(backend) and '/tests/' not in str(src):
  for resource in [installed,build]:plan.append((src,resource/'backend/comfyui'/src.relative_to(backend)))
 if src.name=='my_qi21_prompt_assembly.py':plan.append((src,home/'ComfyUI/custom_nodes/my-nodes/nodes'/src.name))
 if src.name=='qi21_bases.json':plan.append((src,home/'daojie-data'/src.name))
unique={str(dst.resolve()):(src,dst.resolve()) for src,dst in plan};manifest=[]
previous={x["target"]:x for x in json.loads((OUT/"distribution.json").read_text())["files"]} if (OUT/"distribution.json").exists() else {}
for src,dst in unique.values():
 data=src.read_bytes();before=dst.read_bytes() if dst.exists() else None
 baseline=previous.get(str(dst),{}).get('before',sha(before) if before is not None else None)
 manifest.append({'source':str(src),'target':str(dst),'before':baseline,'after':sha(data),'changed':baseline!=sha(data)})
 if before==data:continue
 if before is not None:write(dst,data.decode(),'本次提示词修订分发副本同步（源文件：'+str(src.relative_to(ROOT))+'）')
 else:
  assert dst.parent.is_dir(),dst.parent
  dst.write_bytes(data)
  ledger=json.loads(LEDGER.read_text());ledger.append({'path':str(dst),'backup':None,'before':None,'after':sha(data),'changes':['新增缺失的手册分发副本；来源：'+str(src.relative_to(ROOT))]});LEDGER.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
 assert dst.read_bytes()==data
(OUT/'distribution.json').write_text(json.dumps({'engine_home':str(home),'resources':[str(installed),str(build)],'mirrors':[str(m.resolve()) for m in mirrors],'files':manifest,'runtime_note':'仅同步磁盘与未打包资源；前端 TypeScript/内联合同的编译代码未重新打包；引擎未启动或重启。'},ensure_ascii=False,indent=2)+'\n')
print('distribution targets',len(manifest),'updated',sum(x['changed'] for x in manifest))
