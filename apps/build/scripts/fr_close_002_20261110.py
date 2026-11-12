"""Register Chapter002 plus its supporting material-plan fingerprint."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[3]
r = root / '.trellis/tasks/10-27-script-narrative-translation-cure/research'
path = r / 'fr-volumes-current-20261110.json'
ledger = json.loads(path.read_text())
row = next(x for x in ledger['volume1']['chapters'] if x['chapter'] == 2)
assert row['status'] == 'independent_review_failed_targeted_repair_in_progress'
raw = json.loads((r / 'chapter002-mainfresh-raw-20261110.json').read_text())
assert raw['pass'] and len(raw['memory_only_negatives_rejected']) == 12 and raw['readonly_observation_unchanged']
baseline = json.loads((r / ledger['baseline']).read_text())
source = next(x for v in baseline['volumes'] for x in v['chapters'] if x['chapter'] == 2)
assert hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() == raw['source_sha256'] == source['sha256']
row['files']['material-plan'] = {'path': str(r / 'chapter002-material-execution-plan-1030.md')}
roles = {'screenplay': 'S', 'director-plan': 'D', 'storyboard': 'B', 'material-plan': 'M'}
hashes = {}
for role, label in roles.items():
    entry = row['files'][role]
    data = Path(entry['path']).read_bytes()
    hashes[role] = hashlib.sha256(data).hexdigest()
    assert hashes[role] == raw['output_sha256'][label]
    entry.update(sha256=hashes[role], bytes=len(data))
evidence = ['chapter002-independent-full-20261110.md', 'chapter002-targeted-repair-20261110.md',
            'chapter002-postfix-independent-20261110.md', 'chapter002-mainfresh-raw-20261110.json']
assert all((r / name).is_file() for name in evidence)
fresh = dict(raw)
fresh['input_sha256'] = hashes
fresh['scope'] = 'Main static fresh after targeted repair; full plus targeted independent content evidence linked separately.'
fresh['execution'] = {'executor': 'main_agent', 'exit_code': 0,
    'command': 'python3 apps/build/scripts/chapter002_targeted_verify_20261110.py --self-test',
    'raw_output': 'chapter002-mainfresh-raw-20261110.json'}
freshpath = r / 'chapter002-mainfresh-20261110.json'
assert not freshpath.exists(), 'Already registered; use resume check instead.'
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
shutil.copy2(path, r / f'fr-volumes-current-before-close002-{stamp}.json')
freshpath.write_text(json.dumps(fresh, ensure_ascii=False, indent=2) + '\n')
row.update(status='offline_content_closed_current_sha', current_independent_pass=True,
           main_fresh_exit_code=0, p2_groups_open=0, p3_groups_open=0, owner=None,
           reviewer='/root/fr002_targeted_independent', scenes=6, narrative_units=36,
           seconds=485, edit_frames=14550, material_windows=20,
           next_action='Reuse current content and all four fingerprints; no repeat repair or full review. Dynamic, actual material and production validation remain separate.')
row['evidence'] = list(dict.fromkeys(row['evidence'] + evidence + [freshpath.name]))
ledger['volume1']['current_run_closed_chapters'] = sorted(set(ledger['volume1']['current_run_closed_chapters'] + [2]))
ledger['next_action'] = 'Next missing current content review004; historical evidence audit061 onward pending. Reuse closed001-003 and259-270; historical evidence audit001-060 complete.'
path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'chapter': 2, 'status': row['status'], 'main_fresh_exit_code': 0,
                  'seconds': 485, 'protected_files': list(roles),
                  'closed_current': ledger['volume1']['current_run_closed_chapters']}, ensure_ascii=False))
