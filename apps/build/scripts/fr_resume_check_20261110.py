"""Read-only resume check: reuse completed chapters whose evidence still matches."""
from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[3]
task = root / '.trellis/tasks/10-27-script-narrative-translation-cure'
research = task / 'research'
ledger = json.loads((research / 'fr-volumes-current-20261110.json').read_text())
baseline = json.loads((research / ledger['baseline']).read_text())
sources = {item['chapter']: item for volume in baseline['volumes']
           for item in volume['chapters']}
closed = []
historical_closed = []
errors = []
for row in ledger['volume1']['chapters']:
    historical = row['status'] == 'offline_content_closed_historical_sha'
    if row['status'] != 'offline_content_closed_current_sha' and not historical:
        continue
    chapter = row['chapter']
    if row['current_independent_pass'] is not True or row['main_fresh_exit_code'] != 0:
        errors.append({'chapter': chapter, 'error': 'missing independent or main acceptance'})
        continue
    missing = [name for name in row['evidence'] if not (research / name).is_file()]
    if missing:
        errors.append({'chapter': chapter, 'missing_evidence': missing})
        continue
    fresh_path = research / (row['historical_fresh_file'] if historical
                             else f'chapter{chapter:03d}-mainfresh-20261110.json')
    if fresh_path.name not in row['evidence']:
        errors.append({'chapter': chapter, 'error': 'main fresh not linked'})
        continue
    fresh = json.loads(fresh_path.read_text())
    fresh_pass = fresh['summary']['pass'] if 'summary' in fresh else fresh['pass']
    if fresh_pass is not True:
        errors.append({'chapter': chapter, 'error': 'main fresh did not pass'})
        continue
    if historical:
        matches = [item for item in fresh['chapters'] if item['chapter'] == chapter]
        if len(matches) != 1:
            errors.append({'chapter': chapter, 'error': 'historical fresh chapter missing or duplicate'})
            continue
        fresh = matches[0]
    source = sources[chapter]
    source_sha = hashlib.sha256(Path(source['path']).read_bytes()).hexdigest()
    differences = []
    fresh_hashes = fresh[row.get('fresh_hash_field', 'input_sha256')]
    if source_sha != fresh['source_sha256'] or source_sha != source['sha256']:
        differences.append('source')
    for role, entry in row['files'].items():
        content = Path(entry['path']).read_bytes()
        sha = hashlib.sha256(content).hexdigest()
        if sha != entry['sha256'] or sha != fresh_hashes[role]:
            differences.append(role)
        if len(content) != entry['bytes']:
            differences.append(role + ':bytes')
    support = row.get('execution_support')
    if support is None and fresh.get('execution_support_sha256') is not None:
        differences.append('execution_support:metadata_missing')
    if support is not None:
        support_path = Path(support['path'])
        if not support_path.is_file():
            differences.append('execution_support:missing')
        else:
            content = support_path.read_bytes()
            sha = hashlib.sha256(content).hexdigest()
            if sha != support['sha256'] or sha != fresh.get('execution_support_sha256'):
                differences.append('execution_support')
            if len(content) != support['bytes']:
                differences.append('execution_support:bytes')
    if differences:
        errors.append({'chapter': chapter, 'changed_inputs': differences})
    else:
        (historical_closed if historical else closed).append(chapter)
declared = ledger['volume1']['current_run_closed_chapters']
if sorted(declared) != sorted(closed):
    errors.append({'declared_closed': declared, 'verified_reusable': closed})
historical_declared = ledger['volume1'].get('historical_reused_closed_chapters', [])
if sorted(historical_declared) != sorted(historical_closed):
    errors.append({'declared_historical': historical_declared,
                   'verified_historical_reusable': historical_closed})
metadata = json.loads((task / 'task.json').read_text())
if metadata['offlineTrack']['ledger'] != 'research/fr-volumes-current-20261110.json':
    errors.append({'error': 'task metadata does not point to current ledger'})
result = {
    'pass': not errors,
    'reusable_closed_chapters': closed,
    'reusable_historical_chapters': historical_closed,
    'action': 'skip unchanged completed work; reopen only on changed inputs or new concrete findings',
    'errors': errors,
    'pending_active': [{'chapter': item['chapter'], 'status': item['status']}
                       for item in ledger['volume1']['chapters']
                       if item['status'] not in ('offline_content_closed_current_sha',
                                                 'offline_content_closed_historical_sha',
                                                 'historical_evidence_audited_content_review_pending',
                                                 'pending_evidence_audit')],
    'evidence_audited_pending_content': [item['chapter'] for item in ledger['volume1']['chapters']
                                        if item['status'] == 'historical_evidence_audited_content_review_pending'],
    'volume2': ledger['volume2']['status'],
    'boundary': 'Evidence identity check only; no repair, semantic rereview, TTS or production test.'
}
print(json.dumps(result, ensure_ascii=False, indent=2))
sys.exit(0 if result['pass'] else 1)
