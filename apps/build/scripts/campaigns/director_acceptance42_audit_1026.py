"""Final offline verification of the authorized first-batch stop. No API or Git."""
from pathlib import Path
from collections import Counter
from datetime import datetime,timezone
import json
import hashlib
import director_chain_acceptance_1026 as run
old=run.old
root=run.ROOT
lock=old.load_json(root/'experiment.json')
assert all(old.digest((old.REPO/file).read_bytes())==digest for file,digest in lock['codeHashes'].items())
with run.AcceptanceLedger(old.COMPARISON/'ledger.jsonl',119) as ledger:
    counts=Counter(row['event'] for row in ledger.rows)
    assert counts=={'probe':2,'attempt':117,'response':117}
    attempts=[row for row in ledger.rows if row['event']=='attempt' and row['key'].startswith(root.name+':')]
    assert [row['call'] for row in attempts]==[115,116,117,118,119]
    assert len({row['key'] for row in attempts})==5
    assert all('/P5/script/' in row['key'] or '/P5/planning/' in row['key'] or '/R3/script/' in row['key'] for row in attempts)
for case,stage,passed in (('P5','script',True),('P5','planning',False),('R3','script',False)):
    p=root/'chains'/case/stage
    receipt=old.load_json(p/'primary-review.json')
    assert receipt['passed'] is passed and receipt['outputSha256']==old.digest((p/'generation/output.md').read_bytes())
assert old.load_json(root/'chains/P5/planning/audit/decision.json')['passed'] is True
assert not (root/'chains/P5/storyboard').exists()
assert not (root/'chains/R3/planning').exists()
assert not (root/'chains/R3/script/audit/output.md').exists()
assert all(not (root/'chains'/case).exists() for case in run.CASES[2:])
for case,stage in (('P5','storyboard'),('R3','planning'),('P1','script')):
    try: run.check_dependencies(case,stage)
    except old.HarnessError: pass
    else: raise AssertionError('downstream barrier should reject')
_,refs=old.load_sources(old.RESEARCH/'model-source-locations-canonical.json');assert refs==56
for manual in old.load_json(root/'manuals.json'):
    assert old.digest((old.REPO/'apps/frontend/assets/studio-manuals'/manual['relativePath']).read_bytes())==manual['sha256']
metadata=old.load_json(old.RESEARCH.parent/'task.json');assert metadata['status']=='in_progress' and metadata['completedAt'] is None
assert '[ ] AC5' in (old.RESEARCH.parent/'prd.md').read_text()
for name in ('prd.md','design.md','implement.md'):
    text=(old.RESEARCH.parent/name).read_text();assert '119/156' in text[:1500] and '剩37' in text[:1500]
for name in ('implement.jsonl','check.jsonl'):
    rows=[json.loads(line) for line in (old.RESEARCH.parent/name).read_text().splitlines() if line]
    assert all((old.REPO/row['file']).exists() for row in rows)
for name in ('acceptance42-regression','acceptance42-typecheck','acceptance42-offline-tests'):
    assert (old.RESEARCH/(name+'.exit')).read_text().strip()=='0'
assert '261 passed' in (old.RESEARCH/'acceptance42-regression.log').read_text()
receipt={'generatedAt':datetime.now(timezone.utc).isoformat(),'ok':True,'apiRequestsMade':0,'initialCalls':114,'currentCalls':119,'maxCalls':156,'remainingCalls':37,'newCalls':5,'ledger':dict(counts),'referencesVerified':refs,'frozenCodeStillMatches':True,'firstBatchPassed':False,'secondBatchStarted':False,'retries':0,'modelFalseNegativeConfirmed':True,'taskStatus':'in_progress','completedAt':None,'realMediaGeneration':False}
old.persist(old.RESEARCH/'acceptance42-evidence-audit.json',receipt)
print(json.dumps(receipt,ensure_ascii=False))
