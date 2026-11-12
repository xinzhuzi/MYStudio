"""Record verified chapter264 closure and pending chapter265--267 work only."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[3]
research = root / '.trellis/tasks/10-27-script-narrative-translation-cure/research'
target = research / 'fr-volumes-current-20261110.json'
before = target.read_bytes()
data = json.loads(before)
chapters = {item['chapter']: item for item in data['volume1']['chapters']}
fresh = json.loads((research / 'chapter264-mainfresh-20261110.json').read_text())
assert fresh['pass'] is True
review = (research / 'chapter264-final-smallcheck-20261110.md').read_text()
assert 'pass=true' in review
for role, record in chapters[264]['files'].items():
    content = Path(record['path']).read_bytes()
    actual = hashlib.sha256(content).hexdigest()
    assert actual == fresh['input_sha256'][role], (role, actual)
    record.update(sha256=actual, bytes=len(content))
chapters[264].update(
    status='offline_content_closed_current_sha', current_independent_pass=True,
    p2_groups_open=0, p3_open=0, main_fresh_exit_code=0,
    source_conflicts='retained; cross_chapter_review_pending',
)
for name in ('chapter264-postfix-independent-20261110.md',
             'chapter264-final-smallcheck-20261110.md',
             'chapter264-mainfresh-20261110.json'):
    assert (research / name).is_file()
    if name not in chapters[264]['evidence']:
        chapters[264]['evidence'].append(name)
for role, record in chapters[265]['files'].items():
    content = Path(record['path']).read_bytes()
    record.update(sha256=hashlib.sha256(content).hexdigest(), bytes=len(content))
chapters[265]['status'] = 'repaired_pending_independent'
for name in ('chapter265-review-repair-20261110.md',
             'chapter265-review-verify-20261110.json'):
    assert (research / name).is_file()
    if name not in chapters[265]['evidence']:
        chapters[265]['evidence'].append(name)
chapters[265].update(shots=71, seconds=879)
chapters[266].update(status='independent_review_failed_repair_in_progress',
                     p2_groups_open=4,
                     evidence=['chapter266-independent-full-20261110.md'])
chapters[267]['status'] = 'independent_review_in_progress'
data['volume1']['current_run_closed_chapters'] = sorted(
    set(data['volume1']['current_run_closed_chapters']) | {264}
)
data['as_of'] = datetime.now(timezone.utc).isoformat()
data['next_action'] = ('close 265 independent review and main fresh; finish 266 repair '
                       'and independently review; review267; continue volume1 before volume2')
backup = research / 'fr-volumes-current-before-264-close-20261110.json'
assert not backup.exists(), 'one-time checkpoint already has backup'
assert target.read_bytes() == before, 'ledger changed during preparation'
shutil.copy2(target, backup)
assert backup.read_bytes() == before
target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
saved = json.loads(target.read_text())
original = json.loads(before)
assert len(saved['volume1']['chapters']) == 395
assert saved['volume2'] == original['volume2']
for old, new in zip(original['volume1']['chapters'], saved['volume1']['chapters']):
    if old['chapter'] not in (264, 265, 266, 267):
        assert old == new, old['chapter']
print(json.dumps({'pass': True, 'closed_this_run': saved['volume1']['current_run_closed_chapters'],
                  'updated_chapters': [264, 265, 266, 267], 'all_complete': False}))
