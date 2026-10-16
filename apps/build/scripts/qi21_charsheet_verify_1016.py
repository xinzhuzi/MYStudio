"""Fresh read-only verification of the six-zone change and synchronized documents."""
from pathlib import Path
import json,hashlib,re
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-six-zone-1016';M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng';P=M/'json/qi21_bases.json'
sha=lambda x:hashlib.sha256(x).hexdigest()
checks=[]
def check(name,value,detail=None):checks.append({'check':name,'passed':bool(value),'detail':detail})
d=json.loads(P.read_text());old=json.loads((OUT/'backups'/P.relative_to(ROOT)).read_text());c=next(t for t in d['types'] if t['zh']=='设定卡')
check('only-card-entry-changed',{**d,'types':[t for t in d['types'] if t['zh']!='设定卡']}=={**old,'types':[t for t in old['types'] if t['zh']!='设定卡']})
check('approved-style-verbatim',d['art_style_base']['positive_text']==(OUT.parent/'qi21-five-method-style-1016/new-style.txt').read_text().rstrip('\n'))
check('opaque-transparent-type-identical',c['positive_text']==c['rgba_positive'])
for r in json.loads((OUT/'mirror-data-sync.json').read_text()):
 p=Path(r['path']);obj=json.loads(p.read_text());check('card-mirror',next(t for t in obj['types'] if t['zh']=='设定卡')==c,str(p));check('style-mirror',obj['art_style_base']==d['art_style_base'],str(p))
for r in json.loads((OUT/'code-sync.json').read_text()):
 check('node-mirror',Path(r['path']).read_bytes()==(ROOT/'apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_api_pe.py').read_bytes(),r['path'])
for r in json.loads((OUT.parent/'qi21-five-method-style-1016/sync-changes.json').read_text()):
 p=Path(r['path'])
 if p.name!='runtime-contract.json':continue
 obj=json.loads(p.read_text());check('source-fingerprint',obj['localRevision']['styleSourceSha256']==sha(P.read_bytes()),str(p));check('contract-fingerprint',obj['contractSha256']==sha(json.dumps({k:v for k,v in obj.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()),str(p))
# Exact old filenames are allowed only in dated experiment history; current pointers must use renamed files.
paths=[ROOT/'.agents/skills/daojie-charsheet-prompter/SKILL.md',M/'art_prompt/art_subject_ten_types.md']+[Path(r['path']) for r in json.loads((OUT/'doc-changes.json').read_text())]
for p in sorted(set(paths)):
 s=p.read_text();check('current-doc-six-zones','六区' in s or '六个图像区' in s,str(p));check('no-current-right-direction-lock','朝画面右侧' not in s,str(p))
example=next(p for p in (ROOT/'docs/prompts').iterdir() if p.name=='道劫_类型主体句示例.md');example_old=OUT/'doc-backups'/example.relative_to(ROOT)
check('ten-subjects-unchanged',re.findall(r'```[^\n]*\n(.*?)```',example.read_text(),re.S)==re.findall(r'```[^\n]*\n(.*?)```',example_old.read_text(),re.S))
result={'passed':all(x['passed'] for x in checks),'checks':checks};(OUT/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('passed',sum(x['passed'] for x in checks),'/',len(checks));print([x for x in checks if not x['passed']]);raise SystemExit(0 if result['passed'] else 1)
