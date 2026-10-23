"""Synchronize only the character-card entry, PE implementation and current guidance."""
from pathlib import Path
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-full-board-1016';PREV=OUT.parent/'daojie-charsheet-six-zone-1016';M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng';rows=[]
sha=lambda b:hashlib.sha256(b).hexdigest()
def save(p,new):
 old=p.read_bytes()
 if old==new:return
 b=OUT/'sync-backups'/str(p).lstrip('/');b.parent.mkdir(parents=True,exist_ok=True);assert not b.exists();shutil.copy2(p,b)
 assert p.read_bytes()==old;p.write_bytes(new);rows.append({'path':str(p),'backup':str(b),'before':sha(old),'after':sha(new)})
def dump(o):return (json.dumps(o,ensure_ascii=False,indent=2)+'\n').encode()
d=json.loads((M/'json/qi21_bases.json').read_text());card=next(t for t in d['types'] if t['zh']=='设定卡');manual_roots=[M]
for row in json.loads((PREV/'mirror-data-sync.json').read_text()):
 p=Path(row['path']);o=json.loads(p.read_text());index=next(i for i,t in enumerate(o['types']) if t['zh']=='设定卡')
 assert '固定六个图像区' in o['types'][index]['positive_text'];o['types'][index]=card;save(p,dump(o))
 if p.parent.name=='json':manual_roots.append(p.parent.parent)
node=ROOT/'apps/backend/comfyui/my_nodes/nodes/my_qi21_api_pe.py';before=(OUT/'backups'/node.relative_to(ROOT)).read_bytes()
for row in json.loads((PREV/'code-sync.json').read_text()):
 p=Path(row['path']);assert p.read_bytes()==before, f'Concurrent node change: {p}';save(p,node.read_bytes())
for home in manual_roots:
 p=home/'ma_sync/runtime-contract.json';o=json.loads(p.read_text());old_module=o['modules'].copy()
 o['localRevision']['styleSourceSha256']=sha((home/'json/qi21_bases.json').read_bytes())
 o['contractSha256']=sha(json.dumps({k:v for k,v in o.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
 assert o['modules']==old_module;save(p,dump(o))
for rel in ['art_prompt/art_subject_ten_types.md','json/README.md']:
 source=M/rel;old=(OUT/'doc-backups'/source.relative_to(ROOT)).read_text();new=source.read_text()
 for home in manual_roots[1:]:
  p=home/rel;s=p.read_text()
  if s==old:s=new
  elif rel.startswith('art_prompt'):
   start=old.index('## §10 设定卡');end=old.index('\n---',start);segment=old[start:end]
   nstart=new.index('## §10 设定卡');nend=new.index('\n---',nstart);assert segment in s,p;s=s.replace(segment,new[nstart:nend],1)
  else:
   a='道具/多视图/高清人脸/表情差分/设定卡五型 true';b='道具/多视图/高清人脸/表情差分四型 true；1016 完整设定卡 false';assert a in s,p;s=s.replace(a,b)
  save(p,s.encode())
p=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts';s=p.read_text();contract=json.loads((M/'ma_sync/runtime-contract.json').read_text())
import re
match=re.search(r'expect\(DAOJIE_RUNTIME_CONTRACT.contractSha256\)\.toBe\([\s\S]*?"([a-f0-9]{64})"',s);assert match
save(p,s[:match.start(1)].encode()+contract['contractSha256'].encode()+s[match.end(1):].encode())
(OUT/'sync-changes.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print('synced files',len(rows),'contract',contract['contractSha256'])
