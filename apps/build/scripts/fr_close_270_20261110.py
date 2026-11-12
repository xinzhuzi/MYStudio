"""Register Chapter 270's reviewed current version; never reruns implementation."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[3]
task = root / '.trellis/tasks/10-27-script-narrative-translation-cure'
r = task / 'research'
ledger_path = r / 'fr-volumes-current-20261110.json'
ledger = json.loads(ledger_path.read_text())
row = next(x for x in ledger['volume1']['chapters'] if x['chapter'] == 270)
assert row['status'] == 'full_review_complete_last_p3_targeted_review_in_progress'
raw = json.loads((r / 'chapter270-mainfresh-raw-20261110.json').read_text())
assert raw['ok'] and not raw['errors'] and all(raw['negative_controls'].values())
baseline = json.loads((r / ledger['baseline']).read_text())
source = next(x for v in baseline['volumes'] for x in v['chapters'] if x['chapter'] == 270)
source_sha = hashlib.sha256(Path(source['path']).read_bytes()).hexdigest()
assert source_sha == source['sha256']
old = '山道脚印伸向密林；周站门口看背影消失，停留片刻后回屋。'
new = '山道脚印伸向密林；周站门口看背影消失，站了很久后才转身回屋。以时间省略呈现久立，10秒剪辑不代表完整站立时长。'
for kind, entry in row['files'].items():
    path = Path(entry['path'])
    content = path.read_bytes()
    sha = hashlib.sha256(content).hexdigest()
    assert sha == raw['sha256'][kind]
    before = (r / 'chapter270-p3-backup-20261110' / path.name).read_text()
    assert before.count(old) == 1 and before.replace(old, new) == content.decode()
    entry.update(sha256=sha, bytes=len(content))
evidence = [
    'chapter270-review-repair-20261110.md',
    'chapter270-postfix-independent-20261110.md',
    'chapter270-final-smallcheck-20261110.md',
    'chapter270-mainfresh-raw-20261110.json',
]
assert all((r / name).is_file() for name in evidence)
fresh = dict(raw)
fresh.update(pass_=True)
fresh['pass'] = fresh.pop('pass_')
fresh['source_sha256'] = source_sha
fresh['input_sha256'] = raw['sha256']
fresh['execution'] = {
    'executor': 'main_agent',
    'command': 'python3 apps/build/scripts/chapter270_review_verify_20261110.py --self-test',
    'exit_code': 0,
    'raw_output': 'chapter270-mainfresh-raw-20261110.json',
    'scope': 'Static verification; independent content coverage is in linked reviews.',
}
fresh['main_extra_check'] = 'All three documents differ from P3 backup only by the agreed action-line replacement.'
fresh_path = r / 'chapter270-mainfresh-20261110.json'
assert not fresh_path.exists(), 'Registration already exists; use read-only resume check.'
fresh_path.write_text(json.dumps(fresh, ensure_ascii=False, indent=2) + '\n')
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
shutil.copy2(ledger_path, r / f'fr-volumes-current-before-close270-{stamp}.json')
row.update(status='offline_content_closed_current_sha', current_independent_pass=True,
           main_fresh_exit_code=0, owner=None, p2_groups_open=0, p3_groups_open=0,
           scenes=17, shots=186, seconds=1841,
           next_action='Reuse current SHA and full-review plus final P3 check. No repair or full rereview without new concrete findings.')
row['evidence'] = list(dict.fromkeys(row['evidence'] + evidence + [fresh_path.name]))
ledger['volume1']['current_run_closed_chapters'] = sorted(set(ledger['volume1']['current_run_closed_chapters'] + [270]))
ledger['next_action'] = '001 targeted post-repair review in progress; 002 targeted repair in progress. Reuse closed259-270 and completed historical evidence audit001-040.'
ledger_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'chapter': 270, 'status': row['status'], 'source_sha256': source_sha,
                  'main_fresh_exit_code': 0, 'closed_current': ledger['volume1']['current_run_closed_chapters']}, ensure_ascii=False))
