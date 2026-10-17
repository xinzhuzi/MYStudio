"""Land the user's 1015 image selection in small, backed-up batches."""
import argparse
import hashlib
import json
import shutil
import subprocess
import time
import uuid
from collections import Counter
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SOURCE = next(p for p in (REPO / 'apps/output').iterdir() if p.name == '道劫_重造_1015')
EXCLUDED_FILES = {'归元断剑_1.png', '归元断剑·半截出鞘态_1.png', '玄天符_1.png', '掌心契印_1.png'}
EXCLUDED_DIRS = {'两主演i2i', '两主演i2i_透明1632'}
APP_DATA = next(p for p in (Path.home() / 'Library/Application Support').iterdir() if p.name == '漫影工作室')
LOCATIONS = json.loads((APP_DATA / 'project-locations.json').read_text())['locations']
PROJECT_ID = '49dce4c1-64b1-42de-85c2-9f266698aec4'
STORE = Path(LOCATIONS[PROJECT_ID]) / 'store'
KEYS = {'media': 'mediaFiles', 'scenes': 'scenes', 'props': 'items', 'characters': 'characters'}


def sha(path):
    return hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()


def read_stores():
    return {name: json.loads((STORE / f'{name}.json').read_text()) for name in KEYS}


def app_idle():
    processes = subprocess.check_output(['ps', '-axo', 'comm='], text=True).splitlines()
    assert not any('/Contents/MacOS/' in p and ('漫影工作室.app/' in p or '/Electron.app/' in p) for p in processes), 'App is running; stop before offline writes'


def write_json(path, data):
    temporary = path.with_name(path.name + '.asset-land-tmp')
    with temporary.open('x') as output:
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.write('\n')
    temporary.replace(path)


def inventory():
    stores = read_stores()
    names = {}
    for kind in ('scenes', 'props', 'characters'):
        for asset in stores[kind]['state'][KEYS[kind]]:
            assert asset['projectId'] == PROJECT_ID
            names.setdefault(asset['name'], []).append((kind, asset['id']))
    excluded, selected = [], []
    for image in sorted(SOURCE.rglob('*.png')):
        relative = image.relative_to(SOURCE)
        if image.name in EXCLUDED_FILES or relative.parts[0] in EXCLUDED_DIRS:
            excluded.append({'source': str(image), 'sha256': sha(image)})
            continue
        assert image.parent == SOURCE, f'Unreviewed directory: {image}'
        name, sequence = image.stem.rsplit('_', 1)
        assert sequence.isdecimal() and len(names.get(name, [])) == 1, image
        kind, asset_id = names[name][0]
        with Image.open(image) as decoded:
            width, height = decoded.size
            decoded.verify()
        selected.append({'source': str(image), 'name': name, 'sequence': int(sequence), 'kind': kind, 'assetId': asset_id, 'sha256': sha(image), 'width': width, 'height': height})
    assert len(selected) == 50 and len(excluded) == 18
    assert Counter(x['kind'] for x in selected) == {'scenes': 27, 'props': 22, 'characters': 1}
    assert not {x['sha256'] for x in selected} & {x['sha256'] for x in excluded}
    return selected, excluded


def prepare():
    app_idle()
    selected, excluded = inventory()
    timestamp = int(time.time() * 1000)
    backup = STORE / 'backups' / f'asset-land-1015-selected-{timestamp}'
    backup.mkdir()
    expected = {}
    for name in KEYS:
        source = STORE / f'{name}.json'
        expected[name] = sha(source)
        shutil.copy2(source, backup / source.name)
        assert sha(backup / source.name) == expected[name]
    for row in selected:
        row['relativePath'] = f'media/ai-image/{timestamp}_{uuid.uuid4().hex[:12]}.png'
        row['url'] = f"project-file://{PROJECT_ID}/{row['relativePath']}"
        row['mediaId'] = str(uuid.uuid4())
    receipt = {'projectId': PROJECT_ID, 'store': str(STORE), 'timestamp': timestamp, 'selected': selected, 'excluded': excluded, 'expectedStoreSha256': expected, 'done': []}
    path = backup / 'receipt.json'
    write_json(path, receipt)
    print(path)


def apply_batch(receipt_path, kind):
    app_idle()
    receipt = json.loads(receipt_path.read_text())
    assert receipt['projectId'] == PROJECT_ID and receipt['store'] == str(STORE)
    assert kind not in receipt['done'], f'Already applied: {kind}'
    assert kind == 'media' or 'media' in receipt['done']
    for name, expected in receipt['expectedStoreSha256'].items():
        assert sha(STORE / f'{name}.json') == expected, f'Concurrent change: {name}'
    for row in receipt['selected'] + receipt['excluded']:
        assert sha(Path(row['source'])) == row['sha256'], row['source']
    data = read_stores()[kind]
    if kind == 'media':
        entries = data['state']['mediaFiles']
        assert not {r['mediaId'] for r in receipt['selected']} & {r['id'] for r in entries}
        for row in receipt['selected']:
            target = STORE / row['relativePath']
            assert target.parent.is_dir() and not target.exists()
            with Path(row['source']).open('rb') as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            assert sha(target) == row['sha256']
            entries.append({'id': row['mediaId'], 'name': f"{row['name']}·重造1015·{row['sequence']}__{receipt['timestamp']}", 'type': 'image', 'url': row['url'], 'source': 'ai-image', 'projectId': PROJECT_ID, 'folderId': None, 'relativePath': row['relativePath'], 'width': row['width'], 'height': row['height']})
    else:
        assets = {asset['id']: asset for asset in data['state'][KEYS[kind]]}
        primary = {}
        for row in receipt['selected']:
            if row['kind'] == kind and row['sequence'] > primary.get(row['assetId'], {}).get('sequence', -1):
                primary[row['assetId']] = row
        for asset_id, row in primary.items():
            asset = assets[asset_id]
            assert asset['name'] == row['name']
            assert sha(STORE / row['relativePath']) == row['sha256']
            if kind == 'characters':
                asset['views'].insert(0, {'viewType': 'three-quarter', 'imageUrl': row['url'], 'generatedAt': receipt['timestamp']})
                asset['thumbnailUrl'] = row['url']
            else:
                asset['referenceImage' if kind == 'scenes' else 'imageUrl'] = row['url']
            asset['updatedAt'] = receipt['timestamp']
    app_idle()
    for name, expected in receipt['expectedStoreSha256'].items():
        assert sha(STORE / f'{name}.json') == expected, f'Concurrent change before commit: {name}'
    path = STORE / f'{kind}.json'
    write_json(path, data)
    assert json.loads(path.read_text()) == data
    receipt['expectedStoreSha256'][kind] = sha(path)
    receipt['done'].append(kind)
    write_json(receipt_path, receipt)
    print(json.dumps({'batch': kind, 'files': len(receipt['selected']) if kind == 'media' else sum(r['kind'] == kind for r in receipt['selected']), 'done': receipt['done']}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--batch', choices=tuple(KEYS))
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    if args.prepare:
        assert not args.batch and not args.receipt
        prepare()
    elif args.batch:
        assert args.receipt
        apply_batch(args.receipt, args.batch)
    else:
        selected, excluded = inventory()
        print(json.dumps({'selected': len(selected), 'excluded': len(excluded), 'kinds': dict(Counter(x['kind'] for x in selected)), 'store': str(STORE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
