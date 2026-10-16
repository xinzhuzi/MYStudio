"""Refresh reviewed prompt snapshots and associated semantic anchors."""
from pathlib import Path
import json
from qi21_prompt_revision import ROOT,OUT,write,json_write
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng';p=M/'json/qi21_bases.json';b=json.loads(p.read_text());ledger=json.loads((OUT/'changes.json').read_text());row=next(r for r in ledger if r['path']==str(p));old=json.loads(Path(row['backup']).read_text());mapping=[]
for k,v in old['art_style_base'].items():
 if isinstance(v,str) and k in b['art_style_base']:mapping.append((v,b['art_style_base'][k]))
mapping.append((old['expand_instruction']['system_prompt_zh'],b['expand_instruction']['system_prompt_zh']))
for ot,nt in zip(old['types'],b['types']):
 for k in ['positive_text','negative_text','rgba_positive','purpose']:
  if ot.get(k):mapping.append((ot[k],nt[k]))
def walk(x):
 if isinstance(x,dict):return {k:walk(v) for k,v in x.items()}
 if isinstance(x,list):return [walk(v) for v in x]
 if isinstance(x,str):
  for a,c in sorted(mapping,key=lambda z:-len(z[0])):
   if a and a!=c:x=x.replace(a,c)
  x=x.replace('按主体句指定的','按指定的').replace('主体句未指定时','观察面未指定时')
 return x
for p in (ROOT/'apps/backend/engines/comfyui/my_nodes/subgraphs').glob('qi21-*'):
 d=json.loads(p.read_text());n=walk(d)
 if n!=d:json_write(p,n,'同步独立子图中共同画法、类型与扩写教材的显示快照')
for p in (ROOT/'apps/backend/engines/comfyui/workflows').rglob('qi21-道劫-?2i.json'):
 d=json.loads(p.read_text());json_write(p,walk(d),'刷新协议内嵌文本与道具观察面措辞')
p=ROOT/'apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_base.py';s=p.read_text();old='(7 if zh in {"人物多视图"} else (4 if zh in {"高清人脸", "表情差分"} else (6 if zh in RENWU_XI else 2)))';new='(8 if zh == "人物多视图" else (5 if zh in {"高清人脸", "表情差分"} else (7 if zh == "设定卡" else (6 if zh in RENWU_XI else 2))))';assert s.count(old)==2;s=s.replace(old,new);write(p,s,'类型显示段数锚随设定图照明与事实保留段增加，原逐字源一致检查保留')
p=ROOT/'apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_bases_text.py';s=p.read_text().replace('assert len(风格) > 300, "风格底座应=美术风格底座全文量级"','assert "铁线描" in 风格 and "服从场景和时段" in 风格, "画法与剧情照明边界应随真源热读"');write(p,s,'去除鼓励长底座的字数断言，改验共同画法与照明职责')
p=ROOT/'apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_bases_protocol_1009.py';s=p.read_text().replace('assert "连续线描" in pos','assert "铁线描" in pos');write(p,s,'透明回退画法语义锚随新底座更新，透明包裹与背景剥离检查保留')
print('snapshots updated')
