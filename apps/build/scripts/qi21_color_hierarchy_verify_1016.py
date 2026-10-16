"""Read-only verification of the scoped color hierarchy rollout; writes receipts only."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/qi21-color-hierarchy-1016'
MANUAL=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
sha=lambda b:hashlib.sha256(b).hexdigest()
ledger=json.loads((OUT/'changes.json').read_text())
final=(OUT/'final-style.txt').read_text().strip()
errors=[]
checks=[]
for row in ledger:
    path=Path(row['path']);current=path.read_bytes();before=Path(row['backup']).read_bytes()
    if sha(current)!=row['after']: errors.append('Concurrent change: '+str(path))
    if sha(before)!=row['before']: errors.append('Backup mismatch: '+str(path))
    checks.append({'path':str(path),'backup_valid':sha(before)==row['before'],'current_valid':sha(current)==row['after']})
    if path.suffix!='.json':continue
    old,new=json.loads(before),json.loads(current)
    if path.name=='qi21_bases.json':
        for key in old:
            if key not in ('art_style_base','layer_contract') and old[key]!=new[key]:
                errors.append('Unexpected data change: '+str(path)+'/'+key)
        if old['art_style_base']['negative_text']!=new['art_style_base']['negative_text']:
            errors.append('Negative style changed: '+str(path))
        if new['art_style_base']['positive_text']!=final:errors.append('Style mismatch: '+str(path))
    elif path.name=='runtime-contract.json':
        if new['modules']['style.gongbi-base']['text']!=final:errors.append('Contract style mismatch: '+str(path))
        calculated=sha(json.dumps({k:v for k,v in new.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
        if calculated!=new['contractSha256']:errors.append('Contract fingerprint mismatch: '+str(path))
        if new['localRevision']['styleSourceSha256']!=sha((MANUAL/'json/qi21_bases.json').read_bytes()):errors.append('Contract source fingerprint mismatch: '+str(path))
    elif 'nodes' in old:
        # Exact string reversal proves graph, links, widgets outside the style and params unchanged.
        old_style=json.loads(next(Path(r['backup']).read_text() for r in ledger if r['path']==str(MANUAL/'json/qi21_bases.json')))['art_style_base']['positive_text']
        if current.decode().replace(final,old_style)!=before.decode():
            errors.append('Unexpected workflow change: '+str(path))

for term in ['丰富多彩','协调统一','主色统领','辅色呼应','点睛色突出','层级分明']:
    if term not in final:errors.append('Missing color requirement: '+term)
for term in ['背景','光照','时段','血痕','尘土','身体状态','近景','远景','构图','留白']:
    if term in final:errors.append('Style boundary crossed: '+term)

# Check every manual document; retain historical and reference content as records.
pattern=re.compile(r'水墨为主|至多.{0,10}[23二三]|2[–—~-]3.{0,15}(低饱和|矿物色|点缀)|低饱和淡彩|淡墨淡彩细线低对比')
coverage=[];residual=[]
changed={r['path'] for r in ledger}
for path in sorted(MANUAL.rglob('*.md')):
    text=path.read_text();hits=[{'line':n,'text':line} for n,line in enumerate(text.splitlines(),1) if pattern.search(line)]
    historical='ma_sync' in path.parts
    coverage.append({'path':str(path),'sha256':sha(path.read_bytes()),'changed':str(path) in changed,'historical_snapshot':historical,'hits':hits})
    if hits and not historical:residual.extend([{'path':str(path),**hit} for hit in hits])
if residual:errors.append('Unresolved active manual restrictions')

# Exercise the actual node default and UI payload without starting the engine.
node_path=ROOT/'apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_bases_text.py'
spec=importlib.util.spec_from_file_location('color_hierarchy_node_probe',node_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
node=module.MyQi21美术风格底座()
default=node.INPUT_TYPES()['optional']['美术风格'][1]['default']
result=node.output()
if default!=final or result['result'][0]!=final or final not in json.dumps(result['ui'],ensure_ascii=False):
    errors.append('Runtime output / UI payload mismatch')
probe={'data_source':str(module._BASES_JSON),'default_equal':default==final,'result_equal':result['result'][0]==final,'ui':result['ui']}
(OUT/'ui-node-probe.json').write_text(json.dumps(probe,ensure_ascii=False,indent=2)+'\n')
(OUT/'document-coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n')
report={'ok':not errors,'files':len(ledger),'manual_documents':len(coverage),'manual_documents_changed':sum(r['changed'] for r in coverage),'active_conflicts':residual,'errors':errors,'checks':checks}
(OUT/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='checks'},ensure_ascii=False,indent=2))
raise SystemExit(bool(errors))
