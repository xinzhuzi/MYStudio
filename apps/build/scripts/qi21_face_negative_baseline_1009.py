#!/usr/bin/env python3
"""Preserve the existing four-token negative baseline in the face-only type."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-09-qi21-source-prompt-review-fixes'
SOURCE = next((ROOT / 'apps/frontend/assets/studio-manuals/art_skills').glob('*/json/qi21_bases.json'))
raw = SOURCE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == 'f0c2a1882415d6fd03a26ce36dcb4f51bc5aa75570aebd939b8b8f8b640e5015'
data = json.loads(raw)
old = data['types'][7]['negative_text']
assert data['types'][7]['zh'] == '表情差分' and old.startswith('模糊，水印，文字错误，')
new = old.replace('模糊，水印，文字错误，', '模糊，水印，多手指，文字错误，', 1)
anchor = '"negative_text": ' + json.dumps(old, ensure_ascii=False)
text = raw.decode('utf-8')
assert text.count(anchor) == 1
patched = text.replace(anchor, '"negative_text": ' + json.dumps(new, ensure_ascii=False), 1).encode('utf-8')
data['types'][7]['negative_text'] = new
assert json.loads(patched) == data
backup = TASK / 'backups/face-negative-baseline-before.json'
assert not backup.exists()
shutil.copy2(SOURCE, backup)
assert SOURCE.read_bytes() == backup.read_bytes() == raw
stage = TASK / 'backups/face-negative-baseline-stage.json'
assert not stage.exists()
stage.write_bytes(patched)
stage.chmod(SOURCE.stat().st_mode & 0o777)
assert SOURCE.read_bytes() == raw
stage.replace(SOURCE)
sha = hashlib.sha256(patched).hexdigest()
diff_path = TASK / 'research/face-source-diff.json'
diff = json.loads(diff_path.read_text())
diff_backup = TASK / 'backups/face-source-diff-before-baseline.json'
assert not diff_backup.exists()
shutil.copy2(diff_path, diff_backup)
diff['after_sha256'] = sha
for field in diff['fields']:
    if field['path'] == ['types', 7, 'negative_text']:
        assert field['after'] == old
        field['after'] = new
diff['baseline_note'] = 'Preserve the established common four-token baseline; 多手指 was already present in global negatives, so this does not reintroduce full-body framing.'
diff_path.write_text(json.dumps(diff, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'sha256': sha, 'changed_field': ['types', 7, 'negative_text'], 'token_restored': '多手指'}, ensure_ascii=False))
