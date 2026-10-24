"""Offline contracts for the saved i2i negative route."""
from __future__ import annotations

import copy
import importlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
r = importlib.import_module('qi21_i2i_repair_1016')


def test_saved_negative_route() -> None:
    source, blueprint = [json.loads(path.read_bytes()) for path in r.paths()[:2]]
    graph = r.graph(source, r.PROMPT_ID)
    assert [port['name'] for port in graph['outputs']] == ['prompt', '画幅W', '画幅H', 'negative']
    edges = {(edge['origin_id'], edge['origin_slot'], edge['target_id'], edge['target_slot'])
             for edge in graph['links']}
    nodes = {node['id']: node for node in graph['nodes']}
    for origin, output, target, name in ((4010, 3, 4011, 'BASE负面'),
                                          (4011, 1, 153, '负面词直写')):
        slot = next(index for index, port in enumerate(nodes[target]['inputs']) if port['name'] == name)
        assert (origin, output, target, slot) in edges
    assert (153, 1, -20, 3) in edges
    host = r.host(source, r.PROMPT_ID)
    for encoder in [node for node in source['nodes'] if node['type'] == 'TextEncodeQwenImage21']:
        slot = next(index for index, port in enumerate(encoder['inputs']) if port['name'] == 'negative_prompt')
        assert any(edge[1:5] == [host['id'], 3, encoder['id'], slot] for edge in source['links'])
    assert len(host['outputs'][3]['links']) == 2
    assert r.host(blueprint, r.PROMPT_ID)['outputs'][3] == {'name': 'negative', 'type': 'STRING', 'links': []}


def load_node(name: str):
    path = r.ROOT / 'apps/backend/comfyui/my_nodes/nodes' / (name + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('purpose', ['局部编辑', '新建资产'])
@pytest.mark.parametrize('pe', [False, True])
@pytest.mark.parametrize('transparent', [False, True])
def test_actual_assembly_and_final_selection(purpose: str, pe: bool, transparent: bool) -> None:
    assembly = load_node('my_qi21_prompt_assembly')
    selection = load_node('my_qi21_prompt_select')
    catalog = json.loads(assembly._BASES_FILE.read_text())
    entry = next(item for item in catalog['types'] if item['zh'] == '人物海报')
    base = (entry['positive_text'], entry['negative_text'])
    direct = selection.MyQi21PromptSelect().compose(装配全文='编辑指令', PE出文='扩写指令', pe开关=pe)[0]
    text, negative = assembly.MyQi21PromptAssembly().assemble(
        BASE=base[0], BASE负面=base[1], 主体句=direct, 主体句负面='主体禁项', 组装用途=purpose)
    result = selection.MyQi21PromptSelect().compose(
        装配全文=text, 负面词直写=negative, pe开关=False, 透明模式=transparent)
    expected = '主体禁项' if purpose == '局部编辑' else assembly._merge_negative(
        assembly._merge_negative(base[1], assembly._load_art_style_base()['negative']), '主体禁项')
    assert result[1] == negative == expected
    assert ('扩写指令' if pe else '编辑指令') in result[0]


def test_transform_frozen_and_replay() -> None:
    negative = importlib.import_module('qi21_i2i_negative_1016')
    documents = [json.loads(path.read_bytes()) for path in r.paths()[:2]]
    after = negative.transform(documents)
    assert after == documents
    assert negative.transform(copy.deepcopy(after)) == after
    negative.validate(after)
    r.synchronize(after[1], after[0])
    assert after == documents
    changed = copy.deepcopy(documents)
    r.graph(changed[0], r.ACCEL_ID)['nodes'][0]['widgets_values'][0] = 'invalid'
    with pytest.raises(AssertionError):
        negative.assert_whitelist(documents, changed)


def test_check_read_only() -> None:
    paths = r.paths()
    before = [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths]
    subprocess.run([sys.executable, str(Path(__file__).with_name('qi21_i2i_negative_1016.py')), '--check'], check=True)
    assert before == [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths]


def test_original_snapshot_replay_and_parameter_freeze() -> None:
    negative = importlib.import_module('qi21_i2i_negative_1016')
    report = json.loads((r.TASK / 'evidence/i2i-negative-applied.json').read_text())
    originals = [json.loads((r.TASK / 'backups/i2i-negative' / (item['before_sha256'] + '.json')).read_bytes())
                 for item in report['files']]
    current = [json.loads(path.read_bytes()) for path in r.paths()[:2]]
    assert negative.transform(originals) == current
    negative.assert_whitelist(originals, current)
    for previous, after in zip(originals, current):
        for old, new in zip(r.graph(previous, r.PROMPT_ID)['nodes'], r.graph(after, r.PROMPT_ID)['nodes']):
            assert old.get('widgets_values') == new.get('widgets_values')
            assert old.get('widgets_values_named') == new.get('widgets_values_named')
    assert r.helpers.digest(r.paths()[2].read_bytes()) == report['acceleration_sha256']
