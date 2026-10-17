"""Separate this change's saved postimage from subsequently edited style fields."""
from pathlib import Path
import json, hashlib
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/daojie-charsheet-full-board-1016'
p = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
initial = json.loads((OUT / 'backups' / p.relative_to(ROOT)).read_text())
post = json.loads((OUT / 'full-board-r2-seed1001/source.json').read_text())
current = json.loads(p.read_text())
initial_other = {**initial, 'types': [x for x in initial['types'] if x['zh'] != '设定卡']}
post_other = {**post, 'types': [x for x in post['types'] if x['zh'] != '设定卡']}
delta = sorted(k for k in set(current) | set(post) if current.get(k) != post.get(k))
checks = {
    'saved-postimage-only-card-data-changed': initial_other == post_other,
    'saved-postimage-style-unchanged': initial['art_style_base'] == post['art_style_base'],
    'current-card-retains-postimage': current['types'] == post['types'],
    'subsequent-delta-exactly-style-and-layer-contract': delta == ['art_style_base', 'layer_contract'],
}
raw = json.loads((OUT / 'verification.json').read_text())
failures = [x['check'] for x in raw['checks'] if not x['passed']]
checks['other-current-sync-checks-pass'] = failures == ['only-card-data-changed', 'current-style-verbatim']
result = {
    'passed': all(checks.values()), 'checks': checks,
    'raw_verification': {'passed': sum(x['passed'] for x in raw['checks']), 'total': len(raw['checks']), 'failures': failures},
    'subsequent_changed_keys': delta,
    'source_mtime': p.stat().st_mtime,
    'render_style_matches_current': post['art_style_base'] == current['art_style_base'],
    'current_source_sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
    'note': 'The render source snapshot proves our mutation scope. Subsequent field changes are recorded, not reverted. This audit does not validate their visual result.'
}
(OUT / 'concurrent-style-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
sample = (OUT / 'assembled-prompt.txt').read_text()
old_style = post['art_style_base']['positive_text']
assert sample.count(old_style) == 1
sample = sample.replace(old_style, current['art_style_base']['positive_text'])
assert next(x for x in current['types'] if x['zh'] == '设定卡')['positive_text'] in sample
(OUT / 'assembled-prompt-current-style.txt').write_text(sample)
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(0 if result['passed'] else 1)
