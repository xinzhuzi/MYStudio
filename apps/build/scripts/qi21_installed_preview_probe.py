"""Execute the installed workflow's real exported [401] text dependency graph."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import time
from qi21_repair_text_probe import request, ROOT

source = ROOT / 'apps/output/automation/qi21-repair-browser.json'
record = json.loads(source.read_bytes())
assert record['ok']
export = copy.deepcopy(record['cases'][0]['output'])
assert export['401']['class_type'] == 'MyQi21PromptPreview'
assert export['400']['class_type'] == 'PrimitiveStringMultiline'
assert export['6:4010']['class_type'] == 'MyQi21DaojieBase'
assert export['6:4013']['class_type'] == 'MyQi21ApiPE'
subject = '一位约二十岁的青年男修的面部特写：光洁的头颅，头皮平整光洁，瘦削的脸轮廓分明，下颌线条利落，头皮与面部肤色微黄，面容光洁；浓黑的剑眉，眉宇间刻着超越年龄的沧桑与绝决；双眼细长锐利，如孤狼般深邃，眼神沉静，深处燃着一簇复仇的野火；鼻梁挺直，唇薄而抿紧，双耳轮廓分明、贴近颅侧；画面底缘止于颈根。'
export['400']['inputs']['value'] = subject
export['6:4010']['inputs']['base'] = '人脸基准'
export['6:4013']['inputs']['AI扩写开关'] = False
pending, needed = ['401'], set()
while pending:
    node_id = pending.pop()
    if node_id in needed:
        continue
    needed.add(node_id)
    for value in export[node_id]['inputs'].values():
        if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and value[0] in export:
            pending.append(value[0])
graph = {node_id: export[node_id] for node_id in needed}
assert all(n['class_type'].startswith('MyQi21') or n['class_type'] == 'PrimitiveStringMultiline'
           for n in graph.values()), 'A model or image node entered the text probe'
queue = request('/queue')
assert not queue['queue_running'] and not queue['queue_pending'], 'Engine busy'
submission = request('/prompt', {'prompt': graph, 'client_id': 'qi21-installed-401-preview'})
assert not submission.get('node_errors'), submission
prompt_id = submission['prompt_id']
for _ in range(120):
    history = request('/history/' + prompt_id)
    if prompt_id in history:
        result = history[prompt_id]
        break
    time.sleep(.5)
else:
    raise TimeoutError(prompt_id)
assert result['status']['status_str'] == 'success', result['status']
text = result['outputs']['401']['positive'][0]
assert text.index('美术风格底座') < text.index('单一角色的正面头颈特写') < text.index(subject)
assert text.count(subject) == 1
assert text.count('This is an RGBA image with transparency.') == 1
assert text.count('The image has alpha channel and the background is transparent.') == 1
out = ROOT / 'apps/output/automation/qi21-installed-preview.json'
out.write_text(json.dumps({'ok': True, 'workflow': record['cases'][0]['file'],
    'prompt_id': prompt_id, 'node_ids': sorted(needed), 'image_generation': False,
    'remote_ai_called': False, 'history': result}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'prompt_id': prompt_id, 'preview_node': '401',
    'text_node_count': len(graph), 'positive_chars': len(text), 'report': str(out)}, ensure_ascii=False))
