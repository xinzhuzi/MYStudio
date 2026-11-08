"""Apply five root-verified editorial corrections to NEW immutable task artifacts."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation'
BASE = TASK / 'research/chapter001-repair-1026'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def exact(text, old, new):
    assert text.count(old) == 1, (old, text.count(old))
    return text.replace(old, new, 1)


def read_checked(relative, digest):
    raw = (BASE / relative).read_bytes()
    assert sha(raw) == digest, relative
    return raw.decode('utf-8')


script = read_checked('text-v3/script.md', 'faf374314a72318a126aa11e66106b662006b317b1364e2a0bae76985844568a')
plan = read_checked('planning-v2/plan.md', 'f5247a818d5c35b9b151221a05c67d3b046f19f6537e7a56ed1cb502c8960ebc')
board = read_checked('storyboard-v2/output.md', 'b39830367456f0bbe78916f5cafd7242ba651a525f208693af5cdd385b218814')
script = exact(script, '杂役抱柴过门槛绊倒', '杂役抱柴过门槛时脚下一绊、身子前栽')
script = exact(script, '两盏油灯在瞳仁中有倒影', '两盏油灯照着，瞳仁有灯焰倒影')
plan = exact(plan, '杂役绊倒、劈柴直落', '杂役脚下一绊、身子前栽，劈柴直落')
rows = board.splitlines(keepends=True)
for shot in (1, 4, 12, 16):
    positions = [i for i, row in enumerate(rows) if row.startswith(f'| {shot} |')]
    assert len(positions) == 1
    index = positions[0]
    cells = rows[index].rstrip('\n').split('|')
    assert len(cells) == 17
    semantics = json.loads(cells[15])
    if shot == 1:
        cells[4] = exact(cells[4], '藤筐', '矿筐')
        prop = next(item for item in semantics['visibleProps'] if item['name'] == '藤筐')
        prop['name'] = '矿筐'
    elif shot == 4:
        assert semantics['actionIn'] == '赵四鞭已扬，小杂役抱矿渣'
        semantics['actionIn'] = '赵四鞭已扬，小杂役抠住矿渣'
    elif shot == 12:
        cells[8] = exact(cells[8], '杂役绊倒', '杂役脚下一绊、身子前栽')
        assert semantics['actionIn'] == '杂役绊倒，一根劈柴向小丫头后脑落下'
        semantics['actionIn'] = '杂役脚下一绊、身子前栽，一根劈柴向小丫头后脑落下'
        porter = next(item for item in semantics['visibleCharacters'] if item['name'] == '抱柴杂役')
        assert porter['actionIn'] == '抱柴绊倒前栽'
        porter['actionIn'] = '抱柴过门槛时脚下一绊、身子前栽'
        steward = next(item for item in semantics['visibleCharacters'] if item['name'] == '管事')
        assert (steward['actionIn'], steward['actionOut']) == ('看独孤右脚', '一瞬后移开目光')
        steward['actionIn'] = '在门口'
        steward['actionOut'] = '独孤写稳后，目光在右脚位置停一瞬又移开'
    else:
        cells[2] = exact(cells[2], '瞳仁仍有两盏油灯倒影', '瞳仁仍有灯焰倒影')
    cells[15] = ' ' + json.dumps(semantics, ensure_ascii=False, separators=(',', ':')) + ' '
    rows[index] = '|'.join(cells) + '\n'
board = ''.join(rows)
assert '绊倒' not in script + plan + board
assert '两盏油灯倒影' not in board
outputs = [('text-v4/script.md', script), ('planning-v3/plan.md', plan), ('storyboard-v3/output.md', board)]
for relative, _ in outputs:
    assert not (BASE / relative).exists(), relative
receipts = []
for relative, text in outputs:
    destination = BASE / relative
    destination.parent.mkdir(exist_ok=True)
    with destination.open('x', encoding='utf-8') as file:
        file.write(text)
    receipts.append({'path': str(destination), 'sha256': sha(destination.read_bytes())})
receipt = {
    'operator': 'root', 'sourceSha256': '79da99d9390a71010fa4a6b7949de19a6b963c549c0988d59ad784894bf7587b',
    'basis': 'research/chapter001-storyboard-semantic-result.md F1-F5 plus root exact source review',
    'oldArtifactsPreserved': True, 'modelCalls': 0, 'projectWrites': 0,
    'newOutputs': receipts, 'requiresFreshAuditsAndPrimaryReview': True,
}
with (BASE / 'root-text-corrections-1027.json').open('x', encoding='utf-8') as file:
    json.dump(receipt, file, ensure_ascii=False, indent=2)
print(json.dumps(receipt, ensure_ascii=False))
