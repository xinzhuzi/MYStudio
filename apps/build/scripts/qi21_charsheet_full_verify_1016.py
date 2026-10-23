"""Read current files and verify the approved full-board change boundary and mirrors."""
from pathlib import Path
import hashlib,json,re
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-full-board-1016';M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng';checks=[]
sha=lambda b:hashlib.sha256(b).hexdigest()
def check(name,ok,path=''):checks.append({'check':name,'passed':bool(ok),'path':str(path)})
p=M/'json/qi21_bases.json';d=json.loads(p.read_text());before=json.loads((OUT/'backups'/p.relative_to(ROOT)).read_text());card=next(t for t in d['types'] if t['zh']=='设定卡')
check('only-card-data-changed',{**d,'types':[t for t in d['types'] if t['zh']!='设定卡']}=={**before,'types':[t for t in before['types'] if t['zh']!='设定卡']})
check('current-style-verbatim',d['art_style_base']==before['art_style_base'])
check('full-type-shared',card['positive_text']==card['rgba_positive'])
check('full-board-defaults',(card['aspect_ratio'],card['megapixels'],card['rgba_default'])==('21:9 (Ultrawide)',3.0,False))
check('source-no-six-zone','固定六个图像区' not in card['positive_text'])
prev=OUT.parent/'daojie-charsheet-six-zone-1016';homes=[M]
for row in json.loads((prev/'mirror-data-sync.json').read_text()):
 p=Path(row['path']);obj=json.loads(p.read_text());check('card-mirror',next(t for t in obj['types'] if t['zh']=='设定卡')==card,p)
 if p.parent.name=='json':homes.append(p.parent.parent)
for row in json.loads((prev/'code-sync.json').read_text()):
 p=Path(row['path']);check('pe-code-mirror',p.read_bytes()==(ROOT/'apps/backend/comfyui/my_nodes/nodes/my_qi21_api_pe.py').read_bytes(),p)
for home in homes:
 p=home/'ma_sync/runtime-contract.json';c=json.loads(p.read_text());check('source-sha',c['localRevision']['styleSourceSha256']==sha((home/'json/qi21_bases.json').read_bytes()),p)
 check('contract-sha',c['contractSha256']==sha(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()),p)
 for rel in ['art_prompt/art_subject_ten_types.md','style_guide/'+next((M/'style_guide').glob('07_*')).name,'json/README.md']:
  p=home/rel;s=p.read_text();source=(M/rel).read_text()
  if rel.startswith('art_prompt'):
   start=s.index('## §10 设定卡');end=s.index('\n---',start);ss=source.index('## §10 设定卡');se=source.index('\n---',ss);ok=s[start:end]==source[ss:se]
  elif rel.startswith('style_guide'):ok='2712×1160' in s and '设定卡当前用法（1016 完整版）' in s
  else:ok='设定卡 false' in s
  check('manual-current',ok,p)
p=next(p for p in (ROOT/'docs/prompts').iterdir() if p.name=='道劫_类型主体句示例.md');old=(OUT/'doc-backups'/p.relative_to(ROOT)).read_text()
check('ten-subject-blocks-unchanged',re.findall(r'```[^\n]*\n(.*?)```',p.read_text(),re.S)==re.findall(r'```[^\n]*\n(.*?)```',old,re.S))
# Preserve source and final fingerprints for every changed file without reapplying mutations.
rows=[]
for receipt in ['source-changes.json','doc-changes.json','sync-changes.json','extra-changes.json','extra-sync.json','refine-changes.json']:
 for row in json.loads((OUT/receipt).read_text()):
  p=Path(row['path']);rows.append({**row,'finalSha256':sha(p.read_bytes())});check('changed-file-present',p.is_file(),p)
(OUT/'final-file-inventory.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
result={'passed':all(x['passed'] for x in checks),'checks':checks};(OUT/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('checks',sum(x['passed'] for x in checks),'/',len(checks));print([x for x in checks if not x['passed']]);raise SystemExit(0 if result['passed'] else 1)
