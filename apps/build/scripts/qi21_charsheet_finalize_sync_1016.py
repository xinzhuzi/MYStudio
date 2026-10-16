"""Synchronize current card pointers and whole-source contract fingerprints."""
from pathlib import Path
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-six-zone-1016'
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
sha=lambda x:hashlib.sha256(x).hexdigest()
rows=[]
def write(p,data):
 old=p.read_bytes()
 if old==data:return
 b=OUT/'final-sync-backups'/p.resolve().relative_to('/');b.parent.mkdir(parents=True,exist_ok=True);assert not b.exists();shutil.copy2(p,b);assert p.read_bytes()==old
 p.write_bytes(data);rows.append({'path':str(p),'backup':str(b),'before':sha(old),'after':sha(data)})
# Replace only current six-zone descriptions, never historical snapshots.
paths=[ROOT/'.agents/skills/daojie-charsheet-prompter/SKILL.md',M/'art_prompt/art_subject_ten_types.md',next(p for p in (ROOT/'docs/prompts').iterdir() if p.name=='道劫_类型主体句示例.md'),next((ROOT/'docs/prompts/Qwen-Image-2.1').glob('05-*'))]
for p in paths:
 s=p.read_text();s=s.replace('朝画面右侧的纯侧面','纯九十度侧面').replace('朝画面右侧纯侧面','纯九十度侧面').replace('朝画面右侧的纯九十度侧面','纯九十度侧面')
 write(p,s.encode())
# Derived contract hashes include the complete source JSON; style module remains identical.
prior=json.loads((OUT.parent/'qi21-five-method-style-1016/sync-changes.json').read_text());source_sha=sha((M/'json/qi21_bases.json').read_bytes());contract_sha=None;old_sha=None
for r in prior:
 p=Path(r['path'])
 if p.name!='runtime-contract.json':continue
 c=json.loads(p.read_text());old_sha=c['contractSha256'];c['localRevision']['styleSourceSha256']=source_sha
 c['contractSha256']=sha(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
 if contract_sha:assert contract_sha==c['contractSha256']
 contract_sha=c['contractSha256'];write(p,(json.dumps(c,ensure_ascii=False,indent=2)+'\n').encode())
p=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts';s=p.read_text();assert s.count(old_sha)==1;write(p,s.replace(old_sha,contract_sha,1).encode())
# Manual mirrors already registered by the prior style rollout.
manual_roots=[Path(r['path']).parents[1] for r in json.loads((OUT/'mirror-data-sync.json').read_text()) if Path(r['path']).parent.name=='json']
for root in manual_roots:
 for rel in ['art_prompt/art_subject_ten_types.md']:
  p=root/rel;assert p.exists();p.read_bytes();write(p,(M/rel).read_bytes())
(OUT/'final-sync.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print('synchronized',len(rows),'files','contract',contract_sha)
