"""Record completed review003 and historical evidence audit041-060, without manuscript writes."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[3]
r = root / '.trellis/tasks/10-27-script-narrative-translation-cure/research'
path = r / 'fr-volumes-current-20261110.json'
ledger = json.loads(path.read_text())
baseline = json.loads((r / ledger['baseline']).read_text())
rows = {x['chapter']: x for x in ledger['volume1']['chapters']}
sources = {x['chapter']: x for v in baseline['volumes'] for x in v['chapters']}
drafts = {x['chapter']: x for x in baseline['volume1_drafts']}
assert rows[3]['status'] == 'independent_review_in_progress'
audit_name = 'fr-history-evidence-041-060-20261110.md'
assert (r / audit_name).is_file()
checked = []
for number in range(41, 61):
    assert rows[number]['status'] == 'pending_evidence_audit'
    source = sources[number]
    assert hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() == source['sha256']
    for kind, entry in drafts[number]['files'].items():
        current = rows[number]['files'][kind]
        assert entry['path'] == current['path']
        assert hashlib.sha256(Path(entry['path']).read_bytes()).hexdigest() == entry['sha256'] == current['sha256']
    checked.append(number)
raw = json.loads((r / 'chapter003-mainfresh-raw-20261110.json').read_text())
assert raw['pass']
assert hashlib.sha256(Path(sources[3]['path']).read_bytes()).hexdigest() == raw['source_sha256']
for kind, entry in rows[3]['files'].items():
    assert hashlib.sha256(Path(entry['path']).read_bytes()).hexdigest() == raw['input_sha256'][kind]
freshpath = r / 'chapter003-mainfresh-20261110.json'
assert not freshpath.exists(), 'Already registered; do not repeat closure.'
fresh = dict(raw)
fresh['execution'] = {'executor': 'main_agent', 'exit_code': 0,
    'command': 'python3 apps/build/scripts/chapter003_current_verify_20261110.py',
    'raw_output': 'chapter003-mainfresh-raw-20261110.json'}
fresh['independent_evidence'] = 'chapter003-independent-full-20261110.md'
assert (r / fresh['independent_evidence']).is_file()
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
shutil.copy2(path, r / f'fr-volumes-current-before-close003-audit041-060-{stamp}.json')
freshpath.write_text(json.dumps(fresh, ensure_ascii=False, indent=2) + '\n')
rows[3].update(status='offline_content_closed_current_sha', current_independent_pass=True,
              main_fresh_exit_code=0, scenes=4, narrative_units=22, internal_beats=78,
              seconds=654, owner=None,
              evidence=['fr-history-evidence-001-020-20261110.md', fresh['independent_evidence'],
                        'chapter003-mainfresh-raw-20261110.json', freshpath.name],
              next_action='Reuse unchanged content and current SHA. No manuscript changes needed; dynamic, material and production validation separate.')
for number in checked:
    rows[number].update(status='historical_evidence_audited_content_review_pending',
        evidence_audit_date='2026-11-10', evidence_audit=audit_name,
        evidence_audit_scope='Top-level chapter reports and exact volume sections; no historical chat scan or manuscript rereview.',
        next_action='Preserve existing source review, manual revisions and shot plans. Complete missing independent content review and main fresh; do not rescan this historical batch or rerun repairs.')
ledger['volume1']['current_run_closed_chapters'] = sorted(set(ledger['volume1']['current_run_closed_chapters'] + [3]))
ledger['volume1']['historical_evidence_audited_chapters'] = sorted(set(ledger['volume1']['historical_evidence_audited_chapters'] + checked))
ledger['evidence_audit_in_progress'] = None
ledger['next_action'] = '002 targeted post-repair independent review in progress; next missing content review004. Reuse closed001/003/259-270. Historical evidence audit001-060 completed.'
path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')
result = {'pass': True, 'main_executor': 'main_agent', 'source_sha_checked': 20,
    'draft_sha_checked': 60, 'matches_baseline_and_current': True,
    'chapters': checked, 'scope': 'Evidence identity only; no new semantic or structural review performed by this command.'}
(r / 'fr-history-041-060-mainfresh-20261110.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'chapter003': rows[3]['status'], 'audit041_060': result,
    'closed_current': ledger['volume1']['current_run_closed_chapters']}, ensure_ascii=False))
