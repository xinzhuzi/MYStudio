"""Surgical painterly style migration preserving GLM's later edits. No git."""
from pathlib import Path
import hashlib,json,runpy,shutil,sys
ROOT=Path(__file__).resolve().parents[3]
AB=runpy.run_path(str(ROOT/'apps/build/scripts/qi21_painterly_ab_1016.py'))
OUT=AB['OUT']; MANUAL=AB['MANUAL']; NEW=AB['NEW']
OLD=(OUT/'old-style.txt').read_text().rstrip('\n')
SOURCE=MANUAL/'json/qi21_bases.json'
sha=lambda b:hashlib.sha256(b).hexdigest()
dumps=lambda d:json.dumps(d,ensure_ascii=False,indent=2)+'\n'
LABEL_OLD='全部定义（传统绘画转译/画种/媒介/线条/罩染/色彩浓淡/传统色多彩协调与主次）'
LABEL_NEW='全部定义（工笔设色与彩色连环画/二维手绘/线描造型/色面分染罩染塑形/多彩协调与主次）'
OWN_OLD='中国传统人物画经现代游戏美术重组的二维数字绘画；工笔、白描、连环画、线条节奏与手绘笔性、矿物色分染罩染、色彩浓淡与多色相传统色；丰富设色为主、配色协调统一、主辅与点睛色主次分明。'
OWN_NEW='中国传统工笔设色与彩色连环画的二维手绘数字插画；白描式轮廓与内部结构线主导造型，清晰色面、分染与层层罩染塑形，明暗融入设色层次，材质统一于线描设色语言；丰富设色为主、配色协调统一、主辅与点睛色主次分明。'
receipt=json.loads((ROOT/'apps/output/automation/qi21-color-hierarchy-1016/changes.json').read_text())
paths={Path(r['path']) for r in receipt}
boundary=ROOT/'apps/backend/engines/comfyui/my_nodes/tests/test_qi21_style_boundary_1016.py'
paths.add(boundary)
before={p:p.read_bytes() for p in paths}
after=dict(before);ops={}
def replace(p,old,new,count=None):
 t=after[p].decode();n=t.count(old)
 if count is not None:assert n==count,(p,n,count,old[:60])
 if n:
  after[p]=t.replace(old,new).encode();ops.setdefault(p,[]).append([old,new,n])
# All exact existing full-style copies, including active workflow snapshots and mirrors.
for p in paths:
 if p.name=='runtime-contract.json':continue
 replace(p,OLD,NEW)
 if p.name in ['qi21_bases.json','prompt_layering.json']:
  replace(p,LABEL_OLD,LABEL_NEW,1)
 if p.name=='prompt_layering.json':replace(p,OWN_OLD,OWN_NEW,1)
 if p.name=='lock-anchors.json':
  d=json.loads(after[p]);row=next(r for r in d['locks'] if r['name']=='风格底座锁')
  assert row['manualAnchors'][:2]==['中国传统人物画审美经现代游戏美术设计重组的二维数字绘画','线条细稳连贯、粗细随结构与轻重富有节奏']
  replace(p,row['manualAnchors'][0],'中国传统工笔设色与彩色连环画语言的二维手绘数字插画',1)
  replace(p,row['manualAnchors'][1],'白描式线条主导形体结构，轮廓线与内部结构线共同承担造型',1)
source_sha=sha(after[SOURCE])
contract_sha=None
for p in paths:
 if p.name!='runtime-contract.json':continue
 c=json.loads(before[p]);oldsha=c['contractSha256']
 assert c['modules']['style.gongbi-base']['text']==OLD
 c['modules']['style.gongbi-base']['text']=NEW
 c['localRevision']['styleSourceSha256']=source_sha
 c['contractSha256']=sha(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
 replace(p,OLD,NEW,1)
 replace(p,json.loads(before[p])['localRevision']['styleSourceSha256'],source_sha,1)
 replace(p,oldsha,c['contractSha256'],1)
 assert json.loads(after[p])==c
 if contract_sha:assert contract_sha==c['contractSha256']
 contract_sha=c['contractSha256'];old_contract_sha=oldsha
assembly=ROOT/'apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py'
replace(assembly,'"锁层A全文": "'+sha(OLD.encode())[:16]+'",','"锁层A全文": "'+sha(NEW.encode())[:16]+'",',1)
ts=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts'
replace(ts,old_contract_sha,contract_sha,1)
replace(ts,'中国传统人物画审美经现代游戏美术设计重组','中国传统工笔设色与彩色连环画语言的二维手绘数字插画',1)
replace(boundary,"['中国传统人物画', '现代游戏', '工笔', '白描', '连环画', '线条细稳连贯',\n                 '矿物色', '色彩浓淡', '多色相并陈', '传统色', '受控',", "['中国传统工笔设色', '二维手绘', '工笔', '白描', '连环画', '线条细稳连贯',\n                 '清晰色面', '分染', '层层罩染', '明暗融入设色层次', '多色相并陈', '传统色', '受控',",1)
changes={p:(before[p],after[p]) for p in sorted(paths) if before[p]!=after[p]}
plan=[{'path':str(p),'before':sha(b),'after':sha(a),'replacements':ops[p]} for p,(b,a) in changes.items()]
if sys.argv[1]=='plan':
 (OUT/'migration-plan.json').write_text(dumps(plan))
 print(dumps({'files':len(plan),'source_sha256':source_sha,'contract_sha256':contract_sha,'style':NEW}))
elif sys.argv[1]=='apply':
 assert json.loads((OUT/'migration-plan.json').read_text())==plan,'Changed preimage; inspect fresh plan.'
 for p,(b,a) in changes.items():assert p.read_bytes()==b,p
 ledger=[]
 for p,(b,a) in changes.items():
  assert p.read_bytes()==b,p
  rel=p.relative_to(ROOT) if p.is_relative_to(ROOT) else Path('external')/p.relative_to('/')
  backup=OUT/'migration-backups'/rel
  backup.parent.mkdir(parents=True,exist_ok=True);assert not backup.exists(),backup
  shutil.copy2(p,backup);p.write_bytes(a)
  ledger.append({'path':str(p),'backup':str(backup),'before':sha(b),'after':sha(a),'replacements':ops[p]})
  (OUT/'migration-changes.json').write_text(dumps(ledger))
 print(dumps({'written':len(ledger),'contract_sha256':contract_sha}))
else:raise ValueError('plan/apply')
