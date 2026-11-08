from __future__ import annotations

import copy

import pytest
import qi21_accel_turbo_1016 as surgery
import qi21_defaults_acceptance as acceptance
import qwen21_bridge_template_build as builder


@pytest.mark.parametrize('line', ['t2i', 'i2i', 'edit'])
def test_saved_defaults_and_reciprocal_fix_route(line):
    document = acceptance.read_json(acceptance.canvas_paths()[line])
    assert acceptance.audit_document(document) == []


def test_entire_product_inventory():
    report = acceptance.audit()
    assert report['ok'], '\n'.join(report['errors'])
    assert sum(row['relevant'] for row in report['inventory']) == 10
    assert len(report['types']) == 10
    assert report['types'][-1] == '设定卡'


def test_missing_required_pe_switch_is_rejected():
    document = acceptance.read_json(acceptance.canvas_paths()['t2i'])
    node = next(node for subgraph in document['definitions']['subgraphs'] for node in subgraph['nodes'] if node['type'] == 'MyQi21ApiPE')
    node['widgets_values'] = node['widgets_values'][:6]
    assert any('seventh switch' in error for error in acceptance.audit_document(document))


def test_stale_named_selector_is_rejected():
    document = acceptance.read_json(acceptance.canvas_paths()['edit'])
    selector = next(node for subgraph in document['definitions']['subgraphs'] for node in subgraph['nodes'] if node['type'] == 'MyQi21SpeedSelect')
    selector['widgets_values_named']['mode'] = '2 · viggle'
    assert any('selector positional/named' in error for error in acceptance.audit_document(document))


def test_i2i_pe_widget_mirror_drift_is_rejected():
    document = acceptance.read_json(acceptance.canvas_paths()['i2i'])
    selector = next(node for scope in document['definitions']['subgraphs'] for node in scope['nodes'] if node['id'] == 4014)
    selector['widgets_values'][4] = True
    assert any('PE selection saved widget' in error for error in acceptance.audit_document(document))


def test_app_template_explicit_default_and_fix_chain():
    path = next((acceptance.COMFY / 'workflows').rglob('qwen21-道劫-t2i-api.json'))
    assert acceptance.audit_api(acceptance.read_json(path)['graph']) == []


def test_stale_reciprocal_boundary_is_rejected():
    document = acceptance.read_json(acceptance.canvas_paths()['edit'])
    subgraph = next(subgraph for subgraph in document['definitions']['subgraphs'] if any(node['type'] == 'MyQi21SpeedSelect' for node in subgraph['nodes']))
    subgraph['inputs'][0]['linkIds'].append(987654)
    assert any('boundary inputs' in error for error in acceptance.audit_document(document))


@pytest.fixture(scope='module')
def schemas():
    return builder.object_info(acceptance.TASK / 'evidence/object-info-preflight.json')


@pytest.mark.parametrize('line', ['t2i', 'i2i', 'edit'])
def test_actual_default_conversion_required_closure_and_lazy_branches(line, schemas):
    workflow, graph = acceptance.default_prompt(acceptance.canvas_paths()[line], schemas)
    assert graph['7:7027']['inputs']['strength_model'] == 0.5
    assert graph['7:7028']['inputs'] == {'model': ['7:7027', 0], 'lora_name': acceptance.TURBO_FILE, 'strength_model': 1.0}
    assert graph['7:7015']['inputs'] == {'mode': acceptance.TURBO, 'latent_turbo': ['7:7031', 0]}
    assert not {'7:7011', '7:7012', '7:7024'} & graph.keys()
    assert not any(node['class_type'] == 'TextGenerate' for node in graph.values())
    assert graph['8']['class_type'] == 'SaveImage'
    expected_outputs = {str(node['id']) for node in workflow['nodes'] if node['type'] == 'SaveImage' and node.get('mode', 0) == 0}
    assert {key for key, node in graph.items() if node['class_type'] == 'SaveImage'} == expected_outputs
    if '504' in expected_outputs:
        assert graph['504']['inputs']['images'] == ['503', 0]
    if line == 't2i':
        assert graph['6:4013']['inputs']['AI扩写开关'] is False
        assert graph['6:4010']['inputs']['base'] == next(node for node in workflow['nodes'] if node['id'] == 6)['widgets_values_named']['型选择']
    else:
        assert graph['6:4012']['inputs']['value'] is False
    subgraph = next(scope for scope in workflow['definitions']['subgraphs'] if any(node['id'] == 7031 for node in scope['nodes']))
    sampler = next(node for node in subgraph['nodes'] if node['id'] == 7031)
    links = {link['id']: link for link in subgraph['links']}
    for name in ('noise', 'sampler', 'guider', 'sigmas'):
        edge = links[next(slot['link'] for slot in sampler['inputs'] if slot['name'] == name)]
        assert graph['7:7031']['inputs'][name] == [f"7:{edge['origin_id']}", edge['origin_slot']]
    builder.check_object_info(graph, schemas)


