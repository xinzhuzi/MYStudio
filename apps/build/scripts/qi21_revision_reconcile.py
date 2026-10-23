"""Preserve observed concurrent card changes and refresh their dependent snapshots."""
from pathlib import Path
from datetime import datetime
import json
from qi21_prompt_revision import ROOT, OUT, LEDGER, sha, write, json_write
rows=json.loads(LEDGER.read_text());events=[]
for row in rows:
 p=Path(row['path']);actual=sha(p.read_bytes())
 if actual!=row['after']:
  assert p.name in ['qi21_bases.json','05-道劫规范提示词库.md','test_my_qi21_base.py'],p
  relative=p.relative_to(ROOT) if p.is_relative_to(ROOT) else Path('external')/p.relative_to('/')
  snapshot=OUT/'observed-concurrent'/relative;snapshot.parent.mkdir(parents=True,exist_ok=True);snapshot.write_bytes(p.read_bytes())
  events.append({'path':str(p),'previous_recorded_sha':row['after'],'observed_sha':actual,'snapshot':str(snapshot),'note':'本轮期间新增的设定卡透明底/视角/配器约束及对应测试或文档；保留，不归为本轮原创修改。'})
  row['after']=actual;row['changes'].append('检测到并保留并行设定卡修订；独立记录见 concurrent-changes.json')
assert len(events)==4,events
LEDGER.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
(OUT/'concurrent-changes.json').write_text(json.dumps({'observed':datetime.now().astimezone().isoformat(),'files':events,'note':'未确定变更作者；只记录磁盘差异。引擎17001在审计时已运行，本轮没有启动它或提交生图任务。'},ensure_ascii=False,indent=2)+'\n')
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
src=M/'json/qi21_bases.json';current=json.loads(src.read_text());distributed=json.loads((OUT/'distribution.json').read_text())
old=json.loads(next(Path(x['target']) for x in distributed['files'] if x['source']==str(src)).read_text())
card=lambda x:next(t for t in x['types'] if t['zh']=='设定卡')
a,b=card(old),card(current);mapping={a[k]:b[k] for k in ['positive_text','negative_text']}
def walk(x):
 if isinstance(x,dict):return {k:walk(v) for k,v in x.items()}
 if isinstance(x,list):return [walk(v) for v in x]
 if isinstance(x,str):
  for old,new in mapping.items():x=x.replace(old,new)
 return x
for row in rows:
 p=Path(row['path'])
 if not p.is_relative_to(ROOT/'apps/backend/comfyui') or p.suffix!='.json':continue
 if '/workflows/' not in str(p) and '/subgraphs/' not in str(p):continue
 doc=json.loads(p.read_text());after=walk(doc)
 if doc!=after:json_write(p,after,'保留并行设定卡修订，刷新类型文本快照；未改采样配置')
p=M/'ma_sync/runtime-contract.json';c=json.loads(p.read_text());oldsha=c['contractSha256'];c['localRevision']['styleSourceSha256']=sha(src.read_bytes());c['contractSha256']=sha(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode());json_write(p,c,'并行设定卡修订保留后的真源指纹刷新')
p=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts';s=p.read_text();assert s.count(oldsha)==1;write(p,s.replace(oldsha,c['contractSha256']),'合同内容不变；source SHA因保留并行设定卡修订而刷新测试锚')
print('concurrent changes preserved',len(events))
