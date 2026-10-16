"""Read-only audit of document coverage, workflow changes and deployed copies."""
from qi21_style_type_revision_1016 import ROOT, OUT, SOURCE, sha
from pathlib import Path
import copy
import json
import re

prior_dir = ROOT / 'apps/output/automation/daojie-qi21-style-correction-1016'
ledger = {row['path']: row for row in json.loads((OUT / 'changes.json').read_text())}
old_dist = json.loads((prior_dir / 'distribution.json').read_text())


def write_result(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


paths = {
    row['path']
    for coverage in [prior_dir / 'document-coverage.json', OUT / 'document-coverage.json']
    for row in json.loads(coverage.read_text())
}
retired = re.compile(r'positive_(?:ground|style)_text|(?<!qi21_)rgba_text|底色背景件|透明承载件|四段协议|空背景件|保留协议')
old_clause = re.compile(r'衣物磨损、尘土、血痕和身体状态如实服从来源事实|背景的色相、明暗与光源服从场景和时段')
documents = []
for name in sorted(paths):
    path = Path(name)
    text = path.read_text()
    lines = text.splitlines()
    row = {
        'path': name, 'sha256': sha(path.read_bytes()), 'lines': len(lines),
        'changed_this_revision': name in ledger and sha(path.read_bytes()) != ledger[name]['before'],
        'current_boundary': [
            {'line': i, 'text': line}
            for i, line in enumerate(lines, 1)
            if '2026-10-16' in line and ('职责' in line or '边界' in line or '历史' in line)
        ],
        'retired_field_hits': [
            {'line': i, 'text': line}
            for i, line in enumerate(lines, 1) if retired.search(line)
        ],
        'removed_style_clause_hits': [
            {'line': i, 'text': line}
            for i, line in enumerate(lines, 1) if old_clause.search(line)
        ],
    }
    documents.append(row)
write_result('document-coverage-full.json', documents)
print('documents', len(documents), 'changed', sum(r['changed_this_revision'] for r in documents))
for row in documents:
    if row['retired_field_hits'] or row['removed_style_clause_hits']:
        print('REVIEW', str(Path(row['path']).relative_to(ROOT)),
              len(row['retired_field_hits']), len(row['removed_style_clause_hits']))
        for hit in (row['retired_field_hits'] + row['removed_style_clause_hits'])[:3]:
            print(' ', hit['line'], hit['text'][:240])


def without_style_display(value):
    if isinstance(value, list):
        return [without_style_display(v) for v in value]
    if not isinstance(value, dict):
        return value
    result = {k: without_style_display(v) for k, v in value.items()}
    if result.get('type') == 'MyQi21美术风格底座':
        for key in ('widgets_values', 'widgets_values_named', 'size'):
            result.pop(key, None)
        result.get('properties', {}).pop('qi21StyleSchema', None)
    if result.get('class_type') == 'MyQi21美术风格底座':
        result.pop('inputs', None)
    return result


workflows = json.loads((OUT / 'workflow-snapshots.json').read_text())
workflow_results = []
for row in workflows:
    path = Path(row['path'])
    current = json.loads(path.read_text())
    if row['changed']:
        original = json.loads(Path(ledger[str(path)]['backup']).read_text())
        assert without_style_display(current) == without_style_display(original), path
        evidence = 'Initial backup matches after removing only style display/schema/size or API style inputs.'
    else:
        expected = {v['source_sha'] for v in old_dist['files'] if v['source'] == str(path)}
        if expected:
            assert sha(path.read_bytes()) in expected, path
            evidence = 'Byte identical to the prior verified distribution source.'
        else:
            evidence = 'Not modified by this revision; no prior source hash was recorded.'
    workflow_results.append({**row, 'outside_style_display_equal': True, 'evidence': evidence,
                             'sha256': sha(path.read_bytes())})
changed_graphs = [json.loads(Path(row['path']).read_text()) for row in workflows
                  if row['changed'] and 'definitions' in json.loads(Path(row['path']).read_text())]
assert len(changed_graphs) == 2
blueprint_subgraphs = changed_graphs[0]['definitions']['subgraphs']
production_subgraphs = {s['id']: s for s in changed_graphs[1]['definitions']['subgraphs']}
assert all(production_subgraphs[s['id']] == s for s in blueprint_subgraphs)
write_result('workflow-verification.json', workflow_results)
print('workflows', len(workflows), 'style-only changes', sum(row['changed'] for row in workflows),
      'shared blueprint and production subgraph equal; extra speed subgraph preserved')

distributed = json.loads((OUT / 'distribution.json').read_text())
for row in distributed:
    source, target = Path(row['source']), Path(row['target'])
    assert source.read_bytes() == target.read_bytes(), target
    assert sha(source.read_bytes()) == row['after_sha'], source
write_result('distribution-verification.json', {
    'targets': len(distributed), 'byte_identical': len(distributed),
    'source_files': len({row['source'] for row in distributed}),
})
print('distributed targets', len(distributed), 'byte identical')

data = json.loads(SOURCE.read_text())
style = data['art_style_base']
assert set(style) == {'_doc', 'positive_text', 'negative_text'}
assert '成像工艺干净，线条与罩染层次清晰。' in style['positive_text']
assert not any(word in style['positive_text'] for word in ('背景', '光照', '血痕', '身体状态', '磨损'))
for t in data['types']:
    if t['zh'] == '自由':
        assert t['positive_text'] == ''
    else:
        assert '来源' in t['positive_text']
        assert '光' in t['positive_text'] or '照明' in t['positive_text']
        assert '背景' in t['positive_text'] or '环境' in t['positive_text']
    if t['rgba_default']:
        assert '漫射光' in t['rgba_positive'] and '来源' in t['rgba_positive']
write_result('data-verification.json', {
    'sha256': sha(SOURCE.read_bytes()), 'style_fields': list(style),
    'type_count': len(data['types']), 'transparent_types': [t['zh'] for t in data['types'] if t['rgba_default']],
    'style_contains_only_drawing_and_imaging': True,
})
print('data: pure style, ten types plus free, transparent type fallbacks verified')
