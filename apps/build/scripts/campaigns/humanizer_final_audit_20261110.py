"""Read-only, bounded structural audit; does not judge story quality or runtime use."""
import base64
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/11-10-humanizer-fusion'
RESEARCH = TASK / 'research'
SKILL = ROOT / '.agents/skills/Humanizer'
results = {}
files = [SKILL / 'SKILL.md', *(SKILL / 'references' / name for name in
         ('modes.md', 'diagnosis-and-revision.md', 'examples.md'))]
entry = files[0].read_text()
links = re.findall(r'\]\((references/[^)]+)\)', entry)
assert len(links) == 3 and all((SKILL / link).is_file() for link in links)
results['entry_links'] = len(links)
for path in files:
    lines = path.read_text().splitlines()
    assert sum(line.startswith('```') for line in lines) % 2 == 0, path
    for index, line in enumerate(lines):
        if line.startswith('#'):
            following = next((item for item in lines[index + 1:] if item.strip()), '')
            level = len(line) - len(line.lstrip('#'))
            next_level = len(following) - len(following.lstrip('#'))
            assert following and (next_level == 0 or next_level > level), (path, index + 1)
results['skill_markdown_files'] = len(files)

manifest_path = RESEARCH / 'source-snapshots-20261110/manifest.json'
manifest = json.loads(manifest_path.read_text())
assert len(manifest['entries']) == 21
matches = 0
for item in manifest['entries']:
    data = (manifest_path.parent / item['snapshot']).read_bytes()
    assert len(data) == item['bytes']
    assert hashlib.sha256(data).hexdigest() == item['sha256']
    blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    assert blob == item['blob']
    if item['expected_blob'] is not None:
        assert blob == item['expected_blob']
        matches += 1
assert matches == 16
results['preserved_source_hashes'] = 21
results['recorded_blob_matches'] = matches

bp = RESEARCH / 'brian-provenance-20261110'
bm = json.loads((bp / 'manifest.json').read_text())
for name, digest in bm['files'].items():
    assert hashlib.sha256((bp / name).read_bytes()).hexdigest() == digest
commit = json.loads((bp / 'author-commit.json').read_text())
content = json.loads((bp / 'file-at-author-commit.json').read_text())
data = (bp / 'deslop-author-version.md').read_bytes()
assert commit['sha'] == 'cad76275477fc5208833f696ce24954a5e3612f3'
assert commit['author']['login'] == 'brianlovin'
assert commit['commit']['verification']['verified'] is True
assert commit['commit']['verification']['reason'] == 'valid'
assert base64.b64decode(content['content']) == data
assert content['sha'] == bm['blob']
assert any(item['filename'] == 'skills/deslop/SKILL.md' and item['sha'] == bm['blob']
           for item in commit['files'])
results['brian_evidence_hashes'] = len(bm['files'])
results['brian_historical_commit_binding'] = True

real_path = RESEARCH / 'forward-real-20261110.md'
real = real_path.read_text()
source_path = Path(re.search(r'> 原文：`([^`]+)`', real).group(1))
source_lines = source_path.read_text().splitlines()[56:105]
source_quotes = re.findall('“([^”]+)”', '\n'.join(source_lines))
script = real.split('## 一、剧本', 1)[1].split('## 二、导演', 1)[0]
voice_lines = re.findall(r'^\*\*([^*\n]+)\*\*：(.+)$', script, re.M)
dialogue = [line for speaker, line in voice_lines if not speaker.startswith('旁白')]
assert dialogue == source_quotes and len(dialogue) == 13
rows = [line.split('|')[1:-1] for line in real.splitlines() if line.startswith('| M')]
assert len(rows) == 26
assert [int(re.search(r'M(\d+)', row[0]).group(1)) for row in rows] == list(range(1, 27))
assert sum(int(re.search(r'／(\d+)秒', row[0]).group(1)) for row in rows) == 247
sound = '\n'.join(row[3] for row in rows)
position = 0
for quote in source_quotes:
    position = sound.index(quote, position) + len(quote)
