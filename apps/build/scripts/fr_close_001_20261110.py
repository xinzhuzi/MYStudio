"""Register reviewed Chapter 001, retaining the limits of targeted material checks."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[3]
r = root / '.trellis/tasks/10-27-script-narrative-translation-cure/research'
path = r / 'fr-volumes-current-20261110.json'
ledger = json.loads(path.read_text())
row = next(x for x in ledger['volume1']['chapters'] if x['chapter'] == 1)
assert row['status'] == 'targeted_repair_complete_independent_review_in_progress'
raw = json.loads((r / 'chapter001-mainfresh-raw-20261110.json').read_text())
assert raw['ok'] and raw['negative_cases_rejected'] == 15
baseline = json.loads((r / ledger['baseline']).read_text())
source = next(x for v in baseline['volumes'] for x in v['chapters'] if x['chapter'] == 1)
sha = hashlib.sha256(Path(source['path']).read_bytes()).hexdigest()
assert sha == source['sha256'] == raw['source_sha256']['1']
for role, entry in row['files'].items():
    content = Path(entry['path']).read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    assert digest == raw['current_sha256'][role]
    entry.update(sha256=digest, bytes=len(content))
evidence = ['chapter001-independent-full-20261110.md',
            'chapter001-targeted-repair-20261110.md',
            'chapter001-postfix-independent-20261110.md',
            'chapter001-mainfresh-raw-20261110.json']
assert all((r / item).is_file() for item in evidence)
fresh = dict(raw)
fresh['pass'] = True
fresh['protected_source_sha256'] = raw['source_sha256']
fresh['source_sha256'] = sha
fresh['input_sha256'] = raw['current_sha256']
fresh['execution'] = {'executor': 'main_agent', 'exit_code': 0,
    'command': 'python3 apps/build/scripts/chapter001_targeted_verify_20261110.py --self-test',
    'raw_output': 'chapter001-mainfresh-raw-20261110.json',
    'scope': 'Static four-fix and budget verification; full and targeted content reviews linked separately.'}
fresh['material_scope'] = 'Only eight affected pieces for identities05/09/16 checked; no whole-chapter generated material acceptance.'
freshpath = r / 'chapter001-mainfresh-20261110.json'
assert not freshpath.exists(), 'Already registered; use resume check, not closure replay.'
freshpath.write_text(json.dumps(fresh, ensure_ascii=False, indent=2) + '\n')
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
shutil.copy2(path, r / f'fr-volumes-current-before-close001-{stamp}.json')
row.update(status='offline_content_closed_current_sha', current_independent_pass=True,
           main_fresh_exit_code=0, p2_groups_open=0, clarification_groups_open=0,
           scenes=6, narrative_identities=19, internal_segments=138,
           frames=16293, seconds=543.1, owner=None,
           next_action='Reuse current content and SHA. Whole-chapter material mapping, dynamic and production validation remain separate, not completed.')
row['evidence'] = list(dict.fromkeys(row['evidence'] + evidence + [freshpath.name]))
ledger['volume1']['current_run_closed_chapters'] = sorted(set(ledger['volume1']['current_run_closed_chapters'] + [1]))
ledger['next_action'] = '002 targeted repair in progress; next missing content review003. Reuse closed001 and259-270; historical evidence audit001-040 completed.'
path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'chapter': 1, 'status': row['status'], 'main_fresh_exit_code': 0,
    'frames': 16293, 'seconds': 543.1, 'current_closed': ledger['volume1']['current_run_closed_chapters']}, ensure_ascii=False))
