"""Exact approved five-method style rollout. Plan, source gate, then mirrors. No git."""
from pathlib import Path
import hashlib,json,shutil,sys,time
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/qi21-five-method-style-1016'
MANUAL=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
SOURCE=MANUAL/'json/qi21_bases.json'
OLD=(OUT/'old-style.txt').read_text().rstrip('\n');NEW=(OUT/'new-style.txt').read_text().rstrip('\n')
CRAFT_OLD='成像工艺干净，线条与罩染层次清晰。'
CRAFT_NEW='数字绘画表面洁净平整，线条与罩染层次清晰。'
LABEL_OLD='全部定义（工笔设色与彩色连环画/二维手绘/线描造型/色面分染罩染塑形/多彩协调与主次）'
LABEL_NEW='全部定义（工笔设色与白描主导/连环画概括造型/透明水彩薄染/写意水墨笔韵/多彩主次/数字绘画工艺）'
OWN_OLD='中国传统工笔设色与彩色连环画的二维手绘数字插画；白描式轮廓与内部结构线主导造型，清晰色面、分染与层层罩染塑形，明暗融入设色层次，材质统一于线描设色语言；丰富设色为主、配色协调统一、主辅与点睛色主次分明。'
OWN_NEW='工笔设色（Gongbi painting）与白描线条（baimiao line drawing）主导二维手绘数字游戏插画；彩色连环画（classic Chinese lianhuanhua comic）负责概括造型，透明水彩（watercolor illustration）负责薄透设色，写意水墨（Chinese ink wash painting）负责笔触韵致；轮廓与内部结构线共同造型，色面、分染与罩染塑形，明暗融入固有色，传统设色协调统一、主辅与点睛层级分明。'
sha=lambda b:hashlib.sha256(b).hexdigest()
dumps=lambda d:json.dumps(d,ensure_ascii=False,indent=2)+'\n'
def plan():
 prior=json.loads((ROOT/'apps/output/automation/qi21-color-hierarchy-1016/changes.json').read_text())
 paths={Path(r['path']) for r in prior if '/apps/release/' not in r['path']}
 mirrors={p.parents[1] for p in paths if p.name=='qi21_bases.json' and p.parent.name=='json'}
 for m in mirrors:
  for rel in ['json/README.md','README.md']:paths.add(m/rel)
 tests=ROOT/'apps/backend/engines/comfyui/my_nodes/tests'
 for f in ['test_my_qi21_bases_text.py','test_qi21_style_boundary_1016.py','test_qi21_style_type_separation.py']:paths.add(tests/f)
 before={p:p.read_bytes() for p in paths};after=dict(before);ops={}
 def replace(p,x,y,count=None):
  t=after[p].decode();n=t.count(x)
  if count is not None:assert n==count,(p,x[:50],n,count)
  if n:after[p]=t.replace(x,y).encode();ops.setdefault(p,[]).append([x,y,n])
 for p in paths:
  if p.name=='runtime-contract.json':continue
  if p!=SOURCE:replace(p,OLD,NEW)
  if p.name in ['qi21_bases.json','prompt_layering.json']:
   replace(p,LABEL_OLD,LABEL_NEW,1)
   replace(p,'只定义传统绘画经现代游戏美术重组的绘画语言与成像工艺','只定义工笔与白描主导、连环画造型、水彩薄染和水墨笔韵融合的绘画语言与数字成像工艺')
  if p.name=='prompt_layering.json':
   replace(p,OWN_OLD,OWN_NEW,1);replace(p,CRAFT_OLD,CRAFT_NEW,1)
  if p.name=='lock-anchors.json':
   d=json.loads(after[p]);row=next(r for r in d['locks'] if r['name']=='风格底座锁')
   assert row['manualAnchors']==['中国传统工笔设色与彩色连环画语言的二维手绘数字插画','白描式线条主导形体结构，轮廓线与内部结构线共同承担造型',CRAFT_OLD]
   for x,y in zip(row['manualAnchors'],['中国传统工笔设色（Gongbi painting）与白描线条（baimiao line drawing）主导','轮廓线与内部结构线共同承担造型，精细用笔（fine brushwork）',CRAFT_NEW]):replace(p,x,y,1)
  if p.name=='prefix.md':replace(p,'| R5 | 成像工艺干净，线条与罩染层次清晰 |','| R5 | 数字绘画表面洁净平整，线条与罩染层次清晰 |',1)
  if p.name=='README.md' and p.parent.name=='json':
   replace(p,'保留“'+CRAFT_OLD+'”','保留“'+CRAFT_NEW+'”',1)
   replace(p,'传统绘画转译/线条/罩染/墨色/传统色体系/成像工艺','工笔与白描主导/连环画造型/水彩薄染/水墨笔韵/传统色主次/数字绘画工艺',1)
  elif p.name=='README.md' and p.parent.name=='daojie_ink_guofeng':
   marker='本风格专为《道劫》修仙题材打造。'
   note='> **2026-10-16 五法融合底座**：工笔设色与白描线条主导，彩色连环画提供概括造型、透明水彩提供薄透设色、写意水墨提供笔触韵致；中英风格名称并列，主辅设色层级明确，数字绘画表面洁净平整。正文唯一真源为 `json/qi21_bases.json#art_style_base.positive_text`，不在本说明复制全文。查阅入口：[QwenCloud 图像提示词指南](https://docs.qwencloud.com/developer-guides/accuracy-tuning/image-generation)；该页列出工笔、水墨、水彩等风格词，示例模型为 `wan2.6-t2i`，不据此宣称本地 Qwen-Image-2.1 的专用触发词。\n\n'
   replace(p,marker,note+marker,1)
 source_sha=sha(after[SOURCE]);contract_sha=None;old_contract_sha=None
 for p in paths:
  if p.name!='runtime-contract.json':continue
  c=json.loads(before[p]);oc=c['contractSha256'];assert c['modules']['style.gongbi-base']['text']==OLD
  c['modules']['style.gongbi-base']['text']=NEW;c['localRevision']['styleSourceSha256']=source_sha
  c['contractSha256']=sha(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
  replace(p,OLD,NEW,1);replace(p,json.loads(before[p])['localRevision']['styleSourceSha256'],source_sha,1);replace(p,oc,c['contractSha256'],1)
  assert json.loads(after[p])==c
  if contract_sha:assert contract_sha==c['contractSha256']
  contract_sha=c['contractSha256'];old_contract_sha=oc
 replace(tests/'test_my_qi21_prompt_assembly.py','"锁层A全文": "'+sha(OLD.encode())[:16]+'",','"锁层A全文": "'+sha(NEW.encode())[:16]+'",',1)
 replace(tests/'test_my_qi21_bases_text.py','"成像工艺干净" in 风格','"数字绘画表面洁净平整" in 风格',1)
 replace(tests/'test_qi21_style_type_separation.py',CRAFT_OLD,CRAFT_NEW,1)
 b=tests/'test_qi21_style_boundary_1016.py'
 replace(b,"'明暗融入设色层次', '多色相并陈'","'明暗融入固有色', '协调统一'",1)
 replace(b,CRAFT_OLD,CRAFT_NEW,1)
 replace(b,"'清晰色面', '分染', '层层罩染',","'Gongbi painting', 'baimiao line drawing', 'classic Chinese lianhuanhua comic',\n                 'watercolor illustration', 'Chinese ink wash painting', 'soft transparent washes',\n                 '清晰色面', '分染', '层层罩染',",1)
 ts=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts'
 replace(ts,old_contract_sha,contract_sha,1)
 replace(ts,'中国传统工笔设色与彩色连环画语言的二维手绘数字插画','中国传统工笔设色（Gongbi painting）与白描线条（baimiao line drawing）主导',1)
 replace(ts,CRAFT_OLD,CRAFT_NEW,1)
 rows=[]
 for p in sorted(paths):
  if before[p]==after[p]:continue
  repo=p.is_relative_to(ROOT)
  if p.name.endswith('.json') and ('workflows' in p.parts or 'subgraphs' in p.parts):
   assert after[p].decode().replace(NEW,OLD)==before[p].decode(),p
   assert time.time()-p.stat().st_mtime>=1800,('shared workflow not quiet',p)
  if p.suffix=='.json':json.loads(after[p])
  idx=len(rows);staged=OUT/'planned'/f'{idx:03}.txt';staged.parent.mkdir(exist_ok=True);staged.write_bytes(after[p])
  rows.append({'path':str(p),'before':sha(before[p]),'after':sha(after[p]),'stage':str(staged),'group':'repo' if repo else 'deploy','replacements':ops[p]})
 (OUT/'sync-plan.json').write_text(dumps(rows));print(dumps({'files':len(rows),'repo':sum(r['group']=='repo' for r in rows),'mirrors':sum(r['group']=='deploy' for r in rows),'contract_sha256':contract_sha}))
def apply(group):
 rows=[r for r in json.loads((OUT/'sync-plan.json').read_text()) if r['group']==group]
 for r in rows:assert sha(Path(r['path']).read_bytes())==r['before'],('concurrent preimage',r['path'])
 ledger_file=OUT/'sync-changes.json';ledger=json.loads(ledger_file.read_text()) if ledger_file.exists() else []
 for r in rows:
  p=Path(r['path']);assert sha(p.read_bytes())==r['before'],p
  rel=p.relative_to(ROOT) if p.is_relative_to(ROOT) else Path('external')/p.relative_to('/')
  backup=OUT/'sync-backups'/rel;backup.parent.mkdir(parents=True,exist_ok=True);assert not backup.exists();shutil.copy2(p,backup)
  data=Path(r['stage']).read_bytes();assert sha(data)==r['after'];p.write_bytes(data)
  ledger.append({**r,'backup':str(backup)});ledger_file.write_text(dumps(ledger))
 print(dumps({'group':group,'written':len(rows)}))
if __name__=='__main__':
 if sys.argv[1]=='plan':plan()
 else:apply(sys.argv[1])