narration = [line for speaker, line in voice_lines if speaker.startswith('旁白')]
assert len(narration) == 9 and all(line in sound for line in narration)
indexed_lines = [int(x) for x in re.findall(r'^\| (\d+) \|', real, re.M)]
assert indexed_lines == [57 + i for i, line in enumerate(source_lines) if line.strip()]
assert len(indexed_lines) == 25
results['real_source_quotes_in_script_and_board'] = 13
results['real_narration_in_script_and_board'] = 9
results['real_source_paragraph_indices'] = 25
results['real_shots_and_budget_seconds'] = [26, 247]

creative_path = RESEARCH / 'forward-creative-20261110.md'
creative = creative_path.read_text()
novel = creative.split('## 一、小说\n', 1)[1].split('## 二、剧本', 1)[0]
novel_counts = [sum(not c.isspace() for c in novel), sum('\u4e00' <= c <= '\u9fff' for c in novel)]
assert novel_counts == [375, 297]
cs = creative.split('## 二、剧本', 1)[1].split('## 三、导演', 1)[0]
cv = re.findall(r'^(老周|林照)(（[^\n]+）)?：(.+)$', cs, re.M)
dc = sum('\u4e00' <= c <= '\u9fff' for _, aside, line in cv if not aside for c in line)
ic = sum('\u4e00' <= c <= '\u9fff' for _, aside, line in cv if aside for c in line)
assert (dc, ic) == (75, 8)
cr = [line.split('|')[1:-1] for line in creative.splitlines() if re.match(r'^\| \d{2}／', line)]
assert len(cr) == 8
end = 0
for number, row in enumerate(cr, 1):
    match = re.fullmatch(r'\s*(\d{2})／(\d+)–(\d+)，(\d+) 秒\s*', row[0])
    shot, start, stop, duration = map(int, match.groups())
    assert shot == number and start == end and stop - start == duration
    end = stop
assert end == 66
blocks = re.split(r'\*\*B\d+｜[^\n]+\*\*', cs)[1:]
assert len(blocks) == 8
for block, row in zip(blocks, cr):
    offset = 0
    for _, _, speech in re.findall(r'^(老周|林照)(（[^\n]+）)?：(.+)$', block, re.M):
        for sentence in re.findall(r'[^。！？]+[。！？]?', speech):
            offset = row[3].index(sentence, offset) + len(sentence)
results['creative_novel_characters_and_han'] = novel_counts
results['creative_dialogue_and_inner_voice_han'] = [dc, ic]
results['creative_speech_hypothesis_seconds'] = round((dc + ic) / 3.2, 2)
results['creative_shots_and_budget_seconds'] = [8, end]
results['creative_script_board_speech_blocks'] = len(blocks)

regression_path = RESEARCH / 'forward-regression-20261110.md'
regression = regression_path.read_text()
regression_rows = re.findall(r'^\|(\d{2})／(\d+)秒\|', regression, re.M)
assert [int(n) for n, _ in regression_rows] == [1, 2, 3, 4]
assert sum(int(seconds) for _, seconds in regression_rows) == 16
results['regression_shots_and_budget_seconds'] = [4, 16]

report_names = ['source-closure-20261110.md', 'resume-plan-20261110.md',
                'behavior-red-20261110.md', 'translation-brian-author-20261110.md',
                'deep-review-20261110.md']
report_links = 0
for name in report_names:
    path = RESEARCH / name
    for target in re.findall(r'\]\(([^)]+)\)', path.read_text()):
        if '://' not in target and not target.startswith('#'):
            assert (path.parent / target.split('#')[0]).exists(), (name, target)
            report_links += 1
results['current_report_local_links'] = report_links
results['fingerprints'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in files + [real_path, creative_path, regression_path]}
results['source_fingerprint'] = hashlib.sha256(source_path.read_bytes()).hexdigest()
results['scope'] = 'Structural checks only; semantic review, runtime activation, audio, images, staging and audience response are separate.'
print(json.dumps(results, ensure_ascii=False, indent=2))
