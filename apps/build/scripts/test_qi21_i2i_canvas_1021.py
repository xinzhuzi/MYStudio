"""Offline purpose-to-sampling contracts for the saved QI21 i2i canvas."""
from __future__ import annotations

import copy
import importlib
import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
repair = importlib.import_module('qi21_i2i_repair_1016')
builder = importlib.import_module('qwen21_bridge_template_build')
NODE_DIR = ROOT / 'apps/backend/engines/comfyui/my_nodes/nodes'
package = types.ModuleType('offline_qi21_canvas_nodes')
package.__path__ = [str(NODE_DIR)]
sys.modules[package.__name__] = package
PURPOSES = ('新建资产', '局部编辑', '画风转换', '无底座出图')
REFERENCE = (1536, 1024)


def node_module(name):
    return importlib.import_module(f'{package.__name__}.{name}')


def source():
    return json.loads(repair.paths()[0].read_bytes())


def schemas():
    info = json.loads((ROOT / 'apps/backend/engines/comfyui/tests/fixtures/qi21_object_info_snapshot.json').read_bytes())
    router = NODE_DIR / 'my_qi21_purpose_canvas.py'
    if router.exists():
        cls = node_module(router.stem).MyQi21PurposeCanvas
        info[cls.__name__] = {'input': cls.INPUT_TYPES(), 'output': cls.RETURN_TYPES}
    return info


def flattened(document):
    with patch.object(builder, 'selected_graph', side_effect=lambda graph, outputs: graph):
        return builder.flatten_canvas(document, schemas())


def resolve(graph, value, reference=REFERENCE):
    if not (isinstance(value, list) and len(value) == 2 and isinstance(value[0], str)):
        return value
    identifier, slot = value
    item = graph[identifier]
    inputs = item['inputs']
    kind = item['class_type']
    if kind == 'ComfySwitchNode':
        selected = 'on_true' if resolve(graph, inputs['switch'], reference) else 'on_false'
        return resolve(graph, inputs[selected], reference)
    if kind == 'MyQi21PurposeCanvas':
        return node_module('my_qi21_purpose_canvas').MyQi21PurposeCanvas().route(
            resolve(graph, inputs['组装用途'], reference))[slot]
    if kind in ('PrimitiveBoolean', 'PrimitiveInt'):
        return inputs['value']
    if kind == 'MyQi21DaojieBase':
        return node_module('my_qi21_base').MyQi21DaojieBase().run(inputs['base'])[slot]
    if kind == 'MyQi21WhSuggest':
        kwargs = {name: resolve(graph, val, reference) for name, val in inputs.items()}
        return node_module('my_qi21_wh_suggest').MyQi21WhSuggest().suggest(**kwargs)[slot]
    if kind == 'MyQi21ApiPE' and slot in (3, 4):
        result = node_module('my_qi21_api_pe').MyQi21ApiPE().rewrite(
            画幅宽=resolve(graph, inputs['画幅宽'], reference),
            画幅高=resolve(graph, inputs['画幅高'], reference), AI扩写开关=False)
        return result['result'][slot]
    if kind == 'EmptyLatentImage':
        return ('empty', resolve(graph, inputs['width'], reference), resolve(graph, inputs['height'], reference))
    if kind == 'TextEncodeQwenImage21' and slot == 2:
        return ('reference', *reference)
    if kind in ('KSampler', 'SamplerCustomAdvanced') and slot in (0, 1):
        return resolve(graph, inputs['latent_image'], reference)
    raise AssertionError((identifier, slot, kind))


def select(document, purpose, type_name='人物', manual=(0, 0)):
    host = repair.host(document, repair.PROMPT_ID)
    for name, value in (('组装用途', purpose), ('型选择', type_name)):
        host['widgets_values_named'][name] = value
        host['widgets_values'][4 if name == '组装用途' else 1] = value
    dimensions = next(item for item in repair.graph(document, repair.PROMPT_ID)['nodes']
                      if item['type'] == 'MyQi21WhSuggest')
    dimensions['widgets_values_named'].update(dict(zip(('手动宽', '手动高'), manual)))
    return document


