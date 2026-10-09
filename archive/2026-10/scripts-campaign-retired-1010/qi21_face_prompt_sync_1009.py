#!/usr/bin/env python3
"""Small, guarded face-expression source revision; no Git or generation."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-09-qi21-source-prompt-review-fixes'
SOURCE = next((ROOT / 'apps/frontend/assets/studio-manuals/art_skills').glob('*/json/qi21_bases.json'))
raw = SOURCE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == '81d1c9d849f986d84c697915da9b7aa26525f196f5cdeb633f6b1eafa3f6f352', 'Source changed: reread before editing'
before = json.loads(raw)
after = copy.deepcopy(before)
t = after['types'][7]
assert t['zh'] == '表情差分'
t['positive_text'] = '同一角色的九宫格脸部表情差分表，三行三列，九格均为正面脸部特写，取景从头顶至下颌，头顶、两侧耳部与下颌轮廓完整，发型外轮廓在各格内完整呈现。正面平视机位一致，头部在各格中的位置与占比一致，五官比例写实、自然立体。脸型、五官相对位置、发型与发际线保持同一角色身份；眉形、眼睑开合、鼻颊肌肉、嘴角与唇形随对应情绪变化，各格情绪与顺序以主体句为准。细彩线勾勒头部与五官轮廓，线随结构时粗时细；面部是细节焦点。\n头发以细彩线分组勾勒，发量与发际线自然，九格发型一致。\n面部肤色、发色与原有色词遵循主体句；新增色由色卡选取，彩线与主体配色协调，以稳定基底承托，中等强度色作层次，少量高识别色仅作点睛。\n图为带透明通道的RGBA透明底图，背景透明。'
t['rgba_positive'] = '同一角色的九宫格脸部表情差分表，三行三列，九格均为正面脸部特写，取景从头顶至下颌，头顶、两侧耳部、下颌与发型外轮廓在各格内完整呈现。正面平视机位一致，头部在各格中的位置与占比一致。脸型、五官相对位置、发型与发际线保持同一角色身份，眉眼、鼻颊与嘴部形态随主体句指定的九个情绪变化，顺序从左到右、从上到下。各格四周留出空边，保持脸部特写取景。图为带透明通道的RGBA透明底图，背景透明。'
t['negative_text'] = '模糊，水印，文字错误，全身像，半身像，肩部入画，躯干入画，四肢入画，衣领入画，机位漂移，侧面视角，俯视，仰视，头部歪斜，头顶裁切，下颌裁切，面容身份漂移，脸型漂移，发型漂移，发际线漂移，五官错位，眼睛畸形，鼻口扭曲，牙齿畸形，多余五官，面部融化，表情僵硬，九格表情重复，格数错误，格间重叠'
t['purpose'] = '1:1 方形脸部表情差分九宫格，三行三列，九格取景均从头顶至下颌，仅呈现头部。主体句依从左到右、从上到下的顺序指定九个情绪，并为各情绪补充可见的眉眼、眼睑、鼻颊、嘴角与唇形变化；角色身份、发型、正面平视机位与脸部取景一致，情绪差异清晰。默认透明底，格名文字后期添加。'
old_clause = '面部特写保持头肩取景，不扩展为全身。'
new_clause = '特写保持对应类型指定的脸部或头肩取景。'
s = after['expand_instruction']['system_prompt_zh']
assert s.count(old_clause) == 1
after['expand_instruction']['system_prompt_zh'] = s.replace(old_clause, new_clause, 1)
edits = [(('types', 7, key), before['types'][7][key], t[key]) for key in ['positive_text', 'rgba_positive', 'negative_text', 'purpose']]
edits.append((('expand_instruction', 'system_prompt_zh'), before['expand_instruction']['system_prompt_zh'], after['expand_instruction']['system_prompt_zh']))
text = raw.decode('utf-8')
for path, old, new in edits:
    anchor = json.dumps(path[-1]) + ': ' + json.dumps(old, ensure_ascii=False)
    assert text.count(anchor) == 1, path
    text = text.replace(anchor, json.dumps(path[-1]) + ': ' + json.dumps(new, ensure_ascii=False), 1)
new_raw = text.encode('utf-8')
assert json.loads(new_raw) == after
assert after['types'][:7] == before['types'][:7] and after['types'][8:] == before['types'][8:]
assert after['types'][4]['resolution_override'] == [1632, 1632]
for key in ['positive_text', 'rgba_positive']:
    assert all(word not in t[key] for word in ['头肩', '领口', '衣领', '全身', '半身', '躯干', '四肢'])
assert all(word not in t['negative_text'] for word in ['裙摆', '鞋', '衣袍', '袖口', '下摆'])
report = {'before_sha256': hashlib.sha256(raw).hexdigest(), 'after_sha256': hashlib.sha256(new_raw).hexdigest(), 'fields': [{'path': list(path), 'before': old, 'after': new} for path, old, new in edits]}
if '--apply' in sys.argv:
    backup = TASK / 'backups/face-before-qi21_bases.json'
    assert not backup.exists(), 'Never overwrite backup'
    shutil.copy2(SOURCE, backup)
    assert backup.read_bytes() == raw and SOURCE.read_bytes() == raw
    fd, temp = tempfile.mkstemp(prefix='.qi21-face-', dir=SOURCE.parent)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(new_raw); stream.flush(); os.fsync(stream.fileno())
    shutil.copymode(SOURCE, temp)
    assert SOURCE.read_bytes() == raw, 'Concurrent edit'
    os.replace(temp, SOURCE)
    (TASK / 'research/face-source-diff.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'fields'} | {'fields': [x['path'] for x in report['fields']], 'applied': '--apply' in sys.argv}, ensure_ascii=False))