@pytest.mark.parametrize('mode,member,absent', [('2 · viggle', '7:7024', '7:7028'), ('1 · 原生出图', '7:7010', '7:7028')])
def test_explicit_other_arms_still_derive_from_canvas(mode, member, absent, schemas):
    workflow = acceptance.read_json(acceptance.canvas_paths()['t2i'])
    host = next(node for node in workflow['nodes'] if node['id'] == 7)
    host['widgets_values'][0] = mode
    host['widgets_values_named']['速度档位'] = mode
    graph, meta = builder.build_graph(schemas, workflow)
    builder.check_object_info(graph, schemas)
    assert meta['档'] == mode
    assert member in graph and absent not in graph
    assert {'400', '404', '7:7014', '6:4010', '8', '504'} <= graph.keys()
    if mode == '2 · viggle':
        assert graph['7:7011']['inputs']['model'] == ['7:7027', 0]
        assert graph['7:7024']['inputs']['sigmas'] == ['7:7021', 1]


def test_missing_required_saved_switch_does_not_fall_back_to_schema_default(schemas):
    workflow = acceptance.read_json(acceptance.canvas_paths()['t2i'])
    node = next(node for scope in workflow['definitions']['subgraphs'] for node in scope['nodes'] if node['type'] == 'MyQi21ApiPE')
    node['widgets_values'] = node['widgets_values'][:6]
    node['widgets_values_named'].pop('AI扩写开关')
    with pytest.raises(ValueError, match='explicitly save required'):
        builder.flatten_canvas(workflow, schemas)


def test_app_keeps_established_dual_outputs_and_bindings(schemas):
    graph, _ = builder.build_graph(schemas)
    assert graph['504']['inputs']['images'] == ['503', 0]
    assert graph['8']['inputs']['images'] == ['5', 0]
    assert graph['503']['class_type'] == 'SeedVR2VideoUpscaler'
    assert graph['6:4013']['inputs']['AI扩写开关'] is False
    for binding in builder.TEMPLATE['inputs'].values():
        assert graph[binding['node']]['class_type'] == binding['class_type']
        assert binding['field'] in graph[binding['node']]['inputs']


@pytest.mark.parametrize('line', ['t2i', 'i2i', 'edit'])
def test_surgery_rerun_is_idempotent_and_preserves_fix(line):
    workflow = acceptance.read_json(acceptance.canvas_paths()[line])
    original = copy.deepcopy(workflow)
    assert not surgery.ensure_fix_turbo_route(workflow)
    assert workflow == original


def test_schema_missing_or_broken_link_rejected(schemas):
    _, graph = acceptance.default_prompt(acceptance.canvas_paths()['t2i'], schemas)
    broken = copy.deepcopy(graph)
    broken['6:4013']['inputs'].pop('AI扩写开关')
    with pytest.raises(ValueError, match='missing required'):
        builder.check_object_info(broken, schemas)
    broken = copy.deepcopy(graph)
    broken['7:7028']['inputs']['model'] = ['absent-node', 0]
    with pytest.raises(ValueError, match='missing dependency'):
        builder.check_object_info(broken, schemas)


def test_receipts_match_prompt_and_do_not_accept_cached_sampler(schemas):
    _, graph = acceptance.default_prompt(acceptance.canvas_paths()['edit'], schemas)
    history = {'own': {'status': {'status_str': 'success', 'completed': True}}}
    events = [{'type': 'execution_cached', 'data': {'prompt_id': 'own', 'nodes': ['7:7027', '7:7028']}},
              {'type': 'executing', 'data': {'prompt_id': 'other', 'node': '7:7031'}}]
    assert not acceptance.judge_execution(graph, history, 'own', events)['ok']
    events.append({'type': 'executing', 'data': {'prompt_id': 'own', 'node': '7:7031'}})
    assert acceptance.judge_execution(graph, history, 'own', events)['ok']
    events.append({'type': 'executing', 'data': {'prompt_id': 'own', 'node': '7:7011'}})
    assert not acceptance.judge_execution(graph, history, 'own', events)['ok']


def test_png_black_blank_and_transparent_rejected(tmp_path):
    from PIL import Image
    for color in ('black', 'white', (0, 0, 0, 0)):
        path = tmp_path / 'blank.png'
        Image.new('RGBA', (32, 32), color).save(path)
        assert not acceptance.inspect_png(path)['ok']
    image = Image.new('RGB', (32, 32), 'white')
    image.paste('red', (0, 0, 16, 32))
    image.save(tmp_path / 'content.png')
    assert acceptance.inspect_png(tmp_path / 'content.png')['ok']
