"""Record a fresh, non-creative Trellis resume checkpoint without rerunning repairs."""
from datetime import datetime, timezone
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
task = root / '.trellis/tasks/10-27-script-narrative-translation-cure'
research = task / 'research'
command = [sys.executable, str(root / 'apps/build/scripts/fr_resume_check_20261110.py')]
run = subprocess.run(command, cwd=root, text=True, capture_output=True, check=False)
if not run.stdout.strip():
    raise RuntimeError(f'Resume check returned no JSON: exit={run.returncode}: {run.stderr}')
result = json.loads(run.stdout)
documents = [task / 'offline-progress.md', research / 'fr-volumes-resume-20261110.md']
links = []
missing = []
for document in documents:
    for target in re.findall(r'\]\(([^)]+)\)', document.read_text()):
        if '://' in target or target.startswith('#'):
            continue
        local = target.split('#', 1)[0]
        links.append({'document': document.name, 'target': target})
        if not (document.parent / local).is_file():
            missing.append(links[-1])
result.update({
    'recorded_at_utc': datetime.now(timezone.utc).isoformat(),
    'resume_command': command,
    'resume_exit_code': run.returncode,
    'task_document_local_links_checked': len(links),
    'task_document_local_links_valid': not missing,
    'missing_links': missing,
    'execution_scope': 'Only resume evidence and local links checked; no repair or semantic rereview run.',
})
result['pass'] = result['pass'] and run.returncode == 0 and not missing
destination = research / 'trellis-progress-checkpoint-20261110.json'
if destination.exists():
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    shutil.copy2(destination, research / f'trellis-progress-checkpoint-before-{stamp}.json')
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({
    'pass': result['pass'], 'exit_code': run.returncode,
    'reusable_closed_chapters': result['reusable_closed_chapters'],
    'reusable_historical_chapters': result['reusable_historical_chapters'],
    'evidence_audited_pending_content_count': len(result['evidence_audited_pending_content']),
    'pending_active': result['pending_active'],
    'links_checked': len(links), 'missing_links': missing,
    'evidence': str(destination),
}, ensure_ascii=False, indent=2))
sys.exit(0 if result['pass'] else 1)
