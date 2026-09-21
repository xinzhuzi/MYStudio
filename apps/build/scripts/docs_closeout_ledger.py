#!/usr/bin/env python3
"""Build task-owned evidence ledgers; read docs/source, write reports only."""
from collections import Counter
from datetime import datetime, timezone
import ast
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / '.trellis/tasks/09-20-docs-current-alignment/research'
audit = json.loads((RESEARCH / 'audit-final.json').read_text())
write = lambda name, data: (RESEARCH / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

# Every scanner hit keeps its exact path, line, text and reason. Unknowns stay open.
decisions = []
for item in audit['source_paths_needing_review']:
    f, path = item['file'], item['path']
    lines = (ROOT / f).read_text().splitlines()
    line = lines[item['line'] - 1]
    row = dict(item, kind='source-path', context=line, status='reviewed')
    normalized = re.sub(r':\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$', '', path)
    if normalized != path and (ROOT / normalized).exists():
        row.update(disposition='scanner-line-list', reason='The source file exists; the scanner only strips a single trailing line range.', evidence=normalized)
    elif f.endswith(('MoYin_资产生成_技术调查.md', 'ToonFlow_剧情产物生成_技术调查.md', 'IMG2THREEJS_EXPLORATION.md')):
        row.update(disposition='external-source-snapshot', reason='Document header identifies another project or an archived external investigation; not a MYStudio source reference.', evidence=f + ':3')
    elif path in ('apps/backend/python','backend/python','apps/.venv','apps/backend/.venv','apps/Library/','apps/frontend/app/','apps/frontend/lib/api-key-manager.ts'):
        row.update(disposition='retired-or-prohibited-path', reason='The surrounding paragraph explicitly says missing, retired, excluded from packaging, or forbidden as a runtime location.', evidence=f + ':' + str(item['line']))
    elif path in ('apps/out/','apps/out','apps/dist-electron'):
        row.update(disposition='generated-output', reason='Build output/legacy cleanup target; it need not exist in a source checkout.', evidence='apps/frontend/config/electron-vite.config.ts; apps/build/packaging/build-mac.sh')
    elif path in ('frontend/assets/studio-manuals','backend/requirements.txt') and (ROOT / 'apps' / path).exists():
        row.update(disposition='apps-relative-path', reason='Packaging/backend context uses apps as working directory; resolved target exists.', evidence='apps/' + path)
    elif f.startswith(('docs/research/','docs/guides/','docs/融合/')) or f.endswith(('B5-trackKey-runtime-resolution-summary.md','architecture-coupling-audit-0831.md')):
        row.update(disposition='dated-plan-or-history', reason='Explicit history/plan boundary scopes the original body; preserve original evidence and use the linked current guides.', evidence=f + ':1-12')
    else:
        row.update(status='open', disposition='unresolved', reason='Needs individual source verification.', evidence=f)
    decisions.append(row)
for item in audit['npm_scripts_needing_review']:
    line = (ROOT / item['file']).read_text().splitlines()[item['line']-1]
    row = dict(item, kind='npm-script', context=line)
    if item['script']=='package' and item['file'].endswith('DOCS_MAINTENANCE.md'):
        row.update(status='reviewed', disposition='scanner-search-example', reason='The occurrence is in a maintenance search regex, not an executable current npm command.', evidence=item['file']+':'+str(item['line']))
    elif item['script']=='video:daojie:chapter001' and 'video:chapter001' in (ROOT/item['file']).read_text().splitlines()[2]:
        row.update(status='reviewed', disposition='dated-command-with-current-mapping', reason='Header preserves the historical command and maps current operation to video:chapter001.', evidence=item['file']+':3; apps/package.json')
    else: row.update(status='open',disposition='unresolved',reason='Needs command verification')
    decisions.append(row)
write('path-command-decisions.json', {'generated_at':datetime.now(timezone.utc).isoformat(),'summary':dict(Counter(x['disposition'] for x in decisions)),'unresolved':sum(x['status']=='open' for x in decisions),'items':decisions})

# Semantic review depth is reported honestly; structural coverage is not a full reread.
reviews = {}
for name in ['director-review.json','settings-review.json','history-review.json']:
    for entry in json.loads((RESEARCH/name).read_text())['documents']:
        reviews.setdefault(entry['path'],[]).append({'report':name,**entry})
edit_sources = {}
for p in sorted((ROOT/'apps/build/scripts').glob('docs_refresh_*.py')):
    for node in ast.walk(ast.parse(p.read_text())):
        if isinstance(node,ast.Constant) and isinstance(node.value,str) and node.value.startswith('docs/') and node.value.endswith('.md') and '\n' not in node.value:
            edit_sources.setdefault(node.value,[]).append(str(p.relative_to(ROOT)))
for p in RESEARCH.glob('*edits.json'):
    data=json.loads(p.read_text())
    for item in data if isinstance(data,list) else []:
        if item.get('path'):edit_sources.setdefault(item['path'],[]).append(p.name)
baseline={x['path']:x for x in json.loads((RESEARCH/'baseline.json').read_text())}
ledger=[];fences=[];duplicates=[]
for item in audit['inventory']:
    path=item['path'];file=ROOT/path;text=file.read_text();lines=text.splitlines(); prior=baseline.get(path)
    if item['section']=='prompts': category='prompt-reference-or-dated-experiment'
    elif '/参考_提示词工程/' in path or '/参考/' in path and not path.endswith('README.md'):category='external-reference-or-historical-research'
    elif item['section'] in ('research','融合','guides','local') or path.endswith(('B5-trackKey-runtime-resolution-summary.md','architecture-coupling-audit-0831.md')):category='dated-plan-or-history'
    elif item['section']=='comfyui-kb':category='pipeline-knowledge-with-dated-evidence'
    elif path.endswith(('LEGACY_SCRIPT_WORKSPACE_GUIDE.md','ASSIST_WORKBENCH_GUIDE.md','ASSIST_WORKBENCH_OPERATIONS.md','ASSIST_WORKBENCH_PARAMETER_REFERENCE.md','voicebox-voice-cloning-flow.md')):category='compatibility-or-retired-entry'
    elif 'art-styles' in path:category='style-gallery'
    elif '/README' in path:category='navigation-index'
    else:category='current-guide'
    evidence=[{'report':'audit-final.json','scope':'inventory/hash/local-links/navigation'},*reviews.get(path,[])]
    changes=edit_sources.get(path,[])
    depth='structure-links-and-applicability-boundary; no exhaustive semantic reread claimed'
    if reviews.get(path):depth='document-specific independent review plus main-thread source spot checks; see read_scope in evidence'
    elif changes:depth='source-aligned targeted passages plus structure/link/applicability check; see edit evidence'
    status='unchanged' if prior and prior['sha256']==item['sha256'] else 'changed-since-baseline' if prior else 'added-since-baseline'
    ledger.append({'path':path,'category':category,'review_depth':depth,'disposition':'retain documented historical/reference scope' if category in ('dated-plan-or-history','external-reference-or-historical-research','prompt-reference-or-dated-experiment','style-gallery') else 'retain current guide with source-verified corrections where recorded','sha256':item['sha256'],'baseline_state':status,'edit_evidence':changes,'evidence':evidence,'claim_limit':'No media generation, packaging, external URL revalidation, or exhaustive every-sentence semantic verification.'})
    fence=None
    for i,line in enumerate(lines,1):
        s=line.lstrip()
        if s.startswith(('```','~~~')):
            c=s[0];n=len(s)-len(s.lstrip(c))
            if fence is None:fence=(c,n,i)
            elif c==fence[0] and n>=fence[1] and not s[n:].strip():fence=None
    if fence:fences.append({'path':path,'line':fence[2]})
    for i in range(1,len(lines)):
        if len(lines[i])>90 and lines[i]==lines[i-1]:duplicates.append({'path':path,'line':i+1})
assert {x['path'] for x in ledger}=={str(p.relative_to(ROOT)) for p in (ROOT/'docs').rglob('*.md')}
write('review-ledger.json',{'generated_at':datetime.now(timezone.utc).isoformat(),'total':len(ledger),'categories':dict(Counter(x['category'] for x in ledger)),'documents':ledger})
write('structure-and-scope.json',{'markdown':len(ledger),'missing_baseline_documents':sorted(set(baseline)-{x['path'] for x in ledger}),'unclosed_fences':fences,'adjacent_duplicate_long_lines':duplicates,'unreachable':audit['unreachable_markdown'],'states':dict(Counter(x['baseline_state'] for x in ledger)),'new_documents':[x['path'] for x in ledger if x['baseline_state']=='added-since-baseline'],'attribution':'Baseline SHA differences include concurrent sessions; they are not all claimed as edits by this task. Exact late edits have individual manifests; earlier edits have scoped scripts and backups.'})
print(json.dumps({'documents':len(ledger),'unresolved_paths_commands':sum(x['status']=='open' for x in decisions),'unclosed_fences':len(fences),'duplicate_lines':len(duplicates)},ensure_ascii=False))