def test_new_asset_reaches_typed_empty_latent_not_reference():
    graph = flattened(select(source(), '新建资产'))
    assert resolve(graph, ['20', 0])[0] == 'empty', '新建资产仍由独立false开关取参考图latent'


@pytest.mark.parametrize('purpose', PURPOSES)
def test_real_selected_projection_keeps_purpose_branches_and_sampler_latent(purpose):
    document = select(source(), purpose)
    info = json.loads((ROOT / 'apps/backend/engines/comfyui/tests/fixtures/qi21_object_info_snapshot.json').read_bytes())
    cls = node_module('my_qi21_purpose_canvas').MyQi21PurposeCanvas
    assert info[cls.__name__]['input'] == json.loads(json.dumps(cls.INPUT_TYPES()))
    assert info[cls.__name__]['output'] == list(cls.RETURN_TYPES)
    graph = builder.flatten_canvas(document, info)
    builder.check_object_info(graph, info)
    assert graph['6:4022']['inputs']['组装用途'] == graph['6:4011']['inputs']['组装用途'] == purpose
    assert set(graph['20']['inputs']) == {'on_false', 'on_true', 'switch'}
    expected = resolve(flattened(document), ['20', 0])
    samplers = [item for item in graph.values() if item['class_type'] in ('KSampler', 'SamplerCustomAdvanced')]
    assert len(samplers) == 1
    assert resolve(graph, samplers[0]['inputs']['latent_image']) == expected
    if purpose == '局部编辑':
        template = json.loads(builder.OUT_I2I.read_bytes())
        assert graph == template['graph']


@pytest.mark.parametrize('purpose', PURPOSES)
def test_router_is_pure_forced_input_and_rejects_unknown(purpose):
    cls = node_module('my_qi21_purpose_canvas').MyQi21PurposeCanvas
    assert cls.INPUT_TYPES()['required']['组装用途'][1]['forceInput'] is True
    assert cls.RETURN_TYPES == ('BOOLEAN',)
    assert cls().route(purpose) == (purpose in ('新建资产', '无底座出图'),)
    with pytest.raises(ValueError, match='未知组装用途'):
        cls().route('未知用途')


def test_all_purposes_types_and_sampling_inputs_match_real_t2i_dimensions():
    base = node_module('my_qi21_base')
    type_names = base.bases_list()
    assert len(type_names) == 11 and '自由' in type_names
    t2i_path, = (ROOT / 'apps/backend/engines/comfyui/workflows').rglob('qi21-道劫-t2i.json')
    t2i = json.loads(t2i_path.read_bytes())
    typed_sizes = set()
    for type_name in type_names:
        for manual in ((0, 0), (1280, 1792), (768, 512)):
            t2i_case = copy.deepcopy(t2i)
            host = next(item for item in t2i_case['nodes'] if '型选择' in item.get('widgets_values_named', {}))
            host['widgets_values_named']['型选择'] = type_name
            host['widgets_values'][0] = type_name
            suggest = next(item for item in t2i_case['nodes'] if item['type'] == 'MyQi21WhSuggest')
            suggest['widgets_values_named'].update(dict(zip(('手动宽', '手动高'), manual)))
            t2i_graph = flattened(t2i_case)
            empty, = [key for key, item in t2i_graph.items() if item['class_type'] == 'EmptyLatentImage']
            expected = resolve(t2i_graph, [empty, 0])
            if manual == (0, 0):
                typed_sizes.add(expected[1:])
            for purpose in PURPOSES:
                graph = flattened(select(source(), purpose, type_name, manual))
                assembled_purpose = graph['6:4011']['inputs']['组装用途']
                assert assembled_purpose == purpose
                actual = resolve(graph, ['20', 0])
                assert actual == (expected if purpose in ('新建资产', '无底座出图') else ('reference', *REFERENCE)), (type_name, purpose, manual)
                accel_id = repair.host(source(), repair.ACCEL_ID)['id']
                samplers = [(key, item) for key, item in graph.items()
                            if key.startswith(f'{accel_id}:') and item['class_type'] in ('KSampler', 'SamplerCustomAdvanced')]
                assert len(samplers) == 4
                for identifier, sampler in samplers:
                    assert resolve(graph, sampler['inputs']['latent_image']) == actual, identifier
    assert any(width == height for width, height in typed_sizes)
    assert any(width > height and width / height != REFERENCE[0] / REFERENCE[1]
               for width, height in typed_sizes)


