import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[5]
NODES = Path(__file__).resolve().parents[1] / 'nodes'


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, NODES / f'{name}.py')
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_instruction_interface_and_lazy_default():
    module = load_module('my_qi21_prompt_select')
    node = module.MyQi21InstructionSelect()
    optional = node.INPUT_TYPES()['optional']
    assert list(optional) == ['原始指令', 'PE出文', 'pe开关']
    assert optional['原始指令'][1]['forceInput'] is True
    assert optional['PE出文'][1] == {'forceInput': True, 'lazy': True}
    assert optional['pe开关'][1]['default'] is False
    assert node.RETURN_TYPES == ('STRING',)
    assert node.check_lazy_status(PE出文=None) == []
    assert node.check_lazy_status(pe开关=True, PE出文=None) == ['PE出文']
    assert node.check_lazy_status(pe开关=True) == []


@pytest.mark.parametrize('pe_text', [None, '', ' \t\n'])
def test_instruction_rejects_unavailable_pe(pe_text):
    node = load_module('my_qi21_prompt_select').MyQi21InstructionSelect()
    with pytest.raises(ValueError, match='PE出文'):
        node.select_instruction(原始指令='保留', PE出文=pe_text, pe开关=True)


@pytest.mark.parametrize('pe_on', [False, True])
@pytest.mark.parametrize('transparent', [False, True])
@pytest.mark.parametrize('text', ['', ' 原文 \n尾行\t', '山水。keep background.\n 型层 '])
@pytest.mark.parametrize('negative', ['', ' 负向, background \n'])
def test_instruction_and_final_output_match_original_pipeline(pe_on, transparent, text, negative):
    module = load_module('my_qi21_prompt_select')
    final_module = load_module('my_qi21_final_output')
    pe_text = f' PE扩写 {text}\n'
    old = module.MyQi21PromptSelect()
    selected = old.compose(装配全文=text, PE出文=pe_text, pe开关=pe_on)[0]
    adapted = module.MyQi21InstructionSelect().select_instruction(
        原始指令=text, PE出文=pe_text, pe开关=pe_on)[0]
    assert adapted == selected
    assembled = f'{adapted}\n类型与风格'
    rgba = module._load_bases_data()['rgba']
    expected = old.compose(装配全文=assembled, 负面词直写=negative, pe开关=False,
                           透明模式=transparent, RGBA官方头句=rgba['head_en'],
                           RGBA官方尾句=rgba['tail_en'])
    assert final_module.MyQi21FinalOutput().compose(
        正向提示词=assembled, 负向提示词=negative, 透明模式=transparent) == expected


def test_i2i_prompt_cleanup_topology():
    path = next((ROOT / 'apps/backend/comfyui/workflows').glob('**/qi21-*-i2i.json'))
    workflow = json.loads(path.read_text())
    subgraph = next(graph for graph in workflow['definitions']['subgraphs']
                    if any(node['id'] == 4014 for node in graph['nodes']))
    nodes = {node['id']: node for node in subgraph['nodes']}
    assert len(nodes) == 14
    assert len(subgraph['links']) == 32
    assert 4012 not in nodes
    assert nodes[4014]['type'] == 'MyQi21InstructionSelect'
    assert [slot['name'] for slot in nodes[4014]['inputs']] == ['原始指令', 'PE出文', 'pe开关']
    assert nodes[4014]['widgets_values'] == [False]
    assert nodes[153]['type'] == 'MyQi21FinalOutput'
    assert nodes[153]['widgets_values'] == []
    assert [slot['name'] for slot in nodes[153]['inputs']] == ['正向提示词', '负向提示词', '透明模式']
    pe_link = next(link for link in subgraph['links'] if link['id'] == nodes[4014]['inputs'][2]['link'])
    assert (pe_link['origin_id'], pe_link['origin_slot']) == (-10, 5)
    assert [slot['name'] for slot in subgraph['outputs']] == [
        'prompt', '画幅W', '画幅H', 'negative', '型名', '使用类型画幅']
