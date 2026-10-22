"""Execute only prompt nodes on the installed engine; no model or image nodes."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/qi21-repair-text-probe-1022.json'
HOME = next(p for p in (Path.home() / 'Library/Application Support').iterdir() if p.name == '漫影工作室')
PORT = json.loads((HOME / 'comfyui/manifest.json').read_text())['engine']['port']
ORIGIN = f'http://127.0.0.1:{PORT}'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(path, data=None):
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode()
    req = urllib.request.Request(ORIGIN + path, data=body, headers={'Content-Type': 'application/json'})
    with OPENER.open(req, timeout=15) as response:
        return json.load(response)


def main():
    queue = request('/queue')
    assert not queue['queue_running'] and not queue['queue_pending'], 'Engine busy; no job submitted.'
    names = ('MyQi21DaojieBase', 'MyQi21ApiPE', 'MyQi21InstructionSelect',
             'MyQi21PromptAssembly', 'MyQi21FinalOutput', 'MyQi21PromptPreview')
    schema = {}
    for name in names:
        info = request('/object_info/' + name)
        assert name in info, f'{name} not loaded'
        schema[name] = info[name]
    data_path = Path(subprocess.check_output(['fd', '-a', '^qi21_bases.json$',
        str(ROOT / 'apps/frontend/assets/studio-manuals/art_skills')], text=True).strip())
    data = json.loads(data_path.read_text())
    style = data['art_style_base']['positive_text']
    subject = '一位约二十岁的青年男修，光洁的头颅，瘦削的脸轮廓分明；画面底缘止于颈根。'
    pe_defaults = {name: spec[1]['default'] for name, spec in schema['MyQi21ApiPE']['input']['required'].items()}
    pe_inputs = {**pe_defaults, 'AI扩写开关': False, '正向提示词': subject,
        '类型句正向': ['base', 0], '类型句负向': ['base', 3],
        '透明模式': ['base', 4], '画幅宽': ['base', 1], '画幅高': ['base', 2],
        '美术风格底座-正向': style, '美术风格底座-负向': data['art_style_base']['negative_text']}
    graph = {
        'base': {'class_type': 'MyQi21DaojieBase', 'inputs': {'base': '人脸基准'}},
        'pe': {'class_type': 'MyQi21ApiPE', 'inputs': pe_inputs},
        'final': {'class_type': 'MyQi21FinalOutput', 'inputs': {
            '正向提示词': ['pe', 0], '负向提示词': ['pe', 1], '透明模式': ['pe', 2]}},
        'preview': {'class_type': 'MyQi21PromptPreview', 'inputs': {
            '正向提示词': ['final', 0], '负向提示词': ['final', 1]}},
    }
    for pe_on in (False, True):
        suffix = 'on' if pe_on else 'off'
        selected = subject + ('保持参考人物身份。' if pe_on else '')
        graph['select_' + suffix] = {'class_type': 'MyQi21InstructionSelect', 'inputs': {
            '原始指令': subject, 'PE出文': selected, 'pe开关': pe_on}}
        graph['assembly_' + suffix] = {'class_type': 'MyQi21PromptAssembly', 'inputs': {
            'BASE': ['base', 0], 'BASE负面': ['base', 3], '主体句': ['select_' + suffix, 0],
            '锁层A全文': style, '组装用途': '道劫美术类型'}}
        graph['final_' + suffix] = {'class_type': 'MyQi21FinalOutput', 'inputs': {
            '正向提示词': ['assembly_' + suffix, 0], '负向提示词': ['assembly_' + suffix, 1],
            '透明模式': ['base', 4]}}
        graph['preview_' + suffix] = {'class_type': 'MyQi21PromptPreview', 'inputs': {
            '正向提示词': ['final_' + suffix, 0], '负向提示词': ['final_' + suffix, 1]}}
    assert {n['class_type'] for n in graph.values()} <= set(names)
    receipt = {'origin': ORIGIN, 'graph': graph, 'schema_classes': list(schema),
               'image_generation': False, 'model_nodes': [], 'ok': False}
    submitted = request('/prompt', {'prompt': graph, 'client_id': 'qi21-repair-text-1022'})
    receipt['submission'] = submitted
    assert not submitted.get('node_errors'), submitted
    prompt_id = submitted['prompt_id']
    OUT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        history = request('/history/' + prompt_id)
        if prompt_id in history:
            result = history[prompt_id]
            receipt['history'] = result
            assert result['status']['status_str'] == 'success', result['status']
            break
        time.sleep(.5)
    else:
        raise TimeoutError('Text probe did not finish within 90 seconds; inspect its prompt_id.')
    outputs = result['outputs']
    head, tail = data['rgba']['head_en'], data['rgba']['tail_en']
    for name in ('preview', 'preview_off', 'preview_on'):
        text = outputs[name]['positive'][0]
        assert text.startswith(head + ' ') and text.endswith(' ' + tail), name
        assert text.count(head) == text.count(tail) == 1, name
        assert subject in text, name
        assert '单一角色的正面头颈特写' in text, name
        assert text.index('美术风格底座') < text.index('单一角色的正面头颈特写') < text.index(subject), name
        assert data['rgba']['w1_closing'] not in text, name
    assert '保持参考人物身份。' in outputs['preview_on']['positive'][0]
    assert '保持参考人物身份。' not in outputs['preview_off']['positive'][0]
    receipt['ok'] = True
    receipt['output_sha256'] = {name: hashlib.sha256(outputs[name]['positive'][0].encode()).hexdigest()
                               for name in ('preview', 'preview_off', 'preview_on')}
    OUT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'ok': True, 'prompt_id': prompt_id, 'text_paths_verified': 3,
                      'image_generation': False, 'report': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