def test_blueprint_host_links_and_single_purpose_source():
    surgery = importlib.import_module('qi21_i2i_cleanup_1021')
    documents = [json.loads(path.read_bytes()) for path in surgery.paths()]
    surgery.validate(documents)
    assert surgery.transform(documents) == documents
    graph = flattened(select(source(), '新建资产'))
    assert graph['6:4022']['inputs']['组装用途'] == graph['6:4011']['inputs']['组装用途'] == '新建资产'
    assert graph['20']['inputs']['switch'] == ['6:4022', 0]
    original = source()
    assert repair.host(original, repair.PROMPT_ID)['widgets_values_named']['组装用途'] == '局部编辑'


@pytest.mark.parametrize('purpose', PURPOSES)
def test_half_manual_dimensions_only_fail_when_empty_latent_is_selected(purpose):
    graph = flattened(select(source(), purpose, manual=(1280, 0)))
    if purpose in ('新建资产', '无底座出图'):
        with pytest.raises(ValueError, match='只填了一个'):
            resolve(graph, ['20', 0])
    else:
        assert resolve(graph, ['20', 0]) == ('reference', *REFERENCE)


@pytest.mark.parametrize('drift', ('root_link', 'purpose_edge', 'blueprint_port', 'manual_toggle'))
def test_route_contract_rejects_drift(drift):
    surgery = importlib.import_module('qi21_i2i_cleanup_1021')
    documents = [json.loads(path.read_bytes()) for path in surgery.paths()]
    if drift == 'root_link':
        surgery.node(repair.graph(documents[0], repair.PROMPT_ID), 4022)['inputs'][0]['link'] = -1
    elif drift == 'purpose_edge':
        edge = next(edge for edge in repair.graph(documents[0], repair.PROMPT_ID)['links']
                    if edge['target_id'] == -20 and edge['target_slot'] == 5)
        edge['origin_slot'] = 6
    elif drift == 'blueprint_port':
        repair.host(documents[1], repair.PROMPT_ID)['outputs'][-1]['name'] = 'broken'
    else:
        surgery.node(repair.graph(documents[0], repair.PROMPT_ID), 4022)['widgets_values'] = [False]
    with pytest.raises(AssertionError):
        surgery.validate(documents)


def test_reroute_chain_and_fanout_preserve_consumer_link_ids():
    surgery = importlib.import_module('qi21_i2i_cleanup_1021')
    producer = {'id': 1, 'type': 'Producer', 'outputs': [{'links': [10]}]}
    route_a = {'id': 2, 'type': 'Reroute', 'outputs': [{'links': [11, 12]}]}
    route_b = {'id': 3, 'type': 'Reroute', 'outputs': [{'links': [13]}]}
    graph = {'nodes': [producer, route_a, route_b,
                       {'id': 4, 'type': 'Consumer'}, {'id': 5, 'type': 'Consumer'}],
             'links': [[10, 1, 0, 2, 0, 'VAE'], [11, 2, 0, 3, 0, 'VAE'],
                       [12, 2, 0, 4, 0, 'VAE'], [13, 3, 0, 5, 0, 'VAE']]}
    result = surgery.collapse_reroutes(graph)
    assert {n['id'] for n in result['nodes']} == {1, 4, 5}
    assert result['links'] == [[12, 1, 0, 4, 0, 'VAE'], [13, 1, 0, 5, 0, 'VAE']]
    assert set(producer['outputs'][0]['links']) == {12, 13}
