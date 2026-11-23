"""Read-only evidence audit for the existing 1025 director task; no API or Git calls."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import hashlib
import json
import re

root = Path(__file__).resolve().parents[3]
task = root / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation'
research = task / 'research'
report = (research / 'final-model-and-install-review.md').read_text()
checks = []

# The frozen manifest's summary is historical; derive current counts from cases.
manifest = json.loads((research / 'model-source-locations-canonical.json').read_text())
counts = Counter(c['inputType'] for c in manifest['cases'])
assert counts == {'chapter_excerpt': 7, 'canonical_boundary_probe': 12}, counts
assert len(manifest['cases']) == 19
assert all(c['status'] == 'ready' for c in manifest['cases'])
references = []
for case in manifest['cases']:
    references.extend([
        (case['sourcePath'], case['startLine'], case['endLine'],
         case['sourceSha256'], case['sourceExcerptSha256']),
        (case['canonPath'], case['canonStartLine'], case['canonEndLine'],
         case['canonSha256'], case['canonExcerptSha256']),
    ])
    for item in case['supportingSources'] + case['rejectedSources']:
        references.append((item['path'], item['startLine'], item['endLine'],
                           item['sha256'], item['excerptSha256']))
for path, start, end, full_hash, excerpt_hash in references:
    data = Path(path).read_bytes()
    assert hashlib.sha256(data).hexdigest() == full_hash, path
    excerpt = ''.join(data.decode('utf-8').splitlines(keepends=True)[start-1:end])
    assert hashlib.sha256(excerpt.encode('utf-8')).hexdigest() == excerpt_hash, path
assert len(references) == 54, len(references)
checks.append('19 cases: 7 chapter / 12 canon; all 54 full-file and excerpt hashes match')

ledger = [json.loads(line) for line in (research / 'model-comparison/ledger.jsonl').read_text().splitlines() if line]
events = Counter(item['event'] for item in ledger)
assert events == {'probe': 2, 'attempt': 97, 'response': 97}, events
assert max(item['call'] for item in ledger) == 99
assert len({item['call'] for item in ledger if item['event'] in ['probe', 'attempt']}) == 99
checks.append('ledger: 99/114 calls; 2 probes + 97 attempts + 97 response events')

english = ['narrativeFocus', 'emotionalProgression', 'sourceMatchedVisualStrategy', 'downstreamExecutability']
chinese = ['叙事聚焦', '情绪递进', '视觉策略贴源', '下游可执行性']
current_dimensions = ['叙事重点明确度', '情绪递进', '视觉策略与剧情适配', '下游可执行性']
case_ids = ['P1', 'P3', 'P5', 'R1', 'R2', 'R3', 'R5']
table = {}
for line in report.splitlines():
    match = re.fullmatch(r'\| (P1|P3|P5|R1|R2|R3|R5) \| ([0-2/]+) \| ([0-2/]+) \| ([0-2/]+) \| FAIL \|', line)
    if match:
        table[match[1]] = [[int(n) for n in match[i].split('/')] for i in [2, 3, 4]]
assert set(table) == set(case_ids)
quote_checks = 0
for case_id in case_ids:
    base = research / 'model-comparison/final-v3' / case_id
    old = json.loads((base / 'assessment.json').read_text())
    arms = old['perArm'] if case_id == 'P1' else old['arms']
    dims = chinese if case_id in ['P5', 'R5'] else list(english)
    if case_id == 'R2':
        dims[2] = 'visualStrategyMatchedToSource'
    baseline = [arms['baseline']['scores'][d]['score'] for d in dims]
    initial = [arms['revised']['scores'][d]['score'] for d in dims]
    base = research / 'model-comparison/fidelity-v6' / case_id
    current = json.loads((base / 'assessment.json').read_text())
    scores = [current['scores'][d]['score'] for d in current_dimensions]
    assert table[case_id] == [baseline, initial, scores], case_id
    assert current['baselineScores'] == baseline, case_id
    assert current['overallHardGate'] == 'FAIL', case_id
    assert (base / 'assessment.md').is_file()
    for gate in current['hardGates'].values():
        assert gate['status'] == 'FAIL', (case_id, gate)
        path, line_no = gate['evidence'].rsplit(':', 1)
        lines = (base / path).read_text().splitlines()
        assert 1 <= int(line_no) <= len(lines), (case_id, gate['evidence'])
        assert gate['quote'] in lines[int(line_no)-1], (case_id, gate['evidence'])
        quote_checks += 1
checks.append(f'7 score-table rows match baseline / initial / v6 JSON; {quote_checks} hard-gate quotes match exact output lines; all FAIL')

for prefix in ['format-v7-regression', 'format-v7-typecheck', 'format-v7-harness-checks', 'format-v7-build-install']:
    assert (research / (prefix + '.exit')).read_text().strip() == '0', prefix
    assert (research / (prefix + '.log')).is_file(), prefix
assert '238 passed (238)' in (research / 'format-v7-regression.log').read_text()
assert 'Ran 11 tests' in (research / 'format-v7-harness-checks.log').read_text()
smoke = json.loads((research / 'format-v7-installed-smoke-report.json').read_text())
assert smoke['ok'] is True and smoke['realMediaGeneration'] is False
installed = json.loads((research / 'format-v7-installed-content-verification.json').read_text())
assert installed['ok'] is True and installed['allFiveExact'] is True
assert installed['installedSha256'] == installed['packagedSha256']
with Path(installed['archive']).open('rb') as stream:
    digest = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(block)
assert digest.hexdigest() == installed['installedSha256']
for item in installed['found']:
    assert hashlib.sha256(Path(item['source']).read_bytes()).hexdigest() == item['sha256'], item['manual']
assert len(installed['found']) == 5
checks.append('v7 receipts exit0 / smoke true; current installed asar and all five source hashes still match the AST verification receipt; media generation false')

for name in ['implement.jsonl', 'check.jsonl']:
    rows = [json.loads(line) for line in (task / name).read_text().splitlines() if line]
    assert rows and all((root / row['file']).is_file() for row in rows), name
metadata = json.loads((task / 'task.json').read_text())
assert metadata['status'] == 'in_progress' and metadata['completedAt'] is None
prd = (task / 'prd.md').read_text()
assert '[ ] AC5' in prd
for number in [1, 2, 3, 4, 6]:
    assert f'[x] AC{number}' in prd
mother = root / '.trellis/tasks/archive/2026-10/10-25-daojie-story-skill-canon-alignment'
assert json.loads((mother / 'task.json').read_text())['status'] == 'completed'
assert (mother / 'prd.md').read_text().startswith((task / 'backups/mother-prd.md').read_text())
for relative in ['prd.md', 'design.md', 'implement.md', 'research/verification.md', 'research/resume-verification.md', 'research/current-model-protocol.md']:
    text = (task / relative).read_text()
    assert '99/114' in text and any(marker in text for marker in ['FAIL', '硬门失败']), relative
assert (research / 'next-scope-proposal.md').is_file()
checks.append('AC5 open; task in_progress; context references valid; mother completed metadata and original PRD prefix preserved; current documents state 99/114 and FAIL')

receipt = {
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'ok': True,
    'scope': 'Evidence/document consistency only; this does not turn model semantic FAIL into PASS',
    'modelSemanticPassed': False,
    'apiRequestsMade': 0,
    'checks': checks,
}
(research / 'document-consistency-verification.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(receipt, ensure_ascii=False, indent=2))
