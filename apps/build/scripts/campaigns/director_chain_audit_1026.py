"""Audit current task evidence offline without invoking Git, models or the app."""
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import re
import director_quality_glm_1025 as old

research = old.RESEARCH
ledger = [json.loads(line) for line in (old.COMPARISON / 'ledger.jsonl').read_text().splitlines() if line]
counts = Counter(row['event'] for row in ledger)
assert counts == {'probe': 2, 'attempt': 112, 'response': 112}, counts
calls = [row['call'] for row in ledger if row['event'] in ('probe', 'attempt')]
assert calls == list(range(1, 115))
attempts = [row for row in ledger if row['event'] == 'attempt' and row['key'].startswith('chain-')]
assert len(attempts) == 15 and len({row['key'] for row in attempts}) == 15
source_manifest, reference_count = old.load_sources(research / 'model-source-locations-canonical.json')
primary_reference_count = sum(1 + len(case['supportingSources']) + len(case['rejectedSources']) + bool(case['sourcePath']) for case in source_manifest['cases'])
ambiguity_reference_count = sum(len(item['references']) for case in source_manifest['cases'] for item in case.get('sourceAmbiguities', []))
# The historic 54 excludes R4's two source-ambiguity references; load_sources verifies both sets.
assert primary_reference_count == 54 and ambiguity_reference_count == 2
assert reference_count == primary_reference_count + ambiguity_reference_count == 56
stages = []
for profile in ('v8', 'v9', 'v10'):
    base = old.COMPARISON / ('chain-' + profile)
    for file in sorted(base.glob('**/decision.json')):
        decision = old.load_json(file)
        stages.append({'file': str(file.relative_to(research)), 'passed': decision['passed'], 'protocolRejected': '审核判定不一致或引用无法定位' in decision.get('report', '')})
assert len(stages) == 9 and sum(row['passed'] for row in stages) == 1
snapshot = old.load_json(research / 'chain-final-production-source-hashes.json')
assert all(hashlib.sha256((old.REPO / file).read_bytes()).hexdigest() == expected for file, expected in snapshot.items())
installed = old.load_json(research / 'chain-final-installed-content-verification.json')
assert installed['ok'] is True and len(installed['markerChecks']) == 7
assert hashlib.sha256(Path(installed['archive']).read_bytes()).hexdigest() == installed['installedSha256']
assert hashlib.sha256(Path(installed['packaged']).read_bytes()).hexdigest() == installed['packagedSha256']
for manual in old.load_json(old.COMPARISON / 'chain-v10/manuals.json'):
    current = old.REPO / 'apps/frontend/assets/studio-manuals' / manual['relativePath']
    assert hashlib.sha256(current.read_bytes()).hexdigest() == manual['sha256']
assert old.load_json(research / 'chain-final-document-consistency.json')['ok'] is True
replay = old.load_json(research / 'chain-final-offline-script-replay.json')
assert replay['apiRequestsMade'] == 0 and all(row['passed'] is False for row in replay['decisions'])
chapter_totals = {}
for case in ('P5', 'R3'):
    file = old.COMPARISON / 'chain-v10/chains' / case / 'script/generation/output.md'
    text = file.read_text()
    chapter_totals[case] = sum(int(value) for value in re.findall(r'·约(\d+)秒', text))
assert chapter_totals == {'P5': 170, 'R3': 180}
metadata = old.load_json(research.parent / 'task.json')
assert metadata['status'] == 'in_progress' and metadata['completedAt'] is None
assert '[ ] AC5' in (research.parent / 'prd.md').read_text()
receipt = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'apiRequestsMade': 0, 'cumulativeCalls': 114, 'remainingCalls': 0, 'newCalls': 15, 'ledgerEvents': dict(counts), 'sourceReferencesVerified': reference_count, 'primarySourceReferences': primary_reference_count, 'ambiguityReferences': ambiguity_reference_count, 'reviewResults': stages, 'v10ScriptSeconds': chapter_totals, 'modelSemanticPassed': False, 'reason': 'R3 still adds ungrounded color; only two script cases retested, no new full three-stage model chain.', 'sourceHashesStillMatch': True, 'installedFinalBundleVerified': True, 'offlineScriptReplayRejected': ['P5', 'R3'], 'archived': False}
(research / 'chain-current-evidence-audit.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'cumulativeCalls': 114, 'newCalls': 15, 'reviews': 9, 'modelSemanticPassed': False}))
