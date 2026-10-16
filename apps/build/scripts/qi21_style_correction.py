"""Small, backed-up batches for the user-requested shared style correction."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[3]
MANUAL = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
OUT = ROOT / 'apps/output/automation/daojie-qi21-style-correction-1016'
SOURCE = MANUAL / 'json/qi21_bases.json'
STYLE = (
    '美术风格底座：中国传统人物画审美经现代游戏美术设计重组的二维数字绘画。'
    '融合工笔、白描与连环画的绘画语言；铁线描细稳连贯，线宽与轻重提按富有节奏，保留手绘笔性；'
    '薄透矿物色分染与罩染，墨色浓淡、虚实边缘与笔触节奏相融；'
    '采用中国传统色体系，饱和度与对比度受控，材质表现统一于绘画语言。'
    '成像工艺干净，线条与罩染层次清晰。'
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write(path: Path, text: str, reason: str) -> None:
    before = path.read_bytes()
    after = text.encode('utf-8')
    if before == after:
        return
    relative = (path.relative_to(ROOT) if path.is_relative_to(ROOT)
                else Path('external') / path.relative_to('/'))
    backup = OUT / 'backups' / relative
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
        shutil.copy2(path, backup)
    if path.read_bytes() != before:
        raise RuntimeError(f'Concurrent change: {path}')
    path.write_bytes(after)
    ledger_file = OUT / 'changes.json'
    ledger = json.loads(ledger_file.read_text()) if ledger_file.exists() else []
    row = next((r for r in ledger if r['path'] == str(path)), None)
    if row is None:
        row = {'path': str(path), 'backup': str(backup),
               'before': sha(backup.read_bytes()), 'reasons': []}
        ledger.append(row)
    row['after'] = sha(after)
    if reason not in row['reasons']:
        row['reasons'].append(reason)
    ledger_file.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')


def dump(path: Path, data: dict, reason: str) -> None:
    write(path, json.dumps(data, ensure_ascii=False, indent=2) + '\n', reason)


def replace_all_guarded(path: Path, replacements: list[tuple[str, str]], reason: str) -> None:
    text = path.read_text()
    for old, new in replacements:
        if text.count(old) != 1:
            raise RuntimeError(f'{path}: expected one match for {old[:70]!r}')
        text = text.replace(old, new)
    write(path, text, reason)


def core() -> None:
    data = json.loads(SOURCE.read_text())
    old_file = OUT / 'original-style.json'
    if not old_file.exists():
        old_file.write_text(json.dumps(data['art_style_base'], ensure_ascii=False, indent=2) + '\n')
    types_before = json.dumps(data['types'], ensure_ascii=False, sort_keys=True)
    base = data['art_style_base']
    base['positive_text'] = STYLE
    base['positive_style_text'] = STYLE
    base['positive_ground_text'] = ''
    base['_doc'] = ('共同底座只定义中国传统人物画经现代游戏美术重组的绘画语言与通用成像工艺；'
                    '不描述主体、状态、背景、景别、构图、时段或照明。positive_ground_text 显式留空，'
                    '保留四段协议接口；环境与来源事实由类型句和主体句负责。'
                    '负向词仅保留接口兼容，viggle BasicGuider 不消费独立负向条件。')
    for segment in data['layer_contract']['segments']:
        if segment['segment'] == '氛围/光':
            segment['art_style_base'] = '—（不在美术风格底座中描述）'
        elif segment['segment'] == '风格':
            segment['art_style_base'] = '全部定义（传统绘画转译/画种/媒介/线条/罩染/墨色/传统色体系）'
    assert json.dumps(data['types'], ensure_ascii=False, sort_keys=True) == types_before
    dump(SOURCE, data, '恢复纯美术底座与成像工艺；显式空背景；保留全部类型与负向、透明承载')
    node = ROOT / 'apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_bases_text.py'
    replace_all_guarded(node, [
        ('美术风格底座=底座全文(带背景)/风格工艺件·底色背景件·透明承载件=底座三件拆分(1008:透明型=风格+透明承载,带背景型=风格+底色)',
         '美术风格底座=纯美术语言与成像工艺/风格工艺件·底色背景件·透明承载件=协议拆分(底色背景件可为空；背景由类型句与主体句供给)'),
        ('("底色背景件", "带背景六型的底色/平涂/大色面段")',
         '("底色背景件", "保留的背景协议段，可为空；背景由类型句与主体句供给")'),
        ('if _st and _gd and _rg:',
         'if _st and _rg and isinstance(asb.get("positive_ground_text"), str):'),
        ('# 旧库回退:缺任一拆分件=全文不加标记(协议解析侧按无标记走 legacy)',
         '# 显式空背景有效；旧库缺字段才回退全文(协议解析侧按无标记走 legacy)'),
    ], '四段协议接受显式空背景，并修正真源文本提示说明')
    print('core corrected:', len(STYLE), 'characters; types preserved')


def documents() -> None:
    old = json.loads((OUT / 'original-style.json').read_text())
    prefix = MANUAL / 'prefix.md'
    replace_all_guarded(prefix, [
        (old['positive_style_text'] + ' ' + old['positive_ground_text'], STYLE),
        (old['positive_style_text'] + '\n' + old['positive_ground_text'], STYLE),
    ], '质量锚定与风格底座锁统一引用纯美术底座')
    layering = MANUAL / 'json/prompt_layering.json'
    data = json.loads(layering.read_text())
    style = data['layers']['style_base']
    style['owns']['风格·全部定义'] = ('中国传统人物画经现代游戏美术重组的二维数字绘画；'
                                 '工笔、白描、连环画、铁线描、矿物色分染罩染、墨色与笔触节奏。')
    style['owns'].pop('光·类型契约')
    style['owns']['色彩·色板词汇表'] = ('中国传统色体系与受控饱和度、对比度；'
                                       '具体用色由类型预算和主体落点负责，色板数据由独立词典供给。')
    style['owns']['质量词·工艺描述'] = ('成像工艺干净，线条与罩染层次清晰。'
                                       '描述通用绘画工艺，不描述对象是否崭新、完整或洁净。')
    style['forbidden'] = [
        '具体对象、部件、服饰、磨损、尘土、血痕与身体状态（归主体句及类型的来源事实规则）',
        '背景内容、景别、近远景结构、空气透视与净空安排（归类型句和主体句）',
        '时段、光源、照明、氛围情绪与构图格式（归类型句和主体句）',
    ]
    for segment in data['segment_matrix']:
        if segment['segment'] == '氛围/光':
            segment['style_base'] = '—（不在美术风格底座中描述）'
        elif segment['segment'] == '风格':
            segment['style_base'] = '全部定义（传统绘画转译/画种/媒介/线条/罩染/墨色/传统色体系）'
    dump(layering, data, '分层契约明确底座只管美术语言与成像工艺，移出照明职责')
    readme = MANUAL / 'json/README.md'
    text = readme.read_text()
    anchor = '**家规:道劫风格的机读供给资产只住本目录,只有一份。**'
    assert text.count(anchor) == 1
    text = text.replace(anchor, ('> **底座职责（2026-10-16 纠正）**：`positive_text` 与 '
        '`positive_style_text` 同文，只描述传统绘画经现代游戏美术重组的美术语言与通用成像工艺；'
        '保留“成像工艺干净，线条与罩染层次清晰。”。不写具体对象、状态、背景、景别、构图、时段或照明。'
        '`positive_ground_text` 显式为空，四段协议及透明承载接口保留；环境与来源事实由类型句和主体句供给。\n\n' + anchor))
    text = text.replace('(画种/线条/罩染/成像工艺；照明按用途)', '(传统绘画转译/线条/罩染/墨色/传统色体系/成像工艺)')
    write(readme, text, '字段字典说明纯美术职责与显式空背景协议')
    contract = MANUAL / 'ma_sync/runtime-contract.json'
    data = json.loads(contract.read_text())
    data['modules']['style.gongbi-base']['text'] = STYLE
    data['localRevision']['styleSourceSha256'] = sha(SOURCE.read_bytes())
    data['localRevision']['styleBoundary'] = '仅美术语言与通用成像工艺；主体、状态、背景、景别、时段和照明不入底座。'
    fingerprint = {k: v for k, v in data.items() if k != 'contractSha256'}
    data['contractSha256'] = sha(json.dumps(fingerprint, ensure_ascii=False, sort_keys=True,
                                          separators=(',', ':')).encode())
    dump(contract, data, '运行时风格模块与真源同文，重算本地来源与合同指纹，保留MA历史来源')
    anchors = MANUAL / 'ma_sync/lock-anchors.json'
    data = json.loads(anchors.read_text())
    row = next(r for r in data['locks'] if r['name'] == '风格底座锁')
    row['manualAnchors'] = ['中国传统人物画审美经现代游戏美术设计重组的二维数字绘画',
                            '铁线描细稳连贯', '成像工艺干净，线条与罩染层次清晰。']
    dump(anchors, data, '手册底座锚改为纯美术语言，MA锚与来源保持继承基线')
    snapshot = MANUAL / 'ma_sync/LOCK_SNAPSHOT.md'
    text = snapshot.read_text()
    marker = '本目录是 MYStudio 道劫手册与 MA `ma-imagegen` 的同步锚点:'
    assert text.count(marker) == 1
    text = text.replace(marker, ('> **同日底座职责纠正**：风格底座只保留传统绘画转译、美术语言与通用成像工艺；'
        '主体状态、背景、景别、构图、时段和照明移出底座。保留成像工艺句；空背景件保留协议接口。'
        '机读现值见 `../json/qi21_bases.json#art_style_base`，历史 MA 来源与锚不改。\n\n' + marker))
    write(snapshot, text, '记录底座职责纠正，不改历史来源')
    print('documents and runtime contract corrected; contract SHA:',
          json.loads(contract.read_text())['contractSha256'])


def snapshots() -> None:
    old = json.loads((OUT / 'original-style.json').read_text())
    replacements = dict.fromkeys([
        old['positive_text'], old['positive_style_text'] + '\n' + old['positive_ground_text'],
        old['positive_style_text'] + '\\n' + old['positive_ground_text'],
        old['positive_style_text'] + ' ' + old['positive_ground_text'], old['positive_style_text'],
    ], STYLE)
    replacements[old['positive_ground_text']] = ''
    replacements = sorted(replacements.items(), key=lambda pair: -len(pair[0]))
    backend = ROOT / 'apps/backend/engines/comfyui'
    names = {'qi21-道劫-t2i.json': 3, 'qi21-道劫-i2i.json': 2,
             'qwen21-道劫-t2i-api.json': 2, 'qi21-道劫-img2img.json': 1,
             'qi21-提示词类型优化子图.json': 3, 'qi21-提示词类型优化子图-i2i.json': 2}
    paths = [p for p in (backend / 'workflows').rglob('*.json') if p.name in names]
    paths += [p for p in (backend / 'my_nodes/subgraphs').iterdir() if p.name in names]
    assert len(paths) == len(names), paths
    report = []
    for path in paths:
        data = json.loads(path.read_text())
        changes = []

        def walk(value, chain):
            if isinstance(value, dict):
                return {k: walk(v, chain + [k]) for k, v in value.items()}
            if isinstance(value, list):
                return [walk(v, chain + [i]) for i, v in enumerate(value)]
            if not isinstance(value, str):
                return value
            result = value
            for previous, current in replacements:
                result = result.replace(previous, current)
            if result != value:
                changes.append(chain)
            return result

        updated = walk(data, [])
        assert len(changes) == names[path.name], (path, changes)
        dump(path, updated, '仅同步美术底座展示与协议字符串，不改节点、连线、采样或其他类型')
        report.append({'path': str(path), 'changed_string_paths': changes})
    (OUT / 'snapshots.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('snapshot files:', len(report), '; style leaves:', sum(len(r['changed_string_paths']) for r in report))


def test_anchors() -> None:
    tests = ROOT / 'apps/backend/engines/comfyui/my_nodes/tests'
    replace_all_guarded(tests / 'test_my_qi21_bases_text.py', [
        ('assert "铁线描" in 风格 and "服从场景和时段" in 风格, "画法与剧情照明边界应随真源热读"',
         'assert "铁线描" in 风格 and "成像工艺干净" in 风格, "美术语言与成像工艺应随真源热读"'),
    ], '热读回归锚随纯美术职责更新，移除鼓励底座写照明的旧断言')
    replace_all_guarded(tests / 'test_my_qi21_prompt_assembly.py', [
        ('"锁层A全文": "82d0585fad44107a"', '"锁层A全文": "' + sha(STYLE.encode())[:16] + '"'),
    ], '装配默认值SHA锚随纯美术底座更新')
    contract = json.loads((MANUAL / 'ma_sync/runtime-contract.json').read_text())
    test = ROOT / 'apps/frontend/lib/ai/daojie-prompt-contract.test.ts'
    replace_all_guarded(test, [
        ('38eabcb8b2b80f579f2746064d854e3b5bb63e9dcd8a4a45569aa30f701eaefb', contract['contractSha256']),
        ('expect(DAOJIE_RUNTIME_CONTRACT.modules["style.gongbi-base"].text).toContain("背景的色相、明暗与光源服从场景和时段");',
         'expect(DAOJIE_RUNTIME_CONTRACT.modules["style.gongbi-base"].text).toContain("中国传统人物画审美经现代游戏美术设计重组");\n'
         '    expect(DAOJIE_RUNTIME_CONTRACT.modules["style.gongbi-base"].text).toContain("成像工艺干净，线条与罩染层次清晰。");\n'
         '    expect(DAOJIE_RUNTIME_CONTRACT.modules["style.gongbi-base"].text).not.toMatch(/衣物|尘土|血痕|身体状态|背景|近景|远景|时段|光源|光照|构图|留白/);'),
    ], '运行时合同指纹与纯美术边界断言同步')
    print('three existing test anchors updated')


def distribute() -> None:
    plan = json.loads((OUT / 'distribution-plan.json').read_text())
    rows = []
    for row in plan['files']:
        source, target = Path(row['source']), Path(row['target'])
        source_bytes, target_bytes = source.read_bytes(), target.read_bytes()
        assert sha(source_bytes) == row['source_sha'], f'Source changed after review: {source}'
        assert sha(target_bytes) == row['before'], f'Target changed after review: {target}'
        data = source_bytes
        preserved_type_difference = False
        if source == SOURCE:
            current = json.loads(target_bytes)
            desired = json.loads(source_bytes)
            original_types = json.dumps(current['types'], ensure_ascii=False, sort_keys=True)
            current['art_style_base'] = desired['art_style_base']
            current['layer_contract'] = desired['layer_contract']
            assert json.dumps(current['types'], ensure_ascii=False, sort_keys=True) == original_types
            preserved_type_difference = current['types'] != desired['types']
            data = (json.dumps(current, ensure_ascii=False, indent=2) + '\n').encode()
        else:
            assert row['matches_source_before'] or row['matches_source_after'], target
        write(target, data.decode('utf-8'),
              '仅同步本次底座修订：' + str(source.relative_to(ROOT)) +
              ('；保留此副本原有类型字段' if source == SOURCE else ''))
        assert target.read_bytes() == data
        rows.append({**row, 'after': sha(data), 'source_byte_identity': data == source_bytes,
                     'preserved_existing_type_difference': preserved_type_difference})
    result = {**plan, 'files': rows,
              'runtime_note': '仅更新磁盘与资源副本；未重启引擎、未打包app.asar、未提交生图。'}
    (OUT / 'distribution.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('distributed', len(rows), 'targets; preserved pre-existing type differences:',
          sum(r['preserved_existing_type_difference'] for r in rows))


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    {'core': core, 'documents': documents, 'snapshots': snapshots,
     'test-anchors': test_anchors, 'distribute': distribute}[sys.argv[1]]()
