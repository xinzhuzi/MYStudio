"""Task-only contact sheets of registered chapter001 references; no project writes."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
TASK = Path(__file__).resolve().parents[3] / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research'
source = TASK / 'chapter001-path-research-result.json'
data = json.loads(source.read_text())
unique = {}
for ref in data['boundReferences']:
    for item in ref['files']:
        p = Path(item['path'])
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('Reference changed: ' + str(p))
        unique.setdefault(str(p), {'path': str(p), 'name': ref['assetName'], 'kind': ref['assetKind'], 'versionId': ref['versionId'], 'sha256': item['sha256']})
refs = list(unique.values())
out = TASK / 'chapter001-repair-1026/reference-contact-1027-v2'
out.mkdir(exist_ok=False)
font = ImageFont.truetype('/Library/Fonts/Arial Unicode.ttf', 20)
for page in range((len(refs) + 7) // 8):
    batch = refs[page*8:(page+1)*8]
    canvas = Image.new('RGB', (1600, 4*280), '#eeeeee')
    draw = ImageDraw.Draw(canvas)
    for offset, ref in enumerate(batch):
        x, y = (offset % 2)*800, (offset // 2)*280
        with Image.open(ref['path']) as img:
            tile = ImageOps.contain(img.convert('RGB'), (780, 232))
            canvas.paste(tile, (x+(800-tile.width)//2, y))
        draw.text((x+10,y+235), f"{page*8+offset+1}. {ref['name']} [{ref['kind']}]", fill='black', font=font)
    canvas.save(out / f'page-{page+1}.jpg', quality=91)
(out/'index.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'uniqueReferences':len(refs),'pages':(len(refs)+7)//8,'output':str(out)},ensure_ascii=False))
