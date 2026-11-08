"""Read-only v5 contact audit. Writes only new task evidence; no approvals."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

REPO = Path(__file__).resolve().parents[3]
TASK = REPO / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research'
BASE = TASK / 'chapter001-repair-1026'
report = json.loads((TASK / 'chapter001-path-research-result.json').read_text())
manifest_path = Path(report['bibles'][-1]['manifest'])
manifest_bytes = manifest_path.read_bytes()
manifest = json.loads(manifest_bytes)
snapshot = json.loads((BASE / 'snapshot-20261026T161314424840Z/snapshot.json').read_text())
entities = snapshot['envelope']['state']['entityExtractions'][0]
names = {}
for collection, key in [('characters', 'characterId'), ('scenes', 'sceneId'), ('props', 'assetId')]:
    for entry in entities[collection]:
        names[entry[key]] = entry['name']
versions = {v['versionId']: v for v in manifest['continuityAssetVersions']}
rows = []
for entry in manifest['outputAssets']:
    image_path = Path(entry['path'])
    raw = image_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise RuntimeError('v5 reference hash changed: ' + str(image_path))
    v = versions[entry['versionId']]
    rows.append({**entry, 'name': names.get(entry['assetId'], v['label']),
                 'kind': v['assetKind'], 'label': v['label'], 'approvalStatus': v.get('approvalStatus')})
out = BASE / 'reference-v5-full-1027'
out.mkdir(exist_ok=False)
font = ImageFont.truetype('/Library/Fonts/Arial Unicode.ttf', 19)
for page in range((len(rows) + 7) // 8):
    canvas = Image.new('RGB', (1600, 1280), '#eeeeee')
    draw = ImageDraw.Draw(canvas)
    for offset, row in enumerate(rows[page*8:(page+1)*8]):
        x, y = offset % 2 * 800, offset // 2 * 320
        with Image.open(row['path']) as image:
            tile = ImageOps.contain(image.convert('RGB'), (780, 260))
            canvas.paste(tile, (x+(800-tile.width)//2, y))
        draw.text((x+10, y+264), f"{page*8+offset+1}. {row['name']} [{row['kind']}]", fill='black', font=font)
        draw.text((x+10, y+291), row['label'][:65], fill='black', font=font)
    canvas.save(out / f'page-{page+1}.jpg', quality=92)
(out / 'index.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n')
(out / 'provenance.json').write_text(json.dumps({'source': str(manifest_path), 'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(), 'imageCount': len(rows), 'projectWrites': 0, 'approvalWrites': 0, 'reviewed': False}, indent=2)+'\n')
print(json.dumps({'images': len(rows), 'pages': (len(rows)+7)//8, 'output': str(out)}))
