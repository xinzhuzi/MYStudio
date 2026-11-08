"""Read-only prompt inventory; write evidence only under apps/output/automation."""
import hashlib
import json
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / 'apps/output/automation/daojie-qi21-prompt-audit-1016'
BASE = REPO / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
APP = next(p for p in (Path.home() / 'Library/Application Support').iterdir() if p.name == '漫影工作室')
locations = json.loads((APP / 'project-locations.json').read_text())['locations']
STORE = Path(locations['49dce4c1-64b1-42de-85c2-9f266698aec4']) / 'store'
needles = ['衣物必须完整可穿', '衣物不完整', '脏污噪点', '无伤口', '双臂', '断臂', '断去', '破损', '汗渍', '污渍', '纯净', '均匀平光', '夜', '宣纸白', '透明', '四视图', '左至右并排', '六至七头身', '七头身', 'daojie-gongbi-v2', '@图1', '无人物']
result = {'store': str(STORE), 'files': {}, 'assets': [], 'workflows': []}

def walk(value, path=''):
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from walk(item, f'{path}.{key}' if path else key)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk(item, f'{path}[{index}]')

for filename, key in [('characters.json', 'characters'), ('scenes.json', 'scenes'), ('props.json', 'items')]:
    path = STORE / filename
    data = json.loads(path.read_text())
    assets = data['state'][key]
    hits = Counter()
    for asset in assets:
        texts = [(field, text) for field, text in walk(asset) if any(token in field.lower() for token in ('prompt', 'description', 'visualtraits', 'notes'))]
        matched = {needle: [field for field, text in texts if needle in text] for needle in needles}
        matched = {needle: fields for needle, fields in matched.items() if fields}
        hits.update(matched.keys())
        result['assets'].append({'file': str(path), 'id': asset['id'], 'name': asset['name'], 'literalMatches': matched, 'promptLengths': {field: len(text) for field, text in texts}, 'excerpts': {field: text[:1800] for field, text in texts if field in ('description', 'visualTraits') or 'visualPrompt' in field}})
    result['files'][filename] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'count': len(assets), 'assetsWithLiteral': dict(hits)}

base = json.loads(BASE.read_text())
result['bases'] = {'path': str(BASE), 'sha256': hashlib.sha256(BASE.read_bytes()).hexdigest(), 'art_style_base': base['art_style_base'], 'rgba': base['rgba'], 'expand_instruction': base['expand_instruction'], 'types': [{key: value for key, value in item.items() if key in ('zh','rgba_default','positive_text','negative_text','rgba_positive','purpose')} for item in base['types']]}
workflow_root = REPO / 'apps/backend/comfyui/workflows'
for path in sorted(workflow_root.rglob('*.json')):
    if path.name not in ('qi21-道劫-t2i.json', 'qi21-道劫-i2i.json'):
        continue
    wf = json.loads(path.read_text())
    graph = {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'graphs': []}
    for scope, nodes, links in [('root', wf['nodes'], wf['links'])] + [(s['id'], s['nodes'], s.get('links', [])) for s in wf.get('definitions', {}).get('subgraphs', [])]:
        chosen = []
        for node in nodes:
            if node['type'] in ('Note','MarkdownNote'):
                continue
            values = node.get('widgets_values', [])
            chosen.append({'id': node['id'], 'type': node['type'], 'title': node.get('title'), 'mode': node.get('mode',0), 'inputs': node.get('inputs',[]), 'outputs': node.get('outputs',[]), 'widgets_values': values})
        graph['graphs'].append({'scope': scope, 'nodes': chosen, 'links': links})
    result['workflows'].append(graph)

OUT.mkdir(exist_ok=True)
(OUT / 'inventory.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'files': result['files'], 'workflows': [x['path'] for x in result['workflows']], 'evidence': str(OUT/'inventory.json')}, ensure_ascii=False, indent=2))
